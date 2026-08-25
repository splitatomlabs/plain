/**
 * Create a week's review-note TEMPLATE (T14).
 *
 * Reads that week's already-generated `pilot-schedule-wNN.json` (produced by
 * `scripts/generate-schedule.ts`) and writes an UNFILLED
 * `content/social/pilot-review-wNN.md` beside it — one dated note per week,
 * structured around the pilot's pre-registered success criterion (see
 * `scripts/lib/review.ts`'s module doc comment). A human fills the note in by
 * hand; `scripts/generate-schedule.ts` refuses to generate week N+1 until
 * week N's note exists AND is filled in (`--skip-review-check`/`--first-week`
 * are the documented escape hatches there).
 *
 * The note's date comes from `--date`, not `Date.now()` — keeping this tool
 * as side-effect-pure as everything else in this pipeline: the same
 * `--week`/`--date` always produce the same template (modulo whatever the
 * week's own schedule file happens to contain).
 *
 * Usage:
 *   npx tsx scripts/review-week.ts --week 1 --date 2026-08-25
 *   npx tsx scripts/review-week.ts --week 1 --date 2026-08-25 --force
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { buildReviewNoteTemplate, isValidDateString, reviewNoteFileName } from "./lib/review.js";
import type { WeekSchedule } from "./lib/schedule.js";

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

const { values: args } = parseArgs({
  options: {
    week: { type: "string" },
    date: { type: "string" },
    "schedule-dir": { type: "string", default: "content/social" },
    force: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
});

if (args.help) {
  console.log(`Usage: npx tsx scripts/review-week.ts --week <n> --date <YYYY-MM-DD> [options]

Options:
  --week <n>            Week number to write a review-note template for (required)
  --date <YYYY-MM-DD>   The date this review is being written — supplied by the
                         caller, never Date.now(), so the note stays honest about
                         when it was actually filled in (required)
  --schedule-dir <dir>  Directory holding pilot-schedule-wNN.json; the review
                         note is written beside it as pilot-review-wNN.md
                         (default: content/social)
  --force               Overwrite an existing review note for this week
                         (default: refuse, so a filled-in note is never clobbered)
  --help                Show this help

Requires that week's pilot-schedule-wNN.json already exist (run
scripts/generate-schedule.ts first) — the template embeds that week's own
per-post list, combined author mix, and read-through position.`);
  process.exit(0);
}

if (!args.week) {
  console.error("Specify --week <n>");
  process.exit(1);
}
if (!args.date) {
  console.error("Specify --date <YYYY-MM-DD>");
  process.exit(1);
}

const week = Number(args.week);
if (!Number.isInteger(week) || week < 1) {
  console.error(`Invalid --week "${args.week}" — must be a positive integer.`);
  process.exit(1);
}

if (!isValidDateString(args.date)) {
  console.error(`Invalid --date "${args.date}" — must be a real calendar date in YYYY-MM-DD form.`);
  process.exit(1);
}

const scheduleDir = args["schedule-dir"]!;
const force = !!args.force;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const scheduleFileName = `pilot-schedule-w${String(week).padStart(2, "0")}.json`;
  const scheduleFilePath = path.join(scheduleDir, scheduleFileName);
  if (!existsSync(scheduleFilePath)) {
    console.error(
      `No schedule found for week ${week}: ${scheduleFilePath}\n` +
        `Generate it first: npx tsx scripts/generate-schedule.ts --week ${week} --seed <n>`,
    );
    process.exit(1);
    return;
  }

  const reviewFilePath = path.join(scheduleDir, reviewNoteFileName(week));
  if (existsSync(reviewFilePath) && !force) {
    console.error(`Review note already exists: ${reviewFilePath}\nUse --force to overwrite it (this will discard any data already filled in).`);
    process.exit(1);
    return;
  }

  const schedule = JSON.parse(await readFile(scheduleFilePath, "utf-8")) as WeekSchedule;
  const template = buildReviewNoteTemplate({ week, date: args.date!, schedule, scheduleFilePath });

  await writeFile(reviewFilePath, template, "utf-8");
  console.log(`Wrote ${reviewFilePath}`);
  console.log("Fill in the metrics and decision fields (replace every <TODO>), then re-run generate-schedule.ts for the next week.");
}

main().catch((e) => {
  console.error("review-week failed:", e);
  process.exit(1);
});
