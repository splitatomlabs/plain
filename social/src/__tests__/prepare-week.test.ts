/**
 * Tests for `../prepare-week.ts` — the weekly prep CLI wrapper
 * (`Pb4e17-social-native-scheduling` T06).
 *
 * `runPrepareWeek` is called directly with every collaborator (`loadSchedule`,
 * `render`, `prepareWeek`, `videoExists`, `logger`) injected via
 * `PrepareWeekDeps` — nothing here triggers a real Remotion render, reads a
 * real schedule file, or writes a real captions.txt. Only `--help` is
 * exercised via a real subprocess (mirrors `cli.test.ts`'s own convention):
 * it exits before `runPrepareWeek` is ever reached, so it never imports
 * `cli.ts` and stays fast.
 */

import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	runPrepareWeek,
	type PrepareWeekArgs,
	type PrepareWeekDeps
} from '../prepare-week.js';
import { renderAssetPaths } from '../cli-plan.js';
import { weekDayToDate } from '../pilot-config.js';
import type { WeekSchedule } from '../schedule-types.js';
import type { WeekPrepManifest } from '../publish/weekly-prep.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..');
const cliPath = path.join(repoRoot, 'social', 'src', 'prepare-week.ts');

const OUT_DIR = '/fake/out';

const SCHEDULE: WeekSchedule = {
	week: 1,
	slots: [
		{
			day: 1,
			card_id: 'meditations-09-025',
			book_slug: 'meditations',
			author_slug: 'marcus-aurelius',
			content: { format: 'wall', original_excerpt: 'excerpt-1', landing_line: 'Landing one.' }
		},
		{
			day: 2,
			card_id: 'on-anger-02-054',
			book_slug: 'on-anger',
			author_slug: 'seneca',
			content: { format: 'wall', original_excerpt: 'excerpt-2', landing_line: 'Landing two.' }
		},
		{
			day: 3,
			card_id: 'discourses-60-001',
			book_slug: 'discourses',
			author_slug: 'epictetus',
			content: { format: 'wall', original_excerpt: 'excerpt-3', landing_line: 'Landing three.' }
		}
	]
};

function videoPathFor(day: number): string {
	const date = weekDayToDate(SCHEDULE.week, day);
	return renderAssetPaths(OUT_DIR, 'wall', date).video;
}

const BASE_ARGS: PrepareWeekArgs = {
	week: 1,
	outDir: OUT_DIR,
	scheduleDir: '/fake/schedule-dir',
	dryRun: false,
	force: false
};

const FAKE_MANIFEST: WeekPrepManifest = {
	week: 1,
	weekStartDate: '2026-09-09',
	days: [],
	captionsPath: `${OUT_DIR}/captions.txt`
};

function makeDeps(overrides: Partial<PrepareWeekDeps> = {}): PrepareWeekDeps {
	return {
		loadSchedule: vi.fn().mockResolvedValue(SCHEDULE),
		render: vi.fn().mockResolvedValue(undefined),
		prepareWeek: vi.fn().mockResolvedValue(FAKE_MANIFEST),
		videoExists: () => false,
		logger: { info: vi.fn() },
		...overrides
	};
}

function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
	try {
		const stdout = execFileSync('npx', ['tsx', cliPath, ...args], {
			cwd: repoRoot,
			encoding: 'utf-8',
			stdio: ['ignore', 'pipe', 'pipe']
		});
		return { status: 0, stdout, stderr: '' };
	} catch (e) {
		const err = e as { status: number | null; stdout: string; stderr: string };
		return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
	}
}

// ---------------------------------------------------------------------------
// runPrepareWeek — rendering, in day order
// ---------------------------------------------------------------------------

describe('runPrepareWeek — renders the right dates, in day order', () => {
	it('invokes render once per scheduled day, in day order, when nothing exists yet', async () => {
		const deps = makeDeps();
		const result = await runPrepareWeek(BASE_ARGS, deps);

		expect(deps.render).toHaveBeenCalledTimes(3);
		const calls = (deps.render as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].date);
		expect(calls).toEqual([weekDayToDate(1, 1), weekDayToDate(1, 2), weekDayToDate(1, 3)]);

		expect(result.plan.tasks.every((t) => t.action === 'render')).toBe(true);
	});

	it('passes outDir and scheduleDir through to each render call', async () => {
		const deps = makeDeps();
		await runPrepareWeek(BASE_ARGS, deps);

		const call = (deps.render as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(call.outDir).toBe(BASE_ARGS.outDir);
		expect(call.scheduleDir).toBe(BASE_ARGS.scheduleDir);
	});
});

// ---------------------------------------------------------------------------
// Skip already-rendered days
// ---------------------------------------------------------------------------

describe('runPrepareWeek — skips already-rendered days', () => {
	it('does not re-render a day whose MP4 already exists', async () => {
		const existing = new Set([videoPathFor(2)]);
		const deps = makeDeps({ videoExists: (p: string) => existing.has(p) });

		const result = await runPrepareWeek(BASE_ARGS, deps);

		expect(deps.render).toHaveBeenCalledTimes(2);
		const renderedDates = (deps.render as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].date);
		expect(renderedDates).not.toContain(weekDayToDate(1, 2));

		const day2 = result.plan.tasks.find((t) => t.day === 2);
		expect(day2?.action).toBe('skip');
	});

	it('logs a skip line for an already-rendered day', async () => {
		const existing = new Set([videoPathFor(1)]);
		const deps = makeDeps({ videoExists: (p: string) => existing.has(p) });

		await runPrepareWeek(BASE_ARGS, deps);

		const infoCalls = (deps.logger.info as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as string);
		expect(infoCalls.some((line) => /skip/i.test(line) && line.includes(weekDayToDate(1, 1)))).toBe(true);
	});

	it('--force re-renders every day even if all MP4s already exist', async () => {
		const existing = new Set([videoPathFor(1), videoPathFor(2), videoPathFor(3)]);
		const deps = makeDeps({ videoExists: (p: string) => existing.has(p) });

		const result = await runPrepareWeek({ ...BASE_ARGS, force: true }, deps);

		expect(deps.render).toHaveBeenCalledTimes(3);
		expect(result.plan.tasks.every((t) => t.action === 'render')).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// --dry-run writes nothing
// ---------------------------------------------------------------------------

describe('runPrepareWeek — --dry-run', () => {
	it('calls neither render nor prepareWeek, and returns no manifest', async () => {
		const deps = makeDeps();
		const result = await runPrepareWeek({ ...BASE_ARGS, dryRun: true }, deps);

		expect(deps.render).not.toHaveBeenCalled();
		expect(deps.prepareWeek).not.toHaveBeenCalled();
		expect(result.manifest).toBeUndefined();
		expect(result.plan.tasks).toHaveLength(3);
	});

	it('still resolves which days would render vs skip', async () => {
		const existing = new Set([videoPathFor(1)]);
		const deps = makeDeps({ videoExists: (p: string) => existing.has(p) });

		const result = await runPrepareWeek({ ...BASE_ARGS, dryRun: true }, deps);

		const byDay = Object.fromEntries(result.plan.tasks.map((t) => [t.day, t.action]));
		expect(byDay[1]).toBe('skip');
		expect(byDay[2]).toBe('render');
	});
});

// ---------------------------------------------------------------------------
// Calls prepareWeek (writes captions.txt) after rendering
// ---------------------------------------------------------------------------

describe('runPrepareWeek — captions', () => {
	it('calls prepareWeek with the loaded schedule and outDir after every render, and returns its manifest', async () => {
		const deps = makeDeps();
		const result = await runPrepareWeek(BASE_ARGS, deps);

		expect(deps.prepareWeek).toHaveBeenCalledWith({ schedule: SCHEDULE, outDir: BASE_ARGS.outDir });
		expect(result.manifest).toBe(FAKE_MANIFEST);
	});

	it('the plan carries the same captionsPath prepareWeek will write to', async () => {
		const deps = makeDeps();
		const result = await runPrepareWeek(BASE_ARGS, deps);

		expect(result.plan.captionsPath).toBe(`${OUT_DIR}/captions.txt`);
	});
});

// ---------------------------------------------------------------------------
// Missing schedule — propagates a clear, path-naming error
// ---------------------------------------------------------------------------

describe('runPrepareWeek — missing schedule file', () => {
	it('propagates loadSchedule\'s error rather than swallowing it, and never renders', async () => {
		const scheduleDir = '/fake/schedule-dir';
		const expectedPath = path.join(scheduleDir, 'pilot-schedule-w01.json');
		const deps = makeDeps({
			loadSchedule: vi.fn().mockRejectedValue(new Error(`No schedule found for week 1: ${expectedPath}`))
		});

		await expect(runPrepareWeek({ ...BASE_ARGS, scheduleDir }, deps)).rejects.toThrow(
			new RegExp(expectedPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
		);
		expect(deps.render).not.toHaveBeenCalled();
		expect(deps.prepareWeek).not.toHaveBeenCalled();
	});
});

// ---------------------------------------------------------------------------
// The real CLI process — --help only (exits before loading a schedule, so
// this never imports cli.ts / Remotion and stays fast).
// ---------------------------------------------------------------------------

describe('--help', () => {
	it('exits 0 and states the acceptance plainly', () => {
		const result = runCli(['--help']);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/--week/);
		expect(result.stdout).toMatch(/captions\.txt/);
		expect(result.stdout).toMatch(/--force/);
		expect(result.stdout).toMatch(/--dry-run/);
		expect(result.stdout.toLowerCase()).toMatch(/one command produces/);
	});
});

describe('missing --week', () => {
	it('fails clearly without needing a schedule at all', () => {
		const result = runCli([]);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--week/);
	});
});
