import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { refineChunks } from "./lib/refine.js";
import { translateChunks, translateChunksBatch, type TranslatedChunk, type BatchTranslateInput } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import { tokenUsage, batchStats } from "./lib/claude.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    book: { type: "string" },
    all: { type: "boolean", default: false },
    "parse-only": { type: "boolean", default: false },
    limit: { type: "string" },
    output: { type: "string", default: "content" },
    parallel: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate.ts [options]

Options:
  --book <slug>      Generate a single book (${VALID_BOOK_SLUGS.join(", ")})
  --all              Generate all 5 books
  --parse-only       Parse source text only, no Claude CLI calls
  --limit <n>        Max sections per chapter (e.g. --limit 3 for a quick test)
  --output <dir>     Output directory (default: content)
  --parallel         Process all books concurrently (use with --all)
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

  const limit = args.limit ? parseInt(args.limit, 10) : undefined;

  const chapters = parsed.chapters.map((ch) => {
    const allChunks = chunkSections(ch.sections, config.speakerLabels);
    const chunks = limit && allChunks.length > limit
      ? allChunks.slice(0, limit)
      : allChunks;
    const suffix = limit && allChunks.length > limit
      ? ` (limited from ${allChunks.length})`
      : "";
    console.log(`  ${ch.slug}: ${chunks.length} chunks${suffix}`);
    return {
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      chunks,
    };
  });

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total: ${totalChunks} chunks across ${chapters.length} chapters`);

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Refine — AI reviews chunks, splits multi-idea sections, merges fragments
// ---------------------------------------------------------------------------

async function runRefine(parsed: ParsedOutput, config: BookConfig): Promise<ParsedOutput> {
  console.log(`\nRefining ${parsed.bookSlug}...`);

  const chapters: ParsedChapter[] = [];

  for (const ch of parsed.chapters) {
    console.log(`  ${ch.slug}:`);
    const result = await refineChunks(ch.chunks, config);

    if (result.splits > 0 || result.merges > 0) {
      console.log(
        `    ${result.originalCount} → ${result.refinedCount} chunks (${result.splits} splits, ${result.merges} merges)`,
      );
    } else {
      console.log(`    ${result.refinedCount} chunks (no changes)`);
    }

    chapters.push({
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      chunks: result.chunks,
    });
  }

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total after refine: ${totalChunks} chunks`);

  return { bookSlug: parsed.bookSlug, chapters };
}

// ---------------------------------------------------------------------------
// Translate — plain English + tags, with meaning preservation check
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

async function runTranslate(
  config: BookConfig,
  parsed: ParsedOutput,
): Promise<TranslatedOutput> {
  console.log(`\nTranslating ${config.slug}...`);

  const chapters = [];
  for (const ch of parsed.chapters) {
    const translated: TranslatedChunk[] = [];
    for await (const chunk of translateChunks(ch.chunks, config, ch.slug)) {
      translated.push(chunk);
    }
    chapters.push({
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      translated,
    });
  }

  // Print meaning check summary
  let meaningWarnings = 0;
  for (const ch of chapters) {
    for (const t of ch.translated) {
      if (t.meaningCheck && (!t.meaningCheck.faithful || !t.meaningCheck.tone_preserved || t.meaningCheck.ideas_changed)) {
        meaningWarnings++;
      }
    }
  }
  if (meaningWarnings > 0) {
    console.log(`  ${meaningWarnings} sections had meaning preservation warnings`);
  }

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Assemble — write card JSON
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

const useBatch = process.env.PLAIN_USE_BATCH === "1";

async function processBook(config: BookConfig): Promise<void> {
  const parsed = await runParse(config);

  if (args["parse-only"]) return;

  const refined = await runRefine(parsed, config);
  const translated = await runTranslate(config, refined);
  await runAssemble(config, translated);
}

/** Parse + refine a book, returning config and refined output for batch translation. */
async function parseAndRefine(config: BookConfig): Promise<{ config: BookConfig; refined: ParsedOutput } | null> {
  const parsed = await runParse(config);
  if (args["parse-only"]) return null;
  const refined = await runRefine(parsed, config);
  return { config, refined };
}

/** Batch path: parse+refine all books, translate all chunks in one batch, then assemble. */
async function runBatchPipeline(configs: BookConfig[]): Promise<void> {
  // Phase 1: parse + refine (parallel or sequential)
  const results = args.parallel
    ? await Promise.all(configs.map(parseAndRefine))
    : await (async () => {
        const r = [];
        for (const c of configs) r.push(await parseAndRefine(c));
        return r;
      })();

  const refined = results.filter((r): r is { config: BookConfig; refined: ParsedOutput } => r !== null);
  if (refined.length === 0) return;

  // Phase 2: collect all chunks into batch inputs
  const batchInputs: BatchTranslateInput[] = [];
  for (const { config, refined: r } of refined) {
    for (const ch of r.chapters) {
      batchInputs.push({
        bookSlug: config.slug,
        chapterSlug: ch.slug,
        chunks: ch.chunks,
        config,
      });
    }
  }

  console.log(`\nBatch translating ${batchInputs.reduce((s, i) => s + i.chunks.length, 0)} chunks across ${refined.length} books...`);
  const translatedMap = await translateChunksBatch(batchInputs);

  // Phase 3: assemble each book from batch results
  for (const { config, refined: r } of refined) {
    const translatedOutput: TranslatedOutput = {
      bookSlug: config.slug,
      chapters: r.chapters.map((ch) => {
        const translated = translatedMap.get(`${config.slug}:${ch.slug}`);
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

  if (useBatch) {
    await runBatchPipeline(validConfigs);
  } else if (args.parallel) {
    await Promise.all(validConfigs.map((config) => processBook(config)));
  } else {
    for (const config of validConfigs) {
      await processBook(config);
    }
  }

  // Cost report (only meaningful when PLAIN_USE_API=1 or PLAIN_USE_BATCH=1)
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } =
    tokenUsage;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (totalTokens > 0) {
    // Sonnet pricing per 1M tokens (batch = 50% discount)
    const discount = useBatch ? 0.5 : 1;
    const inputCost = (inputTokens / 1_000_000) * 3 * discount;
    const outputCost = (outputTokens / 1_000_000) * 15 * discount;
    const cacheWriteCost = (cacheCreationTokens / 1_000_000) * 3.75 * discount;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * 0.3 * discount;
    const totalCost = inputCost + outputCost + cacheWriteCost + cacheReadCost;

    process.stderr.write("\n--- Cost Report ---\n");
    if (useBatch) {
      process.stderr.write("  Mode: Batch API (50% discount)\n");
      process.stderr.write(`  Batch requests:        ${batchStats.totalRequests} (${batchStats.succeeded} succeeded, ${batchStats.failed} failed)\n`);
    }
    process.stderr.write(`  Input tokens:          ${inputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Output tokens:         ${outputTokens.toLocaleString()}\n`);
    process.stderr.write(`  Cache creation tokens: ${cacheCreationTokens.toLocaleString()}\n`);
    process.stderr.write(`  Cache read tokens:     ${cacheReadTokens.toLocaleString()}\n`);
    process.stderr.write(`  Estimated cost (Sonnet): $${totalCost.toFixed(4)}\n`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Generation failed:", e);
  process.exit(1);
});
