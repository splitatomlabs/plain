import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadCorpus, rankWall, questionGate, objectionGate, wallAuthorWeights } from "../premises.js";
import {
  generateWeek,
  loadFormatPools,
  loadPriorWeeks,
  DEFAULT_FORMAT_WEIGHTS,
  type FormatPools,
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

  it("reads a scored Wall pool file when present, using every entry as-is", async () => {
    const scoredWall = gatePools.wall.slice(0, 3).map((e) => ({ ...e, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: e.landing_line } }));
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify(scoredWall));
    const { pools, source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("scored");
    expect(pools.wall).toHaveLength(3);
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
