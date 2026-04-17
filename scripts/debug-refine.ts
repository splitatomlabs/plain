/**
 * Debug utility for the refine phase.
 *
 * Mirrors the batch construction in refineChunksBatch — operates on the same
 * batch request IDs (refine_{bookSlug}_{chapterSlug}_{batchIndex}).
 *
 * Usage:
 *   npx tsx scripts/debug-refine.ts --list
 *   npx tsx scripts/debug-refine.ts --id refine_on-anger_book-3_2 --dry-run
 *   ANTHROPIC_API_KEY=... npx tsx scripts/debug-refine.ts --id refine_on-anger_book-3_2
 */

import { parseArgs } from "node:util";
import { BOOK_CONFIGS, type BookConfig } from "./lib/constants.js";
import { chunkSections, type Chunk } from "./lib/chunker.js";
import {
  buildBulkRefineSystem,
  buildBulkRefineUser,
  applyDecisions,
  splitOversizedChunk,
  splitTextAtBoundary,
  estimateReadingTime,
  MAX_READING_TIME_SECONDS,
} from "./lib/refine.js";
import { callClaudeJSON } from "./lib/claude.js";
import { loadParseCache } from "./lib/cache.js";
import { validateRefineCoverage } from "./lib/validate.js";
import { safeCustomId } from "./lib/claude.js";

const REFINE_BATCH_SIZE = parseInt(process.env.REFINE_BATCH_SIZE ?? "10", 10);

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const { values } = parseArgs({
  options: {
    list: { type: "boolean", default: false },
    id: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help || (!values.list && !values.id)) {
  console.log(`Usage:
  npx tsx scripts/debug-refine.ts --list
  npx tsx scripts/debug-refine.ts --id <batchId> [--dry-run]

Options:
  --list       Show all batch IDs with section ranges and reading times
  --id <id>    Debug a specific batch (e.g., refine_on-anger_book-3_2)
  --dry-run    Skip API call; simulate only the mechanical splitOversizedChunk pass
  --help       Show this help`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Build batch map — mirrors refineChunksBatch construction
// ---------------------------------------------------------------------------

interface BatchInfo {
  id: string;
  bookSlug: string;
  chapterSlug: string;
  batchIndex: number;
  chunks: Chunk[];
  config: BookConfig;
}

async function buildBatchMap(): Promise<Map<string, BatchInfo>> {
  const map = new Map<string, BatchInfo>();

  for (const config of BOOK_CONFIGS) {
    const parsed = await loadParseCache(config.slug);
    if (!parsed) continue;

    for (const ch of parsed) {
      const chunks = chunkSections(ch.sections, config.speakerLabels);
      const batches: Chunk[][] = [];
      for (let i = 0; i < chunks.length; i += REFINE_BATCH_SIZE) {
        batches.push(chunks.slice(i, i + REFINE_BATCH_SIZE));
      }

      for (let b = 0; b < batches.length; b++) {
        const id = safeCustomId("refine", config.slug, ch.slug, b);
        map.set(id, {
          id,
          bookSlug: config.slug,
          chapterSlug: ch.slug,
          batchIndex: b,
          chunks: batches[b],
          config,
        });
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// --list
// ---------------------------------------------------------------------------

function formatTime(seconds: number): string {
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m${seconds % 60}s` : `${seconds}s`;
}

async function listBatches() {
  const map = await buildBatchMap();
  if (map.size === 0) {
    console.log("No parse caches found. Run the parse phase first.");
    return;
  }

  // Group by book then chapter
  const byBook = new Map<string, BatchInfo[]>();
  for (const info of map.values()) {
    const list = byBook.get(info.bookSlug) ?? [];
    list.push(info);
    byBook.set(info.bookSlug, list);
  }

  for (const [bookSlug, batches] of byBook) {
    console.log(`\n${bookSlug}`);

    // Group by chapter
    const byChapter = new Map<string, BatchInfo[]>();
    for (const b of batches) {
      const list = byChapter.get(b.chapterSlug) ?? [];
      list.push(b);
      byChapter.set(b.chapterSlug, list);
    }

    for (const [chapterSlug, chapterBatches] of byChapter) {
      chapterBatches.sort((a, b) => a.batchIndex - b.batchIndex);
      const totalSections = chapterBatches.reduce((s, b) => s + b.chunks.length, 0);
      console.log(`  ${chapterSlug} (${totalSections} sections)`);

      for (const batch of chapterBatches) {
        const first = batch.chunks[0].sectionNumber;
        const last = batch.chunks[batch.chunks.length - 1].sectionNumber;
        const sectionRange = first === last ? `section ${first}` : `sections ${first}-${last}`;

        // Per-section details
        const details = batch.chunks.map((c) => {
          const words = c.text.split(/\s+/).filter((w) => w.length > 0).length;
          const readTime = estimateReadingTime(c.text);
          const overCap = readTime > MAX_READING_TIME_SECONDS ? " ⚠" : "";
          return `s${c.sectionNumber}:${words}w/${formatTime(readTime)}${overCap}`;
        });

        console.log(`    ${batch.id}  [${sectionRange}]`);
        console.log(`      ${details.join("  ")}`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// --id (debug a single batch)
// ---------------------------------------------------------------------------

function showChunk(label: string, chunk: Chunk, indent = "  ") {
  const words = chunk.text.split(/\s+/).filter((w) => w.length > 0).length;
  const readTime = estimateReadingTime(chunk.text);
  const ending = chunk.text.trim().slice(-60);
  console.log(`${indent}${label} — section ${chunk.sectionNumber}, ${words} words, ${formatTime(readTime)}`);
  console.log(`${indent}  ends: "...${ending}"`);
}

function simulateSplitBoundary(chunk: Chunk, indent = "  ") {
  const readTime = estimateReadingTime(chunk.text);
  if (readTime <= MAX_READING_TIME_SECONDS) {
    console.log(`${indent}  → under ${MAX_READING_TIME_SECONDS}s cap, no split needed`);
    return;
  }

  const text = chunk.text;
  const mid = Math.floor(text.length / 2);

  // Check paragraph breaks
  const paraBreaks: number[] = [];
  let idx = text.indexOf("\n\n");
  while (idx !== -1) {
    paraBreaks.push(idx);
    idx = text.indexOf("\n\n", idx + 1);
  }
  if (paraBreaks.length > 0) {
    const best = paraBreaks.reduce((a, b) =>
      Math.abs(a - mid) <= Math.abs(b - mid) ? a : b,
    );
    console.log(`${indent}  → split at PARAGRAPH BREAK (char ${best}/${text.length})`);
    console.log(`${indent}    piece 1 ends: "...${text.slice(Math.max(0, best - 60), best).trim()}"`);
    console.log(`${indent}    piece 2 starts: "${text.slice(best, best + 60).trim()}..."`);
    return;
  }

  // Check sentence boundaries (matches splitTextAtBoundary in refine.ts)
  const sentenceRe = /[.?!;:]['""\u201D)\]]*\s/g;
  const sentSplits: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = sentenceRe.exec(text)) !== null) {
    sentSplits.push(m.index + m[0].length - 1);
  }
  if (sentSplits.length > 0) {
    const best = sentSplits.reduce((a, b) =>
      Math.abs(a - mid) <= Math.abs(b - mid) ? a : b,
    );
    console.log(`${indent}  → split at SENTENCE BOUNDARY (char ${best}/${text.length})`);
    console.log(`${indent}    piece 1 ends: "...${text.slice(Math.max(0, best - 60), best).trim()}"`);
    console.log(`${indent}    piece 2 starts: "${text.slice(best, best + 60).trim()}..."`);
    return;
  }

  // Last resort
  const spaceAfter = text.indexOf(" ", mid);
  const splitAt = spaceAfter !== -1 ? spaceAfter : mid;
  console.log(`${indent}  ⚠ LAST RESORT: split at midpoint word boundary (char ${splitAt}/${text.length})`);
  console.log(`${indent}    piece 1 ends: "...${text.slice(Math.max(0, splitAt - 60), splitAt).trim()}"`);
  console.log(`${indent}    piece 2 starts: "${text.slice(splitAt, splitAt + 60).trim()}..."`);
}

async function debugBatch(batchId: string, dryRun: boolean) {
  const map = await buildBatchMap();
  const info = map.get(batchId);

  if (!info) {
    console.error(`Batch ID "${batchId}" not found.\n`);
    console.error("Available IDs:");
    for (const id of map.keys()) {
      console.error(`  ${id}`);
    }
    process.exit(1);
  }

  console.log(`Batch: ${info.id}`);
  console.log(`Book: ${info.bookSlug}, Chapter: ${info.chapterSlug}, Index: ${info.batchIndex}`);
  console.log(`Sections: ${info.chunks.length} (${info.chunks[0].sectionNumber}-${info.chunks[info.chunks.length - 1].sectionNumber})`);

  // --- Pre-refine chunks ---
  console.log("\n── Pre-refine chunks ──");
  for (const chunk of info.chunks) {
    showChunk(`chunk`, chunk);
    simulateSplitBoundary(chunk);
    console.log();
  }

  if (dryRun) {
    // Simulate splitOversizedChunk on pre-refine chunks (as if LLM kept everything)
    console.log("── Dry run: simulating splitOversizedChunk on raw chunks ──");
    const allPieces: Chunk[] = [];
    for (const chunk of info.chunks) {
      const pieces = splitOversizedChunk(chunk);
      if (pieces.length > 1) {
        console.log(`  Section ${chunk.sectionNumber}: LENGTH-SPLIT into ${pieces.length} pieces`);
        for (let i = 0; i < pieces.length; i++) {
          showChunk(`  piece ${i + 1}`, pieces[i], "    ");
        }
      } else {
        console.log(`  Section ${chunk.sectionNumber}: no split needed`);
      }
      allPieces.push(...pieces);
    }

    // Validate
    console.log("\n── Validation ──");
    const msgs = validateRefineCoverage(info.chunks, allPieces);
    const errors = msgs.filter((m) => m.severity === "error");
    if (errors.length === 0) {
      console.log("  ✓ No validation errors");
    } else {
      for (const e of errors) {
        console.log(`  ✗ ${e.message}`);
      }
    }
    return;
  }

  // --- Live API call ---
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error("\nANTHROPIC_API_KEY not set. Use --dry-run to skip API calls.");
    process.exit(1);
  }

  console.log("\n── Calling API ──");
  const system = buildBulkRefineSystem(info.config);
  const prompt = buildBulkRefineUser(info.chunks);

  let decisions;
  try {
    decisions = await callClaudeJSON<{ section: number; action: string; segments?: string[]; reason?: string }[]>(
      prompt, undefined, { system },
    );
  } catch (e) {
    console.error(`API call failed: ${e}`);
    process.exit(1);
  }

  // --- Show decisions ---
  console.log("\n── LLM decisions ──");
  for (const d of decisions) {
    const segCount = d.segments ? ` (${d.segments.length} segments)` : "";
    const reason = d.reason ? ` — ${d.reason}` : "";
    console.log(`  Section ${d.section}: ${d.action}${segCount}${reason}`);
    if (d.segments) {
      for (let i = 0; i < d.segments.length; i++) {
        const words = d.segments[i].split(/\s+/).filter((w: string) => w.length > 0).length;
        const ending = d.segments[i].trim().slice(-60);
        console.log(`    segment ${i + 1}: ${words} words, ends: "...${ending}"`);
      }
    }
  }

  // --- Apply decisions ---
  console.log("\n── Applied result ──");
  const { refined, splits, merges } = applyDecisions(info.chunks, decisions as any);
  console.log(`  ${splits} splits, ${merges} merges → ${refined.length} chunks`);

  // --- Length-split pass ---
  console.log("\n── Length-split pass (splitOversizedChunk) ──");
  const capped: Chunk[] = [];
  for (const chunk of refined) {
    const pieces = splitOversizedChunk(chunk);
    if (pieces.length > 1) {
      console.log(`  Section ${chunk.sectionNumber}: LENGTH-SPLIT into ${pieces.length} pieces`);
      for (let i = 0; i < pieces.length; i++) {
        showChunk(`  piece ${i + 1}`, pieces[i], "    ");
        simulateSplitBoundary(pieces[i], "    ");
      }
    }
    capped.push(...pieces);
  }
  if (capped.length === refined.length) {
    console.log("  No oversized chunks — no length-splits needed");
  }

  // --- Final chunks ---
  console.log(`\n── Final chunks (${capped.length}) ──`);
  for (let i = 0; i < capped.length; i++) {
    showChunk(`chunk ${i + 1}`, capped[i]);
  }

  // --- Validate ---
  console.log("\n── Validation ──");
  const msgs = validateRefineCoverage(info.chunks, capped);
  const errors = msgs.filter((m) => m.severity === "error");
  if (errors.length === 0) {
    console.log("  ✓ No validation errors");
  } else {
    for (const e of errors) {
      console.log(`  ✗ ${e.message}`);
      // Find the offending chunk and show full text
      const sectionMatch = e.message.match(/Section (\d+)/);
      if (sectionMatch) {
        const secNum = parseInt(sectionMatch[1], 10);
        const offending = capped.filter((c) => c.sectionNumber === secNum);
        for (const c of offending) {
          const ending = c.text.trim().slice(-100);
          if (e.message.includes(ending.slice(-40))) {
            console.log(`    Full chunk text (${c.text.split(/\s+/).length} words):`);
            console.log(`    "${c.text.trim()}"`);
          }
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (values.list) {
    await listBatches();
  } else if (values.id) {
    await debugBatch(values.id, values["dry-run"] ?? false);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
