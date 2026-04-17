import {
  callClaudeJSON,
  ClaudeCliError,
  createMessageBatch,
  pollBatchUntilDone,
  streamBatchResults,
  extractJSON,
  tokenUsage,
  batchStats,
  safeCustomId,
  type BatchRequest,
} from "./claude.js";
import type { Chunk } from "./chunker.js";
import type { BookConfig } from "./constants.js";

/** Hard cap: any chunk whose original text exceeds this reading time must be split. */
export const MAX_READING_TIME_SECONDS = 60;

const AUTHOR_CONTEXT: Record<string, string> = {
  epictetus:
    "Epictetus is direct and instructional. In the Enchiridion, sections are short, punchy lessons — most work well as standalone cards. Very short sections (a sentence or two) are common and may need merging. In the Discourses, sections are longer and more conversational — extended arguments with examples, dialogues, and rhetorical questions. Long discourses with multiple distinct ideas should be split.",
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
- Is roughly 50-200 words (shorter is fine if the idea is complete; longer sections with multiple ideas should be split)

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
// Bulk refine prompts — evaluate multiple sections in one API call
// ---------------------------------------------------------------------------

interface BulkRefineResponse {
  section: number;
  action: "keep" | "split" | "merge_next" | "merge_prev";
  segments?: string[];
  reason?: string;
}

/** System prompt for bulk refine — evaluates a batch of sections at once */
export function buildBulkRefineSystem(config: BookConfig): string {
  const authorContext = AUTHOR_CONTEXT[config.author_slug] ?? "";

  return `You are preparing sections from "${config.title}" for translation into bite-sized reading cards. Each card will be translated into plain English at an 8th-grade reading level.

A good card:
- Contains ONE coherent idea
- Makes sense on its own to a reader with no surrounding context
- Is roughly 50-200 words (shorter is fine if the idea is complete)

HARD RULE: Any section longer than 200 words MUST be split. Each resulting segment must be under 200 words.

AUTHOR CONTEXT: ${authorContext}

You will receive multiple sections at once. Evaluate EACH section and decide what to do with it.

For each section, choose ONE action:

1. "keep" — Single idea, stands alone. No changes needed.
2. "split" — Multiple distinct ideas OR exceeds 200 words. Split into separate segments. Each segment must be the complete original text for that idea (do not summarize or rewrite). Preserve all original wording.
3. "merge_next" — Too dependent on the next section to stand alone. Combine with next.
4. "merge_prev" — Too dependent on the previous section to stand alone. Combine with previous.

Respond with ONLY a JSON array (no other text). One entry per section, in order:

[
  { "section": 1, "action": "keep", "segments": null, "reason": null },
  { "section": 2, "action": "split", "segments": ["First idea text...", "Second idea text..."], "reason": null },
  { "section": 3, "action": "merge_prev", "segments": null, "reason": "Continues previous thought" }
]

Rules:
- One entry per section, in the same order as provided.
- "section" must match the section number given.
- If "split", "segments" is an array of the exact original text for each idea.
- If "merge_next" or "merge_prev", "reason" is a brief explanation.
- If "keep", leave segments and reason as null.`;
}

/** User message for bulk refine — all chunks formatted as numbered sections */
export function buildBulkRefineUser(chunks: Chunk[]): string {
  return chunks
    .map(
      (chunk) =>
        `--- SECTION ${chunk.sectionNumber} ---\n${chunk.text}`,
    )
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Reading-time cap — split oversized chunks before translation
// ---------------------------------------------------------------------------

export function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(Math.round((words / 200) * 60), 5);
}

/**
 * Split text into two halves at the best available boundary.
 * Prefers paragraph breaks (\n\n), falls back to sentence endings.
 * Returns null if no clean boundary exists (caller should keep chunk intact).
 */
export function splitTextAtBoundary(text: string): [string, string] | null {
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

  // Try sentence boundaries — includes closing quotes after punctuation (e.g., `." `)
  // and semicolons/colons which are valid chunk endings per CHUNK_SENTENCE_END_RE
  const sentenceRe = /[.?!;:]['""\u201D)\]]*\s/g;
  const sentSplits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(text)) !== null) {
    // Split after the punctuation and any closing quotes, before the whitespace
    sentSplits.push(m.index + m[0].length - 1);
  }
  if (sentSplits.length > 0) {
    const best = sentSplits.reduce((a, b) =>
      Math.abs(a - mid) <= Math.abs(b - mid) ? a : b,
    );
    return [text.slice(0, best).trimEnd(), text.slice(best).trimStart()];
  }

  // No clean boundary found — caller should keep chunk intact
  return null;
}

/**
 * Recursively split a chunk's text until every piece is under MAX_READING_TIME_SECONDS.
 * Keeps the chunk intact if no clean boundary (paragraph or sentence) exists —
 * a long card is better than a mid-sentence break.
 */
export function splitOversizedChunk(chunk: Chunk): Chunk[] {
  if (estimateReadingTime(chunk.text) <= MAX_READING_TIME_SECONDS) {
    return [chunk];
  }

  const result = splitTextAtBoundary(chunk.text);
  if (!result) {
    // No clean boundary — keep as-is rather than splitting mid-sentence
    return [chunk];
  }

  const [textA, textB] = result;
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
  /** Number of API calls made during refine (for limit tracking) */
  apiCalls: number;
}

const REFINE_BATCH_SIZE = parseInt(process.env.REFINE_BATCH_SIZE ?? "10", 10);

/**
 * Apply an array of refine decisions to a batch of chunks.
 * Returns the refined chunks, plus split/merge counts.
 */
export function applyDecisions(
  chunks: Chunk[],
  decisions: BulkRefineResponse[],
): { refined: Chunk[]; splits: number; merges: number } {
  // Build a map from section number to decision
  const decisionMap = new Map<number, BulkRefineResponse>();
  for (const d of decisions) {
    decisionMap.set(d.section, d);
  }

  const refined: Chunk[] = [];
  let splits = 0;
  let merges = 0;
  let skipNext = false;

  for (let i = 0; i < chunks.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const chunk = chunks[i];
    const next = i < chunks.length - 1 ? chunks[i + 1] : null;
    const decision = decisionMap.get(chunk.sectionNumber);

    if (!decision) {
      // No decision for this chunk — keep as-is
      refined.push(chunk);
      continue;
    }

    if (decision.action === "split" && decision.segments && decision.segments.length > 1) {
      process.stderr.write(
        `  SPLIT section ${chunk.sectionNumber} into ${decision.segments.length} chunks\n`,
      );
      splits++;
      for (const segment of decision.segments) {
        refined.push({ sectionNumber: chunk.sectionNumber, text: segment.trim() });
      }
    } else if (decision.action === "merge_next" && next) {
      process.stderr.write(
        `  MERGE section ${chunk.sectionNumber} + ${next.sectionNumber}: ${decision.reason ?? ""}\n`,
      );
      merges++;
      refined.push({
        sectionNumber: chunk.sectionNumber,
        text: chunk.text + "\n\n" + next.text,
      });
      skipNext = true;
    } else if (decision.action === "merge_prev" && refined.length > 0) {
      process.stderr.write(
        `  MERGE section ${chunk.sectionNumber} into previous: ${decision.reason ?? ""}\n`,
      );
      merges++;
      const last = refined[refined.length - 1];
      last.text = last.text + "\n\n" + chunk.text;
    } else {
      refined.push(chunk);
    }
  }

  return { refined, splits, merges };
}

/**
 * Refine chunks using batched API calls (real-time, not Batch API).
 * Sends ~REFINE_BATCH_SIZE chunks per call.
 * Used internally as fallback when Batch API requests fail.
 */
export async function refineChunksRealtime(
  chunks: Chunk[],
  config: BookConfig,
): Promise<RefineResult> {
  let allRefined: Chunk[] = [];
  let totalSplits = 0;
  let totalMerges = 0;
  let apiCalls = 0;
  const system = buildBulkRefineSystem(config);

  // Split into batches
  const batches: Chunk[][] = [];
  for (let i = 0; i < chunks.length; i += REFINE_BATCH_SIZE) {
    batches.push(chunks.slice(i, i + REFINE_BATCH_SIZE));
  }

  // Track deferred merge_next from previous batch
  let deferredMergeChunk: Chunk | null = null;

  for (let b = 0; b < batches.length; b++) {
    let batch = batches[b];

    // Merge deferred chunk with the first chunk of this batch
    if (deferredMergeChunk) {
      const first = batch[0];
      batch = [
        {
          sectionNumber: deferredMergeChunk.sectionNumber,
          text: deferredMergeChunk.text + "\n\n" + first.text,
        },
        ...batch.slice(1),
      ];
      deferredMergeChunk = null;
      totalMerges++;
      process.stderr.write(
        `  MERGE (cross-batch) section ${batch[0].sectionNumber} with next batch\n`,
      );
    }

    process.stderr.write(
      `  Batch ${b + 1}/${batches.length}: ${batch.length} chunks (sections ${batch[0].sectionNumber}-${batch[batch.length - 1].sectionNumber})...\n`,
    );

    let decisions: BulkRefineResponse[];
    try {
      const prompt = buildBulkRefineUser(batch);
      decisions = await callClaudeJSON<BulkRefineResponse[]>(prompt, undefined, { system });
      apiCalls++;
    } catch (e) {
      process.stderr.write(
        `  Bulk refine failed, falling back to single-chunk: ${e instanceof ClaudeCliError ? e.message : String(e)}\n`,
      );
      // On bulk failure, keep chunks as-is rather than calling single-chunk API
      allRefined.push(...batch);
      apiCalls++;
      continue;
    }

    const { refined, splits, merges } = applyDecisions(batch, decisions);
    totalSplits += splits;
    totalMerges += merges;

    // Check if last decision is merge_next — defer it for the next batch
    const lastDecision = decisions.find(
      (d) => d.section === batch[batch.length - 1].sectionNumber,
    );
    if (
      lastDecision?.action === "merge_next" &&
      b < batches.length - 1 &&
      refined.length > 0
    ) {
      deferredMergeChunk = refined.pop()!;
    }

    allRefined.push(...refined);
  }

  // If there's a deferred chunk with no next batch, just add it
  if (deferredMergeChunk) {
    allRefined.push(deferredMergeChunk);
  }

  // Safety net: split any chunk that still exceeds MAX_READING_TIME_SECONDS
  const capped: Chunk[] = [];
  for (const chunk of allRefined) {
    const pieces = splitOversizedChunk(chunk);
    if (pieces.length > 1) {
      totalSplits++;
      process.stderr.write(
        `  LENGTH-SPLIT section ${chunk.sectionNumber} into ${pieces.length} chunks (exceeded ${MAX_READING_TIME_SECONDS}s cap)\n`,
      );
    }
    capped.push(...pieces);
  }

  return {
    originalCount: chunks.length,
    refinedCount: capped.length,
    splits: totalSplits,
    merges: totalMerges,
    chunks: capped,
    apiCalls,
  };
}

// ---------------------------------------------------------------------------
// Batch refine via Anthropic Batch API
// ---------------------------------------------------------------------------

export interface BatchRefineInput {
  bookSlug: string;
  chapterSlug: string;
  chunks: Chunk[];
  config: BookConfig;
}

/**
 * Batch refine: submits all refine evaluations across all books as a single
 * Batch API request. Each request is one bulk evaluation (~10 chunks).
 * Returns results keyed by "{bookSlug}_{chapterSlug}".
 * Failed requests fall back to real-time refineChunks() per chapter.
 */
export async function refineChunksBatch(
  inputs: BatchRefineInput[],
): Promise<Map<string, RefineResult>> {
  // 1. Build batch requests — one per bulk evaluation group
  const requests: BatchRequest[] = [];
  const meta = new Map<
    string,
    { bookSlug: string; chapterSlug: string; batch: Chunk[]; batchIndex: number; config: BookConfig }
  >();

  for (const { bookSlug, chapterSlug, chunks, config } of inputs) {
    const system = buildBulkRefineSystem(config);
    const batches: Chunk[][] = [];
    for (let i = 0; i < chunks.length; i += REFINE_BATCH_SIZE) {
      batches.push(chunks.slice(i, i + REFINE_BATCH_SIZE));
    }

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b];
      const customId = safeCustomId("refine", bookSlug, chapterSlug, b);
      const prompt = buildBulkRefineUser(batch);
      requests.push({
        custom_id: customId,
        system,
        messages: [{ role: "user", content: prompt }],
      });
      meta.set(customId, { bookSlug, chapterSlug, batch, batchIndex: b, config });
    }
  }

  if (requests.length === 0) return new Map();

  process.stderr.write(
    `[batch-refine] Submitting ${requests.length} refine requests...\n`,
  );

  // 2. Submit batch
  const batch = await createMessageBatch(requests);
  process.stderr.write(`[batch-refine] Created batch ${batch.id}\n`);

  // 3. Poll until done
  await pollBatchUntilDone(batch.id);

  // 4. Collect results — group decisions by chapter
  // Key: "{bookSlug}_{chapterSlug}", value: array of { batchIndex, decisions }
  const chapterDecisions = new Map<
    string,
    { batchIndex: number; decisions: BulkRefineResponse[]; batch: Chunk[] }[]
  >();
  const failedChapters = new Set<string>();
  batchStats.totalRequests += requests.length;

  for await (const item of streamBatchResults(batch.id)) {
    const info = meta.get(item.custom_id);
    if (!info) {
      process.stderr.write(
        `[batch-refine] WARNING: unknown custom_id ${item.custom_id}\n`,
      );
      continue;
    }

    const chapterKey = `${info.bookSlug}_${info.chapterSlug}`;

    if (item.result.type === "errored") {
      batchStats.failed++;
      failedChapters.add(chapterKey);
      process.stderr.write(
        `[batch-refine] WARNING: request ${item.custom_id} failed: ${JSON.stringify(item.result.error)}\n`,
      );
      continue;
    }

    const message = item.result.message;
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      batchStats.failed++;
      failedChapters.add(chapterKey);
      process.stderr.write(
        `[batch-refine] WARNING: no text content for ${item.custom_id}\n`,
      );
      continue;
    }

    // Accumulate token usage
    tokenUsage.inputTokens += message.usage.input_tokens;
    tokenUsage.outputTokens += message.usage.output_tokens;
    tokenUsage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    tokenUsage.cacheCreationTokens +=
      message.usage.cache_creation_input_tokens ?? 0;

    let decisions: BulkRefineResponse[];
    try {
      decisions = JSON.parse(extractJSON(textBlock.text)) as BulkRefineResponse[];
    } catch {
      batchStats.failed++;
      failedChapters.add(chapterKey);
      process.stderr.write(
        `[batch-refine] WARNING: failed to parse JSON for ${item.custom_id}\n`,
      );
      continue;
    }

    batchStats.succeeded++;
    const existing = chapterDecisions.get(chapterKey) ?? [];
    existing.push({ batchIndex: info.batchIndex, decisions, batch: info.batch });
    chapterDecisions.set(chapterKey, existing);
  }

  // 5. Apply decisions per chapter, handling cross-batch merges
  const resultMap = new Map<string, RefineResult>();

  for (const { bookSlug, chapterSlug, chunks, config } of inputs) {
    const chapterKey = `${bookSlug}_${chapterSlug}`;

    // If any batch for this chapter failed, fall back to real-time refine
    if (failedChapters.has(chapterKey)) {
      process.stderr.write(
        `[batch-refine] Falling back to real-time refine for ${chapterKey}\n`,
      );
      const result = await refineChunksRealtime(chunks, config);
      resultMap.set(chapterKey, result);
      continue;
    }

    const batchEntries = chapterDecisions.get(chapterKey);
    if (!batchEntries) {
      // No results at all — fall back
      process.stderr.write(
        `[batch-refine] No results for ${chapterKey}, falling back to real-time\n`,
      );
      const result = await refineChunksRealtime(chunks, config);
      resultMap.set(chapterKey, result);
      continue;
    }

    // Sort by batch index to process in order
    batchEntries.sort((a, b) => a.batchIndex - b.batchIndex);

    let allRefined: Chunk[] = [];
    let totalSplits = 0;
    let totalMerges = 0;
    let deferredMergeChunk: Chunk | null = null;

    for (let i = 0; i < batchEntries.length; i++) {
      let { batch: batchChunks, decisions } = batchEntries[i];

      // Handle deferred merge from previous batch
      if (deferredMergeChunk) {
        const first = batchChunks[0];
        const mergedSectionNumber = deferredMergeChunk.sectionNumber;
        batchChunks = [
          {
            sectionNumber: mergedSectionNumber,
            text: deferredMergeChunk.text + "\n\n" + first.text,
          },
          ...batchChunks.slice(1),
        ];
        // Remap decision keyed on original first section to the merged section number
        const firstDecisionIdx = decisions.findIndex(d => d.section === first.sectionNumber);
        if (firstDecisionIdx !== -1) {
          decisions = decisions.map((d, idx) =>
            idx === firstDecisionIdx ? { ...d, section: mergedSectionNumber } : d,
          );
        }
        deferredMergeChunk = null;
        totalMerges++;
        process.stderr.write(
          `  MERGE (cross-batch) section ${mergedSectionNumber} with next batch\n`,
        );
      }

      const { refined, splits, merges } = applyDecisions(batchChunks, decisions);
      totalSplits += splits;
      totalMerges += merges;

      // Check if last decision is merge_next — defer for next batch
      const lastDecision = decisions.find(
        (d) => d.section === batchChunks[batchChunks.length - 1].sectionNumber,
      );
      if (
        lastDecision?.action === "merge_next" &&
        i < batchEntries.length - 1 &&
        refined.length > 0
      ) {
        deferredMergeChunk = refined.pop()!;
      }

      allRefined.push(...refined);
    }

    if (deferredMergeChunk) {
      allRefined.push(deferredMergeChunk);
    }

    // Safety net: split oversized chunks
    const capped: Chunk[] = [];
    for (const chunk of allRefined) {
      const pieces = splitOversizedChunk(chunk);
      if (pieces.length > 1) {
        totalSplits++;
        process.stderr.write(
          `  LENGTH-SPLIT section ${chunk.sectionNumber} into ${pieces.length} chunks (exceeded ${MAX_READING_TIME_SECONDS}s cap)\n`,
        );
      }
      capped.push(...pieces);
    }

    resultMap.set(chapterKey, {
      originalCount: chunks.length,
      refinedCount: capped.length,
      splits: totalSplits,
      merges: totalMerges,
      chunks: capped,
      apiCalls: batchEntries.length,
    });
  }

  return resultMap;
}
