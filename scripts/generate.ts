import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { refineChunksBatch, type BatchRefineInput } from "./lib/refine.js";
import { translateChunksBatch, type TranslatedChunk, type BatchTranslateInput } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import { validateSectionCoverage, validateRefineCoverage } from "./lib/validate.js";
import { tokenUsage, batchStats } from "./lib/claude.js";
import { saveRefineCache, loadRefineCache, saveTranslateCache, loadTranslateCache } from "./lib/cache.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    book: { type: "string" },
    all: { type: "boolean", default: false },
    "parse-only": { type: "boolean", default: false },
    limit: { type: "string" },
    output: { type: "string", default: "content/output" },
    parallel: { type: "boolean", default: false },
    fresh: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate.ts [options]

Options:
  --book <slug>      Generate a single book (${VALID_BOOK_SLUGS.join(", ")})
  --all              Generate all 5 books
  --parse-only       Parse source text only, no Claude CLI calls
  --limit <n>        Max refine API calls per book (each processes ~10 chunks)
  --output <dir>     Output directory (default: content/output)
  --parallel         Process all books concurrently (use with --all)
  --fresh            Ignore cached results (force re-refine and re-translate; still saves results to cache)
  --help             Show this help

Environment:
  PLAIN_USE_API=1    Use Anthropic API directly (requires ANTHROPIC_API_KEY)
  PLAIN_USE_BATCH=1  Use Batch API for translate step (50% cheaper, async)

Pipeline: parse → refine → translate (with meaning check) → assemble`);
  process.exit(0);
}

if (!args.book && !args.all) {
  console.error("Specify --book <slug> or --all");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Parse — split source text into sections
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

async function runParse(config: BookConfig): Promise<ParsedOutput> {
  console.log(`\nParsing ${config.slug}...`);

  const text = await readFile(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  const coverageErrors: string[] = [];

  const chapters = parsed.chapters.map((ch) => {
    const chunks = chunkSections(ch.sections, config.speakerLabels);
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
    console.error(`\nSection coverage errors in ${config.slug}:`);
    for (const e of coverageErrors) console.error(`  ${e}`);
    throw new Error(`${config.slug}: ${coverageErrors.length} section coverage error(s) — aborting before translation`);
  }

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total: ${totalChunks} chunks across ${chapters.length} chapters`);

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Assemble — write card JSON
// ---------------------------------------------------------------------------

interface TranslatedOutput {
  bookSlug: string;
  chapters: {
    slug: string;
    title: string;
    bookNumber?: number;
    translated: TranslatedChunk[];
  }[];
}

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

/** Batch path: parse+refine all books, translate all chunks in one batch, then assemble. */
async function runBatchPipeline(configs: BookConfig[]): Promise<void> {
  // Phase 1: parse all books
  const parsed = await Promise.all(configs.map(async (config) => {
    const p = await runParse(config);
    return { config, parsed: p };
  }));

  if (args["parse-only"]) return;

  // Phase 1b: refine — use batch API or sequential
  const readCache = !args.fresh;
  const refined: { config: BookConfig; refined: ParsedOutput }[] = [];

  // Check cache first for all books
  const uncachedRefine: { config: BookConfig; parsed: ParsedOutput }[] = [];
  for (const { config, parsed: p } of parsed) {
    if (readCache) {
      const cached = await loadRefineCache(config.slug);
      if (cached) {
        const totalChunks = cached.reduce((sum, ch) => sum + ch.chunks.length, 0);
        console.log(`\nRefining ${config.slug}... (cached: ${totalChunks} chunks across ${cached.length} chapters)`);
        refined.push({ config, refined: { bookSlug: config.slug, chapters: cached } });
        continue;
      }
    }
    uncachedRefine.push({ config, parsed: p });
  }

  if (uncachedRefine.length > 0) {
    // Build batch refine inputs from all uncached books
    const refineInputs: BatchRefineInput[] = [];
    for (const { config, parsed: p } of uncachedRefine) {
      for (const ch of p.chapters) {
        refineInputs.push({
          bookSlug: config.slug,
          chapterSlug: ch.slug,
          chunks: ch.chunks,
          config,
        });
      }
    }

    console.log(`\nBatch refining ${refineInputs.reduce((s, i) => s + i.chunks.length, 0)} chunks across ${uncachedRefine.length} books...`);
    const refineResultMap = await refineChunksBatch(refineInputs);

    // Reconstruct ParsedOutput per book from batch results
    const validationErrors: string[] = [];
    for (const { config, parsed: p } of uncachedRefine) {
      const chapters: ParsedChapter[] = p.chapters.map((ch) => {
        const key = `${config.slug}_${ch.slug}`;
        const result = refineResultMap.get(key);
        if (!result) return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks: ch.chunks };

        if (result.splits > 0 || result.merges > 0) {
          console.log(`  ${config.slug}/${ch.slug}: ${result.originalCount} → ${result.refinedCount} chunks (${result.splits} splits, ${result.merges} merges)`);
        }

        // Verify refine didn't drop content
        const refineMsgs = validateRefineCoverage(ch.chunks, result.chunks);
        const refineErrors = refineMsgs.filter((m) => m.severity === "error");
        if (refineErrors.length > 0) {
          console.error(`  Refine coverage errors in ${config.slug}/${ch.slug}:`);
          for (const e of refineErrors) console.error(`    ${e.message}`);
          validationErrors.push(`${config.slug}/${ch.slug}: refine dropped content`);
        }

        return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, chunks: result.chunks };
      });

      const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
      console.log(`  ${config.slug}: ${totalChunks} chunks after refine`);

      // Always save refine cache so results aren't lost
      await saveRefineCache(config.slug, chapters);
      console.log(`  Cached refine results for ${config.slug}`);

      refined.push({ config, refined: { bookSlug: config.slug, chapters } });
    }

    if (validationErrors.length > 0) {
      throw new Error(`Refine validation failed — aborting before translation:\n  ${validationErrors.join("\n  ")}`);
    }
  }

  if (refined.length === 0) return;

  // Phase 2: check translate cache and collect uncached chunks for batch
  const translatedMap = new Map<string, TranslatedChunk[]>();
  const batchInputs: BatchTranslateInput[] = [];
  let cachedChunks = 0;

  for (const { config, refined: r } of refined) {
    if (readCache) {
      const cached = await loadTranslateCache(config.slug);
      if (cached) {
        for (const [key, chunks] of cached) {
          translatedMap.set(key, chunks);
          cachedChunks += chunks.length;
        }
        console.log(`  ${config.slug}: translate cache hit (${cached.size} chapters)`);
        continue;
      }
    }
    for (const ch of r.chapters) {
      batchInputs.push({
        bookSlug: config.slug,
        chapterSlug: ch.slug,
        chunks: ch.chunks,
        config,
      });
    }
  }

  if (cachedChunks > 0) {
    console.log(`  ${cachedChunks} chunks loaded from translate cache`);
  }

  if (batchInputs.length > 0) {
    console.log(`\nBatch translating ${batchInputs.reduce((s, i) => s + i.chunks.length, 0)} chunks across ${new Set(batchInputs.map(i => i.bookSlug)).size} books...`);
    const batchResults = await translateChunksBatch(batchInputs);
    for (const [key, chunks] of batchResults) {
      translatedMap.set(key, chunks);
    }
  } else {
    console.log(`\nAll translations loaded from cache.`);
  }

  // Always save translate cache for books that were batch-translated
  if (batchInputs.length > 0) {
    const batchedBooks = new Set(batchInputs.map(i => i.bookSlug));
    for (const { config } of refined) {
      if (!batchedBooks.has(config.slug)) continue;
      const bookTranslations = new Map<string, TranslatedChunk[]>();
      for (const [key, chunks] of translatedMap) {
        if (key.startsWith(`${config.slug}_`)) {
          bookTranslations.set(key, chunks);
        }
      }
      if (bookTranslations.size > 0) {
        await saveTranslateCache(config.slug, bookTranslations);
        console.log(`  Cached translate results for ${config.slug}`);
      }
    }
  }

  // Phase 3: assemble each book from batch results
  for (const { config, refined: r } of refined) {
    const translatedOutput: TranslatedOutput = {
      bookSlug: config.slug,
      chapters: r.chapters.map((ch) => {
        const translated = translatedMap.get(`${config.slug}_${ch.slug}`);
        if (!translated || translated.length === 0) {
          throw new Error(
            `No translated chunks for ${config.slug}:${ch.slug} — aborting to prevent data loss`,
          );
        }
        return { slug: ch.slug, title: ch.title, bookNumber: ch.bookNumber, translated };
      }),
    };

    // Print meaning check summary
    let meaningWarnings = 0;
    for (const ch of translatedOutput.chapters) {
      for (const t of ch.translated) {
        if (t.meaningCheck && (!t.meaningCheck.faithful || !t.meaningCheck.tone_preserved || t.meaningCheck.ideas_changed)) {
          meaningWarnings++;
        }
      }
    }
    if (meaningWarnings > 0) {
      console.log(`  ${config.slug}: ${meaningWarnings} sections had meaning preservation warnings`);
    }

    await runAssemble(config, translatedOutput);
  }
}

async function main(): Promise<void> {
  const configs = args.all
    ? BOOK_CONFIGS
    : [BOOK_CONFIGS.find((b) => b.slug === args.book)];

  if (!configs[0]) {
    console.error(`Unknown book "${args.book}". Valid: ${VALID_BOOK_SLUGS.join(", ")}`);
    process.exit(1);
  }

  const validConfigs = configs as BookConfig[];

  await runBatchPipeline(validConfigs);

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
}

main().catch((e) => {
  console.error("Generation failed:", e);
  process.exit(1);
});
