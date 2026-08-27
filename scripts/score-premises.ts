/**
 * Score the corpus into the Wall's social premise pool (T10).
 *
 * Gates the 1,615-card corpus (via ./lib/premises.ts), submits only gate
 * survivors to the Wall's LLM rubric (via ./lib/premises-batch.ts), enforces
 * faithfulness (T09), and writes the pool JSON to --output.
 *
 * Pf39c2-social-pilot-02a D01: this used to also score The Question and The
 * Objection, and report The Still's gate-only pool — all three formats were
 * deleted outright (the channel is one Wall a day, drawn from the Wall pool,
 * nothing else), so `--format` only ever means "wall" or "all" (which is the
 * same thing) now.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/score-premises.ts --format all
 *   npx tsx scripts/score-premises.ts --dry-run --limit 5
 */

import { parseArgs } from "node:util";
import type { AuthorSlug } from "./lib/constants.js";
import type { Card } from "./lib/types.js";
import { loadCorpus, rankWall, authorMix, combinedAuthorMix } from "./lib/premises.js";
import { buildWallRequests, scoreWallSurvivors, faithfulnessStats, retryStats, type BuiltRequest } from "./lib/premises-batch.js";
import { tokenUsage, batchStats } from "./lib/claude.js";
import { logger } from "./lib/logger.js";
import { VALID_FORMATS, isValidFormat, formatsToRun, parseLimit, type Format } from "./lib/premises-cli.js";
import { writePoolFile, type RunCounts } from "./lib/pool-file.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    format: { type: "string", default: "all" },
    "dry-run": { type: "boolean", default: false },
    limit: { type: "string" },
    output: { type: "string", default: "content/social/premises" },
    verbose: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/score-premises.ts [options]

Options:
  --format <format>  One of ${VALID_FORMATS.join(", ")} (default: all)
  --dry-run          Build every request and print counts, without an API
                      key, without an SDK client, and without writing files
  --limit <n>        Cap the number of gate survivors processed per format
  --output <dir>     Pool output directory (default: content/social/premises)
  --verbose          Print all log messages to stderr (log file always written)
  --force            Overwrite an existing, larger pool file with a --limit
                      run's smaller one (T19 guard against a smoke run
                      silently shrinking a real full pool)
  --help             Show this help

Environment:
  ANTHROPIC_API_KEY   Required unless --dry-run is set

A run that produces zero scored entries for a format (e.g. every request
errored) refuses to write that format's pool file and exits non-zero — any
existing pool file is left untouched. A run where some but not all requests
succeeded still writes the pool file (a deliberate --limit run is a
legitimate workflow) but records the shortfall in the file's own "meta"
field and prints a loud warning.

Logs are written to content/pipeline/social/premises.log on every run.

A response that fails to parse gets one retry via the real-time API before
being dropped. If it still fails to parse, its raw response, stop_reason,
and output token count are captured to
content/pipeline/social/parse-failures/<custom_id>.json (gitignored).`);
  process.exit(0);
}

if (!isValidFormat(args.format!)) {
  console.error(`Invalid format "${args.format}". Valid: ${VALID_FORMATS.join(", ")}`);
  process.exit(1);
}

let limit: number | undefined;
try {
  limit = parseLimit(args.limit);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}

const format = args.format as Format;
const dryRun = !!args["dry-run"];
const verbose = !!args.verbose;
const force = !!args.force;
const outputDir = args.output!;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Rough, cheap token estimate — 4 characters/token. Not billing-accurate. Mirrors premises-batch.ts's own heuristic. */
const CHARS_PER_TOKEN_ESTIMATE = 4;

function estimateTokensForRequests(built: BuiltRequest<unknown>[]): number {
  let chars = 0;
  for (const { request } of built) {
    chars += request.system?.length ?? 0;
    for (const m of request.messages) chars += m.content.length;
  }
  return Math.ceil(chars / CHARS_PER_TOKEN_ESTIMATE);
}

/** A minimal, format-agnostic shape carrying only what `authorMix`/`combinedAuthorMix` need. */
interface MixEntry {
  card_id: string;
  book_slug: string;
  author_slug: AuthorSlug;
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function printAuthorMix(label: string, entries: { author_slug: AuthorSlug }[]): void {
  const mix = authorMix(entries);
  const parts = Object.entries(mix).map(
    ([author, m]) => `${author} ${m.count} (${(m.share * 100).toFixed(1)}%)`,
  );
  console.log(`  ${label}: ${parts.join(", ")}`);
}

/**
 * T19: the single place score-premises.ts writes a pool file. Delegates the
 * actual decision (write / refuse / warn) and fs I/O to
 * `./lib/pool-file.ts`'s `writePoolFile`, which is directly unit-tested
 * against real counts and real tmp directories — no API call needed to
 * exercise the zero-successes / partial-run / --limit-overwrite paths.
 *
 * `counts.submitted` is the number of requests this run attempted for this
 * format (gate-only formats like Still count every processed survivor as
 * "submitted", since there's no LLM request to fail); `counts.succeeded` is
 * `entries.length` — everything actually admitted to the pool.
 */
async function writePool<T>(name: string, entries: T[], counts: RunCounts): Promise<void> {
  const result = await writePoolFile({ outputDir, name, entries, counts, limited: limit !== undefined, force });
  if (!result.wrote) {
    console.log(`  ${name}: 0 entries submitted — nothing to write, skipping pool file.`);
    return;
  }
  const partial = counts.succeeded < counts.submitted ? " (PARTIAL — see warning above)" : "";
  console.log(`  Wrote ${entries.length} entries to ${result.filePath}${partial}`);
}

// ---------------------------------------------------------------------------
// Per-format processing
// ---------------------------------------------------------------------------

async function processWall(cards: Card[], cardsById: Map<string, Card>): Promise<MixEntry[]> {
  const gated = rankWall(cards);
  const limited = gated.slice(0, limit ?? gated.length);
  console.log(`\nThe Wall: ${gated.length} gate survivors, processing ${limited.length}`);

  if (dryRun) {
    const built = buildWallRequests(limited, cardsById);
    console.log(`  Requests: ${built.length}, estimated tokens: ${estimateTokensForRequests(built)}`);
    return limited;
  }

  const scored = await scoreWallSurvivors(limited, cards);
  console.log(`  Scored: ${scored.length}/${limited.length}`);
  console.log(
    `  Score distribution — impenetrability avg ${avg(scored.map((s) => s.rubric.impenetrability_score)).toFixed(2)}, ` +
      `landing_line avg ${avg(scored.map((s) => s.rubric.landing_line_score)).toFixed(2)}`,
  );
  printAuthorMix("Author mix", scored);
  await writePool("wall", scored, { submitted: limited.length, succeeded: scored.length });
  return scored;
}

// Pf39c2-social-pilot-02a D01: `processQuestion`/`processObjection`/
// `processStill` were deleted outright along with their formats — the
// channel is one Wall a day, drawn from the Wall pool, nothing else.

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await logger.init("social", verbose, "premises.log");
  logger.info(`score-premises: starting — format=${format}, dryRun=${dryRun}, limit=${limit ?? "none"}`);

  const cards = loadCorpus();
  const cardsById = new Map(cards.map((c) => [c.id, c]));
  logger.info(`score-premises: loaded ${cards.length} cards from corpus`);

  const formats = formatsToRun(format);
  console.log(`Format(s): ${formats.join(", ")}`);
  if (dryRun) console.log("Mode: dry run — no API calls, no files written\n");

  const combined: MixEntry[] = [];

  for (const f of formats) {
    switch (f) {
      case "wall":
        combined.push(...(await processWall(cards, cardsById)));
        break;
    }
  }

  if (!dryRun) {
    console.log(`\nFaithfulness rejections: ${faithfulnessStats.rejected}`);
    if (retryStats.retried > 0) {
      console.log(
        `Retries: ${retryStats.retried} attempted, ${retryStats.recovered} recovered, ` +
          `${retryStats.droppedAfterRetry} dropped even after retry — see content/pipeline/social/parse-failures/ ` +
          `for captured raw responses on any parse-failure drop.`,
      );
    }
    if (combined.length > 0) {
      console.log("\nCombined author mix (across all formats run):");
      const mix = combinedAuthorMix(combined);
      for (const [author, m] of Object.entries(mix)) {
        console.log(`  ${author}: ${m.count} (${(m.share * 100).toFixed(1)}%)`);
      }
    }
  }

  // Cost report — matches generate.ts's own reporting shape.
  const { inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens } = tokenUsage;
  const totalTokens = inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
  if (totalTokens > 0) {
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
  console.error("Scoring failed:", e);
  await logger.close();
  process.exit(1);
});
