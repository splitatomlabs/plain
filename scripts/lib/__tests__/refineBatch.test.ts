import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chunk } from "../chunker.js";
import type { BookConfig } from "../constants.js";

// ---------------------------------------------------------------------------
// Mock claude.js — batch functions + callClaudeJSON (for fallback)
// ---------------------------------------------------------------------------
const mockCreateMessageBatch = vi.fn();
const mockPollBatchUntilDone = vi.fn();
const mockStreamBatchResults = vi.fn();
const mockCallClaudeJSON = vi.fn();

vi.mock("../claude.js", () => ({
  createMessageBatch: (...args: unknown[]) => mockCreateMessageBatch(...args),
  pollBatchUntilDone: (...args: unknown[]) => mockPollBatchUntilDone(...args),
  streamBatchResults: (...args: unknown[]) => mockStreamBatchResults(...args),
  callClaudeJSON: (...args: unknown[]) => mockCallClaudeJSON(...args),
  extractJSON: (text: string) => {
    try { JSON.parse(text); return text; } catch { /* continue */ }
    const m = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
    if (m) return m[1].trim();
    const first = text.indexOf("[");
    const last = text.lastIndexOf("]");
    if (first !== -1 && last > first) {
      const extracted = text.slice(first, last + 1);
      try { JSON.parse(extracted); return extracted; } catch { /* continue */ }
    }
    throw new Error("Could not extract JSON");
  },
  tokenUsage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
  batchStats: { totalRequests: 0, succeeded: 0, failed: 0 },
  ClaudeCliError: class extends Error {},
}));

import { refineChunksBatch, type BatchRefineInput } from "../refine.js";
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

function makeRefineResult(customId: string, decisions: object[]) {
  return {
    custom_id: customId,
    result: {
      type: "succeeded" as const,
      message: {
        content: [{ type: "text" as const, text: JSON.stringify(decisions) }],
        usage: {
          input_tokens: 200,
          output_tokens: 80,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 10,
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

function setupBatch(id: string, results: object[]) {
  mockCreateMessageBatch.mockResolvedValue({ id });
  mockPollBatchUntilDone.mockResolvedValue({ id, processing_status: "ended" });
  mockStreamBatchResults.mockReturnValue(asyncIterFrom(results));
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
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("refineChunksBatch", () => {
  it("submits batch, polls, and returns refined chunks with keep decisions", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Short standalone idea."), makeChunk(2, "Another idea.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_refine_1", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
        { section: 2, action: "keep", segments: null, reason: null },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);

    expect(mockCreateMessageBatch).toHaveBeenCalledOnce();
    expect(mockPollBatchUntilDone).toHaveBeenCalledWith("batch_refine_1");

    const r = result.get("enchiridion_section-01")!;
    expect(r.chunks).toHaveLength(2);
    expect(r.splits).toBe(0);
    expect(r.merges).toBe(0);
    expect(r.originalCount).toBe(2);
    expect(r.refinedCount).toBe(2);
  });

  it("handles split decisions", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-05",
        chunks: [makeChunk(5, "First idea. Second idea.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_split", [
      makeRefineResult("refine_enchiridion_section-05_0", [
        { section: 5, action: "split", segments: ["First idea.", "Second idea."], reason: null },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-05")!;

    expect(r.chunks).toHaveLength(2);
    expect(r.chunks[0].text).toBe("First idea.");
    expect(r.chunks[1].text).toBe("Second idea.");
    expect(r.splits).toBe(1);
  });

  it("handles merge_next decisions", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Start of thought."), makeChunk(2, "Continuation.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_merge", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "merge_next", segments: null, reason: "Thought continues" },
        { section: 2, action: "keep", segments: null, reason: null },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-01")!;

    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].text).toContain("Start of thought.");
    expect(r.chunks[0].text).toContain("Continuation.");
    expect(r.merges).toBe(1);
  });

  it("handles merge_prev decisions", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Main idea."), makeChunk(2, "Depends on previous.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_merge_prev", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
        { section: 2, action: "merge_prev", segments: null, reason: "Depends on previous" },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-01")!;

    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].text).toContain("Main idea.");
    expect(r.chunks[0].text).toContain("Depends on previous.");
    expect(r.merges).toBe(1);
  });

  it("falls back to real-time refine on batch error", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "A chunk.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_fail", [
      makeErroredResult("refine_enchiridion_section-01_0"),
    ]);

    // Real-time fallback: refineChunks calls callClaudeJSON with bulk format
    mockCallClaudeJSON.mockResolvedValue([
      { section: 1, action: "keep", segments: null, reason: null },
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-01")!;

    expect(r.chunks).toHaveLength(1);
    expect(r.chunks[0].text).toBe("A chunk.");
    // Fallback should have been called
    expect(mockCallClaudeJSON).toHaveBeenCalled();
  });

  it("handles multiple books in one batch", async () => {
    const senecaConfig = {
      ...testConfig,
      slug: "shortness-of-life",
      title: "On the Shortness of Life",
      author_slug: "seneca" as const,
    };

    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Epictetus chunk.")],
        config: testConfig,
      },
      {
        bookSlug: "shortness-of-life",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Seneca chunk.")],
        config: senecaConfig,
      },
    ];

    setupBatch("batch_multi", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
      ]),
      makeRefineResult("refine_shortness-of-life_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);

    expect(result.size).toBe(2);
    expect(result.get("enchiridion_section-01")!.chunks[0].text).toBe("Epictetus chunk.");
    expect(result.get("shortness-of-life_section-01")!.chunks[0].text).toBe("Seneca chunk.");
  });

  it("returns empty map for empty inputs", async () => {
    const result = await refineChunksBatch([]);
    expect(result.size).toBe(0);
    expect(mockCreateMessageBatch).not.toHaveBeenCalled();
  });

  it("accumulates token usage from batch results", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "A chunk.")],
        config: testConfig,
      },
    ];

    setupBatch("batch_tokens", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
      ]),
    ]);

    await refineChunksBatch(inputs);

    expect(tokenUsage.inputTokens).toBe(200);
    expect(tokenUsage.outputTokens).toBe(80);
    expect(tokenUsage.cacheReadTokens).toBe(20);
    expect(tokenUsage.cacheCreationTokens).toBe(10);
  });

  it("tracks batch stats correctly", async () => {
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, "Chunk 1.")],
        config: testConfig,
      },
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-02",
        chunks: [makeChunk(2, "Chunk 2.")],
        config: testConfig,
      },
    ];

    // section-01 succeeds, section-02 fails
    setupBatch("batch_stats", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
      ]),
      makeErroredResult("refine_enchiridion_section-02_0"),
    ]);

    // Fallback for section-02
    mockCallClaudeJSON.mockResolvedValue([
      { section: 2, action: "keep", segments: null, reason: null },
    ]);

    await refineChunksBatch(inputs);

    expect(batchStats.totalRequests).toBe(2);
    expect(batchStats.succeeded).toBe(1);
    expect(batchStats.failed).toBe(1);
  });

  it("remaps decisions correctly on cross-batch merge", async () => {
    // Create 12 chunks so batch 0 has chunks 1-10, batch 1 has chunks 11-12
    // Chunk 10 (last in batch 0) has merge_next, so it defers.
    // Chunk 11 (first in batch 1) has a split decision — the decision section number
    // must be remapped to chunk 10's section number after the merge.
    const chunks: Chunk[] = [];
    for (let i = 1; i <= 12; i++) {
      chunks.push(makeChunk(i, `Chunk ${i} text.`));
    }

    const inputs: BatchRefineInput[] = [
      { bookSlug: "enchiridion", chapterSlug: "section-01", chunks, config: testConfig },
    ];

    // Batch 0 (sections 1-10): keep all, except section 10 = merge_next
    const batch0Decisions = [];
    for (let i = 1; i <= 9; i++) {
      batch0Decisions.push({ section: i, action: "keep", segments: null, reason: null });
    }
    batch0Decisions.push({ section: 10, action: "merge_next", segments: null, reason: "Continues" });

    // Batch 1 (sections 11-12): section 11 has a split decision
    // After merge, the merged chunk has sectionNumber=10, so the decision for section 11
    // must be remapped to section 10
    const batch1Decisions = [
      { section: 11, action: "split", segments: ["Chunk 10 text.\n\nFirst part.", "Second part."], reason: null },
      { section: 12, action: "keep", segments: null, reason: null },
    ];

    setupBatch("batch_crossmerge", [
      makeRefineResult("refine_enchiridion_section-01_0", batch0Decisions),
      makeRefineResult("refine_enchiridion_section-01_1", batch1Decisions),
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-01")!;

    // 9 kept + 2 from split + 1 kept (chunk 12) = 12 chunks, minus the merge = 11 + split of merged = 11
    // Actually: 9 kept (1-9) + merge(10+11) produces deferred chunk
    // Then in batch 1: deferred is merged, then split into 2, plus keep(12) = 3
    // Total: 9 + 2 + 1 = 12, with 1 merge and 1 split
    expect(r.merges).toBeGreaterThanOrEqual(1);
    expect(r.splits).toBeGreaterThanOrEqual(1);
    // The split decision should have been applied (not dropped)
    expect(r.chunks.some(c => c.text === "Second part.")).toBe(true);
  });

  it("applies LENGTH-SPLIT to oversized chunks after batch decisions", async () => {
    // Create a chunk that exceeds 90s reading time (~300 words)
    const longText = Array(400).fill("word").join(" ");
    const inputs: BatchRefineInput[] = [
      {
        bookSlug: "enchiridion",
        chapterSlug: "section-01",
        chunks: [makeChunk(1, longText)],
        config: testConfig,
      },
    ];

    setupBatch("batch_oversized", [
      makeRefineResult("refine_enchiridion_section-01_0", [
        { section: 1, action: "keep", segments: null, reason: null },
      ]),
    ]);

    const result = await refineChunksBatch(inputs);
    const r = result.get("enchiridion_section-01")!;

    // Should have been LENGTH-SPLIT
    expect(r.chunks.length).toBeGreaterThan(1);
    expect(r.splits).toBeGreaterThan(0);
  });
});
