import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { callClaudeJSON, ClaudeCliError } from "./claude.js";
import type { Chunk } from "./chunker.js";

const CACHE_DIR = "output/refine-cache";

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
// Refine response shape
// ---------------------------------------------------------------------------

interface RefineResponse {
  action: "keep" | "split" | "merge_next" | "merge_prev";
  /** For "split": array of text segments to become separate chunks */
  segments?: string[];
  reason?: string;
}

function buildRefinePrompt(
  chunk: Chunk,
  prevChunk: Chunk | null,
  nextChunk: Chunk | null,
): string {
  let adjacentContext = "";
  if (prevChunk) {
    adjacentContext += `\nPREVIOUS SECTION:\n"""\n${prevChunk.text}\n"""\n`;
  }
  if (nextChunk) {
    adjacentContext += `\nNEXT SECTION:\n"""\n${nextChunk.text}\n"""\n`;
  }

  return `You are preparing source text sections for translation into bite-sized reading cards. Each card should contain ONE coherent idea and make sense on its own.

Evaluate this section and decide what to do with it.

CURRENT SECTION (section ${chunk.sectionNumber}):
"""
${chunk.text}
"""
${adjacentContext}
Choose ONE action:

1. "keep" — This section contains a single idea and stands alone. No changes needed.
2. "split" — This section contains multiple distinct ideas. Split it into separate segments. Each segment must be the complete original text for that idea (do not summarize or rewrite). Preserve all original wording.
3. "merge_next" — This section is too dependent on the next section to stand alone. They should be combined into one card.
4. "merge_prev" — This section is too dependent on the previous section to stand alone. It should be combined with the previous section.

Respond with ONLY this JSON (no other text):

{
  "action": "keep",
  "segments": null,
  "reason": null
}

If action is "split", set "segments" to an array of the text segments (each segment is the exact original text for one idea).
If action is "merge_next" or "merge_prev", set "reason" to a brief explanation.
If action is "keep", leave segments and reason as null.`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface RefineResult {
  originalCount: number;
  refinedCount: number;
  splits: number;
  merges: number;
  chunks: Chunk[];
}

export async function refineChunks(
  chunks: Chunk[],
  useCache: boolean = true,
): Promise<RefineResult> {
  const refined: Chunk[] = [];
  let splits = 0;
  let merges = 0;
  const total = chunks.length;
  let skipNext = false;

  for (let i = 0; i < chunks.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const chunk = chunks[i];
    const prev = i > 0 ? chunks[i - 1] : null;
    const next = i < chunks.length - 1 ? chunks[i + 1] : null;
    const cacheId = `refine-${chunk.sectionNumber}-${hashText(chunk.text)}`;

    process.stderr.write(
      `Refine ${i + 1}/${total}: section ${chunk.sectionNumber}...\n`,
    );

    let response: RefineResponse | null = null;

    if (useCache) {
      response = await readCache<RefineResponse>(cacheId);
    }

    if (!response) {
      try {
        const prompt = buildRefinePrompt(chunk, prev, next);
        response = await callClaudeJSON<RefineResponse>(prompt);
        await writeCache(cacheId, response);
      } catch (e) {
        process.stderr.write(
          `  Refine failed for section ${chunk.sectionNumber}: ${e instanceof ClaudeCliError ? e.message : String(e)}\n`,
        );
        // On failure, keep the chunk as-is
        refined.push(chunk);
        continue;
      }
    }

    if (response.action === "split" && response.segments && response.segments.length > 1) {
      process.stderr.write(
        `  SPLIT section ${chunk.sectionNumber} into ${response.segments.length} chunks\n`,
      );
      splits++;
      for (let s = 0; s < response.segments.length; s++) {
        refined.push({
          sectionNumber: chunk.sectionNumber,
          text: response.segments[s].trim(),
        });
      }
    } else if (response.action === "merge_next" && next) {
      process.stderr.write(
        `  MERGE section ${chunk.sectionNumber} + ${next.sectionNumber}: ${response.reason ?? ""}\n`,
      );
      merges++;
      refined.push({
        sectionNumber: chunk.sectionNumber,
        text: chunk.text + "\n\n" + next.text,
      });
      skipNext = true;
    } else if (response.action === "merge_prev" && refined.length > 0) {
      process.stderr.write(
        `  MERGE section ${chunk.sectionNumber} into previous: ${response.reason ?? ""}\n`,
      );
      merges++;
      const last = refined[refined.length - 1];
      last.text = last.text + "\n\n" + chunk.text;
    } else {
      // "keep" or fallback
      refined.push(chunk);
    }
  }

  return {
    originalCount: chunks.length,
    refinedCount: refined.length,
    splits,
    merges,
    chunks: refined,
  };
}
