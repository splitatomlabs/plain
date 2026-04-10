import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { parseArgs } from "node:util";
import { BOOK_CONFIGS, VALID_BOOK_SLUGS, type BookConfig } from "./lib/constants.js";
import { parseSourceText } from "./lib/parser.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import { translateChunks, type TranslatedChunk } from "./lib/translator.js";
import { assembleBook, writeContentFiles, type ChapterChunks } from "./lib/assembler.js";
import { preCheckChunks, type PreCheckReport } from "./lib/validate-semantic.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    book: { type: "string" },
    all: { type: "boolean", default: false },
    phase: { type: "string", default: "all" },
    "dry-run": { type: "boolean", default: false },
    "skip-precheck": { type: "boolean", default: false },
    limit: { type: "string" },
    output: { type: "string", default: "src/content" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate.ts [options]

Options:
  --book <slug>      Generate a single book (${VALID_BOOK_SLUGS.join(", ")})
  --all              Generate all 5 books
  --phase <phase>    Run specific phase: parse, precheck, translate, assemble, all (default: all)
  --dry-run          Preview parsing without Claude CLI calls
  --skip-precheck    Skip the semantic pre-check phase
  --limit <n>        Max sections per chapter (e.g. --limit 3 for a quick test)
  --output <dir>     Output directory (default: src/content)
  --help             Show this help

Pipeline: parse → precheck → translate (with meaning check) → assemble`);
  process.exit(0);
}

if (!args.book && !args.all) {
  console.error("Specify --book <slug> or --all");
  process.exit(1);
}

const validPhases = ["parse", "precheck", "translate", "assemble", "all"];
if (!validPhases.includes(args.phase!)) {
  console.error(`Invalid phase "${args.phase}". Use: ${validPhases.join(", ")}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Phase 1: Parse — split source text into sections
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

  const outDir = "output/parsed";
  await mkdir(outDir, { recursive: true });
  await writeFile(
    `${outDir}/${config.slug}.json`,
    JSON.stringify({ bookSlug: config.slug, chapters }, null, 2),
  );

  return { bookSlug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Phase 2: Pre-check — single-idea + standalone on original text
// ---------------------------------------------------------------------------

async function runPreCheck(parsed: ParsedOutput): Promise<void> {
  console.log(`\nPre-checking ${parsed.bookSlug}...`);

  if (args["dry-run"]) {
    console.log("  (dry-run: skipping pre-check)");
    return;
  }

  for (const ch of parsed.chapters) {
    console.log(`  ${ch.slug}:`);
    const report = await preCheckChunks(ch.chunks);

    if (report.warnings.length === 0) {
      console.log(`    All ${ch.chunks.length} sections passed`);
    } else {
      for (const { chunk, result } of report.warnings) {
        if (!result.single_idea) {
          console.log(
            `    WARN section ${chunk.sectionNumber}: Multiple ideas. ${result.single_idea_suggestion ?? ""}`,
          );
        }
        if (!result.standalone) {
          console.log(
            `    WARN section ${chunk.sectionNumber}: Not standalone. ${result.standalone_resolution ?? ""}`,
          );
        }
      }
      console.log(
        `    ${ch.chunks.length - report.warnings.length}/${ch.chunks.length} sections clean, ${report.warnings.length} warnings`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Phase 3: Translate — plain English + tags, with meaning preservation check
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
    for await (const chunk of translateChunks(ch.chunks, config, ch.slug, args["dry-run"])) {
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
// Phase 4: Assemble — write card JSON
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

  // Phase 1: Parse
  if (phase === "all" || phase === "parse") {
    parsed = await runParse(config);
  }

  // Phase 2: Pre-check
  if ((phase === "all" || phase === "precheck") && !args["skip-precheck"]) {
    if (!parsed) parsed = await loadParsed(config.slug);
    if (!parsed) {
      console.error(`No parsed data for ${config.slug}. Run --phase parse first.`);
      process.exit(1);
    }
    await runPreCheck(parsed);
  }

  // Phase 3: Translate (includes meaning preservation check)
  if (phase === "all" || phase === "translate") {
    if (!parsed) parsed = await loadParsed(config.slug);
    if (!parsed) {
      console.error(`No parsed data for ${config.slug}. Run --phase parse first.`);
      process.exit(1);
    }
    translated = await runTranslate(config, parsed);
  }

  // Phase 4: Assemble
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
