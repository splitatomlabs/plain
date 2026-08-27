import type { Card } from "./types.js";
import type { AuthorSlug } from "./constants.js";
import {
  createMessageBatch,
  pollBatchUntilDone,
  streamBatchResults,
  safeCustomId,
  tokenUsage,
  batchStats,
  callClaudeJSON,
  type BatchRequest,
  type CallClaudeOptions,
} from "./claude.js";
import { recordParseFailure } from "./parse-failure-log.js";
import { rankWall, findLandingLines, type RankedWallEntry } from "./premises.js";
import { buildWallRubricSystem, buildWallRubricUser, parseWallRubricResponse, checkFaithfulness, type WallRubricResult } from "./premises-scoring.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// T08: Batch orchestration for the premise-scoring rubric. This module OWNS
// chunk -> submit -> poll -> stream -> merge; it calls T07's prompt builders
// and parsers rather than re-implementing prompting or parsing. The gate
// (`rankWall` in ./premises.ts) and rubric parsing/prompting
// (./premises-scoring.ts) stay in their own files, per the plan's own file
// layout instruction.
//
// Pf39c2-social-pilot-02a D01: this module used to also orchestrate The
// Question and The Objection's own rubrics (`questionGate`/`objectionGate`,
// `buildQuestionRequests`/`buildObjectionRequests`,
// `scoreQuestionSurvivors`/`scoreObjectionSurvivors`). Both formats were
// deleted outright — the channel is one Wall a day, drawn from the Wall
// pool, nothing else — so only the Wall path remains.
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

// ---------------------------------------------------------------------------
// T23: retry accounting, kept separate from `faithfulnessStats`
// (faithfulness rejections are a deliberate content-quality drop; a retry
// recovery/drop is an availability outcome) and separate from
// `batchStats.failed` (./claude.ts, which after this task reflects only the
// FINAL, post-retry drop count) so a run's report can distinguish "parsed
// first time," "needed a retry and recovered," and "dropped even after a
// retry." Reset per-process like `faithfulnessStats` — a single CLI
// invocation accumulates across every format it runs, matching how
// `tokenUsage`/`batchStats` already behave.
// ---------------------------------------------------------------------------
export const retryStats = {
  retried: 0,
  recovered: 0,
  droppedAfterRetry: 0,
};

/** A batch item that failed on the first (batch) attempt and is eligible for a real-time retry. */
interface FailedItem<TMeta> {
  customId: string;
  meta: TMeta;
  request: BatchRequest;
}

/**
 * Retries every item in `failedItems` once via the real-time API, mirroring
 * `translateChunksBatch`'s retry pattern (./translator.ts:191) — reuses
 * `callClaudeJSON` (./claude.ts) rather than opening a new client path.
 * `callClaudeJSON` already does its own generic JSON.parse/extractJSON; the
 * result is re-serialized and run back through this format's own `parse`
 * (./premises-scoring.ts) so a recovered response gets EXACTLY the same
 * schema validation (score ranges, enum values, required fields) a
 * first-attempt success would have gotten — not a weaker check.
 */
async function retryFailedItems<TMeta, TParsed>(
  failedItems: FailedItem<TMeta>[],
  format: string,
  parse: (raw: string) => TParsed,
): Promise<Array<{ meta: TMeta; parsed: TParsed }>> {
  if (failedItems.length === 0) return [];

  logger.warn(
    `premises-batch: ${format} — retrying ${failedItems.length} failed request(s) via real-time API`,
  );

  const recovered: Array<{ meta: TMeta; parsed: TParsed }> = [];

  for (const { customId, meta, request } of failedItems) {
    retryStats.retried++;
    try {
      const raw = await callClaudeJSON<unknown>(request.messages[0].content, undefined, {
        system: request.system,
      } as CallClaudeOptions);
      const parsed = parse(JSON.stringify(raw));
      recovered.push({ meta, parsed });
      retryStats.recovered++;
      logger.info(`premises-batch: ${format} — ${customId} recovered via retry`);
    } catch (e) {
      retryStats.droppedAfterRetry++;
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn(`premises-batch: ${format} — ${customId} retry failed: ${msg} — dropped`);
    }
  }

  return recovered;
}

// ---------------------------------------------------------------------------
// Submit -> poll -> stream -> merge, shared across all three formats.
// Mirrors `translateChunksBatch`'s structure (createMessageBatch ->
// pollBatchUntilDone -> streamBatchResults -> per-item error handling ->
// retry-once via the real-time API). Before T23 this module dropped a
// failed item permanently after a logged reason; now every failure gets one
// real-time retry (`retryFailedItems`, above) before being counted as
// dropped, and a parse failure additionally has its raw response persisted
// (`recordParseFailure`, ./parse-failure-log.ts) so the failure is
// diagnosable rather than just logged-and-discarded.
// ---------------------------------------------------------------------------

async function submitAndCollect<TMeta, TParsed>(
  built: BuiltRequest<TMeta>[],
  format: string,
  parse: (raw: string) => TParsed,
): Promise<Array<{ meta: TMeta; parsed: TParsed }>> {
  if (built.length === 0) return [];

  const metaByCustomId = new Map<string, TMeta>();
  const requestByCustomId = new Map<string, BatchRequest>();
  for (const b of built) {
    metaByCustomId.set(b.request.custom_id, b.meta);
    requestByCustomId.set(b.request.custom_id, b.request);
  }

  const chunks = chunkArray(built, MAX_REQUESTS_PER_BATCH);
  logger.info(
    `premises-batch: ${format} — submitting ${built.length} requests in ${chunks.length} batch(es)`,
  );

  const collected: Array<{ meta: TMeta; parsed: TParsed }> = [];
  const failedItems: FailedItem<TMeta>[] = [];
  let firstAttemptFailed = 0;

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
      const request = requestByCustomId.get(item.custom_id);
      if (!meta || !request) {
        logger.warn(`premises-batch: ${format} — unknown custom_id ${item.custom_id} — ignored`);
        continue;
      }

      if (item.result.type === "errored") {
        firstAttemptFailed++;
        logger.warn(
          `premises-batch: ${format} — ${item.custom_id} errored: ${JSON.stringify(item.result.error)} — will retry`,
        );
        failedItems.push({ customId: item.custom_id, meta, request });
        continue;
      }

      const message = item.result.message;
      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        firstAttemptFailed++;
        logger.warn(`premises-batch: ${format} — ${item.custom_id} had no text content — will retry`);
        failedItems.push({ customId: item.custom_id, meta, request });
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
        firstAttemptFailed++;
        const msg = e instanceof Error ? e.message : String(e);
        const stopReason = message.stop_reason ?? null;
        const outputTokens = message.usage.output_tokens;
        logger.warn(
          `premises-batch: ${format} — ${item.custom_id} failed to parse response ` +
            `(stop_reason=${stopReason}, output_tokens=${outputTokens}): ${msg} — will retry`,
        );
        // T23: persist the raw response so this failure is diagnosable —
        // awaited (not fire-and-forget) so the capture is guaranteed to
        // exist on disk before this function returns, and a write failure
        // is logged loudly rather than silently swallowed.
        try {
          const capturePath = await recordParseFailure({
            custom_id: item.custom_id,
            format,
            error: msg,
            stop_reason: stopReason,
            output_tokens: outputTokens,
            raw_text: textBlock.text,
          });
          logger.info(`premises-batch: ${format} — captured raw response for ${item.custom_id} at ${capturePath}`);
        } catch (writeErr) {
          logger.warn(
            `premises-batch: ${format} — failed to persist parse-failure capture for ${item.custom_id}: ${writeErr}`,
          );
        }
        failedItems.push({ customId: item.custom_id, meta, request });
        continue;
      }

      collected.push({ meta, parsed });
    }
  }

  const recovered = await retryFailedItems(failedItems, format, parse);
  collected.push(...recovered);
  const droppedFinal = firstAttemptFailed - recovered.length;

  batchStats.totalRequests += built.length;
  batchStats.succeeded += collected.length;
  batchStats.failed += droppedFinal;

  logger.info(
    `premises-batch: ${format} — ${collected.length} succeeded (${recovered.length} via retry), ` +
      `${droppedFinal} dropped (of ${built.length} submitted)`,
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
  format: "wall";
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
  const wallBuilt = buildWallRequests(wallEntries, cardsById);

  const formats: DryRunFormatReport[] = [
    {
      format: "wall",
      survivorCount: wallEntries.length,
      requestCount: wallBuilt.length,
      estimatedTokens: estimateTokensForRequests(wallBuilt),
    },
  ];

  return {
    formats,
    totalRequests: formats.reduce((sum, f) => sum + f.requestCount, 0),
    totalEstimatedTokens: formats.reduce((sum, f) => sum + f.estimatedTokens, 0),
  };
}
