import { callClaudeJSON, ClaudeCliError } from "./claude.js";
import type { Chunk } from "./chunker.js";
import type { BookConfig } from "./constants.js";

/** Hard cap: any chunk whose original text exceeds this reading time must be split. */
export const MAX_READING_TIME_SECONDS = 90;

const AUTHOR_CONTEXT: Record<string, string> = {
  epictetus:
    "Epictetus is direct and instructional. His sections are short, punchy lessons — most work well as standalone cards. Very short sections (a sentence or two) are common and may need merging.",
  "marcus-aurelius":
    "Marcus Aurelius wrote private journal reflections. Sections vary widely — some are a single sentence of self-reminding, others are extended meditations. Very short entries often depend on the previous thought. Longer entries sometimes contain multiple distinct ideas.",
  seneca:
    "Seneca wrote conversational essays with flowing arguments. Sections can be long and often build on each other. A section that opens with a continuation ('But...', 'For...', 'And yet...') likely depends on the previous one. Long sections with multiple distinct arguments should be split.",
};

// ---------------------------------------------------------------------------
// Refine response shape
// ---------------------------------------------------------------------------

interface RefineResponse {
  action: "keep" | "split" | "merge_next" | "merge_prev";
  /** For "split": array of text segments to become separate chunks */
  segments?: string[];
  reason?: string;
}

/** Static system prompt for refine — cacheable across all chunks of the same book */
export function buildRefineSystem(config: BookConfig): string {
  const authorContext = AUTHOR_CONTEXT[config.author_slug] ?? "";

  return `You are preparing sections from "${config.title}" for translation into bite-sized reading cards. Each card will be translated into plain English at an 8th-grade reading level.

A good card:
- Contains ONE coherent idea
- Makes sense on its own to a reader with no surrounding context
- Is roughly 50-300 words (shorter is fine if the idea is complete; longer sections with multiple ideas should be split)

AUTHOR CONTEXT: ${authorContext}

Evaluate the section provided and decide what to do with it.

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

/** Per-chunk user message for refine */
function buildRefineUser(
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

  return `CURRENT SECTION (section ${chunk.sectionNumber}):
"""
${chunk.text}
"""
${adjacentContext}`;
}

function buildRefinePrompt(
  chunk: Chunk,
  prevChunk: Chunk | null,
  nextChunk: Chunk | null,
  config: BookConfig,
): string {
  return `${buildRefineSystem(config)}\n\n${buildRefineUser(chunk, prevChunk, nextChunk)}`;
}

// ---------------------------------------------------------------------------
// Reading-time cap — split oversized chunks before translation
// ---------------------------------------------------------------------------

function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(Math.round((words / 200) * 60), 5);
}

/**
 * Split text into two halves at the best available boundary.
 * Prefers paragraph breaks (\n\n), falls back to sentence endings,
 * and as a last resort splits at the midpoint word boundary.
 */
function splitTextAtBoundary(text: string): [string, string] {
  const mid = Math.floor(text.length / 2);

  // Try paragraph breaks — pick the one closest to the midpoint
  const paraSplits: number[] = [];
  let idx = text.indexOf("\n\n");
  while (idx !== -1) {
    paraSplits.push(idx);
    idx = text.indexOf("\n\n", idx + 1);
  }
  if (paraSplits.length > 0) {
    const best = paraSplits.reduce((a, b) =>
      Math.abs(a - mid) <= Math.abs(b - mid) ? a : b,
    );
    return [text.slice(0, best).trimEnd(), text.slice(best).trimStart()];
  }

  // Try sentence boundaries (". ", "? ", "! ")
  const sentenceRe = /[.?!]\s/g;
  const sentSplits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(text)) !== null) {
    sentSplits.push(m.index + 1);
  }
  if (sentSplits.length > 0) {
    const best = sentSplits.reduce((a, b) =>
      Math.abs(a - mid) <= Math.abs(b - mid) ? a : b,
    );
    return [text.slice(0, best).trimEnd(), text.slice(best).trimStart()];
  }

  // Last resort: split at midpoint word boundary
  const spaceAfter = text.indexOf(" ", mid);
  const splitAt = spaceAfter !== -1 ? spaceAfter : mid;
  return [text.slice(0, splitAt).trimEnd(), text.slice(splitAt).trimStart()];
}

/**
 * Recursively split a chunk's text until every piece is under MAX_READING_TIME_SECONDS.
 */
function splitOversizedChunk(chunk: Chunk): Chunk[] {
  if (estimateReadingTime(chunk.text) <= MAX_READING_TIME_SECONDS) {
    return [chunk];
  }

  const [textA, textB] = splitTextAtBoundary(chunk.text);

  return [
    ...splitOversizedChunk({ sectionNumber: chunk.sectionNumber, text: textA }),
    ...splitOversizedChunk({ sectionNumber: chunk.sectionNumber, text: textB }),
  ];
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
  config: BookConfig,
): Promise<RefineResult> {
  const refined: Chunk[] = [];
  let splits = 0;
  let merges = 0;
  const total = chunks.length;
  let skipNext = false;
  const system = buildRefineSystem(config);

  for (let i = 0; i < chunks.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const chunk = chunks[i];
    const prev = i > 0 ? chunks[i - 1] : null;
    const next = i < chunks.length - 1 ? chunks[i + 1] : null;

    process.stderr.write(
      `Refine ${i + 1}/${total}: section ${chunk.sectionNumber}...\n`,
    );

    let response: RefineResponse;
    try {
      const prompt = buildRefinePrompt(chunk, prev, next, config);
      response = await callClaudeJSON<RefineResponse>(prompt, undefined, { system });
    } catch (e) {
      process.stderr.write(
        `  Refine failed for section ${chunk.sectionNumber}: ${e instanceof ClaudeCliError ? e.message : String(e)}\n`,
      );
      refined.push(chunk);
      continue;
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
      refined.push(chunk);
    }
  }

  // Hard cap: split any chunk that still exceeds MAX_READING_TIME_SECONDS
  const capped: Chunk[] = [];
  for (const chunk of refined) {
    const pieces = splitOversizedChunk(chunk);
    if (pieces.length > 1) {
      splits++;
      process.stderr.write(
        `  LENGTH-SPLIT section ${chunk.sectionNumber} into ${pieces.length} chunks (exceeded ${MAX_READING_TIME_SECONDS}s cap)\n`,
      );
    }
    capped.push(...pieces);
  }

  return {
    originalCount: chunks.length,
    refinedCount: capped.length,
    splits,
    merges,
    chunks: capped,
  };
}
