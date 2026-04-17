import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { refineChunksBatch, refineChunksRealtime, type BatchRefineInput } from "./lib/refine.js";
import { translateChunksBatch, type TranslatedChunk, type BatchTranslateInput } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import { validateSectionCoverage, validateRefineCoverage, validateParseContent } from "./lib/validate.js";
import { tokenUsage, batchStats } from "./lib/claude.js";
import { logger } from "./lib/logger.js";
import {
  saveParseCache,
  loadParseCache,
  saveRefineCache,
  loadRefineCache,
  saveTranslateCache,
  loadTranslateCache,
  mergeTranslateCache,
  diffChunksForTranslation,
  snapshotTokenUsage,
  computePhaseCost,
} from "./lib/cache.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const VALID_PHASES = ["parse", "refine", "translate", "assemble"] as const;
type Phase = (typeof VALID_PHASES)[number];

const { values: args } = parseArgs({
  options: {
    book: { type: "string" },
    phase: { type: "string" },
    output: { type: "string", default: "content/output" },
    verbose: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate.ts --book <slug> [options]

Options:
  --book <slug>      Book to generate (${VALID_BOOK_SLUGS.join(", ")})
  --phase <phase>    Run a single phase: ${VALID_PHASES.join(", ")}
  --output <dir>     Output directory (default: content/output)
  --verbose          Print all log messages to stderr (log file always written)
  --help             Show this help

Environment:
  ANTHROPIC_API_KEY   Required for refine and translate phases

Pipeline: parse → refine → translate → assemble

When --phase is omitted, runs all four phases end-to-end.
When --phase is specified, runs only that phase using persisted intermediates.

Logs are written to content/pipeline/<slug>/pipeline.log on every run.`);
  process.exit(0);
}

if (!args.book) {
  console.error("Specify --book <slug>");
  process.exit(1);
}

if (args.phase && !VALID_PHASES.includes(args.phase as Phase)) {
  console.error(`Invalid phase "${args.phase}". Valid: ${VALID_PHASES.join(", ")}`);
  process.exit(1);
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

interface TranslatedOutput {
  bookSlug: string;
  chapters: {
    slug: string;
    title: string;
    bookNumber?: number;
    translated: TranslatedChunk[];
  }[];
}

// ---------------------------------------------------------------------------
// Phase: Parse — split source text into sections and chunks
// ---------------------------------------------------------------------------

async function runParse(config: BookConfig): Promise<ParsedOutput> {
  console.log(`\nParsing ${config.slug}...`);

  const text = await readFile(config.source_file, "utf-8");
  logger.info(`parse: loaded ${config.source_file} (${text.length} chars)`);
  const parsed = parseSourceText(text, config);
  const totalSections = parsed.chapters.reduce((s, ch) => s + ch.sections.length, 0);
  logger.info(`parse: ${parsed.chapters.length} chapters, ${totalSections} sections`);

  // Validate parsed content before chunking (catches source artifacts
  // like inter-book preamble before we spend money on refine/translate).
  const parseContentErrors: string[] = [];
  for (const ch of parsed.chapters) {
    const msgs = validateParseContent(ch.sections, ch.slug);
    for (const m of msgs) {
      if (m.severity === "error") {
        parseContentErrors.push(m.message);
      }
    }
  }
  if (parseContentErrors.length > 0) {
    for (const e of parseContentErrors) logger.error(`parse: content error — ${e}`);
    console.error(`\nParse content errors in ${config.slug}:`);
    for (const e of parseContentErrors) console.error(`  ${e}`);
    throw new Error(`${config.slug}: ${parseContentErrors.length} parse content error(s)`);
  }
  logger.info("parse: content validation passed");

  const coverageErrors: string[] = [];

  const chapters = parsed.chapters.map((ch) => {
    const chunks = chunkSections(ch.sections, config.speakerLabels);
    logger.info(`parse: ${ch.slug} — ${ch.sections.length} sections → ${chunks.length} chunks`);
    console.log(`  ${ch.slug}: ${chunks.length} chunks`);

    // Verify no sections were dropped during parse → chunk
    const msgs = validateSectionCoverage(ch.sections, chunks);
    for (const m of msgs) {
      if (m.severity === "error") {
        coverageErrors.push(`${ch.slug}: ${m.message}`);
      }
    }

    return {
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      chunks,
    };
  });

  if (coverageErrors.length > 0) {
    for (const e of coverageErrors) logger.error(`parse: coverage error — ${e}`);
    console.error(`\nSection coverage errors in ${config.slug}:`);
    for (const e of coverageErrors) console.error(`  ${e}`);
    throw new Error(`${config.slug}: ${coverageErrors.length} section coverage error(s)`);
  }
  logger.info("parse: section coverage validation passed");

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total: ${totalChunks} chunks across ${chapters.length} chapters`);

  // Save parse intermediate
  await saveParseCache(config.slug, parsed.chapters);
  console.log(`  Cached parse results for ${config.slug}`);

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Phase: Refine — batch refine all chunks
// ---------------------------------------------------------------------------

async function runRefine(configs: BookConfig[]): Promise<{ config: BookConfig; refined: ParsedOutput }[]> {
  const refined: { config: BookConfig; refined: ParsedOutput }[] = [];
  const uncached: { config: BookConfig; parsed: ParsedOutput }[] = [];

  // Check cache first
  for (const config of configs) {
    const cached = await loadRefineCache(config.slug);
    if (cached) {
      const totalChunks = cached.reduce((sum, ch) => sum + ch.chunks.length, 0);
      console.log(`\nRefining ${config.slug}... (cached: ${totalChunks} chunks across ${cached.length} chapters)`);
      refined.push({ config, refined: { bookSlug: config.slug, chapters: cached } });
      continue;
    }

    // Load parse intermediate and chunk sections for refine
    const parseCached = await loadParseCache(config.slug);
    if (!parseCached) {
      throw new Error(`No parse cache for ${config.slug} — run --phase parse first`);
    }

    const chapters = parseCached.map((ch) => ({
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      chunks: chunkSections(ch.sections, config.speakerLabels),
    }));
    uncached.push({ config, parsed: { bookSlug: config.slug, chapters } });
  }

  if (uncached.length > 0) {
    const refineInputs: BatchRefineInput[] = [];
    for (const { config, parsed: p } of uncached) {
      for (const ch of p.chapters) {
        refineInputs.push({
          bookSlug: config.slug,
          chapterSlug: ch.slug,
          chunks: ch.chunks,
          config,
        });
      }
    }

    const before = snapshotTokenUsage(tokenUsage);
    console.log(`\nBatch refining ${refineInputs.reduce((s, i) => s + i.chunks.length, 0)} chunks across ${uncached.length} books...`);
    const refineResultMap = await refineChunksBatch(refineInputs);
    const after = snapshotTokenUsage(tokenUsage);
    const cost = computePhaseCost(before, after);

    const MAX_REFINE_RETRIES = 2;
    const validationErrors: string[] = [];
    for (const { config, parsed: p } of uncached) {
      const chapters: ParsedChapter[] = [];

      for (const ch of p.chapters) {
        const key = `${config.slug}_${ch.slug}`;
        let result = refineResultMap.get(key);
        if (!result) {
          chapters.push({ slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks: ch.chunks });
          continue;
        }

        if (result.splits > 0 || result.merges > 0) {
          console.log(`  ${config.slug}/${ch.slug}: ${result.originalCount} → ${result.refinedCount} chunks (${result.splits} splits, ${result.merges} merges)`);
        }

        // Validate and retry only the failing batches (not the entire chapter)
        let refineMsgs = validateRefineCoverage(ch.chunks, result.chunks);
        let refineErrors = refineMsgs.filter((m) => m.severity === "error");
        let retries = 0;
        const BATCH_SIZE = parseInt(process.env.REFINE_BATCH_SIZE ?? "10", 10);

        while (refineErrors.length > 0 && retries < MAX_REFINE_RETRIES) {
          retries++;

          // Extract failing section numbers from error messages
          const failingSections = new Set<number>();
          for (const e of refineErrors) {
            const match = e.card_id?.match(/section-(\d+)/);
            if (match) failingSections.add(parseInt(match[1], 10));
          }

          // Determine which batch indices contain failing sections
          const failingBatchIndices = new Set<number>();
          for (let i = 0; i < ch.chunks.length; i++) {
            if (failingSections.has(ch.chunks[i].sectionNumber)) {
              failingBatchIndices.add(Math.floor(i / BATCH_SIZE));
            }
          }

          // Collect pre-refine chunks for failing batches
          const retryChunks: Chunk[] = [];
          const retrySections = new Set<number>();
          for (const batchIdx of failingBatchIndices) {
            const start = batchIdx * BATCH_SIZE;
            const end = Math.min(start + BATCH_SIZE, ch.chunks.length);
            for (let i = start; i < end; i++) {
              retryChunks.push(ch.chunks[i]);
              retrySections.add(ch.chunks[i].sectionNumber);
            }
          }

          logger.warn(`refine: validation errors in ${config.slug}/${ch.slug} — retry ${retries}/${MAX_REFINE_RETRIES}, retrying ${retryChunks.length} sections (batches: ${[...failingBatchIndices].join(",")})`);
          for (const e of refineErrors) logger.error(`refine: ${e.message}`);
          console.error(`  Refine errors in ${config.slug}/${ch.slug} — retrying ${retryChunks.length}/${ch.chunks.length} sections (${retries}/${MAX_REFINE_RETRIES})...`);
          for (const e of refineErrors) console.error(`    ${e.message}`);

          const retryResult = await refineChunksRealtime(retryChunks, config);

          // Splice retried chunks back: remove old chunks for retried sections, insert new ones
          const kept = result.chunks.filter((c) => !retrySections.has(c.sectionNumber));
          const spliced = [...kept, ...retryResult.chunks].sort(
            (a, b) => a.sectionNumber - b.sectionNumber,
          );

          result = {
            ...result,
            chunks: spliced,
            refinedCount: spliced.length,
            splits: result.splits + retryResult.splits,
            merges: result.merges + retryResult.merges,
            apiCalls: result.apiCalls + retryResult.apiCalls,
          };

          if (retryResult.splits > 0 || retryResult.merges > 0) {
            console.log(`  ${config.slug}/${ch.slug} (retry ${retries}): retried ${retryChunks.length} sections → ${retryResult.chunks.length} chunks (${retryResult.splits} splits, ${retryResult.merges} merges)`);
          }

          refineMsgs = validateRefineCoverage(ch.chunks, result.chunks);
          refineErrors = refineMsgs.filter((m) => m.severity === "error");
        }

        if (refineErrors.length > 0) {
          logger.error(`refine: coverage errors persist in ${config.slug}/${ch.slug} after ${MAX_REFINE_RETRIES} retries`);
          for (const e of refineErrors) logger.error(`refine: ${e.message}`);
          console.error(`  Refine coverage errors in ${config.slug}/${ch.slug} (after ${MAX_REFINE_RETRIES} retries):`);
          for (const e of refineErrors) console.error(`    ${e.message}`);
          validationErrors.push(`${config.slug}/${ch.slug}: refine dropped content`);
        }

        chapters.push({ slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks: result.chunks });
      }

      const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
      console.log(`  ${config.slug}: ${totalChunks} chunks after refine`);

      // Only cache after all chapters pass validation
      if (!validationErrors.some((e) => e.startsWith(`${config.slug}/`))) {
        await saveRefineCache(config.slug, chapters, cost);
        console.log(`  Cached refine results for ${config.slug}`);
      } else {
        logger.error(`refine: skipping cache for ${config.slug} — has validation errors`);
        console.error(`  Skipping cache for ${config.slug} — has validation errors`);
      }

      refined.push({ config, refined: { bookSlug: config.slug, chapters } });
    }

    if (validationErrors.length > 0) {
      throw new Error(`Refine validation failed:\n  ${validationErrors.join("\n  ")}`);
    }
  }

  return refined;
}

// ---------------------------------------------------------------------------
// Phase: Translate — batch translate all refined chunks
// ---------------------------------------------------------------------------

async function runTranslate(
  refined: { config: BookConfig; refined: ParsedOutput }[],
): Promise<{ config: BookConfig; refined: ParsedOutput; translatedMap: Map<string, TranslatedChunk[]> }[]> {
  const translatedMap = new Map<string, TranslatedChunk[]>();
  const batchInputs: BatchTranslateInput[] = [];
  let cachedChunks = 0;
  let totalChunks = 0;

  for (const { config, refined: r } of refined) {
    const cached = await loadTranslateCache(config.slug);

    for (const ch of r.chapters) {
      const chapterKey = `${config.slug}_${ch.slug}`;
      const cachedChapter = cached?.get(chapterKey) ?? [];
      totalChunks += ch.chunks.length;

      const diff = diffChunksForTranslation(ch.chunks, cachedChapter);
      cachedChunks += diff.cached.length;

      // Store cached chunks in the result map
      if (diff.cached.length > 0) {
        translatedMap.set(chapterKey, [...diff.cached]);
      }

      // Queue uncached chunks for batch translation
      if (diff.uncached.length > 0) {
        batchInputs.push({
          bookSlug: config.slug,
          chapterSlug: ch.slug,
          chunks: diff.uncached.map(u => u.chunk),
          config,
          allChapterChunks: ch.chunks,
        });
      }
    }

    const bookUncached = batchInputs
      .filter(i => i.bookSlug === config.slug)
      .reduce((s, i) => s + i.chunks.length, 0);
    const bookTotal = r.chapters.reduce((s, ch) => s + ch.chunks.length, 0);
    console.log(`  ${config.slug}: ${bookTotal - bookUncached}/${bookTotal} chunks cached, translating ${bookUncached}`);
  }

  if (batchInputs.length > 0) {
    const uncachedCount = batchInputs.reduce((s, i) => s + i.chunks.length, 0);
    const before = snapshotTokenUsage(tokenUsage);
    console.log(`\nBatch translating ${uncachedCount} chunks across ${new Set(batchInputs.map(i => i.bookSlug)).size} books...`);
    const batchResults = await translateChunksBatch(batchInputs);
    const after = snapshotTokenUsage(tokenUsage);
    const cost = computePhaseCost(before, after);

    for (const [key, chunks] of batchResults) {
      const existing = translatedMap.get(key) ?? [];
      existing.push(...chunks);
      existing.sort((a, b) => a.sectionNumber - b.sectionNumber);
      translatedMap.set(key, existing);
    }

    // Merge new translations into cache for batch-translated books
    const batchedBooks = new Set(batchInputs.map(i => i.bookSlug));
    for (const { config } of refined) {
      if (!batchedBooks.has(config.slug)) continue;
      const bookNewTranslations = new Map<string, TranslatedChunk[]>();
      for (const [key, chunks] of batchResults) {
        if (key.startsWith(`${config.slug}_`)) {
          bookNewTranslations.set(key, chunks);
        }
      }
      if (bookNewTranslations.size > 0) {
        await mergeTranslateCache(config.slug, bookNewTranslations, cost);
        console.log(`  Merged translate results for ${config.slug}`);
      }
    }
  } else {
    console.log(`\nAll translations loaded from cache.`);
  }

  return refined.map(({ config, refined: r }) => ({ config, refined: r, translatedMap }));
}

// ---------------------------------------------------------------------------
// Phase: Assemble — write card JSON from translated chunks
// ---------------------------------------------------------------------------

async function runAssemble(
  config: BookConfig,
  translated: TranslatedOutput,
): Promise<void> {
  console.log(`\nAssembling ${config.slug}...`);

  const chapterChunks: ChapterChunks[] = translated.chapters.map((ch) => ({
    chapterSlug: ch.slug,
    chapterTitle: ch.title,
    bookNumber: ch.bookNumber,
    chunks: ch.translated,
  }));

  const { meta, chapters } = assembleBook(chapterChunks, config);
  await writeContentFiles(meta, chapters, args.output!);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const config = BOOK_CONFIGS.find((b) => b.slug === args.book);

  if (!config) {
    console.error(`Unknown book "${args.book}". Valid: ${VALID_BOOK_SLUGS.join(", ")}`);
    process.exit(1);
  }

  await logger.init(config.slug, !!args.verbose);

  const validConfigs = [config];
  const phase = args.phase as Phase | undefined;

  if (phase) {
    // Single phase mode
    switch (phase) {
      case "parse":
        for (const config of validConfigs) {
          await runParse(config);
        }
        break;
      case "refine":
        await runRefine(validConfigs);
        break;
      case "translate": {
        // Load refine cache for each book
        const refined: { config: BookConfig; refined: ParsedOutput }[] = [];
        for (const config of validConfigs) {
          const cached = await loadRefineCache(config.slug);
          if (!cached) throw new Error(`No refine cache for ${config.slug} — run --phase refine first`);
          refined.push({ config, refined: { bookSlug: config.slug, chapters: cached } });
        }
        await runTranslate(refined);
        break;
      }
      case "assemble": {
        // Load translate cache for each book, load refine cache for chapter structure
        for (const config of validConfigs) {
          const refineCached = await loadRefineCache(config.slug);
          if (!refineCached) throw new Error(`No refine cache for ${config.slug} — run --phase refine first`);
          const translateCached = await loadTranslateCache(config.slug);
          if (!translateCached) throw new Error(`No translate cache for ${config.slug} — run --phase translate first`);

          const translated: TranslatedOutput = {
            bookSlug: config.slug,
            chapters: refineCached.map((ch) => {
              const key = `${config.slug}_${ch.slug}`;
              const chunks = translateCached.get(key);
              if (!chunks || chunks.length === 0) {
                throw new Error(`No translated chunks for ${key}`);
              }
              return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, translated: chunks };
            }),
          };
          await runAssemble(config, translated);
        }
        break;
      }
    }
  } else {
    // Full pipeline: parse → refine → translate → assemble
    for (const config of validConfigs) {
      await runParse(config);
    }

    const refined = await runRefine(validConfigs);
    const withTranslations = await runTranslate(refined);

    for (const { config, refined: r, translatedMap } of withTranslations) {
      const translated: TranslatedOutput = {
        bookSlug: config.slug,
        chapters: r.chapters.map((ch) => {
          const chunks = translatedMap.get(`${config.slug}_${ch.slug}`);
          if (!chunks || chunks.length === 0) {
            throw new Error(`No translated chunks for ${config.slug}:${ch.slug} — aborting to prevent data loss`);
          }
          return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, translated: chunks };
        }),
      };

      // Print meaning check summary
      let meaningWarnings = 0;
      for (const ch of translated.chapters) {
        for (const t of ch.translated) {
          if (t.meaningCheck && (!t.meaningCheck.faithful || !t.meaningCheck.tone_preserved || t.meaningCheck.ideas_changed)) {
            meaningWarnings++;
          }
        }
      }
      if (meaningWarnings > 0) {
        console.log(`  ${config.slug}: ${meaningWarnings} sections had meaning preservation warnings`);
      }

      await runAssemble(config, translated);
    }
  }

  // Cost report
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } =
    tokenUsage;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (totalTokens > 0) {
    // Sonnet batch pricing per 1M tokens (50% of real-time)
    const inputCost = (inputTokens / 1_000_000) * 1.5;
    const outputCost = (outputTokens / 1_000_000) * 7.5;
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * 1.875;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * 0.15;
    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    process.stderr.write("\n--- Cost Report ---\n");
    process.stderr.write(`  Batch requests:        ${batchStats.totalRequests} (${batchStats.succeeded} succeeded, ${batchStats.failed} failed)\n`);
    process.stderr.write(`  Input tokens:          ${inputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Output tokens:         ${outputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Cache creation tokens: ${cacheCreationTokens.toLocaleString()}\n`);
    process.stderr.write(`  Cache read tokens:     ${cacheReadTokens.toLocaleString()}\n`);
    process.stderr.write(`  Estimated cost (Sonnet batch): $${totalCost.toFixed(4)}\n`);
  }

  console.log("\nDone.");
  await logger.close();
}

main().catch(async (e) => {
  console.error("Generation failed:", e);
  await logger.close();
  process.exit(1);
});
