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
// T23: the real-time retry path — defaults to rejecting (see beforeEach)
// so every EXISTING "drops a failed item" test still ends up dropped, just
// via one extra (failing) retry attempt, unless a test explicitly opts a
// specific call into succeeding.
const mockCallClaudeJSON = vi.fn();

vi.mock("../claude.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../claude.js")>()),
  createMessageBatch: (...args: unknown[]) => mockCreateMessageBatch(...args),
  pollBatchUntilDone: (...args: unknown[]) => mockPollBatchUntilDone(...args),
  streamBatchResults: (...args: unknown[]) => mockStreamBatchResults(...args),
  callClaudeJSON: (...args: unknown[]) => mockCallClaudeJSON(...args),
}));

import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import {
  chunkArray,
  buildDryRunReport,
  buildWallRequests,
  buildQuestionRequests,
  buildObjectionRequests,
  scoreWallSurvivors,
  scoreQuestionSurvivors,
  scoreObjectionSurvivors,
  MAX_REQUESTS_PER_BATCH,
  faithfulnessStats,
  retryStats,
} from "../premises-batch.js";
import { PARSE_FAILURE_DIR } from "../parse-failure-log.js";
import { loadCorpus, rankWall, questionGate, objectionGate, type QuestionEntry, type RankedWallEntry, type ObjectionEntry } from "../premises.js";
import { logger } from "../logger.js";
import { batchStats, tokenUsage } from "../claude.js";
import type { Card } from "../types.js";
import type { AuthorSlug } from "../constants.js";

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

function makeErroredResult(customId: string) {
  return {
    custom_id: customId,
    result: {
      type: "errored" as const,
      error: { type: "server_error", message: "Internal error" },
    },
  };
}

/** A "succeeded" batch item carrying RAW (not JSON.stringify'd) text, plus a configurable stop_reason/output_tokens — for exercising the parse-failure capture path (T23). */
function makeRawSucceededResult(
  customId: string,
  text: string,
  opts: { stopReason?: string | null; outputTokens?: number } = {},
) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded" as const,
      message: {
        content: [{ type: "text" as const, text }],
        stop_reason: opts.stopReason ?? "end_turn",
        usage: {
          input_tokens: 10,
          output_tokens: opts.outputTokens ?? 5,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    },
  };
}

/** Cleans up a parse-failure capture file if it exists, so tests never leave stray artifacts under content/pipeline/social/parse-failures/. */
async function cleanupCapture(customId: string): Promise<void> {
  await rm(path.join(PARSE_FAILURE_DIR, `${customId}.json`), { force: true });
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
  retryStats.retried = 0;
  retryStats.recovered = 0;
  retryStats.droppedAfterRetry = 0;
  // Default: the real-time retry always fails, so a pre-T23 "drops a
  // failed item" test still ends up dropped (just via one extra failed
  // retry attempt) unless a test explicitly overrides this per-call.
  mockCallClaudeJSON.mockRejectedValue(new Error("retry not configured for this test"));
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
  it("computes per-format counts with no ANTHROPIC_API_KEY set, without calling the SDK", () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const cards = loadCorpus();
      const report = buildDryRunReport(cards);

      const wall = report.formats.find((f) => f.format === "wall")!;
      const question = report.formats.find((f) => f.format === "question")!;
      const objection = report.formats.find((f) => f.format === "objection")!;

      expect(wall.requestCount).toBe(rankWall(cards).length);
      expect(question.requestCount).toBe(questionGate(cards).length);
      expect(objection.requestCount).toBe(objectionGate(cards).length);

      // Only survivors, never the raw corpus.
      expect(wall.requestCount).toBeLessThan(cards.length);
      expect(question.requestCount).toBeLessThan(cards.length);
      expect(objection.requestCount).toBeLessThan(cards.length);

      expect(report.totalRequests).toBe(
        wall.requestCount + question.requestCount + objection.requestCount,
      );
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

// ---------------------------------------------------------------------------
// Request builders — author grouping (for cache locality)
// ---------------------------------------------------------------------------
describe("buildQuestionRequests", () => {
  function makeEntry(overrides: Partial<QuestionEntry> = {}): QuestionEntry {
    return {
      card_id: "card-1",
      book_slug: "meditations",
      author_slug: "marcus-aurelius",
      question: "Is this the right path?",
      answer: "It is not.",
      ...overrides,
    };
  }

  it("groups requests so identical author system prompts are contiguous", () => {
    const entries: QuestionEntry[] = [
      makeEntry({ card_id: "s1", author_slug: "seneca" }),
      makeEntry({ card_id: "e1", author_slug: "epictetus" }),
      makeEntry({ card_id: "s2", author_slug: "seneca" }),
      makeEntry({ card_id: "e2", author_slug: "epictetus" }),
    ];

    const built = buildQuestionRequests(entries);
    const authorSequence = built.map((b) => b.meta.author_slug);
    // Once we move off an author we should never return to it.
    const seen = new Set<AuthorSlug>();
    let current: AuthorSlug | null = null;
    for (const author of authorSequence) {
      if (author !== current) {
        expect(seen.has(author)).toBe(false);
        seen.add(author);
        current = author;
      }
    }
  });

  it("builds one request per entry with a unique custom_id", () => {
    const entries: QuestionEntry[] = [makeEntry({ card_id: "a" }), makeEntry({ card_id: "b" })];
    const built = buildQuestionRequests(entries);
    expect(built).toHaveLength(2);
    const ids = built.map((b) => b.request.custom_id);
    expect(new Set(ids).size).toBe(2);
  });

  it("marks the system prompt as cacheable so per-author caching engages", () => {
    const entries: QuestionEntry[] = [makeEntry({ card_id: "a" })];
    const built = buildQuestionRequests(entries);
    expect(built[0].request.cache_system).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// scoreQuestionSurvivors — submit -> poll -> stream -> merge, over the
// mocked SDK boundary.
// ---------------------------------------------------------------------------
describe("scoreQuestionSurvivors", () => {
  it("merges a successful batch result into the scored pool", async () => {
    const card = makeCard({
      id: "test-card-1",
      plain_english: "Do you want a good life? Then act well. Nothing else matters.",
    });
    const entries = questionGate([card]);
    expect(entries).toHaveLength(1);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_q1" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q1", processing_status: "ended" });

    const requests = buildQuestionRequests(entries);
    const customId = requests[0].request.custom_id;

    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([makeSucceededResult(customId, { verdict: "answers", standalone_intelligible: true, answer_has_substance: true, modern_premise: true, reason: "It resolves the question." })]),
    );

    const scored = await scoreQuestionSurvivors(entries, [card]);

    expect(scored).toHaveLength(1);
    expect(scored[0].card_id).toBe("test-card-1");
    expect(scored[0].drift_verdict).toBe("answers");
    expect(scored[0].drift_reason).toBe("It resolves the question.");
    // T22: the three stopping-power dimensions survive the merge too, kept
    // as their own independent fields alongside (not folded into) drift_verdict.
    expect(scored[0].standalone_intelligible).toBe(true);
    expect(scored[0].answer_has_substance).toBe(true);
    expect(scored[0].modern_premise).toBe(true);
    expect(faithfulnessStats.rejected).toBe(0);
  });

  it("drops an errored item with a logged reason", async () => {
    const cardA = makeCard({
      id: "test-card-a",
      plain_english: "Do you want a good life? Then act well. Nothing else matters.",
    });
    const cardB = makeCard({
      id: "test-card-b",
      plain_english: "Do you fear death? You should not. Death is nothing to you.",
    });
    const entries = questionGate([cardA, cardB]);
    expect(entries.length).toBe(2);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_q2" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q2", processing_status: "ended" });

    const requests = buildQuestionRequests(entries);
    const [okId, badId] = requests.map((r) => r.request.custom_id);

    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult(okId, { verdict: "answers", standalone_intelligible: true, answer_has_substance: true, modern_premise: true, reason: "Resolves it." }),
        makeErroredResult(badId),
      ]),
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const scored = await scoreQuestionSurvivors(entries, [cardA, cardB]);
      expect(scored).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(badId));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("dropped"));
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("drops a malformed-JSON item with a logged reason", async () => {
    const card = makeCard({
      id: "test-card-malformed",
      plain_english: "Do you want a good life? Then act well. Nothing else matters.",
    });
    const entries = questionGate([card]);
    expect(entries).toHaveLength(1);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_q3" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q3", processing_status: "ended" });

    const requests = buildQuestionRequests(entries);
    const customId = requests[0].request.custom_id;

    // Not valid JSON at all (extractJSON will fail to find a parseable object).
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        {
          custom_id: customId,
          result: {
            type: "succeeded" as const,
            message: {
              content: [{ type: "text" as const, text: "not json at all, sorry" }],
              usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
            },
          },
        },
      ]),
    );

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    try {
      const scored = await scoreQuestionSurvivors(entries, [card]);
      expect(scored).toHaveLength(0);
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("failed to parse"));
    } finally {
      warnSpy.mockRestore();
      await cleanupCapture(customId);
    }
  });

  // -------------------------------------------------------------------------
  // T23: parse-failure capture + retry-once + recovered-vs-dropped accounting
  // -------------------------------------------------------------------------

  it("T23: captures the raw response, stop_reason, and output_tokens to disk on a parse failure, then retries once via the real-time API", async () => {
    const card = makeCard({
      id: "test-card-capture",
      plain_english: "Do you want a good life? Then act well. Nothing else matters.",
    });
    const entries = questionGate([card]);
    expect(entries).toHaveLength(1);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_q_capture" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q_capture", processing_status: "ended" });

    const requests = buildQuestionRequests(entries);
    const customId = requests[0].request.custom_id;

    // Truncated-looking response: not valid JSON, stop_reason is max_tokens,
    // output_tokens is unusually high — exactly the shape T23 exists to
    // diagnose (settling truncation vs. a genuinely malformed complete
    // response).
    const rawText = '{"verdict": "answers", "standalone_intellig';
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([makeRawSucceededResult(customId, rawText, { stopReason: "max_tokens", outputTokens: 4096 })]),
    );
    // The retry also fails (default reject from beforeEach) — this item ends up genuinely dropped.

    try {
      const scored = await scoreQuestionSurvivors(entries, [card]);
      expect(scored).toHaveLength(0);

      const capturePath = path.join(PARSE_FAILURE_DIR, `${customId}.json`);
      const captured = JSON.parse(await readFile(capturePath, "utf-8"));
      expect(captured.custom_id).toBe(customId);
      expect(captured.format).toBe("question");
      expect(captured.stop_reason).toBe("max_tokens");
      expect(captured.output_tokens).toBe(4096);
      expect(captured.raw_text).toBe(rawText);
      expect(typeof captured.error).toBe("string");
      expect(captured.error.length).toBeGreaterThan(0);

      // Also dropped after retry, since the retry itself failed.
      expect(retryStats.retried).toBe(1);
      expect(retryStats.recovered).toBe(0);
      expect(retryStats.droppedAfterRetry).toBe(1);
    } finally {
      await cleanupCapture(customId);
    }
  });

  it("T23: recovers a dropped request via one real-time retry, counted separately from a request that stays dropped", async () => {
    const cardRecovers = makeCard({
      id: "test-card-recovers",
      plain_english: "Do you want a good life? Then act well. Nothing else matters.",
    });
    const cardStaysDropped = makeCard({
      id: "test-card-stays-dropped",
      plain_english: "Do you fear death? You should not. Death is nothing to you.",
    });
    const entries = questionGate([cardRecovers, cardStaysDropped]);
    expect(entries).toHaveLength(2);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_q_retry" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q_retry", processing_status: "ended" });

    const requests = buildQuestionRequests(entries);
    const [recoversId, staysDroppedId] = requests.map((r) => r.request.custom_id);

    // First item's batch response is malformed (triggers a retry); second
    // item's batch request errored outright (also triggers a retry).
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeRawSucceededResult(recoversId, "not valid json", { stopReason: "end_turn", outputTokens: 12 }),
        makeErroredResult(staysDroppedId),
      ]),
    );

    // Retry order mirrors the order failures were encountered above: the
    // first retry (for `recoversId`) succeeds with a valid payload; the
    // second retry (for `staysDroppedId`) fails, falling through to the
    // default rejection configured in beforeEach.
    mockCallClaudeJSON.mockResolvedValueOnce({
      verdict: "answers",
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: true,
      reason: "Resolves it on retry.",
    });

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => {});
    try {
      const scored = await scoreQuestionSurvivors(entries, [cardRecovers, cardStaysDropped]);

      expect(scored).toHaveLength(1);
      expect(scored[0].card_id).toBe("test-card-recovers");
      expect(scored[0].drift_verdict).toBe("answers");

      expect(retryStats.retried).toBe(2);
      expect(retryStats.recovered).toBe(1);
      expect(retryStats.droppedAfterRetry).toBe(1);

      // batchStats.failed reflects only the FINAL, post-retry drop — the
      // recovered item must not still be counted as a failure.
      expect(batchStats.succeeded).toBe(1);
      expect(batchStats.failed).toBe(1);

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining(`${recoversId} recovered via retry`));
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining(`${staysDroppedId} retry failed`));
    } finally {
      warnSpy.mockRestore();
      infoSpy.mockRestore();
      await cleanupCapture(recoversId);
    }
  });

  it("submits exactly the gate survivor count against the real corpus, never the full corpus", async () => {
    const cards = loadCorpus();
    const entries = questionGate(cards);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(cards.length);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_full" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_full", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(asyncIterFrom([]));

    await scoreQuestionSurvivors(entries, cards);

    expect(mockCreateMessageBatch).toHaveBeenCalledOnce();
    const submitted = mockCreateMessageBatch.mock.calls[0][0];
    expect(submitted.length).toBe(entries.length);
    expect(submitted.length).not.toBe(cards.length);
  });

  it("throws when the survivor count exceeds the trip-wire ceiling", async () => {
    const oversized = Array.from({ length: 151 }, (_, i) => ({
      card_id: `fake-${i}`,
      book_slug: "meditations",
      author_slug: "marcus-aurelius" as const,
      question: "Is this ok?",
      answer: "It is.",
    }));
    await expect(scoreQuestionSurvivors(oversized, [])).rejects.toThrow(/ceiling/i);
    expect(mockCreateMessageBatch).not.toHaveBeenCalled();
  });
});

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

// ---------------------------------------------------------------------------
// scoreObjectionSurvivors
// ---------------------------------------------------------------------------
describe("scoreObjectionSurvivors", () => {
  it("merges a successful result", async () => {
    const card = makeCard({
      id: "test-obj-1",
      plain_english: 'He grumbled, "But why should I suffer for this?" and walked off.',
    });
    const entries = objectionGate([card]);
    expect(entries).toHaveLength(1);

    const built = buildObjectionRequests(entries, new Map([[card.id, card]]));
    const customId = built[0].request.custom_id;
    expect(built[0].request.cache_system).toBe(true);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_o1" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_o1", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult(customId, {
          verdict: "accept",
          classification: "viewer_position",
          reason: "A plausible personal grievance.",
        }),
      ]),
    );

    const scored = await scoreObjectionSurvivors(entries, [card]);
    expect(scored).toHaveLength(1);
    expect(scored[0].rubric.verdict).toBe("accept");
    expect(scored[0].rubric.classification).toBe("viewer_position");
    expect(faithfulnessStats.rejected).toBe(0);
  });

  it("submits exactly the gate survivor count against the real corpus, never the full corpus", async () => {
    const cards = loadCorpus();
    const entries = objectionGate(cards);
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.length).toBeLessThan(cards.length);

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_full_obj" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_full_obj", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(asyncIterFrom([]));

    await scoreObjectionSurvivors(entries, cards);

    expect(mockCreateMessageBatch).toHaveBeenCalledOnce();
    const submitted = mockCreateMessageBatch.mock.calls[0][0];
    expect(submitted.length).toBe(entries.length);
    expect(submitted.length).not.toBe(cards.length);
  });

  it("throws when the survivor count exceeds the trip-wire ceiling", async () => {
    const oversized = Array.from({ length: 101 }, (_, i) => ({
      card_id: `fake-${i}`,
      author_slug: "seneca" as const,
    })) as unknown as ObjectionEntry[];
    await expect(scoreObjectionSurvivors(oversized, [])).rejects.toThrow(/ceiling/i);
    expect(mockCreateMessageBatch).not.toHaveBeenCalled();
  });
});

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

  describe("The Question", () => {
    it("rejects a synthetic hallucinated question/answer (acceptance test)", async () => {
      const card = makeCard({
        id: "test-q-halluc",
        plain_english: "Do you want a good life? Then act well. Nothing else matters.",
      });
      // A hand-built entry standing in for a hypothetical gate defect or a
      // corrupted intermediate — not derived from questionGate — carrying
      // plausible, well-formed, on-topic text that was never actually
      // written in the card.
      const entries: QuestionEntry[] = [
        {
          card_id: card.id,
          book_slug: card.book_slug,
          author_slug: card.author_slug,
          question: "Do you know what truly matters in your own life?",
          answer: "Only your own choices determine whether you live well.",
        },
      ];

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_q_halluc" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q_halluc", processing_status: "ended" });
      const requests = buildQuestionRequests(entries);
      const customId = requests[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([makeSucceededResult(customId, { verdict: "answers", standalone_intelligible: true, answer_has_substance: true, modern_premise: true, reason: "It resolves the question." })]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreQuestionSurvivors(entries, [card]);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBeGreaterThan(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${card.id}.*"question"`)));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("rejects a near-miss answer with exactly one word substituted", async () => {
      const card = makeCard({
        id: "test-q-nearmiss",
        plain_english: "Do you want a good life? Then act well. Nothing else matters.",
      });
      const gated = questionGate([card]);
      expect(gated).toHaveLength(1);

      const nearMissAnswer = gated[0].answer.replace(/[a-zA-Z]{4,}/, "flibbertigibbet");
      expect(nearMissAnswer).not.toBe(gated[0].answer);
      const entries: QuestionEntry[] = [{ ...gated[0], answer: nearMissAnswer }];

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_q_nearmiss" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q_nearmiss", processing_status: "ended" });
      const requests = buildQuestionRequests(entries);
      const customId = requests[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([makeSucceededResult(customId, { verdict: "answers", standalone_intelligible: true, answer_has_substance: true, modern_premise: true, reason: "n/a" })]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreQuestionSurvivors(entries, [card]);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${card.id}.*"answer"`)));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("admits a faithful question/answer pair (positive control)", async () => {
      const card = makeCard({
        id: "test-q-control",
        plain_english: "Do you want a good life? Then act well. Nothing else matters.",
      });
      const entries = questionGate([card]);
      expect(entries).toHaveLength(1);

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_q_control" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_q_control", processing_status: "ended" });
      const requests = buildQuestionRequests(entries);
      const customId = requests[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([makeSucceededResult(customId, { verdict: "answers", standalone_intelligible: true, answer_has_substance: true, modern_premise: true, reason: "n/a" })]),
      );

      const scored = await scoreQuestionSurvivors(entries, [card]);
      expect(scored).toHaveLength(1);
      expect(faithfulnessStats.rejected).toBe(0);
    });
  });

  describe("The Objection", () => {
    it("rejects a synthetic hallucinated objection/reply (acceptance test)", async () => {
      const card = makeCard({
        id: "test-obj-halluc",
        plain_english: 'He grumbled, "But why should I suffer for this?" and walked off.',
      });
      // A hand-built entry, not derived from objectionGate, carrying
      // plausible, well-formed, on-topic text that was never actually
      // written in the card.
      const entries: ObjectionEntry[] = [
        {
          card_id: card.id,
          book_slug: card.book_slug,
          author_slug: card.author_slug,
          objection: "But why should nobody ever listen to reason around here?",
          reply: "Because reason alone rarely changes a stubborn mind.",
        },
      ];

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_obj_halluc" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_obj_halluc", processing_status: "ended" });
      const built = buildObjectionRequests(entries, new Map([[card.id, card]]));
      const customId = built[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            verdict: "accept",
            classification: "viewer_position",
            reason: "n/a",
          }),
        ]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreObjectionSurvivors(entries, [card]);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBeGreaterThan(0);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${card.id}.*"objection"`)));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("rejects a near-miss objection with exactly one word substituted", async () => {
      const card = makeCard({
        id: "test-obj-nearmiss",
        plain_english: 'He grumbled, "But why should I suffer for this?" and walked off.',
      });
      const gated = objectionGate([card]);
      expect(gated).toHaveLength(1);

      const nearMissObjection = gated[0].objection.replace(/[a-zA-Z]{5,}/, "flibbertigibbet");
      expect(nearMissObjection).not.toBe(gated[0].objection);
      const entries: ObjectionEntry[] = [{ ...gated[0], objection: nearMissObjection }];

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_obj_nearmiss" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_obj_nearmiss", processing_status: "ended" });
      const built = buildObjectionRequests(entries, new Map([[card.id, card]]));
      const customId = built[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            verdict: "accept",
            classification: "viewer_position",
            reason: "n/a",
          }),
        ]),
      );

      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        const scored = await scoreObjectionSurvivors(entries, [card]);
        expect(scored).toHaveLength(0);
        expect(faithfulnessStats.rejected).toBe(1);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(new RegExp(`${card.id}.*"objection"`)));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it("admits a faithful objection/reply pair (positive control)", async () => {
      const card = makeCard({
        id: "test-obj-control",
        plain_english: 'He grumbled, "But why should I suffer for this?" and walked off.',
      });
      const entries = objectionGate([card]);
      expect(entries).toHaveLength(1);

      mockCreateMessageBatch.mockResolvedValue({ id: "batch_obj_control" });
      mockPollBatchUntilDone.mockResolvedValue({ id: "batch_obj_control", processing_status: "ended" });
      const built = buildObjectionRequests(entries, new Map([[card.id, card]]));
      const customId = built[0].request.custom_id;
      mockStreamBatchResults.mockReturnValue(
        asyncIterFrom([
          makeSucceededResult(customId, {
            verdict: "accept",
            classification: "viewer_position",
            reason: "n/a",
          }),
        ]),
      );

      const scored = await scoreObjectionSurvivors(entries, [card]);
      expect(scored).toHaveLength(1);
      expect(faithfulnessStats.rejected).toBe(0);
    });
  });
});
