/**
 * T12: The weekly social schedule generator.
 *
 * Pf39c2-social-pilot-02a D02: the read-through and the multi-format
 * weighted draw are both gone. The user, after reviewing week 1's renders,
 * deprecated Question, Objection, Still and the read-through outright (D01
 * deleted the three formats; this task deletes the read-through and
 * collapses the day). **The channel is now: one Wall a day, drawn from the
 * Wall pool, nothing else.**
 *
 * Produces one week of `content/social/pilot-schedule-wNN.json` — 7 days x 1
 * slot, every slot a Wall. Each day's card is drawn from the SCORED Wall
 * pool (falling back to the mechanical `wallGate` output when no scored pool
 * file exists yet — see `loadWallPool`), balanced by author
 * (`wallAuthorWeights`/`selectWallBalanced`, T05) and preferring "strong"
 * entries — `landing_line_score` clearing `WALL_STRONG_LANDING_LINE_MIN`
 * (V14 dropped `impenetrability_score` from this test — see that
 * constant's doc comment in this file for why) — over reserve (T21).
 *
 * T19's sub-type spacing survives, simplified: with no read-through "never
 * reorder the sequence" constraint left to respect, every day's draw can
 * freely prefer a Wall pool entry whose `sub_types` don't repeat the
 * immediately preceding DAY's, falling back to the full pool (and reporting
 * via `logger.warn`) only once the available pool truly can't satisfy it.
 *
 * `generateWeek` is a pure function: no filesystem access, no `Date.now()`,
 * no `Math.random()`. Every random choice is drawn from `createSeededRng`
 * (./premises.ts) so the same seed + prior-week card ids always produce
 * byte-identical output. `loadWallPool` and `loadPriorWeeks` below do the
 * filesystem/JSON work the CLI needs and are the only impure exports in this
 * module.
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
  classifyWallSubTypes,
  wallPayoffScreenCount,
  type AuthorMixEntry,
  type WallEntry,
  type RankedWallEntry,
  type WallSubType,
} from "./premises.js";
import { checkFaithfulness } from "./premises-scoring.js";
import type { WallRubricResult } from "./premises-scoring.js";
import { parsePoolFile } from "./pool-file.js";
import { logger } from "./logger.js";
import { loadExclusions, type LoadedExclusions } from "./exclusions.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * T21: Wall selection must respect T07's LLM rubric scores, not just the
 * mechanical gate — a scored `wall.json` carries `impenetrability_score`
 * and `landing_line_score` (both 1-5, see `WALL_SCORE_MIN`/`MAX` in
 * ./premises-scoring.js) per entry, but `generateWeek` never looked at
 * them; `selectWallBalanced` drew uniformly (weighted only by author) from
 * every gate survivor, including the weak remainder the rubric itself
 * already flagged.
 *
 * V14 (Pf39c2-social-pilot-02a) removed `impenetrability_score` from this
 * test — strength is now `landing_line_score >= WALL_STRONG_LANDING_LINE_MIN`
 * ALONE. `impenetrability_score` rates how visually dense a card's OWN
 * `original_excerpt` reads. That mattered when the wall phase rendered
 * that excerpt at a font size scaled to fill the frame. Since T08/R02 it
 * does not: the wall renders the surrounding CHAPTER block instead
 * (`social/src/render/chapter-text.ts`'s `buildChapterTextBlock`), at a
 * FIXED font size, looping whole chapter laps until it clears the travel
 * floor. Every card's wall is equally a wall now, regardless of how dense
 * that card's own excerpt is — so gating on the excerpt's density no
 * longer measures anything the viewer experiences.
 *
 * Measured over the real 168-entry scored pool
 * (`content/social/premises/wall.json`), what `impenetrability_score`
 * actually still correlates with is payoff LENGTH, not quality — it rises
 * with screen count while `landing_line_score` (what the viewer actually
 * reads) stays flat:
 *
 * | screens | n  | avg impenetrability | avg landing_line |
 * |---------|----|----------------------|-------------------|
 * | 1       | 3  | 1.67                 | 5.00              |
 * | 2       | 18 | 2.94                 | 4.28              |
 * | 3       | 31 | 3.68                 | 4.29              |
 * | 4       | 46 | 3.87                 | 4.30              |
 * | 5       | 70 | 3.99                 | 4.26              |
 *
 * Gating on impenetrability therefore selected for LONGER videos — the
 * opposite of what the format wants. Dropping it grows the strong pool
 * from 98 to 142 of 168 entries (including all 3 real 1-screen entries,
 * which previously scored too low on impenetrability alone to qualify)
 * without touching `WALL_RUBRIC_TASK` or re-scoring anything:
 * `impenetrability_score` stays in `wall.json` as measured data and stays
 * parsed (`WallPoolEntry` below), it simply no longer decides selection.
 *
 * Exported (not inlined into `isStrongWallEntry`) so the threshold is
 * independently tunable and directly assertable in tests.
 */
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
 * touching reserve (see `WALL_STRONG_LANDING_LINE_MIN`'s doc comment for
 * the threshold, and V14's note above it for why `impenetrability_score`
 * is no longer part of this test even though the field is still present
 * on `WallPoolEntry` and still parsed from `wall.json`).
 *
 * An entry with NO `rubric` at all — the gate-only fallback pool
 * (`rankWall`'s raw output, used whenever `content/social/premises/
 * wall.json` is absent or empty — see `loadWallPool`) — is treated as
 * eligible/strong BY DEFAULT, not as sub-strong: there is no rubric score
 * to fail, and the mechanical-gate path must keep scheduling normally with
 * zero LLM calls, exactly as it did before this task (and before V14).
 * Only a PRESENT rubric whose `landing_line_score` scores below the
 * threshold demotes an entry to reserve.
 */
export function isStrongWallEntry(entry: WallPoolEntry): boolean {
  if (!entry.rubric) return true;
  return entry.rubric.landing_line_score >= WALL_STRONG_LANDING_LINE_MIN;
}

export interface WallSlotContent {
  format: "wall";
  original_excerpt: string;
  landing_line: string;
}

export interface ScheduleSlot {
  /** 1-based, 1-7. */
  day: number;
  card_id: string;
  book_slug: string;
  author_slug: AuthorSlug;
  content: WallSlotContent;
}

export interface WeekSchedule {
  week: number;
  seed: number;
  slots: ScheduleSlot[];
  author_mix: Record<AuthorSlug, AuthorMixEntry>;
  pool_source: "scored" | "gate-only";
}

export interface GenerateWeekOptions {
  weekNumber: number;
  seed: number;
  cards: Card[];
  /** The Wall pool to draw from — a scored pool (T11) or the mechanical `rankWall` fallback (see `loadWallPool`). */
  wallPool: RankedWallEntry[];
  poolSource: "scored" | "gate-only";
  /** Every card id already used in prior weeks (and, defensively, this week — see `generateWeek`). */
  priorUsedCardIds: ReadonlySet<string>;
  /**
   * F05/F06: the renderer-derived Wall exclusion list — card ids
   * `social/src/remotion/wall-gate.ts`'s gate would reject, surveyed by
   * `social/scripts/write-exclusions.ts` (`content/social/
   * render-exclusions.json`'s `wall` section). Optional: leave undefined to
   * run ungated, exactly as before F05/F06.
   */
  wallExclusions?: ReadonlySet<string>;
}

// ---------------------------------------------------------------------------
// T19: true when two Wall sub-type lists share at least one entry — the
// definition of "the same sub-type runs on consecutive Wall days" the plan
// asks the scheduler to avoid. Non-exclusive by design (`classifyWallSubTypes`
// — a card can match `thou_wall` AND `cascade`), so "no overlap" (not
// "different first element") is the correct check. An empty list on either
// side (a `reserve` entry, matching none of the three sub-types) never
// intersects anything, which is correct: a reserve Wall has no texture to
// repeat.
// ---------------------------------------------------------------------------
function wallSubTypesIntersect(a: readonly WallSubType[], b: readonly WallSubType[]): boolean {
  if (a.length === 0 || b.length === 0) return false;
  const bSet = new Set(b);
  return a.some((t) => bSet.has(t));
}

// ---------------------------------------------------------------------------
// On-screen field derivation.
// ---------------------------------------------------------------------------

/**
 * The effective landing line for a Wall pool entry — the LLM rubric's
 * `chosen_landing_line` (T07's scored pick) when a scored pool provided
 * one, otherwise the mechanical `landing_line`. Extracted (V15) so every
 * consumer that needs "the line the render will actually show" — both
 * `contentFromWallEntry` below and the V15 screen-count quota's
 * `wallScreenCountFor` — reads it from exactly one place. Getting this
 * wrong (e.g. a screen-count computation that uses the mechanical line
 * while the render uses the rubric's chosen line) would silently miscount
 * screens for the 31 real entries where the two differ.
 */
function landingLineFor(entry: WallEntry): string {
  const w = entry as WallEntry & { rubric?: { chosen_landing_line?: string } };
  return w.rubric?.chosen_landing_line ?? w.landing_line;
}

/**
 * Build a slot's on-screen fields from an already-gated/scored Wall pool
 * entry.
 *
 * Prefers the LLM rubric's `chosen_landing_line` (T07's scored pick) over
 * the mechanical `landing_line` when a scored pool provided one —
 * otherwise a scored `wall.json` would produce byte-identical posts to the
 * gate-only fallback and T11's Wall rubric calls would buy nothing (see M5
 * in the PR #39 review). Falls back to the mechanical line when no rubric
 * is present (the gate-only path, or a scored pool that for some reason
 * omits it). See `landingLineFor`.
 */
function contentFromWallEntry(entry: WallEntry, card: Card): WallSlotContent {
  return { format: "wall", original_excerpt: card.original_excerpt, landing_line: landingLineFor(entry) };
}

// ---------------------------------------------------------------------------
// V15: per-week screen-count QUOTA (user, 2026-08-27 — plan's "Screen-count
// mix" section). Week 1, pre-V15, came out at 5 payoff screens on all 7
// days. V14 (dropping `impenetrability_score` from the strength test) helps
// but is not enough on its own: the strong pool is still ~47% five-screen,
// and `wallAuthorWeights` compounds it by over-drawing Seneca, whose own
// strong pool is ~91% five-screen. A hard per-week quota — not an adjacency
// rule, not a re-weighting — is what the user asked for instead.
// ---------------------------------------------------------------------------

/** At most this many days per week may land at the 5-screen ceiling. */
export const WALL_MAX_FIVE_SCREEN_DAYS = 2;

/** At least this many days per week must land at `WALL_SHORT_SCREEN_MAX` screens or fewer. */
export const WALL_MIN_SHORT_SCREEN_DAYS = 2;

/** The screen count at or under which a day counts toward the "short" floor above. */
export const WALL_SHORT_SCREEN_MAX = 3;

/**
 * A Wall pool entry's payoff screen count, computed from the SAME
 * effective landing line the render will use (`landingLineFor`) — using
 * the mechanical `landing_line` instead would silently miscount the 31 real
 * entries whose rubric-chosen line differs from it.
 *
 * Returns `null` when the entry's card can't be found in `cardsById` —
 * this only happens for a malformed pool entry (every entry that survives
 * to a real draw always resolves; `generateWeek`'s own post-selection
 * lookup throws loudly if it doesn't). A `null` count is treated as
 * "unknown" by both quota filters below: never excluded as a 5, never
 * counted as a short — deliberately conservative rather than a guess.
 */
function wallScreenCountFor(entry: WallEntry, cardsById: ReadonlyMap<string, Card>): number | null {
  const card = cardsById.get(entry.card_id);
  if (!card) return null;
  return wallPayoffScreenCount(card.plain_english, landingLineFor(entry));
}

/**
 * Narrow today's candidate pool to satisfy the V15 screen-count quota,
 * given how many 5-screen and short (<= `WALL_SHORT_SCREEN_MAX`) days this
 * week has already used, and how many days (including today) remain.
 *
 * Two independent constraints, applied in the same "filter, and if that
 * empties the candidate set, fall back to the wider pool and log" shape
 * T19 uses for sub-type spacing (see `wallSubTypesIntersect`'s call site
 * below) — so a starved pool degrades gracefully instead of throwing or
 * looping:
 *
 *  - CEILING: once the week has already used its 2 allowed 5-screen days,
 *    exclude every 5-screen entry from today's draw, so the count can
 *    never exceed the cap. Falls back (with a named warning) only if that
 *    exclusion would leave zero candidates.
 *
 *  - FLOOR (the corner-painting guard): "at least 2 short days a week" is a
 *    WHOLE-WEEK property, not a per-day one, so it can't be left to chance
 *    on day 7 — by then the pool may hold nothing short at all. Instead
 *    this forces today's draw to be short as soon as the days remaining
 *    (including today) equal the short days still owed: if 0 short days
 *    have been drawn after 5 long days, day 6 already has
 *    `stillNeeded(2) >= daysRemainingIncludingToday(2)`, so day 6 AND day 7
 *    both get forced short — the corner (5 long days chosen, then only 2
 *    days left and no forcing yet applied) is never reached because the
 *    forcing trips one day before it would otherwise bind. Falls back
 *    (with a named warning) if the pool genuinely has no short entry left
 *    to draw once forced.
 */
function applyScreenCountQuota(
  pool: readonly WallPoolEntry[],
  cardsById: ReadonlyMap<string, Card>,
  weekNumber: number,
  day: number,
  fiveScreenDaysUsed: number,
  shortScreenDaysUsed: number,
): WallPoolEntry[] {
  let candidates: WallPoolEntry[] = [...pool];

  if (fiveScreenDaysUsed >= WALL_MAX_FIVE_SCREEN_DAYS) {
    const withoutFive = candidates.filter((e) => wallScreenCountFor(e, cardsById) !== 5);
    if (withoutFive.length > 0) {
      candidates = withoutFive;
    } else {
      logger.warn(
        `generateWeek: screen-count quota (at most ${WALL_MAX_FIVE_SCREEN_DAYS} five-screen days) could not be ` +
          `honored for week ${weekNumber} day ${day} — every remaining candidate is a 5-screen Wall and none ` +
          `shorter is available; scheduling a 5-screen day anyway.`,
      );
    }
  }

  const daysRemainingIncludingToday = 8 - day; // days day..7 inclusive
  const shortStillNeeded = Math.max(0, WALL_MIN_SHORT_SCREEN_DAYS - shortScreenDaysUsed);
  if (shortStillNeeded >= daysRemainingIncludingToday) {
    const onlyShort = candidates.filter((e) => {
      const count = wallScreenCountFor(e, cardsById);
      return count !== null && count <= WALL_SHORT_SCREEN_MAX;
    });
    if (onlyShort.length > 0) {
      candidates = onlyShort;
    } else {
      logger.warn(
        `generateWeek: screen-count quota (at least ${WALL_MIN_SHORT_SCREEN_DAYS} days at <= ` +
          `${WALL_SHORT_SCREEN_MAX} screens) could not be honored for week ${weekNumber} day ${day} — ` +
          `${shortStillNeeded} short day${shortStillNeeded === 1 ? "" : "s"} still needed with only ` +
          `${daysRemainingIncludingToday} day${daysRemainingIncludingToday === 1 ? "" : "s"} left, and no ` +
          `entry at <= ${WALL_SHORT_SCREEN_MAX} screens remains in the candidate pool; scheduling unconstrained.`,
      );
    }
  }

  return candidates;
}

/**
 * THE CENTRAL SAFETY PROPERTY: every word posted under a real author's name
 * must be traceable to that author's own card (`plain_english` or
 * `original_excerpt`). Run mechanically, right before a slot is committed,
 * because a slot's final on-screen text is assembled here (from a pool
 * entry or a scored rubric's chosen line) and nothing upstream of this
 * point re-checks it once assembled (see M4 in the PR #39 review). Throws
 * naming the day and specific field that failed.
 */
function assertFaithful(card: Card, content: WallSlotContent, day: number): void {
  const text = content.landing_line;
  // An empty on-screen field is never a valid post (see M9 in the PR #39
  // second review round) — it used to be treated as "trivially a substring
  // of anything, nothing to check" and silently skipped.
  if (!text) {
    throw new Error(`Faithfulness check failed for day ${day} (card "${card.id}", field "landing_line"): field is empty — an empty on-screen field is never a valid post.`);
  }
  const result = checkFaithfulness(text, card);
  if (!result.faithful) {
    throw new Error(`Faithfulness check failed for day ${day} (card "${card.id}", field "landing_line"): ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// The generator.
// ---------------------------------------------------------------------------

/**
 * Generate one week (7 days, one Wall slot each) of the social schedule.
 * Pure: no filesystem access, no `Date.now()`, no `Math.random()`.
 * Deterministic given the same arguments — see the module doc comment.
 */
export function generateWeek(options: GenerateWeekOptions): WeekSchedule {
  const { weekNumber, seed, cards, wallPool: rawWallPool, poolSource, priorUsedCardIds, wallExclusions } = options;

  const rng = createSeededRng(seed);
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  const allUsed = new Set<string>(priorUsedCardIds);
  const wallPool = rawWallPool.filter((e) => !allUsed.has(e.card_id) && !wallExclusions?.has(e.card_id));

  // T05: author weighting for The Wall, computed against the full,
  // unfiltered pool — a fixed correction reflecting the corpus's own skew,
  // not a moving target that drifts as cards get consumed week to week.
  // Pf39c2-social-pilot-02a D02: Wall is the only format left, so there is
  // no other format's author mix left to correct against — passing an empty
  // Question pool and a 0 Question fraction reduces `wallAuthorWeights`'s
  // combined-mix algebra to solving `w[a] == BALANCED_AUTHOR_SHARE[a]`
  // directly (see that function's own "no readThrough" branch), i.e. an
  // even three-way author split within the Wall pool alone.
  const wallAuthorWeightsMap = wallAuthorWeights([], wallPool, 0);

  const slots: ScheduleSlot[] = [];

  // T19: sub-type spacing state, simplified for D02 — tracks only the
  // IMMEDIATELY PRECEDING day's Wall sub-type(s) (there is exactly one slot
  // per day now, so "the immediately preceding slot" and "the immediately
  // preceding day" are the same thing). `null` before day 1 has scheduled
  // anything.
  let previousWallSubTypes: WallSubType[] | null = null;

  // V15: per-week screen-count quota state — reasoned about "as you go"
  // (see `applyScreenCountQuota`'s doc comment for the corner-painting
  // guard this requires) so the whole-week bounds actually hold rather than
  // being left to chance on the last day or two.
  let fiveScreenDaysUsed = 0;
  let shortScreenDaysUsed = 0;

  for (let day = 1; day <= 7; day++) {
    const remaining = wallPool.filter((e) => !allUsed.has(e.card_id));
    if (remaining.length === 0) {
      throw new Error(`No Wall pool entries left to schedule day ${day} of week ${weekNumber} — pool exhausted.`);
    }

    // T21: draw from the STRONG subset first (both rubric scores >= the
    // named threshold, or no rubric at all — see `isStrongWallEntry`); fall
    // back to reserve only once strong is exhausted (which, because
    // `wallPool` already excludes every card used in a prior week via
    // `allUsed`/`priorUsedCardIds`, naturally accounts for strong entries
    // consumed across accumulated prior weeks too, not just this one).
    const strongRemaining = remaining.filter(isStrongWallEntry);
    let sourcePool = strongRemaining;
    const poolLabel = strongRemaining.length > 0 ? "strong" : "reserve";
    if (strongRemaining.length === 0) {
      const reserveRemaining = remaining.filter((e) => !isStrongWallEntry(e));
      logger.warn(
        `generateWeek: Wall strong pool exhausted for week ${weekNumber} day ${day} — 0 strong entries remain; ` +
          `falling back to ${reserveRemaining.length} reserve entr${reserveRemaining.length === 1 ? "y" : "ies"}.`,
      );
      sourcePool = reserveRemaining;
    }

    // V15: narrow to the screen-count quota BEFORE the sub-type spacing
    // preference below, so quota correctness (a whole-week property) takes
    // priority over spacing (a per-day cosmetic preference) — spacing then
    // only ever narrows further within an already quota-compliant pool, and
    // its own empty-set fallback naturally lands back on the quota-compliant
    // pool rather than the wider, unconstrained one.
    sourcePool = applyScreenCountQuota(sourcePool, cardsById, weekNumber, day, fiveScreenDaysUsed, shortScreenDaysUsed);

    // T19 (simplified by D02): prefer entries whose `sub_types` don't
    // overlap the immediately preceding day's; fall back to the full
    // (unspaced) pool and REPORT when every remaining entry in the current
    // strong/reserve pool shares a sub-type — i.e. the pool does not allow
    // spacing here. Filters the candidate array in place, before the single
    // `selectWallBalanced` call below, so this consumes exactly the same
    // rng draws every day (required for byte-identical regeneration from a
    // seed).
    if (previousWallSubTypes !== null && previousWallSubTypes.length > 0) {
      const spaced = sourcePool.filter((e) => !wallSubTypesIntersect(e.sub_types, previousWallSubTypes!));
      if (spaced.length > 0) {
        sourcePool = spaced;
      } else {
        logger.warn(
          `generateWeek: Wall sub-type spacing could not be honored for week ${weekNumber} day ${day} — every ` +
            `remaining ${poolLabel} Wall pool entry shares a sub-type with the immediately preceding day's ` +
            `[${previousWallSubTypes.join(", ")}]; scheduling unspaced (the pool does not allow spacing here).`,
        );
      }
    }

    const [entry] = selectWallBalanced(sourcePool, wallAuthorWeightsMap, 1, rng);
    const card = cardsById.get(entry.card_id);
    if (!card) throw new Error(`Card "${entry.card_id}" from the Wall pool was not found in the corpus`);

    const content = contentFromWallEntry(entry, card);
    assertFaithful(card, content, day);

    slots.push({
      day,
      card_id: entry.card_id,
      book_slug: entry.book_slug,
      author_slug: entry.author_slug,
      content,
    });
    allUsed.add(entry.card_id);
    previousWallSubTypes = entry.sub_types;

    // V15: tally today's actual screen count (not a target) against the
    // week's quota state, so the next day's `applyScreenCountQuota` call
    // reasons from what really happened, including the graceful-degradation
    // paths above where the quota went unmet.
    const screenCount = wallPayoffScreenCount(card.plain_english, landingLineFor(entry));
    if (screenCount === 5) fiveScreenDaysUsed += 1;
    if (screenCount <= WALL_SHORT_SCREEN_MAX) shortScreenDaysUsed += 1;
  }

  const authorMixResult = combinedAuthorMix(slots.map((s) => ({ author_slug: s.author_slug })));

  return {
    week: weekNumber,
    seed,
    slots,
    author_mix: authorMixResult,
    pool_source: poolSource,
  };
}

// ---------------------------------------------------------------------------
// Filesystem helpers (impure — the CLI's job, kept here for reuse/testing).
// ---------------------------------------------------------------------------

/**
 * `exclusionsPath` (F05/F06): the renderer-derived exclusion list —
 * `content/social/render-exclusions.json`, written by
 * `social/scripts/write-exclusions.ts` by running the Wall renderer gate
 * (`social/src/remotion/wall-gate.ts`) over the scored Wall pool. Optional
 * and absent-tolerant BY DESIGN: passing `undefined`, or a path that
 * doesn't exist on disk, runs the pool ungated (a warning is logged either
 * way, so running ungated is visible, not silent) — no test or caller is
 * required to have this file present. When it IS present, every excluded
 * id is dropped from the pool here, once, so a card the renderer would
 * refuse to render can never reach the draw in `generateWeek` in the first
 * place. See `./exclusions.ts`.
 *
 * Reads the scored pool file (`<premisesDir>/wall.json`, written by
 * `scripts/score-premises.ts` via `./pool-file.ts`'s `writePoolFile`) WHEN
 * PRESENT AND NON-EMPTY; falls back to the mechanical gate output
 * (`rankWall` from ./premises.ts, passed in as `gatePool`) both when the
 * file is absent and when it parses to zero entries (T19 — empty-pool
 * defense in depth, kept as a second, independent line of defense even
 * though `score-premises.ts` now refuses to write a zero-entry pool file at
 * all).
 *
 * `parsePoolFile` (./pool-file.ts) reads either on-disk shape: a bare JSON
 * array (legacy) or the current `{ meta, entries }` envelope.
 */
export async function loadWallPool(
  premisesDir: string,
  gatePool: RankedWallEntry[],
  exclusionsPath?: string,
): Promise<{
  pool: RankedWallEntry[];
  source: "scored" | "gate-only";
  /** `null` when no exclusion file was found (ungated) — see `exclusionsPath`'s doc comment above. */
  exclusions: LoadedExclusions | null;
}> {
  let source: "scored" | "gate-only" = "gate-only";
  let wall: RankedWallEntry[] = gatePool;

  const wallPath = path.join(premisesDir, "wall.json");
  if (existsSync(wallPath)) {
    const { entries } = parsePoolFile<RankedWallEntry>(JSON.parse(await readFile(wallPath, "utf-8")));
    if (entries.length > 0) {
      wall = entries;
      source = "scored";
    } else {
      console.warn(`loadWallPool: "${wallPath}" has zero entries — falling back to the mechanical gate output.`);
    }
  }

  // F05: drop any pool entry the renderer's OWN gate has already rejected,
  // regardless of whether the pool above came from a scored pool file or
  // the mechanical gate fallback — an excluded card is un-renderable either
  // way.
  const exclusions = exclusionsPath ? await loadExclusions(exclusionsPath) : null;
  if (exclusions === null) {
    console.warn(
      `loadWallPool: no exclusions file${exclusionsPath ? ` at "${exclusionsPath}"` : ""} — running the Wall pool ` +
        `UNGATED. The scheduler may draw a card the renderer's own gate (legibility floor / duration ceiling) ` +
        `will reject at render time. Run "npx tsx social/scripts/write-exclusions.ts --date <date>" to generate it.`,
    );
  } else if (exclusions.wall.size > 0) {
    const before = wall.length;
    wall = wall.filter((e) => !exclusions.wall.has(e.card_id));
    const dropped = before - wall.length;
    if (dropped > 0) {
      console.warn(
        `loadWallPool: dropped ${dropped} Wall pool entr${dropped === 1 ? "y" : "ies"} excluded by the renderer's ` +
          `gate (${exclusionsPath}) — an un-renderable card is never scheduled.`,
      );
    }
  }

  return { pool: wall, source, exclusions };
}

export interface PriorWeeksState {
  usedCardIds: Set<string>;
}

/**
 * Read every prior week's schedule file (`pilot-schedule-w01.json` ..
 * `pilot-schedule-w<week-1>.json`) from `dir` and derive the state the next
 * week's generation needs: every already-scheduled card id, so it can never
 * be reused.
 *
 * Week 1 has no prior weeks at all (the loop below never runs), which is the
 * ONLY legitimate reason a file is absent. Any OTHER missing file — e.g.
 * w02 absent while generating week 4 — is refused with a named error rather
 * than silently treated as "no prior week": that would re-open the exact
 * card ids w02 already consumed, producing duplicate posts (see M1 in the
 * PR #39 review). A prior-week file that parses but carries a missing,
 * non-array, or empty `slots` is refused the same way, as corrupt.
 */
export async function loadPriorWeeks(dir: string, week: number): Promise<PriorWeeksState> {
  const usedCardIds = new Set<string>();

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
    }
  }

  return { usedCardIds };
}
