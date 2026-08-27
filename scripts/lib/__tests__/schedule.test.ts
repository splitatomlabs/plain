import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  loadCorpus,
  rankWall,
  wallAuthorWeights,
  classifyWallSubTypes,
  type RankedWallEntry,
  type WallSubType,
} from "../premises.js";
import { checkFaithfulness } from "../premises-scoring.js";
import {
  generateWeek,
  loadWallPool,
  loadPriorWeeks,
  isStrongWallEntry,
  WALL_STRONG_IMPENETRABILITY_MIN,
  WALL_STRONG_LANDING_LINE_MIN,
  type WeekSchedule,
  type WallPoolEntry,
} from "../schedule.js";
import { logger } from "../logger.js";
import type { Card } from "../types.js";

// ---------------------------------------------------------------------------
// Real-corpus fixtures, computed once — these tests exercise the generator
// against the actual pipeline output (content/output), same as
// premises.test.ts's own corpus-level tests.
// ---------------------------------------------------------------------------

const cards: Card[] = loadCorpus();
const gateWallPool: RankedWallEntry[] = rankWall(cards);

function makeWeek(week: number, seed: number, priorUsedCardIds: Set<string> = new Set()): WeekSchedule {
  return generateWeek({
    weekNumber: week,
    seed,
    cards,
    wallPool: gateWallPool,
    poolSource: "gate-only",
    priorUsedCardIds,
  });
}

describe("generateWeek", () => {
  it("produces 7 days, one Wall slot each", () => {
    const week = makeWeek(1, 42);
    expect(week.slots).toHaveLength(7);
    expect(week.slots.map((s) => s.day)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    for (const slot of week.slots) {
      expect(slot.content.format).toBe("wall");
    }
  });

  it("never schedules the same card twice within a single week", () => {
    const week = makeWeek(1, 42);
    const ids = week.slots.map((s) => s.card_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("is byte-identical across two independent runs with the same seed", () => {
    const a = makeWeek(1, 42);
    const b = makeWeek(1, 42);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("produces different output for a different seed", () => {
    const a = makeWeek(1, 42);
    const b = makeWeek(1, 43);
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("never reuses a card scheduled in a prior week", () => {
    const week1 = makeWeek(1, 42);
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week2 = makeWeek(2, 42, week1Ids);
    const week2Ids = week2.slots.map((s) => s.card_id);

    for (const id of week2Ids) {
      expect(week1Ids.has(id)).toBe(false);
    }
  });

  it("reports author mix, counts and shares summing to the week's total", () => {
    const week = makeWeek(1, 42);
    const total = Object.values(week.author_mix).reduce((sum, m) => sum + m.count, 0);
    expect(total).toBe(week.slots.length);
    const shares = Object.values(week.author_mix).reduce((sum, m) => sum + m.share, 0);
    expect(shares).toBeCloseTo(1, 5);
  });

  it("reports the pool source verbatim", () => {
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      wallPool: gateWallPool,
      poolSource: "scored",
      priorUsedCardIds: new Set(),
    });
    expect(week.pool_source).toBe("scored");
  });

  it("throws naming the exhausted week/day once the Wall pool runs out", () => {
    const tinyPool = gateWallPool.slice(0, 3);
    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        wallPool: tinyPool,
        poolSource: "gate-only",
        priorUsedCardIds: new Set(),
      }),
    ).toThrow(/pool exhausted/i);
  });

  // -------------------------------------------------------------------------
  // T05's author-balancing lever, exercised directly against a synthetic
  // pool skewed the same way the real corpus's Question pool used to be
  // (Pf39c2-social-pilot-02a D02: there is no Question pool left to correct
  // against, so `wallAuthorWeights([], wallPool, 0)` — see `generateWeek`'s
  // own call — reduces to targeting an even 1/3 split within the Wall pool
  // alone; this proves that reduction actually balances a skewed pool).
  // -------------------------------------------------------------------------
  it("balances a heavily author-skewed Wall pool toward an even split over several independent weeks (directional)", () => {
    function syntheticWallEntries(author: "epictetus" | "marcus-aurelius" | "seneca", n: number, offset: number): RankedWallEntry[] {
      return Array.from({ length: n }, (_, i) => ({
        card_id: `${author}-synth-${offset + i}`,
        book_slug: `${author}-book`,
        author_slug: author,
        original_word_count: 100,
        landing_line: `Synthetic landing line number ${offset + i} for ${author}.`,
        sub_types: [],
        reserve: true,
        archaic_marker_count: 0,
        semicolon_count: 0,
        quote_count: 0,
        original_grade: 8,
      }));
    }
    function syntheticCard(entry: RankedWallEntry): Card {
      return {
        id: entry.card_id,
        book_slug: entry.book_slug,
        chapter_slug: "chapter-01",
        card_number: 1,
        total_cards_in_chapter: 1,
        plain_english: entry.landing_line,
        original_excerpt: `Original excerpt for ${entry.card_id}.`,
        source_reference: `Synthetic, ${entry.card_id}`,
        author_slug: entry.author_slug,
        tags: ["calm-your-mind"],
        reading_time_seconds: 20,
      };
    }

    // Heavily skewed: 50 epictetus / 5 marcus-aurelius / 5 seneca, mirroring
    // the historically-measured Question-pool skew this mechanism was built
    // to counteract (see premises.test.ts's own REAL_QUESTION_POOL_SPLIT).
    const skewedEntries = [
      ...syntheticWallEntries("epictetus", 50, 0),
      ...syntheticWallEntries("marcus-aurelius", 5, 0),
      ...syntheticWallEntries("seneca", 5, 0),
    ];
    const skewedCards = skewedEntries.map(syntheticCard);

    const weights = wallAuthorWeights([], skewedEntries, 0);
    // With no other format left to correct against, `wallAuthorWeights`'s
    // combined-mix algebra (questionFraction 0) reduces to targeting an
    // even 1/3 per author DIRECTLY — regardless of how skewed the raw pool
    // is — so every author present gets weight 1/3, not a value that varies
    // with the 50/5/5 split.
    expect(weights.epictetus).toBeCloseTo(1 / 3, 10);
    expect(weights["marcus-aurelius"]).toBeCloseTo(1 / 3, 10);
    expect(weights.seneca).toBeCloseTo(1 / 3, 10);

    const seen: Record<string, number> = { epictetus: 0, "marcus-aurelius": 0, seneca: 0 };
    for (let w = 1; w <= 5; w++) {
      const week = generateWeek({
        weekNumber: w,
        seed: 100 + w,
        cards: skewedCards,
        wallPool: skewedEntries,
        poolSource: "gate-only",
        priorUsedCardIds: new Set(), // isolate each week so pool depletion doesn't skew this
      });
      for (const slot of week.slots) seen[slot.author_slug] += 1;
    }
    // Directional: despite the 50/5/5 raw pool, the weighted draw pulls
    // epictetus's share well below what an unweighted draw would produce.
    const total = seen.epictetus + seen["marcus-aurelius"] + seen.seneca;
    expect(seen.epictetus / total).toBeLessThan(0.5);
  });
});

// ---------------------------------------------------------------------------
// M4/M5/M10-style faithfulness proofs, Wall-only (D02).
// ---------------------------------------------------------------------------

describe("faithfulness", () => {
  it("every landing_line is a verbatim substring of its card's plain_english or original_excerpt, across seeds 1..20", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const week = makeWeek(1, seed);
      for (const slot of week.slots) {
        const card = cards.find((c) => c.id === slot.card_id)!;
        const result = checkFaithfulness(slot.content.landing_line, card);
        expect(result.faithful).toBe(true);
      }
    }
  });

  // Single-entry pools below: with exactly one Wall pool entry, day 1 draws
  // it deterministically (no need to force other entries out via
  // priorUsedCardIds, which would otherwise starve every OTHER day and
  // throw "pool exhausted" before reaching the assertion).
  it("uses rubric.chosen_landing_line for a scored Wall entry, not the mechanical landing_line", () => {
    const base = gateWallPool[0];
    const card = cards.find((c) => c.id === base.card_id)!;
    // The rubric's chosen line must itself be a real substring of the
    // card's own text — this test proves PREFERENCE, not faithfulness
    // bypass, so it picks a genuinely different, still-faithful sentence.
    // V02 (social pilot 02a) shrank the payoff-screen cap enough that
    // `gateWallPool[0]`'s card can have very few sentences, so — unlike the
    // pre-V02 fixture — the LAST sentence isn't guaranteed to differ from
    // the mechanical landing line (`selectLandingLine` also prefers the
    // last qualifying sentence). Pick the first sentence that differs
    // instead of always the last.
    const sentences = (card.plain_english.match(/[^.!?]+[.!?]/g) ?? [card.plain_english]).map((s) => s.trim());
    const alt = sentences.find((s) => s !== base.landing_line) ?? base.landing_line;
    const scoredEntry: WallPoolEntry = { ...base, rubric: { impenetrability_score: 5, landing_line_score: 5 } };
    (scoredEntry as unknown as { rubric: { chosen_landing_line: string } }).rubric.chosen_landing_line = alt;

    // Pool size exactly matches the week's 7 draws (1 scored + 6 fillers),
    // so all 7 entries are scheduled — including the scored one — with no
    // risk of "pool exhausted" (which a smaller pool would hit on day 2+).
    const fillers = gateWallPool.slice(1, 7);
    const week = generateWeek({
      weekNumber: 1,
      seed: 1,
      cards,
      wallPool: [scoredEntry, ...fillers],
      poolSource: "scored",
      priorUsedCardIds: new Set(),
    });
    const slot = week.slots.find((s) => s.card_id === base.card_id);
    expect(slot).toBeDefined();
    expect(slot!.content.landing_line).toBe(alt);
    expect(slot!.content.landing_line).not.toBe(base.landing_line);
  });

  it("throws naming the day when a scored Wall entry's chosen_landing_line was never written by the author", () => {
    const base = gateWallPool[0];
    const fabricated: WallPoolEntry = {
      ...base,
      rubric: { impenetrability_score: 5, landing_line_score: 5 },
    };
    (fabricated as unknown as { rubric: { chosen_landing_line: string } }).rubric.chosen_landing_line =
      "This exact sentence was never written anywhere in the corpus, guaranteed.";

    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        wallPool: [fabricated],
        poolSource: "scored",
        priorUsedCardIds: new Set(),
      }),
    ).toThrow(/day 1/);
  });

  it("treats an empty scored Wall landing line as a faithfulness FAILURE, not something to silently skip", () => {
    const base = gateWallPool[0];
    const emptyLine: WallPoolEntry = { ...base, landing_line: "" };
    expect(() =>
      generateWeek({
        weekNumber: 1,
        seed: 1,
        cards,
        wallPool: [emptyLine],
        poolSource: "gate-only",
        priorUsedCardIds: new Set(),
      }),
    ).toThrow(/field is empty/i);
  });
});

// ---------------------------------------------------------------------------
// loadWallPool — the T11 fallback contract, plus F05's exclusion gating.
// ---------------------------------------------------------------------------

describe("loadWallPool", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "schedule-pool-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("falls back to the mechanical gate output when no scored pool file exists", async () => {
    const { pool, source } = await loadWallPool(tempDir, gateWallPool);
    expect(source).toBe("gate-only");
    expect(pool).toBe(gateWallPool);
  });

  it("reads a scored Wall pool file when present, preserving a rubric-chosen landing line distinct from the mechanical one", async () => {
    const scoredWall = gateWallPool
      .slice(0, 3)
      .map((e) => ({ ...e, rubric: { impenetrability_score: 5, landing_line_score: 5, chosen_landing_line: `${e.landing_line} (rubric pick)` } }));
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify(scoredWall));
    const { pool, source } = await loadWallPool(tempDir, gateWallPool);
    expect(source).toBe("scored");
    expect(pool).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      const entry = pool[i] as (typeof scoredWall)[number];
      expect(entry.rubric.chosen_landing_line).toBe(`${gateWallPool[i].landing_line} (rubric pick)`);
    }
  });

  it("reads a scored Wall pool file written in the current { meta, entries } envelope shape", async () => {
    const scoredWall = gateWallPool.slice(0, 2);
    await writeFile(
      path.join(tempDir, "wall.json"),
      JSON.stringify({ meta: { complete: true, capped: false, dropped: 0 }, entries: scoredWall }),
    );
    const { pool, source } = await loadWallPool(tempDir, gateWallPool);
    expect(source).toBe("scored");
    expect(pool).toHaveLength(2);
  });

  it("falls back to the mechanical gate when the Wall pool file is a legacy empty array", async () => {
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify([]));
    const { pool, source } = await loadWallPool(tempDir, gateWallPool);
    expect(source).toBe("gate-only");
    expect(pool).toBe(gateWallPool);
  });

  it("falls back to the mechanical gate when the Wall pool file is an envelope with empty entries", async () => {
    await writeFile(path.join(tempDir, "wall.json"), JSON.stringify({ meta: { complete: true }, entries: [] }));
    const { pool, source } = await loadWallPool(tempDir, gateWallPool);
    expect(source).toBe("gate-only");
    expect(pool).toBe(gateWallPool);
  });

  async function writeExclusionsFile(wall: { card_id: string; book_slug: string; axis: string; reason: string }[]): Promise<string> {
    const filePath = path.join(tempDir, "render-exclusions.json");
    await writeFile(
      filePath,
      JSON.stringify({
        meta: {
          generated_at: "2026-08-25T00:00:00.000Z",
          max_post_duration_frames: 1770,
          max_post_duration_seconds: 59,
          wall: { submitted: 896, succeeded: 896 - wall.length, dropped: wall.length },
        },
        wall,
      }),
    );
    return filePath;
  }

  // V02 (social pilot 02a) shrank `gateWallPool` (168 entries) enough that
  // the fixed card id these two tests used to hardcode ("on-anger-03-027")
  // no longer survives the <=5-payoff-screen cap. Derive the excluded id
  // from the pool itself instead, so these tests stay meaningful (and stay
  // passing non-vacuously) regardless of which cards the cap happens to
  // admit.
  const excludedCard = gateWallPool[0];

  it("drops excluded ids from the Wall pool and logs it", async () => {
    expect(gateWallPool.some((e) => e.card_id === excludedCard.card_id)).toBe(true);
    const exclusionsPath = await writeExclusionsFile([
      { card_id: excludedCard.card_id, book_slug: excludedCard.book_slug, axis: "duration", reason: "synthetic fixture — see F05" },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pool, exclusions } = await loadWallPool(tempDir, gateWallPool, exclusionsPath);
      expect(pool.some((e) => e.card_id === excludedCard.card_id)).toBe(false);
      expect(pool.length).toBe(gateWallPool.length - 1);
      expect(exclusions).not.toBeNull();
      expect(exclusions!.wall.has(excludedCard.card_id)).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped 1 Wall pool entry"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("an excluded id never appears in a generated week", async () => {
    const exclusionsPath = await writeExclusionsFile([
      { card_id: excludedCard.card_id, book_slug: excludedCard.book_slug, axis: "duration", reason: "synthetic fixture — see F05" },
    ]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let pool: RankedWallEntry[];
    try {
      ({ pool } = await loadWallPool(tempDir, gateWallPool, exclusionsPath));
    } finally {
      warnSpy.mockRestore();
    }

    for (let seed = 1; seed <= 20; seed++) {
      const week = generateWeek({
        weekNumber: 1,
        seed,
        cards,
        wallPool: pool,
        poolSource: "gate-only",
        priorUsedCardIds: new Set(),
      });
      expect(week.slots.some((s) => s.card_id === excludedCard.card_id)).toBe(false);
    }
  });

  it("with no exclusions file present, loadWallPool behaves exactly as before F05 and logs that it is running ungated", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const { pool, exclusions } = await loadWallPool(tempDir, gateWallPool, path.join(tempDir, "render-exclusions.json"));
      expect(pool).toBe(gateWallPool);
      expect(exclusions).toBeNull();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("running the Wall pool UNGATED"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("with no exclusionsPath argument at all, loadWallPool behaves exactly as before F05 (the option is fully optional)", async () => {
    const { pool, exclusions } = await loadWallPool(tempDir, gateWallPool);
    expect(pool).toBe(gateWallPool);
    expect(exclusions).toBeNull();
  });

  it("rejects a present-but-non-object exclusions file (e.g. a bare JSON array) with the 'unrecognized shape' message", async () => {
    const exclusionsPath = path.join(tempDir, "render-exclusions.json");
    await writeFile(exclusionsPath, "[]");
    await expect(loadWallPool(tempDir, gateWallPool, exclusionsPath)).rejects.toThrow(/unrecognized shape/i);
  });

  it("rejects an exclusions file missing the wall section, naming it in the error", async () => {
    const exclusionsPath = path.join(tempDir, "render-exclusions.json");
    await writeFile(
      exclusionsPath,
      JSON.stringify({
        meta: { generated_at: "2026-08-25T00:00:00.000Z" },
        // wall deliberately omitted.
      }),
    );
    await expect(loadWallPool(tempDir, gateWallPool, exclusionsPath)).rejects.toThrow(/wall/);
  });
});

// ---------------------------------------------------------------------------
// loadPriorWeeks
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
  });

  it("aggregates used card ids across prior week files", async () => {
    const week1 = makeWeek(1, 42);
    await mkdir(tempDir, { recursive: true });
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));

    const state = await loadPriorWeeks(tempDir, 2);
    expect(state.usedCardIds.size).toBe(7);
    for (const slot of week1.slots) {
      expect(state.usedCardIds.has(slot.card_id)).toBe(true);
    }
  });

  it("ignores weeks at or after the requested week number", async () => {
    const week1 = makeWeek(1, 42);
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));
    const week2 = makeWeek(2, 42, new Set(week1.slots.map((s) => s.card_id)));
    await writeFile(path.join(tempDir, "pilot-schedule-w02.json"), JSON.stringify(week2));

    // Requesting state for week 2 should only read week 1.
    const state = await loadPriorWeeks(tempDir, 2);
    expect(state.usedCardIds.size).toBe(7);
  });

  it("rejects when an earlier week's file is missing (a gap in the range), naming the missing file", async () => {
    const week1 = makeWeek(1, 42);
    await writeFile(path.join(tempDir, "pilot-schedule-w01.json"), JSON.stringify(week1));
    // w02 deliberately never written — simulates it being moved/deleted.
    const week1Ids = new Set(week1.slots.map((s) => s.card_id));
    const week3 = makeWeek(3, 42, week1Ids);
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
// Determinism (extended) — multi-week disk-persisted chains.
// ---------------------------------------------------------------------------

describe("determinism (extended)", () => {
  it("produces different output for the same seed when prior-week history differs", () => {
    // Excluding a card the baseline run would otherwise have drawn changes
    // the candidate pool at the moment it's drawn, which changes that day's
    // pick — picking an arbitrary early card id (like index 0/1 of a
    // ~1,000-entry pool) isn't guaranteed to ever be drawn in a single
    // 7-slot week, so this derives the excluded id FROM a real baseline run
    // instead of guessing one.
    const baseline = makeWeek(2, 7, new Set());
    const idToExclude = baseline.slots[0].card_id;
    const a = makeWeek(2, 7, new Set());
    const b = makeWeek(2, 7, new Set([idToExclude]));
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it("contains no timestamp-shaped field anywhere in the serialized week (a generation time would break byte-identity)", () => {
    const week = makeWeek(1, 42);
    const json = JSON.stringify(week);
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  describe("across a disk-persisted multi-week chain", () => {
    let tempDir: string;

    beforeEach(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "schedule-chain-test-"));
    });

    afterEach(async () => {
      await rm(tempDir, { recursive: true, force: true });
    });

    async function generateAndPersist(week: number, seed: number): Promise<WeekSchedule> {
      const { usedCardIds } = await loadPriorWeeks(tempDir, week);
      const schedule = generateWeek({
        weekNumber: week,
        seed,
        cards,
        wallPool: gateWallPool,
        poolSource: "gate-only",
        priorUsedCardIds: usedCardIds,
      });
      await writeFile(path.join(tempDir, `pilot-schedule-w${String(week).padStart(2, "0")}.json`), JSON.stringify(schedule));
      return schedule;
    }

    it("has no duplicate card id across the union of 4 consecutive weeks (28 slots, the pilot's full length)", async () => {
      const weeks: WeekSchedule[] = [];
      for (let w = 1; w <= 4; w++) weeks.push(await generateAndPersist(w, 6000 + w));
      const allIds = weeks.flatMap((w) => w.slots.map((s) => s.card_id));
      expect(new Set(allIds).size).toBe(allIds.length);
      expect(allIds).toHaveLength(28);
    });

    it("regenerating week 3 twice, with weeks 1-2 already on disk, is byte-identical", async () => {
      await generateAndPersist(1, 111);
      await generateAndPersist(2, 222);
      const { usedCardIds: used } = await loadPriorWeeks(tempDir, 3);
      const a = generateWeek({ weekNumber: 3, seed: 333, cards, wallPool: gateWallPool, poolSource: "gate-only", priorUsedCardIds: used });
      const b = generateWeek({ weekNumber: 3, seed: 333, cards, wallPool: gateWallPool, poolSource: "gate-only", priorUsedCardIds: used });
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("excludes week 2's cards using state read from a fresh disk load of week 1 (not in-memory carryover)", async () => {
      const week1 = await generateAndPersist(1, 42);
      const { usedCardIds } = await loadPriorWeeks(tempDir, 2);
      const week2 = generateWeek({ weekNumber: 2, seed: 42, cards, wallPool: gateWallPool, poolSource: "gate-only", priorUsedCardIds: usedCardIds });
      const week1Ids = new Set(week1.slots.map((s) => s.card_id));
      for (const slot of week2.slots) expect(week1Ids.has(slot.card_id)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// T21: Wall selection respects rubric scores.
// ---------------------------------------------------------------------------

describe("T21: Wall selection respects rubric scores", () => {
  it("threshold constants are the documented values (both 4 on the 1-5 scale)", () => {
    expect(WALL_STRONG_IMPENETRABILITY_MIN).toBe(4);
    expect(WALL_STRONG_LANDING_LINE_MIN).toBe(4);
  });

  it("isStrongWallEntry requires BOTH axes to clear the threshold", () => {
    const base = gateWallPool[0];
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 4, landing_line_score: 4 } })).toBe(true);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 3, landing_line_score: 5 } })).toBe(false);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 5, landing_line_score: 3 } })).toBe(false);
    expect(isStrongWallEntry({ ...base, rubric: { impenetrability_score: 3, landing_line_score: 3 } })).toBe(false);
  });

  it("treats every gate-only entry (no rubric at all) as strong, not sub-strong", () => {
    expect(isStrongWallEntry(gateWallPool[0])).toBe(true);
  });

  it("a gate-only pool (no rubric fields) still schedules a full week normally", () => {
    const week = makeWeek(1, 42);
    expect(week.slots).toHaveLength(7);
  });

  describe("reserve fallback (small synthetic pool forced to exhaustion)", () => {
    function makeEntry(id: string, strong: boolean): WallPoolEntry {
      const base = gateWallPool[0];
      return {
        ...base,
        card_id: id,
        book_slug: base.book_slug,
        landing_line: cards.find((c) => c.id === base.card_id)!.plain_english,
        rubric: strong ? { impenetrability_score: 5, landing_line_score: 5 } : { impenetrability_score: 2, landing_line_score: 2 },
      };
    }

    it("draws every strong entry before touching reserve, and logs a warning naming the reserve fallback once strong is exhausted", () => {
      const strongIds = ["strong-1", "strong-2"];
      // Exactly 7 entries total (2 strong + 5 reserve), matching the week's
      // 7 draws exactly — so the week completes normally instead of
      // throwing "pool exhausted" partway through.
      const reserveIds = ["reserve-1", "reserve-2", "reserve-3", "reserve-4", "reserve-5"];
      const card = cards.find((c) => c.id === gateWallPool[0].card_id)!;
      const syntheticCards = [...strongIds, ...reserveIds].map((id) => ({ ...card, id, book_slug: "synthetic" }));
      const entries = [...strongIds.map((id) => makeEntry(id, true)), ...reserveIds.map((id) => makeEntry(id, false))].map((e, i) => ({
        ...e,
        card_id: [...strongIds, ...reserveIds][i],
        book_slug: "synthetic",
      }));

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const week = generateWeek({
          weekNumber: 1,
          seed: 1,
          cards: [...cards, ...syntheticCards],
          wallPool: entries,
          poolSource: "scored",
          priorUsedCardIds: new Set(),
        });
        const drawnIds = week.slots.map((s) => s.card_id);
        expect(new Set(drawnIds)).toEqual(new Set([...strongIds, ...reserveIds]));
        // Both strong entries are drawn strictly before any reserve entry.
        const strongPositions = strongIds.map((id) => drawnIds.indexOf(id));
        const reservePositions = reserveIds.map((id) => drawnIds.indexOf(id));
        expect(Math.max(...strongPositions)).toBeLessThan(Math.min(...reservePositions));
        expect(warnSpy.mock.calls.some((c) => /strong pool exhausted/.test(String(c[0])))).toBe(true);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});

// ---------------------------------------------------------------------------
// T19: Wall sub-type spacing (simplified by D02 — no read-through, so every
// day draws from the same pool with no "never reorder" exception; spacing
// can apply freely, day to day).
// ---------------------------------------------------------------------------

describe("T19: Wall sub-type spacing", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const THOU_WALL_EXCERPT = "Thou hath spoken, and thy word is true.";
  const CASCADE_EXCERPT = "One; two; three; four of these matters remain unresolved.";

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

  it("prefers a disjoint sub-type for the next day while the pool allows it, and reports every back-to-back repeat once it can't", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    // Deliberately IMBALANCED — 2 thou_wall + 6 cascade (8 total, 1 spare
    // so the pool never runs out entirely, a separate failure mode from
    // "can't space") — a 7-day sequence with only 2 disjoint kinds can
    // avoid ANY back-to-back repeat only if neither kind is needed more
    // than 4 times (a 7-slot alternating sequence is at most 4-3); with
    // only 2 thou_wall entries available, at least one cascade/cascade
    // repeat is mathematically forced once they're exhausted.
    const freePoolCards: Card[] = [];
    const freePoolEntries: RankedWallEntry[] = [];
    let n = 0;
    for (let i = 0; i < 2; i++) {
      n += 1;
      const card = makeFreePoolCard(n, "thou_wall");
      freePoolCards.push(card);
      freePoolEntries.push(makeFreePoolEntry(card, ["thou_wall"]));
    }
    for (let i = 0; i < 6; i++) {
      n += 1;
      const card = makeFreePoolCard(n, "cascade");
      freePoolCards.push(card);
      freePoolEntries.push(makeFreePoolEntry(card, ["cascade"]));
    }

    const week = generateWeek({
      weekNumber: 1,
      seed: 42,
      cards: freePoolCards,
      wallPool: freePoolEntries,
      poolSource: "gate-only",
      priorUsedCardIds: new Set(),
    });

    expect(week.slots).toHaveLength(7);

    const thouWallIds = new Set(freePoolEntries.filter((e) => e.sub_types.includes("thou_wall")).map((e) => e.card_id));
    const cascadeIds = new Set(freePoolEntries.filter((e) => e.sub_types.includes("cascade")).map((e) => e.card_id));
    const dayKinds = week.slots
      .sort((a, b) => a.day - b.day)
      .map((s) => (thouWallIds.has(s.card_id) ? "thou_wall" : cascadeIds.has(s.card_id) ? "cascade" : "unknown"));

    // Independently re-derive the exact set of days whose sub-type repeats
    // the immediately preceding day's, and confirm the warning log matches
    // it exactly — no silent repeat, no false-alarm report.
    let expectedRepeats = 0;
    for (let i = 1; i < dayKinds.length; i++) {
      if (dayKinds[i] === dayKinds[i - 1]) expectedRepeats += 1;
    }
    const spacingWarnings = warnSpy.mock.calls
      .map((call) => String(call[0]))
      .filter((m) => /Wall sub-type spacing could not be honored/.test(m));
    expect(spacingWarnings).toHaveLength(expectedRepeats);
    // The mechanism actually exercised both branches on this fixture (a
    // vacuous 0 would not prove anything): with only 2 disjoint kinds and 7
    // days to fill from an 8-entry pool, at least one repeat is forced once
    // one kind's supply runs low.
    expect(expectedRepeats).toBeGreaterThan(0);
  });

  describe("against the real corpus (multi-week, wall-dominant chain)", () => {
    const premisesDir = path.join(process.cwd(), "content", "social", "premises");

    it("every back-to-back Wall sub-type repeat within a generated week is exactly the set that gets reported — no silent repeat, no false-alarm report", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const { pool, source } = await loadWallPool(premisesDir, gateWallPool);
      expect(source).toBe("scored"); // exercising the real scored pool's own sub_types field
      const subTypesByPoolCardId = new Map(pool.map((e) => [e.card_id, e.sub_types]));

      const priorUsedCardIds = new Set<string>();
      let totalRepeats = 0;
      let totalSpacingWarnings = 0;

      for (let week = 1; week <= 8; week++) {
        warnSpy.mockClear();
        const schedule = generateWeek({
          weekNumber: week,
          seed: 6000 + week,
          cards,
          wallPool: pool,
          poolSource: source,
          priorUsedCardIds,
        });

        const ordered = [...schedule.slots].sort((a, b) => a.day - b.day);
        for (let i = 1; i < ordered.length; i++) {
          const prevSub = subTypesByPoolCardId.get(ordered[i - 1].card_id);
          const curSub = subTypesByPoolCardId.get(ordered[i].card_id);
          expect(prevSub).toBeDefined();
          expect(curSub).toBeDefined();
          if (prevSub!.some((t) => curSub!.includes(t))) totalRepeats += 1;
        }

        const spacingWarnings = warnSpy.mock.calls
          .map((call) => String(call[0]))
          .filter((m) => /Wall sub-type spacing could not be honored/.test(m));
        totalSpacingWarnings += spacingWarnings.length;

        for (const slot of schedule.slots) priorUsedCardIds.add(slot.card_id);
      }

      // MEASURED (real 685-entry scored Wall pool, 8 weeks x 7 days = 56
      // draws): totalRepeats/totalSpacingWarnings are BOTH 0 — at one Wall
      // slot per day (down from 2/day pre-D02), and with the majority of
      // the pool carrying no sub-type at all (reserve entries never
      // intersect anything), the scheduler essentially never runs out of a
      // disjoint alternative to space with. This is a real, expected
      // consequence of the reduced cadence, not a bug — the synthetic fixture
      // test above proves the report mechanism DOES fire under genuine
      // scarcity. The correspondence check below is what still matters here:
      // whatever DOES repeat is always reported, and nothing is reported
      // that didn't actually repeat.
      expect(totalSpacingWarnings).toBe(totalRepeats);
    });
  });
});
