import { readFile, writeFile, mkdir } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { refineChunks } from "./lib/refine.js";
import { translateChunks, type TranslatedChunk } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";

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
  --help             Show this help

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

async function runRefine(parsed: ParsedOutput): Promise<ParsedOutput> {
  console.log(`\nRefining ${parsed.bookSlug}...`);

  const chapters: ParsedChapter[] = [];

  for (const ch of parsed.chapters) {
    console.log(`  ${ch.slug}:`);
    const result = await refineChunks(ch.chunks);

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

  const outDir = "output/translated";
  await mkdir(outDir, { recursive: true });
  await writeFile(
    `${outDir}/${config.slug}.json`,
    JSON.stringify({ bookSlug: config.slug, chapters }, null, 2),
  );

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

async function processBook(config: BookConfig): Promise<void> {
  const parsed = await runParse(config);

  if (args["parse-only"]) return;

  const refined = await runRefine(parsed);
  const translated = await runTranslate(config, refined);
  await runAssemble(config, translated);
}

async function main(): Promise<void> {
  const configs = args.all
    ? BOOK_CONFIGS
    : [BOOK_CONFIGS.find((b) => b.slug === args.book)];

  if (!configs[0]) {
    console.error(`Unknown book "${args.book}". Valid: ${VALID_BOOK_SLUGS.join(", ")}`);
    process.exit(1);
  }

  for (const config of configs as BookConfig[]) {
    await processBook(config);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Generation failed:", e);
  process.exit(1);
});
