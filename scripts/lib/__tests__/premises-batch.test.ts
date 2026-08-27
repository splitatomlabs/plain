import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock the Anthropic SDK boundary exactly the way translateBatch.test.ts
// does: mock only the three batch functions (create/poll/stream) so no
// network call or client construction happens, keep everything else
// (safeCustomId, tokenUsage, batchStats, extractJSON) real.
// ---------------------------------------------------------------------------
const mockCreateMessageBatch = vi.fn();
const mockPollBatchUntilDone = vi.fn();
const mockStreamBatchResults = vi.fn();

vi.mock("../claude.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../claude.js")>()),
  createMessageBatch: (...args: unknown[]) => mockCreateMessageBatch(...args),
  pollBatchUntilDone: (...args: unknown[]) => mockPollBatchUntilDone(...args),
  streamBatchResults: (...args: unknown[]) => mockStreamBatchResults(...args),
}));

import { chunkArray, buildDryRunReport, buildWallRequests, scoreWallSurvivors, MAX_REQUESTS_PER_BATCH, faithfulnessStats } from "../premises-batch.js";
import { loadCorpus, rankWall, type RankedWallEntry } from "../premises.js";
import { logger } from "../logger.js";
import { batchStats, tokenUsage } from "../claude.js";
import type { Card } from "../types.js";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "meditations-05-016",
    book_slug: "meditations",
    chapter_slug: "book-05",
    card_number: 16,
    total_cards_in_chapter: 34,
    plain_english: "The quality of your thoughts shapes the quality of your life.",
    original_excerpt: "The happiness of your life depends upon the quality of your thoughts.",
    source_reference: "Meditations, Book 5, Section 16",
    author_slug: "marcus-aurelius",
    tags: ["calm-your-mind"],
    reading_time_seconds: 30,
    ...overrides,
  };
}

async function* asyncIterFrom<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

function makeSucceededResult(customId: string, payload: unknown) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded" as const,
      message: {
        content: [{ type: "text" as const, text: JSON.stringify(payload) }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  batchStats.totalRequests = 0;
  batchStats.succeeded = 0;
  batchStats.failed = 0;
  tokenUsage.inputTokens = 0;
  tokenUsage.outputTokens = 0;
  tokenUsage.cacheReadTokens = 0;
  tokenUsage.cacheCreationTokens = 0;
  faithfulnessStats.rejected = 0;
});

// ---------------------------------------------------------------------------
// chunkArray
// ---------------------------------------------------------------------------
describe("chunkArray", () => {
  it("splits evenly when the array length is a multiple of the chunk size", () => {
    expect(chunkArray([1, 2, 3, 4], 2)).toEqual([[1, 2], [3, 4]]);
  });

  it("splits correctly at the boundary, leaving a smaller final chunk", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single chunk when size exceeds the array length", () => {
    expect(chunkArray([1, 2], 10)).toEqual([[1, 2]]);
  });

  it("returns no chunks for an empty array", () => {
    expect(chunkArray([], 5)).toEqual([]);
  });

  it("throws for a non-positive chunk size", () => {
    expect(() => chunkArray([1, 2], 0)).toThrow(/size must be positive/);
  });
});

// ---------------------------------------------------------------------------
// Dry run — the acceptance criterion: prints request counts with no API
// key set, and never touches the SDK.
// ---------------------------------------------------------------------------
describe("buildDryRunReport", () => {
  it("computes the Wall's counts with no ANTHROPIC_API_KEY set, without calling the SDK", () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const cards = loadCorpus();
      const report = buildDryRunReport(cards);

      const wall = report.formats.find((f) => f.format === "wall")!;

      expect(wall.requestCount).toBe(rankWall(cards).length);

      // Only survivors, never the raw corpus.
      expect(wall.requestCount).toBeLessThan(cards.length);

      expect(report.totalRequests).toBe(wall.requestCount);
      expect(report.totalEstimatedTokens).toBeGreaterThan(0);

      expect(mockCreateMessageBatch).not.toHaveBeenCalled();
      expect(mockPollBatchUntilDone).not.toHaveBeenCalled();
      expect(mockStreamBatchResults).not.toHaveBeenCalled();
    } finally {
      if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
    }
  });

  it("survivor count always equals request count (one request per survivor)", () => {
    const cards = loadCorpus();
    const report = buildDryRunReport(cards);
    for (const f of report.formats) {
      expect(f.requestCount).toBe(f.survivorCount);
    }
  });

  it("reports zero counts for an empty corpus", () => {
    const report = buildDryRunReport([]);
    for (const f of report.formats) {
      expect(f.requestCount).toBe(0);
      expect(f.survivorCount).toBe(0);
      expect(f.estimatedTokens).toBe(0);
    }
    expect(report.totalRequests).toBe(0);
  });
});

// Pf39c2-social-pilot-02a D01: `buildQuestionRequests` and
// `scoreQuestionSurvivors` (T23's parse-failure capture / retry-once /
// recovered-vs-dropped accounting included) were deleted outright along
// with The Question — the channel is one Wall a day, drawn from the Wall
// pool, nothing else.

// ---------------------------------------------------------------------------
// scoreWallSurvivors — also validates chosen_landing_line against the
// candidates actually offered.
// ---------------------------------------------------------------------------
describe("scoreWallSurvivors", () => {
  it("merges a successful result and accumulates token usage", async () => {
    const cards = loadCorpus();
    const entries = rankWall(cards).slice(0, 1);
    expect(entries).toHaveLength(1);

    const built = buildWallRequests(entries, new Map(cards.map((c) => [c.id, c])));
    const customId = built[0].request.custom_id;
    expect(built[0].request.cache_system).toBe(true);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_w1" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_w1", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult(customId, {
          impenetrability_score: 4,
          landing_line_score: 5,
          chosen_landing_line: entries[0].landing_line,
          reason: "Archaic phrasing, clean payoff.",
        }),
      ]),
    );

    const scored = await scoreWallSurvivors(entries, cards);
    expect(scored).toHaveLength(1);
    expect(scored[0].rubric.chosen_landing_line).toBe(entries[0].landing_line);
    expect(tokenUsage.inputTokens).toBeGreaterThan(0);
    expect(faithfulnessStats.rejected).toBe(0);
  });

  it("drops a response whose chosen_landing_line is faithful but not among the offered candidates", async () => {
    const cards = loadCorpus();
    const entries = rankWall(cards).slice(0, 1);
    const card = cards.find((c) => c.id === entries[0].card_id)!;
    const built = buildWallRequests(entries, new Map(cards.map((c) => [c.id, c])));
    const customId = built[0].request.custom_id;

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_w2" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_w2", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult(customId, {
          impenetrability_score: 4,
          landing_line_score: 5,
          // Real, verbatim text from the card (passes T09's faithfulness
          // check) but drawn from original_excerpt, which is never among
          // the plain_english landing-line candidates offered to the model
          // — isolates Wall's SECOND, narrower defense from the faithfulness
          // check itself.
          chosen_landing_line: card.original_excerpt,
          reason: "n/a",
        }),
      ]),
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const scored = await scoreWallSurvivors(entries, cards);
      expect(scored).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("not among the offered candidates"));
      // Faithful, so this drop is NOT counted as a faithfulness rejection.
      expect(faithfulnessStats.rejected).toBe(0);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("throws when the survivor count exceeds the trip-wire ceiling", async () => {
    const oversized = Array.from({ length: 1101 }, (_, i) => ({
      card_id: `fake-${i}`,
      author_slug: "epictetus" as const,
    })) as unknown as RankedWallEntry[];
    await expect(scoreWallSurvivors(oversized, [])).rejects.toThrow(/ceiling/i);
    expect(mockCreateMessageBatch).not.toHaveBeenCalled();
  });
});

// Pf39c2-social-pilot-02a D01: `scoreObjectionSurvivors` was deleted
// outright along with The Objection — the channel is one Wall a day, drawn
// from the Wall pool, nothing else.

// ---------------------------------------------------------------------------
// Batch chunking at the orchestration level — a pool bigger than
// MAX_REQUESTS_PER_BATCH is submitted as multiple batches.
// ---------------------------------------------------------------------------
describe("orchestration batch paging", () => {
  it("splits a pool larger than MAX_REQUESTS_PER_BATCH into multiple createMessageBatch calls", async () => {
    // Question's own survivor ceiling (150) is well under MAX_REQUESTS_PER_BATCH
    // (500), so paging is exercised here via The Wall instead, whose ceiling
    // (1,100) comfortably fits a synthetic pool of MAX_REQUESTS_PER_BATCH + 5.
    // Every synthetic entry maps to its own card (a copy of one real wallGate
    // survivor, renamed) so `buildWallRubricUser`'s `findLandingLines` call
    // still finds real candidates — only card_id/paging behavior is
    // synthetic, the underlying text is real.
    const cards = loadCorpus();
    const [templateEntry] = rankWall(cards).slice(0, 1);
    const templateCard = cards.find((c) => c.id === templateEntry.card_id)!;

    const entries: RankedWallEntry[] = Array.from({ length: MAX_REQUESTS_PER_BATCH + 5 }, (_, i) => ({
      ...templateEntry,
      card_id: `${templateEntry.card_id}-dup-${i}`,
    }));
    const pagedCards: Card[] = entries.map((e) => ({ ...templateCard, id: e.card_id }));

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_page" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_page", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(asyncIterFrom([]));

    await scoreWallSurvivors(entries, pagedCards);

    expect(mockCreateMessageBatch).toHaveBeenCalledTimes(2);
    const firstPage = mockCreateMessageBatch.mock.calls[0][0];
    const secondPage = mockCreateMessageBatch.mock.calls[1][0];
    expect(firstPage.length).toBe(MAX_REQUESTS_PER_BATCH);
    expect(secondPage.length).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// T09: faithfulness enforcement — the central safety property. "Every word
// on screen must be traceable to plain_english or original_excerpt." For
// each format: a synthetic hallucinated response (plausible, well-formed,
// parses cleanly, but NOT present in the source card) must be dropped and
// counted; a near-miss (source text with exactly one word swapped) must
// also be dropped, since a naive fuzzy check would let it through; a
// faithful, verbatim response must be admitted.
// ---------------------------------------------------------------------------
describe("T09 faithfulness enforcement", () => {
  describe("The Wall", () => {
    it("rejects a synthetic hallucinated chosen_landing_line (acceptance test)", async () => {
      const cards = loadCorpus();
      const entries = rankWall(cards).slice(0, 1);
      const card = cards.find((c) => c.id === entries[0].card_id)!;
      const built = buildWallRequests(entries, new Map(cards.map((c) => [c.id, c])));
      const customId = built[0].request.custom_id;

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_w_halluc" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_w_halluc", processing_status: "ended" });
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            impenetrability_score: 4,
            landing_line_score: 5,
            // Plausible, well-formed, on-topic — and entirely invented.
            chosen_landing_line: "Real strength comes from mastering your own reactions, not the world around you.",
            reason: "Reads clean and self-contained.",
          }),
        ]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreWallSurvivors(entries, cards);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(
          expect.stringMatching(new RegExp(`${card.id}.*chosen_landing_line`)),
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("rejects a near-miss with exactly one word substituted", async () => {
      const cards = loadCorpus();
      const entries = rankWall(cards).slice(0, 1);
      const built = buildWallRequests(entries, new Map(cards.map((c) => [c.id, c])));
      const customId = built[0].request.custom_id;

      const nearMiss = entries[0].landing_line.replace(/[a-zA-Z]{5,}/, "flibbertigibbet");
      expect(nearMiss).not.toBe(entries[0].landing_line);

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_w_nearmiss" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_w_nearmiss", processing_status: "ended" });
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            impenetrability_score: 4,
            landing_line_score: 5,
            chosen_landing_line: nearMiss,
            reason: "n/a",
          }),
        ]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreWallSurvivors(entries, cards);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBe(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("admits a faithful, verbatim chosen_landing_line (positive control)", async () => {
      const cards = loadCorpus();
      const entries = rankWall(cards).slice(0, 1);
      const built = buildWallRequests(entries, new Map(cards.map((c) => [c.id, c])));
      const customId = built[0].request.custom_id;

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_w_control" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_w_control", processing_status: "ended" });
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            impenetrability_score: 4,
            landing_line_score: 5,
            chosen_landing_line: entries[0].landing_line,
            reason: "n/a",
          }),
        ]),
      );

      const scored = await scoreWallSurvivors(entries, cards);
      expect(scored).toHaveLength(1);
      expect(faithfulnessStats.rejected).toBe(0);
    });
  });

  // Pf39c2-social-pilot-02a D01: The Question's and The Objection's own
  // faithfulness-enforcement coverage was deleted outright along with those
  // formats — the channel is one Wall a day, drawn from the Wall pool,
  // nothing else. The Wall's own coverage above (hallucination, near-miss,
  // positive control) is unaffected.
});
