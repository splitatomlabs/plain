import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Mock the fs and crypto modules to redirect cache to a temp directory
// ---------------------------------------------------------------------------

// We'll mock the PIPELINE_DIR by mocking the module's internal path resolution.
// Instead, since cache.ts uses path.resolve("content-pipeline"), we mock
// the entire module path resolution via a dynamic import approach.
// Simplest: mock the node:fs/promises calls to intercept paths.

let tempDir: string;
let sourceFile: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "cache-test-"));
  sourceFile = path.join(tempDir, "source.txt");
  await writeFile(sourceFile, "Original source text content");
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Import after mocking (cache uses real fs, so we test via the public API
// but redirect PIPELINE_DIR by setting process.cwd)
// ---------------------------------------------------------------------------

// Since PIPELINE_DIR is path.resolve("content-pipeline") which depends on cwd,
// we'll change cwd to tempDir so cache files land there.
import {
  hashSourceFile,
  saveRefineCache,
  loadRefineCache,
  saveTranslateCache,
  loadTranslateCache,
  PIPELINE_VERSION,
} from "../cache.js";

import type { Chunk } from "../chunker.js";
import type { TranslatedChunk } from "../translator.js";

// CACHE_DIR in cache.ts is path.resolve("content-pipeline"), evaluated at
// import time before any chdir.  Capture the same resolved path so tests
// that read raw JSON from disk use the correct location.
const originalCwd = process.cwd();
const RESOLVED_CACHE_DIR = path.resolve("content-pipeline");
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
// hashSourceFile
// ---------------------------------------------------------------------------

describe("hashSourceFile", () => {
  it("returns a 16-char hex hash", async () => {
    const hash = await hashSourceFile(sourceFile);
    expect(hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns different hash when content changes", async () => {
    const hash1 = await hashSourceFile(sourceFile);
    await writeFile(sourceFile, "Different content");
    const hash2 = await hashSourceFile(sourceFile);
    expect(hash1).not.toBe(hash2);
  });

  it("returns same hash for same content", async () => {
    const hash1 = await hashSourceFile(sourceFile);
    const hash2 = await hashSourceFile(sourceFile);
    expect(hash1).toBe(hash2);
  });
});

// ---------------------------------------------------------------------------
// Refine cache
// ---------------------------------------------------------------------------

describe("refine cache", () => {
  it("round-trips save and load", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);
    const loaded = await loadRefineCache("enchiridion", hash);

    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
    expect(loaded![0].slug).toBe("sections-01-10");
    expect(loaded![0].chunks).toHaveLength(2);
    expect(loaded![0].chunks[0].sectionNumber).toBe(1);
    expect(loaded![0].chunks[1].text).toBe("If you want freedom, stop wishing.");
  });

  it("preserves bookNumber for Meditations chapters", async () => {
    const hash = await hashSourceFile(sourceFile);
    const chapters = [{ slug: "book-01", title: "Book 1", bookNumber: 1, chunks: sampleChunks }];
    await saveRefineCache("meditations", hash, chapters);
    const loaded = await loadRefineCache("meditations", hash);

    expect(loaded![0].bookNumber).toBe(1);
  });

  it("returns null on cache miss (no file)", async () => {
    const loaded = await loadRefineCache("nonexistent", "abc123");
    expect(loaded).toBeNull();
  });

  it("returns null when source hash has changed", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    const loaded = await loadRefineCache("enchiridion", "different-hash");
    expect(loaded).toBeNull();
  });

  it("overwrites previous cache on re-save", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    const updatedChapters = [
      { slug: "sections-01-10", title: "Sections 1–10", chunks: [sampleChunks[0]] },
    ];
    await saveRefineCache("enchiridion", hash, updatedChapters);

    const loaded = await loadRefineCache("enchiridion", hash);
    expect(loaded![0].chunks).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Translate cache
// ---------------------------------------------------------------------------

describe("translate cache", () => {
  it("round-trips save and load", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", hash, translateMap);
    const loaded = await loadTranslateCache("enchiridion", hash);

    expect(loaded).not.toBeNull();
    expect(loaded!.size).toBe(1);
    const chunks = loaded!.get("enchiridion_sections-01-10")!;
    expect(chunks).toHaveLength(1);
    expect(chunks[0].plainEnglish).toBe("You control your opinions, not your body.");
    expect(chunks[0].tags).toEqual(["freedom-and-control"]);
  });

  it("preserves meaningCheck fields", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", hash, translateMap);
    const loaded = await loadTranslateCache("enchiridion", hash);
    const check = loaded!.get("enchiridion_sections-01-10")![0].meaningCheck!;

    expect(check.faithful).toBe(true);
    expect(check.tone_preserved).toBe(true);
    expect(check.ideas_changed).toBe(false);
    expect(check.over_explains).toBe(false);
  });

  it("handles multiple chapters in one book", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("meditations_book-01", sampleTranslated);
    translateMap.set("meditations_book-02", [
      { ...sampleTranslated[0], sectionNumber: 5, plainEnglish: "Book 2 text" },
    ]);

    await saveTranslateCache("meditations", hash, translateMap);
    const loaded = await loadTranslateCache("meditations", hash);

    expect(loaded!.size).toBe(2);
    expect(loaded!.get("meditations_book-01")).toHaveLength(1);
    expect(loaded!.get("meditations_book-02")![0].plainEnglish).toBe("Book 2 text");
  });

  it("returns null on cache miss (no file)", async () => {
    const loaded = await loadTranslateCache("nonexistent", "abc123");
    expect(loaded).toBeNull();
  });

  it("returns null when source hash has changed", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);

    await saveTranslateCache("enchiridion", hash, translateMap);
    const loaded = await loadTranslateCache("enchiridion", "different-hash");
    expect(loaded).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pipeline version checking
// ---------------------------------------------------------------------------

describe("pipeline version checking", () => {
  it("refine: save then load with matching version returns data", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);
    const loaded = await loadRefineCache("enchiridion", hash);
    expect(loaded).not.toBeNull();
    expect(loaded).toHaveLength(1);
  });

  it("refine: load with mismatched version returns null", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    // Tamper with the saved file to simulate an old version
    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    raw.pipelineVersion = 999;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadRefineCache("enchiridion", hash);
    expect(loaded).toBeNull();
  });

  it("refine: load with missing pipelineVersion field returns null", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    delete raw.pipelineVersion;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadRefineCache("enchiridion", hash);
    expect(loaded).toBeNull();
  });

  it("translate: load with mismatched version returns null", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", hash, translateMap);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "translate.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    raw.pipelineVersion = 999;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadTranslateCache("enchiridion", hash);
    expect(loaded).toBeNull();
  });

  it("translate: load with missing pipelineVersion field returns null", async () => {
    const hash = await hashSourceFile(sourceFile);
    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", hash, translateMap);

    const { readFile, writeFile } = await import("node:fs/promises");
    const filePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "translate.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    delete raw.pipelineVersion;
    await writeFile(filePath, JSON.stringify(raw));

    const loaded = await loadTranslateCache("enchiridion", hash);
    expect(loaded).toBeNull();
  });

  it("saved refine files contain pipelineVersion matching the constant", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    const { readFile } = await import("node:fs/promises");
    const filePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "refine.json");
    const raw = JSON.parse(await readFile(filePath, "utf-8"));
    expect(raw.pipelineVersion).toBe(PIPELINE_VERSION);
  });

  it("saved files contain createdAt as valid ISO string", async () => {
    const hash = await hashSourceFile(sourceFile);
    await saveRefineCache("enchiridion", hash, sampleChapters);

    const translateMap = new Map<string, TranslatedChunk[]>();
    translateMap.set("enchiridion_sections-01-10", sampleTranslated);
    await saveTranslateCache("enchiridion", hash, translateMap);

    const { readFile } = await import("node:fs/promises");

    const refinePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "refine.json");
    const refineData = JSON.parse(await readFile(refinePath, "utf-8"));
    expect(new Date(refineData.createdAt).toISOString()).toBe(refineData.createdAt);

    const translateFilePath = path.join(RESOLVED_CACHE_DIR, "enchiridion", "translate.json");
    const translateData = JSON.parse(await readFile(translateFilePath, "utf-8"));
    expect(new Date(translateData.createdAt).toISOString()).toBe(translateData.createdAt);
  });
});
