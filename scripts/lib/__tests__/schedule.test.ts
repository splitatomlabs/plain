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
import type { AuthorSlug } from "../constants.js";

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
    const base = gatePools.question.slice(0, 2);
    const entries = [
      { ...base[0], drift_verdict: "answers", drift_reason: "resolves it" },
      { ...base[1], drift_verdict: "drifts", drift_reason: "off topic" },
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
    const scoredObjection = [{ ...gatePools.objection[0], rubric: { verdict: "accept", classification: "viewer_position", reason: "yes" } }];
    await writeFile(path.join(tempDir, "objection.json"), JSON.stringify(scoredObjection));
    const { source } = await loadFormatPools(tempDir, gatePools);
    expect(source.wall).toBe("gate-only");
    expect(source.question).toBe("gate-only");
    expect(source.objection).toBe("scored");
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

  it("resolves the correct occurrence when the whole objection SENTENCE repeats verbatim (M12 gate cursor)", () => {
    const pe = 'He says "But it is not fair at all." He says "But it is not fair at all." The truth is plain.';
    const card = fabricatedCard("m12-dup-sentence", pe, "m12-pool");
    const [first, second] = objectionGate([card]);

    expect(second.reply_start).toBeGreaterThan(first.reply_start);
    for (const e of [first, second]) {
      expect(pe.slice(0, e.reply_start).endsWith(`"${e.objection}"`)).toBe(true);
      expect(pe.slice(e.reply_start).trim()).toBe(e.reply);
    }
    expect(pe.slice(second.reply_start).trim()).toBe("The truth is plain.");
  });

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
    // doesn't depend on that exact card surviving future corpus edits.
    const emptyReplyRtCard = fabricatedCard(
      "m14-rt-1",
      `He said, "But why should I bother with any of this?"`,
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
      eligible_openings: ["standard" as const],
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
      expect(day1Slot1.content.landing_line).toBe(emptyReplyRtCard.plain_english);
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

describe("M15: the read-through's own Objection resolution counts against the weekly cap", () => {
  it("format_counts.objection never exceeds max_objection_per_week, across seeds 1..200 x weeks 1..10 (DEFAULT_FORMAT_WEIGHTS, isolated weeks)", () => {
    let sawReadThroughObjection = false;
    for (let seed = 1; seed <= 200; seed++) {
      for (let week = 1; week <= 10; week++) {
        // Sweep 10 non-overlapping 7-card windows across Enchiridion's 70
        // cards (as M2 does above) so the read-through's own sequential
        // card actually varies rather than always starting at index 0.
        const startIndex = ((week - 1) % 10) * 7;
        const schedule = generateWeek({
          weekNumber: week,
          seed: seed * 1000 + week, // a distinct rng stream per (seed, week) pair
          cards,
          pools: gatePools,
          poolSource,
          priorUsedCardIds: new Set(), // isolate each (seed, week) — a cap sample, not a chained sequence
          readThroughBook: "enchiridion",
          readThroughStartIndex: startIndex,
          weights: DEFAULT_FORMAT_WEIGHTS,
        });
        expect(schedule.format_counts.objection).toBeLessThanOrEqual(schedule.max_objection_per_week);
        const rtObjection = schedule.slots.some((s) => s.read_through && s.content.format === "objection");
        if (rtObjection) sawReadThroughObjection = true;
      }
    }
    // Not vacuous — the sweep must actually land on at least one week where
    // the read-through itself resolved to Objection, otherwise this test
    // would pass trivially without ever exercising the increment.
    expect(sawReadThroughObjection).toBe(true);
  });
});

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
      "(measured post-T17, seed 42 week 1: epictetus 21.4%, marcus-aurelius 57.1%, seneca 21.4% — " +
      "T17 makes wallAuthorWeights account for the read-through's fixed 50% marcus-aurelius floor, " +
      "materially raising seneca from the pre-T17 7.1% without marcus-aurelius losing its majority)",
    () => {
      const week = makeDefaultWeek(1, 42);
      const mix = week.author_mix;
      expect(mix["marcus-aurelius"].share).toBeGreaterThan(mix.epictetus.share);
      expect(mix["marcus-aurelius"].share).toBeGreaterThan(mix.seneca.share);
      expect(mix["marcus-aurelius"].share).toBeGreaterThan(0.5); // an outright majority, not merely a plurality
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
    // Marcus-aurelius keeps its majority — the read-through's own 50% floor
    // guarantees this regardless of Wall's weighting.
    expect(marcusShare).toBeGreaterThan(0.5);
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
