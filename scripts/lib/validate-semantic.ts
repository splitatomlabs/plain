import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { callClaudeJSON, ClaudeCliError } from "./claude.js";
import type { Chunk } from "./chunker.js";

const CACHE_DIR = "output/validation-cache";

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function hashText(...parts: string[]): string {
  return createHash("sha256")
    .update(parts.join("\n"))
    .digest("hex")
    .slice(0, 16);
}

async function readCache<T>(key: string): Promise<T | null> {
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(CACHE_DIR, `${key}.json`),
    JSON.stringify(data, null, 2),
  );
}

// ---------------------------------------------------------------------------
// Pre-check: single-idea + standalone (runs on original text before translation)
// ---------------------------------------------------------------------------

export interface PreCheckResult {
  sectionNumber: number;
  single_idea: boolean;
  single_idea_suggestion?: string;
  standalone: boolean;
  standalone_resolution?: string;
}

export interface PreCheckReport {
  passed: Chunk[];
  warnings: { chunk: Chunk; result: PreCheckResult }[];
}

function buildPreCheckPrompt(
  chunk: Chunk,
  prevChunk: Chunk | null,
  nextChunk: Chunk | null,
): string {
  let adjacentContext = "";
  if (prevChunk) {
    adjacentContext += `\nPrevious section:\n"""\n${prevChunk.text}\n"""\n`;
  }
  if (nextChunk) {
    adjacentContext += `\nNext section:\n"""\n${nextChunk.text}\n"""\n`;
  }

  return `Evaluate this source text section before it gets translated. Be concise.

SECTION TEXT:
"""
${chunk.text}
"""
${adjacentContext}
Check two things:

1. SINGLE IDEA — Does this section contain one coherent idea, or multiple distinct ideas that should be separate cards?
2. STANDALONE — Would a reader understand this section on its own, or does it depend on the previous/next section?

Respond with ONLY this JSON (no other text):

{
  "single_idea": true,
  "single_idea_suggestion": null,
  "standalone": true,
  "standalone_resolution": null
}

Set booleans to false and fill in the string fields when there are problems. Keep string fields short (one sentence).`;
}

export async function preCheckChunks(
  chunks: Chunk[],
  useCache: boolean = true,
): Promise<PreCheckReport> {
  const passed: Chunk[] = [];
  const warnings: PreCheckReport["warnings"] = [];
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const prev = i > 0 ? chunks[i - 1] : null;
    const next = i < chunks.length - 1 ? chunks[i + 1] : null;
    const cacheId = `precheck-${chunk.sectionNumber}-${hashText(chunk.text)}`;

    process.stderr.write(
      `Pre-check ${i + 1}/${total}: section ${chunk.sectionNumber}...\n`,
    );

    let result: PreCheckResult | null = null;

    if (useCache) {
      result = await readCache<PreCheckResult>(cacheId);
    }

    if (!result) {
      try {
        const prompt = buildPreCheckPrompt(chunk, prev, next);
        const response = await callClaudeJSON<Omit<PreCheckResult, "sectionNumber">>(prompt);
        result = { sectionNumber: chunk.sectionNumber, ...response };
        await writeCache(cacheId, result);
      } catch (e) {
        process.stderr.write(
          `  Pre-check failed for section ${chunk.sectionNumber}: ${e instanceof ClaudeCliError ? e.message : String(e)}\n`,
        );
        // On failure, pass the chunk through — don't block translation
        passed.push(chunk);
        continue;
      }
    }

    if (!result.single_idea || !result.standalone) {
      warnings.push({ chunk, result });
    }

    // All chunks pass through — warnings are informational, not blocking
    passed.push(chunk);
  }

  return { passed, warnings };
}

// ---------------------------------------------------------------------------
// Meaning preservation check (runs after translation)
// ---------------------------------------------------------------------------

export interface MeaningCheckResult {
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  notes?: string;
}

function buildMeaningPrompt(
  originalText: string,
  plainEnglish: string,
): string {
  return `Compare this original text with its plain English translation. Be concise.

ORIGINAL:
"""
${originalText}
"""

PLAIN ENGLISH:
"""
${plainEnglish}
"""

Check:
(a) Does the translation preserve the original meaning precisely?
(b) Does it preserve the emotional tone?
(c) Are any ideas added or removed?
(d) Does it over-explain or patronize?

Respond with ONLY this JSON (no other text):

{
  "faithful": true,
  "tone_preserved": true,
  "ideas_changed": false,
  "over_explains": false,
  "notes": null
}

Set booleans accordingly and fill in notes when there are problems. Keep notes short (one sentence).`;
}

export async function checkMeaningPreservation(
  originalText: string,
  plainEnglish: string,
  sectionNumber: number,
  useCache: boolean = true,
): Promise<MeaningCheckResult> {
  const cacheId = `meaning-${sectionNumber}-${hashText(originalText, plainEnglish)}`;

  if (useCache) {
    const cached = await readCache<MeaningCheckResult>(cacheId);
    if (cached) return cached;
  }

  const prompt = buildMeaningPrompt(originalText, plainEnglish);
  const result = await callClaudeJSON<MeaningCheckResult>(prompt);
  await writeCache(cacheId, result);
  return result;
}
