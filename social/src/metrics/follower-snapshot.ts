/**
 * Daily Instagram follower-snapshot hand entry (Pb4e17-social-native-scheduling
 * T04) — modelled closely on `hand-entry.ts` (T03), the house style for a
 * small hand-entry CLI: `parseArgs` options, a `printHelp()`, an ENOENT->`[]`
 * read, `mkdir` before write, and the bottom-of-file guard so importing this
 * module for its exports never parses `process.argv`.
 *
 * SAME SCHEMA, NOT A SECOND ONE: this file writes the EXISTING
 * `schema.ts` `FollowerSnapshot` via the EXISTING
 * `upsertFollowerSnapshot` / `parseFollowerSnapshots` /
 * `serializeFollowerSnapshots` / `followersFilePathFor` helpers —
 * no new row shape, no new file convention.
 *
 * TWO PLATFORMS, ONE CLI: `--platform instagram|tiktok` selects which
 * series file is written. Both report followers only at the account level,
 * so both need the same inferred day-over-day delta. YouTube is excluded on
 * purpose, not for want of building — see `validateFollowerSnapshotInput`.
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

import { HandEntryValidationError, toDir, toNumber } from './hand-entry.js';
import {
	DEFAULT_METRICS_DIR,
	FOLLOWER_SNAPSHOT_PLATFORMS,
	followersFilePathFor,
	parseFollowerSnapshots,
	serializeFollowerSnapshots,
	upsertFollowerSnapshot,
	type FollowerSnapshot,
	type FollowerSnapshotPlatform
} from './schema.js';

// ---------------------------------------------------------------------------
// Validation + the pure upsert call — separated from `main()` so tests can
// drive them without the filesystem, matching `hand-entry.ts`'s own split.
// ---------------------------------------------------------------------------

/** One day's hand-read account-level follower total, for one platform. */
export interface FollowerSnapshotInput {
	/** Which platform's series this reading belongs to. */
	platform: FollowerSnapshotPlatform;
	/** ISO calendar date (`YYYY-MM-DD`) this reading is for. */
	date: string;
	followers: number;
}

/** Narrowing guard for `--platform`, mirroring `hand-entry.ts`'s own `VALID_PLATFORMS` check. */
export function isFollowerSnapshotPlatform(value: string): value is FollowerSnapshotPlatform {
	return (FOLLOWER_SNAPSHOT_PLATFORMS as string[]).includes(value);
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
	// YouTube is the trap this check exists for: it IS a `MetricsPlatform`,
	// so `--platform youtube` reads as plausible, but its follow-conversion
	// is exact and per-post (`MetricsRow.follows`). A YouTube series here
	// would be a second, worse source for a number the pilot already has
	// exactly, so it is rejected rather than quietly written to a file
	// nothing reads.
	if (!isFollowerSnapshotPlatform(input.platform)) {
		throw new HandEntryValidationError(
			`Follower snapshot has an invalid "platform" — got ${JSON.stringify(input.platform)}, expected one of ${FOLLOWER_SNAPSHOT_PLATFORMS.join(', ')}. ` +
				`YouTube is deliberately excluded: it reports subscribersGained per video, so its follow-conversion is entered per post via hand-entry.ts and is exact, not inferred.`
		);
	}
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

/** Validates, then builds one `FollowerSnapshot` — the SAME shape `schema.ts`'s own helpers operate on. */
export function buildFollowerSnapshot(input: FollowerSnapshotInput): FollowerSnapshot {
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
	existing: FollowerSnapshot[],
	input: FollowerSnapshotInput
): FollowerSnapshot[] {
	return upsertFollowerSnapshot(existing, buildFollowerSnapshot(input));
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/follower-snapshot.ts`. Reads
// and writes the SAME single `<platform>-followers.json` file
// (`schema.ts`'s `followersFilePathFor`) for the selected platform every
// run — one file per platform for that whole series, not one per date. Guarded so importing this module for
// its exports never parses `process.argv`.
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/follower-snapshot.ts --platform <instagram|tiktok> --date <YYYY-MM-DD> --followers <n> [options]

Records today's account-level follower total for ONE platform into that
platform's series file (content/social/metrics/<platform>-followers.json).
Re-running with the same --platform and --date replaces that date's entry
rather than duplicating it.

RUN THIS TWICE A DAY, ONCE PER PLATFORM — Instagram AND TikTok. Both report
followers only at the account level, so both need this series to convert a
breakout into criterion A. YouTube does NOT: it reports subscribersGained per
video, entered per post via hand-entry.ts, and is exact rather than inferred.

THIS IS THE ONE UN-BACKFILLABLE INPUT IN THE WHOLE PILOT. Every other metric
this pilot records — views, likes, comments, shares — can be read off a past
post weeks later, because the platform keeps that history. Follower count is
different: both apps show only TODAY's total, never a historical series. If
you skip a day, that day's reading is gone forever — there is no "catch up
next week." Skipping a day also has a real, specific cost: follow-conversion
is inferred from daily follower deltas aligned to post times, so a day with no
recorded count degrades that day's conversion reading from "inferred" to
"unavailable" — permanently. And because a delta needs BOTH endpoints, one
missed day breaks TWO posts: that day's and the next.

Take the reading LATE in the day, after the post has gone out, and at roughly
the same hour daily — the hour you read it at is what defines the window each
post's conversion is measured over (docs/SOCIAL_PILOT.md section 5.5).

Required:
  --platform <name>     instagram or tiktok. No default: defaulting would
                        silently file one platform's reading into the other's
                        series, corrupting both with no error.
  --date <YYYY-MM-DD>   The calendar date this reading is for.
  --followers <n>       Non-negative whole number — today's total follower
                        count, read off the app. 0 is a valid, real reading.

Optional:
  --out-dir <path>      Defaults to content/social/metrics/.
  --help                Show this help.`);
}

/** Raw string values as `parseArgs` hands them back — before numeric/required-flag validation. */
interface RawFollowerSnapshotArgs {
	platform?: string;
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
	// Required, with NO default. An earlier version of this CLI was
	// Instagram-only, so defaulting would silently file a TikTok reading
	// into instagram-followers.json — corrupting BOTH series at once, with
	// no error, in a way no later run can untangle (a follower count carries
	// nothing identifying the account it came from).
	if (!raw.platform) {
		throw new Error(`Missing required flag "--platform" (one of ${FOLLOWER_SNAPSHOT_PLATFORMS.join(', ')}).`);
	}
	if (!raw.date) {
		throw new Error('Missing required flag "--date".');
	}
	if (raw.followers === undefined) {
		throw new Error('Missing required flag "--followers".');
	}
	// `toNumber` (shared with `hand-entry.ts`) rejects an empty-or-
	// whitespace-only value outright rather than letting `Number('')`
	// fabricate a real-looking `0` follower count — see its own doc comment.
	const followers = toNumber(raw.followers, '--followers');
	// Cast is safe only because `validateFollowerSnapshotInput` re-checks the
	// platform before anything is written — this function deliberately does
	// not validate VALUES, matching its own doc comment above.
	return { platform: raw.platform as FollowerSnapshotPlatform, date: raw.date, followers };
}

async function readExistingSnapshots(filePath: string): Promise<FollowerSnapshot[]> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		return parseFollowerSnapshots(raw);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

async function writeSnapshots(filePath: string, snapshots: FollowerSnapshot[]): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeFollowerSnapshots(snapshots), 'utf-8');
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			platform: { type: 'string' },
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

	const input = parseFollowerSnapshotArgs({ platform: values.platform, date: values.date, followers: values.followers });
	// `toDir` (shared with `hand-entry.ts`) rejects an empty `--out-dir`
	// outright rather than falling through `?? DEFAULT_METRICS_DIR` — see
	// its own doc comment for why (the string-flag remainder of the
	// `toNumber` empty-value class).
	const outDir = toDir(values['out-dir'], '--out-dir', DEFAULT_METRICS_DIR);

	// Validate BEFORE resolving a path or reading anything: `input.platform`
	// selects which series file is opened, so a bad value must fail before it
	// can name a file. `recordFollowerSnapshot` validates again internally —
	// it is pure and cheap, and it must keep doing so for direct callers.
	validateFollowerSnapshotInput(input);

	const filePath = followersFilePathFor(outDir, input.platform);
	const existing = await readExistingSnapshots(filePath);
	const updated = recordFollowerSnapshot(existing, input);
	await writeSnapshots(filePath, updated);

	console.log(`Recorded ${updated.find((s) => s.date === input.date)?.followerCount} ${input.platform} followers for ${input.date} into ${filePath} (${updated.length} date(s) total).`);
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
