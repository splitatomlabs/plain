import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadCorpus,
  rankWall,
  wallAuthorWeights,
  sentences,
  classifyWallSubTypes,
  type RankedWallEntry,
  type WallSubType,
} from "../premises.js";
import { checkFaithfulness } from "../premises-scoring.js";
import {
  generateWeek,
  loadFormatPools,
  loadPriorWeeks,
  DEFAULT_FORMAT_WEIGHTS,
  isStrongWallEntry,
  WALL_STRONG_IMPENETRABILITY_MIN,
  WALL_STRONG_LANDING_LINE_MIN,
  type FormatPools,
  type FormatWeights,
  type WeekSchedule,
  type ScheduleFormat,
  type RenderedFormat,
  type WallPoolEntry,
} from "../schedule.js";
import { logger } from "../logger.js";
import type { Card } from "../types.js";
import type { AuthorSlug } from "../constants.js";

// ---------------------------------------------------------------------------
// Real-corpus fixtures, computed once — these tests exercise the generator
// against the actual pipeline output (content/output), same as
// premises.test.ts's own corpus-level tests.
// ---------------------------------------------------------------------------

const cards: Card[] = loadCorpus();
// Pf39c2-social-pilot-02a D01: Question and Objection were deleted outright
// (`questionGate`/`objectionGate` no longer exist) — the channel is one
// Wall a day, drawn from the Wall pool, nothing else. `FormatPools` still
// carries `question`/`objection` fields (collapsing that shape away is
// D02's job, not this one's), so these are always empty now — no schedule
// this file generates can ever contain a "question" or "objection" slot.
const gatePools: FormatPools = {
  wall: rankWall(cards),
  question: [],
  objection: [],
};
const poolSource = { wall: "gate-only" as const, question: "gate-only" as const, objection: "gate-only" as const };

// T22: the three stopping-power booleans a scored Question pool row now
// carries alongside drift_verdict. Fixtures below spread this in wherever a
// row is meant to be ADMITTED (drift passing is no longer sufficient on its
// own — see `loadFormatPools`'s Question branch).
const STOPPING_POWER_PASS = { standalone_intelligible: true, answer_has_substance: true, modern_premise: true };

function makeWeek(week: number, seed: number, priorUsedCardIds: Set<string> = new Set(), readThroughStartIndex = 0): WeekSchedule {
  return generateWeek({
    weekNumber: week,
    seed,
    cards,
    pools: gatePools,
    poolSource,
    priorUsedCardIds,
    readThroughBook: "enchiridion",
    readThroughStartIndex,
  });
}

describe("generateWeek", () => {
  it("produces 7 days x 2 slots = 14 slots", () => {
    const week = makeWeek(1, 42);
    expect(week.slots).toHaveLength(14);
    for (let day = 1; day <= 7; day++) {
      const daySlots = week.slots.filter((s) => s.day === day);
      expect(daySlots.map((s) => s.slot)).toEqual([1, 2]);
    }
  });

  it("marks exactly one slot per day as the read-through", () => {
    const week = makeWeek(1, 42);
    for (let day = 1; day <= 7; day++) {
      const daySlots = week.slots.filter((s) => s.day === day);
      const readThroughSlots = daySlots.filter((s) => s.read_through);
      expect(readThroughSlots).toHaveLength(1);
      expect(readThroughSlots[0].slot).toBe(1);
    }
  });

  it("never schedules the same card twice within a single week", () => {
    const week = makeWeek(1, 42);
    const ids = week.slots.map((s) => s.card_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // -------------------------------------------------------------------------
  // Acceptance: byte-identical regeneration with the same seed and weights.
  // -------------------------------------------------------------------------
  it("is byte-identical across two independent runs with the same seed and weights", () => {
    const a = makeWeek(1, 42);
    const b = makeWeek(1, 42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("is byte-identical when given explicit (non-default) weights, same both times", () => {
    const weights = { wall: 2, question: 5, objection: 1 };
    const a = generateWeek({
      weekNumber: 1,
      seed: 7,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights,
    });
    const b = generateWeek({
      weekNumber: 1,
      seed: 7,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different output for a different seed", () => {
    const a = makeWeek(1, 42);
    const b = makeWeek(1, 43);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  // -------------------------------------------------------------------------
  // Acceptance: a week 1 card cannot appear in week 2.
  // -------------------------------------------------------------------------
  it("never reuses a card scheduled in a prior week", () => {
    const week1 = makeWeek(1, 42);
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week2 = makeWeek(2, 42, week1Ids, 7);
    const week2Ids = week2.slots.map((s) => s.card_id);

    for (const id of week2Ids) {
      expect(week1Ids.has(id)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // Acceptance: the read-through advances strictly sequentially across weeks,
  // no skip, no repeat.
  // -------------------------------------------------------------------------
  it("advances the read-through strictly sequentially, with no skip or repeat, within a week", () => {
    const week = makeWeek(1, 42);
    const readThroughCards = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);

    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    expect(readThroughCards).toEqual(enchiridionCards.slice(0, 7).map((c) => c.id));

    const counters = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.read_through_counter);
    expect(counters).toEqual([
      `Card 1 of ${enchiridionCards.length}`,
      `Card 2 of ${enchiridionCards.length}`,
      `Card 3 of ${enchiridionCards.length}`,
      `Card 4 of ${enchiridionCards.length}`,
      `Card 5 of ${enchiridionCards.length}`,
      `Card 6 of ${enchiridionCards.length}`,
      `Card 7 of ${enchiridionCards.length}`,
    ]);
  });

  it("advances the read-through strictly sequentially across weeks, with no skip or repeat", () => {
    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    const week1 = makeWeek(1, 42);
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week2 = makeWeek(2, 42, week1Ids, 7);

    const week2ReadThrough = week2.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);

    expect(week2ReadThrough).toEqual(enchiridionCards.slice(7, 14).map((c) => c.id));

    const allReadThrough = [
      ...week1.slots.filter((s) => s.read_through).map((s) => s.card_id),
      ...week2ReadThrough,
    ];
    expect(new Set(allReadThrough).size).toBe(allReadThrough.length); // no repeat
    expect(allReadThrough).toEqual(enchiridionCards.slice(0, 14).map((c) => c.id)); // no skip, strict order
  });

  it("throws rather than skip or repeat once the read-through book is exhausted", () => {
    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    expect(() => makeWeek(99, 42, new Set(), enchiridionCards.length - 3)).toThrow(/complete|exhausted/i);
  });

  // -------------------------------------------------------------------------
  // Format weighting honoured (directional — a full statistical test is T13's job).
  // -------------------------------------------------------------------------
  it("never exceeds the Objection cap per week regardless of weight", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 0, question: 0, objection: 100 }, // objection dominates every draw
      maxObjectionPerWeek: 1,
    });
    expect(week.format_counts.objection).toBeLessThanOrEqual(1);
  });

  it("draws zero Objection slots when its weight is 0", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 5, question: 5, objection: 0 },
    });
    expect(week.format_counts.objection).toBe(0);
  });

  it("reports author mix combined across all formats (T05's acceptance), not per format", () => {
    const week = makeWeek(1, 42);
    const total = Object.values(week.author_mix).reduce((sum, m) => sum + m.count, 0);
    expect(total).toBe(week.slots.length);
    const shares = Object.values(week.author_mix).reduce((sum, m) => sum + m.share, 0);
    expect(shares).toBeCloseTo(1, 5);
  });

  it("honours the Wall's author-balancing weights over a large draw (directional)", () => {
    // Force every weighted slot to be Wall so the balancing effect is visible
    // over more than one draw; use a fresh, non-overlapping read-through
    // start each "week" to avoid read-through exhaustion, but that's
    // irrelevant here — we're only inspecting the weighted (slot 2) picks.
    const seen: Record<string, number> = { epictetus: 0, "marcus-aurelius": 0, seneca: 0 };
    for (let w = 1; w <= 5; w++) {
      const week = generateWeek({
        weekNumber: w,
        seed: 100 + w,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(), // isolate each week so pool depletion doesn't skew this
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 1, question: 0, objection: 0 },
      });
      for (const slot of week.slots.filter((s) => !s.read_through)) {
        seen[slot.author_slug] += 1;
      }
    }
    // Pf39c2-social-pilot-02a D01: `gatePools.question` is always empty now
    // (Question was deleted outright), so it can no longer demonstrate
    // wallAuthorWeights's correction directly — a synthetic pool matching
    // the real, historically-measured Question skew (50/21/18 — see
    // premises.test.ts's own `REAL_QUESTION_POOL_SPLIT`) stands in here.
    const syntheticQuestionPool = [
      ...Array.from({ length: 50 }, (_, i) => ({ card_id: `q-e-${i}`, book_slug: "x", author_slug: "epictetus" as const, question: "q", answer: "a" })),
      ...Array.from({ length: 21 }, (_, i) => ({ card_id: `q-m-${i}`, book_slug: "x", author_slug: "marcus-aurelius" as const, question: "q", answer: "a" })),
      ...Array.from({ length: 18 }, (_, i) => ({ card_id: `q-s-${i}`, book_slug: "x", author_slug: "seneca" as const, question: "q", answer: "a" })),
    ];
    const weights = wallAuthorWeights(syntheticQuestionPool, gatePools.wall);
    // epictetus's Wall weight is pushed well below 1/3 (T05) — directional check only.
    expect(weights.epictetus).toBeLessThan(1 / 3);
    expect(seen.epictetus).toBeLessThanOrEqual(seen["marcus-aurelius"] + seen.seneca);
  });
});

describe("generateWeek — read-through content derivation", () => {
  it("derives wall-format read-through content directly from the card, faithful to its text", () => {
    const week = makeWeek(1, 42);
    const rt = week.slots.find((s) => s.read_through)!;
    expect(rt.content.format).toBe("wall");
    if (rt.content.format === "wall") {
      const card = cards.find((c) => c.id === rt.card_id)!;
      expect(rt.content.original_excerpt).toBe(card.original_excerpt);
      expect(card.plain_english.includes(rt.content.landing_line) || rt.content.landing_line === card.plain_english).toBe(true);
    }
  });

  // -------------------------------------------------------------------------
  // The read-through slot's FORMAT is now drawn from the weighting like any
  // other slot (the fix) — it is no longer hardcoded to "wall". Whatever
  // format each day resolves to, its content must still be faithfully
  // derived from that day's raw sequential card (never fabricated), and
  // `read_through_format` on the week must report "dynamic" (not a fixed
  // format) since no override was given.
  // -------------------------------------------------------------------------
  it("draws the read-through slot's format from the weighting and reports it as dynamic by default", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      });
      expect(week.read_through_format).toBe("dynamic");
      for (const slot of week.slots.filter((s) => s.read_through)) {
        const card = cards.find((c) => c.id === slot.card_id)!;
        if (slot.content.format === "wall") {
          expect(slot.content.original_excerpt).toBe(card.original_excerpt);
          // T02: no more whole-passage fallback — the landing line must be a
          // real, qualifying substring of plain_english, never the full text.
          expect(card.plain_english).toContain(slot.content.landing_line);
        } else if (slot.content.format === "question") {
          expect(card.plain_english).toContain(slot.content.question);
          expect(card.plain_english).toContain(slot.content.answer);
        } else if (slot.content.format === "objection") {
          expect(card.plain_english).toContain(slot.content.objection);
        } else {
          // F19's STILL fallback — reachable here (unlike before T02) for a
          // card with no qualifying landing line and no Question/Objection
          // candidate either.
          expect(slot.content.format).toBe("still");
          expect(slot.content.text).toBe(card.plain_english);
        }
      }
    }
  });

  // Falls back deterministically (no extra rng, see `resolveReadThrough`)
  // when the weighted draw's candidate format isn't renderable by the fixed
  // sequential card — proven here by forcing every candidate draw toward
  // Question (weight 100) against the read-through book, most of whose cards
  // cannot render Question, and confirming the generator never throws and
  // every resolved format is still faithful to its card.
  it("falls back deterministically to a renderable format when the drawn candidate doesn't fit the read-through card", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 7,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 0, question: 100, objection: 0 },
    });
    // Every read-through slot resolved to SOME format without throwing.
    expect(week.slots.filter((s) => s.read_through)).toHaveLength(7);
    // Most Enchiridion cards can't render Question — the fallback should
    // have kicked in for at least one of the 7 days, landing on Wall.
    const rtFormats = week.slots.filter((s) => s.read_through).map((s) => s.content.format);
    expect(rtFormats).toContain("wall");
  });

  it("is byte-identical for the dynamic read-through path across two independent runs with the same seed", () => {
    const build = () =>
      generateWeek({
        weekNumber: 1,
        seed: 7,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 0, question: 100, objection: 0 },
      });
    expect(JSON.stringify(build())).toBe(JSON.stringify(build()));
  });

  // The forced-override escape hatch still behaves as a strict, throwing
  // fixed format — unchanged from before this fix, and reported verbatim
  // (not "dynamic") on the week.
  it("honours an explicit readThroughFormat override, throwing when a card can't render it", () => {
    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        readThroughFormat: "objection",
      }),
    ).toThrow(/no valid objection candidate/i);
  });

  it("reports a forced readThroughFormat override verbatim, not as dynamic", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      // Index 30 (enchiridion-25-002) starts a 20-card run where every card
      // has a real qualifying landing line (T02: `selectLandingLine` is
      // never null) — unlike index 0's run, which hits enchiridion-01-004
      // a few cards in and would now throw (no whole-passage fallback).
      readThroughStartIndex: 30,
      readThroughFormat: "wall",
    });
    expect(week.read_through_format).toBe("wall");
    expect(week.slots.filter((s) => s.read_through).every((s) => s.content.format === "wall")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadFormatPools — the T11 fallback contract.
// ---------------------------------------------------------------------------

// Pf39c2-social-pilot-02a D01: `gatePools.question`/`gatePools.objection`
// are always empty now (Question/Objection were deleted outright — the
// channel is one Wall a day, drawn from the Wall pool, nothing else), so
// `loadFormatPools`'s STILL-PRESENT Question/Objection scored-pool-filtering
// branches (collapsing that shape away is D02's job, not this one's) need a
// synthetic base pool to test against instead of slicing the now-empty
// mechanical-gate fallback.
function syntheticQuestionBase(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    card_id: `synthetic-question-${i}`,
    book_slug: "synthetic",
    author_slug: "epictetus" as const,
    question: `Question ${i}?`,
    answer: `Answer ${i}.`,
  }));
}
function syntheticObjectionBase(n = 2) {
  return Array.from({ length: n }, (_, i) => ({
    card_id: `synthetic-objection-${i}`,
    book_slug: "synthetic",
    author_slug: "seneca" as const,
    objection: `Objection ${i}?`,
    reply: `Reply ${i}.`,
    reply_start: 0,
  }));
}

describe("loadFormatPools", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-pools-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("falls back to the mechanical gate output when no scored pool files exist", async () => {
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source).toEqual({ wall: "gate-only", question: "gate-only", objection: "gate-only" });
    expect(pools.wall).toBe(gatePools.wall);
    expect(pools.question).toBe(gatePools.question);
    expect(pools.objection).toBe(gatePools.objection);
  });

  // Strengthened per M5 in the PR #39 review: the ORIGINAL version of this
  // test set `chosen_landing_line: e.landing_line` — identical to the
  // mechanical line — so it could never have caught `contentFromEntry`
  // discarding the rubric's own chosen line entirely (M5's actual defect).
  // Using a DISTINCT value here proves the field survives the load as its
  // own value, not merely something coincidentally equal to `landing_line`.
  it("reads a scored Wall pool file when present, preserving a rubric-chosen landing line distinct from the mechanical one", async () => {
    const scoredWall = gatePools.wall
      .slice(0, 3)
      .map((e) => ({ ...e, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: `${e.landing_line} (rubric pick)` } }));
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify(scoredWall));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("scored");
    expect(pools.wall).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const entry = pools.wall[i] as (typeof scoredWall)[number];
      expect(entry.rubric.chosen_landing_line).toBe(`${gatePools.wall[i].landing_line} (rubric pick)`);
      expect(entry.rubric.chosen_landing_line).not.toBe(gatePools.wall[i].landing_line);
    }
  });

  it("filters a scored Question pool to only drift_verdict === 'answers'", async () => {
    const base = syntheticQuestionBase(2);
    const scoredQuestion = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it", ...STOPPING_POWER_PASS },
      { ...base[1], drift_verdict: "drifts", drift_reason: "off topic", ...STOPPING_POWER_PASS },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.question).toBe("scored");
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[0].card_id);
  });

  // -------------------------------------------------------------------------
  // T22: stopping power is a SECOND, independent gate on top of drift — a
  // row can pass drift and still be excluded for failing stopping power.
  // -------------------------------------------------------------------------
  it("filters a scored Question pool to only rows that ALSO pass T22 stopping power, even when drift_verdict is 'answers'", async () => {
    const base = syntheticQuestionBase(2);
    const scoredQuestion = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it", ...STOPPING_POWER_PASS },
      {
        ...base[1],
        drift_verdict: "answers", // drift PASSES here
        drift_reason: "resolves it",
        standalone_intelligible: false, // but stopping power FAILS
        answer_has_substance: true,
        modern_premise: true,
      },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.question).toBe("scored");
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[0].card_id);
  });

  it("fails closed on a scored Question row missing a T22 stopping-power field entirely, even when drift_verdict is 'answers'", async () => {
    const base = syntheticQuestionBase(2);
    const scoredQuestion = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it" }, // no stopping-power fields at all
      { ...base[1], drift_verdict: "answers", drift_reason: "resolves it", ...STOPPING_POWER_PASS },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pools } = await loadFormatPools(tempDir, gatePools);
      expect(pools.question).toHaveLength(1);
      expect(pools.question[0].card_id).toBe(base[1].card_id);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("stopping power"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("filters a scored Objection pool to only rubric.verdict === 'accept'", async () => {
    const base = syntheticObjectionBase(2);
    const scoredObjection = [
      { ...base[0], rubric: { verdict: "accept", classification: "viewer_position", reason: "yes" } },
      { ...base[1], rubric: { verdict: "reject", classification: "dramatized_scene", reason: "no" } },
    ];
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify(scoredObjection));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.objection).toBe("scored");
    expect(pools.objection).toHaveLength(1);
    expect(pools.objection[0].card_id).toBe(base[0].card_id);
  });

  // -------------------------------------------------------------------------
  // M6: verdict filters fail CLOSED — a row missing the field entirely must
  // be excluded, not admitted. Pre-fix, `e.drift_verdict === undefined || ...`
  // and `e.rubric === undefined || ...` let a truncated/schema-renamed pool
  // file promote drifts/dramatized_scene/doctrinal_dispute rows into the
  // posting pool.
  // -------------------------------------------------------------------------
  it("fails closed on a scored Question row missing drift_verdict entirely", async () => {
    const base = syntheticQuestionBase(2);
    const scoredQuestion = [
      { ...base[0] }, // no drift_verdict field at all — must NOT be admitted
      { ...base[1], drift_verdict: "answers", drift_reason: "resolves it", ...STOPPING_POWER_PASS },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const { pools } = await loadFormatPools(tempDir, gatePools);
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[1].card_id);
  });

  it("fails closed on a scored Objection row missing rubric entirely", async () => {
    const base = syntheticObjectionBase(2);
    const scoredObjection = [
      { ...base[0] }, // no rubric field at all — must NOT be admitted
      { ...base[1], rubric: { verdict: "accept", classification: "viewer_position", reason: "yes" } },
    ];
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify(scoredObjection));
    const { pools } = await loadFormatPools(tempDir, gatePools);
    expect(pools.objection).toHaveLength(1);
    expect(pools.objection[0].card_id).toBe(base[1].card_id);
  });

  // -------------------------------------------------------------------------
  // T19: the current `{ meta, entries }` envelope shape (written by
  // `score-premises.ts` via `./pool-file.ts`'s `writePoolFile`) must be
  // read identically to the legacy plain-array shape every earlier test in
  // this describe block writes directly.
  // -------------------------------------------------------------------------
  it("reads a scored Wall pool file written in the current { meta, entries } envelope shape", async () => {
    const entries = gatePools.wall.slice(0, 2);
    const meta = { submitted: 2, succeeded: 2, dropped: 0, limited: false, generated_at: "2026-08-25T00:00:00.000Z" };
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify({ meta, entries }));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("scored");
    expect(pools.wall).toHaveLength(2);
    expect(pools.wall[0].card_id).toBe(entries[0].card_id);
  });

  it("reads a scored Question pool file in the envelope shape, still filtering to drift_verdict === 'answers'", async () => {
    const base = syntheticQuestionBase(2);
    const entries = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it", ...STOPPING_POWER_PASS },
      { ...base[1], drift_verdict: "drifts", drift_reason: "off topic", ...STOPPING_POWER_PASS },
    ];
    const meta = { submitted: 2, succeeded: 2, dropped: 0, limited: false, generated_at: "2026-08-25T00:00:00.000Z" };
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify({ meta, entries }));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.question).toBe("scored");
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[0].card_id);
  });

  // -------------------------------------------------------------------------
  // T19: a present-but-EMPTY pool file — whether the legacy bare `[]` the
  // original bug actually wrote, or an empty `entries` array inside the
  // current envelope — must be treated exactly like an ABSENT file: fall
  // back to the mechanical gate output, not accepted as a real empty pool.
  // This is what actually fixes "pools exhausted": see the regression test
  // below for the end-to-end proof against `generateWeek` itself.
  // -------------------------------------------------------------------------
  it("falls back to the mechanical gate when the Wall pool file is a legacy empty array", async () => {
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify([]));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("gate-only");
    expect(pools.wall).toBe(gatePools.wall);
  });

  it("falls back to the mechanical gate when the Question pool file is an envelope with empty entries", async () => {
    const meta = { submitted: 30, succeeded: 0, dropped: 30, limited: false, generated_at: "2026-08-25T00:00:00.000Z" };
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify({ meta, entries: [] }));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.question).toBe("gate-only");
    expect(pools.question).toBe(gatePools.question);
  });

  it("falls back to the mechanical gate when the Objection pool file is a legacy empty array", async () => {
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify([]));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.objection).toBe("gate-only");
    expect(pools.objection).toBe(gatePools.objection);
  });

  it("treats an empty pool file for one format independently — the other two formats' real files still load", async () => {
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify([]));
    const scoredObjection = [{ ...syntheticObjectionBase(1)[0], rubric: { verdict: "accept", classification: "viewer_position", reason: "yes" } }];
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify(scoredObjection));
    const { source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("gate-only");
    expect(source.question).toBe("gate-only");
    expect(source.objection).toBe("scored");
  });
});

// ---------------------------------------------------------------------------
// F05/F06: the scheduler must consult the renderer-derived exclusion list
// (`content/social/render-exclusions.json`, written by
// `social/scripts/write-exclusions.ts`) so a card the renderer's own gate
// (`social/src/remotion/wall-gate.ts` / `question-gate.ts` /
// `objection-gate.ts`) would reject is never scheduled in the first place.
// F05 covered Wall alone (`on-anger-03-027`, a real corpus card the
// renderer's gate rejects for duration). F06 extends this to Question and
// Objection (`discourses-50-008` — every pool flag passes, but the question
// is 13 words, over the renderer's 12-word still-format floor — is the
// named fixture) and to the read-through slice, which structurally can't be
// covered by the Wall pool's own exclusion filtering (a read-through card
// is excluded from every weighted pool entirely).
// ---------------------------------------------------------------------------
describe("F05/F06: renderer-derived exclusions", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-exclusions-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  interface ExclusionFixture {
    card_id: string;
    book_slug: string;
    axis: string;
    reason: string;
  }

  async function writeExclusionsFile(sections: {
    wall?: ExclusionFixture[];
    question?: ExclusionFixture[];
    objection?: ExclusionFixture[];
    read_through?: ExclusionFixture[];
    // F19: the Still fallback's own section — see `./exclusions.ts`'s doc
    // comment. Defaults to `[]` (nothing excluded), same as every other
    // section, so existing callers of this helper need no change.
    still?: ExclusionFixture[];
  }): Promise<string> {
    const filePath = path.join(tempDir, "render-exclusions.json");
    const wall = sections.wall ?? [];
    const question = sections.question ?? [];
    const objection = sections.objection ?? [];
    const readThrough = sections.read_through ?? [];
    const still = sections.still ?? [];
    await writeFile(
      filePath,
      JSON.stringify({
        meta: {
          generated_at: "2026-08-25T00:00:00.000Z",
          max_post_duration_frames: 1770,
          max_post_duration_seconds: 59,
          wall_min_legible_font_px: 39,
          question_min_legible_font_px: 78,
          question_max_words: 12,
          objection_min_legible_font_px: 78,
          still_min_legible_font_px: 39,
          read_through_book: "meditations",
          read_through_chapters: ["book-02", "book-03"],
          wall: { submitted: 896, succeeded: 896 - wall.length, dropped: wall.length },
          question: { submitted: 88, succeeded: 88 - question.length, dropped: question.length },
          objection: { submitted: 59, succeeded: 59 - objection.length, dropped: objection.length },
          read_through: { submitted: 48, succeeded: 48 - readThrough.length, dropped: readThrough.length },
          still: { submitted: 48, succeeded: 48 - still.length, dropped: still.length },
        },
        wall,
        question,
        objection,
        read_through: readThrough,
        still,
      }),
    );
    return filePath;
  }

  function fixture(card_id: string, book_slug: string, axis: string): ExclusionFixture {
    return { card_id, book_slug, axis, reason: "synthetic fixture — see F05/F06" };
  }

  it("loadFormatPools drops excluded ids from EACH format's own pool and logs per format", async () => {
    // Pf39c2-social-pilot-02a D01: `gatePools.question`/`gatePools.objection`
    // are always empty now (Question/Objection were deleted outright) — a
    // synthetic local `FormatPools` stands in so this test can still prove
    // `loadFormatPools`'s STILL-PRESENT per-format exclusion filtering
    // (collapsing that shape away is D02's job, not this one's).
    expect(gatePools.wall.some((e) => e.card_id === "on-anger-03-027")).toBe(true);
    const localPools: FormatPools = {
      wall: gatePools.wall,
      question: syntheticQuestionBase(2),
      objection: syntheticObjectionBase(2),
    };
    const questionFixtureId = localPools.question[0].card_id;
    const objectionFixtureId = localPools.objection[0].card_id;

    const exclusionsPath = await writeExclusionsFile({
      wall: [fixture("on-anger-03-027", "on-anger", "duration")],
      question: [fixture(questionFixtureId, localPools.question[0].book_slug, "word_count")],
      objection: [fixture(objectionFixtureId, localPools.objection[0].book_slug, "sentence_cap")],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pools, exclusions } = await loadFormatPools(tempDir, localPools, exclusionsPath);
      expect(pools.wall.some((e) => e.card_id === "on-anger-03-027")).toBe(false);
      expect(pools.wall.length).toBe(gatePools.wall.length - 1);
      expect(pools.question.some((e) => e.card_id === questionFixtureId)).toBe(false);
      expect(pools.question.length).toBe(localPools.question.length - 1);
      expect(pools.objection.some((e) => e.card_id === objectionFixtureId)).toBe(false);
      expect(pools.objection.length).toBe(localPools.objection.length - 1);

      expect(exclusions).not.toBeNull();
      expect(exclusions!.wall.has("on-anger-03-027")).toBe(true);
      expect(exclusions!.question.has(questionFixtureId)).toBe(true);
      expect(exclusions!.objection.has(objectionFixtureId)).toBe(true);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 1 Wall pool entry"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 1 Question pool entry"));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 1 Objection pool entry"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("an excluded id never appears in a generated week", async () => {
    const exclusionsPath = await writeExclusionsFile({
      wall: [fixture("on-anger-03-027", "on-anger", "duration")],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pools: FormatPools;
    try {
      ({ pools } = await loadFormatPools(tempDir, gatePools, exclusionsPath));
    } finally {
      warnSpy.mockRestore();
    }

    for (let seed = 1; seed <= 20; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      });
      expect(week.slots.some((s) => s.card_id === "on-anger-03-027")).toBe(false);
    }
  });

  // Pf39c2-social-pilot-02a D01: this used to also exclude a real
  // `discourses-50-008` Question fixture and a real Objection entry, and
  // check neither ever appeared in a generated week under its own format.
  // Both formats were deleted outright — no generated slot's format is ever
  // "question"/"objection" any more, full stop (`excludedByFormat` below
  // keeps both sets for shape parity with `RenderedFormat`, but they can
  // never match anything) — so only the Wall exclusion is still a real
  // check here.
  it("no generated slot references a card id excluded for ITS OWN format, across seeds 1..50", async () => {
    const exclusionsPath = await writeExclusionsFile({
      wall: [fixture("on-anger-03-027", "on-anger", "duration")],
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pools: FormatPools;
    try {
      ({ pools } = await loadFormatPools(tempDir, gatePools, exclusionsPath));
    } finally {
      warnSpy.mockRestore();
    }

    const excludedByFormat: Record<RenderedFormat, Set<string>> = {
      wall: new Set(["on-anger-03-027"]),
      question: new Set(),
      objection: new Set(),
      still: new Set(),
    };

    for (let seed = 1; seed <= 50; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      });
      for (const slot of week.slots) {
        expect(excludedByFormat[slot.content.format].has(slot.card_id)).toBe(false);
      }
    }
  });

  it("with no exclusions file present, loadFormatPools behaves exactly as before F05/F06 and logs that it is running ungated", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pools, exclusions } = await loadFormatPools(tempDir, gatePools, path.join(tempDir, "render-exclusions.json"));
      expect(pools.wall).toBe(gatePools.wall);
      expect(pools.question).toBe(gatePools.question);
      expect(pools.objection).toBe(gatePools.objection);
      expect(exclusions).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("running every format UNGATED"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("with no exclusionsPath argument at all, loadFormatPools behaves exactly as before F05/F06 (the option is fully optional)", async () => {
    const { pools, exclusions } = await loadFormatPools(tempDir, gatePools);
    expect(pools.wall).toBe(gatePools.wall);
    expect(pools.question).toBe(gatePools.question);
    expect(pools.objection).toBe(gatePools.objection);
    expect(exclusions).toBeNull();
  });

  // F11: `loadExclusions`'s two throw paths (non-object JSON, and a missing
  // required array section) are the only thing standing between a
  // truncated/hand-edited artifact and a silently ungated schedule — assert
  // both actually fire, through `loadFormatPools` (the only real caller).
  it("rejects a present-but-non-object exclusions file (e.g. a bare JSON array) with the 'unrecognized shape' message", async () => {
    const exclusionsPath = path.join(tempDir, "render-exclusions.json");
    await writeFile(exclusionsPath, "[]");

    await expect(loadFormatPools(tempDir, gatePools, exclusionsPath)).rejects.toThrow(/unrecognized shape/i);
  });

  it("rejects an exclusions file missing the read_through section, naming it in the error", async () => {
    const exclusionsPath = path.join(tempDir, "render-exclusions.json");
    await writeFile(
      exclusionsPath,
      JSON.stringify({
        meta: {
          generated_at: "2026-08-25T00:00:00.000Z",
          max_post_duration_frames: 1770,
          max_post_duration_seconds: 59,
          wall_min_legible_font_px: 39,
          question_min_legible_font_px: 78,
          question_max_words: 12,
          objection_min_legible_font_px: 78,
          read_through_book: "meditations",
          read_through_chapters: ["book-02", "book-03"],
          wall: { submitted: 0, succeeded: 0, dropped: 0 },
          question: { submitted: 0, succeeded: 0, dropped: 0 },
          objection: { submitted: 0, succeeded: 0, dropped: 0 },
          read_through: { submitted: 0, succeeded: 0, dropped: 0 },
        },
        wall: [],
        question: [],
        objection: [],
        // read_through deliberately omitted.
      }),
    );

    await expect(loadFormatPools(tempDir, gatePools, exclusionsPath)).rejects.toThrow(/read_through/);
  });

  // -------------------------------------------------------------------------
  // The read-through's wall branch (`tryReadThroughContent`) must ALSO
  // consult its OWN exclusion list — a read-through card can be excluded
  // even though it never goes through `loadFormatPools`'s Wall-pool filter
  // (the read-through advances through every card of its book in strict
  // sequence, independent of pool membership). `enchiridion-11-001` is a
  // real card this suite excludes from Wall to prove the fallback cascade
  // (`resolveReadThrough`) actually lands on another format rather than
  // merely not crashing.
  //
  // Pf39c2-social-pilot-02a D01: this used to land on Question or Objection
  // (both real candidates for this specific card, pre-deletion); both
  // formats were deleted outright, so `tryReadThroughContent` now always
  // returns null for them and the cascade falls all the way through to the
  // STILL fallback (F19) instead — still a real, non-"wall" format, still
  // proving the cascade works, just one step further down it now.
  // -------------------------------------------------------------------------
  it("cascades the read-through to the Still fallback when its next sequential card is excluded from Wall", () => {
    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    const excludedIndex = enchiridionCards.findIndex((c) => c.id === "enchiridion-11-001");
    expect(excludedIndex).toBeGreaterThanOrEqual(0);

    const readThroughExclusions = new Set(["enchiridion-11-001"]);

    // Force the weighted candidate draw to "wall" every time, so the
    // fallback cascade is exercised deterministically rather than by luck
    // of the seed.
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: excludedIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      readThroughExclusions,
    });

    const day1 = week.slots.find((s) => s.day === 1 && s.read_through)!;
    expect(day1.card_id).toBe("enchiridion-11-001");
    expect(day1.content.format).toBe("still");
    // Faithful to the card's own text, not fabricated.
    const card = cards.find((c) => c.id === "enchiridion-11-001")!;
    if (day1.content.format === "still") {
      expect(day1.content.text).toBe(card.plain_english);
    }
  });

  it("without readThroughExclusions passed to generateWeek, the read-through's wall branch behaves exactly as before F05/F06", () => {
    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    const startIndex = enchiridionCards.findIndex((c) => c.id === "enchiridion-11-001");

    const withoutExclusions = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: startIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      // readThroughExclusions deliberately omitted.
    });

    const day1 = withoutExclusions.slots.find((s) => s.day === 1 && s.read_through)!;
    expect(day1.card_id).toBe("enchiridion-11-001");
    // With no exclusion list, the forced-wall candidate renders as wall,
    // exactly as it always has.
    expect(day1.content.format).toBe("wall");
  });
});

// ---------------------------------------------------------------------------
// F19: the read-through's STILL FALLBACK — resolveReadThrough's terminal
// step, reached only once Wall/Question/Objection are all exhausted (see
// `RenderedFormat`, `StillSlotContent`, and this file's own doc comment).
//
// Pf39c2-social-pilot-02a D01: Question and Objection were deleted outright
// (the channel is one Wall a day, drawn from the Wall pool, nothing else),
// so `tryReadThroughContent` now returns `null` for both UNCONDITIONALLY —
// every card in the REAL default Meditations Books 2-3 slice has "zero
// Question/Objection candidates" now, not just this slice's own 48. A card
// excluded from Wall has nowhere to go but the Still fallback, exactly the
// scenario F19 exists for — this used to also ground that fact directly
// against `questionGate`/`objectionGate` for this specific slice; that
// grounding check called functions that no longer exist and is gone with
// them.
// ---------------------------------------------------------------------------

describe("F19: the read-through STILL fallback", () => {
  // Chapter-then-card_number order (book-02 in full, then book-03 in full)
  // — mirrors `buildReadThroughSequence`'s own ordering exactly (grouping by
  // chapter FIRST, in the given chapter order, then sorting each group by
  // card_number) rather than a flat sort across both chapters combined,
  // which would wrongly interleave the two chapters' own independent
  // card_number sequences.
  const meditationsSlice = ["book-02", "book-03"].flatMap((chapterSlug) =>
    cards
      .filter((c) => c.book_slug === "meditations" && c.chapter_slug === chapterSlug)
      .sort((a, b) => a.card_number - b.card_number),
  );

  // meditations-02-003 (58-word original_excerpt) is one of the plan's own
  // named examples of a card too short to clear the Wall gate's travel
  // target.
  const shortCardIndex = meditationsSlice.findIndex((c) => c.id === "meditations-02-003");

  it("resolves to the STILL fallback when Wall is excluded and no Question/Objection candidate exists", () => {
    const readThroughExclusions = new Set(["meditations-02-003"]);

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-02", "book-03"],
      readThroughStartIndex: shortCardIndex,
      // Force the weighted candidate draw to "wall" every time, so the
      // cascade is exercised deterministically rather than by luck of seed.
      weights: { wall: 100, question: 0, objection: 0 },
      readThroughExclusions,
    });

    const day1 = week.slots.find((s) => s.day === 1 && s.read_through)!;
    expect(day1.card_id).toBe("meditations-02-003");
    expect(day1.content.format).toBe("still");
  });

  it("the still content is the card's plain_english, verbatim, in full — never trimmed or reworded", () => {
    const readThroughExclusions = new Set(["meditations-02-003"]);
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-02", "book-03"],
      readThroughStartIndex: shortCardIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      readThroughExclusions,
    });

    const day1 = week.slots.find((s) => s.day === 1 && s.read_through)!;
    if (day1.content.format !== "still") throw new Error("expected a still slot");
    const card = cards.find((c) => c.id === "meditations-02-003")!;
    expect(day1.content.text).toBe(card.plain_english);
  });

  it("a card that CAN render a Wall still gets a Wall — the fallback must not steal normal cards", () => {
    // meditations-02-004 — not excluded, and (unlike meditations-02-002) has
    // a real qualifying landing line (T02: `selectLandingLine` finds one),
    // so a still fallback must never be reachable for it.
    const normalCardIndex = meditationsSlice.findIndex((c) => c.id === "meditations-02-004");
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-02", "book-03"],
      readThroughStartIndex: normalCardIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      // No readThroughExclusions — this card is not excluded from anything.
    });

    const day1 = week.slots.find((s) => s.day === 1 && s.read_through)!;
    expect(day1.card_id).toBe("meditations-02-004");
    expect(day1.content.format).toBe("wall");
  });

  it("throws when even the STILL fallback is excluded — nothing left to fall back to", () => {
    const readThroughExclusions = new Set(["meditations-02-003"]);
    const stillExclusions = new Set(["meditations-02-003"]);

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "meditations",
        readThroughChapters: ["book-02", "book-03"],
        readThroughStartIndex: shortCardIndex,
        weights: { wall: 100, question: 0, objection: 0 },
        readThroughExclusions,
        stillExclusions,
      }),
    ).toThrow(/STILL fallback/i);
  });

  it("without stillExclusions passed at all, the Still fallback runs ungated (accepts every card)", () => {
    const readThroughExclusions = new Set(["meditations-02-003"]);

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-02", "book-03"],
      readThroughStartIndex: shortCardIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      readThroughExclusions,
      // stillExclusions deliberately omitted.
    });

    const day1 = week.slots.find((s) => s.day === 1 && s.read_through)!;
    expect(day1.content.format).toBe("still");
  });

  it("format_counts tallies still slots under their own key, not folded into wall/question/objection", () => {
    const readThroughExclusions = new Set(["meditations-02-003", "meditations-02-004", "meditations-02-007"]);
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-02", "book-03"],
      readThroughStartIndex: shortCardIndex,
      weights: { wall: 100, question: 0, objection: 0 },
      readThroughExclusions,
    });

    const stillSlots = week.slots.filter((s) => s.content.format === "still");
    expect(stillSlots.length).toBeGreaterThan(0);
    expect(week.format_counts.still).toBe(stillSlots.length);
  });
});

// ---------------------------------------------------------------------------
// T19 regression test: the actual reported failure. The T11 smoke run wrote
// `[]` to wall/question/objection.json after every request errored, and
// `generate-schedule` then died with "No format pool entries left to
// schedule day 1 of week 1 — pools exhausted." because the (present but
// empty) pool files were treated as real, exhausted pools rather than
// falling back to the mechanical gates. This proves the fix end-to-end,
// through `loadFormatPools` AND `generateWeek` together, not just the
// loader in isolation.
// ---------------------------------------------------------------------------
describe("T19 regression — empty pool files never brick generateWeek", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-pools-empty-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("generates a full week from empty (legacy-shape) pool files with no 'pools exhausted' error", async () => {
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify([]));
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify([]));
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify([]));

    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source).toEqual({ wall: "gate-only", question: "gate-only", objection: "gate-only" });

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 42,
        cards,
        pools,
        poolSource: source,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      }),
    ).not.toThrow();

    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools,
      poolSource: source,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
    });
    expect(week.slots).toHaveLength(14);
  });

  it("generates a full week from empty (envelope-shape) pool files with no 'pools exhausted' error", async () => {
    const zeroMeta = { submitted: 30, succeeded: 0, dropped: 30, limited: false, generated_at: "2026-08-25T00:00:00.000Z" };
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify({ meta: zeroMeta, entries: [] }));
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify({ meta: zeroMeta, entries: [] }));
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify({ meta: zeroMeta, entries: [] }));

    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source).toEqual({ wall: "gate-only", question: "gate-only", objection: "gate-only" });

    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools,
      poolSource: source,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
    });
    expect(week.slots).toHaveLength(14);
  });
});

// ---------------------------------------------------------------------------
// loadPriorWeeks — reads real week files off disk.
// ---------------------------------------------------------------------------

describe("loadPriorWeeks", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-prior-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns empty state when no prior week files exist (week 1)", async () => {
    const state = await loadPriorWeeks(tempDir, 1);
    expect(state.usedCardIds.size).toBe(0);
    expect(state.readThroughConsumed).toBe(0);
  });

  it("aggregates used card ids and read-through count across prior week files", async () => {
    const week1 = makeWeek(1, 42);
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));

    const state = await loadPriorWeeks(tempDir, 2);
    expect(state.readThroughConsumed).toBe(7);
    expect(state.usedCardIds.size).toBe(14);
    for (const slot of week1.slots) {
      expect(state.usedCardIds.has(slot.card_id)).toBe(true);
    }
  });

  it("ignores weeks at or after the requested week number", async () => {
    const week1 = makeWeek(1, 42);
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));
    const week2 = makeWeek(2, 42, new Set(week1.slots.map((s) => s.card_id)), 7);
    await writeFile(path.join(tempDir, "pilot-schedule-w02.json"), JSON.stringify(week2));

    // Requesting state for week 2 should only read week 1.
    const state = await loadPriorWeeks(tempDir, 2);
    expect(state.readThroughConsumed).toBe(7);
  });

  // -------------------------------------------------------------------------
  // M1: a missing prior-week file in the MIDDLE of the range must reject,
  // not silently read as "no prior week" — that would re-open its cards and
  // rewind the read-through counter (reproduced: w01-w03 generated, w02
  // moved aside, w04 duplicated 7 cards and rewound 7 more).
  // -------------------------------------------------------------------------
  it("rejects when an earlier week's file is missing (a gap in the range), naming the missing file", async () => {
    const week1 = makeWeek(1, 42);
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));
    // w02 deliberately never written — simulates it being moved/deleted.
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week3 = makeWeek(3, 42, week1Ids, 7);
    await writeFile(path.join(tempDir, "pilot-schedule-w03.json"), JSON.stringify(week3));

    await expect(loadPriorWeeks(tempDir, 4)).rejects.toThrow(/pilot-schedule-w02\.json/);
  });

  it("rejects a prior week file whose slots field is missing, not an array, or empty (corrupt)", async () => {
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify({ week: 1 }));
    await expect(loadPriorWeeks(tempDir, 2)).rejects.toThrow(/slots/i);

    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify({ week: 1, slots: "not-an-array" }));
    await expect(loadPriorWeeks(tempDir, 2)).rejects.toThrow(/slots/i);

    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify({ week: 1, slots: [] }));
    await expect(loadPriorWeeks(tempDir, 2)).rejects.toThrow(/slots/i);
  });
});

// ---------------------------------------------------------------------------
// Default weights reflect the plan's stated cadence directly — Wall and
// Question daily, Objection weekly — applied to BOTH of the week's 14 slots
// (the read-through slot's format is drawn from these same weights, not
// hardcoded to "wall"; see the module doc comment). Proportional to the
// target 14-slot split (7 Wall / 6 Question / 1 Objection) so Wall actually
// gets drawn in the non-read-through slot too, keeping T05's author
// balancing lever connected.
// ---------------------------------------------------------------------------

describe("DEFAULT_FORMAT_WEIGHTS", () => {
  it("weights Wall highest, Question next, Objection lightly — proportional to the 7/6/1 target split", () => {
    expect(DEFAULT_FORMAT_WEIGHTS.wall).toBeGreaterThan(0);
    expect(DEFAULT_FORMAT_WEIGHTS.wall).toBeGreaterThan(DEFAULT_FORMAT_WEIGHTS.question);
    expect(DEFAULT_FORMAT_WEIGHTS.question).toBeGreaterThan(DEFAULT_FORMAT_WEIGHTS.objection);
  });

  // A single week is too small a sample to prove a weighting property (7 or
  // 14 draws of a random choice can land anywhere) — mirrors this file's own
  // established pattern for exactly this concern (see "honours the Wall's
  // author-balancing weights over a large draw (directional)" above).
  // Aggregating 20 independent, non-overlapping weeks (fixed seeds 1-20, so
  // this is deterministic and never flaky) over 280 total slots is enough to
  // show the shape of the distribution reliably.
  function aggregateDefaultWeeks(n: number) {
    let epictetusCount = 0;
    let totalSlots = 0;
    const formatTotals: Record<ScheduleFormat, number> = { wall: 0, question: 0, objection: 0 };
    let nonReadThroughWallCount = 0;
    for (let seed = 1; seed <= n; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(), // isolate each week — this is a format-mix sample, not a multi-week sequence
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      });
      epictetusCount += week.author_mix.epictetus?.count ?? 0;
      totalSlots += week.slots.length;
      formatTotals.wall += week.format_counts.wall;
      formatTotals.question += week.format_counts.question;
      formatTotals.objection += week.format_counts.objection;
      nonReadThroughWallCount += week.slots.filter((s) => !s.read_through && s.content.format === "wall").length;
    }
    return { epictetusShare: epictetusCount / totalSlots, formatTotals, nonReadThroughWallCount };
  }

  // Pf39c2-social-pilot-02a D01: this used to also assert
  // `formatTotals.question`/`formatTotals.objection` were both greater than
  // 0 — both formats were deleted outright (`gatePools.question`/
  // `gatePools.objection` are always empty now), so no generated week can
  // ever draw either one; asserting the opposite (always exactly 0) is the
  // new, correct invariant.
  it("produces only the Wall format across default weeks, with The Wall present in non-read-through slots", () => {
    const { formatTotals, nonReadThroughWallCount } = aggregateDefaultWeeks(20);
    expect(formatTotals.wall).toBeGreaterThan(0);
    expect(formatTotals.question).toBe(0);
    expect(formatTotals.objection).toBe(0);
    // The defect this fixes: Wall's weight of 0 in the weighted slot meant
    // it could ONLY ever appear via the (then-hardcoded) read-through slot,
    // so `selectWallBalanced` and T03's ranked pool never actually ran.
    expect(nonReadThroughWallCount).toBeGreaterThan(0);
  });

  it("keeps T05's lever connected: default weeks' combined Epictetus share is materially below the pre-fix 71.4%", () => {
    // Pre-fix (Wall weight 0 in the weighted slot, read-through hardcoded to
    // "wall"), week 1 (seed 42) measured epictetus 10/14 = 71.4%. Note the
    // read-through's OWN dynamic draw still resolves to "wall" on almost
    // every day regardless of these weights — measured directly against the
    // corpus, only 8 of Enchiridion's 70 cards can render Question and only
    // 4 can render Objection, so a non-wall candidate almost always cascades
    // back to Wall (see `resolveReadThrough`) — so the lever this test pins
    // is entirely the weighted slot's now-nonzero Wall weight pulling
    // author mix toward the Wall pool's Meditations/Seneca-heavy balance
    // (`wallAuthorWeights`), not a change in the read-through's own output.
    const { epictetusShare } = aggregateDefaultWeeks(20);
    expect(epictetusShare).toBeLessThan(0.7);
  });
});

// ---------------------------------------------------------------------------
// T13: thorough coverage of the four acceptance properties.
//
// T12 already proves the LETTER of "byte-identical regeneration", "no
// cross-week reuse", "weighting honoured" (directionally) and "sequential
// read-through" (within/across two weeks, exhaustion throws). This block
// goes further per T13's own scope: multi-seed/multi-weight determinism
// divergence, disk-backed multi-week chains (4 weeks, the pilot's full
// length), statistical weighting checks with a tolerance, and independent
// verification of the read-through's ordering against the corpus's own
// chapter_slug/card_number fields rather than a string sort on card id.
// ---------------------------------------------------------------------------

describe("T13: determinism (extended)", () => {
  it("produces different output for the same seed when weights differ", () => {
    const a = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 7, question: 6, objection: 1 },
    });
    const b = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 1, question: 1, objection: 1 },
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("produces different output for the same seed when prior-week history differs", () => {
    // Exclude a batch of real Wall-pool card ids (NOT from the read-through
    // book, so the read-through slot's own fixed sequence is untouched) so
    // only the weighted-slot pools differ between the two runs.
    //
    // Pf39c2-social-pilot-02a D01: with Question and Objection deleted
    // outright, EVERY non-read-through slot now draws Wall (the only format
    // left) instead of sometimes drawing Question/Objection — so a Wall
    // draw now runs 7 times a week instead of ~3-4, and `wallAuthorWeights`
    // pushes those draws heavily toward marcus-aurelius/seneca, away from
    // epictetus (T05). Excluding an arbitrary slice of the front of the pool
    // (mostly epictetus's own Discourses, alphabetically first) is no longer
    // enough to guarantee a perturbation this suite can observe — excluding
    // a batch of the marcus-aurelius/seneca entries the weighting actually
    // favours is what reliably does.
    const excluded = new Set(
      gatePools.wall
        .filter((e) => e.book_slug !== "enchiridion" && e.author_slug !== "epictetus")
        .slice(0, 50)
        .map((e) => e.card_id),
    );
    const a = generateWeek({
      weekNumber: 2,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
    });
    const b = generateWeek({
      weekNumber: 2,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: excluded,
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
    });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("contains no timestamp-shaped field anywhere in the serialized week (a generation time would break byte-identity)", () => {
    const week = makeWeek(1, 42);
    const suspiciousKeyPattern = /time(?!_seconds)|timestamp|generated_at|created_at|updated_at|date/i;

    function walk(value: unknown, path: string): void {
      if (value === null || typeof value !== "object") return;
      for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
        expect(suspiciousKeyPattern.test(key)).toBe(false);
        walk(v, `${path}.${key}`);
      }
    }
    walk(week, "week");

    // Belt-and-braces: no ISO-8601 timestamp substring anywhere in the JSON
    // (would indicate a Date got serialized into a string field).
    const serialized = JSON.stringify(week);
    expect(serialized).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  describe("across a disk-persisted multi-week chain", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "schedule-t13-determinism-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    async function writeWeek(week: number, seed: number): Promise<WeekSchedule> {
      const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(tempDir, week);
      const schedule = generateWeek({
        weekNumber: week,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: usedCardIds,
        readThroughBook: "enchiridion",
        readThroughStartIndex: readThroughConsumed,
      });
      await writeFile(
        path.join(tempDir, `pilot-schedule-w${String(week).padStart(2, "0")}.json`),
        JSON.stringify(schedule, null, 2) + "\n",
        "utf-8",
      );
      return schedule;
    }

    it("regenerating week 3 twice, with weeks 1-2 already on disk, is byte-identical", async () => {
      await writeWeek(1, 42);
      await writeWeek(2, 42);

      // Generate week 3 twice from independent fresh reads of the same
      // on-disk prior weeks — do NOT persist either result, so the second
      // read is unaffected by the first.
      const { usedCardIds: used1, readThroughConsumed: rt1 } = await loadPriorWeeks(tempDir, 3);
      const week3a = generateWeek({
        weekNumber: 3,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: used1,
        readThroughBook: "enchiridion",
        readThroughStartIndex: rt1,
      });
      const { usedCardIds: used2, readThroughConsumed: rt2 } = await loadPriorWeeks(tempDir, 3);
      const week3b = generateWeek({
        weekNumber: 3,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: used2,
        readThroughBook: "enchiridion",
        readThroughStartIndex: rt2,
      });

      expect(JSON.stringify(week3a)).toBe(JSON.stringify(week3b));
    });
  });
});

describe("T13: no cross-week repeats (extended, disk-backed, 4-week chain)", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-t13-no-repeat-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  async function generateChain(n: number, seed: number): Promise<WeekSchedule[]> {
    const weeks: WeekSchedule[] = [];
    for (let w = 1; w <= n; w++) {
      // Loaded fresh from disk each iteration (not carried over in memory)
      // — this is the same contract `scripts/generate-schedule.ts` relies on.
      const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(tempDir, w);
      const schedule = generateWeek({
        weekNumber: w,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: usedCardIds,
        readThroughBook: "enchiridion",
        readThroughStartIndex: readThroughConsumed,
      });
      await writeFile(
        path.join(tempDir, `pilot-schedule-w${String(w).padStart(2, "0")}.json`),
        JSON.stringify(schedule, null, 2) + "\n",
        "utf-8",
      );
      weeks.push(schedule);
    }
    return weeks;
  }

  it("has no duplicate card id across the union of 4 consecutive weeks (56 slots, the pilot's full length)", async () => {
    const weeks = await generateChain(4, 42);
    const allIds = weeks.flatMap((w) => w.slots.map((s) => s.card_id));
    expect(allIds).toHaveLength(56);
    expect(new Set(allIds).size).toBe(56);
  });

  it("excludes week 2's cards using state read from a fresh disk load of week 1 (not in-memory carryover)", async () => {
    const week1 = await generateChain(1, 42).then((weeks) => weeks[0]);

    // Simulate a completely separate process invocation: nothing from
    // `week1` above is passed directly into the next call — only what
    // `loadPriorWeeks` reads back off disk.
    const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(tempDir, 2);
    const week2 = generateWeek({
      weekNumber: 2,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: usedCardIds,
      readThroughBook: "enchiridion",
      readThroughStartIndex: readThroughConsumed,
    });

    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    for (const slot of week2.slots) {
      expect(week1Ids.has(slot.card_id)).toBe(false);
    }
  });

  it("still excludes a week-1 card from week 4", async () => {
    const weeks = await generateChain(4, 42);
    const week1Ids = new Set(weeks[0].slots.map((s) => s.card_id));
    const week4Ids = weeks[3].slots.map((s) => s.card_id);
    for (const id of week4Ids) {
      expect(week1Ids.has(id)).toBe(false);
    }
    // And, concretely, a specific week-1 card is not merely "some card" but
    // is genuinely absent — pin one by value.
    const [pinnedCard] = weeks[0].slots;
    expect(week4Ids).not.toContain(pinnedCard.card_id);
  });
});

describe("T13: weighting honoured (statistical, with tolerance)", () => {
  it("an all-Wall weighting yields only Wall in the weighted (non-read-through) slot, across several seeds", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 1, question: 0, objection: 0 },
      });
      for (const slot of week.slots.filter((s) => !s.read_through)) {
        expect(slot.content.format).toBe("wall");
      }
    }
  });

  it("a zero-weight format never appears in the weighted (non-read-through) slot, for both Question and Objection", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const weekNoQuestion = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 5, question: 0, objection: 0 },
      });
      for (const slot of weekNoQuestion.slots.filter((s) => !s.read_through)) {
        expect(slot.content.format).not.toBe("question");
      }

      const weekNoObjection = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 5, question: 5, objection: 0 },
      });
      for (const slot of weekNoObjection.slots.filter((s) => !s.read_through)) {
        expect(slot.content.format).not.toBe("objection");
      }
    }
  });

  it("caps Objection at 1 per week across multiple seeds even at an extreme weight", () => {
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 0, question: 0, objection: 100000 },
        maxObjectionPerWeek: 1,
      });
      expect(week.format_counts.objection).toBeLessThanOrEqual(1);
    }
  });

  // Pf39c2-social-pilot-02a D01: this used to also carry a genuine
  // distributional check — aggregating the weighted slot's format across 40
  // independent weeks and confirming the realized Wall:Question proportions
  // tracked the requested weight ratio (1:1, then 1:3) within tolerance.
  // Question was deleted outright (the channel is one Wall a day, drawn
  // from the Wall pool, nothing else): `weightedFormatChoice`'s `available`
  // filter now excludes it unconditionally regardless of weight, so no
  // weight ratio involving Question can be demonstrated any more — the test
  // (and its `aggregateWeightedSlotCounts` helper) went with it.
});

describe("T13: read-through sequencing (strict, multi-week, order-verified)", () => {
  const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");

  it("Enchiridion has 70 cards — grounding the pilot's own stated numbers (4 weeks / 28 cards does not exhaust it)", () => {
    expect(enchiridionCards).toHaveLength(70);
  });

  /**
   * Reconstruct the book's "true" reading order directly from each card's
   * own `chapter_slug` / `card_number` fields — grouping chapters by first
   * appearance and sorting within a chapter by `card_number` — rather than
   * by sorting card ids as strings. This is independent of the id format
   * (which happens to already encode chapter/card number) and would catch a
   * regression where the corpus's file-read order stopped matching the
   * book's own semantic chapter/card sequence.
   */
  function trueReadingOrder(allCards: Card[], bookSlug: string): Card[] {
    const bookCards = allCards.filter((c) => c.book_slug === bookSlug);
    const chapterOrder: string[] = [];
    const byChapter = new Map<string, Card[]>();
    for (const c of bookCards) {
      if (!byChapter.has(c.chapter_slug)) {
        byChapter.set(c.chapter_slug, []);
        chapterOrder.push(c.chapter_slug);
      }
      byChapter.get(c.chapter_slug)!.push(c);
    }
    const ordered: Card[] = [];
    for (const slug of chapterOrder) {
      const group = [...byChapter.get(slug)!].sort((a, b) => a.card_number - b.card_number);
      ordered.push(...group);
    }
    return ordered;
  }

  it("the corpus's own card order for Enchiridion matches its chapter_slug/card_number order (not merely an id string sort)", () => {
    const expected = trueReadingOrder(cards, "enchiridion");
    expect(enchiridionCards.map((c) => c.id)).toEqual(expected.map((c) => c.id));
  });

  describe("across a disk-persisted 4-week chain", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "schedule-t13-readthrough-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    it("the read-through card numbers form exactly the contiguous sequence 1..28, one per day, in the book's true reading order", async () => {
      const trueOrder = trueReadingOrder(cards, "enchiridion");
      const readThroughSlotsByWeek: (typeof trueOrder)[] = [];
      const allReadThroughCards: Card[] = [];

      for (let w = 1; w <= 4; w++) {
        const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(tempDir, w);
        const schedule = generateWeek({
          weekNumber: w,
          seed: 42,
          cards,
          pools: gatePools,
          poolSource,
          priorUsedCardIds: usedCardIds,
          readThroughBook: "enchiridion",
          readThroughStartIndex: readThroughConsumed,
        });
        await writeFile(
          path.join(tempDir, `pilot-schedule-w${String(w).padStart(2, "0")}.json`),
          JSON.stringify(schedule, null, 2) + "\n",
          "utf-8",
        );

        // Exactly one slot per day carries the read-through, for every day
        // of every week in the chain.
        for (let day = 1; day <= 7; day++) {
          const daySlots = schedule.slots.filter((s) => s.day === day);
          expect(daySlots.filter((s) => s.read_through)).toHaveLength(1);
        }

        const weekReadThroughIds = schedule.slots
          .filter((s) => s.read_through)
          .sort((a, b) => a.day - b.day)
          .map((s) => s.card_id);
        const weekReadThroughCards = weekReadThroughIds.map((id) => cards.find((c) => c.id === id)!);
        readThroughSlotsByWeek.push(weekReadThroughCards);
        allReadThroughCards.push(...weekReadThroughCards);
      }

      // No gap, no repeat: the combined 28-card sequence is EXACTLY the
      // book's own true reading order's first 28 cards, in that exact order.
      expect(allReadThroughCards.map((c) => c.id)).toEqual(trueOrder.slice(0, 28).map((c) => c.id));
      expect(new Set(allReadThroughCards.map((c) => c.id)).size).toBe(28);

      // Each week is a contiguous 7-card block of that same sequence.
      for (let w = 0; w < 4; w++) {
        expect(readThroughSlotsByWeek[w].map((c) => c.id)).toEqual(trueOrder.slice(w * 7, w * 7 + 7).map((c) => c.id));
      }

      // The "Card N of 70" counters printed on-screen are themselves the
      // contiguous sequence 1..28 with no skip and no repeat.
      const allCounters = [];
      for (let w = 1; w <= 4; w++) {
        const raw = JSON.parse(await readFile(path.join(tempDir, `pilot-schedule-w${String(w).padStart(2, "0")}.json`), "utf-8")) as WeekSchedule;
        const counters = raw.slots
          .filter((s) => s.read_through)
          .sort((a, b) => a.day - b.day)
          .map((s) => Number(s.read_through_counter!.match(/Card (\d+) of/)![1]));
        allCounters.push(...counters);
      }
      expect(allCounters).toEqual(Array.from({ length: 28 }, (_, i) => i + 1));
    });
  });

  it("behaves sanely (throws a clear error, no skip or repeat) rather than crashing when the read-through book runs out mid-generation", () => {
    // Start one day short of the end (69 cards used, 1 left: index 69, the
    // 70th and final card) — the week's FIRST read-through slot (day 1)
    // succeeds on that final card, but day 2 has nothing left.
    expect(() =>
      generateWeek({
        weekNumber: 11,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: enchiridionCards.length - 1,
      }),
    ).toThrow(/complete|exhausted/i);
  });

  it("a week landing exactly on the book's last card (index 63..69 of 70) succeeds with no skip, no repeat, no throw", () => {
    const startIndex = enchiridionCards.length - 7; // 63 — the week's 7 days exactly consume cards 64..70
    const week = generateWeek({
      weekNumber: 10,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: startIndex,
    });
    const readThroughIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(readThroughIds).toEqual(enchiridionCards.slice(startIndex).map((c) => c.id));

    const counters = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => Number(s.read_through_counter!.match(/Card (\d+) of (\d+)/)!.slice(1).map(Number)[0]));
    expect(counters).toEqual([64, 65, 66, 67, 68, 69, 70]);

    // One card past the end (day 8, i.e. a week starting one card later)
    // throws sanely rather than skipping/repeating/crashing with something
    // other than a clear error.
    expect(() =>
      generateWeek({
        weekNumber: 11,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(week.slots.filter((s) => s.read_through).map((s) => s.card_id)),
        readThroughBook: "enchiridion",
        readThroughStartIndex: startIndex + 7,
      }),
    ).toThrow(/complete|exhausted/i);
  });
});

// ---------------------------------------------------------------------------
// M2 (PR #39 review): read-through Question slots must pass the same T04
// gates (layer (a)/(b)) that the weighted-slot pool already enforces via
// `questionGate`. Pre-fix, `tryReadThroughContent` called
// `findQuestionCandidate`/`questionCandidateAnswer` raw, admitting
// candidates layer (a)/(b) would have rejected — e.g. an answer that is
// itself another question.
// ---------------------------------------------------------------------------

// Pf39c2-social-pilot-02a D01: The Question was deleted outright (the
// channel is one Wall a day, drawn from the Wall pool, nothing else) — a
// read-through slot can never resolve to "question" any more
// (`tryReadThroughContent` returns `null` for it unconditionally), so this
// describe's whole premise (gating a real question-format read-through
// slot) no longer applies. `passesLayerA`/`passesLayerB` — the two
// functions it exercised — were deleted along with The Question itself.

// ---------------------------------------------------------------------------
// M3 (PR #39 review): an Objection entry whose reply is empty must never be
// scheduled, even when it's the ONLY entry available for a weighted slot —
// filtered out of the pool itself so it can't be drawn, not skipped after
// selection (which would waste an rng draw or crash the day).
// ---------------------------------------------------------------------------

describe("M3: empty-reply Objection entries are excluded from the pool", () => {
  function fabricatedCard(id: string, plainEnglish: string, bookSlug: string): Card {
    return {
      id,
      book_slug: bookSlug,
      chapter_slug: "ch1",
      card_number: 1,
      total_cards_in_chapter: 1,
      plain_english: plainEnglish,
      original_excerpt: plainEnglish,
      source_reference: "test",
      author_slug: "epictetus",
      tags: [],
      reading_time_seconds: 10,
    };
  }

  it("never schedules an Objection entry whose reply is empty, even weighted to dominate every draw", () => {
    const readThroughCards = Array.from({ length: 7 }, (_, i) =>
      fabricatedCard(`m3-rt-${i + 1}`, `Read-through sentence number ${i + 1}.`, "m3-readthrough"),
    );

    const emptyReplyCard = fabricatedCard("m3-empty-reply", `He said, "But I want my children and wife with me."`, "m3-pool");
    const validCard = fabricatedCard(
      "m3-valid-reply",
      `He said, "But this is unbearable." That is not so; nothing forces you to suffer.`,
      "m3-pool",
    );
    // Enough Wall fallback cards to keep days 2-7's weighted slot fed once
    // the week's single valid Objection entry (and the weekly cap) are
    // used up on day 1.
    const wallFallbackCards = Array.from({ length: 6 }, (_, i) =>
      fabricatedCard(`m3-wall-${i + 1}`, `Wall fallback sentence number ${i + 1} standing alone.`, "m3-pool"),
    );

    const allCards = [...readThroughCards, emptyReplyCard, validCard, ...wallFallbackCards];

    // `reply_start` is derived the same way `objectionGate` itself derives
    // it (the offset right after the quoted span closes) rather than
    // hardcoded, so these fixtures stay correct if the card text above ever
    // changes — see M8/M9 in the PR #39 second review round, which is what
    // made `reply_start` a required field on every `ObjectionEntry`.
    const emptyReplyQuoted = `"But I want my children and wife with me."`;
    const validQuoted = `"But this is unbearable."`;
    const objectionPool = [
      {
        card_id: emptyReplyCard.id,
        book_slug: emptyReplyCard.book_slug,
        author_slug: emptyReplyCard.author_slug,
        objection: "But I want my children and wife with me.",
        reply: "",
        reply_start: emptyReplyCard.plain_english.indexOf(emptyReplyQuoted) + emptyReplyQuoted.length,
      },
      {
        card_id: validCard.id,
        book_slug: validCard.book_slug,
        author_slug: validCard.author_slug,
        objection: "But this is unbearable.",
        reply: "That is not so; nothing forces you to suffer.",
        reply_start: validCard.plain_english.indexOf(validQuoted) + validQuoted.length,
      },
    ];

    const wallPool = wallFallbackCards.map((c) => ({
      card_id: c.id,
      book_slug: c.book_slug,
      author_slug: c.author_slug,
      original_word_count: 20,
      landing_line: c.plain_english,
      sub_types: [],
      reserve: false,
      archaic_marker_count: 0,
      semicolon_count: 0,
      quote_count: 0,
      original_grade: 5,
    }));

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards: allCards,
      pools: { wall: wallPool, question: [], objection: objectionPool },
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "m3-readthrough",
      readThroughStartIndex: 0,
      weights: { wall: 0, question: 0, objection: 1 }, // objection dominates every available draw
    });

    // The empty-reply card is never scheduled, in either slot.
    expect(week.slots.some((s) => s.card_id === emptyReplyCard.id)).toBe(false);

    // The valid entry IS scheduled (capped at 1/week) and carries a
    // non-empty reply.
    const objectionSlots = week.slots.filter((s) => s.content.format === "objection");
    expect(objectionSlots).toHaveLength(1);
    expect(objectionSlots[0].card_id).toBe(validCard.id);
    if (objectionSlots[0].content.format === "objection") {
      expect(objectionSlots[0].content.reply.trim().length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// M4 (PR #39 review): faithfulness is THE central safety property — every
// on-screen string must be traceable to its card's own `plain_english` or
// `original_excerpt`. Enforced mechanically in `generateWeek` right before
// each slot is pushed; this test independently re-verifies the property
// over real corpus output across many seeds, covering fields no prior test
// checked (`reply`, and every weighted-slot field).
// ---------------------------------------------------------------------------

describe("M4: faithfulness holds for every on-screen field, every slot", () => {
  it("every content string is a verbatim substring of its card's plain_english or original_excerpt, across seeds 1..20", () => {
    let checkedFieldCount = 0;
    for (let seed = 1; seed <= 20; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
      });
      for (const slot of week.slots) {
        const card = cards.find((c) => c.id === slot.card_id)!;
        const fields: string[] =
          slot.content.format === "wall"
            ? [slot.content.landing_line]
            : slot.content.format === "question"
              ? [slot.content.question, slot.content.answer]
              : [slot.content.objection, slot.content.reply];
        for (const text of fields) {
          if (!text) continue;
          checkedFieldCount += 1;
          expect(checkFaithfulness(text, card).faithful).toBe(true);
        }
      }
    }
    expect(checkedFieldCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// M5 (PR #39 review): `contentFromEntry` must prefer the Wall rubric's
// `chosen_landing_line` over the mechanical `landing_line` when a scored
// pool provides one — otherwise a scored wall.json buys nothing over the
// gate-only fallback.
// ---------------------------------------------------------------------------

describe("M5: the Wall's rubric-chosen landing line is preferred over the mechanical one", () => {
  it("uses rubric.chosen_landing_line for a scored Wall entry, not the mechanical landing_line", () => {
    const baseEntry = gatePools.wall.find((e) => e.book_slug !== "enchiridion")!;
    const card = cards.find((c) => c.id === baseEntry.card_id)!;
    // A second, distinct sentence from the SAME card — guaranteed a verbatim
    // substring (M4 must still pass), and distinct from the mechanical pick
    // so this test can actually tell the two apart.
    const alternateLine = sentences(card.plain_english).find((s) => s !== baseEntry.landing_line);
    expect(alternateLine).toBeDefined();

    // Pf39c2-social-pilot-02a D01: Question and Objection were deleted
    // outright, so `gatePools.question`/`gatePools.objection` are always
    // empty now — a single-entry Wall pool used to be enough here because
    // the weighted slot could fall back to a real Question/Objection entry
    // once it ran out; with neither available any more, the Wall pool needs
    // enough entries of its own to cover all 7 non-read-through days. Sized
    // to EXACTLY 7 (one weighted slot per day) so `selectWallBalanced` must
    // draw every entry over the week, guaranteeing `baseEntry` itself is
    // scheduled rather than leaving that to chance.
    const scoredWallPool = [
      { ...baseEntry, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: alternateLine! } },
      ...gatePools.wall.filter((e) => e.card_id !== baseEntry.card_id && e.book_slug !== "enchiridion").slice(0, 6),
    ];

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      pools: { wall: scoredWallPool, question: gatePools.question, objection: gatePools.objection },
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
      weights: { wall: 1, question: 0, objection: 0 }, // Wall dominates every weighted draw
    });

    const wallSlot = week.slots.find((s) => s.card_id === baseEntry.card_id);
    expect(wallSlot).toBeDefined();
    expect(wallSlot!.content.format).toBe("wall");
    if (wallSlot!.content.format === "wall") {
      expect(wallSlot!.content.landing_line).toBe(alternateLine);
      expect(wallSlot!.content.landing_line).not.toBe(baseEntry.landing_line);
    }
  });
});

// ---------------------------------------------------------------------------
// M9 (PR #39 second review round): the blank-reply pool filter (and
// `assertFaithful`) must key off the ASSEMBLED reply — the exact text the
// slot will render — not a persisted `reply` field that can silently
// diverge from it (e.g. a scored `objection.json` written before a later
// corpus edit).
// ---------------------------------------------------------------------------

describe("M9: Objection filtering validates the ASSEMBLED reply, not the persisted field", () => {
  function fabricatedCard(id: string, plainEnglish: string, bookSlug: string): Card {
    return {
      id,
      book_slug: bookSlug,
      chapter_slug: "ch1",
      card_number: 1,
      total_cards_in_chapter: 1,
      plain_english: plainEnglish,
      original_excerpt: plainEnglish,
      source_reference: "test",
      author_slug: "epictetus",
      tags: [],
      reading_time_seconds: 10,
    };
  }

  it("excludes a pool entry whose persisted reply is stale (non-empty) but whose assembled reply is empty", () => {
    const readThroughCards = Array.from({ length: 7 }, (_, i) =>
      fabricatedCard(`m9-rt-${i + 1}`, `Read-through sentence number ${i + 1}.`, "m9-readthrough"),
    );
    // The quoted objection is the very last thing said in the CURRENT card —
    // a real re-scoring would assemble an empty reply from it — but the
    // persisted `reply` field (as if scored against an earlier draft of this
    // card that had more text afterward) still reads non-empty.
    const staleCard = fabricatedCard("m9-stale", `He said, "But this is truly unbearable for me."`, "m9-pool");
    // 7, not 6: unlike M3's fixture, the ONLY Objection entry here is
    // excluded from the pool from the very start (its assembled reply is
    // empty), so every one of the week's 7 weighted slots — not just the 6
    // remaining after day 1 — falls through to a Wall fallback card.
    const wallFallbackCards = Array.from({ length: 7 }, (_, i) =>
      fabricatedCard(`m9-wall-${i + 1}`, `Wall fallback sentence number ${i + 1} standing alone.`, "m9-pool"),
    );
    const allCards = [...readThroughCards, staleCard, ...wallFallbackCards];

    const quoted = `"But this is truly unbearable for me."`;
    const staleObjectionPool = [
      {
        card_id: staleCard.id,
        book_slug: staleCard.book_slug,
        author_slug: staleCard.author_slug,
        objection: "But this is truly unbearable for me.",
        reply: "The truth is that suffering passes.", // STALE — no longer matches the current card
        reply_start: staleCard.plain_english.indexOf(quoted) + quoted.length,
      },
    ];
    const wallPool = wallFallbackCards.map((c) => ({
      card_id: c.id,
      book_slug: c.book_slug,
      author_slug: c.author_slug,
      original_word_count: 20,
      landing_line: c.plain_english,
      sub_types: [],
      reserve: false,
      archaic_marker_count: 0,
      semicolon_count: 0,
      quote_count: 0,
      original_grade: 5,
    }));

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards: allCards,
      pools: { wall: wallPool, question: [], objection: staleObjectionPool },
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "m9-readthrough",
      readThroughStartIndex: 0,
      weights: { wall: 0, question: 0, objection: 1 }, // objection dominates every available draw
    });

    // The stale entry is never scheduled — the assembled reply is empty
    // even though the persisted `reply` field reads non-empty.
    expect(week.slots.some((s) => s.card_id === staleCard.id)).toBe(false);
    expect(week.format_counts.objection).toBe(0);
  });

  it("treats an empty scored Wall landing line as a faithfulness FAILURE, not something to silently skip", () => {
    const baseEntry = gatePools.wall.find((e) => e.book_slug !== "enchiridion")!;
    // `??` only falls back on null/undefined, not on an empty string — so a
    // rubric that (incorrectly) chose an empty line reaches `contentFromEntry`
    // as an empty `landing_line`, exactly the shape `assertFaithful` must now
    // reject rather than skip (see M9 in the PR #39 second review round).
    const scoredWallPool = [
      { ...baseEntry, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: "" } },
    ];

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        pools: { wall: scoredWallPool, question: gatePools.question, objection: gatePools.objection },
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 1, question: 0, objection: 0 }, // Wall dominates every weighted draw
      }),
    ).toThrow(/field "landing_line".*field is empty/);
  });
});

// ---------------------------------------------------------------------------
// M10 (PR #39 second review round): `assertFaithful` is THE central safety
// property, but nothing previously asserted that `generateWeek` actually
// throws when it fails — deleting the `assertFaithful` calls entirely left
// the suite green. These cases tamper a pool entry's on-screen field with
// text the author never wrote and assert the generator refuses to schedule
// it, naming the offending day, slot, and field in the thrown message.
// ---------------------------------------------------------------------------

describe("M10: generateWeek actually throws when a field fails the faithfulness check", () => {
  it("throws naming the field when a scored Wall entry's chosen_landing_line was never written by the author", () => {
    const baseEntry = gatePools.wall.find((e) => e.book_slug !== "enchiridion")!;
    const scoredWallPool = [
      {
        ...baseEntry,
        rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: "A line the author never wrote." },
      },
    ];

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        pools: { wall: scoredWallPool, question: gatePools.question, objection: gatePools.objection },
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 1, question: 0, objection: 0 }, // Wall dominates every weighted draw
      }),
    ).toThrow(/day 1 slot 2 \(card "[^"]+", field "landing_line"\)/);
  });

  // Pf39c2-social-pilot-02a D01: `gatePools.question` is always empty now
  // (Question was deleted outright) — a hand-built entry against a real
  // corpus card stands in, matching M9/M3's own synthetic-Objection-pool
  // pattern, so this can still prove `generateWeek`'s STILL-PRESENT Question
  // faithfulness check (collapsing that code path away is D02's job, not
  // this one's) throws naming the tampered field.
  it("names the day, slot, and field when a Question entry's answer was never written by the author", () => {
    const baseCard = cards.find((c) => c.book_slug !== "enchiridion")!;
    const realQuestion = sentences(baseCard.plain_english)[0];
    expect(baseCard.plain_english).toContain(realQuestion);
    const tamperedQuestionPool = [
      {
        card_id: baseCard.id,
        book_slug: baseCard.book_slug,
        author_slug: baseCard.author_slug,
        question: realQuestion,
        answer: "An answer the author never actually gave.",
      },
    ];

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        pools: { wall: gatePools.wall, question: tamperedQuestionPool, objection: gatePools.objection },
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 0, question: 1, objection: 0 }, // Question dominates every weighted draw
      }),
    ).toThrow(/day 1 slot 2 \(card "[^"]+", field "answer"\)/);
  });
});

// ---------------------------------------------------------------------------
// M11 (PR #39 second review round): `assembleObjectionReply`'s own error and
// correct-occurrence paths, previously untested.
// ---------------------------------------------------------------------------

describe("M11: assembleObjectionReply's error path and correct-occurrence resolution", () => {
  function fabricatedCard(id: string, plainEnglish: string, bookSlug: string): Card {
    return {
      id,
      book_slug: bookSlug,
      chapter_slug: "ch1",
      card_number: 1,
      total_cards_in_chapter: 1,
      plain_english: plainEnglish,
      original_excerpt: plainEnglish,
      source_reference: "test",
      author_slug: "epictetus",
      tags: [],
      reading_time_seconds: 10,
    };
  }

  it("throws '/not a verbatim quoted span/' when the entry's objection does not appear in plain_english", () => {
    const rtCard = fabricatedCard("m11-rt-1", "Read-through sentence one.", "m11-readthrough-1");
    const card = fabricatedCard(
      "m11-mismatch",
      'He grumbled, "But why should I suffer for this?" and walked off.',
      "m11-pool-1",
    );
    const objectionPool = [
      {
        card_id: card.id,
        book_slug: card.book_slug,
        author_slug: card.author_slug,
        objection: "But this text was never actually quoted anywhere.",
        reply: "irrelevant",
        reply_start: 0,
      },
    ];

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards: [rtCard, card],
        pools: { wall: [], question: [], objection: objectionPool },
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "m11-readthrough-1",
        readThroughStartIndex: 0,
        weights: { wall: 0, question: 0, objection: 1 },
      }),
    ).toThrow(/not a verbatim quoted span/);
  });

  // Pf39c2-social-pilot-02a D01: this used to also cover two regressions in
  // `objectionGate`'s OWN cursor-based reply_start disambiguation (M8, M12)
  // — a duplicated quoted span, and a duplicated whole sentence, each
  // resolving to the correct (not merely the first) occurrence. That gate
  // was deleted outright along with The Objection itself (the channel is
  // one Wall a day, drawn from the Wall pool, nothing else), so there is no
  // gate left to regress.

  it("throws '/missing a valid reply_start/' when a hand-built pool entry omits reply_start (M13)", () => {
    const rtCard = fabricatedCard("m13-rt-1", "Read-through sentence one.", "m13-readthrough-1");
    const card = fabricatedCard(
      "m13-missing-reply-start",
      'He grumbled, "But why should I suffer for this?" and walked off.',
      "m13-pool-1",
    );
    // A verbatim quoted span (passes the `includes` check in
    // `assembleObjectionReply`), but with no `reply_start` at all — the kind
    // of `objection.json` entry that could have been written before the M8
    // commit introduced the field. Cast is deliberate: this simulates
    // unvalidated JSON on disk, not a value ever produced by `objectionGate`
    // itself.
    const objectionPool = [
      {
        card_id: card.id,
        book_slug: card.book_slug,
        author_slug: card.author_slug,
        objection: "But why should I suffer for this?",
        reply: "irrelevant",
      } as unknown as import("../premises.js").ObjectionEntry,
    ];

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards: [rtCard, card],
        pools: { wall: [], question: [], objection: objectionPool },
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "m13-readthrough-1",
        readThroughStartIndex: 0,
        weights: { wall: 0, question: 0, objection: 1 },
      }),
    ).toThrow(/missing a valid reply_start/);
  });
});

// ---------------------------------------------------------------------------
// M14 (PR #39 fourth review round): the read-through Objection case's
// empty-reply guard (`tryReadThroughContent`) was previously unasserted —
// all 63 pre-existing tests pass even if the guard is deleted, because none
// of them exercise a read-through-book card whose ONLY quoted objection is
// the very last thing the card says (so `assembleObjectionReply` returns
// "").  Without the guard, `resolveReadThrough` accepts the empty-reply
// content as a valid candidate instead of cascading to Wall, and
// `assertFaithful` then throws "field is empty" deep inside `generateWeek`
// instead of the generator quietly falling back — exactly the failure mode
// M3 already prevents for the WEIGHTED slot's pool, but that fix never
// covered the read-through's own direct-from-card path.
// ---------------------------------------------------------------------------

describe("M14: read-through Objection's empty-reply guard falls back to Wall instead of surfacing an empty field", () => {
  function fabricatedCard(id: string, plainEnglish: string, bookSlug: string): Card {
    return {
      id,
      book_slug: bookSlug,
      chapter_slug: "ch1",
      card_number: 1,
      total_cards_in_chapter: 1,
      plain_english: plainEnglish,
      original_excerpt: plainEnglish,
      source_reference: "test",
      author_slug: "epictetus",
      tags: [],
      reading_time_seconds: 10,
    };
  }

  it("falls back to Wall on day 1 when the read-through book's next card ends on its own quoted objection (no reply text follows)", () => {
    // Mirrors the one real corpus card this guard exists for
    // (`discourses-53-010`, whose `plain_english` ends `"But I want my
    // children and wife with me."`) with a fabricated equivalent so the test
    // doesn't depend on that exact card surviving future corpus edits. A
    // leading sentence is included (T02) so the card has a real qualifying
    // Wall landing line of its own — `selectLandingLine` never looks at the
    // final quoted question (it isn't a complete non-question sentence) —
    // proving the empty-reply guard falls back to a genuine Wall candidate,
    // not the whole-passage fallback T02 removed.
    const emptyReplyRtCard = fabricatedCard(
      "m14-rt-1",
      `Grief passes quickly when reason takes charge. He said, "But why should I bother with any of this?"`,
      "m14-readthrough",
    );
    // Days 2-7's read-through cards pose no quoted objection at all, so
    // their own `objectionGate` candidate is `null` (a different, already-
    // covered path) rather than an empty-reply one — day 1 alone exercises
    // the guard this test targets.
    const genericRtCards = Array.from({ length: 6 }, (_, i) =>
      fabricatedCard(`m14-rt-${i + 2}`, `Read-through sentence number ${i + 2} standing alone.`, "m14-readthrough"),
    );
    const validObjectionCard = fabricatedCard(
      "m14-valid-objection",
      `He said, "But this is unbearable." That is not so; nothing forces you to suffer.`,
      "m14-pool",
    );
    const wallFallbackCards = Array.from({ length: 6 }, (_, i) =>
      fabricatedCard(`m14-wall-${i + 1}`, `Wall fallback sentence number ${i + 1} standing alone.`, "m14-pool"),
    );

    const allCards = [emptyReplyRtCard, ...genericRtCards, validObjectionCard, ...wallFallbackCards];

    const validQuoted = `"But this is unbearable."`;
    const objectionPool = [
      {
        card_id: validObjectionCard.id,
        book_slug: validObjectionCard.book_slug,
        author_slug: validObjectionCard.author_slug,
        objection: "But this is unbearable.",
        reply: "That is not so; nothing forces you to suffer.",
        reply_start: validObjectionCard.plain_english.indexOf(validQuoted) + validQuoted.length,
      },
    ];

    const wallPool = wallFallbackCards.map((c) => ({
      card_id: c.id,
      book_slug: c.book_slug,
      author_slug: c.author_slug,
      original_word_count: 20,
      landing_line: c.plain_english,
      sub_types: [],
      reserve: false,
      archaic_marker_count: 0,
      semicolon_count: 0,
      quote_count: 0,
      original_grade: 5,
    }));

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards: allCards,
      pools: { wall: wallPool, question: [], objection: objectionPool },
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "m14-readthrough",
      readThroughStartIndex: 0,
      // Forces the read-through's per-day candidate draw toward "objection"
      // every day, so day 1 actually reaches the empty-reply branch instead
      // of the guard going untested because the draw never picked it.
      weights: { wall: 0, question: 0, objection: 1 },
    });

    const day1Slot1 = week.slots.find((s) => s.day === 1 && s.slot === 1)!;
    expect(day1Slot1.card_id).toBe(emptyReplyRtCard.id);
    expect(day1Slot1.content.format).toBe("wall");
    if (day1Slot1.content.format === "wall") {
      // T02: never the whole `plain_english` — the card's own qualifying
      // landing line (the leading sentence; the final quoted question
      // never qualifies).
      expect(day1Slot1.content.landing_line).toBe("Grief passes quickly when reason takes charge.");
    }
  });
});

// ---------------------------------------------------------------------------
// M15 (PR #39 fourth review round): the read-through slot's own weekly
// Objection-cap increment (`if (rtFormat === "objection")
// objectionUsedThisWeek += 1;`) was previously unasserted — all 63
// pre-existing tests pass even with this line replaced by a no-op, because
// none of them checks `format_counts.objection` against
// `max_objection_per_week` over enough real-corpus weeks to hit a week where
// the read-through itself resolves to Objection. Without the increment nod
// to the counter, a week where BOTH the read-through slot and the weighted
// slot resolve to Objection reports `format_counts.objection === 2` against
// a stated cap of 1 — the Objection format's weekly cadence (a plan-level
// decision, not an implementation detail) silently breaks.
// ---------------------------------------------------------------------------

// Pf39c2-social-pilot-02a D01: The Objection was deleted outright (the
// channel is one Wall a day, drawn from the Wall pool, nothing else) — a
// read-through slot can never resolve to "objection" any more
// (`tryReadThroughContent` returns `null` for it unconditionally), so this
// describe's whole premise (the read-through's own Objection resolution
// counting against the weekly cap) can no longer happen, let alone be
// proven non-vacuous.

// ---------------------------------------------------------------------------
// M16 (PR #39 fourth review round): the weighted (slot 2) Wall pool's own
// read-through-book exclusion (`wallPool`'s `&& e.book_slug !== readThroughBook`)
// was previously unasserted — all 63 pre-existing tests pass even with that
// clause dropped, even though the IDENTICAL clause on `questionPool` right
// below it IS covered (see M2's seed sweep above, which fails immediately if
// that one is dropped). Without the Wall exclusion, slot 2 can independently
// draw a read-through-book card that the read-through's own sequential
// cursor later reaches, desyncing the "already scheduled" guard at
// `generateWeek`'s read-through step and throwing
// `Read-through card "..." was already scheduled` mid-run instead of never
// letting the collision happen in the first place.
// ---------------------------------------------------------------------------

describe("M16: the weighted Wall pool excludes the read-through book, same as the Question pool", () => {
  it("never draws a read-through-book card into slot 2, wall-dominant weights, across seeds 1..20", () => {
    for (let seed = 1; seed <= 20; seed++) {
      // Same 10-window sweep technique as M2's Question-pool test above.
      const startIndex = ((seed - 1) % 10) * 7;
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: startIndex,
        // Weighted heavily toward Wall so slot 2 actually draws from the
        // Wall pool often enough to sample — mirrors M2's Question-heavy
        // weighting for the same reason.
        weights: { wall: 100, question: 0, objection: 0 },
      });
      for (const slot of week.slots) {
        if (slot.slot === 2) {
          expect(slot.book_slug).not.toBe("enchiridion");
        }
      }
    }
  });

  it("multiple 8-week, wall-dominant real-corpus chains never throw and never repeat a card_id across weeks", () => {
    const weights: FormatWeights = { wall: 100, question: 0, objection: 0 };

    // Several independent 8-week chains (distinct seed bases), not just one
    // — probed directly against a mutated `wallPool` (missing its
    // read-through-book exclusion), seed bases 3/4/5/7 out of 1..10 each
    // reliably reproduced the real "already scheduled" desync throw within
    // 8 weeks, while seed base 100 alone (the one originally tried here)
    // did not; a single chain is not enough to reliably catch this mutation.
    for (let seedBase = 1; seedBase <= 10; seedBase++) {
      const usedCardIds = new Set<string>();
      let readThroughCursor = 0;

      for (let week = 1; week <= 8; week++) {
        const schedule = generateWeek({
          weekNumber: week,
          seed: seedBase * 100 + week,
          cards,
          pools: gatePools,
          poolSource,
          priorUsedCardIds: usedCardIds,
          readThroughBook: "enchiridion",
          readThroughStartIndex: readThroughCursor,
          weights,
        });
        for (const slot of schedule.slots) {
          // No card_id repeats a prior week's — the "never reuse a card"
          // invariant this whole reservation scheme exists to protect.
          expect(usedCardIds.has(slot.card_id)).toBe(false);
          usedCardIds.add(slot.card_id);
        }
        readThroughCursor += 7;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// T15: generalise the read-through from a WHOLE BOOK to a BOOK SLICE.
//
// The trap this guards against: excluding the read-through's cards from the
// Wall/Question/Objection pools BY `book_slug` (as `generateWeek` did before
// T15) is correct only when the read-through covers an entire book. Once the
// read-through is sliced to a few chapters (T16's actual plan: Meditations
// Books 2-3, 48 of Meditations' 576 cards), a `book_slug` exclusion would
// silently strip EVERY Meditations card from the Wall/Question pools —
// destroying T05's author balancing. (Pre-T17, Wall was weighted toward
// marcus-aurelius, ~0.43, specifically because Meditations is its best
// material; post-T17, with Meditations as the read-through book,
// wallAuthorWeights instead solves marcus-aurelius's OWN Wall weight to ~0 —
// see ReadThroughShareContext in ./premises.ts — because the read-through
// already guarantees it a majority floor, so Wall's discretionary weight is
// spent on epictetus/seneca instead. Either way, a book_slug exclusion would
// still be wrong: it would strip Meditations material The Wall, The
// Question or The Objection could otherwise legitimately draw.) These tests
// assert the exclusion is by CARD ID, not book, and that the default (no
// chapters) path is untouched.
// ---------------------------------------------------------------------------

describe("T15: read-through book slice", () => {
  /**
   * Same technique as T13's own `trueReadingOrder` above, restricted to a
   * caller-supplied chapter list walked in the order given — an independent
   * re-derivation of the ordering `buildReadThroughSequence` (schedule.ts)
   * is expected to produce, so this test doesn't just re-assert the
   * implementation's own logic back at itself.
   */
  function trueReadingOrderSlice(allCards: Card[], bookSlug: string, chapters: string[]): Card[] {
    const bookCards = allCards.filter((c) => c.book_slug === bookSlug);
    const byChapter = new Map<string, Card[]>();
    for (const c of bookCards) {
      if (!byChapter.has(c.chapter_slug)) byChapter.set(c.chapter_slug, []);
      byChapter.get(c.chapter_slug)!.push(c);
    }
    const ordered: Card[] = [];
    for (const slug of chapters) {
      const group = [...(byChapter.get(slug) ?? [])].sort((a, b) => a.card_number - b.card_number);
      ordered.push(...group);
    }
    return ordered;
  }

  const MEDITATIONS_SLICE_CHAPTERS = ["book-02", "book-03"];
  const meditationsSlice = trueReadingOrderSlice(cards, "meditations", MEDITATIONS_SLICE_CHAPTERS);
  const meditationsSliceIds = new Set(meditationsSlice.map((c) => c.id));

  it("Meditations Books 2-3 have 48 cards combined — grounding this suite's own numbers", () => {
    expect(meditationsSlice).toHaveLength(48);
  });

  // -------------------------------------------------------------------------
  // Defaults must not change: omitting readThroughChapters reproduces
  // today's whole-book behavior byte-for-byte.
  // -------------------------------------------------------------------------
  it("omitting readThroughChapters is byte-identical to not having the option at all", () => {
    const withoutOption = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughStartIndex: 0,
    });
    const withExplicitUndefined = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "enchiridion",
      readThroughChapters: undefined,
      readThroughStartIndex: 0,
    });
    expect(JSON.stringify(withExplicitUndefined)).toBe(JSON.stringify(withoutOption));

    // The pre-T15 JSON shape: no `read_through_chapters` key at all
    // (JSON.stringify drops `undefined`-valued properties), and the total
    // equals the whole book — exactly as before this option existed.
    expect(JSON.stringify(withoutOption)).not.toContain("read_through_chapters");
    const enchiridionCards = cards.filter((c) => c.book_slug === "enchiridion");
    expect(withoutOption.read_through_total).toBe(enchiridionCards.length);
  });

  // -------------------------------------------------------------------------
  // The slice sequence follows chapter order then card_number.
  // -------------------------------------------------------------------------
  it("a slice read-through follows chapter order then card_number, matching an independently derived ordering", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
      readThroughStartIndex: 0,
    });
    const readThroughIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(readThroughIds).toEqual(meditationsSlice.slice(0, 7).map((c) => c.id));
  });

  it("a reversed chapter order (book-03 then book-02) walks book-03 first — the caller's order wins, not the book's own", () => {
    const reversedExpected = trueReadingOrderSlice(cards, "meditations", ["book-03", "book-02"]);
    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: ["book-03", "book-02"],
      readThroughStartIndex: 0,
    });
    const readThroughIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(readThroughIds).toEqual(reversedExpected.slice(0, 7).map((c) => c.id));
    expect(readThroughIds[0]).toMatch(/^meditations-03-/);
  });

  // -------------------------------------------------------------------------
  // read_through_total and the counter label follow the slice length.
  // -------------------------------------------------------------------------
  it("read_through_total equals the slice length, and the counter label reads 'Card N of <slice length>'", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
      readThroughStartIndex: 0,
    });
    expect(week.read_through_total).toBe(meditationsSlice.length);
    expect(week.read_through_chapters).toEqual(MEDITATIONS_SLICE_CHAPTERS);
    const counters = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.read_through_counter);
    expect(counters).toEqual(
      [1, 2, 3, 4, 5, 6, 7].map((n) => `Card ${n} of ${meditationsSlice.length}`),
    );
  });

  // -------------------------------------------------------------------------
  // THE central regression this task exists to prevent: excluding by card
  // id, not book_slug — Meditations cards OUTSIDE the slice still appear in
  // weighted slots.
  // -------------------------------------------------------------------------
  it("a slice read-through excludes ONLY its own cards — Meditations cards outside the slice still appear in weighted slots (protects T05's balancing)", () => {
    let sawOutsideSliceMeditationsInWeightedSlot = false;
    for (let seed = 1; seed <= 40 && !sawOutsideSliceMeditationsInWeightedSlot; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "meditations",
        readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
        readThroughStartIndex: 0,
        // Maximize the chance slot 2 draws a Meditations card via The
        // Question instead of The Wall: T17 makes wallAuthorWeights solve
        // marcus-aurelius's Wall weight to ~0 whenever the read-through
        // book (here, Meditations) already fixes marcus-aurelius at a
        // guaranteed-majority floor (see ReadThroughShareContext in
        // ./premises.ts), so Wall itself is no longer a reliable way to
        // surface a Meditations card here. The Question pool's own
        // (unweighted, uncorrected) mix still has 21 Meditations entries —
        // all outside this book-02/03 slice — so weighting toward Question
        // instead reliably exercises the same by-card-id exclusion.
        weights: { wall: 0, question: 100, objection: 0 },
      });
      for (const slot of week.slots) {
        if (slot.slot === 2 && slot.book_slug === "meditations" && !meditationsSliceIds.has(slot.card_id)) {
          sawOutsideSliceMeditationsInWeightedSlot = true;
        }
      }
    }
    // Not vacuous — must actually observe at least one out-of-slice
    // Meditations card land in a weighted slot across the seed sweep.
    expect(sawOutsideSliceMeditationsInWeightedSlot).toBe(true);
  });

  it("the read-through's own slot never draws a card outside its slice", () => {
    for (const seed of [1, 2, 3, 42]) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "meditations",
        readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
        readThroughStartIndex: 0,
      });
      for (const slot of week.slots) {
        if (slot.read_through) expect(meditationsSliceIds.has(slot.card_id)).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // Validation: unknown chapter, empty slice.
  // -------------------------------------------------------------------------
  it("throws a clear error for an unknown chapter slug", () => {
    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "meditations",
        readThroughChapters: ["book-02", "not-a-real-chapter"],
        readThroughStartIndex: 0,
      }),
    ).toThrow(/unknown chapter/i);
  });

  it("throws a clear error for an empty slice (explicit empty chapter list)", () => {
    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 42,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "meditations",
        readThroughChapters: [],
        readThroughStartIndex: 0,
      }),
    ).toThrow(/empty/i);
  });

  // -------------------------------------------------------------------------
  // Determinism preserved for the slice path.
  // -------------------------------------------------------------------------
  it("is byte-identical across two independent runs with the same seed, for the slice path", () => {
    const opts = {
      weekNumber: 1,
      seed: 7,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set<string>(),
      readThroughBook: "meditations",
      readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
      readThroughStartIndex: 0,
    };
    const a = generateWeek(opts);
    const b = generateWeek(opts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("advances the slice strictly sequentially across weeks, with no skip or repeat", () => {
    const week1 = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "meditations",
      readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
      readThroughStartIndex: 0,
    });
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week2 = generateWeek({
      weekNumber: 2,
      seed: 42,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds: week1Ids,
      readThroughBook: "meditations",
      readThroughChapters: MEDITATIONS_SLICE_CHAPTERS,
      readThroughStartIndex: 7,
    });
    const week2ReadThrough = week2.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(week2ReadThrough).toEqual(meditationsSlice.slice(7, 14).map((c) => c.id));
  });
});

// ---------------------------------------------------------------------------
// T16: the pilot's new DEFAULT read-through — Meditations Books 2-3 (48
// cards), replacing the original Enchiridion default. Enchiridion had ~3,316
// Goodreads reviews against Meditations' ~379,000 (~100x more recognised)
// and Book 1 is the atypical "Debts and Lessons" acknowledgements list, so
// the slice deliberately starts at Book 2 (see `DEFAULT_READ_THROUGH_BOOK`/
// `DEFAULT_READ_THROUGH_CHAPTERS` in ../schedule.ts for the full rationale).
//
// These tests call `generateWeek` WITHOUT passing `readThroughBook` or
// `readThroughChapters` at all — proving the coupled default itself. Every
// OTHER describe block in this file deliberately keeps exercising
// Enchiridion/whole-book behavior as an EXPLICIT option (per T16's own
// instruction: tests that deliberately exercise Enchiridion or a whole-book
// read-through must keep doing so, since the whole-book path stays covered
// — distinct from testing the default).
// ---------------------------------------------------------------------------

describe("T16: Meditations Books 2-3 default read-through", () => {
  // Same technique as T13's `trueReadingOrder` and T15's `trueReadingOrderSlice`
  // above — an independent re-derivation of the ordering `generateWeek`'s
  // own default is expected to produce, so this doesn't just re-assert the
  // implementation's own logic back at itself.
  function trueReadingOrderSlice(allCards: Card[], bookSlug: string, chapters: string[]): Card[] {
    const bookCards = allCards.filter((c) => c.book_slug === bookSlug);
    const byChapter = new Map<string, Card[]>();
    for (const c of bookCards) {
      if (!byChapter.has(c.chapter_slug)) byChapter.set(c.chapter_slug, []);
      byChapter.get(c.chapter_slug)!.push(c);
    }
    const ordered: Card[] = [];
    for (const slug of chapters) {
      const group = [...(byChapter.get(slug) ?? [])].sort((a, b) => a.card_number - b.card_number);
      ordered.push(...group);
    }
    return ordered;
  }

  const defaultSlice = trueReadingOrderSlice(cards, "meditations", ["book-02", "book-03"]);

  function makeDefaultWeek(
    week: number,
    seed: number,
    priorUsedCardIds: Set<string> = new Set(),
    readThroughStartIndex = 0,
  ): WeekSchedule {
    return generateWeek({
      weekNumber: week,
      seed,
      cards,
      pools: gatePools,
      poolSource,
      priorUsedCardIds,
      readThroughStartIndex,
      // readThroughBook / readThroughChapters deliberately OMITTED — this is
      // the whole point of this describe block: prove `generateWeek`'s own
      // coupled default, not a caller-supplied slice.
    });
  }

  it("Meditations Books 2-3 have 48 cards combined — grounding this suite's own numbers", () => {
    expect(defaultSlice).toHaveLength(48);
  });

  it("omitting readThroughBook and readThroughChapters resolves to the Meditations Books 2-3 default", () => {
    const week = makeDefaultWeek(1, 42);
    expect(week.read_through_book).toBe("meditations");
    expect(week.read_through_chapters).toEqual(["book-02", "book-03"]);
    expect(week.read_through_total).toBe(48);
  });

  it("the default read-through advances sequentially through Book 2 first, matching the independently derived true reading order", () => {
    const week = makeDefaultWeek(1, 42);
    const readThroughIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(readThroughIds).toEqual(defaultSlice.slice(0, 7).map((c) => c.id));
    // Book 2 has 20 cards, so all 7 of week 1's read-through cards are
    // still within Book 2.
    expect(readThroughIds.every((id) => id.startsWith("meditations-02-"))).toBe(true);
  });

  it(
    "across 6 consecutive weeks (42 cards) the default read-through covers Books 2 then 3 in true reading order " +
      "with no skip or repeat, crossing from Book 2 (20 cards) into Book 3 partway through",
    () => {
      const usedCardIds = new Set<string>();
      let readThroughConsumed = 0;
      const allReadThrough: string[] = [];
      for (let week = 1; week <= 6; week++) {
        const schedule = makeDefaultWeek(week, 42, usedCardIds, readThroughConsumed);
        const readThroughIds = schedule.slots
          .filter((s) => s.read_through)
          .sort((a, b) => a.day - b.day)
          .map((s) => s.card_id);
        allReadThrough.push(...readThroughIds);
        for (const s of schedule.slots) usedCardIds.add(s.card_id);
        readThroughConsumed += 7;
      }
      expect(allReadThrough).toHaveLength(42);
      expect(new Set(allReadThrough).size).toBe(42); // no repeat
      expect(allReadThrough).toEqual(defaultSlice.slice(0, 42).map((c) => c.id)); // no skip, strict order
      expect(allReadThrough.slice(0, 20).every((id) => id.startsWith("meditations-02-"))).toBe(true);
      expect(allReadThrough.slice(20).every((id) => id.startsWith("meditations-03-"))).toBe(true);
    },
  );

  // -------------------------------------------------------------------------
  // 48 cards is 6.9 weeks — mirrors the existing Enchiridion (70-card)
  // exhaustion-boundary tests elsewhere in this file, at the new default's
  // own boundary.
  // -------------------------------------------------------------------------
  it("a week landing exactly on the slice's last card (index 41..47 of 48) succeeds with no skip, no repeat, no throw, ending exactly on the 48th card", () => {
    const startIndex = defaultSlice.length - 7; // 41 — the week's 7 days exactly consume cards 42..48
    const week = makeDefaultWeek(7, 42, new Set(), startIndex);
    const readThroughIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(readThroughIds).toEqual(defaultSlice.slice(startIndex).map((c) => c.id));
    const counters = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.read_through_counter);
    expect(counters).toEqual([42, 43, 44, 45, 46, 47, 48].map((n) => `Card ${n} of 48`));
  });

  it("week 7 exhausts the slice partway through — only 6 cards remain (43..48) after 6 full weeks consume 42", () => {
    expect(() => makeDefaultWeek(7, 42, new Set(), 42)).toThrow(/complete|exhausted/i);
  });

  it("week 8, attempted at the fully-exhausted position (index 48), throws immediately with no skip or repeat", () => {
    expect(() => makeDefaultWeek(8, 42, new Set(), 48)).toThrow(/complete|exhausted/i);
  });

  // -------------------------------------------------------------------------
  // THE acceptance assertion: the combined mix over a default week reports
  // marcus-aurelius as the majority author.
  // -------------------------------------------------------------------------
  it(
    "reports marcus-aurelius as the majority author in the combined mix of a default week " +
      "(measured post-D01, seed 42 week 1: epictetus 35.7%, marcus-aurelius exactly 50%, seneca 14.3% — " +
      "Pf39c2-social-pilot-02a D01 deleted Question outright, so wallAuthorWeights' free-slot correction no " +
      "longer has any real Question skew to weigh against; with EVERY non-read-through slot now Wall (the " +
      "only format left), the correction clamps marcus-aurelius's OWN weighted-slot weight to exactly 0 " +
      "(the read-through already gives him more than his even 1/3 target — see wallAuthorWeights' REACHABLE " +
      "FLOOR doc comment), splitting the rest 50/50 between epictetus and seneca — so marcus-aurelius's " +
      "combined share is now exactly his read-through-fixed 7/14, not the pre-D01 57.1% that also included " +
      "him winning some weighted-slot draws)",
    () => {
      const week = makeDefaultWeek(1, 42);
      const mix = week.author_mix;
      expect(mix["marcus-aurelius"].share).toBeGreaterThan(mix.epictetus.share);
      expect(mix["marcus-aurelius"].share).toBeGreaterThan(mix.seneca.share);
      // Exactly half, not merely "greater than half" — see the doc comment
      // above for why D01 made this an equality rather than a strict
      // majority.
      expect(mix["marcus-aurelius"].share).toBeCloseTo(0.5, 8);
    },
  );

  it("marcus-aurelius is the majority author across a spread of default-week seeds, not one cherry-picked seed", () => {
    let marcusWins = 0;
    const n = 15;
    for (let seed = 1; seed <= n; seed++) {
      const week = makeDefaultWeek(1, seed);
      const mix = week.author_mix;
      if (mix["marcus-aurelius"].share > mix.epictetus.share && mix["marcus-aurelius"].share > mix.seneca.share) {
        marcusWins += 1;
      }
    }
    // Directional: at least 7 of every default week's 14 slots are the
    // Meditations read-through (marcus-aurelius) by construction, so marcus
    // should win comfortably across most seeds, not merely half.
    expect(marcusWins).toBeGreaterThanOrEqual(Math.ceil(n * 0.8));
  });

  // -------------------------------------------------------------------------
  // T17: wallAuthorWeights must account for the read-through's fixed author
  // contribution, not just The Question pool's own skew. Pre-T17, the
  // default (Meditations) read-through's fixed 50% marcus-aurelius floor
  // was counted TWICE — once from the read-through itself, again from a
  // Wall correction still assuming no read-through existed — leaving seneca
  // at a measured 7.1% (seed 42, week 1; see the git history of this file's
  // "measured, seed 42 week 1" test above). Fixed seeds, aggregated over
  // several isolated weeks, so this is a stable regression check, not a
  // single lucky draw.
  // -------------------------------------------------------------------------
  it("T17: seneca's combined share is materially above the pre-fix 7.1%, with marcus-aurelius still the largest share, across a fixed multi-week seed sweep", () => {
    const seeds = [1, 2, 3, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 42, 97];
    const totals: Record<AuthorSlug, number> = { epictetus: 0, "marcus-aurelius": 0, seneca: 0 };
    let totalSlots = 0;
    for (const seed of seeds) {
      const week = makeDefaultWeek(1, seed);
      for (const author of ["epictetus", "marcus-aurelius", "seneca"] as const) {
        totals[author] += week.author_mix[author].count;
      }
      totalSlots += week.slots.length;
    }
    const senecaShare = totals.seneca / totalSlots;
    const marcusShare = totals["marcus-aurelius"] / totalSlots;
    const epictetusShare = totals.epictetus / totalSlots;

    // Materially above the pre-T17 measured 7.1% — well clear of noise.
    expect(senecaShare).toBeGreaterThan(0.15);
    // Pf39c2-social-pilot-02a D01: marcus-aurelius's combined share is now
    // exactly his read-through-fixed 50% (not merely "greater than 50%") —
    // see the "reports marcus-aurelius as the majority author" test above
    // for why D01's deletion of Question made this an equality. Still
    // individually greater than each of the other two authors' own shares.
    expect(marcusShare).toBeCloseTo(0.5, 8);
    expect(marcusShare).toBeGreaterThan(senecaShare);
    expect(marcusShare).toBeGreaterThan(epictetusShare);
  });

  // -------------------------------------------------------------------------
  // Determinism and no-cross-week-reuse still hold under the new default.
  // -------------------------------------------------------------------------
  it("is byte-identical across two independent runs with the same seed, under the default", () => {
    const a = makeDefaultWeek(1, 42);
    const b = makeDefaultWeek(1, 42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("never reuses a card scheduled in a prior week, under the default", () => {
    const week1 = makeDefaultWeek(1, 42);
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week2 = makeDefaultWeek(2, 42, week1Ids, 7);
    for (const slot of week2.slots) {
      expect(week1Ids.has(slot.card_id)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// T21: Wall selection must respect the rubric scores T07/T08/T11 already
// computed, not just the mechanical gate. A scored `wall.json` entry counts
// as "strong" only when it clears BOTH `impenetrability_score` and
// `landing_line_score` at `WALL_STRONG_IMPENETRABILITY_MIN`/
// `WALL_STRONG_LANDING_LINE_MIN` (both 4, on the 1-5 scale) — see
// `isStrongWallEntry`'s own doc comment in ./schedule.ts for the full
// rationale, the measured 679/896 (~76%) strong coverage, and why a
// gate-only entry (no rubric at all) is treated as strong by default rather
// than sub-strong.
// ---------------------------------------------------------------------------

describe("T21: Wall selection respects rubric scores", () => {
  const premisesDir = path.join(process.cwd(), "content", "social", "premises");

  it("threshold constants are the documented values (both 4 on the 1-5 scale)", () => {
    expect(WALL_STRONG_IMPENETRABILITY_MIN).toBe(4);
    expect(WALL_STRONG_LANDING_LINE_MIN).toBe(4);
  });

  it("isStrongWallEntry requires BOTH axes to clear the threshold", () => {
    const base = gatePools.wall[0];
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 4, landing_line_score: 4 } })).toBe(true);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 5, landing_line_score: 5 } })).toBe(true);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 3, landing_line_score: 5 } })).toBe(false);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 5, landing_line_score: 3 } })).toBe(false);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 3, landing_line_score: 3 } })).toBe(false);
  });

  // -------------------------------------------------------------------------
  // "A gate-only pool with no rubric fields still schedules normally" — the
  // mechanical-gate path (rankWall's own output, used whenever T11 hasn't
  // run yet) must never be filtered by a rubric it doesn't have.
  // -------------------------------------------------------------------------
  it("treats every gate-only entry (no rubric at all) as strong, not sub-strong", () => {
    for (const entry of gatePools.wall) {
      expect((entry as WallPoolEntry).rubric).toBeUndefined();
      expect(isStrongWallEntry(entry as WallPoolEntry)).toBe(true);
    }
  });

  it("a gate-only pool (no rubric fields) still schedules a full week normally", () => {
    const week = makeWeek(1, 42);
    expect(week.format_counts.wall).toBeGreaterThan(0);
    expect(week.slots).toHaveLength(14);
  });

  describe("against the real scored pool (content/social/premises/wall.json)", () => {
    it("no sub-strong entry is drawn while strong entries remain, across a multi-week, wall-dominant, fixed-seed chain", async () => {
      const { pools, source } = await loadFormatPools(premisesDir, gatePools);
      expect(source.wall).toBe("scored"); // sanity: really exercising the scored pool, not the gate-only fallback
      const wallEntries = pools.wall as WallPoolEntry[];
      const scoredByCardId = new Map(wallEntries.map((e) => [e.card_id, e]));
      const strongCount = wallEntries.filter(isStrongWallEntry).length;

      const priorUsedCardIds = new Set<string>();
      let readThroughCursor = 0;
      let wallDrawCount = 0;

      for (let week = 1; week <= 10; week++) {
        const schedule = generateWeek({
          weekNumber: week,
          seed: 2000 + week,
          cards,
          pools,
          poolSource: source,
          priorUsedCardIds,
          readThroughBook: "enchiridion",
          readThroughStartIndex: readThroughCursor,
          weights: { wall: 20, question: 1, objection: 1 },
        });
        for (const slot of schedule.slots) {
          priorUsedCardIds.add(slot.card_id);
          if (!slot.read_through && slot.content.format === "wall") {
            wallDrawCount += 1;
            const scored = scoredByCardId.get(slot.card_id);
            expect(scored).toBeDefined();
            expect(isStrongWallEntry(scored!)).toBe(true);
          }
        }
        readThroughCursor += schedule.slots.filter((s) => s.read_through).length;
      }

      // Sanity: this chain drew far fewer Wall slots than the strong pool's
      // own size, so "every draw was strong" above is a real assertion about
      // the SELECTION mechanism, not a vacuous truth from having exhausted
      // strong and fallen back to reserve anyway.
      expect(wallDrawCount).toBeGreaterThan(0);
      expect(wallDrawCount).toBeLessThan(strongCount);
    });

    // -----------------------------------------------------------------------
    // The "measurably outperforms" half of the acceptance criterion.
    // MEASURED (seeds 3001-3010, weights {wall:20,question:1,objection:1},
    // real corpus): full-pool mean impenetrability 4.1719 / landing_line
    // 4.1942 (n=896); drawn mean impenetrability ~4.41 / landing_line ~4.48
    // (n~61) — both clear margins over the unfiltered-pool baseline.
    // -----------------------------------------------------------------------
    it("mean impenetrability and landing-line scores of drawn Wall slots are higher than a random draw from the full pool", async () => {
      const { pools, source } = await loadFormatPools(premisesDir, gatePools);
      const wallEntries = pools.wall as WallPoolEntry[];
      const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

      const fullMeanImpenetrability = mean(wallEntries.map((e) => e.rubric!.impenetrability_score));
      const fullMeanLandingLine = mean(wallEntries.map((e) => e.rubric!.landing_line_score));

      const scoredByCardId = new Map(wallEntries.map((e) => [e.card_id, e]));
      const priorUsedCardIds = new Set<string>();
      let readThroughCursor = 0;
      const drawn: WallPoolEntry[] = [];

      for (let week = 1; week <= 10; week++) {
        const schedule = generateWeek({
          weekNumber: week,
          seed: 3000 + week,
          cards,
          pools,
          poolSource: source,
          priorUsedCardIds,
          readThroughBook: "enchiridion",
          readThroughStartIndex: readThroughCursor,
          weights: { wall: 20, question: 1, objection: 1 },
        });
        for (const slot of schedule.slots) {
          priorUsedCardIds.add(slot.card_id);
          if (!slot.read_through && slot.content.format === "wall") {
            const scored = scoredByCardId.get(slot.card_id);
            if (scored) drawn.push(scored);
          }
        }
        readThroughCursor += schedule.slots.filter((s) => s.read_through).length;
      }

      expect(drawn.length).toBeGreaterThan(20); // a real sample, not noise
      const drawnMeanImpenetrability = mean(drawn.map((e) => e.rubric!.impenetrability_score));
      const drawnMeanLandingLine = mean(drawn.map((e) => e.rubric!.landing_line_score));

      expect(drawnMeanImpenetrability).toBeGreaterThan(fullMeanImpenetrability);
      expect(drawnMeanLandingLine).toBeGreaterThan(fullMeanLandingLine);
      // Every drawn entry clears the strong floor on both axes by
      // construction — asserted directly, not just implied by the means.
      expect(Math.min(...drawn.map((e) => e.rubric!.impenetrability_score))).toBeGreaterThanOrEqual(
        WALL_STRONG_IMPENETRABILITY_MIN,
      );
      expect(Math.min(...drawn.map((e) => e.rubric!.landing_line_score))).toBeGreaterThanOrEqual(WALL_STRONG_LANDING_LINE_MIN);
    });
  });

  describe("reserve fallback (small synthetic pool forced to exhaustion)", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("draws every strong entry before touching reserve, and logs a warning naming the reserve fallback once strong is exhausted", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      // Real gate survivors (discourses-49-002..011, all epictetus) — using
      // real cards/landing lines keeps `assertFaithful` honest; only the
      // synthetic `rubric` field is hand-built.
      const base = gatePools.wall.filter((e) => e.book_slug === "discourses" && e.card_id.startsWith("discourses-49-"));
      expect(base.length).toBeGreaterThanOrEqual(8);

      const strongIds = new Set([base[0].card_id, base[1].card_id]);
      const customWall: WallPoolEntry[] = base.slice(0, 8).map((entry) => ({
        ...entry,
        rubric: strongIds.has(entry.card_id)
          ? { impenetrability_score: 5, landing_line_score: 5 }
          : { impenetrability_score: 3, landing_line_score: 3 }, // below both thresholds — reserve
      }));

      const pools: FormatPools = { wall: customWall, question: gatePools.question, objection: gatePools.objection };

      const schedule = generateWeek({
        weekNumber: 1,
        seed: 42,
        cards,
        pools,
        poolSource: { wall: "scored", question: "gate-only", objection: "gate-only" },
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights: { wall: 100, question: 0, objection: 0 }, // force every slot 2 draw to be Wall
      });

      const drawnWallCardIds = schedule.slots
        .filter((s) => !s.read_through && s.content.format === "wall")
        .map((s) => s.card_id);
      expect(drawnWallCardIds.length).toBe(7); // one Wall slot 2 per day, 7 days

      const drawnStrongCount = drawnWallCardIds.filter((id) => strongIds.has(id)).length;
      const drawnReserveCount = drawnWallCardIds.length - drawnStrongCount;

      // Both strong entries were drawn (only 2 exist, and 7 draws from an
      // 8-entry pool must exhaust them) and reserve fills every draw after.
      expect(drawnStrongCount).toBe(2);
      expect(drawnReserveCount).toBe(5);

      // The warning fired, naming the reserve fallback and how many strong
      // entries remained (0 — that's why it fell back at all).
      expect(warnSpy).toHaveBeenCalled();
      const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]));
      expect(warnMessages.some((m) => /Wall strong pool exhausted/i.test(m))).toBe(true);
      expect(warnMessages.some((m) => /0 strong entries remain/i.test(m))).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// T19: sub-type spacing.
//
// The read-through's CARD is fixed by sequence (never reordered — the
// plan's own hard constraint), so its Wall sub-type, when it renders as
// Wall, is whatever `classifyWallSubTypes` finds on that exact card: there
// is no pool of alternatives to draw a spaced one from. The free slot
// (slot 2) DOES have a pool, so it's the only slot the scheduler can
// actively space. Both halves are covered below: a fully hand-traced
// synthetic fixture proves the mechanism itself (prefers a disjoint
// sub-type when the pool allows it; reports, rather than silently accepts,
// once the disjoint pool is exhausted — including the read-through's own
// unavoidable case), and a real-corpus multi-week chain proves the
// mechanism holds against the actual scored pool, with an EXACT
// correspondence between real back-to-back repeats and logged reports (no
// silent repeat, no false-alarm report).
// ---------------------------------------------------------------------------
describe("T19: Wall sub-type spacing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Confirmed against premises.test.ts's own classifyWallSubTypes suite:
  // exactly 3 archaic-marker occurrences ("Thou"/"hath"/"thy") -> thou_wall
  // only; exactly 3 semicolons -> cascade only. Neither string matches the
  // other sub-type, so each fixture card below has an unambiguous,
  // single-entry `sub_types` array.
  const THOU_WALL_EXCERPT = "Thou hath spoken, and thy word is true.";
  const CASCADE_EXCERPT = "One; two; three; four of these matters remain unresolved.";

  function makeReadThroughCard(n: number): Card {
    return {
      id: `spacing-book-${String(n).padStart(2, "0")}`,
      book_slug: "spacing-book",
      chapter_slug: "chapter-01",
      card_number: n,
      total_cards_in_chapter: 7,
      // A distinct, self-contained 5-18 word sentence (no leading
      // But/So/This/It/And, no mid-sentence he/she/it/this/etc.) for every
      // card, so `selectLandingLine` succeeds unconditionally — this is
      // what forces every read-through slot to Wall, deterministically, no
      // rng-dependent branching.
      plain_english: `Genuine calm on day ${n} comes only from within, never from the world outside.`,
      original_excerpt: THOU_WALL_EXCERPT,
      source_reference: `Spacing Test, Card ${n}`,
      author_slug: "marcus-aurelius",
      tags: ["calm-your-mind"],
      reading_time_seconds: 20,
    };
  }

  function makeFreePoolCard(n: number, kind: "thou_wall" | "cascade"): Card {
    return {
      id: `free-pool-${String(n).padStart(2, "0")}`,
      book_slug: "free-pool-book",
      chapter_slug: "chapter-01",
      card_number: n,
      total_cards_in_chapter: 8,
      plain_english: `Free pool card number ${n}, kind ${kind}, used only as a Wall landing line.`,
      original_excerpt: kind === "thou_wall" ? THOU_WALL_EXCERPT : CASCADE_EXCERPT,
      source_reference: `Free Pool Test, Card ${n}`,
      author_slug: "seneca",
      tags: ["calm-your-mind"],
      reading_time_seconds: 20,
    };
  }

  function makeFreePoolEntry(card: Card, subTypes: WallSubType[]): RankedWallEntry {
    return {
      card_id: card.id,
      book_slug: card.book_slug,
      author_slug: card.author_slug,
      original_word_count: 100,
      landing_line: card.plain_english, // trivially verbatim (assertFaithful)
      sub_types: subTypes,
      reserve: subTypes.length === 0,
      archaic_marker_count: 0,
      semicolon_count: 0,
      quote_count: 0,
      original_grade: 8,
    };
  }

  it("prefers a disjoint sub-type for the free slot while the pool allows it, and reports every back-to-back repeat once it can't — hand-traced, fully deterministic fixture", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const readThroughCards = Array.from({ length: 7 }, (_, i) => makeReadThroughCard(i + 1));

    // 4 thou_wall + 4 cascade free-pool entries — enough for exactly 7
    // slot-2 draws (one per day) with 1 spare, so the pool never runs out
    // entirely (a separate failure mode from "can't space").
    const freePoolCards: Card[] = [];
    const freePoolEntries: RankedWallEntry[] = [];
    let n = 0;
    for (let i = 0; i < 4; i++) {
      n += 1;
      const card = makeFreePoolCard(n, "thou_wall");
      freePoolCards.push(card);
      freePoolEntries.push(makeFreePoolEntry(card, ["thou_wall"]));
    }
    for (let i = 0; i < 4; i++) {
      n += 1;
      const card = makeFreePoolCard(n, "cascade");
      freePoolCards.push(card);
      freePoolEntries.push(makeFreePoolEntry(card, ["cascade"]));
    }

    const pools: FormatPools = { wall: freePoolEntries, question: [], objection: [] };

    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards: [...readThroughCards, ...freePoolCards],
      pools,
      poolSource: { wall: "gate-only", question: "gate-only", objection: "gate-only" },
      priorUsedCardIds: new Set(),
      readThroughBook: "spacing-book",
      readThroughStartIndex: 0,
      // wall-only weighting (question/objection both weight 0 AND have
      // empty pools) forces every one of the 14 slots to resolve to Wall,
      // deterministically — no rng-dependent branching anywhere in this
      // fixture.
      weights: { wall: 1, question: 0, objection: 0 },
    });

    expect(week.format_counts.wall).toBe(14);
    expect(week.format_counts.question + week.format_counts.objection + week.format_counts.still).toBe(0);

    // THE HARD CONSTRAINT: the read-through's card order is untouched — the
    // exact 7-card sequence, in order, no skip/repeat/substitution.
    const rtIds = week.slots
      .filter((s) => s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => s.card_id);
    expect(rtIds).toEqual(readThroughCards.map((c) => c.id));

    // Classify every drawn slot-2 card id back to "thou_wall"/"cascade" via
    // the fixture's own known split — not re-derived from the schedule.
    const thouWallIds = new Set(freePoolEntries.filter((e) => e.sub_types.includes("thou_wall")).map((e) => e.card_id));
    const cascadeIds = new Set(freePoolEntries.filter((e) => e.sub_types.includes("cascade")).map((e) => e.card_id));
    const slot2Kinds = week.slots
      .filter((s) => !s.read_through)
      .sort((a, b) => a.day - b.day)
      .map((s) => (thouWallIds.has(s.card_id) ? "thou_wall" : cascadeIds.has(s.card_id) ? "cascade" : "unknown"));

    // Hand-derived: every read-through slot is thou_wall (fixed, by
    // construction). Days 1-4 space away from it by drawing the 4 disjoint
    // cascade entries (exactly enough for 4 days); by day 5 the cascade
    // supply is exhausted, so the only entries left are thou_wall, which
    // DOES repeat the read-through's fixed sub-type on days 5-7.
    expect(slot2Kinds).toEqual(["cascade", "cascade", "cascade", "cascade", "thou_wall", "thou_wall", "thou_wall"]);

    // Every repeat that occurred was reported. Hand-derived from the full
    // 14-slot sequence (thou,casc, thou,casc, thou,casc, thou,casc,
    // thou,thou, thou,thou, thou,thou): exactly 5 adjacent pairs share a
    // sub-type — day 5's own slot1/slot2 pair (reported by slot 2), day
    // 5-slot2-to-day-6-slot1 (reported by slot 1), day 6's own pair
    // (reported by slot 2), day 6-slot2-to-day-7-slot1 (reported by slot
    // 1), day 7's own pair (reported by slot 2). 3 slot-2 reports, 2
    // slot-1 reports.
    const warnMessages = warnSpy.mock.calls.map((call) => String(call[0]));
    const spacingMessages = warnMessages.filter((m) => /Wall sub-type spacing could not be honored/.test(m));
    const slot2Warnings = spacingMessages.filter((m) => /\bslot 2\b/.test(m));
    const slot1Warnings = spacingMessages.filter((m) => /\bslot 1\b/.test(m));

    expect(spacingMessages).toHaveLength(5);
    expect(slot2Warnings).toHaveLength(3);
    expect(slot1Warnings).toHaveLength(2);
    expect(slot2Warnings.every((m) => /\bday (5|6|7)\b/.test(m))).toBe(true);
    expect(slot1Warnings.every((m) => /\bday (6|7)\b/.test(m))).toBe(true);
    // The read-through's own report explicitly names WHY it's unavoidable
    // (never reordered/substituted), distinct from slot 2's "pool does not
    // allow spacing here" reasoning.
    expect(slot1Warnings.every((m) => /card order is never reordered/i.test(m))).toBe(true);
    expect(slot2Warnings.every((m) => /pool does not allow spacing here/i.test(m))).toBe(true);
  });

  describe("against the real corpus (multi-week, wall-dominant chain)", () => {
    const premisesDir = path.join(process.cwd(), "content", "social", "premises");

    it("every back-to-back Wall sub-type repeat within a generated week is exactly the set that gets reported — no silent repeat, no false-alarm report", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { pools, source } = await loadFormatPools(premisesDir, gatePools);
      expect(source.wall).toBe("scored"); // exercising the real scored pool's own sub_types field
      const wallEntries = pools.wall as RankedWallEntry[];
      const subTypesByPoolCardId = new Map(wallEntries.map((e) => [e.card_id, e.sub_types]));
      const cardsById = new Map(cards.map((c) => [c.id, c]));

      const priorUsedCardIds = new Set<string>();
      let readThroughCursor = 0;
      let totalRepeats = 0;
      let totalSpacingWarnings = 0;

      for (let week = 1; week <= 8; week++) {
        warnSpy.mockClear();
        const schedule = generateWeek({
          weekNumber: week,
          seed: 6000 + week,
          cards,
          pools,
          poolSource: source,
          priorUsedCardIds,
          readThroughBook: "enchiridion",
          readThroughStartIndex: readThroughCursor,
          weights: { wall: 20, question: 1, objection: 1 },
        });

        // Re-derive each Wall slot's sub_types the SAME way generateWeek
        // itself does: the read-through's own `classifyWallSubTypes(card)`
        // (it isn't in the wall pool at all — excluded by book), the free
        // slot's own pool entry `sub_types` (exactly what the scheduler's
        // spacing filter matched candidates against).
        const ordered = [...schedule.slots].sort((a, b) => a.day - b.day || a.slot - b.slot);
        for (let i = 1; i < ordered.length; i++) {
          const prev = ordered[i - 1];
          const cur = ordered[i];
          if (prev.content.format !== "wall" || cur.content.format !== "wall") continue;
          const prevSub = prev.read_through
            ? classifyWallSubTypes(cardsById.get(prev.card_id)!).sub_types
            : subTypesByPoolCardId.get(prev.card_id);
          const curSub = cur.read_through
            ? classifyWallSubTypes(cardsById.get(cur.card_id)!).sub_types
            : subTypesByPoolCardId.get(cur.card_id);
          expect(prevSub).toBeDefined();
          expect(curSub).toBeDefined();
          if (prevSub!.some((t) => curSub!.includes(t))) totalRepeats += 1;
        }

        const spacingWarnings = warnSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((m) => /Wall sub-type spacing could not be honored/.test(m));
        totalSpacingWarnings += spacingWarnings.length;

        for (const slot of schedule.slots) priorUsedCardIds.add(slot.card_id);
        readThroughCursor += schedule.slots.filter((s) => s.read_through).length;
      }

      // The mechanism actually exercised both paths over this real, 8-week
      // chain (a vacuous 0/0 would not prove anything).
      expect(totalRepeats + totalSpacingWarnings).toBeGreaterThan(0);
      // The exact correspondence: every real repeat was reported, and
      // nothing was reported that didn't actually repeat.
      expect(totalSpacingWarnings).toBe(totalRepeats);
    });
  });
});
