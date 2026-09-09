/**
 * Daily Instagram follower-snapshot hand entry (Pb4e17-social-native-scheduling
 * T04) — modelled closely on `hand-entry.ts` (T03), the house style for a
 * small hand-entry CLI: `parseArgs` options, a `printHelp()`, an ENOENT->`[]`
 * read, `mkdir` before write, and the bottom-of-file guard so importing this
 * module for its exports never parses `process.argv`.
 *
 * SAME SCHEMA, NOT A SECOND ONE: this file writes the EXISTING
 * `schema.ts` `InstagramFollowerSnapshot` via the EXISTING
 * `upsertFollowerSnapshot` / `parseFollowerSnapshots` /
 * `serializeFollowerSnapshots` / `instagramFollowersFilePathFor` helpers —
 * no new row shape, no new file convention.
 *
 * THE ONE UN-BACKFILLABLE INPUT: every other metric this pilot records is
 * backfillable — a human can open Studio or the app weeks later and read
 * views/likes/comments off a past post. A daily follower count is not:
 * Instagram's app shows only TODAY's follower total, never a historical
 * series, so a day this CLI is not run for is a day that reading is gone
 * permanently, with no way to recover it later. Instagram's follow-conversion
 * (criterion A's conversion half, `readout.ts`) is *inferred* from daily
 * follower deltas aligned to post times — per the plan's Decision, a day the
 * follower count is not recorded degrades that day's conversion reading from
 * `inferred` to `unavailable`. `printHelp()` below states this plainly so the
 * person running the weekly session understands why this one integer, alone
 * among everything else this pilot records, cannot wait.
 *
 * NEVER FABRICATE: a follower count of `0` is a real reading (an empty
 * account) and is preserved as `0`, never treated as "missing" — this file
 * never substitutes a default or a null for a value the caller actually
 * supplied. `validateFollowerSnapshotInput` throws a field-naming error
 * (reusing `hand-entry.ts`'s `HandEntryValidationError` — the fit is natural,
 * this is hand entry same as that file, and duplicating an identical error
 * class for a second hand-entry CLI would be its own kind of drift) rather
 * than silently coercing a bad input.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { HandEntryValidationError } from './hand-entry.js';
import {
	DEFAULT_METRICS_DIR,
	instagramFollowersFilePathFor,
	parseFollowerSnapshots,
	serializeFollowerSnapshots,
	upsertFollowerSnapshot,
	type InstagramFollowerSnapshot
} from './schema.js';

// ---------------------------------------------------------------------------
// Validation + the pure upsert call — separated from `main()` so tests can
// drive them without the filesystem, matching `hand-entry.ts`'s own split.
// ---------------------------------------------------------------------------

/** One day's hand-read Instagram follower total. */
export interface FollowerSnapshotInput {
	/** ISO calendar date (`YYYY-MM-DD`) this reading is for. */
	date: string;
	followers: number;
}

/** Non-negative integer check — a fractional or negative count is definitionally a typo, not a real reading (mirrors `hand-entry.ts`'s own check). */
function isNonNegativeInteger(value: number): boolean {
	return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Whether `value` is a real `YYYY-MM-DD` calendar date — rejects malformed
 * strings (`not-a-date`), non-existent dates (`2026-13-45`), and
 * non-zero-padded forms (`2026-9-9`) alike, since all three would otherwise
 * silently misfile a reading under the wrong (or no) date.
 */
function isValidCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/**
 * Validates one hand-entered follower reading. Throws
 * `HandEntryValidationError` naming the exact bad field — same discipline as
 * `hand-entry.ts`: a typo is the expected failure mode here, so failing
 * loudly and specifically beats silently recording a bad number.
 */
export function validateFollowerSnapshotInput(input: FollowerSnapshotInput): void {
	if (!isValidCalendarDate(input.date)) {
		throw new HandEntryValidationError(
			`Follower snapshot has an invalid "date" — got ${JSON.stringify(input.date)}, expected a real calendar date in YYYY-MM-DD form.`
		);
	}
	if (!isNonNegativeInteger(input.followers)) {
		throw new HandEntryValidationError(
			`Follower snapshot's "followers" must be a non-negative whole number — got ${JSON.stringify(input.followers)}.`
		);
	}
}

/** Validates, then builds one `InstagramFollowerSnapshot` — the SAME shape `schema.ts`'s own helpers operate on. */
export function buildFollowerSnapshot(input: FollowerSnapshotInput): InstagramFollowerSnapshot {
	validateFollowerSnapshotInput(input);
	return { date: input.date, followerCount: input.followers };
}

/**
 * Validates, builds, and upserts one day's follower snapshot into `existing`
 * — the SAME `upsertFollowerSnapshot` helper `schema.ts` already exports, so
 * re-recording the same date (a same-session correction) REPLACES that
 * date's entry rather than duplicating it.
 */
export function recordFollowerSnapshot(
	existing: InstagramFollowerSnapshot[],
	input: FollowerSnapshotInput
): InstagramFollowerSnapshot[] {
	return upsertFollowerSnapshot(existing, buildFollowerSnapshot(input));
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/follower-snapshot.ts`. Reads
// and writes the SAME single `instagram-followers.json` file
// (`schema.ts`'s `instagramFollowersFilePathFor`) every run — one file for
// the whole series, not one per date. Guarded so importing this module for
// its exports never parses `process.argv`.
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/follower-snapshot.ts --date <YYYY-MM-DD> --followers <n> [options]

Records today's Instagram account-level follower total into the one series
file every day's reading lives in (content/social/metrics/instagram-followers.json).
Re-running with the same --date replaces that date's entry rather than
duplicating it.

THIS IS THE ONE UN-BACKFILLABLE INPUT IN THE WHOLE PILOT. Every other metric
this pilot records — views, likes, comments, shares — can be read off a past
post weeks later, because the platform keeps that history. Follower count is
different: Instagram's app shows only TODAY's total, never a historical
series. If you skip a day, that day's reading is gone forever — there is no
"catch up next week." Skipping a day also has a real, specific cost: Instagram's
follow-conversion is inferred from daily follower deltas aligned to post
times, so a day with no recorded follower count degrades that day's
conversion reading from "inferred" to "unavailable" — permanently, for that
day. Run this once, every day, ideally at the same time of day.

Required:
  --date <YYYY-MM-DD>   The calendar date this reading is for.
  --followers <n>       Non-negative whole number — today's total follower
                        count, read off the app. 0 is a valid, real reading.

Optional:
  --out-dir <path>      Defaults to content/social/metrics/.
  --help                Show this help.`);
}

/** Raw string values as `parseArgs` hands them back — before numeric/required-flag validation. */
interface RawFollowerSnapshotArgs {
	date?: string;
	followers?: string;
}

/**
 * Validates presence of both required flags and parses `--followers` to a
 * number, throwing a plain `Error` naming the missing/malformed flag —
 * mirrors `readout.ts`'s own `parseBreakoutThreshold`, which is exported and
 * unit-tested the same way rather than only exercised through a subprocess.
 * Does NOT validate the date/followers VALUES beyond "is this a number" —
 * that is `validateFollowerSnapshotInput`'s job, run once inside
 * `recordFollowerSnapshot`.
 */
export function parseFollowerSnapshotArgs(raw: RawFollowerSnapshotArgs): FollowerSnapshotInput {
	if (!raw.date) {
		throw new Error('Missing required flag "--date".');
	}
	if (raw.followers === undefined) {
		throw new Error('Missing required flag "--followers".');
	}
	const followers = Number(raw.followers);
	if (Number.isNaN(followers)) {
		throw new Error(`Flag "--followers" must be a number — got "${raw.followers}".`);
	}
	return { date: raw.date, followers };
}

async function readExistingSnapshots(filePath: string): Promise<InstagramFollowerSnapshot[]> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		return parseFollowerSnapshots(raw);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

async function writeSnapshots(filePath: string, snapshots: InstagramFollowerSnapshot[]): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeFollowerSnapshots(snapshots), 'utf-8');
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			date: { type: 'string' },
			followers: { type: 'string' },
			'out-dir': { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		return;
	}

	const input = parseFollowerSnapshotArgs({ date: values.date, followers: values.followers });
	const outDir = values['out-dir'] ?? DEFAULT_METRICS_DIR;
	const filePath = instagramFollowersFilePathFor(outDir);

	const existing = await readExistingSnapshots(filePath);
	const updated = recordFollowerSnapshot(existing, input);
	await writeSnapshots(filePath, updated);

	console.log(`Recorded ${updated.find((s) => s.date === input.date)?.followerCount} followers for ${input.date} into ${filePath} (${updated.length} date(s) total).`);
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `hand-entry.ts`'s own: importing this module for its
// exports (as every test in `__tests__/follower-snapshot.test.ts` does) must
// never itself parse `process.argv` as CLI flags or touch the filesystem.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
