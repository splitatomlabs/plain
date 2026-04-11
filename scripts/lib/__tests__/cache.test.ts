import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "cache-test-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

import {
  saveParseCache,
  loadParseCache,
  saveRefineCache,
  loadRefineCache,
  saveTranslateCache,
  loadTranslateCache,
  snapshotTokenUsage,
  computePhaseCost,
  PIPELINE_VERSION,
} from "../cache.js";

import type { Chunk } from "../chunker.js";
import type { TranslatedChunk } from "../translator.js";

// Override cwd so cache.ts resolves content/pipeline inside tempDir
const originalCwd = process.cwd();
beforeEach(() => {
  process.chdir(tempDir);
});
afterEach(() => {
  process.chdir(originalCwd);
});

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const sampleChunks: Chunk[] = [
  { sectionNumber: 1, text: "Some things are up to you." },
  { sectionNumber: 2, text: "If you want freedom, stop wishing." },
];

const sampleChapters = [
  {
    slug: "sections-01-10",
    title: "Sections 1–10",
    chunks: sampleChunks,
  },
];

const sampleParsedChapters = [
  {
    slug: "sections-01-10",
    title: "Sections 1–10",
    sections: [
      { number: 1, text: "Some things are up to you." },
      { number: 2, text: "If you want freedom, stop wishing." },
    ],
  },
];

const sampleTranslated: TranslatedChunk[] = [
  {
    sectionNumber: 1,
    originalText: "Some things are up to you.",
    plainEnglish: "You control your opinions, not your body.",
    tags: ["freedom-and-control"],
    meaningCheck: {
      faithful: true,
      tone_preserved: true,
      ideas_changed: false,
      over_explains: false,
    },
  },
];

// ---------------------------------------------------------------------------
// Parse cache
// ---------------------------------------------------------------------------

describe("parse cache", () => {
  it("round-trips save and load", async () => {
    await saveParseCache("enchiridion", sampleParsedChapters);
    const loaded = await loadParseCache("enchiridion");

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
    expect(loaded![0].slug).toBe("sections-01-10");
    expect(loaded![0].sections).toHaveLength(2);
    expect(loaded![0].sections[0].number).toBe(1);
  });

  it("returns null on cache miss (no file)", async () => {
    const loaded = await loadParseCache("nonexistent");
    expect(loaded).toBeNull();
  });

  it("overwrites previous cache on re-save", async () => {
    await saveParseCache("enchiridion", sampleParsedChapters);
    const updated = [{ slug: "section-01", title: "Section 1", sections: [{ number: 1, text: "Updated" }] }];
    await saveParseCache("enchiridion", updated);
    const loaded = await loadParseCache("enchiridion");
    expect(loaded![0].sections[0].text).toBe("Updated");
  });

  it("returns null when pipeline version mismatches", async () => {
    await saveParseCache("enchiridion", sampleParsedChapters);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "parse.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    raw.pipelineVersion = 999;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadParseCache("enchiridion");
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Refine cache
// ---------------------------------------------------------------------------

describe("refine cache", () => {
  it("round-trips save and load", async () => {
    await saveRefineCache("enchiridion", sampleChapters);
    const loaded = await loadRefineCache("enchiridion");

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
    expect(loaded![0].slug).toBe("sections-01-10");
    expect(loaded![0].chunks).toHaveLength(2);
    expect(loaded![0].chunks[0].sectionNumber).toBe(1);
    expect(loaded![0].chunks[1].text).toBe("If you want freedom, stop wishing.");
  });

  it("preserves bookNumber for Meditations chapters", async () => {
    const chapters = [{ slug: "book-01", title: "Book 1", bookNumber: 1, chunks: sampleChunks }];
    await saveRefineCache("meditations", chapters);
    const loaded = await loadRefineCache("meditations");

    expect(loaded![0].bookNumber).toBe(1);
  });

  it("returns null on cache miss (no file)", async () => {
    const loaded = await loadRefineCache("nonexistent");
    expect(loaded).toBeNull();
  });

  it("overwrites previous cache on re-save", async () => {
    await saveRefineCache("enchiridion", sampleChapters);

    const updatedChapters = [
      { slug: "sections-01-10", title: "Sections 1–10", chunks: [sampleChunks[0]] },
    ];
    await saveRefineCache("enchiridion", updatedChapters);

    const loaded = await loadRefineCache("enchiridion");
    expect(loaded![0].chunks).toHaveLength(1);
  });

  it("saves and loads cost field", async () => {
    const cost = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5, estimatedCost: 0.001 };
    await saveRefineCache("enchiridion", sampleChapters, cost);

    const { readFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.cost).toEqual(cost);
  });
});

// ---------------------------------------------------------------------------
// Translate cache
// ---------------------------------------------------------------------------

describe("translate cache", () => {
  it("round-trips save and load", async () => {
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", translateMap);
    const loaded = await loadTranslateCache("enchiridion");

    expect(loaded).not.toBeNull();
    expect(loaded!.size).toBe(1);
    const chunks = loaded!.get("enchiridion_sections-01-10")!;
    expect(chunks).toHaveLength(1);
    expect(chunks[0].plainEnglish).toBe("You control your opinions, not your body.");
    expect(chunks[0].tags).toEqual(["freedom-and-control"]);
  });

  it("preserves meaningCheck fields", async () => {
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", translateMap);
    const loaded = await loadTranslateCache("enchiridion");
    const check = loaded!.get("enchiridion_sections-01-10")![0].meaningCheck!;

    expect(check.faithful).toBe(true);
    expect(check.tone_preserved).toBe(true);
    expect(check.ideas_changed).toBe(false);
    expect(check.over_explains).toBe(false);
  });

  it("handles multiple chapters in one book", async () => {
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("meditations_book-01", sampleTranslated);
    translateMap.set("meditations_book-02", [
      { ...sampleTranslated[0], sectionNumber: 5, plainEnglish: "Book 2 text" },
    ]);

    await saveTranslateCache("meditations", translateMap);
    const loaded = await loadTranslateCache("meditations");

    expect(loaded!.size).toBe(2);
    expect(loaded!.get("meditations_book-01")).toHaveLength(1);
    expect(loaded!.get("meditations_book-02")![0].plainEnglish).toBe("Book 2 text");
  });

  it("returns null on cache miss (no file)", async () => {
    const loaded = await loadTranslateCache("nonexistent");
    expect(loaded).toBeNull();
  });

  it("saves and loads cost field", async () => {
    const cost = { inputTokens: 200, outputTokens: 100, cacheReadTokens: 20, cacheCreationTokens: 10, estimatedCost: 0.002 };
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", translateMap, cost);

    const { readFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "translate.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.cost).toEqual(cost);
  });
});

// ---------------------------------------------------------------------------
// Pipeline version checking
// ---------------------------------------------------------------------------

describe("pipeline version checking", () => {
  it("refine: save then load with matching version returns data", async () => {
    await saveRefineCache("enchiridion", sampleChapters);
    const loaded = await loadRefineCache("enchiridion");
    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
  });

  it("refine: load with mismatched version returns null", async () => {
    await saveRefineCache("enchiridion", sampleChapters);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    raw.pipelineVersion = 999;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadRefineCache("enchiridion");
    expect(loaded).toBeNull();
  });

  it("refine: load with missing pipelineVersion field returns null", async () => {
    await saveRefineCache("enchiridion", sampleChapters);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    delete raw.pipelineVersion;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadRefineCache("enchiridion");
    expect(loaded).toBeNull();
  });

  it("translate: load with mismatched version returns null", async () => {
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", translateMap);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "translate.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    raw.pipelineVersion = 999;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadTranslateCache("enchiridion");
    expect(loaded).toBeNull();
  });

  it("translate: load with missing pipelineVersion field returns null", async () => {
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", translateMap);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "translate.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    delete raw.pipelineVersion;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadTranslateCache("enchiridion");
    expect(loaded).toBeNull();
  });

  it("saved refine files contain pipelineVersion matching the constant", async () => {
    await saveRefineCache("enchiridion", sampleChapters);

    const { readFile } = await import("node:fs/promises");
    const filePath = path.join(tempDir, "content", "pipeline", "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it("saved files contain createdAt as valid ISO string", async () => {
    await saveRefineCache("enchiridion", sampleChapters);

    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", translateMap);

    const { readFile } = await import("node:fs/promises");

    const refinePath = path.join(tempDir, "content", "pipeline", "enchiridion", "refine.json");
    const refineData = JSON.parse(await readFile(refinePath, "utf-8"));
    expect(new Date(refineData.createdAt).toISOString()).toBe(refineData.createdAt);

    const translateFilePath = path.join(tempDir, "content", "pipeline", "enchiridion", "translate.json");
    const translateData = JSON.parse(await readFile(translateFilePath, "utf-8"));
    expect(new Date(translateData.createdAt).toISOString()).toBe(translateData.createdAt);
  });
});

// ---------------------------------------------------------------------------
// Cost helpers
// ---------------------------------------------------------------------------

describe("cost helpers", () => {
  it("snapshotTokenUsage returns a copy", () => {
    const usage = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 };
    const snap = snapshotTokenUsage(usage);
    usage.inputTokens = 999;
    expect(snap.inputTokens).toBe(100);
  });

  it("computePhaseCost calculates delta and cost", () => {
    const before = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 };
    const after = { inputTokens: 1100, outputTokens: 550, cacheReadTokens: 110, cacheCreationTokens: 55 };
    const cost = computePhaseCost(before, after);

    expect(cost.inputTokens).toBe(1000);
    expect(cost.outputTokens).toBe(500);
    expect(cost.cacheReadTokens).toBe(100);
    expect(cost.cacheCreationTokens).toBe(50);
    expect(cost.estimatedCost).toBeGreaterThan(0);
  });

  it("computePhaseCost returns zero cost for zero delta", () => {
    const snap = { inputTokens: 100, outputTokens: 50, cacheReadTokens: 10, cacheCreationTokens: 5 };
    const cost = computePhaseCost(snap, snap);
    expect(cost.estimatedCost).toBe(0);
  });
});
