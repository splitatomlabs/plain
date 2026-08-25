/**
 * Generate one week of the social schedule (T12).
 *
 * Reads every prior week's `pilot-schedule-wNN.json` so a card can never be
 * reused, reads the scored premise pools when present (falling back to the
 * mechanical gate output when T11 hasn't run yet — see
 * `./lib/schedule.ts`'s `loadFormatPools`), and writes
 * `<output>/pilot-schedule-wNN.json`. Deterministic: the same --week,
 * --seed and weighting flags, against the same prior weeks and pools,
 * always produce a byte-identical file — no `Date.now()`, no
 * `Math.random()`.
 *
 * Usage:
 *   npx tsx scripts/generate-schedule.ts --week 1 --seed 42
 *   npx tsx scripts/generate-schedule.ts --week 2 --seed 42 --question-weight 8 --objection-weight 2
 *   npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --dry-run
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCorpus, rankWall, questionGate, objectionGate } from "./lib/premises.js";
import {
  generateWeek,
  loadFormatPools,
  loadPriorWeeks,
  DEFAULT_FORMAT_WEIGHTS,
  DEFAULT_MAX_OBJECTION_PER_WEEK,
  SCHEDULE_FORMATS,
  type ScheduleFormat,
  type FormatWeights,
} from "./lib/schedule.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    week: { type: "string" },
    seed: { type: "string" },
    book: { type: "string", default: "enchiridion" },
    "read-through-format": { type: "string" },
    "wall-weight": { type: "string" },
    "question-weight": { type: "string" },
    "objection-weight": { type: "string" },
    "max-objection-per-week": { type: "string" },
    "premises-dir": { type: "string", default: "content/social/premises" },
    output: { type: "string", default: "content/social" },
    "corpus-dir": { type: "string", default: "content/output" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate-schedule.ts --week <n> --seed <n> [options]

Options:
  --week <n>                    Week number to generate (1-based, required)
  --seed <n>                    RNG seed — same seed + weights + prior weeks = byte-identical output (required)
  --book <slug>                 Read-through book (default: enchiridion)
  --read-through-format <fmt>   Force every read-through slot to render as one fixed format
                                (${SCHEDULE_FORMATS.join(", ")}); throws if a card can't render it.
                                Default: unset — each day's read-through slot draws its format
                                from the weights, same as the other slot, with a deterministic
                                per-card fallback when the drawn format doesn't fit that card.
  --wall-weight <n>             Relative weight for The Wall in the daily weighted slot (default: ${DEFAULT_FORMAT_WEIGHTS.wall})
  --question-weight <n>         Relative weight for The Question (default: ${DEFAULT_FORMAT_WEIGHTS.question})
  --objection-weight <n>        Relative weight for The Objection (default: ${DEFAULT_FORMAT_WEIGHTS.objection})
  --max-objection-per-week <n>  Cap on Objection slots per week regardless of weight (default: ${DEFAULT_MAX_OBJECTION_PER_WEEK})
  --premises-dir <dir>          Scored premise pools directory (default: content/social/premises)
  --corpus-dir <dir>            Card corpus directory (default: content/output)
  --output <dir>                Schedule output directory (default: content/social)
  --dry-run                     Print the week's summary; do not write a file
  --help                        Show this help

Reads every prior pilot-schedule-w<NN>.json in --output (w01 .. w<week-1>)
so a card scheduled in an earlier week is never reused, and resumes the
read-through counter where the prior weeks left off.

Pool fallback: reads <premises-dir>/{wall,question,objection}.json when
present (T11's scored pools); falls back to the mechanical gate output
(rankWall/questionGate/objectionGate) from the raw corpus when absent, so
this works today, before T11 has run.`);
  process.exit(0);
}

if (!args.week) {
  console.error("Specify --week <n>");
  process.exit(1);
}
if (!args.seed) {
  console.error("Specify --seed <n>");
  process.exit(1);
}

const week = Number(args.week);
if (!Number.isInteger(week) || week < 1) {
  console.error(`Invalid --week "${args.week}" — must be a positive integer.`);
  process.exit(1);
}

const seed = Number(args.seed);
if (!Number.isInteger(seed)) {
  console.error(`Invalid --seed "${args.seed}" — must be an integer.`);
  process.exit(1);
}

const readThroughFormat = args["read-through-format"] as ScheduleFormat | undefined;
if (readThroughFormat !== undefined && !SCHEDULE_FORMATS.includes(readThroughFormat)) {
  console.error(`Invalid --read-through-format "${readThroughFormat}". Valid: ${SCHEDULE_FORMATS.join(", ")}`);
  process.exit(1);
}

function parseWeight(raw: string | undefined, fallback: number, flagName: string): number {
  if (raw === undefined) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    console.error(`Invalid ${flagName} "${raw}" — must be a non-negative number.`);
    process.exit(1);
  }
  return n;
}

const weights: FormatWeights = {
  wall: parseWeight(args["wall-weight"], DEFAULT_FORMAT_WEIGHTS.wall, "--wall-weight"),
  question: parseWeight(args["question-weight"], DEFAULT_FORMAT_WEIGHTS.question, "--question-weight"),
  objection: parseWeight(args["objection-weight"], DEFAULT_FORMAT_WEIGHTS.objection, "--objection-weight"),
};

const maxObjectionPerWeek = parseWeight(
  args["max-objection-per-week"],
  DEFAULT_MAX_OBJECTION_PER_WEEK,
  "--max-objection-per-week",
);

const book = args.book!;
const premisesDir = args["premises-dir"]!;
const corpusDir = args["corpus-dir"]!;
const outputDir = args.output!;
const dryRun = !!args["dry-run"];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const cards = loadCorpus(corpusDir);

  const gatePools = { wall: rankWall(cards), question: questionGate(cards), objection: objectionGate(cards) };
  const { pools, source } = await loadFormatPools(premisesDir, gatePools);

  const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(outputDir, week);

  const schedule = generateWeek({
    weekNumber: week,
    seed,
    cards,
    pools,
    poolSource: source,
    priorUsedCardIds: usedCardIds,
    readThroughBook: book,
    readThroughStartIndex: readThroughConsumed,
    weights,
    readThroughFormat,
    maxObjectionPerWeek,
  });

  console.log(`Week ${week} (seed ${seed}):`);
  console.log(`  Pool source — wall: ${source.wall}, question: ${source.question}, objection: ${source.objection}`);
  console.log(
    `  Format counts — wall ${schedule.format_counts.wall}, question ${schedule.format_counts.question}, ` +
      `objection ${schedule.format_counts.objection}`,
  );
  console.log(`  Read-through: ${book}, cards ${readThroughConsumed + 1}-${readThroughConsumed + 7} of ${schedule.read_through_total}`);
  console.log("  Author mix (combined, across all formats and the read-through):");
  for (const [author, m] of Object.entries(schedule.author_mix)) {
    console.log(`    ${author}: ${m.count} (${(m.share * 100).toFixed(1)}%)`);
  }

  if (dryRun) {
    console.log("\nDry run — no file written.");
    return;
  }

  await mkdir(outputDir, { recursive: true });
  const fileName = `pilot-schedule-w${String(week).padStart(2, "0")}.json`;
  const filePath = path.join(outputDir, fileName);
  await writeFile(filePath, JSON.stringify(schedule, null, 2) + "\n", "utf-8");
  console.log(`\nWrote ${filePath}`);
}

main().catch((e) => {
  console.error("generate-schedule failed:", e);
  process.exit(1);
});
