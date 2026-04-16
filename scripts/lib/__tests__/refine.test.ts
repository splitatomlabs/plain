import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chunk } from "../chunker.js";
import type { BookConfig } from "../constants.js";

// Mock the claude module before importing refine
vi.mock("../claude.js", () => ({
  callClaudeJSON: vi.fn(),
  ClaudeCliError: class ClaudeCliError extends Error {},
}));

import { refineChunksRealtime, buildRefineSystem, buildBulkRefineSystem, buildBulkRefineUser } from "../refine.js";
import { callClaudeJSON } from "../claude.js";

const mockCallClaudeJSON = vi.mocked(callClaudeJSON);

const testConfig: BookConfig = {
  slug: "meditations",
  title: "Meditations",
  author_slug: "marcus-aurelius",
  chapter_slug_pattern: "book-NN",
  source_file: "content/source/meditations.txt",
  sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
  gutenbergStrip: true,
  speakerLabels: false,
  sourceRefTemplate: "Meditations, Book {chapter}, Section {n}",
};

function makeChunk(number: number, text: string): Chunk {
  return { sectionNumber: number, text };
}

/** Helper: build a bulk response array */
function bulkResponse(
  entries: Array<{
    section: number;
    action: "keep" | "split" | "merge_next" | "merge_prev";
    segments?: string[];
    reason?: string;
  }>,
) {
  return entries.map((e) => ({
    section: e.section,
    action: e.action,
    segments: e.segments ?? null,
    reason: e.reason ?? null,
  }));
}

beforeEach(() => {
  mockCallClaudeJSON.mockReset();
});

describe("refineChunksRealtime", () => {
  it("keeps chunks unchanged when action is keep", async () => {
    const chunks = [
      makeChunk(1, "This is a complete idea about virtue that stands on its own."),
      makeChunk(2, "This is another complete idea about duty and responsibility."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "keep" },
        { section: 2, action: "keep" },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toBe(chunks[0].text);
    expect(result.chunks[1].text).toBe(chunks[1].text);
    expect(result.splits).toBe(0);
    expect(result.merges).toBe(0);
    expect(result.apiCalls).toBe(1);
  });

  it("splits a multi-idea chunk into separate chunks", async () => {
    const chunks = [
      makeChunk(1, "First idea about virtue. Second idea about death."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        {
          section: 1,
          action: "split",
          segments: ["First idea about virtue.", "Second idea about death."],
        },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toBe("First idea about virtue.");
    expect(result.chunks[1].text).toBe("Second idea about death.");
    expect(result.chunks[0].sectionNumber).toBe(1);
    expect(result.chunks[1].sectionNumber).toBe(1);
    expect(result.splits).toBe(1);
    expect(result.originalCount).toBe(1);
    expect(result.refinedCount).toBe(2);
  });

  it("merges chunk with next when action is merge_next", async () => {
    const chunks = [
      makeChunk(1, "Beginning of a thought that continues."),
      makeChunk(2, "The continuation and conclusion of that thought."),
      makeChunk(3, "A separate idea entirely."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "merge_next", reason: "Thought continues into next section." },
        { section: 2, action: "keep" },
        { section: 3, action: "keep" },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toContain("Beginning of a thought");
    expect(result.chunks[0].text).toContain("continuation and conclusion");
    expect(result.chunks[0].sectionNumber).toBe(1);
    expect(result.chunks[1].text).toBe("A separate idea entirely.");
    expect(result.merges).toBe(1);
  });

  it("merges chunk with previous when action is merge_prev", async () => {
    const chunks = [
      makeChunk(1, "A complete opening thought about the nature of things."),
      makeChunk(2, "But this depends on the previous thought to make sense."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "keep" },
        { section: 2, action: "merge_prev", reason: "Depends on previous section." },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toContain("A complete opening thought");
    expect(result.chunks[0].text).toContain("But this depends");
    expect(result.chunks[0].sectionNumber).toBe(1);
    expect(result.merges).toBe(1);
  });

  it("falls back to keep when merge_prev has no previous chunk", async () => {
    const chunks = [
      makeChunk(1, "First section that somehow says merge_prev."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "merge_prev", reason: "Depends on previous." },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("First section that somehow says merge_prev.");
    expect(result.merges).toBe(0);
  });

  it("falls back to keep when merge_next has no next chunk", async () => {
    const chunks = [
      makeChunk(1, "Last section that says merge_next."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "merge_next", reason: "Should merge with next." },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("Last section that says merge_next.");
  });

  it("keeps chunks unchanged on bulk API failure", async () => {
    const chunks = [
      makeChunk(1, "This chunk will survive a failure gracefully."),
    ];

    mockCallClaudeJSON.mockRejectedValueOnce(new Error("API timeout"));

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("This chunk will survive a failure gracefully.");
    expect(mockCallClaudeJSON).toHaveBeenCalledTimes(1);
  });

  it("ignores split with only one segment", async () => {
    const chunks = [
      makeChunk(1, "A section that the AI incorrectly tries to split into one piece."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        {
          section: 1,
          action: "split",
          segments: ["A section that the AI incorrectly tries to split into one piece."],
        },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.splits).toBe(0);
  });

  it("splits chunks that exceed 90s reading time cap (safety net)", async () => {
    // 400 words ≈ 120s at 200wpm — should be split into two chunks
    const longText = Array(400).fill("word").join(" ");
    const chunks = [makeChunk(1, longText)];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks.length).toBe(2);
    expect(result.splits).toBe(1);
    expect(result.chunks[0].sectionNumber).toBe(1);
    expect(result.chunks[1].sectionNumber).toBe(1);
  });

  it("splits at paragraph boundaries when available", async () => {
    const para = Array(200).fill("word").join(" ");
    const longText = `${para}\n\n${para}`;
    const chunks = [makeChunk(1, longText)];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks.length).toBe(2);
    expect(result.chunks[0].text).not.toContain("\n\n");
    expect(result.chunks[1].text).not.toContain("\n\n");
  });

  it("does not split chunks at or under 60s", async () => {
    // 200 words = 60s exactly — should NOT be split
    const text = Array(200).fill("word").join(" ");
    const chunks = [makeChunk(1, text)];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks.length).toBe(1);
  });

  it("skips the next chunk after merge_next", async () => {
    const chunks = [
      makeChunk(1, "First section."),
      makeChunk(2, "Second section to merge."),
      makeChunk(3, "Third section, independent."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "merge_next", reason: "Incomplete thought." },
        { section: 2, action: "keep" },
        { section: 3, action: "keep" },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toContain("First section.");
    expect(result.chunks[0].text).toContain("Second section to merge.");
    expect(result.chunks[1].text).toBe("Third section, independent.");
  });

  it("passes bulk system prompt via options to callClaudeJSON", async () => {
    const chunks = [makeChunk(1, "A test section.")];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    await refineChunksRealtime(chunks, testConfig);

    const options = mockCallClaudeJSON.mock.calls[0][2];
    expect(options).toBeDefined();
    expect(options!.system).toBeDefined();
    expect(options!.system).toContain("bite-sized reading cards");
    expect(options!.system).toContain("200 words");
    expect(options!.system).toContain("JSON array");
  });

  it("uses one API call for a batch of chunks", async () => {
    const chunks = [
      makeChunk(1, "Section one."),
      makeChunk(2, "Section two."),
      makeChunk(3, "Section three."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([
        { section: 1, action: "keep" },
        { section: 2, action: "keep" },
        { section: 3, action: "keep" },
      ]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    expect(mockCallClaudeJSON).toHaveBeenCalledTimes(1);
    expect(result.apiCalls).toBe(1);
    expect(result.chunks).toHaveLength(3);
  });

  it("does not include system content in user prompt", async () => {
    const chunks = [makeChunk(1, "A test section.")];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    await refineChunksRealtime(chunks, testConfig);

    const prompt = mockCallClaudeJSON.mock.calls[0][0];
    const system = mockCallClaudeJSON.mock.calls[0][2]!.system!;

    expect(prompt).toContain("A test section.");
    expect(prompt).not.toContain("bite-sized reading cards");
    expect(system).toContain("bite-sized reading cards");
  });

  it("handles model returning oversized split via safety net", async () => {
    // Model keeps a 250-word chunk (misses the 200-word cap)
    const longText = Array(250).fill("word").join(" ");
    const chunks = [makeChunk(1, longText)];

    mockCallClaudeJSON.mockResolvedValueOnce(
      bulkResponse([{ section: 1, action: "keep" }]),
    );

    const result = await refineChunksRealtime(chunks, testConfig);

    // Safety net should catch it
    expect(result.chunks.length).toBeGreaterThan(1);
    expect(result.splits).toBe(1);
  });
});

describe("buildRefineSystem (single-chunk, legacy)", () => {
  it("includes author context", () => {
    const system = buildRefineSystem(testConfig);
    expect(system).toContain("Marcus Aurelius");
    expect(system).toContain("private journal reflections");
  });

  it("includes action descriptions and JSON schema", () => {
    const system = buildRefineSystem(testConfig);
    expect(system).toContain('"keep"');
    expect(system).toContain('"split"');
    expect(system).toContain('"merge_next"');
    expect(system).toContain('"merge_prev"');
  });
});

describe("buildBulkRefineSystem", () => {
  it("includes 200-word cap rule", () => {
    const system = buildBulkRefineSystem(testConfig);
    expect(system).toContain("200 words");
    expect(system).toContain("MUST be split");
  });

  it("specifies JSON array response format", () => {
    const system = buildBulkRefineSystem(testConfig);
    expect(system).toContain("JSON array");
    expect(system).toContain('"section"');
    expect(system).toContain('"action"');
  });

  it("includes author context", () => {
    const system = buildBulkRefineSystem(testConfig);
    expect(system).toContain("Marcus Aurelius");
    expect(system).toContain("private journal reflections");
  });

  it("varies by book config", () => {
    const senecaConfig = { ...testConfig, slug: "shortness-of-life", title: "On the Shortness of Life", author_slug: "seneca" as const };
    const system = buildBulkRefineSystem(senecaConfig);
    expect(system).toContain("On the Shortness of Life");
    expect(system).toContain("Seneca");
  });
});

describe("buildBulkRefineUser", () => {
  it("formats chunks as numbered sections", () => {
    const chunks = [
      makeChunk(1, "First section text."),
      makeChunk(2, "Second section text."),
    ];

    const user = buildBulkRefineUser(chunks);
    expect(user).toContain("--- SECTION 1 ---");
    expect(user).toContain("First section text.");
    expect(user).toContain("--- SECTION 2 ---");
    expect(user).toContain("Second section text.");
  });

  it("does not include system instructions", () => {
    const chunks = [makeChunk(1, "Test.")];
    const user = buildBulkRefineUser(chunks);
    expect(user).not.toContain("bite-sized");
    expect(user).not.toContain("200 words");
  });
});
