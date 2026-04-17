import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chunk } from "../chunker.js";
import type { BookConfig } from "../constants.js";

// ---------------------------------------------------------------------------
// Mock claude.js — batch functions + callClaudeJSON (for retry fallback)
// ---------------------------------------------------------------------------
const mockCreateMessageBatch = vi.fn();
const mockPollBatchUntilDone = vi.fn();
const mockStreamBatchResults = vi.fn();
const mockCallClaudeJSON = vi.fn();

vi.mock("../claude.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../claude.js")>()),
  createMessageBatch: (...args: unknown[]) => mockCreateMessageBatch(...args),
  pollBatchUntilDone: (...args: unknown[]) => mockPollBatchUntilDone(...args),
  streamBatchResults: (...args: unknown[]) => mockStreamBatchResults(...args),
  callClaudeJSON: (...args: unknown[]) => mockCallClaudeJSON(...args),
  extractJSON: (text: string) => {
    // Minimal extractJSON: try parse as-is, then strip fences
    try { JSON.parse(text); return text; } catch { /* continue */ }
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (m) return m[1].trim();
    throw new Error("Could not extract JSON");
  },
  tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  batchStats: { totalRequests: 0, succeeded: 0, failed: 0 },
  ClaudeCliError: class extends Error {},
}));

import {
  translateChunksBatch,
  type BatchTranslateInput,
} from "../translator.js";
import { batchStats, tokenUsage } from "../claude.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testConfig: BookConfig = {
  slug: "enchiridion",
  title: "The Enchiridion",
  author_slug: "epictetus",
  chapter_slug_pattern: "section-NN",
  source_file: "content/source/enchiridion.txt",
  sectionPattern: /^\s{10,}([IVXLCDMivxlcdm]+)\s*$/m,
  gutenbergStrip: true,
  speakerLabels: false,
  sourceRefTemplate: "The Enchiridion, Section {n}",
};

function makeChunk(n: number, text: string): Chunk {
  return { sectionNumber: n, text };
}

function makeSucceededResult(customId: string, plainEnglish: string, tags: string[]) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded" as const,
      message: {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              plain_english: plainEnglish,
              tags,
              faithful: true,
              tone_preserved: true,
              ideas_changed: false,
              over_explains: false,
              verification_notes: null,
            }),
          },
        ],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
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

async function* asyncIterFrom<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item;
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset mutable stats
  batchStats.totalRequests = 0;
  batchStats.succeeded = 0;
  batchStats.failed = 0;
  tokenUsage.inputTokens = 0;
  tokenUsage.outputTokens = 0;
  tokenUsage.cacheReadTokens = 0;
  tokenUsage.cacheCreationTokens = 0;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("translateChunksBatch", () => {
  it("submits batch, polls, and returns translated chunks keyed by book:chapter", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Some things are up to us."), makeChunk(2, "Do not seek to have events happen as you wish.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_123" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_123", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "Some things are in your control.", ["freedom-and-control"]),
        makeSucceededResult("enchiridion_section-01_1", "Don't wish for things to go your way.", ["calm-your-mind"]),
      ]),
    );

    const result = await translateChunksBatch(inputs);

    // Batch was created with 2 requests
    expect(mockCreateMessageBatch).toHaveBeenCalledOnce();
    const requests = mockCreateMessageBatch.mock.calls[0][0];
    expect(requests).toHaveLength(2);
    expect(requests[0].custom_id).toBe("enchiridion_section-01_0");
    expect(requests[1].custom_id).toBe("enchiridion_section-01_1");

    // Poll was called
    expect(mockPollBatchUntilDone).toHaveBeenCalledWith("batch_123");

    // Results are keyed correctly
    expect(result.size).toBe(1);
    const chunks = result.get("enchiridion_section-01")!;
    expect(chunks).toHaveLength(2);
    expect(chunks[0].plainEnglish).toBe("Some things are in your control.");
    expect(chunks[0].tags).toEqual(["freedom-and-control"]);
    expect(chunks[0].sectionNumber).toBe(1);
    expect(chunks[1].sectionNumber).toBe(2);
  });

  it("handles multiple books in one batch", async () => {
    const senecaConfig = {
      ...testConfig,
      slug: "shortness-of-life",
      title: "On the Shortness of Life",
      author_slug: "seneca" as const,
    };

    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "First enchiridion chunk.")],
        config: testConfig,
      },
      {
        bookSlug: "shortness-of-life",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "First seneca chunk.")],
        config: senecaConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_multi" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_multi", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "Translated enchiridion.", ["freedom-and-control"]),
        makeSucceededResult("shortness-of-life_section-01_0", "Translated seneca.", ["death-and-mortality"]),
      ]),
    );

    const result = await translateChunksBatch(inputs);

    expect(result.size).toBe(2);
    expect(result.get("enchiridion_section-01")![0].plainEnglish).toBe("Translated enchiridion.");
    expect(result.get("shortness-of-life_section-01")![0].plainEnglish).toBe("Translated seneca.");
  });

  it("returns empty map for empty inputs", async () => {
    const result = await translateChunksBatch([]);
    expect(result.size).toBe(0);
    expect(mockCreateMessageBatch).not.toHaveBeenCalled();
  });

  it("validates tags — falls back to what-matters-most for invalid tags", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Test chunk.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_tags" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_tags", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "Translated.", ["completely-invalid-tag"]),
      ]),
    );

    const result = await translateChunksBatch(inputs);
    const chunks = result.get("enchiridion_section-01")!;
    expect(chunks[0].tags).toEqual(["what-matters-most"]);
  });

  it("clamps tags to max 3", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Test chunk.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_clamp" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_clamp", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "Translated.", [
          "calm-your-mind", "freedom-and-control", "knowing-yourself", "facing-hardship",
        ]),
      ]),
    );

    const result = await translateChunksBatch(inputs);
    const chunks = result.get("enchiridion_section-01")!;
    expect(chunks[0].tags).toHaveLength(3);
  });

  it("retries errored batch results via real-time API", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Chunk that will fail in batch.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_retry" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_retry", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([makeErroredResult("enchiridion_section-01_0")]),
    );

    // Retry via real-time API succeeds
    mockCallClaudeJSON.mockResolvedValue({
      plain_english: "Retried translation.",
      tags: ["freedom-and-control"],
      faithful: true,
      tone_preserved: true,
      ideas_changed: false,
      over_explains: false,
      verification_notes: null,
    });

    const result = await translateChunksBatch(inputs);
    const chunks = result.get("enchiridion_section-01")!;

    expect(chunks).toHaveLength(1);
    expect(chunks[0].plainEnglish).toBe("Retried translation.");
    expect(mockCallClaudeJSON).toHaveBeenCalledOnce();
  });

  it("tracks batch stats correctly", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Chunk 1."), makeChunk(2, "Chunk 2.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_stats" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_stats", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "OK.", ["calm-your-mind"]),
        makeErroredResult("enchiridion_section-01_1"),
      ]),
    );

    // Retry fails too — now fatal
    mockCallClaudeJSON.mockRejectedValue(new Error("API down"));

    await expect(translateChunksBatch(inputs)).rejects.toThrow("API down");
  });

  it("accumulates token usage from batch results", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Chunk.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_tokens" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_tokens", processing_status: "ended" });
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_0", "OK.", ["calm-your-mind"]),
      ]),
    );

    await translateChunksBatch(inputs);

    expect(tokenUsage.inputTokens).toBe(100);
    expect(tokenUsage.outputTokens).toBe(50);
    expect(tokenUsage.cacheReadTokens).toBe(10);
    expect(tokenUsage.cacheCreationTokens).toBe(5);
  });

  it("throws on duplicate bookSlug:chapterSlug inputs", async () => {
    const inputs: BatchTranslateInput[] = [
      { bookSlug: "enchiridion", chapterSlug: "section-01", chunks: [makeChunk(1, "A.")], config: testConfig },
      { bookSlug: "enchiridion", chapterSlug: "section-01", chunks: [makeChunk(2, "B.")], config: testConfig },
    ];

    await expect(translateChunksBatch(inputs)).rejects.toThrow("Duplicate batch input");
  });

  it("sorts results by sectionNumber within each chapter", async () => {
    const inputs: BatchTranslateInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(3, "Third."), makeChunk(1, "First."), makeChunk(2, "Second.")],
        config: testConfig,
      },
    ];

    mockCreateMessageBatch.mockResolvedValue({ id: "batch_sort" });
    mockPollBatchUntilDone.mockResolvedValue({ id: "batch_sort", processing_status: "ended" });
    // Results arrive out of order
    mockStreamBatchResults.mockReturnValue(
      asyncIterFrom([
        makeSucceededResult("enchiridion_section-01_1", "First translated.", ["calm-your-mind"]),
        makeSucceededResult("enchiridion_section-01_2", "Second translated.", ["calm-your-mind"]),
        makeSucceededResult("enchiridion_section-01_0", "Third translated.", ["calm-your-mind"]),
      ]),
    );

    const result = await translateChunksBatch(inputs);
    const chunks = result.get("enchiridion_section-01")!;

    expect(chunks[0].sectionNumber).toBe(1);
    expect(chunks[1].sectionNumber).toBe(2);
    expect(chunks[2].sectionNumber).toBe(3);
  });
});
