/**
 * Pipeline intermediates: persists parse, refine, and translate results to disk
 * so that a failed or interrupted run can resume without redoing completed phases.
 *
 * Files live in content/pipeline/<book-slug>/ and are checked into version control.
 * pipelineVersion auto-invalidates the cache when pipeline logic changes.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { Chunk } from "./chunker.js";
import type { ParsedChapter } from "./parser.js";
import type { TranslatedChunk } from "./translator.js";

function cacheDir(): string {
  return path.resolve("content/pipeline");
}

export const PIPELINE_VERSION = 2;

// ---------------------------------------------------------------------------
// Cost tracking
// ---------------------------------------------------------------------------

export interface TokenSnapshot {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface PhaseCost {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  estimatedCost: number;
}

// Sonnet batch pricing (per million tokens)
const SONNET_BATCH_PRICING = {
  input: 1.5,        // $1.50 / 1M input tokens (batch = 50% of real-time $3)
  output: 7.5,       // $7.50 / 1M output tokens (batch = 50% of real-time $15)
  cacheRead: 0.15,   // $0.15 / 1M cache-read tokens (batch = 50% of $0.30)
  cacheCreation: 1.875, // $1.875 / 1M cache-creation tokens (batch = 50% of $3.75)
};

export function snapshotTokenUsage(usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }): TokenSnapshot {
  return { ...usage };
}

export function computePhaseCost(before: TokenSnapshot, after: TokenSnapshot): PhaseCost {
  const inputTokens = after.inputTokens - before.inputTokens;
  const outputTokens = after.outputTokens - before.outputTokens;
  const cacheReadTokens = after.cacheReadTokens - before.cacheReadTokens;
  const cacheCreationTokens = after.cacheCreationTokens - before.cacheCreationTokens;

  const estimatedCost =
    (inputTokens / 1_000_000) * SONNET_BATCH_PRICING.input +
    (outputTokens / 1_000_000) * SONNET_BATCH_PRICING.output +
    (cacheReadTokens / 1_000_000) * SONNET_BATCH_PRICING.cacheRead +
    (cacheCreationTokens / 1_000_000) * SONNET_BATCH_PRICING.cacheCreation;

  return { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, estimatedCost };
}

// ---------------------------------------------------------------------------
// Types stored on disk
// ---------------------------------------------------------------------------

export interface CachedParse {
  pipelineVersion: number;
  createdAt: string;
  bookSlug: string;
  chapters: ParsedChapter[];
}

interface CachedRefine {
  pipelineVersion: number;
  createdAt: string;
  bookSlug: string;
  chapters: {
    slug: string;
    title: string;
    bookNumber?: number;
    chunks: Chunk[];
  }[];
  cost?: PhaseCost;
}

interface CachedTranslate {
  pipelineVersion: number;
  createdAt: string;
  bookSlug: string;
  /** Keyed by "{bookSlug}_{chapterSlug}" */
  chapters: Record<string, TranslatedChunk[]>;
  cost?: PhaseCost;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureBookDir(bookSlug: string): Promise<void> {
  await mkdir(path.join(cacheDir(), bookSlug), { recursive: true });
}

export function parsePath(bookSlug: string): string {
  return path.join(cacheDir(), bookSlug, "parse.json");
}

function refinePath(bookSlug: string): string {
  return path.join(cacheDir(), bookSlug, "refine.json");
}

function translatePath(bookSlug: string): string {
  return path.join(cacheDir(), bookSlug, "translate.json");
}

// ---------------------------------------------------------------------------
// Parse cache
// ---------------------------------------------------------------------------

export async function saveParseCache(
  bookSlug: string,
  chapters: ParsedChapter[],
): Promise<void> {
  await ensureBookDir(bookSlug);
  const data: CachedParse = { pipelineVersion: PIPELINE_VERSION, createdAt: new Date().toISOString(), bookSlug, chapters };
  await writeFile(parsePath(bookSlug), JSON.stringify(data, null, 2) + "\n");
}

export async function loadParseCache(
  bookSlug: string,
): Promise<ParsedChapter[] | null> {
  try {
    const raw = await readFile(parsePath(bookSlug), "utf-8");
    const data = JSON.parse(raw) as CachedParse;
    if (data.pipelineVersion !== PIPELINE_VERSION) {
      console.log(`  Cache miss (pipeline version changed) for ${bookSlug} parse`);
      return null;
    }
    return data.chapters;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Refine cache
// ---------------------------------------------------------------------------

export async function saveRefineCache(
  bookSlug: string,
  chapters: { slug: string; title: string; bookNumber?: number; chunks: Chunk[] }[],
  cost?: PhaseCost,
): Promise<void> {
  await ensureBookDir(bookSlug);
  const data: CachedRefine = { pipelineVersion: PIPELINE_VERSION, createdAt: new Date().toISOString(), bookSlug, chapters };
  if (cost) data.cost = cost;
  await writeFile(refinePath(bookSlug), JSON.stringify(data, null, 2) + "\n");
}

export async function loadRefineCache(
  bookSlug: string,
): Promise<CachedRefine["chapters"] | null> {
  try {
    const raw = await readFile(refinePath(bookSlug), "utf-8");
    const data = JSON.parse(raw) as CachedRefine;
    if (data.pipelineVersion !== PIPELINE_VERSION) {
      console.log(`  Cache miss (pipeline version changed) for ${bookSlug} refine`);
      return null;
    }
    return data.chapters;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Translate cache
// ---------------------------------------------------------------------------

export async function saveTranslateCache(
  bookSlug: string,
  translated: Map<string, TranslatedChunk[]>,
  cost?: PhaseCost,
): Promise<void> {
  await ensureBookDir(bookSlug);
  const chapters: Record<string, TranslatedChunk[]> = {};
  for (const [key, chunks] of translated) {
    chapters[key] = chunks;
  }
  const data: CachedTranslate = { pipelineVersion: PIPELINE_VERSION, createdAt: new Date().toISOString(), bookSlug, chapters };
  if (cost) data.cost = cost;
  await writeFile(translatePath(bookSlug), JSON.stringify(data, null, 2) + "\n");
}

/**
 * Diff refined chunks against cached translations to find what needs translating.
 * Returns cached translations and uncached chunk indices.
 */
export function diffChunksForTranslation(
  refined: Chunk[],
  cached: TranslatedChunk[],
): { cached: TranslatedChunk[]; uncached: { index: number; chunk: Chunk }[] } {
  // Build lookup: sectionNumber -> list of cached translations (handles splits)
  const cachedBySectionNumber = new Map<number, TranslatedChunk[]>();
  for (const tc of cached) {
    const list = cachedBySectionNumber.get(tc.sectionNumber) ?? [];
    list.push(tc);
    cachedBySectionNumber.set(tc.sectionNumber, list);
  }

  const kept: TranslatedChunk[] = [];
  const uncached: { index: number; chunk: Chunk }[] = [];

  for (let i = 0; i < refined.length; i++) {
    const chunk = refined[i];
    const available = cachedBySectionNumber.get(chunk.sectionNumber);
    if (available && available.length > 0) {
      kept.push(available.shift()!);
    } else {
      uncached.push({ index: i, chunk });
    }
  }

  return { cached: kept, uncached };
}

/**
 * Merge new translations into an existing translate cache, preserving already-cached chunks.
 * If no existing cache, behaves like saveTranslateCache.
 */
export async function mergeTranslateCache(
  bookSlug: string,
  newTranslations: Map<string, TranslatedChunk[]>,
  cost?: PhaseCost,
): Promise<void> {
  const existing = await loadTranslateCache(bookSlug);
  const merged = new Map<string, TranslatedChunk[]>();

  // Start with existing cache entries
  if (existing) {
    for (const [key, chunks] of existing) {
      merged.set(key, [...chunks]);
    }
  }

  // Merge in new translations
  for (const [key, newChunks] of newTranslations) {
    const existingChunks = merged.get(key) ?? [];
    // Dedup by (sectionNumber, originalText) to handle split sections correctly
    const existingKeys = new Set(existingChunks.map(c => `${c.sectionNumber}::${c.originalText}`));
    for (const chunk of newChunks) {
      const chunkKey = `${chunk.sectionNumber}::${chunk.originalText}`;
      if (!existingKeys.has(chunkKey)) {
        existingChunks.push(chunk);
        existingKeys.add(chunkKey);
      }
    }
    // Sort by sectionNumber
    existingChunks.sort((a, b) => a.sectionNumber - b.sectionNumber);
    merged.set(key, existingChunks);
  }

  await saveTranslateCache(bookSlug, merged, cost);
}

export async function loadTranslateCache(
  bookSlug: string,
): Promise<Map<string, TranslatedChunk[]> | null> {
  try {
    const raw = await readFile(translatePath(bookSlug), "utf-8");
    const data = JSON.parse(raw) as CachedTranslate;
    if (data.pipelineVersion !== PIPELINE_VERSION) {
      console.log(`  Cache miss (pipeline version changed) for ${bookSlug} translate`);
      return null;
    }
    const map = new Map<string, TranslatedChunk[]>();
    for (const [key, chunks] of Object.entries(data.chapters)) {
      map.set(key, chunks);
    }
    return map;
  } catch {
    return null;
  }
}
