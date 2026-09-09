#!/usr/bin/env node
/**
 * Weekly prep CLI (`Pb4e17-social-native-scheduling` T06): `npx tsx
 * social/src/prepare-week.ts --week <N>`.
 *
 * The runbook's weekly desktop session (plan §5) starts with "render the
 * week" and ends with three browser tabs of manual uploads. §5.2 used to
 * tell the operator to run a staging step that had no actual CLI behind it
 * — `weekly-prep.ts`'s `prepareWeek` existed but nothing invoked it, and it
 * doesn't render on its own anyway (it REQUIRES every day's MP4 to already
 * be on disk). This file is the missing entry point: one command that
 * renders whatever the week still needs, then writes `captions.txt`, so
 * "prepare next week" really is one command.
 *
 * REUSES the render path, never reimplements it: `renderCommand`/
 * `loadWeekSchedule` (`cli.ts`) do the actual rendering and schedule
 * loading; this file only orchestrates across them and `weekly-prep.ts`'s
 * `prepareWeek`.
 *
 * DYNAMIC IMPORT DISCIPLINE (matches `cli.ts`'s own header comment, and the
 * now-deleted `job.ts`'s identical pattern before it): `cli.ts` imports
 * `@remotion/bundler`/`@remotion/renderer` at module top level, so anything
 * that imports `cli.ts` pulls those in too. `defaultRender`/
 * `defaultLoadSchedule` below import `./cli.js` dynamically, inside the
 * function body, not at this file's top level — so importing `prepare-
 * week.ts` for its exports (as `prepare-week.test.ts` does, with `render`/
 * `loadSchedule` both injected via `PrepareWeekDeps`) never loads Remotion
 * at all, and the test suite stays fast.
 *
 * SKIP DAYS ALREADY RENDERED: a render is minutes of CPU. Re-running this
 * command after fixing one day's schedule entry must not redo the whole
 * week — `runPrepareWeek` checks `renderAssetPaths` (via `prepare-week-
 * plan.ts`'s `planWeekPrepare`) for an existing MP4 and skips it, printing
 * that it was skipped. `--force` re-renders every day regardless.
 *
 * `--dry-run` prints the resolved plan (which dates would render, which
 * would be skipped, where `captions.txt` would go) and writes nothing —
 * mirroring `cli.ts`'s own `--dry-run`.
 */

import { parseArgs } from 'node:util';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { planWeekPrepare, resolveWeekDays, type WeekPreparePlan } from './prepare-week-plan.js';
import { prepareWeek as prepareWeekOnDisk, type WeekPrepManifest } from './publish/weekly-prep.js';
import { toDir } from './metrics/hand-entry.js';
import type { WeekSchedule } from './schedule-types.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/**
 * `social/src` -> repo root. Exported (alongside `SCHEDULE_DIR`/
 * `DEFAULT_OUT_DIR` below) so `prepare-week.test.ts` can pin the resolved
 * path directly — F3, `Pb4e17-social-native-scheduling` review round 4: this
 * `path.resolve(moduleDir, '..', '..')` moved into this file in the same
 * diff that introduced it, which is exactly the kind of one-line change a
 * test suite with no assertion on the resolved value would never catch.
 */
export const REPO_ROOT = path.resolve(moduleDir, '..', '..');
export const SCHEDULE_DIR = path.join(REPO_ROOT, 'content', 'social');
export const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'social', 'out');

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/prepare-week.ts --week <N> [options]

Prepares one whole week for the weekly native-scheduling session: renders
every scheduled day that isn't already rendered (reusing cli.ts's render
path — never reimplemented here), then writes a single captions.txt covering
all three platforms (TikTok/Instagram/YouTube) for every day.

Acceptance: one command produces the week's MP4s and one captions file,
ready for the three-tab weekly scheduling session.

Options:
  --week <N>               The schedule week number (required).
  --out <dir>               Output directory (default: social/out/).
  --schedule-dir <dir>      Directory to read pilot-schedule-w<NN>.json from
                           (default: content/social/). Testing/override
                           affordance only, same rationale as cli.ts's own
                           --schedule-dir.
  --force                   Re-render every scheduled day even if its MP4
                           already exists on disk. Without this flag, a day
                           whose MP4 is already there is skipped.
  --dry-run                 Print the resolved plan (which dates would
                           render, which would be skipped, where
                           captions.txt would go); write nothing.
  --help                    Show this help.`);
}

export interface PrepareWeekArgs {
	week: number;
	outDir: string;
	scheduleDir: string;
	dryRun: boolean;
	force: boolean;
}

function parsePrepareWeekArgs(argv: string[]): PrepareWeekArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			week: { type: 'string' },
			out: { type: 'string', default: DEFAULT_OUT_DIR },
			'schedule-dir': { type: 'string', default: SCHEDULE_DIR },
			force: { type: 'boolean', default: false },
			'dry-run': { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	if (!values.week) {
		throw new Error('Specify --week <N>');
	}
	const week = Number(values.week);
	if (!Number.isInteger(week) || week < 1) {
		throw new Error(`--week must be a positive integer, got "${values.week}"`);
	}

	return {
		week,
		// F4 (Pb4e17-social-native-scheduling review round 4) — see
		// `cli.ts`'s identical `toDir` guard on its own `--out`/
		// `--schedule-dir` for why an empty value is rejected outright
		// rather than silently falling through `?? DEFAULT`.
		outDir: toDir(values.out, '--out', DEFAULT_OUT_DIR),
		scheduleDir: toDir(values['schedule-dir'], '--schedule-dir', SCHEDULE_DIR),
		dryRun: Boolean(values['dry-run']),
		force: Boolean(values.force)
	};
}

// ---------------------------------------------------------------------------
// Injectable dependencies — every collaborator `runPrepareWeek` needs is
// injectable, so prepare-week.test.ts never triggers a real Remotion render
// or touches a real schedule file. `buildDefaultDeps` (below) wires the real
// implementations `main()` uses.
// ---------------------------------------------------------------------------

export type RenderFn = (args: { date: string; outDir: string; scheduleDir: string }) => Promise<void>;
export type LoadScheduleFn = (week: number, scheduleDir: string) => Promise<WeekSchedule>;
export type PrepareWeekOnDiskFn = (options: { schedule: WeekSchedule; outDir: string }) => Promise<WeekPrepManifest>;

export interface PrepareWeekLogger {
	info(line: string): void;
}

export interface PrepareWeekDeps {
	loadSchedule: LoadScheduleFn;
	render: RenderFn;
	prepareWeek: PrepareWeekOnDiskFn;
	/** Whether a file exists on disk — `existsSync` for a real run, faked in tests. */
	videoExists: (path: string) => boolean;
	logger: PrepareWeekLogger;
}

// ---------------------------------------------------------------------------
// runPrepareWeek — the orchestration itself
// ---------------------------------------------------------------------------

export interface RunPrepareWeekResult {
	plan: WeekPreparePlan;
	/** Present unless `args.dryRun` — `--dry-run` writes nothing, including no manifest. */
	manifest?: WeekPrepManifest;
}

export async function runPrepareWeek(args: PrepareWeekArgs, deps: PrepareWeekDeps): Promise<RunPrepareWeekResult> {
	const schedule = await deps.loadSchedule(args.week, args.scheduleDir);

	const resolvedDays = resolveWeekDays(schedule, args.outDir);
	const existingVideoPaths = new Set(
		resolvedDays.filter((day) => deps.videoExists(day.videoPath)).map((day) => day.videoPath)
	);
	const plan = planWeekPrepare(schedule, args.outDir, existingVideoPaths, args.force);

	if (args.dryRun) {
		return { plan };
	}

	for (const task of plan.tasks) {
		if (task.action === 'skip') {
			deps.logger.info(`Skipping ${task.date} (${task.cardId}) — already rendered at ${task.videoPath}.`);
			continue;
		}
		deps.logger.info(`Rendering ${task.date} (${task.cardId})...`);
		await deps.render({ date: task.date, outDir: args.outDir, scheduleDir: args.scheduleDir });
	}

	const manifest = await deps.prepareWeek({ schedule, outDir: args.outDir });
	return { plan, manifest };
}

// ---------------------------------------------------------------------------
// Printing — the resolved plan (--dry-run) and the post-run summary telling
// the operator exactly what to do next.
// ---------------------------------------------------------------------------

function printPlan(plan: WeekPreparePlan): void {
	console.log(`Prepare-week plan for week ${plan.week}:`);
	for (const task of plan.tasks) {
		const label = task.action === 'render' ? 'RENDER' : 'skip (already rendered)';
		console.log(`  ${task.date} (${task.cardId}) — ${label} -> ${task.videoPath}`);
	}
	console.log(`  captions.txt -> ${plan.captionsPath}`);
}

function printSummary(plan: WeekPreparePlan, manifest: WeekPrepManifest): void {
	const rendered = plan.tasks.filter((task) => task.action === 'render').length;
	const skipped = plan.tasks.length - rendered;
	console.log(
		`\nWeek ${plan.week} ready: ${plan.tasks.length} MP4(s) in ${path.dirname(manifest.captionsPath)} ` +
			`(${rendered} rendered, ${skipped} already present).`
	);
	console.log(`Captions: ${manifest.captionsPath}`);
	console.log(
		'Next: open TikTok, Instagram, and YouTube Studio\'s own schedulers and, for each day, ' +
			"upload that day's MP4 with the matching caption from captions.txt."
	);
}

// ---------------------------------------------------------------------------
// Real dependencies
// ---------------------------------------------------------------------------

/**
 * Dynamic import (not a top-level one) — see this file's header comment on
 * why: it keeps `@remotion/bundler`/`@remotion/renderer` out of every test
 * that imports `prepare-week.ts` with `render` itself injected.
 */
async function defaultRender(args: { date: string; outDir: string; scheduleDir: string }): Promise<void> {
	const { renderCommand } = await import('./cli.js');
	await renderCommand({ date: args.date, outDir: args.outDir, scheduleDir: args.scheduleDir, dryRun: false });
}

/** Same dynamic-import rationale as `defaultRender` — reuses `cli.ts`'s own schedule-loading/error-message logic verbatim. */
async function defaultLoadSchedule(week: number, scheduleDir: string): Promise<WeekSchedule> {
	const { loadWeekSchedule } = await import('./cli.js');
	return loadWeekSchedule(week, scheduleDir);
}

function buildDefaultDeps(): PrepareWeekDeps {
	return {
		loadSchedule: defaultLoadSchedule,
		render: defaultRender,
		prepareWeek: prepareWeekOnDisk,
		videoExists: existsSync,
		logger: { info: (line: string) => console.log(line) }
	};
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const args = parsePrepareWeekArgs(process.argv.slice(2));
	const deps = buildDefaultDeps();
	const result = await runPrepareWeek(args, deps);

	if (args.dryRun) {
		printPlan(result.plan);
		console.log('\nDry run — no files written.');
		return;
	}

	if (result.manifest) {
		printSummary(result.plan, result.manifest);
	}
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `cli.ts`/`metrics/hand-entry.ts`'s own (see either's
// bottom-of-file comment): importing this module for its exports (as
// prepare-week.test.ts does) must never itself parse `process.argv` as CLI
// flags or call `process.exit()`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
