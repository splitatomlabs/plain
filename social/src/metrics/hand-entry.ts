/**
 * Hand-entered metrics — the shared fallback for all three native-scheduled
 * platforms (Pb4e17-social-native-scheduling T03, generalising
 * Pf39c2-social-pilot-03 T13's `tiktok-manual.ts`).
 *
 * Plan Decision this file implements: the API publish pipeline is gone —
 * every platform now posts through its own native scheduler, by hand, during
 * one weekly desktop session — and with `collect.ts`'s API-backed collectors
 * deleted alongside it, hand entry is no longer TikTok's fallback path, it is
 * the ONLY path for Instagram, YouTube, and TikTok alike. This module used to
 * be TikTok-only (`platform: 'tiktok'` hardcoded, `follows` forced to
 * `null`); both are now real parameters.
 *
 * SAME SCHEMA, NOT A SECOND ONE: every row this module builds is a plain
 * `schema.ts` `MetricsRow`, upserted via `schema.ts`'s own `upsertMetricsRow`
 * — the SAME idempotent helper every platform's row goes through, keyed on
 * `platform:postId` (`schema.ts`'s `metricsRowKey`). A hand-entered row
 * therefore sits alongside every other platform's rows in the exact same
 * dated `metrics-<date>.json` file, with no branching for platform anywhere
 * downstream (`readout.ts` reads one row shape regardless of which platform
 * or which entry method produced it).
 *
 * WHAT A HUMAN CAN ACTUALLY READ OFF EACH APP, AND WHAT THEY CANNOT — this
 * module's required input is deliberately narrow, matching what a human can
 * read off any of the three platforms' own per-post analytics screens:
 *
 *   - `views`, `likes`, `comments`, `shares` — REQUIRED, validated
 *     non-negative integers. These are what a human reads off the app for
 *     any of the three platforms.
 *   - `follows` — a REAL per-post number ONLY on YouTube, where Studio's
 *     per-video "subscribers gained" figure is exact. Read it off Studio and
 *     type it in for a YouTube row. On Instagram and TikTok, no read path —
 *     automated or in-app — attributes a follow to a specific post; leave
 *     `--follows` off entirely for those platforms and the row records
 *     `null`, never a fabricated `0`. (Instagram's account-level follower
 *     series has its own separate structure — `schema.ts`'s
 *     `InstagramFollowerSnapshot` — and is never smuggled into a per-post row
 *     here.)
 *   - `saves` — ALWAYS `null`, on every platform. Not one of the four counts
 *     this module asks for, and not on any of the three platforms' per-post
 *     analytics screens either.
 *   - `averagePercentWatched` — optional on every platform, defaulting to
 *     `null`. Retention curves are in-app only on TikTok and are not part of
 *     what this module requires anywhere; it accepts an OPTIONAL override
 *     only for the rare case a human genuinely has a clean percentage to
 *     enter, validated 0-100 the same as every other percentage in this
 *     pipeline.
 *
 * FAIL LOUDLY ON A TYPO: hand entry's expected failure mode is a mistyped
 * number, not a network error — `validateHandEnteredMetrics` throws a
 * specific, field-naming `Error` for every invalid input (an unrecognised
 * platform, negative counts, a non-integer count, a negative or fractional
 * `follows`, an out-of-range percentage, or a `publishedAt`/`collectedAt`
 * that does not parse as a real instant) rather than silently writing a bad
 * row. `buildHandEnteredMetricsRow`/`recordHandEntry` always validate first —
 * there is no code path that reaches `upsertMetricsRow` with an unvalidated
 * row.
 *
 * WEEKLY SESSION LOW-FRICTION PATH: `recordHandEntry` is the one pure
 * function call the weekly staging session needs — feed it the file's
 * current rows and the numbers read off whichever app, get back the updated
 * rows to write back. This file's own `main()` (bottom) is a thin CLI
 * wrapper around exactly that call, reading/writing the SAME dated file
 * `schema.ts`'s `metricsFilePathFor` names, so running this once per post
 * during the session is the entire manual workflow — one file, one schema,
 * no reconciliation step, no matter which platform posted.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	DEFAULT_METRICS_DIR,
	metricsFilePathFor,
	parseMetricsRows,
	serializeMetricsRows,
	upsertMetricsRow,
	type MetricsPlatform,
	type MetricsRow
} from './schema.js';

// ---------------------------------------------------------------------------
// Hand-entry input + validation
// ---------------------------------------------------------------------------

/**
 * One post's hand-read numbers, for any of the three native-scheduled
 * platforms. See this file's header for exactly why the shape is this
 * narrow, and why `saves` is not a field here at all (always `null` in the
 * resulting row, never an input a human could accidentally fabricate a value
 * for).
 */
export interface HandEnteredMetrics {
	platform: MetricsPlatform;
	/** The platform's own id for this post, as shown in the app/share link. */
	postId: string;
	/** ISO 8601 — the platform's own reported publish instant, read off the app. */
	publishedAt: string;
	views: number;
	likes: number;
	comments: number;
	shares: number;
	/**
	 * Optional. Exact and expected on YouTube (Studio's per-video
	 * "subscribers gained"). Leave omitted or pass `null` on Instagram/TikTok,
	 * where no read path attributes a follow to a specific post — see this
	 * file's header. Validated as a non-negative integer when provided.
	 */
	follows?: number | null;
	/**
	 * Optional. Retention stays manual per the plan's Constraint — see this
	 * file's header. Omit or pass `null` unless a human genuinely has a
	 * clean percentage to record; validated 0-100 when provided.
	 */
	averagePercentWatched?: number | null;
	/** ISO 8601 — when this hand entry was made (distinct from `publishedAt`). */
	collectedAt: string;
}

/** Thrown by `validateHandEnteredMetrics` — always names the specific bad field, never a generic "invalid input." */
export class HandEntryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'HandEntryValidationError';
	}
}

const VALID_PLATFORMS: MetricsPlatform[] = ['instagram', 'youtube', 'tiktok'];

/**
 * Strictly validates an ISO 8601 INSTANT (date + time), not merely a string
 * `Date.parse` happens to accept. `Date.parse` is far more permissive than
 * ISO 8601 — `Date.parse('09/09/2026')` succeeds, silently parsing it as
 * September 9 in the US `M/D/Y` order. `publishedAt` is later sliced to its
 * first 10 characters (`collectionDate`, in `main()` below) to name the
 * dated metrics file; a `Date.parse`-able but non-ISO string like
 * `'09/09/2026'` would slice to the nonsense `'09/09/202'`, silently
 * misfiling the row into a bogus directory that `readout.ts`'s
 * `METRICS_FILENAME_RE` never reads — the post vanishes from the pilot's
 * verdict with no error at all. Requiring the ISO `T` date/time separator up
 * front rejects that whole class of ambiguous date strings outright, for
 * BOTH `publishedAt` and `collectedAt` (this function guards both) — both
 * are documented as ISO 8601 instants, so both must actually be validated as
 * one, even though only `publishedAt` is presently sliced into a file path.
 */
function isValidIsoInstant(value: string): boolean {
	return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && !Number.isNaN(Date.parse(value));
}

/** Non-negative integer check shared by all four required counts (and `follows`) — a fractional or negative count is definitionally a typo, not a real reading. */
function isNonNegativeInteger(value: number): boolean {
	return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Validates one hand-entered reading. Throws `HandEntryValidationError`
 * naming the exact bad field on the first problem found — this is hand
 * entry, where a typo is the expected failure mode, so failing loudly and
 * specifically beats silently recording (or silently coercing) a bad number.
 */
export function validateHandEnteredMetrics(input: HandEnteredMetrics): void {
	if (!VALID_PLATFORMS.includes(input.platform)) {
		throw new HandEntryValidationError(
			`Hand entry has an invalid "platform" — got ${JSON.stringify(input.platform)}, expected one of ${VALID_PLATFORMS.join(', ')}.`
		);
	}
	if (typeof input.postId !== 'string' || input.postId.trim() === '') {
		throw new HandEntryValidationError('Hand entry is missing a non-empty "postId".');
	}
	if (!isValidIsoInstant(input.publishedAt)) {
		throw new HandEntryValidationError(`Hand entry has an invalid "publishedAt" — got "${input.publishedAt}", expected ISO 8601.`);
	}
	if (!isValidIsoInstant(input.collectedAt)) {
		throw new HandEntryValidationError(`Hand entry has an invalid "collectedAt" — got "${input.collectedAt}", expected ISO 8601.`);
	}

	const counts: Array<[string, number]> = [
		['views', input.views],
		['likes', input.likes],
		['comments', input.comments],
		['shares', input.shares]
	];
	for (const [name, value] of counts) {
		if (!isNonNegativeInteger(value)) {
			throw new HandEntryValidationError(`Hand entry's "${name}" must be a non-negative whole number — got ${JSON.stringify(value)}.`);
		}
	}

	if (input.follows !== undefined && input.follows !== null) {
		if (!isNonNegativeInteger(input.follows)) {
			throw new HandEntryValidationError(`Hand entry's "follows" must be a non-negative whole number — got ${JSON.stringify(input.follows)}.`);
		}
	}

	if (input.averagePercentWatched !== undefined && input.averagePercentWatched !== null) {
		const pct = input.averagePercentWatched;
		if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
			throw new HandEntryValidationError(`Hand entry's "averagePercentWatched" must be between 0 and 100 — got ${JSON.stringify(pct)}.`);
		}
	}
}

// ---------------------------------------------------------------------------
// Building the row — always in the SAME shared `MetricsRow` schema.
// ---------------------------------------------------------------------------

/**
 * Validates, then builds one `MetricsRow` for a hand-entered post. `saves`
 * is always `null`; `follows`/`averagePercentWatched` are `null` unless the
 * caller supplied one — see this file's header for why.
 */
export function buildHandEnteredMetricsRow(input: HandEnteredMetrics): MetricsRow {
	validateHandEnteredMetrics(input);
	return {
		platform: input.platform,
		postId: input.postId,
		format: 'wall',
		publishedAt: input.publishedAt,
		views: input.views,
		averagePercentWatched: input.averagePercentWatched ?? null,
		likes: input.likes,
		comments: input.comments,
		shares: input.shares,
		saves: null,
		follows: input.follows ?? null,
		collectedAt: input.collectedAt
	};
}

/**
 * Validates, builds, and upserts one hand-entered row into `existing` — the
 * SAME `upsertMetricsRow` helper every platform's row goes through, so
 * re-entering the same post (a correction mid-session) replaces its row
 * rather than duplicating it, keyed on `platform:postId`.
 */
export function recordHandEntry(existing: MetricsRow[], input: HandEnteredMetrics): MetricsRow[] {
	return upsertMetricsRow(existing, buildHandEnteredMetricsRow(input));
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/hand-entry.ts`. Reads and
// writes the SAME dated file (`schema.ts`'s `metricsFilePathFor`), so a row
// landed via this CLI during the weekly session sits alongside whatever
// other platforms' rows that day's session already recorded — one file, one
// schema, no reconciliation step. Guarded so importing this module for its
// exports never parses `process.argv`.
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/hand-entry.ts --platform <instagram|youtube|tiktok> \\
  --post-id <id> --published-at <ISO8601> \\
  --views <n> --likes <n> --comments <n> --shares <n> [options]

Records one post's hand-read metrics into the same dated metrics file every
platform's row lives in (content/social/metrics/metrics-<date>.json). Run
once per post, per platform, during the weekly native-scheduler session (see
docs/SOCIAL_PILOT.md). Re-running with the same --platform/--post-id
replaces that row rather than duplicating it.

Required:
  --platform <instagram|youtube|tiktok>
                              Which platform this post was published on.
  --post-id <id>              The platform's own id for this post.
  --published-at <ISO8601>    The post's publish instant, read off the app.
  --views <n>       Non-negative whole number.
  --likes <n>       Non-negative whole number.
  --comments <n>    Non-negative whole number.
  --shares <n>      Non-negative whole number.

Optional:
  --follows <n>               Non-negative whole number. Enter this on
                              YouTube — read the per-video "subscribers
                              gained" figure off YouTube Studio, it's exact.
                              Leave this flag off on Instagram/TikTok, where
                              no read path attributes a follow to a specific
                              post; omitting it records null, never a
                              fabricated 0.
  --avg-percent-watched <n>   0-100. Omit unless the app shows a clean
                              percentage — retention otherwise stays manual.
  --collected-at <ISO8601>    Defaults to the real wall-clock time.
  --out-dir <path>            Defaults to content/social/metrics/.
  --help                      Show this help.`);
}

/**
 * Strictly parses one numeric CLI flag's raw string value. `Number('')` and
 * `Number(' ')` both evaluate to `0`, not `NaN` — so an empty flag value
 * (realistically `--follows=$FOLLOWS` with `FOLLOWS` unset in the shell,
 * which expands to `--follows=`) would otherwise fabricate a real-looking
 * `0` rather than failing loudly, the exact bug class this plan already
 * deleted the Instagram collector for. Rejects an empty-or-whitespace-only
 * value outright; a genuinely numeric value with incidental whitespace
 * padding (`--views=" 10 "`) is still accepted, since `Number()` itself
 * already trims a numeric string — only the "nothing here at all" case is
 * the fabrication risk, not padding around a real value. Exported so
 * `follower-snapshot.ts`'s `--followers` goes through the exact same guard
 * rather than a second, possibly-drifting copy.
 */
export function toNumber(raw: string, flag: string): number {
	if (raw.trim() === '') {
		throw new Error(`Flag "${flag}" must be a number — got an empty value.`);
	}
	const value = Number(raw);
	if (Number.isNaN(value)) {
		throw new Error(`Flag "${flag}" must be a number — got "${raw}".`);
	}
	return value;
}

function parseRequiredNumber(raw: string | undefined, flag: string): number {
	if (raw === undefined) {
		throw new Error(`Missing required flag "${flag}".`);
	}
	return toNumber(raw, flag);
}

function isMetricsPlatform(value: string): value is MetricsPlatform {
	return (VALID_PLATFORMS as string[]).includes(value);
}

async function readExistingRows(filePath: string): Promise<MetricsRow[]> {
	try {
		const raw = await readFile(filePath, 'utf-8');
		return parseMetricsRows(raw);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

async function writeRows(filePath: string, rows: MetricsRow[]): Promise<void> {
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, serializeMetricsRows(rows), 'utf-8');
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			platform: { type: 'string' },
			'post-id': { type: 'string' },
			'published-at': { type: 'string' },
			views: { type: 'string' },
			likes: { type: 'string' },
			comments: { type: 'string' },
			shares: { type: 'string' },
			follows: { type: 'string' },
			'avg-percent-watched': { type: 'string' },
			'collected-at': { type: 'string' },
			'out-dir': { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		return;
	}

	if (!values.platform) {
		throw new Error('Missing required flag "--platform".');
	}
	if (!isMetricsPlatform(values.platform)) {
		throw new Error(`Flag "--platform" must be one of ${VALID_PLATFORMS.join(', ')} — got "${values.platform}".`);
	}
	if (!values['post-id']) {
		throw new Error('Missing required flag "--post-id".');
	}
	if (!values['published-at']) {
		throw new Error('Missing required flag "--published-at".');
	}

	// THE ONE WALL-CLOCK READ IN THIS FILE — `--collected-at` lets an
	// operator override this for a manual re-run against a specific instant,
	// same discipline as `readout.ts`'s own `--now`.
	const collectedAt = values['collected-at'] ?? new Date().toISOString();
	const outDir = values['out-dir'] ?? DEFAULT_METRICS_DIR;

	const input: HandEnteredMetrics = {
		platform: values.platform,
		postId: values['post-id'],
		publishedAt: values['published-at'],
		views: parseRequiredNumber(values.views, '--views'),
		likes: parseRequiredNumber(values.likes, '--likes'),
		comments: parseRequiredNumber(values.comments, '--comments'),
		shares: parseRequiredNumber(values.shares, '--shares'),
		// Omitting --follows must record null, never a fabricated 0 — see
		// this file's header on why follows is only ever real on YouTube.
		// An EMPTY --follows (e.g. an unset shell variable) must fail loudly
		// too, not silently fall through Number('') === 0 — see toNumber.
		follows: values.follows !== undefined ? toNumber(values.follows, '--follows') : null,
		averagePercentWatched:
			values['avg-percent-watched'] !== undefined ? toNumber(values['avg-percent-watched'], '--avg-percent-watched') : null,
		collectedAt
	};

	const collectionDate = input.publishedAt.slice(0, 10);
	const filePath = metricsFilePathFor(outDir, collectionDate);

	const existing = await readExistingRows(filePath);
	const updated = recordHandEntry(existing, input);
	await writeRows(filePath, updated);

	console.log(`Recorded ${input.platform} post ${input.postId} into ${filePath} (${updated.length} row(s) total for that date).`);
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `follower-snapshot.ts`'s/`readout.ts`'s own (see their
// bottom-of-file comments): importing this module for its exports (as every
// test in `__tests__/hand-entry.test.ts` does) must never itself parse
// `process.argv` as CLI flags or touch the filesystem.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
