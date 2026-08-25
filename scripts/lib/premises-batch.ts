import type { Card } from "./types.js";
import type { AuthorSlug } from "./constants.js";
import {
  createMessageBatch,
  pollBatchUntilDone,
  streamBatchResults,
  safeCustomId,
  tokenUsage,
  batchStats,
  type BatchRequest,
} from "./claude.js";
import {
  rankWall,
  questionGate,
  objectionGate,
  buildQuestionDriftRequests,
  findLandingLines,
  type RankedWallEntry,
  type QuestionEntry,
  type ObjectionEntry,
} from "./premises.js";
import {
  buildWallRubricSystem,
  buildWallRubricUser,
  buildQuestionRubricSystem,
  buildQuestionRubricUser,
  buildObjectionRubricSystem,
  buildObjectionRubricUser,
  parseWallRubricResponse,
  parseQuestionRubricResponse,
  parseObjectionRubricResponse,
  checkFaithfulness,
  type WallRubricResult,
  type QuestionRubricResult,
  type ObjectionRubricResult,
  type QuestionRubricVerdict,
} from "./premises-scoring.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// T08: Batch orchestration for the three premise-scoring rubrics
// (Wall/Question/Objection). This module OWNS chunk -> submit -> poll ->
// stream -> merge; it calls T07's prompt builders and parsers rather than
// re-implementing prompting or parsing. Gates (`rankWall`/`questionGate`/
// `objectionGate` in ./premises.ts) and rubric parsing/prompting
// (./premises-scoring.ts) stay in their own files, per the plan's own file
// layout instruction.
//
// Log destination: content/pipeline/social/premises.log, via the shared
// `logger` singleton (see ./logger.ts — `init` now accepts an optional
// filename so a non-book pipeline like this one doesn't collide with
// generate.ts's own content/pipeline/<book>/pipeline.log convention).
// Callers (T10's CLI) are responsible for calling
// `logger.init("social", verbose, "premises.log")` before invoking any
// function in this module; this module only ever calls `logger.info`/
// `.warn`, never `.init`/`.close`, so it composes with whatever the caller
// already has open.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Cache-control note: every request built below sets `cache_system: true`,
// which tells `createMessageBatch` (./claude.ts) to emit `system` as the
// array-with-`cache_control: { type: "ephemeral" }` form instead of a plain
// string — the same breakpoint `callClaudeAPI`'s real-time path has used
// all along. That, combined with `sortByAuthor` grouping requests so the
// BYTE-IDENTICAL per-author system string (from `buildTranslationSystem`'s
// pattern) is contiguous across each batch, is what actually lets Wall's
// ~1,003 requests share a server-side cache instead of each paying full
// input price for the same author prompt.
// ---------------------------------------------------------------------------

function sortByAuthor<T extends { author_slug: AuthorSlug }>(entries: T[]): T[] {
  return [...entries].sort((a, b) => a.author_slug.localeCompare(b.author_slug));
}

// ---------------------------------------------------------------------------
// Chunking. The three pools here (measured: Wall ~1,003, Question ~89,
// Objection ~59) are all far under the Anthropic Batch API's own request-
// count ceiling (100,000/batch), so this isn't required to stay under a
// hard API limit today. It exists so a single batch failure/outage only
// costs re-submitting one page of requests, not the whole pool, and so
// poll/stream progress is visible in smaller increments than "wait for
// 1,003 requests to finish." Deliberately small enough to matter for the
// Wall pool while staying a single batch for Question/Objection.
// ---------------------------------------------------------------------------
export const MAX_REQUESTS_PER_BATCH = 500;

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) throw new Error(`chunkArray: size must be positive, got ${size}`);
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Survivor ceilings — a trip wire, not a tuning knob. Each is set with
// generous headroom above this file's own measured gate sizes (Wall 1,003
// via T02/T03; Question 89 via T04; Objection 59 via T07a), but strictly
// below the full corpus (1,615 cards). A caller that accidentally passes
// `loadCorpus()` itself (or any other un-gated list) instead of a real gate
// survivor pool trips this immediately instead of silently paying for an
// LLM call on every card in the app.
// ---------------------------------------------------------------------------
const WALL_SURVIVOR_CEILING = 1_100;
const QUESTION_SURVIVOR_CEILING = 150;
const OBJECTION_SURVIVOR_CEILING = 100;

function assertWithinSurvivorCeiling(count: number, ceiling: number, format: string): void {
  if (count > ceiling) {
    throw new Error(
      `premises-batch: refusing to submit ${count} ${format} requests — exceeds the survivor ceiling of ${ceiling}. ` +
        `Only gate survivors should ever reach this function, never the raw corpus.`,
    );
  }
}

// ---------------------------------------------------------------------------
// T09: Faithfulness enforcement — THE CENTRAL SAFETY PROPERTY. "Every word
// on screen must be traceable to plain_english or original_excerpt. Enforce
// mechanically." T07's `checkFaithfulness` (./premises-scoring.ts) does the
// mechanical check; this module is responsible for actually CALLING it on
// every piece of on-screen text before an entry is admitted to a format's
// scored pool, for all three formats — Wall's chosen_landing_line, Question's
// question+answer, Objection's quoted objection+reply. A failure is DROPPED,
// never repaired (the plan says reject, not repair), with a logged reason
// naming the card id and the specific offending field, and is counted
// separately from generic batch failures so a nonzero count is a visible
// signal for T11's report, not a silent drop folded into `batchStats.failed`.
// ---------------------------------------------------------------------------

/** Faithfulness-check rejections, counted separately from `batchStats.failed` (./claude.ts) — see the block comment above. */
export const faithfulnessStats = {
  rejected: 0,
};

/**
 * Run T07's `checkFaithfulness` against `text` for the on-screen field named
 * `field` on card `cardId`. Returns `true` (admit) or `false` (drop) and, on
 * failure, logs a warning naming both the card id and the field, and
 * increments `faithfulnessStats.rejected`.
 */
function assertFaithful(
  format: string,
  cardId: string,
  field: string,
  text: string,
  card: Pick<Card, "plain_english" | "original_excerpt">,
): boolean {
  const result = checkFaithfulness(text, card);
  if (result.faithful) return true;
  faithfulnessStats.rejected++;
  logger.warn(
    `premises-batch: ${format} — ${cardId} failed faithfulness check on "${field}": ${result.reason} — dropped`,
  );
  return false;
}

// ---------------------------------------------------------------------------
// Request builders. Pure functions — no SDK client, no network call, no
// read of ANTHROPIC_API_KEY — so they're safe to call from `buildDryRunReport`
// with no API key set. Each returns the built `BatchRequest` alongside the
// originating gate entry ("meta") for result correlation after
// `streamBatchResults` — the same correlation-by-custom_id pattern
// `translateChunksBatch` uses via its own `meta` map.
// ---------------------------------------------------------------------------

export interface BuiltRequest<TMeta> {
  request: BatchRequest;
  meta: TMeta;
}

export function buildWallRequests(
  entries: RankedWallEntry[],
  cardsById: Map<string, Card>,
): BuiltRequest<RankedWallEntry>[] {
  return sortByAuthor(entries).map((entry, index) => {
    const card = cardsById.get(entry.card_id);
    if (!card) {
      throw new Error(`buildWallRequests: no source card found for ${entry.card_id}`);
    }
    return {
      request: {
        custom_id: safeCustomId("wall", entry.card_id, index),
        system: buildWallRubricSystem(entry.author_slug),
        cache_system: true,
        messages: [{ role: "user", content: buildWallRubricUser(card) }],
      },
      meta: entry,
    };
  });
}

export function buildQuestionRequests(entries: QuestionEntry[]): BuiltRequest<QuestionEntry>[] {
  const ordered = sortByAuthor(entries);
  const driftRequests = buildQuestionDriftRequests(ordered);
  return ordered.map((entry, index) => ({
    request: {
      custom_id: safeCustomId("question", entry.card_id, index),
      system: buildQuestionRubricSystem(entry.author_slug),
      cache_system: true,
      messages: [{ role: "user", content: buildQuestionRubricUser(driftRequests[index]) }],
    },
    meta: entry,
  }));
}

export function buildObjectionRequests(
  entries: ObjectionEntry[],
  cardsById: Map<string, Card>,
): BuiltRequest<ObjectionEntry>[] {
  return sortByAuthor(entries).map((entry, index) => {
    const card = cardsById.get(entry.card_id);
    if (!card) {
      throw new Error(`buildObjectionRequests: no source card found for ${entry.card_id}`);
    }
    return {
      request: {
        custom_id: safeCustomId("objection", entry.card_id, index),
        system: buildObjectionRubricSystem(entry.author_slug),
        cache_system: true,
        messages: [{ role: "user", content: buildObjectionRubricUser(entry.objection, card) }],
      },
      meta: entry,
    };
  });
}

// ---------------------------------------------------------------------------
// Submit -> poll -> stream -> merge, shared across all three formats.
// Mirrors `translateChunksBatch`'s structure (createMessageBatch ->
// pollBatchUntilDone -> streamBatchResults -> per-item error handling), with
// one deliberate difference: this module DROPS a failed item with a logged
// reason rather than retrying it via the real-time API. The plan's own task
// description asks for "drop failures with a logged reason," not a retry —
// unlike the translate phase, a dropped premise candidate just means one
// fewer post-worthy card in a pool of hundreds, not a missing card in the
// shipped book.
// ---------------------------------------------------------------------------

async function submitAndCollect<TMeta, TParsed>(
  built: BuiltRequest<TMeta>[],
  format: string,
  parse: (raw: string) => TParsed,
): Promise<Array<{ meta: TMeta; parsed: TParsed }>> {
  if (built.length === 0) return [];

  const metaByCustomId = new Map<string, TMeta>();
  for (const b of built) metaByCustomId.set(b.request.custom_id, b.meta);

  const chunks = chunkArray(built, MAX_REQUESTS_PER_BATCH);
  logger.info(
    `premises-batch: ${format} — submitting ${built.length} requests in ${chunks.length} batch(es)`,
  );

  const collected: Array<{ meta: TMeta; parsed: TParsed }> = [];
  let failed = 0;

  for (let i = 0; i < chunks.length; i++) {
    const requests = chunks[i].map((c) => c.request);
    logger.info(
      `premises-batch: ${format} — batch ${i + 1}/${chunks.length}: submitting ${requests.length} requests`,
    );

    const batch = await createMessageBatch(requests);
    logger.info(`premises-batch: ${format} — created batch ${batch.id}`);

    await pollBatchUntilDone(batch.id);

    for await (const item of streamBatchResults(batch.id)) {
      const meta = metaByCustomId.get(item.custom_id);
      if (!meta) {
        logger.warn(`premises-batch: ${format} — unknown custom_id ${item.custom_id} — ignored`);
        continue;
      }

      if (item.result.type === "errored") {
        failed++;
        logger.warn(
          `premises-batch: ${format} — ${item.custom_id} errored: ${JSON.stringify(item.result.error)} — dropped`,
        );
        continue;
      }

      const message = item.result.message;
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        failed++;
        logger.warn(`premises-batch: ${format} — ${item.custom_id} had no text content — dropped`);
        continue;
      }

      tokenUsage.inputTokens += message.usage.input_tokens;
      tokenUsage.outputTokens += message.usage.output_tokens;
      tokenUsage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
      tokenUsage.cacheCreationTokens += message.usage.cache_creation_input_tokens ?? 0;

      let parsed: TParsed;
      try {
        parsed = parse(textBlock.text);
      } catch (e) {
        failed++;
        const msg = e instanceof Error ? e.message : String(e);
        logger.warn(
          `premises-batch: ${format} — ${item.custom_id} failed to parse response: ${msg} — dropped`,
        );
        continue;
      }

      collected.push({ meta, parsed });
    }
  }

  batchStats.totalRequests += built.length;
  batchStats.succeeded += collected.length;
  batchStats.failed += failed;

  logger.info(
    `premises-batch: ${format} — ${collected.length} succeeded, ${failed} dropped (of ${built.length} submitted)`,
  );

  return collected;
}

// ---------------------------------------------------------------------------
// Per-format entry points. Each takes the ALREADY-GATED survivor pool
// (never the raw corpus — see `assertWithinSurvivorCeiling`) plus whatever
// `Card[]` lookup context its own rubric's user-message builder needs, and
// returns the merged, scored pool.
// ---------------------------------------------------------------------------

export type ScoredWallEntry = RankedWallEntry & { rubric: WallRubricResult };
export type ScoredQuestionEntry = QuestionEntry & {
  drift_verdict: QuestionRubricVerdict;
  drift_reason: string;
  // T22: the stopping-power dimension, independent of drift_verdict above —
  // see ./premises-scoring.ts's `QuestionRubricResult`/`passesStoppingPower`
  // doc comments for why these three stay their own fields rather than
  // folding into drift_verdict or into one another.
  standalone_intelligible: boolean;
  answer_has_substance: boolean;
  modern_premise: boolean;
};
export type ScoredObjectionEntry = ObjectionEntry & { rubric: ObjectionRubricResult };

/**
 * Score The Wall's gate survivors (`rankWall` output). Two independent
 * defenses against a hallucinated `chosen_landing_line`, both drops with a
 * logged reason: (1) T09's `checkFaithfulness` — the line must be an exact
 * substring of `plain_english` or `original_excerpt`; (2) Wall's own
 * multiple-choice invariant — the line must additionally be verbatim among
 * the candidates `buildWallRubricUser` actually offered the model
 * (`findLandingLines(card)`), which is strictly narrower than (1) alone
 * (e.g. it also enforces the landing-line word-count/self-containment
 * bounds a merely-faithful substring wouldn't).
 */
export async function scoreWallSurvivors(
  entries: RankedWallEntry[],
  cards: Card[],
): Promise<ScoredWallEntry[]> {
  assertWithinSurvivorCeiling(entries.length, WALL_SURVIVOR_CEILING, "Wall");
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const built = buildWallRequests(entries, cardsById);
  const results = await submitAndCollect(built, "wall", parseWallRubricResponse);

  const scored: ScoredWallEntry[] = [];
  for (const { meta, parsed } of results) {
    const card = cardsById.get(meta.card_id);
    if (!card) continue; // unreachable — buildWallRequests already required this card to exist

    if (!assertFaithful("wall", meta.card_id, "chosen_landing_line", parsed.chosen_landing_line, card)) {
      continue;
    }

    const candidates = findLandingLines(card);
    if (!candidates.includes(parsed.chosen_landing_line)) {
      logger.warn(
        `premises-batch: wall — ${meta.card_id} chosen_landing_line is not among the offered candidates — dropped`,
      );
      continue;
    }
    scored.push({ ...meta, rubric: parsed });
  }
  return scored;
}

/**
 * Score The Question's gate survivors (`questionGate` output) for topic
 * drift (T04 layer (c)). `cards` is required (not just `entries`) so every
 * survivor's on-screen `question` and `answer` — both mechanically extracted
 * from `plain_english` by `questionGate`, not authored by the LLM rubric,
 * but audited here anyway per T09's own instruction to check every on-screen
 * field before admission — can be faithfulness-checked against their source
 * card before being admitted to the scored pool.
 */
export async function scoreQuestionSurvivors(
  entries: QuestionEntry[],
  cards: Card[],
): Promise<ScoredQuestionEntry[]> {
  assertWithinSurvivorCeiling(entries.length, QUESTION_SURVIVOR_CEILING, "Question");
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const built = buildQuestionRequests(entries);
  const results = await submitAndCollect(built, "question", parseQuestionRubricResponse);

  const scored: ScoredQuestionEntry[] = [];
  for (const { meta, parsed } of results) {
    const card = cardsById.get(meta.card_id);
    if (!card) continue; // no source card supplied for this survivor — can't verify faithfulness, so don't admit it

    if (!assertFaithful("question", meta.card_id, "question", meta.question, card)) continue;
    if (!assertFaithful("question", meta.card_id, "answer", meta.answer, card)) continue;

    scored.push({
      ...meta,
      drift_verdict: parsed.verdict,
      drift_reason: parsed.reason,
      standalone_intelligible: parsed.standalone_intelligible,
      answer_has_substance: parsed.answer_has_substance,
      modern_premise: parsed.modern_premise,
    });
  }
  return scored;
}

/** Score The Objection's gate survivors (`objectionGate` output). */
export async function scoreObjectionSurvivors(
  entries: ObjectionEntry[],
  cards: Card[],
): Promise<ScoredObjectionEntry[]> {
  assertWithinSurvivorCeiling(entries.length, OBJECTION_SURVIVOR_CEILING, "Objection");
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  const built = buildObjectionRequests(entries, cardsById);
  const results = await submitAndCollect(built, "objection", parseObjectionRubricResponse);

  const scored: ScoredObjectionEntry[] = [];
  for (const { meta, parsed } of results) {
    const card = cardsById.get(meta.card_id);
    if (!card) continue; // unreachable — buildObjectionRequests already required this card to exist

    if (!assertFaithful("objection", meta.card_id, "objection", meta.objection, card)) continue;
    if (!assertFaithful("objection", meta.card_id, "reply", meta.reply, card)) continue;

    scored.push({ ...meta, rubric: parsed });
  }
  return scored;
}

// ---------------------------------------------------------------------------
// Dry run. Builds every request for every format exactly as the real
// orchestration would, but stops before `submitAndCollect` — so it never
// calls `createMessageBatch`/`pollBatchUntilDone`/`streamBatchResults`,
// never touches the Anthropic SDK client (`getClient()` in ./claude.ts is
// only ever called from inside those three functions), and never reads
// `ANTHROPIC_API_KEY`. Safe to call with no API key set — this is the
// acceptance criterion for this task. T10's CLI wires a `--dry-run` flag to
// this function; this module doesn't parse argv itself.
// ---------------------------------------------------------------------------

export interface DryRunFormatReport {
  format: "wall" | "question" | "objection";
  survivorCount: number;
  requestCount: number;
  estimatedTokens: number;
}

export interface DryRunReport {
  formats: DryRunFormatReport[];
  totalRequests: number;
  totalEstimatedTokens: number;
}

/** Rough, cheap token estimate — 4 characters/token, the standard ballpark heuristic. Not billing-accurate. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokensForRequests(built: BuiltRequest<unknown>[]): number {
  let chars = 0;
  for (const { request } of built) {
    chars += request.system?.length ?? 0;
    for (const m of request.messages) chars += m.content.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

export function buildDryRunReport(cards: Card[]): DryRunReport {
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  const wallEntries = rankWall(cards);
  const questionEntries = questionGate(cards);
  const objectionEntries = objectionGate(cards);

  const wallBuilt = buildWallRequests(wallEntries, cardsById);
  const questionBuilt = buildQuestionRequests(questionEntries);
  const objectionBuilt = buildObjectionRequests(objectionEntries, cardsById);

  const formats: DryRunFormatReport[] = [
    {
      format: "wall",
      survivorCount: wallEntries.length,
      requestCount: wallBuilt.length,
      estimatedTokens: estimateTokensForRequests(wallBuilt),
    },
    {
      format: "question",
      survivorCount: questionEntries.length,
      requestCount: questionBuilt.length,
      estimatedTokens: estimateTokensForRequests(questionBuilt),
    },
    {
      format: "objection",
      survivorCount: objectionEntries.length,
      requestCount: objectionBuilt.length,
      estimatedTokens: estimateTokensForRequests(objectionBuilt),
    },
  ];

  return {
    formats,
    totalRequests: formats.reduce((sum, f) => sum + f.requestCount, 0),
    totalEstimatedTokens: formats.reduce((sum, f) => sum + f.estimatedTokens, 0),
  };
}
