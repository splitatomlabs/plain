/**
 * Score the corpus into per-format social premise pools (T10).
 *
 * Gates the 1,615-card corpus (via ./lib/premises.ts), submits only gate
 * survivors to the three LLM rubrics (via ./lib/premises-batch.ts), enforces
 * faithfulness (T09), and writes one pool JSON per format to --output.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx scripts/score-premises.ts --format all
 *   npx tsx scripts/score-premises.ts --dry-run --limit 5
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import type { AuthorSlug } from "./lib/constants.js";
import type { Card } from "./lib/types.js";
import {
  loadCorpus,
  rankWall,
  questionGate,
  objectionGate,
  mechanicalGates,
  authorMix,
  combinedAuthorMix,
} from "./lib/premises.js";
import {
  buildWallRequests,
  buildQuestionRequests,
  buildObjectionRequests,
  scoreWallSurvivors,
  scoreQuestionSurvivors,
  scoreObjectionSurvivors,
  faithfulnessStats,
  type BuiltRequest,
} from "./lib/premises-batch.js";
import { tokenUsage, batchStats } from "./lib/claude.js";
import { logger } from "./lib/logger.js";
import { VALID_FORMATS, isValidFormat, formatsToRun, parseLimit, type Format } from "./lib/premises-cli.js";

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
  --help             Show this help

Environment:
  ANTHROPIC_API_KEY   Required unless --dry-run is set

Note on --format still: The Still has no LLM rubric — it is the 12-word
still-image pattern interrupt, and T01's still12Word mechanical gate is all
there is. --format still (and --format all) reports that gate's pool as
gate-only; no request is ever built or submitted for it.

Logs are written to content/pipeline/social/premises.log on every run.`);
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

function stillEntries(cards: Card[], cardsById: Map<string, Card>): MixEntry[] {
  const ids = mechanicalGates(cards).still12Word.ids;
  return ids
    .map((id) => cardsById.get(id))
    .filter((c): c is Card => !!c)
    .map((c) => ({ card_id: c.id, book_slug: c.book_slug, author_slug: c.author_slug }));
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

async function writePool(name: string, entries: unknown[]): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  const filePath = path.join(outputDir, `${name}.json`);
  await writeFile(filePath, JSON.stringify(entries, null, 2) + "\n", "utf-8");
  console.log(`  Wrote ${entries.length} entries to ${filePath}`);
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
  await writePool("wall", scored);
  return scored;
}

async function processQuestion(cards: Card[], cardsById: Map<string, Card>): Promise<MixEntry[]> {
  const gated = questionGate(cards);
  const limited = gated.slice(0, limit ?? gated.length);
  console.log(`\nThe Question: ${gated.length} gate survivors, processing ${limited.length}`);

  if (dryRun) {
    const built = buildQuestionRequests(limited);
    console.log(`  Requests: ${built.length}, estimated tokens: ${estimateTokensForRequests(built)}`);
    return limited;
  }

  const scored = await scoreQuestionSurvivors(limited, cards);
  const answers = scored.filter((s) => s.drift_verdict === "answers").length;
  const drifts = scored.filter((s) => s.drift_verdict === "drifts").length;
  console.log(`  Scored: ${scored.length}/${limited.length}`);
  console.log(`  Score distribution — answers ${answers}, drifts ${drifts}`);
  printAuthorMix("Author mix", scored);
  await writePool("question", scored);
  return scored;
}

async function processObjection(cards: Card[], cardsById: Map<string, Card>): Promise<MixEntry[]> {
  const gated = objectionGate(cards);
  const limited = gated.slice(0, limit ?? gated.length);
  console.log(`\nThe Objection: ${gated.length} gate survivors, processing ${limited.length}`);

  if (dryRun) {
    const built = buildObjectionRequests(limited, cardsById);
    console.log(`  Requests: ${built.length}, estimated tokens: ${estimateTokensForRequests(built)}`);
    return limited;
  }

  const scored = await scoreObjectionSurvivors(limited, cards);
  const accepted = scored.filter((s) => s.rubric.verdict === "accept").length;
  const rejected = scored.filter((s) => s.rubric.verdict === "reject").length;
  console.log(`  Scored: ${scored.length}/${limited.length}`);
  console.log(`  Score distribution — accept ${accepted}, reject ${rejected}`);
  printAuthorMix("Author mix", scored);
  await writePool("objection", scored);
  return scored;
}

/**
 * The Still has no LLM rubric — it is the 12-word still-image pattern
 * interrupt, and T01's `still12Word` mechanical gate is all there is. This
 * always reports and (on a real run) writes the gate's own pool; it never
 * builds or submits a request, dry-run or not.
 */
async function processStill(cards: Card[], cardsById: Map<string, Card>): Promise<MixEntry[]> {
  const gated = stillEntries(cards, cardsById);
  const limited = gated.slice(0, limit ?? gated.length);
  console.log(
    `\nThe Still: ${gated.length} gate survivors, processing ${limited.length} — ` +
      `gate-only, no LLM rubric exists for this format (T01's still12Word mechanical gate is all there is).`,
  );

  if (!dryRun) {
    printAuthorMix("Author mix", limited);
    await writePool("still", limited);
  }
  return limited;
}

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
      case "question":
        combined.push(...(await processQuestion(cards, cardsById)));
        break;
      case "objection":
        combined.push(...(await processObjection(cards, cardsById)));
        break;
      case "still":
        combined.push(...(await processStill(cards, cardsById)));
        break;
    }
  }

  if (!dryRun) {
    console.log(`\nFaithfulness rejections: ${faithfulnessStats.rejected}`);
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
