import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Chunk } from "../chunker.js";
import type { BookConfig } from "../constants.js";

// Mock the claude module before importing refine
vi.mock("../claude.js", () => ({
  callClaudeJSON: vi.fn(),
  ClaudeCliError: class ClaudeCliError extends Error {},
}));

import { refineChunks, buildRefineSystem } from "../refine.js";
import { callClaudeJSON } from "../claude.js";

const mockCallClaudeJSON = vi.mocked(callClaudeJSON);

const testConfig: BookConfig = {
  slug: "meditations",
  title: "Meditations",
  author_slug: "marcus-aurelius",
  chapter_slug_pattern: "book-NN",
  source_file: "source-books/meditations.txt",
  sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
  gutenbergStrip: true,
  speakerLabels: false,
  sourceRefTemplate: "Meditations, Book {chapter}, Section {n}",
};

function makeChunk(number: number, text: string): Chunk {
  return { sectionNumber: number, text };
}

beforeEach(() => {
  mockCallClaudeJSON.mockReset();
});

describe("refineChunks", () => {
  it("keeps chunks unchanged when action is keep", async () => {
    const chunks = [
      makeChunk(1, "This is a complete idea about virtue that stands on its own."),
      makeChunk(2, "This is another complete idea about duty and responsibility."),
    ];

    mockCallClaudeJSON
      .mockResolvedValueOnce({ action: "keep", segments: null, reason: null })
      .mockResolvedValueOnce({ action: "keep", segments: null, reason: null });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(result.chunks[0].text).toBe(chunks[0].text);
    expect(result.chunks[1].text).toBe(chunks[1].text);
    expect(result.splits).toBe(0);
    expect(result.merges).toBe(0);
  });

  it("splits a multi-idea chunk into separate chunks", async () => {
    const chunks = [
      makeChunk(1, "First idea about virtue. Second idea about death."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "split",
      segments: ["First idea about virtue.", "Second idea about death."],
      reason: null,
    });

    const result = await refineChunks(chunks, testConfig);

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

    mockCallClaudeJSON
      .mockResolvedValueOnce({ action: "merge_next", segments: null, reason: "Thought continues into next section." })
      .mockResolvedValueOnce({ action: "keep", segments: null, reason: null });

    const result = await refineChunks(chunks, testConfig);

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

    mockCallClaudeJSON
      .mockResolvedValueOnce({ action: "keep", segments: null, reason: null })
      .mockResolvedValueOnce({ action: "merge_prev", segments: null, reason: "Depends on previous section." });

    const result = await refineChunks(chunks, testConfig);

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

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "merge_prev",
      segments: null,
      reason: "Depends on previous.",
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("First section that somehow says merge_prev.");
    expect(result.merges).toBe(0);
  });

  it("falls back to keep when merge_next has no next chunk", async () => {
    const chunks = [
      makeChunk(1, "Last section that says merge_next."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "merge_next",
      segments: null,
      reason: "Should merge with next.",
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("Last section that says merge_next.");
  });

  it("keeps chunk on Claude call failure", async () => {
    const chunks = [
      makeChunk(1, "This chunk will survive a failure gracefully."),
    ];

    mockCallClaudeJSON.mockRejectedValueOnce(new Error("API timeout"));

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0].text).toBe("This chunk will survive a failure gracefully.");
  });

  it("ignores split with only one segment", async () => {
    const chunks = [
      makeChunk(1, "A section that the AI incorrectly tries to split into one piece."),
    ];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "split",
      segments: ["A section that the AI incorrectly tries to split into one piece."],
      reason: null,
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(1);
    expect(result.splits).toBe(0);
  });

  it("splits chunks that exceed 90s reading time cap", async () => {
    // 400 words ≈ 120s at 200wpm — should be split into two chunks
    const longText = Array(400).fill("word").join(" ");
    const chunks = [makeChunk(1, longText)];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "keep",
      segments: null,
      reason: null,
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks.length).toBe(2);
    expect(result.splits).toBe(1);
    // Both pieces should retain the original section number
    expect(result.chunks[0].sectionNumber).toBe(1);
    expect(result.chunks[1].sectionNumber).toBe(1);
  });

  it("splits at paragraph boundaries when available", async () => {
    const para = Array(200).fill("word").join(" ");
    const longText = `${para}\n\n${para}`;
    const chunks = [makeChunk(1, longText)];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "keep",
      segments: null,
      reason: null,
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks.length).toBe(2);
    // Neither half should contain a paragraph break
    expect(result.chunks[0].text).not.toContain("\n\n");
    expect(result.chunks[1].text).not.toContain("\n\n");
  });

  it("does not split chunks at or under 90s", async () => {
    // 300 words = 90s exactly — should NOT be split
    const text = Array(300).fill("word").join(" ");
    const chunks = [makeChunk(1, text)];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "keep",
      segments: null,
      reason: null,
    });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks.length).toBe(1);
  });

  it("skips the next chunk after merge_next", async () => {
    const chunks = [
      makeChunk(1, "First section."),
      makeChunk(2, "Second section to merge."),
      makeChunk(3, "Third section, independent."),
    ];

    mockCallClaudeJSON
      .mockResolvedValueOnce({ action: "merge_next", segments: null, reason: "Incomplete thought." })
      // Section 2 is skipped — no call made for it
      .mockResolvedValueOnce({ action: "keep", segments: null, reason: null });

    const result = await refineChunks(chunks, testConfig);

    expect(result.chunks).toHaveLength(2);
    expect(mockCallClaudeJSON).toHaveBeenCalledTimes(2); // Not 3
  });

  it("passes system prompt via options to callClaudeJSON", async () => {
    const chunks = [makeChunk(1, "A test section.")];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "keep",
      segments: null,
      reason: null,
    });

    await refineChunks(chunks, testConfig);

    // Third argument should include system prompt
    const options = mockCallClaudeJSON.mock.calls[0][2];
    expect(options).toBeDefined();
    expect(options!.system).toBeDefined();
    expect(options!.system).toContain("bite-sized reading cards");
  });

  it("does not include system content in user prompt when system option is set", async () => {
    const chunks = [makeChunk(1, "A test section.")];

    mockCallClaudeJSON.mockResolvedValueOnce({
      action: "keep",
      segments: null,
      reason: null,
    });

    await refineChunks(chunks, testConfig);

    // First argument (prompt) should be the user-only part
    const prompt = mockCallClaudeJSON.mock.calls[0][0];
    const system = mockCallClaudeJSON.mock.calls[0][2]!.system!;

    // User prompt should contain the chunk text
    expect(prompt).toContain("A test section.");
    // User prompt should NOT duplicate the system content
    expect(prompt).not.toContain("bite-sized reading cards");
    // System should contain the instructions
    expect(system).toContain("bite-sized reading cards");
  });
});

describe("buildRefineSystem", () => {
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
    expect(system).toContain('"action"');
  });

  it("does not include per-chunk text", () => {
    const system = buildRefineSystem(testConfig);
    expect(system).not.toContain("CURRENT SECTION");
    expect(system).not.toContain("PREVIOUS SECTION");
  });

  it("varies by book config", () => {
    const senecaConfig = { ...testConfig, slug: "shortness-of-life", title: "On the Shortness of Life", author_slug: "seneca" as const };
    const system = buildRefineSystem(senecaConfig);
    expect(system).toContain("On the Shortness of Life");
    expect(system).toContain("Seneca");
  });
});
