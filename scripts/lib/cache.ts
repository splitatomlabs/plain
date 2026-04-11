/**
 * Pipeline intermediates: persists refine and translate results to disk so
 * that a failed or interrupted run can resume without redoing completed phases.
 *
 * Files live in pipeline/<book-slug>/ and are checked into version control.
 * Each file includes a content hash of the source file so the cache
 * auto-invalidates when source text changes.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Chunk } from "./chunker.js";
import type { TranslatedChunk } from "./translator.js";

const CACHE_DIR = path.resolve("pipeline");

// ---------------------------------------------------------------------------
// Types stored on disk
// ---------------------------------------------------------------------------

interface CachedRefine {
  sourceHash: string;
  bookSlug: string;
  chapters: {
    slug: string;
    title: string;
    bookNumber?: number;
    chunks: Chunk[];
  }[];
}

interface CachedTranslate {
  sourceHash: string;
  bookSlug: string;
  /** Keyed by "{bookSlug}_{chapterSlug}" */
  chapters: Record<string, TranslatedChunk[]>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function ensureBookDir(bookSlug: string): Promise<void> {
  await mkdir(path.join(CACHE_DIR, bookSlug), { recursive: true });
}

export async function hashSourceFile(sourceFile: string): Promise<string> {
  const content = await readFile(sourceFile, "utf-8");
  return createHash("sha256").update(content).digest("hex").slice(0, 16);
}

function refinePath(bookSlug: string): string {
  return path.join(CACHE_DIR, bookSlug, "refine.json");
}

function translatePath(bookSlug: string): string {
  return path.join(CACHE_DIR, bookSlug, "translate.json");
}

// ---------------------------------------------------------------------------
// Refine cache
// ---------------------------------------------------------------------------

export async function saveRefineCache(
  bookSlug: string,
  sourceHash: string,
  chapters: { slug: string; title: string; bookNumber?: number; chunks: Chunk[] }[],
): Promise<void> {
  await ensureBookDir(bookSlug);
  const data: CachedRefine = { sourceHash, bookSlug, chapters };
  await writeFile(refinePath(bookSlug), JSON.stringify(data, null, 2) + "\n");
}

export async function loadRefineCache(
  bookSlug: string,
  sourceHash: string,
): Promise<CachedRefine["chapters"] | null> {
  try {
    const raw = await readFile(refinePath(bookSlug), "utf-8");
    const data = JSON.parse(raw) as CachedRefine;
    if (data.sourceHash !== sourceHash) {
      console.log(`  Cache miss (source changed) for ${bookSlug} refine`);
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
  sourceHash: string,
  translated: Map<string, TranslatedChunk[]>,
): Promise<void> {
  await ensureBookDir(bookSlug);
  const chapters: Record<string, TranslatedChunk[]> = {};
  for (const [key, chunks] of translated) {
    chapters[key] = chunks;
  }
  const data: CachedTranslate = { sourceHash, bookSlug, chapters };
  await writeFile(translatePath(bookSlug), JSON.stringify(data, null, 2) + "\n");
}

export async function loadTranslateCache(
  bookSlug: string,
  sourceHash: string,
): Promise<Map<string, TranslatedChunk[]> | null> {
  try {
    const raw = await readFile(translatePath(bookSlug), "utf-8");
    const data = JSON.parse(raw) as CachedTranslate;
    if (data.sourceHash !== sourceHash) {
      console.log(`  Cache miss (source changed) for ${bookSlug} translate`);
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
