/**
 * Recovery script: re-downloads results from an existing completed batch,
 * loads refine results from cache (or re-refines if uncached), retries only
 * failed chunks, saves translate cache, and assembles the final content.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... PLAIN_USE_API=1 npx tsx scripts/recover-batch.ts --batch-id <id>
 */

import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_TAG_SLUGS, type BookConfig, type TagSlug } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { refineChunks } from "./lib/refine.js";
import { type TranslatedChunk } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import {
  streamBatchResults,
  callClaudeJSON,
  extractJSON,
  tokenUsage,
  type CallClaudeOptions,
} from "./lib/claude.js";
import { buildTranslationSystem, buildTranslationUser } from "./lib/prompt.js";
import {
  hashSourceFile,
  loadRefineCache,
  saveRefineCache,
  saveTranslateCache,
} from "./lib/cache.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    "batch-id": { type: "string" },
    output: { type: "string", default: "content" },
    help: { type: "boolean", default: false },
  },
});

if (args.help || !args["batch-id"]) {
  console.log(`Usage: PLAIN_USE_API=1 npx tsx scripts/recover-batch.ts --batch-id <id>

Recovers a partially-failed batch run:
  1. Loads refine results from cache (or re-refines if uncached)
  2. Downloads existing batch results (free)
  3. Retries only failed chunks via real-time API
  4. Saves translate cache and assembles final content JSON

Options:
  --batch-id <id>   The batch ID to recover (e.g. msgbatch_018hAMMD...)
  --output <dir>    Output directory (default: content)
  --help            Show this help`);
  process.exit(args.help ? 0 : 1);
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ParsedChapter {
  slug: string;
  title: string;
  bookNumber?: number;
  chunks: Chunk[];
}

interface ParsedOutput {
  bookSlug: string;
  chapters: ParsedChapter[];
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

function validateTags(tags: string[] | undefined): TagSlug[] {
  if (!tags) return [];
  return tags.filter((t): t is TagSlug =>
    VALID_TAG_SLUGS.includes(t as TagSlug),
  );
}

// ---------------------------------------------------------------------------
// Parse + Refine with cache
// ---------------------------------------------------------------------------

async function runParse(config: BookConfig): Promise<ParsedOutput> {
  console.log(`\nParsing ${config.slug}...`);
  const text = await readFile(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  const chapters = parsed.chapters.map((ch) => {
    const chunks = chunkSections(ch.sections, config.speakerLabels);
    console.log(`  ${ch.slug}: ${chunks.length} chunks`);
    return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks };
  });

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total: ${totalChunks} chunks across ${chapters.length} chapters`);
  return { bookSlug: config.slug, chapters };
}

async function getRefineResult(config: BookConfig): Promise<ParsedOutput> {
  const sourceHash = await hashSourceFile(config.source_file);

  // Try cache first
  const cached = await loadRefineCache(config.slug, sourceHash);
  if (cached) {
    const totalChunks = cached.reduce((sum, ch) => sum + ch.chunks.length, 0);
    console.log(`\nRefine ${config.slug}: loaded from cache (${totalChunks} chunks across ${cached.length} chapters)`);
    return { bookSlug: config.slug, chapters: cached };
  }

  // Cache miss — must re-refine
  console.log(`\nRefine ${config.slug}: cache miss, re-refining...`);
  const parsed = await runParse(config);
  const chapters: ParsedChapter[] = [];
  let apiCallsUsed = 0;

  for (const ch of parsed.chapters) {
    console.log(`  ${ch.slug}:`);
    const result = await refineChunks(ch.chunks, config);
    apiCallsUsed += result.apiCalls ?? 1;

    if (result.splits > 0 || result.merges > 0) {
      console.log(`    ${result.originalCount} → ${result.refinedCount} chunks (${result.splits} splits, ${result.merges} merges)`);
    } else {
      console.log(`    ${result.refinedCount} chunks (no changes)`);
    }

    chapters.push({ slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks: result.chunks });
  }

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total after refine: ${totalChunks} chunks (${apiCallsUsed} API calls)`);

  // Save to cache
  await saveRefineCache(config.slug, sourceHash, chapters);
  console.log(`  Cached refine results for ${config.slug}`);

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Main recovery flow
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const batchId = args["batch-id"]!;

  // Phase 1: get refine results (from cache or re-refine)
  console.log("=== Phase 1: Load Refine Results ===");
  const refined = await Promise.all(
    BOOK_CONFIGS.map(async (config) => {
      const ref = await getRefineResult(config);
      return { config, refined: ref };
    }),
  );

  // Build metadata map (same as translateChunksBatch)
  const meta = new Map<string, { bookSlug: string; chapterSlug: string; chunk: Chunk; config: BookConfig }>();
  for (const { config, refined: r } of refined) {
    for (const ch of r.chapters) {
      for (let index = 0; index < ch.chunks.length; index++) {
        const customId = `${config.slug}_${ch.slug}_${index}`;
        meta.set(customId, { bookSlug: config.slug, chapterSlug: ch.slug, chunk: ch.chunks[index], config });
      }
    }
  }

  const totalChunks = meta.size;
  console.log(`\n=== Phase 2: Download batch ${batchId} results (${totalChunks} expected) ===`);

  // Phase 2: download existing batch results
  const batchResults = new Map<string, TranslationResponse>();
  const failedIds: string[] = [];
  let batchSucceeded = 0;
  let batchErrored = 0;

  for await (const item of streamBatchResults(batchId)) {
    if (item.result.type === "errored") {
      failedIds.push(item.custom_id);
      batchErrored++;
      continue;
    }

    const message = item.result.message;
    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      failedIds.push(item.custom_id);
      batchErrored++;
      continue;
    }

    let result: TranslationResponse;
    try {
      result = JSON.parse(extractJSON(textBlock.text)) as TranslationResponse;
    } catch {
      failedIds.push(item.custom_id);
      batchErrored++;
      continue;
    }

    batchResults.set(item.custom_id, result);
    batchSucceeded++;
  }

  console.log(`  Downloaded: ${batchSucceeded} succeeded, ${batchErrored} failed/errored`);

  // Correlate batch results with refine output
  const resultMap = new Map<string, TranslatedChunk[]>();
  let matched = 0;
  let unmatched = 0;

  for (const [customId, result] of batchResults) {
    const info = meta.get(customId);
    if (!info) {
      unmatched++;
      continue;
    }

    let validTags = validateTags(result.tags);
    if (validTags.length === 0) validTags = ["what-matters-most"];
    if (validTags.length > 3) validTags = validTags.slice(0, 3);

    const translated: TranslatedChunk = {
      sectionNumber: info.chunk.sectionNumber,
      originalText: info.chunk.text,
      plainEnglish: result.plain_english,
      tags: validTags,
      meaningCheck: {
        faithful: result.faithful,
        tone_preserved: result.tone_preserved,
        ideas_changed: result.ideas_changed,
        over_explains: result.over_explains,
        verification_notes: result.verification_notes ?? undefined,
      },
    };

    const key = `${info.bookSlug}_${info.chapterSlug}`;
    const existing = resultMap.get(key) ?? [];
    existing.push(translated);
    resultMap.set(key, existing);
    matched++;
  }

  if (unmatched > 0) {
    console.log(`  WARNING: ${unmatched} batch results didn't match refine output (chunk splits may differ)`);
  }
  console.log(`  Matched ${matched} translations to current chunks`);

  // Find chunks that need retrying
  const coveredIds = new Set<string>();
  for (const [customId] of batchResults) {
    if (meta.has(customId)) coveredIds.add(customId);
  }
  for (const id of failedIds) coveredIds.add(id);

  const retryIds: string[] = [];
  for (const customId of meta.keys()) {
    if (!coveredIds.has(customId)) {
      retryIds.push(customId);
    }
  }
  for (const id of failedIds) {
    if (meta.has(id)) retryIds.push(id);
  }

  if (retryIds.length > 0) {
    console.log(`\n=== Phase 3: Retry ${retryIds.length} failed/missing chunks via real-time API ===`);
    for (const customId of retryIds) {
      const info = meta.get(customId);
      if (!info) {
        console.log(`  Skipping ${customId} (no metadata)`);
        continue;
      }

      const system = buildTranslationSystem(info.config);
      const prompt = buildTranslationUser(info.chunk);
      try {
        const result = await callClaudeJSON<TranslationResponse>(
          prompt, undefined, { system } as CallClaudeOptions,
        );

        let validTags = validateTags(result.tags);
        if (validTags.length === 0) validTags = ["what-matters-most"];
        if (validTags.length > 3) validTags = validTags.slice(0, 3);

        const translated: TranslatedChunk = {
          sectionNumber: info.chunk.sectionNumber,
          originalText: info.chunk.text,
          plainEnglish: result.plain_english,
          tags: validTags,
          meaningCheck: {
            faithful: result.faithful,
            tone_preserved: result.tone_preserved,
            ideas_changed: result.ideas_changed,
            over_explains: result.over_explains,
            verification_notes: result.verification_notes ?? undefined,
          },
        };

        const key = `${info.bookSlug}_${info.chapterSlug}`;
        const existing = resultMap.get(key) ?? [];
        existing.push(translated);
        resultMap.set(key, existing);
        console.log(`  Retry succeeded: ${customId}`);
      } catch (e) {
        console.error(`  Retry failed: ${customId}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } else {
    console.log("\n=== Phase 3: No retries needed ===");
  }

  // Sort each chapter's chunks by sectionNumber
  for (const [, chunks] of resultMap) {
    chunks.sort((a, b) => a.sectionNumber - b.sectionNumber);
  }

  // Save translate cache per book
  for (const { config } of refined) {
    const sourceHash = await hashSourceFile(config.source_file);
    const bookTranslations = new Map<string, TranslatedChunk[]>();
    for (const [key, chunks] of resultMap) {
      if (key.startsWith(`${config.slug}_`)) {
        bookTranslations.set(key, chunks);
      }
    }
    if (bookTranslations.size > 0) {
      await saveTranslateCache(config.slug, sourceHash, bookTranslations);
      console.log(`  Cached translate results for ${config.slug}`);
    }
  }

  // Phase 4: assemble
  console.log("\n=== Phase 4: Assemble ===");
  for (const { config, refined: r } of refined) {
    console.log(`\nAssembling ${config.slug}...`);

    const chapters = r.chapters.map((ch) => {
      const key = `${config.slug}_${ch.slug}`;
      const translated = resultMap.get(key);
      if (!translated || translated.length === 0) {
        throw new Error(`No translated chunks for ${key} — aborting to prevent data loss`);
      }
      return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, translated };
    });

    let meaningWarnings = 0;
    for (const ch of chapters) {
      for (const t of ch.translated) {
        if (t.meaningCheck && (!t.meaningCheck.faithful || !t.meaningCheck.tone_preserved || t.meaningCheck.ideas_changed)) {
          meaningWarnings++;
        }
      }
    }
    if (meaningWarnings > 0) {
      console.log(`  ${config.slug}: ${meaningWarnings} sections had meaning preservation warnings`);
    }

    const chapterChunks: ChapterChunks[] = chapters.map((ch) => ({
      chapterSlug: ch.slug,
      chapterTitle: ch.title,
      bookNumber: ch.bookNumber,
      chunks: ch.translated,
    }));

    const { meta: bookMeta, chapters: bookChapters } = assembleBook(chapterChunks, config);
    await writeContentFiles(bookMeta, bookChapters, args.output!);
  }

  // Cost report
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = tokenUsage;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (totalTokens > 0) {
    const inputCost = (inputTokens / 1_000_000) * 3;
    const outputCost = (outputTokens / 1_000_000) * 15;
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * 3.75;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * 0.3;
    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    process.stderr.write("\n--- Cost Report (recovery run) ---\n");
    process.stderr.write(`  Batch results reused:  ${matched}\n`);
    process.stderr.write(`  Chunks retried:        ${retryIds.length}\n`);
    process.stderr.write(`  Input tokens:          ${inputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Output tokens:         ${outputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Estimated cost:        $${totalCost.toFixed(4)}\n`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Recovery failed:", e);
  process.exit(1);
});
