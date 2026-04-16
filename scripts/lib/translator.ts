import {
  callClaudeJSON,
  createMessageBatch,
  pollBatchUntilDone,
  streamBatchResults,
  extractJSON,
  tokenUsage,
  batchStats,
  safeCustomId,
  type BatchRequest,
  type CallClaudeOptions,
} from "./claude.js";
import { VALID_TAG_SLUGS, type BookConfig, type TagSlug } from "./constants.js";
import type { Chunk } from "./chunker.js";
import { buildTranslationSystem, buildTranslationUser } from "./prompt.js";

export interface MeaningCheck {
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  verification_notes?: string;
}

export interface TranslatedChunk {
  sectionNumber: number;
  originalText: string;
  plainEnglish: string;
  tags: TagSlug[];
  meaningCheck?: MeaningCheck;
}

interface TranslationResponse {
  plain_english: string;
  tags: string[];
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  verification_notes?: string | null;
}

function validateTags(tags: string[] | undefined | null): TagSlug[] {
  if (!Array.isArray(tags)) return [];
  return tags.filter((t): t is TagSlug =>
    VALID_TAG_SLUGS.includes(t as TagSlug),
  );
}

// ---------------------------------------------------------------------------
// Batch translation (sole entry point)
// ---------------------------------------------------------------------------

export interface BatchTranslateInput {
  bookSlug: string;
  chapterSlug: string;
  chunks: Chunk[];
  config: BookConfig;
}

export async function translateChunksBatch(
  inputs: BatchTranslateInput[],
): Promise<Map<string, TranslatedChunk[]>> {
  // Guard against duplicate inputs (would cause custom_id collisions)
  const seen = new Set<string>();
  for (const { bookSlug, chapterSlug } of inputs) {
    const key = `${bookSlug}_${chapterSlug}`;
    if (seen.has(key)) throw new Error(`Duplicate batch input for ${key}`);
    seen.add(key);
  }

  // 1. Build batch requests
  const requests: BatchRequest[] = [];
  // Track metadata by custom_id for result correlation
  const meta = new Map<
    string,
    { bookSlug: string; chapterSlug: string; chunk: Chunk }
  >();

  for (const { bookSlug, chapterSlug, chunks, config } of inputs) {
    const system = buildTranslationSystem(config);
    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const customId = safeCustomId(bookSlug, chapterSlug, index);
      requests.push({
        custom_id: customId,
        system,
        messages: [{ role: "user", content: buildTranslationUser(chunk) }],
      });
      meta.set(customId, { bookSlug, chapterSlug, chunk });
    }
  }

  if (requests.length === 0) return new Map();

  process.stderr.write(
    `[batch] Submitting ${requests.length} translation requests...\n`,
  );

  // 2. Submit batch
  const batch = await createMessageBatch(requests);
  process.stderr.write(`[batch] Created batch ${batch.id}\n`);

  // 3. Poll until done
  await pollBatchUntilDone(batch.id);

  // 4. Collect and correlate results
  const resultMap = new Map<string, TranslatedChunk[]>();
  const failedIds: string[] = [];
  batchStats.totalRequests += requests.length;

  for await (const item of streamBatchResults(batch.id)) {
    const info = meta.get(item.custom_id);
    if (!info) {
      process.stderr.write(
        `[batch] WARNING: unknown custom_id ${item.custom_id}\n`,
      );
      continue;
    }

    if (item.result.type === "errored") {
      batchStats.failed++;
      failedIds.push(item.custom_id);
      process.stderr.write(
        `[batch] WARNING: request ${item.custom_id} failed: ${JSON.stringify(item.result.error)}\n`,
      );
      continue;
    }

    // Extract text from succeeded message
    const message = item.result.message;
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      batchStats.failed++;
      failedIds.push(item.custom_id);
      process.stderr.write(
        `[batch] WARNING: no text content in result for ${item.custom_id}\n`,
      );
      continue;
    }

    // Accumulate token usage
    tokenUsage.inputTokens += message.usage.input_tokens;
    tokenUsage.outputTokens += message.usage.output_tokens;
    tokenUsage.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    tokenUsage.cacheCreationTokens +=
      message.usage.cache_creation_input_tokens ?? 0;

    // Parse JSON response
    let result: TranslationResponse;
    try {
      result = JSON.parse(extractJSON(textBlock.text)) as TranslationResponse;
    } catch {
      batchStats.failed++;
      failedIds.push(item.custom_id);
      process.stderr.write(
        `[batch] WARNING: failed to parse JSON for ${item.custom_id}\n`,
      );
      continue;
    }

    // Validate required fields — LLM occasionally omits them
    if (!result.plain_english) {
      batchStats.failed++;
      failedIds.push(item.custom_id);
      process.stderr.write(
        `[batch] WARNING: missing plain_english for ${item.custom_id} — will retry\n`,
      );
      continue;
    }

    // Check for mid-sentence translation (text doesn't end with sentence punctuation)
    const trimmedTranslation = result.plain_english.trim();
    if (trimmedTranslation.length >= 30 && !/[.?!;:'""\u201D)\]]$/.test(trimmedTranslation)) {
      batchStats.failed++;
      failedIds.push(item.custom_id);
      process.stderr.write(
        `[batch] WARNING: plain_english ends mid-sentence for ${item.custom_id} — will retry\n`,
      );
      continue;
    }

    batchStats.succeeded++;
    addTranslatedResult(resultMap, item.custom_id, result, info);
  }

  // 5. Retry failed chunks via real-time API
  if (failedIds.length > 0) {
    process.stderr.write(
      `[batch] Retrying ${failedIds.length} failed chunks via real-time API...\n`,
    );
    for (const customId of failedIds) {
      const info = meta.get(customId)!;
      const input = inputs.find(
        (i) => i.bookSlug === info.bookSlug && i.chapterSlug === info.chapterSlug,
      );
      if (!input) continue;

      const system = buildTranslationSystem(input.config);
      const prompt = buildTranslationUser(info.chunk);
      try {
        const result = await callClaudeJSON<TranslationResponse>(
          prompt, undefined, { system } as CallClaudeOptions,
        );
        batchStats.succeeded++;
        batchStats.failed = Math.max(0, batchStats.failed - 1);
        addTranslatedResult(resultMap, customId, result, info);
        process.stderr.write(`[batch] Retry succeeded for ${customId}\n`);
      } catch (e) {
        process.stderr.write(
          `[batch] Retry also failed for ${customId}: ${e instanceof Error ? e.message : String(e)}\n`,
        );
      }
    }
  }

  // Sort each chapter's chunks by sectionNumber to restore original order
  for (const [, chunks] of resultMap) {
    chunks.sort((a, b) => a.sectionNumber - b.sectionNumber);
  }

  return resultMap;
}

/** Helper: process a translation response and add to the result map. */
function addTranslatedResult(
  resultMap: Map<string, TranslatedChunk[]>,
  customId: string,
  result: TranslationResponse,
  info: { bookSlug: string; chapterSlug: string; chunk: Chunk },
): void {
  let validTags = validateTags(result.tags);
  if (validTags.length === 0) validTags = ["what-matters-most"];
  if (validTags.length > 3) validTags = validTags.slice(0, 3);

  const meaningCheck: MeaningCheck = {
    faithful: result.faithful,
    tone_preserved: result.tone_preserved,
    ideas_changed: result.ideas_changed,
    over_explains: result.over_explains,
    verification_notes: result.verification_notes ?? undefined,
  };

  if (!meaningCheck.faithful) {
    process.stderr.write(
      `  WARNING: Meaning not preserved (${customId}). ${meaningCheck.verification_notes ?? ""}\n`,
    );
  }
  if (!meaningCheck.tone_preserved) {
    process.stderr.write(
      `  WARNING: Tone drift (${customId}). ${meaningCheck.verification_notes ?? ""}\n`,
    );
  }
  if (meaningCheck.ideas_changed) {
    process.stderr.write(
      `  WARNING: Ideas changed (${customId}). ${meaningCheck.verification_notes ?? ""}\n`,
    );
  }
  if (meaningCheck.over_explains) {
    process.stderr.write(
      `  INFO: Over-explains (${customId}). ${meaningCheck.verification_notes ?? ""}\n`,
    );
  }

  const translated: TranslatedChunk = {
    sectionNumber: info.chunk.sectionNumber,
    originalText: info.chunk.text,
    plainEnglish: result.plain_english,
    tags: validTags,
    meaningCheck,
  };

  const key = `${info.bookSlug}_${info.chapterSlug}`;
  const existing = resultMap.get(key) ?? [];
  existing.push(translated);
  resultMap.set(key, existing);
}
