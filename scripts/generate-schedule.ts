/**
 * Generate one week of the social schedule (T12).
 *
 * Pf39c2-social-pilot-02a D02: the read-through and the multi-format
 * weighted draw are gone. The channel is one Wall a day, drawn from the
 * Wall pool, nothing else.
 *
 * Reads every prior week's `pilot-schedule-wNN.json` so a card can never be
 * reused, reads the scored Wall pool when present (falling back to the
 * mechanical gate output when T11 hasn't run yet — see
 * `./lib/schedule.ts`'s `loadWallPool`), and writes
 * `<output>/pilot-schedule-wNN.json`. Deterministic: the same --week and
 * --seed, against the same prior weeks and pool, always produce a
 * byte-identical file — no `Date.now()`, no `Math.random()`.
 *
 * Usage:
 *   npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week
 *   npx tsx scripts/generate-schedule.ts --week 2 --seed 42
 *   npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --dry-run
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadCorpus, rankWall } from "./lib/premises.js";
import { generateWeek, loadWallPool, loadPriorWeeks } from "./lib/schedule.js";
import { isReviewComplete, reviewNoteFileName } from "./lib/review.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    week: { type: "string" },
    seed: { type: "string" },
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
  --seed <n>                    RNG seed — same seed + prior weeks = byte-identical output (required)
  --premises-dir <dir>          Scored premise pools directory (default: content/social/premises)
  --exclusions <path>           Renderer-derived Wall exclusion list (F05), written by
                                 social/scripts/write-exclusions.ts (default: <output>/render-exclusions.json).
                                 Optional — if absent, generation proceeds ungated (logged loudly) exactly as
                                 it did before F05.
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
so a card scheduled in an earlier week is never reused.

Pool fallback: reads <premises-dir>/wall.json when present (T11's scored
pool); falls back to the mechanical gate output (rankWall) from the raw
corpus when absent, so this works today, before T11 has run.

Review gate: per the plan's own cadence ("review retention ... then generate
the next week"), generating week N (N > 1) refuses to run unless
<output>/pilot-review-w<N-1>.md exists AND is filled in (built via
scripts/review-week.ts, no placeholder "<TODO>" left in it). Week 1 has no
prior week, so pass --first-week instead. --skip-review-check bypasses the
gate entirely for a deliberate override.`);
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

const premisesDir = args["premises-dir"]!;
const corpusDir = args["corpus-dir"]!;
const outputDir = args.output!;
// F05: default to <output>/render-exclusions.json (the same directory the
// weekly schedules themselves live in) rather than requiring every caller to
// spell it out — still fully overridable via --exclusions, and loadWallPool
// tolerates this path being absent (logged, not fatal).
const exclusionsPath = args.exclusions ?? path.join(outputDir, "render-exclusions.json");
const dryRun = !!args["dry-run"];
const force = !!args.force;

// ---------------------------------------------------------------------------
// The weekly review gate (T14).
//
// The plan's cadence is "Schedule one week at a time. Review retention...
// then generate the next week." — so generating week N (N > 1) refuses to
// run until week N-1's review note (content/social/pilot-review-w<N-1>.md,
// built by scripts/review-week.ts) exists and is actually filled in (see
// ./lib/review.ts's `isReviewComplete` for exactly what "filled in" means).
//
// Pf39c2-social-pilot-02a D02: the note used to also carry the reviewer's
// chosen NEXT WEEK format weights, which became this run's weight defaults —
// there is only one format left (Wall), so there is nothing left to weight;
// this gate is now purely "did you review retention before generating the
// next week", with no weight-carrying step.
//
// Two escape hatches, both explicit (never inferred silently): --first-week
// for week 1 (there is no week 0 to have reviewed), and --skip-review-check
// for a deliberate override on any week.
// ---------------------------------------------------------------------------

async function checkReviewGate(): Promise<void> {
  if (week === 1) {
    if (!args["first-week"]) {
      console.error(
        `Week 1 has no prior week to review. Pass --first-week to acknowledge this and generate week 1 ` +
          `without the review gate.`,
      );
      process.exit(1);
    }
    return;
  }

  if (args["skip-review-check"]) {
    console.error(
      `--skip-review-check set: generating week ${week} WITHOUT checking week ${week - 1}'s review note. ` +
        `This deliberately bypasses the plan's "review, then generate the next week" cadence.`,
    );
    return;
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
        `Replace every "<TODO>" with real metrics, then retry.\n` +
        `(Use --skip-review-check to override this deliberately.)`,
    );
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  await checkReviewGate();

  const cards = loadCorpus(corpusDir);
  const gateWallPool = rankWall(cards);
  const { pool, source, exclusions } = await loadWallPool(premisesDir, gateWallPool, exclusionsPath);

  const { usedCardIds } = await loadPriorWeeks(outputDir, week);

  const schedule = generateWeek({
    weekNumber: week,
    seed,
    cards,
    wallPool: pool,
    poolSource: source,
    priorUsedCardIds: usedCardIds,
    wallExclusions: exclusions?.wall ?? undefined,
  });

  console.log(`Week ${week} (seed ${seed}):`);
  console.log(`  Pool source — wall: ${source}`);
  console.log(`  ${schedule.slots.length} Wall posts scheduled (one per day)`);
  console.log("  Author mix:");
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
  // loadPriorWeeks derives later weeks' exclusion sets from this exact file
  // (see M7 in the PR #39 review). Mirrors review-week.ts's own --force
  // guard on its output file.
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
