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

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCorpus, rankWall } from "./lib/premises.js";
import {
  generateWeek,
  loadFormatPools,
  loadPriorWeeks,
  DEFAULT_FORMAT_WEIGHTS,
  DEFAULT_MAX_OBJECTION_PER_WEEK,
  DEFAULT_READ_THROUGH_BOOK,
  DEFAULT_READ_THROUGH_CHAPTERS,
  SCHEDULE_FORMATS,
  type ScheduleFormat,
  type FormatWeights,
} from "./lib/schedule.js";
import { isReviewComplete, parseReviewNote, reviewNoteFileName } from "./lib/review.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    week: { type: "string" },
    seed: { type: "string" },
    book: { type: "string" },
    "read-through-chapters": { type: "string" },
    "read-through-format": { type: "string" },
    "wall-weight": { type: "string" },
    "question-weight": { type: "string" },
    "objection-weight": { type: "string" },
    "max-objection-per-week": { type: "string" },
    "premises-dir": { type: "string", default: "content/social/premises" },
    exclusions: { type: "string" },
    output: { type: "string", default: "content/social" },
    "corpus-dir": { type: "string", default: "content/output" },
    "dry-run": { type: "boolean", default: false },
    "first-week": { type: "boolean", default: false },
    "skip-review-check": { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/generate-schedule.ts --week <n> --seed <n> [options]

Options:
  --week <n>                    Week number to generate (1-based, required)
  --seed <n>                    RNG seed — same seed + weights + prior weeks = byte-identical output (required)
  --book <slug>                 Read-through book. Default (T16, when neither --book nor
                                --read-through-chapters is given): ${DEFAULT_READ_THROUGH_BOOK}, sliced
                                to chapters ${DEFAULT_READ_THROUGH_CHAPTERS.join(", ")} — 48 cards.
                                Passing --book alone (any value, including ${DEFAULT_READ_THROUGH_BOOK})
                                opts out of that default slice and reads the named book in FULL.
  --read-through-chapters <s>   Comma-separated chapter slugs restricting the read-through to a SLICE
                                of --book, walked in the order given (e.g. book-02,book-03). Default:
                                unset — read through the entire --book, UNLESS --book is also left
                                unset, in which case the coupled T16 default above applies. Throws if
                                a named chapter doesn't exist in --book or if the resulting slice is
                                empty.
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
  --exclusions <path>           Renderer-derived exclusion list (F05/F06) covering all three formats plus the
                                 read-through slice, written by social/scripts/write-exclusions.ts
                                 (default: <output>/render-exclusions.json). Optional — if absent, generation
                                 proceeds ungated (logged loudly) exactly as it did before F05.
  --corpus-dir <dir>            Card corpus directory (default: content/output)
  --output <dir>                Schedule output directory (default: content/social)
  --dry-run                     Print the week's summary; do not write a file
  --first-week                  Required to generate week 1 — an explicit acknowledgement
                                 that there is no prior week to review (see the review gate below)
  --skip-review-check           Deliberately bypass the review gate for week > 1 (logged loudly;
                                 use only when you've reviewed retention some other way)
  --force                       Overwrite an existing pilot-schedule-wNN.json for this week.
                                 Without it, re-running an already-generated week refuses to run —
                                 that file is the authoritative record of what was actually posted,
                                 and later weeks' exclusion sets are derived from it (see loadPriorWeeks).
  --help                        Show this help

Reads every prior pilot-schedule-w<NN>.json in --output (w01 .. w<week-1>)
so a card scheduled in an earlier week is never reused, and resumes the
read-through counter where the prior weeks left off.

Pool fallback: reads <premises-dir>/wall.json when present (T11's scored
pool); falls back to the mechanical gate output (rankWall) from the raw
corpus when absent, so this works today, before T11 has run. Question and
Objection were deleted outright (Pf39c2-social-pilot-02a D01) — the channel
is one Wall a day, drawn from the Wall pool, nothing else — so their pools
are always empty regardless of <premises-dir>'s contents.

Review gate: per the plan's own cadence ("review retention, adjust hooks and
format mix, then generate the next week"), generating week N (N > 1) refuses
to run unless <output>/pilot-review-w<N-1>.md exists AND is filled in (built
via scripts/review-week.ts, no placeholder "<TODO>" left in it). When that
note IS filled in, its "Next week wall/question/objection weight" fields
become this run's weight DEFAULTS (still overridable by
--wall-weight/--question-weight/--objection-weight). Week 1 has no prior
week, so pass --first-week instead. --skip-review-check bypasses the gate
entirely for a deliberate override.`);
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

const readThroughChaptersRaw = args["read-through-chapters"];
const readThroughChapters = readThroughChaptersRaw
  ? readThroughChaptersRaw
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  : undefined;
if (readThroughChaptersRaw !== undefined && (readThroughChapters === undefined || readThroughChapters.length === 0)) {
  console.error(`Invalid --read-through-chapters "${readThroughChaptersRaw}" — must name at least one chapter slug.`);
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

const maxObjectionPerWeek = parseWeight(
  args["max-objection-per-week"],
  DEFAULT_MAX_OBJECTION_PER_WEEK,
  "--max-objection-per-week",
);

// Left `undefined` (not defaulted here) when neither --book nor
// --read-through-chapters is given, so `generateWeek` applies its own
// coupled T16 default (Meditations Books 2-3) — see `GenerateWeekOptions`'s
// doc comment in `./lib/schedule.ts`. Passing --book explicitly always wins.
const book = args.book;
const premisesDir = args["premises-dir"]!;
const corpusDir = args["corpus-dir"]!;
const outputDir = args.output!;
// F05/F06: default to <output>/render-exclusions.json (the same directory
// the weekly schedules themselves live in) rather than requiring every
// caller to spell it out — still fully overridable via --exclusions, and
// loadFormatPools tolerates this path being absent (logged, not fatal).
const exclusionsPath = args.exclusions ?? path.join(outputDir, "render-exclusions.json");
const dryRun = !!args["dry-run"];
const force = !!args.force;

// ---------------------------------------------------------------------------
// The weekly review gate (T14).
//
// The plan's cadence is "Schedule one week at a time. Review retention,
// adjust hooks and format mix, then generate the next week." — so generating
// week N (N > 1) refuses to run until week N-1's review note
// (content/social/pilot-review-w<N-1>.md, built by scripts/review-week.ts)
// exists and is actually filled in (see ./lib/review.ts's `isReviewComplete`
// for exactly what "filled in" means). When it is, the note's own chosen
// "Next week wall/question/objection weight" fields become this run's weight
// DEFAULTS — the deliberate weighting decision the reviewer made carries
// forward automatically, while --wall-weight etc. can still override it
// explicitly for this one run.
//
// Two escape hatches, both explicit (never inferred silently): --first-week
// for week 1 (there is no week 0 to have reviewed), and --skip-review-check
// for a deliberate override on any week.
// ---------------------------------------------------------------------------

async function resolveBaseWeights(): Promise<FormatWeights> {
  if (week === 1) {
    if (!args["first-week"]) {
      console.error(
        `Week 1 has no prior week to review. Pass --first-week to acknowledge this and generate week 1 ` +
          `without the review gate.`,
      );
      process.exit(1);
    }
    return DEFAULT_FORMAT_WEIGHTS;
  }

  if (args["skip-review-check"]) {
    console.error(
      `--skip-review-check set: generating week ${week} WITHOUT checking week ${week - 1}'s review note. ` +
        `This deliberately bypasses the plan's "review, then generate the next week" cadence.`,
    );
    return DEFAULT_FORMAT_WEIGHTS;
  }

  const priorWeek = week - 1;
  const reviewPath = path.join(outputDir, reviewNoteFileName(priorWeek));
  if (!existsSync(reviewPath)) {
    console.error(
      `Missing review note for week ${priorWeek}: ${reviewPath}\n` +
        `Review week ${priorWeek}'s retention data first:\n` +
        `  npx tsx scripts/review-week.ts --week ${priorWeek} --date <YYYY-MM-DD>\n` +
        `then fill in the metrics and decision fields, and retry this command.\n` +
        `(Use --skip-review-check to override this deliberately.)`,
    );
    process.exit(1);
  }

  const content = await readFile(reviewPath, "utf-8");
  if (!isReviewComplete(content)) {
    console.error(
      `Review note for week ${priorWeek} exists but is not filled in yet: ${reviewPath}\n` +
        `Replace every "<TODO>" with real metrics and a real next-week decision, then retry.\n` +
        `(Use --skip-review-check to override this deliberately.)`,
    );
    process.exit(1);
  }

  const parsed = parseReviewNote(content);
  if (parsed.nextWeekWeights) {
    console.log(
      `Using week ${priorWeek}'s reviewed weights as this run's defaults: ` +
        `wall=${parsed.nextWeekWeights.wall}, question=${parsed.nextWeekWeights.question}, ` +
        `objection=${parsed.nextWeekWeights.objection} (still overridable via --wall-weight etc.)`,
    );
    return parsed.nextWeekWeights;
  }
  return DEFAULT_FORMAT_WEIGHTS;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const baseWeights = await resolveBaseWeights();

  const weights: FormatWeights = {
    wall: parseWeight(args["wall-weight"], baseWeights.wall, "--wall-weight"),
    question: parseWeight(args["question-weight"], baseWeights.question, "--question-weight"),
    objection: parseWeight(args["objection-weight"], baseWeights.objection, "--objection-weight"),
  };

  const cards = loadCorpus(corpusDir);

  // Pf39c2-social-pilot-02a D01: Question and Objection were deleted
  // outright (the channel is one Wall a day, drawn from the Wall pool,
  // nothing else) — `questionGate`/`objectionGate` no longer exist, so these
  // two pools are always empty. `./lib/schedule.ts`'s `FormatPools` shape
  // (and the weighted-format machinery that consumes it) still exists,
  // restructuring it away is D02's job, not this one's.
  const gatePools = { wall: rankWall(cards), question: [], objection: [] };
  const { pools, source, exclusions } = await loadFormatPools(premisesDir, gatePools, exclusionsPath);

  const { usedCardIds, readThroughConsumed } = await loadPriorWeeks(outputDir, week);

  const schedule = generateWeek({
    weekNumber: week,
    seed,
    cards,
    pools,
    poolSource: source,
    priorUsedCardIds: usedCardIds,
    readThroughBook: book,
    readThroughChapters,
    readThroughStartIndex: readThroughConsumed,
    weights,
    readThroughFormat,
    maxObjectionPerWeek,
    readThroughExclusions: exclusions?.readThrough ?? undefined,
    stillExclusions: exclusions?.still ?? undefined,
  });

  console.log(`Week ${week} (seed ${seed}):`);
  console.log(`  Pool source — wall: ${source.wall}, question: ${source.question}, objection: ${source.objection}`);
  console.log(
    `  Format counts — wall ${schedule.format_counts.wall}, question ${schedule.format_counts.question}, ` +
      `objection ${schedule.format_counts.objection}, still ${schedule.format_counts.still}`,
  );
  console.log(`  Read-through: ${schedule.read_through_book}, cards ${readThroughConsumed + 1}-${readThroughConsumed + 7} of ${schedule.read_through_total}`);
  console.log("  Author mix (combined, across all formats and the read-through):");
  for (const [author, m] of Object.entries(schedule.author_mix)) {
    console.log(`    ${author}: ${m.count} (${(m.share * 100).toFixed(1)}%)`);
  }

  if (dryRun) {
    console.log("\nDry run — no file written.");
    return;
  }

  const fileName = `pilot-schedule-w${String(week).padStart(2, "0")}.json`;
  const filePath = path.join(outputDir, fileName);

  // Refuse to clobber an already-posted week's authoritative record —
  // loadPriorWeeks derives later weeks' exclusion sets and read-through
  // position from this exact file (see M7 in the PR #39 review). Mirrors
  // review-week.ts's own --force guard on its output file.
  if (existsSync(filePath) && !force) {
    console.error(
      `Week ${week} schedule already exists: ${filePath}\n` +
        `Use --force to overwrite it (this discards the record of what was actually posted for that week ` +
        `and can desynchronize later weeks' exclusion sets).`,
    );
    process.exit(1);
    return;
  }

  await mkdir(outputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(schedule, null, 2) + "\n", "utf-8");
  console.log(`\nWrote ${filePath}`);
}

main().catch((e) => {
  console.error("generate-schedule failed:", e);
  process.exit(1);
});
