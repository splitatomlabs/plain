import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText, type ParsedBook } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { translateChunks, type TranslatedChunk } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import {
  validateCardSchema,
  validateCardTags,
  validateReadability,
  validateCardContent,
  validateCardSequence,
  validateBookMeta,
} from "./lib/validate.js";
import type { Card, ValidationMessage } from "./lib/types.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    book: { type: "string" },
    all: { type: "boolean", default: false },
    phase: { type: "string", default: "all" },
    "dry-run": { type: "boolean", default: false },
    output: { type: "string", default: "src/content" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate.ts [options]

Options:
  --book <slug>    Generate a single book (${VALID_BOOK_SLUGS.join(", ")})
  --all            Generate all 5 books
  --phase <phase>  Run specific phase: parse, translate, assemble, all (default: all)
  --dry-run        Preview parsing without Claude CLI calls
  --output <dir>   Output directory (default: src/content)
  --help           Show this help`);
  process.exit(0);
}

if (!args.book && !args.all) {
  console.error("Specify --book <slug> or --all");
  process.exit(1);
}

const validPhases = ["parse", "translate", "assemble", "all"];
if (!validPhases.includes(args.phase!)) {
  console.error(`Invalid phase "${args.phase}". Use: ${validPhases.join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Phase: Parse
// ---------------------------------------------------------------------------

interface ParsedOutput {
  bookSlug: string;
  chapters: {
    slug: string;
    title: string;
    bookNumber?: number;
    chunks: Chunk[];
  }[];
}

async function runParse(config: BookConfig): Promise<ParsedOutput> {
  console.log(`\nParsing ${config.slug}...`);

  const text = await readFile(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  const chapters = parsed.chapters.map((ch) => {
    const chunks = chunkSections(ch.sections, config.speakerLabels);
    console.log(`  ${ch.slug}: ${chunks.length} chunks`);
    return {
      slug: ch.slug,
      title: ch.title,
      bookNumber: ch.bookNumber,
      chunks,
    };
  });

  const totalChunks = chapters.reduce((sum, ch) => sum + ch.chunks.length, 0);
  console.log(`  Total: ${totalChunks} chunks across ${chapters.length} chapters`);

  // Save intermediate
  const outDir = "output/parsed";
  await mkdir(outDir, { recursive: true });
  await writeFile(
    `${outDir}/${config.slug}.json`,
    JSON.stringify({ bookSlug: config.slug, chapters }, null, 2),
  );

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Phase: Translate
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

  if (args["dry-run"]) {
    console.log("  (dry-run: skipping translation)");
    return {
      bookSlug: config.slug,
      chapters: parsed.chapters.map((ch) => ({
        slug: ch.slug,
        title: ch.title,
        bookNumber: ch.bookNumber,
        translated: ch.chunks.map((c) => ({
          sectionNumber: c.sectionNumber,
          originalText: c.text,
          plainEnglish: `[DRY RUN] ${c.text.slice(0, 80)}...`,
          tags: ["what-really-matters" as const],
        })),
      })),
    };
  }

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

  // Save intermediate
  const outDir = "output/translated";
  await mkdir(outDir, { recursive: true });
  await writeFile(
    `${outDir}/${config.slug}.json`,
    JSON.stringify({ bookSlug: config.slug, chapters }, null, 2),
  );

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Phase: Assemble
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

  // Run structural validation
  console.log(`\nValidating ${config.slug}...`);
  const messages: ValidationMessage[] = [];

  const chapterMap = new Map<string, Card[]>();
  for (const [slug, cards] of chapters) {
    chapterMap.set(slug, cards);
    for (const card of cards) {
      messages.push(...validateCardSchema(card));
      const schemaErrors = messages.filter(
        (m) => m.severity === "error" && m.card_id === card.id,
      );
      if (schemaErrors.length === 0) {
        messages.push(...validateCardTags(card));
        messages.push(...validateReadability(card));
        messages.push(...validateCardContent(card));
      }
    }
    messages.push(...validateCardSequence(cards, slug));
  }
  messages.push(...validateBookMeta(meta, chapterMap));

  const errors = messages.filter((m) => m.severity === "error");
  const warns = messages.filter((m) => m.severity === "warn");

  if (errors.length > 0) {
    console.error(`\nValidation FAILED: ${errors.length} errors, ${warns.length} warnings`);
    for (const e of errors) {
      console.error(`  ERROR ${e.card_id ?? e.book_slug ?? ""}: ${e.message}`);
    }
    process.exit(1);
  }

  if (warns.length > 0) {
    console.log(`\nValidation passed with ${warns.length} warnings`);
    for (const w of warns.slice(0, 10)) {
      console.log(`  WARN ${w.card_id ?? ""}: ${w.message}`);
    }
    if (warns.length > 10) console.log(`  ... and ${warns.length - 10} more`);
  } else {
    console.log("\nValidation passed cleanly");
  }
}

// ---------------------------------------------------------------------------
// Load intermediate files for resuming
// ---------------------------------------------------------------------------

async function loadParsed(bookSlug: string): Promise<ParsedOutput | null> {
  const file = `output/parsed/${bookSlug}.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf-8")) as ParsedOutput;
}

async function loadTranslated(bookSlug: string): Promise<TranslatedOutput | null> {
  const file = `output/translated/${bookSlug}.json`;
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, "utf-8")) as TranslatedOutput;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function processBook(config: BookConfig): Promise<void> {
  const phase = args.phase!;

  let parsed: ParsedOutput | null = null;
  let translated: TranslatedOutput | null = null;

  if (phase === "all" || phase === "parse") {
    parsed = await runParse(config);
  }

  if (phase === "all" || phase === "translate") {
    if (!parsed) parsed = await loadParsed(config.slug);
    if (!parsed) {
      console.error(`No parsed data for ${config.slug}. Run --phase parse first.`);
      process.exit(1);
    }
    translated = await runTranslate(config, parsed);
  }

  if (phase === "all" || phase === "assemble") {
    if (!translated) translated = await loadTranslated(config.slug);
    if (!translated) {
      console.error(`No translated data for ${config.slug}. Run --phase translate first.`);
      process.exit(1);
    }
    await runAssemble(config, translated);
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

  for (const config of configs as BookConfig[]) {
    await processBook(config);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("Generation failed:", e);
  process.exit(1);
});
