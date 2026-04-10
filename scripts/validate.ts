import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { parseArgs } from "node:util";
import { VALID_BOOK_SLUGS } from "./lib/constants.js";
import type { Card, BookMeta, ValidationMessage } from "./lib/types.js";
import {
  validateCardSchema,
  validateCardTags,
  validateTagCoverage,
  validateReadability,
  validateBookMeta,
  validateCardContent,
  validateCardSequence,
} from "./lib/validate.js";
// ---------------------------------------------------------------------------
// CLI argument parsing
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    content: { type: "string", default: "src/content/" },
    file: { type: "string" },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/validate.ts [options]

Options:
  --content <dir>   Content directory (default: src/content/)
  --file <path>     Validate a single chapter JSON file
  --help            Show this help

Note: Semantic checks (single-idea, standalone, meaning preservation) run
as part of the generation pipeline (scripts/generate.ts), not here.`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// File loading helpers
// ---------------------------------------------------------------------------

async function loadJSON<T>(filePath: string): Promise<T> {
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as T;
}

// ---------------------------------------------------------------------------
// Single-file validation mode
// ---------------------------------------------------------------------------

async function validateSingleFile(filePath: string): Promise<ValidationMessage[]> {
  const msgs: ValidationMessage[] = [];
  const cards = await loadJSON<unknown[]>(filePath);

  if (!Array.isArray(cards)) {
    msgs.push({ severity: "error", message: `${filePath} is not a JSON array` });
    return msgs;
  }

  for (const card of cards) {
    msgs.push(...validateCardSchema(card));
    // Only run further checks if schema is valid enough
    const schemaErrors = validateCardSchema(card).filter((m) => m.severity === "error");
    if (schemaErrors.length === 0) {
      const c = card as Card;
      msgs.push(...validateCardTags(c));
      msgs.push(...validateReadability(c));
      msgs.push(...validateCardContent(c));
    }
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// Full content directory validation
// ---------------------------------------------------------------------------

async function validateContentDir(contentDir: string): Promise<{
  messages: ValidationMessage[];
  booksChecked: number;
  cardsChecked: number;
}> {
  const allMessages: ValidationMessage[] = [];
  const allCards: Card[] = [];
  let booksChecked = 0;

  // Discover book directories
  const metaFiles = await glob(path.join(contentDir, "*/_meta.json"));

  if (metaFiles.length === 0) {
    allMessages.push({
      severity: "warn",
      message: `No _meta.json files found in ${contentDir}`,
    });
    return { messages: allMessages, booksChecked: 0, cardsChecked: 0 };
  }

  for (const metaFile of metaFiles) {
    const bookDir = path.dirname(metaFile);
    const bookSlug = path.basename(bookDir);
    booksChecked++;

    console.log(`\nValidating book: ${bookSlug}`);

    // Load meta
    const meta = await loadJSON<BookMeta>(metaFile);

    // Discover chapter files (all JSON except _meta.json)
    const chapterGlob = path.join(bookDir, "*.json");
    const allJsonFiles = await glob(chapterGlob);
    const chapterFiles = allJsonFiles.filter(
      (f) => path.basename(f) !== "_meta.json",
    );

    const chapterMap = new Map<string, Card[]>();

    for (const chapterFile of chapterFiles) {
      const chapterSlug = path.basename(chapterFile, ".json");
      const cards = await loadJSON<Card[]>(chapterFile);

      if (!Array.isArray(cards)) {
        allMessages.push({
          severity: "error",
          book_slug: bookSlug,
          message: `${chapterFile} is not a JSON array`,
        });
        continue;
      }

      chapterMap.set(chapterSlug, cards);

      for (const card of cards) {
        const schemaMessages = validateCardSchema(card);
        allMessages.push(...schemaMessages);

        const hasSchemaErrors = schemaMessages.some(
          (m) => m.severity === "error",
        );
        if (!hasSchemaErrors) {
          const c = card as Card;
          allMessages.push(...validateCardTags(c));
          allMessages.push(...validateReadability(c));
          allMessages.push(...validateCardContent(c));
          allCards.push(c);
        }
      }

      // Validate card sequence within chapter
      if (cards.length > 0) {
        allMessages.push(
          ...validateCardSequence(cards as Card[], chapterSlug),
        );
      }
    }

    // Cross-reference validation
    allMessages.push(...validateBookMeta(meta, chapterMap));
  }

  // Tag coverage across all cards
  if (allCards.length > 0) {
    allMessages.push(...validateTagCoverage(allCards));
  }

  return {
    messages: allMessages,
    booksChecked,
    cardsChecked: allCards.length,
  };
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

function printReport(messages: ValidationMessage[]): void {
  // Group by book
  const byBook = new Map<string, ValidationMessage[]>();
  const global: ValidationMessage[] = [];

  for (const msg of messages) {
    const key = msg.book_slug ?? msg.card_id?.split("-").slice(0, -2).join("-") ?? "";
    if (key) {
      if (!byBook.has(key)) byBook.set(key, []);
      byBook.get(key)!.push(msg);
    } else {
      global.push(msg);
    }
  }

  const severityOrder = { error: 0, warn: 1, info: 2 };
  const sortBySeverity = (a: ValidationMessage, b: ValidationMessage) =>
    severityOrder[a.severity] - severityOrder[b.severity];

  for (const [book, msgs] of byBook) {
    console.log(`\n--- ${book} ---`);
    for (const msg of msgs.sort(sortBySeverity)) {
      const prefix =
        msg.severity === "error"
          ? "ERROR"
          : msg.severity === "warn"
            ? "WARN "
            : "INFO ";
      const location = msg.card_id ?? msg.book_slug ?? "";
      const field = msg.field ? ` [${msg.field}]` : "";
      console.log(`  ${prefix} ${location}${field}: ${msg.message}`);
    }
  }

  if (global.length > 0) {
    console.log("\n--- Global ---");
    for (const msg of global.sort(sortBySeverity)) {
      const prefix =
        msg.severity === "error"
          ? "ERROR"
          : msg.severity === "warn"
            ? "WARN "
            : "INFO ";
      console.log(`  ${prefix}: ${msg.message}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  let messages: ValidationMessage[] = [];
  let booksChecked = 0;
  let cardsChecked = 0;

  if (args.file) {
    // Single file mode
    if (!existsSync(args.file)) {
      console.error(`File not found: ${args.file}`);
      process.exit(1);
    }
    console.log(`Validating single file: ${args.file}`);
    messages = await validateSingleFile(args.file);
    cardsChecked = messages.length > 0 ? 1 : 0; // approximate
  } else {
    // Directory mode
    const contentDir = args.content!;
    if (!existsSync(contentDir)) {
      console.error(`Content directory not found: ${contentDir}`);
      process.exit(1);
    }
    console.log(`Validating content directory: ${contentDir}`);
    const result = await validateContentDir(contentDir);
    messages = result.messages;
    booksChecked = result.booksChecked;
    cardsChecked = result.cardsChecked;
  }

  // Print report
  printReport(messages);

  // Summary
  const errors = messages.filter((m) => m.severity === "error").length;
  const warns = messages.filter((m) => m.severity === "warn").length;
  const infos = messages.filter((m) => m.severity === "info").length;

  console.log(
    `\n${errors} errors, ${warns} warnings, ${infos} info across ${booksChecked} books (${cardsChecked} cards)`,
  );

  process.exit(errors > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error("Validation failed:", e);
  process.exit(1);
});
