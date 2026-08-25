import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, rankWall, questionGate, objectionGate, wallAuthorWeights, sentences, passesLayerA, passesLayerB } from "../premises.js";
import { checkFaithfulness } from "../premises-scoring.js";
import {
  generateWeek,
  loadFormatPools,
  loadPriorWeeks,
  DEFAULT_FORMAT_WEIGHTS,
  type FormatPools,
  type FormatWeights,
  type WeekSchedule,
  type ScheduleFormat,
} from "../schedule.js";
import type { Card } from "../types.js";

// ---------------------------------------------------------------------------
// Real-corpus fixtures, computed once — these tests exercise the generator
// against the actual pipeline output (content/output), same as
// premises.test.ts's own corpus-level tests.
// ---------------------------------------------------------------------------

const cards: Card[] = loadCorpus();
const gatePools: FormatPools = {
  wall: rankWall(cards),
  question: questionGate(cards),
  objection: objectionGate(cards),
};
const poolSource = { wall: "gate-only" as const, question: "gate-only" as const, objection: "gate-only" as const };

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
    const weights = wallAuthorWeights(gatePools.question, gatePools.wall);
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
          expect(card.plain_english.includes(slot.content.landing_line) || slot.content.landing_line === card.plain_english).toBe(
            true,
          );
        } else if (slot.content.format === "question") {
          expect(card.plain_english).toContain(slot.content.question);
          expect(card.plain_english).toContain(slot.content.answer);
        } else {
          expect(card.plain_english).toContain(slot.content.objection);
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
      readThroughStartIndex: 0,
      readThroughFormat: "wall",
    });
    expect(week.read_through_format).toBe("wall");
    expect(week.slots.filter((s) => s.read_through).every((s) => s.content.format === "wall")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadFormatPools — the T11 fallback contract.
// ---------------------------------------------------------------------------

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
    const base = gatePools.question.slice(0, 2);
    const scoredQuestion = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it" },
      { ...base[1], drift_verdict: "drifts", drift_reason: "off topic" },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.question).toBe("scored");
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[0].card_id);
  });

  it("filters a scored Objection pool to only rubric.verdict === 'accept'", async () => {
    const base = gatePools.objection.slice(0, 2);
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
    const base = gatePools.question.slice(0, 2);
    const scoredQuestion = [
      { ...base[0] }, // no drift_verdict field at all — must NOT be admitted
      { ...base[1], drift_verdict: "answers", drift_reason: "resolves it" },
    ];
    await writeFile(path.join(tempDir, "question.json"), JSON.stringify(scoredQuestion));
    const { pools } = await loadFormatPools(tempDir, gatePools);
    expect(pools.question).toHaveLength(1);
    expect(pools.question[0].card_id).toBe(base[1].card_id);
  });

  it("fails closed on a scored Objection row missing rubric entirely", async () => {
    const base = gatePools.objection.slice(0, 2);
    const scoredObjection = [
      { ...base[0] }, // no rubric field at all — must NOT be admitted
      { ...base[1], rubric: { verdict: "accept", classification: "viewer_position", reason: "yes" } },
    ];
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify(scoredObjection));
    const { pools } = await loadFormatPools(tempDir, gatePools);
    expect(pools.objection).toHaveLength(1);
    expect(pools.objection[0].card_id).toBe(base[1].card_id);
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

  it("produces all three formats across default weeks, with The Wall present in non-read-through slots", () => {
    const { formatTotals, nonReadThroughWallCount } = aggregateDefaultWeeks(20);
    expect(formatTotals.wall).toBeGreaterThan(0);
    expect(formatTotals.question).toBeGreaterThan(0);
    expect(formatTotals.objection).toBeGreaterThan(0);
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
    // Exclude a handful of real Wall-pool card ids (NOT from the read-through
    // book, so the read-through slot's own fixed sequence is untouched) so
    // only the weighted-slot pools differ between the two runs.
    const excluded = new Set(gatePools.wall.slice(0, 5).map((e) => e.card_id));
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

  // -------------------------------------------------------------------------
  // A genuine distributional check: aggregate the WEIGHTED slot's format
  // across many independent, non-overlapping weeks (fixed seeds, so this is
  // deterministic and never flaky) and confirm the realized proportions
  // track the requested weight ratio within a tolerance appropriate to the
  // sample size. Restricted to slot 2 (the weighted slot) because slot 1's
  // format can additionally cascade to Wall when its sequential card can't
  // render the drawn candidate (`resolveReadThrough`) — a real and
  // documented behaviour, but a different mechanism than "weighting", so
  // mixing it in here would understate how closely the weighted slot itself
  // tracks the requested ratio.
  // -------------------------------------------------------------------------
  function aggregateWeightedSlotCounts(weights: FormatWeights, n: number): Record<ScheduleFormat, number> {
    const totals: Record<ScheduleFormat, number> = { wall: 0, question: 0, objection: 0 };
    for (let seed = 1; seed <= n; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(),
        readThroughBook: "enchiridion",
        readThroughStartIndex: 0,
        weights,
      });
      for (const slot of week.slots.filter((s) => !s.read_through)) {
        totals[slot.content.format] += 1;
      }
    }
    return totals;
  }

  it("tracks a 1:1 Wall:Question weighting within tolerance over 40 independent weeks (Objection weighted to 0)", () => {
    const totals = aggregateWeightedSlotCounts({ wall: 1, question: 1, objection: 0 }, 40);
    const total = totals.wall + totals.question + totals.objection;
    expect(total).toBe(40 * 7); // one weighted slot per day, 7 days per week
    expect(totals.objection).toBe(0);
    const wallShare = totals.wall / total;
    // Expected 0.5; over 280 draws a 10-point tolerance comfortably covers
    // sampling noise from a fixed, non-cherry-picked seed range while still
    // proving the weighting moved the distribution, not just "some of each".
    expect(wallShare).toBeGreaterThan(0.4);
    expect(wallShare).toBeLessThan(0.6);
  });

  it("tracks a 1:3 Wall:Question weighting within tolerance over 40 independent weeks (Question favoured)", () => {
    const totals = aggregateWeightedSlotCounts({ wall: 1, question: 3, objection: 0 }, 40);
    const total = totals.wall + totals.question + totals.objection;
    expect(totals.objection).toBe(0);
    const questionShare = totals.question / total;
    // Expected 0.75.
    expect(questionShare).toBeGreaterThan(0.65);
    expect(questionShare).toBeLessThan(0.85);
  });
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

describe("M2: read-through Question slots are gated the same as the weighted-slot pool", () => {
  it("every read-through question slot's answer resolves the question and passes layer (a)/(b), across seeds 1..20", () => {
    let questionSlotCount = 0;
    for (let seed = 1; seed <= 20; seed++) {
      // Sweep 10 non-overlapping 7-card windows across all 70 Enchiridion
      // cards (2 seeds per window) rather than always starting at 0 — only 5
      // of Enchiridion's 70 cards pass the full T04 gate, and none of them
      // fall in the first window, so a fixed `readThroughStartIndex: 0`
      // would never exercise this fix at all.
      const startIndex = ((seed - 1) % 10) * 7;
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        pools: gatePools,
        poolSource,
        priorUsedCardIds: new Set(), // isolate each seed — a format-mix sample, not a multi-week sequence
        readThroughBook: "enchiridion",
        readThroughStartIndex: startIndex,
        // Weighted heavily toward Question so the read-through's own draw
        // actually surfaces question-format days often enough to sample —
        // same technique as the "falls back deterministically..." test above.
        weights: { wall: 0, question: 100, objection: 0 },
      });
      for (const slot of week.slots) {
        if (!slot.read_through || slot.content.format !== "question") continue;
        questionSlotCount += 1;
        // The specific defect: an answer that is itself another question
        // (`enchiridion-24-003` reproduced this at seed-scale — "Your
        // country won't have fancy buildings..." is not an answer).
        expect(slot.content.answer.trim().endsWith("?")).toBe(false);
        expect(passesLayerA(slot.content.question)).toBe(true);
        expect(passesLayerB(slot.content.answer)).toBe(true);
      }
    }
    expect(questionSlotCount).toBeGreaterThan(0); // not vacuous — real question slots were exercised
  });
});

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
      eligible_openings: ["standard" as const],
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

    const scoredWallPool = [
      { ...baseEntry, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: alternateLine! } },
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
      eligible_openings: ["standard" as const],
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

  it("names the day, slot, and field when a Question entry's answer was never written by the author", () => {
    const baseEntry = gatePools.question.find((e) => e.book_slug !== "enchiridion")!;
    expect(baseEntry).toBeDefined();
    const tamperedQuestionPool = [{ ...baseEntry!, answer: "An answer the author never actually gave." }];

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

  it("resolves the CORRECT occurrence when a card quotes the same objection span twice (M8 regression)", () => {
    const readThroughCards = Array.from({ length: 7 }, (_, i) =>
      fabricatedCard(`m11-rt-2-${i + 1}`, `Read-through sentence number ${i + 1}.`, "m11-readthrough-2"),
    );
    const card = fabricatedCard(
      "m11-dup-quote",
      'He complains, "But it is not fair at all." Then he walks away and sulks for hours. Later he returns and ' +
        'says again, "But it is not fair at all." The truth is that fairness was never promised to anyone.',
      "m11-pool-2",
    );
    // Fills the weighted slot on days 2-7, once the week's single Objection
    // entry (and its weekly cap) are used up on day 1 — same pattern as
    // M3's fixture above.
    const wallFallbackCards = Array.from({ length: 6 }, (_, i) =>
      fabricatedCard(`m11-wall-${i + 1}`, `Wall fallback sentence number ${i + 1} standing alone.`, "m11-pool-2"),
    );
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
      eligible_openings: ["standard" as const],
    }));

    const gated = objectionGate([card]);
    const duplicates = gated.filter((e) => e.objection === "But it is not fair at all.");
    // Both occurrences of the duplicated quoted span survive the gate —
    // this is the scenario `indexOf` alone could never disambiguate.
    expect(duplicates).toHaveLength(2);
    const secondOccurrence = duplicates[1];
    // Sanity check the fixture actually exercises two DISTINCT offsets,
    // otherwise this test wouldn't be able to tell a correct answer from a
    // wrong (first-occurrence) one.
    expect(duplicates[0].reply_start).not.toBe(duplicates[1].reply_start);

    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards: [...readThroughCards, card, ...wallFallbackCards],
      pools: { wall: wallPool, question: [], objection: [secondOccurrence] },
      poolSource,
      priorUsedCardIds: new Set(),
      readThroughBook: "m11-readthrough-2",
      readThroughStartIndex: 0,
      weights: { wall: 0, question: 0, objection: 1 },
    });

    const objectionSlot = week.slots.find((s) => s.content.format === "objection");
    expect(objectionSlot).toBeDefined();
    if (objectionSlot!.content.format === "objection") {
      // The reply following the SECOND (correct) occurrence — never the
      // narration-plus-re-quote that following the FIRST occurrence would
      // wrongly produce.
      expect(objectionSlot!.content.reply).toBe("The truth is that fairness was never promised to anyone.");
    }
  });
});
