/**
 * T12: The weekly social schedule generator.
 *
 * Produces one week of `content/social/pilot-schedule-wNN.json` — 7 days x 2
 * slots. Both slots' FORMAT is drawn from a weighted random choice among The
 * Wall / The Question / The Objection (a weighting ARGUMENT, not a
 * hardcoded pattern — see `DEFAULT_FORMAT_WEIGHTS`). Slot 1 additionally
 * carries the read-through counter (a "Card N of TOTAL" label): the read-
 * through counter is NOT a format of its own, per the plan — it's a label
 * rendered onto a post whose format is drawn exactly like slot 2's. What
 * makes slot 1 special is only that its CARD is forced to the next
 * sequential card of the read-through book (independent of format
 * weighting, so the book advances with no skips or repeats), while slot 2's
 * card is drawn without replacement from the chosen format's pool.
 *
 * Because slot 1's card is fixed by sequence rather than chosen from a pool,
 * the format the weighted draw picks for it might not be renderable by that
 * specific card (e.g. it drew "question" but this Enchiridion card has no
 * self-contained question sentence). When that happens, `resolveReadThrough`
 * falls back deterministically — no extra rng consumption — through a fixed
 * priority order (the drawn candidate first, then Wall, then Question, then
 * Objection, skipping whichever was already tried) until it finds a format
 * the card can actually render. Wall always renders (falls back to the raw
 * `plain_english` when no standalone landing line exists), so the cascade
 * always terminates.
 *
 * `generateWeek` is a pure function: no filesystem access, no `Date.now()`,
 * no `Math.random()`. Every random choice is drawn from `createSeededRng`
 * (./premises.ts, built by T05 specifically for this reuse) so the same
 * seed + weights + prior-week card ids + read-through position always
 * produces byte-identical output. `loadFormatPools` and `loadPriorWeeks`
 * below do the filesystem/JSON work the CLI needs and are the only
 * impure exports in this module.
 *
 * Pool fallback (per the plan's explicit sequencing note): T11 has not run
 * yet, so `content/social/premises/{wall,question,objection}.json` do not
 * exist. `loadFormatPools` reads the scored pool file WHEN PRESENT (and, for
 * Question/Objection, filters to the accepted verdict only — a scored pool
 * file includes rejected rows too, since `scoreQuestionSurvivors`/
 * `scoreObjectionSurvivors` merge every parsed response regardless of
 * verdict) and falls back to the mechanical gate output
 * (`rankWall`/`questionGate`/`objectionGate`) when the file is absent — so
 * this generator needs no rework once T11 lands.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { AuthorSlug } from "./constants.js";
import type { Card } from "./types.js";
import {
  createSeededRng,
  combinedAuthorMix,
  wallAuthorWeights,
  selectWallBalanced,
  selectLandingLine,
  findQuestionCandidate,
  questionCandidateAnswer,
  objectionGate,
  type AuthorMixEntry,
  type WallEntry,
  type RankedWallEntry,
  type QuestionEntry,
  type ObjectionEntry,
} from "./premises.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ScheduleFormat = "wall" | "question" | "objection";
export const SCHEDULE_FORMATS: readonly ScheduleFormat[] = ["wall", "question", "objection"];

export interface FormatWeights {
  wall: number;
  question: number;
  objection: number;
}

/**
 * Defaults reflect the plan's stated cadence directly: The Wall and The
 * Question post daily, The Objection posts weekly. Both of the week's 14
 * slots (7 read-through, 7 weighted) draw their format from this SAME
 * weighting — the read-through slot is not a hardcoded "wall" any more (see
 * the module doc comment and `resolveReadThrough`) — so the weights
 * themselves should be proportional to the target 14-slot split: 7 Wall / 6
 * Question / 1 Objection. `{ wall: 7, question: 6, objection: 1 }` sums to
 * 14 and gives each format an expected share across 14 draws equal to its
 * target count, while The Objection is additionally hard-capped at
 * `DEFAULT_MAX_OBJECTION_PER_WEEK` per week regardless of weight (see
 * `generateWeek`) so raising its weight only makes it MORE LIKELY to land
 * the week's one allotted slot, never more frequent than weekly. This is a
 * weighting argument, not a hardcoded pattern — every value here is
 * overridable via `--wall-weight` / `--question-weight` / `--objection-weight`.
 *
 * MEASURED CAVEAT: the realized weekly format counts skew noticeably more
 * Wall-heavy than the literal "7/6/1" split, because the read-through's own
 * draw resolves to Wall far more than its weighted share alone would
 * suggest — measured directly against Enchiridion's 70 cards, only 8 can
 * render Question and only 4 can render Objection, so whenever the
 * read-through's candidate draw picks a non-Wall format it usually cascades
 * straight back to Wall (`resolveReadThrough`). This is expected, not a
 * bug: it means Wall's balanced pool (`selectWallBalanced`) now runs for
 * real in the weighted slot too (previously it never ran there at all — the
 * defect this fixes), and pulls the week's combined author mix measurably
 * below the pre-fix 71.4% Epictetus share (see
 * `schedule.test.ts`'s `DEFAULT_FORMAT_WEIGHTS` suite).
 */
export const DEFAULT_FORMAT_WEIGHTS: FormatWeights = { wall: 7, question: 6, objection: 1 };

/**
 * Fixed priority order used ONLY to break a tie when the weighted draw picks
 * a format the read-through's next sequential card can't actually render
 * (see `resolveReadThrough`) — mirrors the plan's own listed format order
 * (Wall, Question, Objection). Not consulted at all for slot 2, whose format
 * is drawn straight from the weights against real pool availability.
 */
export const READ_THROUGH_FALLBACK_ORDER: readonly ScheduleFormat[] = ["wall", "question", "objection"];

export const DEFAULT_MAX_OBJECTION_PER_WEEK = 1;

export interface WallSlotContent {
  format: "wall";
  original_excerpt: string;
  landing_line: string;
}

export interface QuestionSlotContent {
  format: "question";
  question: string;
  answer: string;
}

export interface ObjectionSlotContent {
  format: "objection";
  objection: string;
  reply: string;
}

export type SlotContent = WallSlotContent | QuestionSlotContent | ObjectionSlotContent;

export interface ScheduleSlot {
  day: number; // 1-7
  slot: number; // 1-2 (slot 1 is always the read-through slot)
  card_id: string;
  book_slug: string;
  author_slug: AuthorSlug;
  content: SlotContent;
  read_through: boolean;
  /** e.g. "Card 5 of 70". `null` when `read_through` is false. */
  read_through_counter: string | null;
}

export interface WeekSchedule {
  week: number;
  seed: number;
  weights: FormatWeights;
  read_through_book: string;
  /**
   * `"dynamic"` (the default) means each day's read-through slot draws its
   * own format from `weights`, same as slot 2 — see the module doc comment.
   * A concrete `ScheduleFormat` means the caller forced every read-through
   * slot to that one format via `GenerateWeekOptions.readThroughFormat`
   * (throwing if any card in the book can't render it), bypassing the
   * per-day weighted draw entirely.
   */
  read_through_format: ScheduleFormat | "dynamic";
  read_through_total: number;
  max_objection_per_week: number;
  slots: ScheduleSlot[];
  format_counts: Record<ScheduleFormat, number>;
  author_mix: Record<AuthorSlug, AuthorMixEntry>;
  pool_source: Record<ScheduleFormat, "scored" | "gate-only">;
}

export interface FormatPools {
  /** Always `RankedWallEntry[]` in practice (`rankWall`'s own output, or a scored pool which extends it). */
  wall: RankedWallEntry[];
  question: QuestionEntry[];
  objection: ObjectionEntry[];
}

export interface GenerateWeekOptions {
  weekNumber: number;
  seed: number;
  cards: Card[];
  pools: FormatPools;
  poolSource: Record<ScheduleFormat, "scored" | "gate-only">;
  /** Every card id already used in prior weeks (and, defensively, this week — see `generateWeek`). */
  priorUsedCardIds: ReadonlySet<string>;
  readThroughBook: string;
  /** 0-based index into the read-through book's sequential card list where this week should start. */
  readThroughStartIndex: number;
  weights?: FormatWeights;
  /**
   * Optional escape hatch: force every read-through slot to this one format
   * instead of the default per-day dynamic draw (see the module doc
   * comment). Throws if any scheduled card in `readThroughBook` can't
   * render it. Leave undefined (the default) to let each day's read-through
   * slot draw its format from `weights`, same as slot 2, with a
   * deterministic per-card fallback.
   */
  readThroughFormat?: ScheduleFormat;
  maxObjectionPerWeek?: number;
}

// ---------------------------------------------------------------------------
// Small deterministic draw helpers. Both mirror `selectWallBalanced`'s own
// `Math.min(Math.floor(rng() * n), n - 1)` index formula and roulette-wheel
// pattern (./premises.ts) for consistency, and both consume `rng` exactly
// once per call — required for byte-identical regeneration from a seed.
// ---------------------------------------------------------------------------

function uniformPick<T>(pool: T[], rng: () => number): T {
  if (pool.length === 0) throw new Error("uniformPick called on an empty pool");
  const index = Math.min(Math.floor(rng() * pool.length), pool.length - 1);
  return pool[index];
}

function weightedFormatChoice(weights: FormatWeights, available: ScheduleFormat[], rng: () => number): ScheduleFormat {
  if (available.length === 0) throw new Error("weightedFormatChoice called with no available formats");
  const totalWeight = available.reduce((sum, f) => sum + (weights[f] ?? 0), 0);
  if (totalWeight <= 0) {
    // Every available format has zero weight (e.g. the default Wall weight
    // of 0 with Question/Objection both exhausted) — fall back to a uniform
    // draw so the schedule never stalls on an all-zero weight map.
    return uniformPick(available, rng);
  }
  let r = rng() * totalWeight;
  let picked = available[available.length - 1];
  for (const f of available) {
    r -= weights[f] ?? 0;
    if (r <= 0) {
      picked = f;
      break;
    }
  }
  return picked;
}

// ---------------------------------------------------------------------------
// On-screen field derivation.
// ---------------------------------------------------------------------------

/** Build a slot's on-screen fields from an already-gated/scored pool entry (the normal, weighted-slot path). */
function contentFromEntry(format: ScheduleFormat, entry: WallEntry | QuestionEntry | ObjectionEntry, card: Card): SlotContent {
  switch (format) {
    case "wall": {
      const w = entry as WallEntry;
      return { format: "wall", original_excerpt: card.original_excerpt, landing_line: w.landing_line };
    }
    case "question": {
      const q = entry as QuestionEntry;
      return { format: "question", question: q.question, answer: q.answer };
    }
    case "objection": {
      const o = entry as ObjectionEntry;
      return { format: "objection", objection: o.objection, reply: o.reply };
    }
  }
}

/**
 * Build a read-through slot's on-screen fields DIRECTLY from the raw card —
 * the read-through must advance through every card in the book with no
 * skips, so it cannot depend on gate/pool membership. "wall" always
 * renders: every card has `original_excerpt` and `plain_english`, and when
 * `selectLandingLine` finds no qualifying standalone sentence (some short
 * Enchiridion cards won't), this falls back to the full `plain_english` text
 * rather than skipping the card — still faithful (it's verbatim card text),
 * never fabricated. "question"/"objection" return `null` — rather than
 * fabricating content — when the specific card has no natural candidate for
 * that format (e.g. not every Enchiridion card poses a self-contained
 * question); per the plan's "nothing fabricated, ever" rule, presenting
 * non-question text as a question is not an option here. Callers decide
 * what a `null` means: `resolveReadThrough` treats it as "try the next
 * format in the fallback order"; `readThroughContentOrThrow` (the forced-
 * override path) treats it as a hard error.
 */
function tryReadThroughContent(format: ScheduleFormat, card: Card): SlotContent | null {
  switch (format) {
    case "wall": {
      const landingLine = selectLandingLine(card) ?? card.plain_english;
      return { format: "wall", original_excerpt: card.original_excerpt, landing_line: landingLine };
    }
    case "question": {
      const candidate = findQuestionCandidate(card);
      if (!candidate) return null;
      const answer = questionCandidateAnswer(card, candidate.index);
      if (!answer) return null;
      return { format: "question", question: candidate.question, answer };
    }
    case "objection": {
      const [found] = objectionGate([card]);
      if (!found) return null;
      return { format: "objection", objection: found.objection, reply: found.reply };
    }
  }
}

/**
 * The forced-override path (`GenerateWeekOptions.readThroughFormat` set
 * explicitly): every read-through slot must render as exactly this format,
 * so a card that can't is a hard error rather than a silent fallback — the
 * caller asked for one format specifically, not "whatever works."
 */
function readThroughContentOrThrow(format: ScheduleFormat, card: Card): SlotContent {
  const content = tryReadThroughContent(format, card);
  if (!content) {
    throw new Error(
      `Read-through card "${card.id}" has no valid ${format} candidate — readThroughFormat "${format}" ` +
        `cannot render every card in "${card.book_slug}"; use the default dynamic mode instead.`,
    );
  }
  return content;
}

/**
 * Resolve the read-through slot's actual format for one day: `candidate` is
 * the weighted draw's pick (same weights and same rng-consuming call as
 * slot 2's format draw); if this specific sequential card can't render it,
 * fall back — no additional rng consumed — through `READ_THROUGH_FALLBACK_ORDER`
 * (Wall, then Question, then Objection), skipping `candidate` itself (already
 * tried) and skipping Objection when `objectionAvailable` is false (weekly
 * cap already reached). Wall always renders, so this always terminates.
 */
function resolveReadThrough(
  candidate: ScheduleFormat,
  card: Card,
  objectionAvailable: boolean,
): { format: ScheduleFormat; content: SlotContent } {
  const order = [candidate, ...READ_THROUGH_FALLBACK_ORDER.filter((f) => f !== candidate)];
  for (const format of order) {
    if (format === "objection" && !objectionAvailable) continue;
    const content = tryReadThroughContent(format, card);
    if (content) return { format, content };
  }
  // Unreachable: "wall" is always in `order` and always renders.
  throw new Error(`Read-through card "${card.id}" could not render any format — this should be unreachable.`);
}

// ---------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------

/**
 * Generate one week (7 days x 2 slots) of the social schedule. Pure: no
 * filesystem access, no `Date.now()`, no `Math.random()`. Deterministic
 * given the same arguments — see the module doc comment.
 */
export function generateWeek(options: GenerateWeekOptions): WeekSchedule {
  const {
    weekNumber,
    seed,
    cards,
    pools,
    poolSource,
    priorUsedCardIds,
    readThroughBook,
    readThroughStartIndex,
    weights = DEFAULT_FORMAT_WEIGHTS,
    readThroughFormat: forcedReadThroughFormat,
    maxObjectionPerWeek = DEFAULT_MAX_OBJECTION_PER_WEEK,
  } = options;

  const rng = createSeededRng(seed);
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  // The read-through book's cards, in strict sequential order. `cards` is
  // expected to come from `loadCorpus()` (or preserve its order), which
  // already sorts book directories and chapter files deterministically —
  // filtering to one book preserves that same sequential order.
  const bookCards = cards.filter((c) => c.book_slug === readThroughBook);
  if (bookCards.length === 0) {
    throw new Error(`No cards found for read-through book "${readThroughBook}"`);
  }

  // Author weighting for The Wall (T05) is computed against the FULL,
  // unfiltered pools — a fixed correction reflecting the corpus's own
  // skew, not a moving target that drifts as cards get consumed week to
  // week.
  const wallAuthorWeightsMap = wallAuthorWeights(pools.question, pools.wall);

  // The weighted (slot 2) pools EXCLUDE the read-through book entirely. The
  // read-through advances through every one of that book's cards in strict
  // sequence regardless of gate/pool membership — if a weighted slot were
  // also allowed to independently draw one of that book's cards (it can
  // gate into Wall/Question/Objection like any other card), the
  // read-through's later sequential pointer could land on a card already
  // used by that earlier weighted slot, which is exactly the collision
  // "never reuse a card" forbids. Reserving the read-through book's cards
  // for the read-through alone avoids that by construction, not by
  // detecting the collision after the fact.
  const allUsed = new Set<string>(priorUsedCardIds);
  const wallPool = pools.wall.filter((e) => !allUsed.has(e.card_id) && e.book_slug !== readThroughBook);
  const questionPool = pools.question.filter((e) => !allUsed.has(e.card_id) && e.book_slug !== readThroughBook);
  const objectionPool = pools.objection.filter((e) => !allUsed.has(e.card_id) && e.book_slug !== readThroughBook);

  const slots: ScheduleSlot[] = [];
  let objectionUsedThisWeek = 0;
  let readThroughCursor = readThroughStartIndex;

  for (let day = 1; day <= 7; day++) {
    // Slot 1: the read-through. The CARD is always the next sequential card
    // of `readThroughBook`, independent of format weighting. The FORMAT is
    // NOT independent of weighting any more: it's drawn from `weights`
    // exactly like slot 2's (rng consumed here, first, so the per-day rng
    // order is fixed: read-through format draw, then slot 2's format draw,
    // then slot 2's card draw — required for byte-identical regeneration)
    // — UNLESS the caller forced a fixed `readThroughFormat`, in which case
    // no rng is consumed here at all and every read-through slot uses that
    // one format, throwing if a card can't render it.
    if (readThroughCursor >= bookCards.length) {
      throw new Error(
        `Read-through of "${readThroughBook}" is complete (${bookCards.length} cards) — ` +
          `cannot schedule day ${day} of week ${weekNumber}. Choose a new read-through book or stop generating weeks.`,
      );
    }
    const rtCard = bookCards[readThroughCursor];
    if (allUsed.has(rtCard.id)) {
      throw new Error(`Read-through card "${rtCard.id}" was already scheduled — read-through position is out of sync.`);
    }

    let rtFormat: ScheduleFormat;
    let rtContent: SlotContent;
    if (forcedReadThroughFormat !== undefined) {
      rtFormat = forcedReadThroughFormat;
      rtContent = readThroughContentOrThrow(rtFormat, rtCard);
    } else {
      const objectionAvailable = objectionUsedThisWeek < maxObjectionPerWeek;
      const rtAvailable = SCHEDULE_FORMATS.filter((f) => f !== "objection" || objectionAvailable);
      const rtCandidate = weightedFormatChoice(weights, rtAvailable, rng);
      const resolved = resolveReadThrough(rtCandidate, rtCard, objectionAvailable);
      rtFormat = resolved.format;
      rtContent = resolved.content;
      if (rtFormat === "objection") objectionUsedThisWeek += 1;
    }

    slots.push({
      day,
      slot: 1,
      card_id: rtCard.id,
      book_slug: rtCard.book_slug,
      author_slug: rtCard.author_slug,
      content: rtContent,
      read_through: true,
      read_through_counter: `Card ${readThroughCursor + 1} of ${bookCards.length}`,
    });
    allUsed.add(rtCard.id);
    readThroughCursor += 1;

    // Slot 2: the weighted format draw.
    const available = SCHEDULE_FORMATS.filter((f) => {
      if (f === "objection" && objectionUsedThisWeek >= maxObjectionPerWeek) return false;
      const pool = f === "wall" ? wallPool : f === "question" ? questionPool : objectionPool;
      return pool.some((e) => !allUsed.has(e.card_id));
    });
    if (available.length === 0) {
      throw new Error(`No format pool entries left to schedule day ${day} of week ${weekNumber} — pools exhausted.`);
    }
    const chosenFormat = weightedFormatChoice(weights, available, rng);

    let entry: WallEntry | QuestionEntry | ObjectionEntry;
    if (chosenFormat === "wall") {
      const remaining = wallPool.filter((e) => !allUsed.has(e.card_id));
      [entry] = selectWallBalanced(remaining, wallAuthorWeightsMap, 1, rng);
    } else if (chosenFormat === "question") {
      const remaining = questionPool.filter((e) => !allUsed.has(e.card_id));
      entry = uniformPick(remaining, rng);
    } else {
      const remaining = objectionPool.filter((e) => !allUsed.has(e.card_id));
      entry = uniformPick(remaining, rng);
      objectionUsedThisWeek += 1;
    }

    const card = cardsById.get(entry.card_id);
    if (!card) throw new Error(`Card "${entry.card_id}" from the ${chosenFormat} pool was not found in the corpus`);

    const content = contentFromEntry(chosenFormat, entry, card);
    slots.push({
      day,
      slot: 2,
      card_id: entry.card_id,
      book_slug: entry.book_slug,
      author_slug: entry.author_slug,
      content,
      read_through: false,
      read_through_counter: null,
    });
    allUsed.add(entry.card_id);
  }

  const formatCounts: Record<ScheduleFormat, number> = { wall: 0, question: 0, objection: 0 };
  for (const s of slots) formatCounts[s.content.format] += 1;

  const authorMixResult = combinedAuthorMix(slots.map((s) => ({ author_slug: s.author_slug })));

  return {
    week: weekNumber,
    seed,
    weights,
    read_through_book: readThroughBook,
    read_through_format: forcedReadThroughFormat ?? "dynamic",
    read_through_total: bookCards.length,
    max_objection_per_week: maxObjectionPerWeek,
    slots,
    format_counts: formatCounts,
    author_mix: authorMixResult,
    pool_source: poolSource,
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers (impure — the CLI's job, kept here for reuse/testing).
// ---------------------------------------------------------------------------

/**
 * Load the three format pools for scheduling. Reads the scored pool file
 * (`<premisesDir>/<format>.json`, written by `scripts/score-premises.ts`)
 * WHEN PRESENT; falls back to the mechanical gate output
 * (`rankWall`/`questionGate`/`objectionGate` from ./premises.ts) when it is
 * absent — this is what lets the schedule generator run today, before T11
 * has produced any scored pools, with no rework needed once it has.
 *
 * A scored Question/Objection pool file includes REJECTED rows too
 * (`scoreQuestionSurvivors`/`scoreObjectionSurvivors` merge every parsed
 * response regardless of verdict — see premises-batch.ts) — filtered here
 * to `drift_verdict === "answers"` / `rubric.verdict === "accept"` before
 * they're usable as a schedule pool. The Wall's scored pool carries no
 * verdict (every Wall candidate already survived the mechanical gate; the
 * rubric only scores/selects a landing line), so every scored Wall row is
 * used as-is.
 */
export async function loadFormatPools(
  premisesDir: string,
  gatePools: FormatPools,
): Promise<{ pools: FormatPools; source: Record<ScheduleFormat, "scored" | "gate-only"> }> {
  const source: Record<ScheduleFormat, "scored" | "gate-only"> = {
    wall: "gate-only",
    question: "gate-only",
    objection: "gate-only",
  };

  const wallPath = path.join(premisesDir, "wall.json");
  const questionPath = path.join(premisesDir, "question.json");
  const objectionPath = path.join(premisesDir, "objection.json");

  let wall: FormatPools["wall"] = gatePools.wall;
  let question: FormatPools["question"] = gatePools.question;
  let objection: FormatPools["objection"] = gatePools.objection;

  if (existsSync(wallPath)) {
    wall = JSON.parse(await readFile(wallPath, "utf-8"));
    source.wall = "scored";
  }
  if (existsSync(questionPath)) {
    const scored = JSON.parse(await readFile(questionPath, "utf-8")) as (QuestionEntry & { drift_verdict?: string })[];
    question = scored.filter((e) => e.drift_verdict === undefined || e.drift_verdict === "answers");
    source.question = "scored";
  }
  if (existsSync(objectionPath)) {
    const scored = JSON.parse(await readFile(objectionPath, "utf-8")) as (ObjectionEntry & { rubric?: { verdict?: string } })[];
    objection = scored.filter((e) => e.rubric === undefined || e.rubric.verdict === "accept");
    source.objection = "scored";
  }

  return { pools: { wall, question, objection }, source };
}

export interface PriorWeeksState {
  usedCardIds: Set<string>;
  /** How many read-through cards have already been consumed across all prior weeks (0 if none). */
  readThroughConsumed: number;
}

/**
 * Read every prior week's schedule file (`pilot-schedule-w01.json` ..
 * `pilot-schedule-w<week-1>.json`) from `dir` and derive the state the next
 * week's generation needs: every already-scheduled card id (so it can never
 * be reused) and how many read-through cards have been consumed so far (so
 * the next week resumes the sequence with no skip and no repeat). Missing
 * files are treated as "no prior weeks" (week 1 has none) rather than an
 * error.
 */
export async function loadPriorWeeks(dir: string, week: number): Promise<PriorWeeksState> {
  const usedCardIds = new Set<string>();
  let readThroughConsumed = 0;

  for (let w = 1; w < week; w++) {
    const filePath = path.join(dir, `pilot-schedule-w${String(w).padStart(2, "0")}.json`);
    if (!existsSync(filePath)) continue;
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as WeekSchedule;
    for (const slot of parsed.slots) {
      usedCardIds.add(slot.card_id);
      if (slot.read_through) readThroughConsumed += 1;
    }
  }

  return { usedCardIds, readThroughConsumed };
}
