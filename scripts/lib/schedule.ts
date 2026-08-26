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
 * the card can actually render. Wall used to always render (falling back to
 * the raw `plain_english` when no standalone landing line exists), which
 * guaranteed the cascade terminated — but F05 found that guarantee false:
 * the renderer's own gate (`social/src/remotion/wall-gate.ts`'s legibility
 * floor and F03's 59s duration ceiling) can still reject a card no matter
 * how its landing line is chosen. So Wall is now ALSO gated here, against
 * the renderer-published READ-THROUGH exclusion list (F06 —
 * `content/social/render-exclusions.json`'s `read_through` section, surveyed
 * with the read-through's own landing-line derivation; see `./exclusions.ts`
 * and `tryReadThroughContent`'s wall branch) — the cascade could in
 * principle exhaust all three weighted formats. F06 also gates the WEIGHTED
 * slot's Question and Objection pools the same way F05 gated Wall's — see
 * `loadFormatPools`'s own doc comment.
 *
 * F19: exhausting all three weighted formats is not just theoretical — the
 * pilot's default read-through slice (Meditations Books 2-3) has no
 * Question/Objection candidate anywhere in it, and the longest run of
 * consecutive Wall-renderable cards anywhere in the corpus (measured per
 * chapter) is 17, short of the 28 consecutive read-through days a 4-week
 * pilot needs. So `resolveReadThrough` now has a FOURTH, terminal step after
 * `READ_THROUGH_FALLBACK_ORDER` is exhausted: the STILL fallback
 * (`StillSlotContent` — the card's own `plain_english`, verbatim, motionless
 * — see `social/src/remotion/Still.tsx`). It is gated too (against
 * `content/social/render-exclusions.json`'s `still` section, surveyed by
 * `social/src/remotion/still-gate.ts`'s legibility floor), so only a card
 * that fails EVERY format — including Still — still produces the real
 * thrown error described above.
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
  DEFAULT_QUESTION_FRACTION,
  selectWallBalanced,
  selectLandingLine,
  questionGate,
  objectionGate,
  type AuthorMixEntry,
  type WallEntry,
  type RankedWallEntry,
  type QuestionEntry,
  type ObjectionEntry,
} from "./premises.js";
import { checkFaithfulness, passesStoppingPower } from "./premises-scoring.js";
import type { WallRubricResult } from "./premises-scoring.js";
import { parsePoolFile } from "./pool-file.js";
import { logger } from "./logger.js";
import { loadExclusions, type LoadedExclusions } from "./exclusions.js";

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
 * suggest — measured directly against Enchiridion's 70 cards (the pilot's
 * read-through book prior to T16's Meditations Books 2-3 default; the
 * mechanism itself is unchanged, only which book illustrates it), only 8 can
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
 *
 * F19: once every entry here has been tried and failed, `resolveReadThrough`
 * falls back ONE step further — to `"still"` (see `StillSlotContent`) — as
 * its terminal, unconditional-except-for-legibility step. `"still"` is
 * deliberately NOT a member of this list (and not a member of
 * `ScheduleFormat`/`SCHEDULE_FORMATS` at all): it is never drawn from
 * `weights`, never a candidate the weighted draw can pick, and never
 * available to slot 2 — only ever reached as the read-through cascade's
 * last resort.
 */
export const READ_THROUGH_FALLBACK_ORDER: readonly ScheduleFormat[] = ["wall", "question", "objection"];

export const DEFAULT_MAX_OBJECTION_PER_WEEK = 1;

/**
 * T21: Wall selection must respect T07's LLM rubric scores, not just the
 * mechanical gate — a scored `wall.json` carries `impenetrability_score`
 * and `landing_line_score` (both 1-5, see `WALL_SCORE_MIN`/`MAX` in
 * ./premises-scoring.js) per entry, but `generateWeek` never looked at
 * them; `selectWallBalanced` drew uniformly (weighted only by author) from
 * every gate survivor, including the ~24% the rubric itself already marked
 * weak. An entry counts as "strong" only when it clears BOTH axes — a
 * cleanly-cut landing line pulled from an original that doesn't actually
 * look impenetrable is still a weak Wall post, and vice versa.
 *
 * Measured over the real 896-entry scored pool
 * (`content/social/premises/wall.json`, T07/T08/T11's output):
 * `impenetrability_score` distribution `{2:1, 3:80, 4:579, 5:236}`,
 * `landing_line_score` distribution `{1:4, 2:53, 3:92, 4:363, 5:384}`.
 * `>= 4` on both axes covers 679 of 896 entries (~76%); the remaining 217
 * (~24%) are reserve — exactly the plan's own framing of the weak
 * remainder as RESERVE, not discarded (see the plan's T21 index note: "if
 * the wall reads as ordinary prose the viewer just does not bother").
 *
 * Exported (not inlined into `isStrongWallEntry`) so the threshold is
 * independently tunable and directly assertable in tests.
 */
export const WALL_STRONG_IMPENETRABILITY_MIN = 4;
export const WALL_STRONG_LANDING_LINE_MIN = 4;

/**
 * A Wall pool entry that MAY carry a scored rubric — the loose shape both
 * `RankedWallEntry` (gate-only, no rubric) and a scored `ScoredWallEntry`
 * (./premises-batch.js: `RankedWallEntry & { rubric: WallRubricResult }`)
 * satisfy, without importing the batch module here (schedule.ts has no
 * business depending on batch-orchestration types for a shape this small).
 */
export type WallPoolEntry = RankedWallEntry & { rubric?: Pick<WallRubricResult, "impenetrability_score" | "landing_line_score"> };

/**
 * True when a Wall pool entry is "strong" enough to draw from before
 * touching reserve (see `WALL_STRONG_IMPENETRABILITY_MIN`/
 * `WALL_STRONG_LANDING_LINE_MIN`'s doc comment for the threshold and its
 * measured coverage).
 *
 * An entry with NO `rubric` at all — the gate-only fallback pool
 * (`rankWall`'s raw output, used whenever `content/social/premises/
 * wall.json` is absent or empty — see `loadFormatPools`) — is treated as
 * eligible/strong BY DEFAULT, not as sub-strong: there is no rubric score
 * to fail, and the mechanical-gate path must keep scheduling normally with
 * zero LLM calls, exactly as it did before this task. Only a PRESENT
 * rubric that scores below either threshold demotes an entry to reserve.
 */
export function isStrongWallEntry(entry: WallPoolEntry): boolean {
  if (!entry.rubric) return true;
  return (
    entry.rubric.impenetrability_score >= WALL_STRONG_IMPENETRABILITY_MIN &&
    entry.rubric.landing_line_score >= WALL_STRONG_LANDING_LINE_MIN
  );
}

/**
 * T16: the pilot's default read-through, applied by `generateWeek` whenever
 * BOTH `readThroughBook` and `readThroughChapters` are omitted from
 * `GenerateWeekOptions` (see `generateWeek`'s own destructuring below) — and
 * mirrored in `scripts/generate-schedule.ts`'s CLI defaults (`--book`,
 * `--read-through-chapters`). Meditations Books 2-3 (48 cards: 20 + 28,
 * measured against the real corpus) replaces the original Enchiridion
 * default: Meditations has ~379,000 Goodreads ratings against the
 * Enchiridion's ~3,316 (~100x more recognised) and is the more universally
 * read gateway text; Book 1 is the atypical "Debts and Lessons"
 * acknowledgements list and would have made a weak 4+-week opening, so the
 * slice deliberately starts at Book 2. Passing EITHER option explicitly
 * (even `readThroughBook: "meditations"` alone, with no chapters) opts out
 * of this coupled default entirely and falls back to T15's own behavior —
 * an explicit book with no chapters reads that book in full — see
 * `generateWeek`'s default-resolution comment for exactly how the two
 * options are coupled.
 */
export const DEFAULT_READ_THROUGH_BOOK = "meditations";
export const DEFAULT_READ_THROUGH_CHAPTERS: string[] = ["book-02", "book-03"];

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

/**
 * F19: the read-through's FALLBACK format — never drawn from `weights`, and
 * never tried before Wall/Question/Objection (see `READ_THROUGH_FALLBACK_ORDER`
 * and `resolveReadThrough`'s own doc comments). `text` is the card's raw
 * `plain_english`, verbatim, in full — see `social/src/remotion/Still.tsx`.
 */
export interface StillSlotContent {
  format: "still";
  text: string;
}

export type SlotContent = WallSlotContent | QuestionSlotContent | ObjectionSlotContent | StillSlotContent;

/**
 * Every format `SlotContent.format` can actually be — the three WEIGHTED
 * formats (`ScheduleFormat`) plus the read-through-only `"still"` fallback
 * (F19). Kept distinct from `ScheduleFormat` because `"still"` is never
 * drawn from `weights`, never appears in `READ_THROUGH_FALLBACK_ORDER`, and
 * is structurally unreachable from the weighted (slot 2) draw — see
 * `resolveReadThrough`.
 */
export type RenderedFormat = ScheduleFormat | "still";

export interface ScheduleSlot {
  day: number; // 1-7
  slot: number; // 1-2 (slot 1 is always the read-through slot)
  card_id: string;
  book_slug: string;
  author_slug: AuthorSlug;
  content: SlotContent;
  read_through: boolean;
  /** e.g. "Card 5 of 48" (the default Meditations Books 2-3 slice — T16). `null` when `read_through` is false. */
  read_through_counter: string | null;
}

export interface WeekSchedule {
  week: number;
  seed: number;
  weights: FormatWeights;
  read_through_book: string;
  /**
   * The chapter slugs the read-through is sliced to (T15), in reading
   * order — omitted (not `null`) when the read-through covers the whole
   * book, so a whole-book schedule's JSON is byte-identical to a
   * pre-T15 one (`JSON.stringify` drops `undefined`-valued keys).
   */
  read_through_chapters?: string[];
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
  format_counts: Record<RenderedFormat, number>;
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
  /**
   * Read-through book slug. Optional (T16) — when omitted ALONG WITH
   * `readThroughChapters`, defaults to `DEFAULT_READ_THROUGH_BOOK`
   * ("meditations") sliced to `DEFAULT_READ_THROUGH_CHAPTERS` (Books 2-3, 48
   * cards). Supplying `readThroughBook` explicitly (with `readThroughChapters`
   * left unset) opts out of the coupled default and reads that book in full,
   * exactly as T15 always has — see `generateWeek`'s default-resolution
   * comment for the precise coupling rule.
   */
  readThroughBook?: string;
  /**
   * Optional slice of `readThroughBook`: chapter slugs (e.g. `["book-02",
   * "book-03"]`), in the order the read-through should walk them. When BOTH
   * this and `readThroughBook` are omitted, defaults to
   * `DEFAULT_READ_THROUGH_CHAPTERS` against `DEFAULT_READ_THROUGH_BOOK`
   * (T16's Meditations Books 2-3 default). When `readThroughBook` is given
   * explicitly but this is omitted, the read-through covers that book's
   * ENTIRE contents, in the corpus's own order — byte-identical to this
   * option not existing at all (see `buildReadThroughSequence`), unchanged
   * from T15. Every chapter named must actually exist in `readThroughBook`,
   * and the resulting slice must be non-empty — both throw a clear error
   * otherwise.
   */
  readThroughChapters?: string[];
  /** 0-based index into the read-through slice's sequential card list where this week should start. */
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
  /**
   * F06: the renderer-derived READ-THROUGH exclusion list — card ids of the
   * read-through's own book/chapter slice that `social/src/remotion/
   * wall-gate.ts`'s gate would reject, surveyed with the read-through's OWN
   * landing-line derivation (`selectLandingLine(card) ?? card.plain_english`
   * — see `content/social/render-exclusions.json`'s `read_through` section
   * and `./exclusions.ts`). Consulted ONLY by the read-through's wall
   * branch (`tryReadThroughContent`) so an un-renderable card is never
   * scheduled as Wall there — a read-through card is excluded from every
   * weighted pool entirely (see `readThroughCardIds` below), so the Wall
   * pool's own exclusion filtering (`loadFormatPools`) can never reach it;
   * this option exists specifically because that filtering can't. Optional:
   * leave undefined to run ungated, exactly as before F05/F06.
   */
  readThroughExclusions?: ReadonlySet<string>;
  /**
   * F19: the renderer-derived STILL-FALLBACK exclusion list — card ids of
   * the read-through's own book/chapter slice that `social/src/remotion/
   * still-gate.ts`'s legibility gate would reject (surveyed against each
   * card's raw `plain_english` — see `content/social/render-exclusions.json`'s
   * `still` section and `./exclusions.ts`). Consulted ONLY as the terminal
   * step of the read-through's fallback cascade (`resolveReadThrough`),
   * after `READ_THROUGH_FALLBACK_ORDER` is exhausted — a card excluded here
   * has no format left to fall back to, and the cascade throws. Optional:
   * leave undefined to run the Still fallback ungated (every card accepted),
   * exactly like `readThroughExclusions` defaults to ungated.
   */
  stillExclusions?: ReadonlySet<string>;
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

/**
 * Reassemble an Objection's reply DIRECTLY from the card's own
 * `plain_english` text: the exact remainder of the text after the quoted
 * objection closes, trimmed. Never trusts a persisted `reply` field
 * (whether from a gate-only pool or a scored pool file written to disk) —
 * `objectionGate`'s own `reply` is a whitespace-normalising re-join of
 * `sentences()`'s output (`sents.slice(i + 1).join(" ")`) that is only a
 * verbatim substring of `plain_english` by accident of this corpus's
 * current formatting (see M4 in the PR #39 review). Slicing the raw string
 * directly, instead of re-stitching trimmed sentence chunks, makes the
 * result an exact substring BY CONSTRUCTION, not by coincidence — so it can
 * never silently drift from faithful as the corpus's formatting evolves.
 *
 * Slices from `entry.reply_start` — the offset `objectionGate` itself
 * recorded for the SPECIFIC occurrence this entry matched — rather than
 * re-searching `plain_english` with `indexOf`. `indexOf` always resolves to
 * the FIRST occurrence of the quoted span, which silently produces the
 * wrong reply (the text following an EARLIER repeat of the same quote,
 * rather than the one this entry actually refers to) when a card quotes the
 * same objection more than once — and because that wrong text is still a
 * verbatim substring of `plain_english`, `assertFaithful` cannot catch it
 * (see M8 in the PR #39 second review round). Slicing from the offset the
 * gate already computed while walking the card is correct by construction,
 * with no search at all.
 *
 * Still verifies the quoted span is present at all (a hand-built/tampered
 * entry, or one whose card no longer contains the quote it names, has no
 * valid `reply_start` to trust) — this is the one case where we do fall
 * back to a defensive `includes` check, purely to fail loud rather than
 * slice a meaningless offset.
 */
function assembleObjectionReply(card: Card, entry: Pick<ObjectionEntry, "objection" | "reply_start">): string {
  const quoted = `"${entry.objection}"`;
  if (!card.plain_english.includes(quoted)) {
    throw new Error(
      `Objection "${entry.objection}" for card "${card.id}" is not a verbatim quoted span (with its surrounding ` +
        `quote marks) in plain_english — cannot assemble a faithful reply.`,
    );
  }
  if (!Number.isInteger(entry.reply_start) || entry.reply_start < 0) {
    throw new Error(
      `Objection entry for card "${card.id}" (objection "${entry.objection}") is missing a valid reply_start ` +
        `offset — cannot assemble a faithful reply.`,
    );
  }
  return card.plain_english.slice(entry.reply_start).trim();
}

/**
 * Build a slot's on-screen fields from an already-gated/scored pool entry
 * (the normal, weighted-slot path).
 *
 * Wall prefers the LLM rubric's `chosen_landing_line` (T07's scored pick)
 * over the mechanical `landing_line` when a scored pool provided one —
 * otherwise a scored `wall.json` would produce byte-identical posts to the
 * gate-only fallback and T11's Wall rubric calls would buy nothing (see M5
 * in the PR #39 review). Falls back to the mechanical line when no rubric
 * is present (the gate-only path, or a scored pool that for some reason
 * omits it).
 */
function contentFromEntry(format: ScheduleFormat, entry: WallEntry | QuestionEntry | ObjectionEntry, card: Card): SlotContent {
  switch (format) {
    case "wall": {
      const w = entry as WallEntry & { rubric?: { chosen_landing_line?: string } };
      const landingLine = w.rubric?.chosen_landing_line ?? w.landing_line;
      return { format: "wall", original_excerpt: card.original_excerpt, landing_line: landingLine };
    }
    case "question": {
      const q = entry as QuestionEntry;
      return { format: "question", question: q.question, answer: q.answer };
    }
    case "objection": {
      const o = entry as ObjectionEntry;
      return { format: "objection", objection: o.objection, reply: assembleObjectionReply(card, o) };
    }
  }
}

/**
 * Build a read-through slot's on-screen fields DIRECTLY from the raw card —
 * the read-through must advance through every card in the book with no
 * skips, so it cannot depend on gate/pool membership. "wall" does NOT
 * always render (F05, tightened by T02): every card has `original_excerpt`
 * and `plain_english`, but when `selectLandingLine` finds no qualifying
 * standalone sentence (some short Enchiridion cards won't), this now returns
 * `null` rather than falling back to the full `plain_english` text — the
 * plan's decision is explicit: "No qualifying landing line -> the card is
 * not a Wall. It becomes a Still" (never a wall whose "one still sentence"
 * payoff is actually the whole passage). Separately, even a card WITH a
 * qualifying landing line can still be rejected by the renderer's own gate
 * (`social/src/remotion/wall-gate.ts`'s legibility floor and F03's 59s
 * duration ceiling), so `readThroughExclusions` (the renderer-derived
 * read-through exclusion list loaded from `content/social/
 * render-exclusions.json`'s `read_through` section — see `./exclusions.ts`)
 * is consulted first: a card on that list returns
 * `null` here too, exactly like an unsupported question/objection
 * candidate, instead of scheduling a slot the renderer cannot actually
 * produce. "question"/"objection" return `null` — rather than fabricating
 * content — when the specific card has no natural candidate for that format
 * (e.g. not every Enchiridion card poses a self-contained question); per
 * the plan's "nothing fabricated, ever" rule, presenting non-question text
 * as a question is not an option here. Callers decide what a `null` means:
 * `resolveReadThrough` treats it as "try the next format in the fallback
 * order" (terminating, if every weighted format returns `null`, at F19's
 * STILL fallback); `readThroughContentOrThrow` (the forced-override path)
 * treats it as a hard error. `readThroughExclusions` is optional and
 * defaults to `undefined` (no exclusions applied) — a checkout with no
 * `render-exclusions.json` on disk behaves exactly as before F05/F06.
 */
function tryReadThroughContent(
  format: ScheduleFormat,
  card: Card,
  readThroughExclusions?: ReadonlySet<string>,
): SlotContent | null {
  switch (format) {
    case "wall": {
      if (readThroughExclusions?.has(card.id)) return null;
      // T02 (social pilot 02a): no more `?? card.plain_english` fallback — a
      // card with no qualifying landing line is not a Wall at all (the
      // plan's decision: "No qualifying landing line -> the card is not a
      // Wall. It becomes a Still."). Returning `null` here routes the card
      // through the same fallback cascade an unsupported question/objection
      // candidate already uses (`resolveReadThrough`), terminating at the
      // Still fallback (F19) rather than rendering the whole passage as the
      // "one still sentence" payoff.
      const landingLine = selectLandingLine(card);
      if (!landingLine) return null;
      return { format: "wall", original_excerpt: card.original_excerpt, landing_line: landingLine };
    }
    case "question": {
      // Route through the full T04 gate (mechanical candidate + layer (a) +
      // layer (b)), not just the raw mechanical `findQuestionCandidate` —
      // the mechanical candidate alone can select a question with an
      // unresolved reference, a mid-thought opener, or an answer that's
      // itself another question, all of which layer (a)/(b) exist to catch
      // (see M2 in the PR #39 review). `questionGate` returns only
      // survivors, so a `null` here means "no valid candidate", letting the
      // caller's fallback cascade try the next format.
      const [gated] = questionGate([card]);
      if (!gated) return null;
      return { format: "question", question: gated.question, answer: gated.answer };
    }
    case "objection": {
      const [found] = objectionGate([card]);
      if (!found) return null;
      // An objection whose reply is empty (the quoted line is the very
      // last thing said in the card) has no answer to show — the format's
      // whole point is objection THEN reply, so this isn't a valid
      // candidate either (see M3 in the PR #39 review).
      const reply = assembleObjectionReply(card, found);
      if (!reply) return null;
      return { format: "objection", objection: found.objection, reply };
    }
  }
}

/**
 * The forced-override path (`GenerateWeekOptions.readThroughFormat` set
 * explicitly): every read-through slot must render as exactly this format,
 * so a card that can't is a hard error rather than a silent fallback — the
 * caller asked for one format specifically, not "whatever works."
 */
function readThroughContentOrThrow(
  format: ScheduleFormat,
  card: Card,
  readThroughExclusions?: ReadonlySet<string>,
): SlotContent {
  const content = tryReadThroughContent(format, card, readThroughExclusions);
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
 * cap already reached). Before F05, Wall always rendered, so this cascade
 * always terminated; now that `tryReadThroughContent`'s wall branch can
 * also return `null` (a card on `readThroughExclusions`), the cascade could
 * in principle exhaust all three weighted formats — F19 gives it one more
 * place to go before that becomes a hard failure: the STILL FALLBACK
 * (below), the terminal step of this cascade. A card that clears NONE of
 * Wall/Question/Objection still renders — as its own `plain_english`,
 * verbatim, motionless (see `social/src/remotion/Still.tsx`) — so "Card N of
 * 48" stays literally true and no read-through card is ever skipped. Only a
 * card the Still's OWN legibility gate also rejects (`stillExclusions`, an
 * expected-to-be-empty edge case — see `still-gate.ts`) still throws.
 */
function resolveReadThrough(
  candidate: ScheduleFormat,
  card: Card,
  objectionAvailable: boolean,
  readThroughExclusions?: ReadonlySet<string>,
  stillExclusions?: ReadonlySet<string>,
): { format: RenderedFormat; content: SlotContent } {
  const order = [candidate, ...READ_THROUGH_FALLBACK_ORDER.filter((f) => f !== candidate)];
  for (const format of order) {
    if (format === "objection" && !objectionAvailable) continue;
    const content = tryReadThroughContent(format, card, readThroughExclusions);
    if (content) return { format, content };
  }

  // F19: THE STILL FALLBACK — reached ONLY here, after every weighted
  // format has been tried and failed. Never drawn from `weights`, never a
  // candidate itself — see `RenderedFormat`'s and `StillSlotContent`'s own
  // doc comments. `text` is the card's raw `plain_english`, verbatim, never
  // sliced or reworded — faithful by construction, not merely checked.
  if (!stillExclusions?.has(card.id)) {
    return { format: "still", content: { format: "still", text: card.plain_english } };
  }

  throw new Error(
    `Read-through card "${card.id}" could not render any format, including the STILL fallback — Wall/Question/` +
      `Objection are all excluded or have no candidate, and the renderer's still-gate.ts legibility floor also ` +
      `rejects this card's plain_english (content/social/render-exclusions.json's "still" section). Choose a ` +
      `different read-through book/chapter slice, or regenerate the corpus/exclusion list.`,
  );
}

/**
 * The on-screen content fields to faithfulness-check for a given slot's
 * content, keyed by field name (used in the thrown error message when a
 * check fails). `original_excerpt` is deliberately excluded — it's copied
 * straight from `card.original_excerpt` (see `contentFromEntry`/
 * `tryReadThroughContent`'s wall cases), never derived, so it can never be
 * unfaithful.
 */
function contentFieldsToCheck(content: SlotContent): [field: string, text: string][] {
  switch (content.format) {
    case "wall":
      return [["landing_line", content.landing_line]];
    case "question":
      return [
        ["question", content.question],
        ["answer", content.answer],
      ];
    case "objection":
      return [
        ["objection", content.objection],
        ["reply", content.reply],
      ];
    case "still":
      return [["text", content.text]];
  }
}

/**
 * THE CENTRAL SAFETY PROPERTY: every word posted under a real author's name
 * must be traceable to that author's own card (`plain_english` or
 * `original_excerpt`). Run mechanically, right before a slot is committed —
 * not just at scoring time (T09) — because a slot's final on-screen text is
 * assembled here (from a pool entry, a scored rubric's chosen line, or the
 * read-through's own raw-card derivation) and nothing upstream of this point
 * re-checks it once assembled (see M4 in the PR #39 review). Throws naming
 * the day, slot, card id, and specific field that failed.
 */
function assertFaithful(card: Card, content: SlotContent, day: number, slotNumber: number): void {
  for (const [field, text] of contentFieldsToCheck(content)) {
    // An empty on-screen field is never a valid post (see M9 in the PR #39
    // second review round) — it used to be treated as "trivially a
    // substring of anything, nothing to check" and silently skipped, which
    // let an empty `reply` slip through undetected (reproduced as
    // `{"format":"objection","objection":"...","reply":""}`, precisely the
    // empty-reply post M3 was supposed to prevent). Failing here, rather
    // than skipping, makes this the last line of defense even if an empty
    // string somehow reaches this point despite upstream pool filtering.
    if (!text) {
      throw new Error(
        `Faithfulness check failed for day ${day} slot ${slotNumber} (card "${card.id}", field "${field}"): ` +
          `field is empty — an empty on-screen field is never a valid post.`,
      );
    }
    const result = checkFaithfulness(text, card);
    if (!result.faithful) {
      throw new Error(
        `Faithfulness check failed for day ${day} slot ${slotNumber} (card "${card.id}", field "${field}"): ${result.reason}`,
      );
    }
  }
}

/**
 * T15: build the read-through's card sequence — either the ENTIRE book
 * (when `chapters` is omitted, today's behavior, unchanged) or a SLICE of it
 * (a caller-supplied chapter list, in the order given). Ordered by chapter
 * order then `card_number` within each chapter — never a string sort on
 * card id — mirroring T13's own `trueReadingOrder` test helper
 * (schedule.test.ts), which independently verifies this is the book's true
 * reading order for the real corpus.
 *
 * The no-`chapters` branch deliberately returns the exact same expression
 * (`cards.filter((c) => c.book_slug === bookSlug)`) `generateWeek` has
 * always used, rather than re-deriving an equivalent chapter-order sort —
 * T15's own constraint is that omitting the new option must be
 * BYTE-IDENTICAL to today, and reusing the untouched expression guarantees
 * that by construction instead of by argument.
 *
 * Throws when the book has no cards at all, when a named chapter doesn't
 * exist in the book, or when the resulting slice is empty (including an
 * explicit empty `chapters` array).
 */
function buildReadThroughSequence(cards: Card[], bookSlug: string, chapters?: string[]): Card[] {
  const bookCards = cards.filter((c) => c.book_slug === bookSlug);
  if (bookCards.length === 0) {
    throw new Error(`No cards found for read-through book "${bookSlug}"`);
  }
  if (chapters === undefined) {
    return bookCards;
  }

  const byChapter = new Map<string, Card[]>();
  for (const c of bookCards) {
    if (!byChapter.has(c.chapter_slug)) byChapter.set(c.chapter_slug, []);
    byChapter.get(c.chapter_slug)!.push(c);
  }

  const sequence: Card[] = [];
  for (const chapterSlug of chapters) {
    const group = byChapter.get(chapterSlug);
    if (!group || group.length === 0) {
      throw new Error(
        `Unknown chapter "${chapterSlug}" for read-through book "${bookSlug}" — available chapters: ` +
          `${[...byChapter.keys()].join(", ")}`,
      );
    }
    sequence.push(...[...group].sort((a, b) => a.card_number - b.card_number));
  }

  if (sequence.length === 0) {
    throw new Error(
      `Read-through slice for book "${bookSlug}" with chapters [${chapters.join(", ")}] is empty.`,
    );
  }

  return sequence;
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
    readThroughBook: readThroughBookOption,
    readThroughChapters: readThroughChaptersOption,
    readThroughStartIndex,
    weights = DEFAULT_FORMAT_WEIGHTS,
    readThroughFormat: forcedReadThroughFormat,
    maxObjectionPerWeek = DEFAULT_MAX_OBJECTION_PER_WEEK,
    readThroughExclusions,
    stillExclusions,
  } = options;

  // T16: `readThroughBook` and `readThroughChapters` default TOGETHER, only
  // when BOTH are omitted — Meditations Books 2-3 (see
  // `DEFAULT_READ_THROUGH_BOOK`/`DEFAULT_READ_THROUGH_CHAPTERS`'s own doc
  // comments for the full rationale). Supplying `readThroughBook` alone
  // (any value, including "meditations") opts out of the coupled default and
  // reads that book in full — T15's unchanged behavior — rather than
  // silently reapplying the Books 2-3 slice to whatever book was named.
  const readThroughBook = readThroughBookOption ?? DEFAULT_READ_THROUGH_BOOK;
  const readThroughChapters =
    readThroughChaptersOption ?? (readThroughBookOption === undefined ? [...DEFAULT_READ_THROUGH_CHAPTERS] : undefined);

  const rng = createSeededRng(seed);
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  // The read-through's card sequence, in strict order — the whole book by
  // default, or a caller-supplied chapter slice (T15). See
  // `buildReadThroughSequence`'s own doc comment for why the no-`chapters`
  // path is guaranteed byte-identical to `generateWeek`'s pre-T15 behavior.
  const bookCards = buildReadThroughSequence(cards, readThroughBook, readThroughChapters);

  // T15: exclude the read-through's cards from the weighted pools BY CARD
  // ID, not by `book_slug` — a book-slug exclusion would strip every card
  // in `readThroughBook` from the Wall/Question/Objection pools even when
  // the read-through only covers a SLICE of that book (e.g. two chapters of
  // Meditations), which would silently destroy T05's author balancing (Wall
  // weights marcus-aurelius at ~0.43, and Meditations is the Wall's best
  // material). See the module doc comment and the `M16`/T15 tests below.
  const readThroughCardIds = new Set(bookCards.map((c) => c.id));

  // Author weighting for The Wall (T05, extended by T17) is computed
  // against the FULL, unfiltered pools — a fixed correction reflecting the
  // corpus's own skew, not a moving target that drifts as cards get
  // consumed week to week.
  //
  // T17: the read-through's author is now FIXED (T16 moved it onto
  // Meditations), so Wall's correction must target the COMBINED 14-slot
  // mix (7 read-through + 7 free slots), not the free slots alone — see
  // `ReadThroughShareContext`'s doc comment in ./premises.ts for why
  // treating the free slots as the whole week double-counts the
  // read-through's author. `readThroughAuthor` is read straight off the
  // read-through's own sequence (`bookCards[0]`) rather than hardcoded,
  // since every card in a single read-through book shares one author by
  // construction. `readThroughSlotShare` is 7/14 = 0.5 for the pilot's
  // fixed 7-day, 2-slot-per-day week (1 read-through slot + 1 free slot per
  // day) — not derived from `weights`, because the read-through's slot
  // COUNT is fixed by the day loop below regardless of format weighting;
  // only its rendered FORMAT is drawn from `weights`. `freeSlotFormatShare`
  // IS derived from `weights` (this week's actual format weights, which may
  // differ from `DEFAULT_FORMAT_WEIGHTS` via CLI overrides) so the
  // correction stays accurate if a future week's weights change.
  const readThroughAuthor = bookCards[0].author_slug;
  const readThroughSlotShare = 0.5;
  const formatWeightTotal = weights.wall + weights.question + weights.objection;
  const freeSlotFormatShare =
    formatWeightTotal > 0
      ? { wall: weights.wall / formatWeightTotal, question: weights.question / formatWeightTotal, objection: weights.objection / formatWeightTotal }
      : undefined;
  const wallAuthorWeightsMap = wallAuthorWeights(pools.question, pools.wall, DEFAULT_QUESTION_FRACTION, {
    author: readThroughAuthor,
    slotShare: readThroughSlotShare,
    objectionPool: pools.objection,
    freeSlotFormatShare,
  });

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
  const wallPool = pools.wall.filter((e) => !allUsed.has(e.card_id) && !readThroughCardIds.has(e.card_id));
  const questionPool = pools.question.filter((e) => !allUsed.has(e.card_id) && !readThroughCardIds.has(e.card_id));
  // Excludes entries whose reply is empty/whitespace-only — the format's
  // whole point is objection THEN reply, so one with nothing to answer it
  // isn't a valid candidate at all (see M3 in the PR #39 review). Filtered
  // out of the pool itself, not just skipped after being drawn, so it never
  // consumes an rng draw and never displaces a valid entry's chance of
  // being picked.
  //
  // Tests the ASSEMBLED reply (`assembleObjectionReply`, with the card in
  // hand), not the entry's own persisted `reply` field. A scored
  // `objection.json` written before a later corpus edit can carry a
  // persisted `reply` that no longer matches what actually renders — this
  // filter must agree with what the slot will actually show, or a
  // once-empty-but-now-populated (or once-populated-but-now-empty) `reply`
  // field silently diverges from what's scheduled (see M9 in the PR #39
  // second review round).
  const objectionPool = pools.objection.filter((e) => {
    if (allUsed.has(e.card_id) || readThroughCardIds.has(e.card_id)) return false;
    const entryCard = cardsById.get(e.card_id);
    if (!entryCard) throw new Error(`Card "${e.card_id}" from the objection pool was not found in the corpus`);
    return assembleObjectionReply(entryCard, e).length > 0;
  });

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

    let rtFormat: RenderedFormat;
    let rtContent: SlotContent;
    if (forcedReadThroughFormat !== undefined) {
      rtFormat = forcedReadThroughFormat;
      rtContent = readThroughContentOrThrow(rtFormat, rtCard, readThroughExclusions);
    } else {
      const objectionAvailable = objectionUsedThisWeek < maxObjectionPerWeek;
      const rtAvailable = SCHEDULE_FORMATS.filter((f) => f !== "objection" || objectionAvailable);
      const rtCandidate = weightedFormatChoice(weights, rtAvailable, rng);
      const resolved = resolveReadThrough(rtCandidate, rtCard, objectionAvailable, readThroughExclusions, stillExclusions);
      rtFormat = resolved.format;
      rtContent = resolved.content;
      if (rtFormat === "objection") objectionUsedThisWeek += 1;
    }

    assertFaithful(rtCard, rtContent, day, 1);

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
      // T21: draw from the STRONG subset first (both rubric scores >= the
      // named threshold, or no rubric at all — see `isStrongWallEntry`);
      // fall back to reserve only once strong is exhausted (which, because
      // `wallPool` already excludes every card used in a prior week via
      // `allUsed`/`priorUsedCardIds`, naturally accounts for strong entries
      // consumed across accumulated prior weeks too, not just this one).
      // Both branches call `selectWallBalanced` exactly once with exactly
      // one requested entry — same as before this task — so this consumes
      // the same fixed number of rng draws (2: one author roulette pick,
      // one within-bucket index pick) regardless of which pool it draws
      // from, preserving byte-identical regeneration from a seed.
      const remaining = wallPool.filter((e) => !allUsed.has(e.card_id));
      const strongRemaining = remaining.filter(isStrongWallEntry);
      let wallSourcePool = strongRemaining;
      if (strongRemaining.length === 0) {
        const reserveRemaining = remaining.filter((e) => !isStrongWallEntry(e));
        logger.warn(
          `generateWeek: Wall strong pool exhausted for week ${weekNumber} day ${day} — 0 strong entries remain; ` +
            `falling back to ${reserveRemaining.length} reserve entr${reserveRemaining.length === 1 ? "y" : "ies"}.`,
        );
        wallSourcePool = reserveRemaining;
      }
      [entry] = selectWallBalanced(wallSourcePool, wallAuthorWeightsMap, 1, rng);
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
    assertFaithful(card, content, day, 2);
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

  const formatCounts: Record<RenderedFormat, number> = { wall: 0, question: 0, objection: 0, still: 0 };
  for (const s of slots) formatCounts[s.content.format] += 1;

  const authorMixResult = combinedAuthorMix(slots.map((s) => ({ author_slug: s.author_slug })));

  return {
    week: weekNumber,
    seed,
    weights,
    read_through_book: readThroughBook,
    read_through_chapters: readThroughChapters,
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
 * (`<premisesDir>/<format>.json`, written by `scripts/score-premises.ts` via
 * `./pool-file.ts`'s `writePoolFile`) WHEN PRESENT AND NON-EMPTY; falls back
 * to the mechanical gate output (`rankWall`/`questionGate`/`objectionGate`
 * from ./premises.ts) both when the file is absent (T11 hasn't run yet) and
 * when it parses to zero entries (T19 — see below) — this is what lets the
 * schedule generator run today, before T11 has produced any scored pools,
 * with no rework needed once it has.
 *
 * `parsePoolFile` (./pool-file.ts) reads either on-disk shape: a bare JSON
 * array (legacy — every pool written before T19, and every fixture
 * `schedule.test.ts` hand-writes) or the current `{ meta, entries }`
 * envelope.
 *
 * T19 (empty-pool defense in depth): `score-premises.ts` now refuses to
 * WRITE a pool file for a run that produced zero scored entries (see
 * `writePoolFile`'s zero-successes branch), so this fallback should be
 * unreachable in normal operation going forward. It stays here anyway as a
 * second, independent line of defense — a present-but-EMPTY pool file
 * (however it got that way: a manual edit, a pre-T19 leftover, a bug
 * elsewhere) is treated exactly like an ABSENT one, falling back to the
 * mechanical gates, rather than being accepted as a real empty pool that
 * would otherwise make `generateWeek` die with "pools exhausted" the moment
 * every mechanical-gate survivor for that format has already been used.
 *
 * A scored Question/Objection pool file includes REJECTED rows too
 * (`scoreQuestionSurvivors`/`scoreObjectionSurvivors` merge every parsed
 * response regardless of verdict — see premises-batch.ts) — filtered here
 * to `drift_verdict === "answers"` / `rubric.verdict === "accept"` before
 * they're usable as a schedule pool. FAILS CLOSED: a row missing the field
 * entirely is EXCLUDED, not admitted — a truncated write or a renamed field
 * must never silently promote a `drifts`/`dramatized_scene`/
 * `doctrinal_dispute` row into the posting pool (see M6 in the PR #39
 * review). Excluded rows are logged (to stderr) by card id so a real schema
 * problem is visible rather than silently shrinking the pool. The Wall's
 * scored pool carries no verdict (every Wall candidate already survived the
 * mechanical gate; the rubric only scores/selects a landing line), so every
 * scored Wall row is used as-is.
 *
 * T22: the Question pool ALSO requires `passesStoppingPower(entry)` — a
 * SECOND, independent gate on top of `drift_verdict === "answers"`, not a
 * replacement for it. Drift ("does the following sentence answer the
 * question") and stopping power ("is this pair worth posting at all" — see
 * `./premises-scoring.ts`'s `QuestionRubricResult` doc comment) are
 * deliberately kept as two separate checks so a row can fail either one
 * independently; both must pass for a row to reach the schedule. Same
 * fail-closed contract as `drift_verdict` above: a row missing any of the
 * three T22 boolean fields (e.g. a pre-T22 pool file scored before this
 * dimension existed) is EXCLUDED, never admitted by default —
 * `passesStoppingPower` itself enforces strict `=== true` for exactly this
 * reason.
 */
/**
 * `exclusionsPath` (F05/F06): the renderer-derived exclusion list —
 * `content/social/render-exclusions.json`, written by
 * `social/scripts/write-exclusions.ts` by running each format's own
 * renderer gate (`social/src/remotion/wall-gate.ts`, `question-gate.ts`,
 * `objection-gate.ts`) over its scored pool. Optional and absent-tolerant
 * BY DESIGN: passing `undefined`, or a path that doesn't exist on disk,
 * runs every format ungated (a warning is logged either way, so running
 * ungated is visible, not silent) — no test or caller is required to have
 * this file present. When it IS present, every excluded id is dropped from
 * its OWN format's pool here, once, so a card the renderer would refuse to
 * render can never reach the weighted slot draw in `generateWeek` in the
 * first place (F05 fixed this for Wall alone — matching the
 * `on-anger-03-027` week-1 failure; F06 extends it to Question and
 * Objection — matching `discourses-50-008`, a 13-word question the pool's
 * own flags all pass but the renderer's still-format word-count floor
 * rejects). The artifact's `read_through` section is NOT applied here —
 * see `GenerateWeekOptions.readThroughExclusions` and
 * `tryReadThroughContent` for why the read-through needs a separately
 * surveyed set. See `./exclusions.ts`.
 */
export async function loadFormatPools(
  premisesDir: string,
  gatePools: FormatPools,
  exclusionsPath?: string,
): Promise<{
  pools: FormatPools;
  source: Record<ScheduleFormat, "scored" | "gate-only">;
  /** `null` when no exclusion file was found (ungated) — see `exclusionsPath`'s doc comment above. */
  exclusions: LoadedExclusions | null;
}> {
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
    const { entries } = parsePoolFile<FormatPools["wall"][number]>(JSON.parse(await readFile(wallPath, "utf-8")));
    if (entries.length > 0) {
      wall = entries;
      source.wall = "scored";
    } else {
      console.warn(`loadFormatPools: "${wallPath}" has zero entries — falling back to the mechanical gate output.`);
    }
  }
  if (existsSync(questionPath)) {
    const { entries: scored } = parsePoolFile<
      QuestionEntry & {
        drift_verdict?: string;
        standalone_intelligible?: boolean;
        answer_has_substance?: boolean;
        modern_premise?: boolean;
      }
    >(JSON.parse(await readFile(questionPath, "utf-8")));
    if (scored.length > 0) {
      question = scored.filter((e) => {
        if (e.drift_verdict !== "answers") {
          console.warn(
            `loadFormatPools: excluding Question pool row for card "${e.card_id}" — drift_verdict is ` +
              `${JSON.stringify(e.drift_verdict)} (expected "answers").`,
          );
          return false;
        }
        if (!passesStoppingPower(e)) {
          console.warn(
            `loadFormatPools: excluding Question pool row for card "${e.card_id}" — failed stopping power ` +
              `(standalone_intelligible=${JSON.stringify(e.standalone_intelligible)}, ` +
              `answer_has_substance=${JSON.stringify(e.answer_has_substance)}, ` +
              `modern_premise=${JSON.stringify(e.modern_premise)}).`,
          );
          return false;
        }
        return true;
      });
      source.question = "scored";
    } else {
      console.warn(`loadFormatPools: "${questionPath}" has zero entries — falling back to the mechanical gate output.`);
    }
  }
  if (existsSync(objectionPath)) {
    const { entries: scored } = parsePoolFile<ObjectionEntry & { rubric?: { verdict?: string } }>(
      JSON.parse(await readFile(objectionPath, "utf-8")),
    );
    if (scored.length > 0) {
      objection = scored.filter((e) => {
        if (e.rubric?.verdict === "accept") return true;
        console.warn(
          `loadFormatPools: excluding Objection pool row for card "${e.card_id}" — rubric.verdict is ` +
            `${JSON.stringify(e.rubric?.verdict)} (expected "accept").`,
        );
        return false;
      });
      source.objection = "scored";
    } else {
      console.warn(`loadFormatPools: "${objectionPath}" has zero entries — falling back to the mechanical gate output.`);
    }
  }

  // F05/F06: drop any pool entry the renderer's OWN gate has already
  // rejected, regardless of whether a format's pool above came from a
  // scored pool file or the mechanical gate fallback — an excluded card is
  // un-renderable either way, for every format, not just Wall.
  const exclusions = exclusionsPath ? await loadExclusions(exclusionsPath) : null;
  if (exclusions === null) {
    console.warn(
      `loadFormatPools: no exclusions file${exclusionsPath ? ` at "${exclusionsPath}"` : ""} — running every ` +
        `format UNGATED. The scheduler may draw a card the renderer's own gate (Wall's legibility floor / F03's ` +
        `59s duration ceiling; Question's word-count/legibility floor; Objection's two-sentence cap/legibility ` +
        `floor) will reject at render time. Run "npx tsx social/scripts/write-exclusions.ts --date <date>" to ` +
        `generate it.`,
    );
  } else {
    const dropExcluded = <T extends { card_id: string }>(formatLabel: string, entries: T[], excluded: Set<string>): T[] => {
      if (excluded.size === 0) return entries;
      const before = entries.length;
      const filtered = entries.filter((e) => !excluded.has(e.card_id));
      const dropped = before - filtered.length;
      if (dropped > 0) {
        console.warn(
          `loadFormatPools: dropped ${dropped} ${formatLabel} pool entr${dropped === 1 ? "y" : "ies"} excluded ` +
            `by the renderer's gate (${exclusionsPath}) — an un-renderable card is never scheduled.`,
        );
      }
      return filtered;
    };
    wall = dropExcluded("Wall", wall, exclusions.wall);
    question = dropExcluded("Question", question, exclusions.question);
    objection = dropExcluded("Objection", objection, exclusions.objection);
  }

  return { pools: { wall, question, objection }, source, exclusions };
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
 * the next week resumes the sequence with no skip and no repeat).
 *
 * Week 1 has no prior weeks at all (the loop below never runs), which is the
 * ONLY legitimate reason a file is absent. Any OTHER missing file — e.g.
 * w02 absent while generating week 4 — is refused with a named error rather
 * than silently treated as "no prior week": that would re-open the exact
 * card ids and read-through position w02 already consumed, producing
 * duplicate posts and rewinding the read-through counter (see M1 in the PR
 * #39 review). A prior-week file that parses but carries a missing,
 * non-array, or empty `slots` is refused the same way, as corrupt.
 */
export async function loadPriorWeeks(dir: string, week: number): Promise<PriorWeeksState> {
  const usedCardIds = new Set<string>();
  let readThroughConsumed = 0;

  for (let w = 1; w < week; w++) {
    const fileName = `pilot-schedule-w${String(w).padStart(2, "0")}.json`;
    const filePath = path.join(dir, fileName);
    if (!existsSync(filePath)) {
      throw new Error(
        `Missing prior week schedule "${fileName}" in "${dir}" — week ${week} cannot be generated without every ` +
          `earlier week's schedule on disk (w01..w${String(week - 1).padStart(2, "0")}). Generate week ${w} first, ` +
          `or restore its file if it was moved/deleted.`,
      );
    }
    const parsed = JSON.parse(await readFile(filePath, "utf-8")) as WeekSchedule;
    if (!Array.isArray(parsed.slots) || parsed.slots.length === 0) {
      throw new Error(
        `Corrupt prior week schedule "${fileName}" in "${dir}" — "slots" is missing, not an array, or empty.`,
      );
    }
    for (const slot of parsed.slots) {
      usedCardIds.add(slot.card_id);
      if (slot.read_through) readThroughConsumed += 1;
    }
  }

  return { usedCardIds, readThroughConsumed };
}
