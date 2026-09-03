/**
 * TikTok metrics — hand-entry fallback (Pf39c2-social-pilot-03 T13).
 *
 * Task wording, verbatim: "Settle TikTok collection with a SPIKE before
 * building it — attempt the Display API `video.list` against the pilot
 * account with an unaudited app and record what it actually returns.
 * Automate it if it works; fall back to hand entry in the same schema
 * during the weekly session if it does not. Either way, retention stays
 * manual."
 *
 * THIS SESSION HAS NO TIKTOK ACCOUNT AND NO APP CREDENTIALS, so the spike
 * `../metrics/tiktok-spike.ts` exists to run cannot itself be run here —
 * that half is deferred to the user (see `docs/SOCIAL_PILOT.md`'s T13
 * section for the written finding, currently "undetermined, fallback in
 * force"). This file delivers the half of the acceptance criterion this
 * session CAN fully deliver: "... and either a working collector or a
 * documented fallback." This IS that documented fallback, wired all the way
 * through to a real row in the real schema, not a stub.
 *
 * SAME SCHEMA, NOT A SECOND ONE: every row this module builds is a plain
 * `schema.ts` `MetricsRow` with `platform: 'tiktok'`, upserted via
 * `schema.ts`'s own `upsertMetricsRow` — the SAME idempotent helper
 * `collect.ts` calls for Instagram/YouTube. A TikTok row therefore sits
 * alongside Instagram and YouTube rows in the exact same dated
 * `metrics-<date>.json` file `collect.ts` already writes, with no branching
 * for platform anywhere downstream (T14's readout, when it exists, reads
 * one row shape regardless of which platform produced it).
 *
 * WHAT A HUMAN CAN ACTUALLY READ OFF THE APP, AND WHAT THEY CANNOT — per
 * this task's own instruction ("make sure the fallback captures what a
 * human CAN read off the app and marks what they cannot") this module's
 * input shape is deliberately narrow, matching exactly the plan's own
 * Constraint for what the AUTOMATED path would have returned had the spike
 * succeeded: "the Display API (`video.list` scope) returns per-video view/
 * like/comment/share counts." TikTok's own per-video analytics screen shows
 * these same four numbers to a human, so the hand-entry input asks for
 * exactly those four and nothing more:
 *
 *   - `views`, `likes`, `comments`, `shares` — REQUIRED, validated
 *     non-negative integers. These are what a human reads off the app.
 *   - `follows` — ALWAYS `null`. Per the plan's Decision, "per-post follow
 *     attribution exists only on YouTube"; TikTok has no equivalent, on
 *     EITHER candidate read path (the Business Account API's follower data
 *     is an ACCOUNT-level series, not per-video, same shape problem
 *     Instagram already has — see `schema.ts`'s `InstagramFollowerSnapshot`
 *     for the precedent this deliberately does NOT extend to TikTok, since
 *     no TikTok equivalent collector exists yet to consume it). This module
 *     never invites a caller to type a fabricated follows number in.
 *   - `saves` — ALWAYS `null`. Not one of the four counts either TikTok
 *     read path is documented to return, and not on TikTok's per-video
 *     analytics screen either.
 *   - `averagePercentWatched` — retention curves are explicitly called out
 *     by the plan's own Constraint as "in-app only on TikTok regardless —
 *     those stay manual," i.e. out of this schema's scope entirely, not
 *     merely tedious to type in. This module therefore does NOT require it
 *     and defaults it to `null`; it accepts an OPTIONAL override only for
 *     the rare case a human genuinely has a clean percentage to enter,
 *     validated 0-100 the same as every other percentage in this pipeline.
 *
 * FAIL LOUDLY ON A TYPO: hand entry's expected failure mode is a mistyped
 * number, not a network error — `validateHandEnteredTikTokMetrics` throws a
 * specific, field-naming `Error` for every invalid input (negative counts,
 * a non-integer count, an out-of-range percentage, or a `publishedAt`/
 * `collectedAt` that does not parse as a real instant) rather than silently
 * writing a bad row. `buildTikTokMetricsRow`/`recordTikTokHandEntry` always
 * validate first — there is no code path that reaches `upsertMetricsRow`
 * with an unvalidated row.
 *
 * WEEKLY SESSION LOW-FRICTION PATH: `recordTikTokHandEntry` is the one pure
 * function call the weekly session (T07's own staging session, which this
 * task's Timebox note explicitly folds TikTok metrics entry into rather
 * than inventing a second session) needs — feed it the file's current rows
 * and the numbers read off the app, get back the updated rows to write
 * back. This file's own `main()` (bottom) is a thin CLI wrapper around
 * exactly that call, reading/writing the SAME dated file
 * `collect.ts`/`schema.ts`'s `metricsFilePathFor` already names, so running
 * this once per TikTok post during the session is the entire manual
 * workflow — no separate file, no separate format to reconcile later.
 *
 * STALE COUNT NOTE (same issue T07 already flagged and this task's own
 * brief repeats): the phrase "~14 rows a week" in this task's Timebox
 * sentence is stale. It predates `Pf39c2-social-pilot-02a` D02, which
 * collapsed the channel to a SINGLE Wall post per day — one TikTok post a
 * day is 7 rows a week, not 14. Nothing in this file hard-codes either
 * number; it processes exactly one hand-entered post per call, however many
 * calls the actual week's post count requires.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import {
	metricsFilePathFor,
	parseMetricsRows,
	serializeMetricsRows,
	upsertMetricsRow,
	type MetricsRow
} from './schema.js';
import { DEFAULT_METRICS_DIR } from './collect.js';

// ---------------------------------------------------------------------------
// Hand-entry input + validation
// ---------------------------------------------------------------------------

/**
 * One TikTok post's hand-read numbers. See this file's header for exactly
 * why the shape is this narrow, and why `follows`/`saves` are not fields
 * here at all (always `null` in the resulting row, never an input a human
 * could accidentally fabricate a value for).
 */
export interface HandEnteredTikTokMetrics {
	/** TikTok's own video id, as shown in the app/share link. */
	postId: string;
	/** ISO 8601 — the platform's own reported publish instant, read off the app. */
	publishedAt: string;
	views: number;
	likes: number;
	comments: number;
	shares: number;
	/**
	 * Optional. Retention stays manual per the plan's Constraint — see this
	 * file's header. Omit or pass `null` unless a human genuinely has a
	 * clean percentage to record; validated 0-100 when provided.
	 */
	averagePercentWatched?: number | null;
	/** ISO 8601 — when this hand entry was made (distinct from `publishedAt`). */
	collectedAt: string;
}

/** Thrown by `validateHandEnteredTikTokMetrics` — always names the specific bad field, never a generic "invalid input." */
export class TikTokHandEntryValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TikTokHandEntryValidationError';
	}
}

function isValidIsoInstant(value: string): boolean {
	return typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Date.parse(value));
}

/** Non-negative integer check shared by all four required counts — a fractional or negative count is definitionally a typo, not a real reading. */
function isNonNegativeInteger(value: number): boolean {
	return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

/**
 * Validates one hand-entered TikTok reading. Throws
 * `TikTokHandEntryValidationError` naming the exact bad field on the first
 * problem found — this is hand entry, where a typo is the expected failure
 * mode, so failing loudly and specifically beats silently recording (or
 * silently coercing) a bad number.
 */
export function validateHandEnteredTikTokMetrics(input: HandEnteredTikTokMetrics): void {
	if (typeof input.postId !== 'string' || input.postId.trim() === '') {
		throw new TikTokHandEntryValidationError('TikTok hand entry is missing a non-empty "postId".');
	}
	if (!isValidIsoInstant(input.publishedAt)) {
		throw new TikTokHandEntryValidationError(`TikTok hand entry has an invalid "publishedAt" — got "${input.publishedAt}", expected ISO 8601.`);
	}
	if (!isValidIsoInstant(input.collectedAt)) {
		throw new TikTokHandEntryValidationError(`TikTok hand entry has an invalid "collectedAt" — got "${input.collectedAt}", expected ISO 8601.`);
	}

	const counts: Array<[string, number]> = [
		['views', input.views],
		['likes', input.likes],
		['comments', input.comments],
		['shares', input.shares]
	];
	for (const [name, value] of counts) {
		if (!isNonNegativeInteger(value)) {
			throw new TikTokHandEntryValidationError(`TikTok hand entry's "${name}" must be a non-negative whole number — got ${JSON.stringify(value)}.`);
		}
	}

	if (input.averagePercentWatched !== undefined && input.averagePercentWatched !== null) {
		const pct = input.averagePercentWatched;
		if (typeof pct !== 'number' || !Number.isFinite(pct) || pct < 0 || pct > 100) {
			throw new TikTokHandEntryValidationError(`TikTok hand entry's "averagePercentWatched" must be between 0 and 100 — got ${JSON.stringify(pct)}.`);
		}
	}
}

// ---------------------------------------------------------------------------
// Building the row — always in the SAME shared `MetricsRow` schema.
// ---------------------------------------------------------------------------

/**
 * Validates, then builds one `MetricsRow` for a hand-entered TikTok post.
 * `saves`/`follows` are always `null`; `averagePercentWatched` is `null`
 * unless the caller supplied one — see this file's header for why.
 */
export function buildTikTokMetricsRow(input: HandEnteredTikTokMetrics): MetricsRow {
	validateHandEnteredTikTokMetrics(input);
	return {
		platform: 'tiktok',
		postId: input.postId,
		format: 'wall',
		publishedAt: input.publishedAt,
		views: input.views,
		averagePercentWatched: input.averagePercentWatched ?? null,
		likes: input.likes,
		comments: input.comments,
		shares: input.shares,
		saves: null,
		follows: null,
		collectedAt: input.collectedAt
	};
}

/**
 * Validates, builds, and upserts one hand-entered TikTok row into `existing`
 * — the SAME `upsertMetricsRow` helper `collect.ts` uses for Instagram/
 * YouTube, so re-entering the same post (a correction mid-session) replaces
 * its row rather than duplicating it, keyed on `platform:postId` exactly
 * like every other platform.
 */
export function recordTikTokHandEntry(existing: MetricsRow[], input: HandEnteredTikTokMetrics): MetricsRow[] {
	return upsertMetricsRow(existing, buildTikTokMetricsRow(input));
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/tiktok-manual.ts`. Reads and
// writes the SAME dated file `collect.ts` writes
// (`schema.ts`'s `metricsFilePathFor`), so a TikTok row landed via this CLI
// during the weekly session sits alongside whatever Instagram/YouTube rows
// that day's `collect.ts` run already wrote — one file, one schema, no
// reconciliation step. Mirrors `collect.ts`'s own file-read/write and
// argument-parsing conventions (ENOENT -> `[]`, `mkdir` before write, a
// single `--collected-at` default read from the wall clock, guarded so
// importing this module for its exports never parses `process.argv`).
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/tiktok-manual.ts --post-id <id> --published-at <ISO8601> \\
  --views <n> --likes <n> --comments <n> --shares <n> [options]

Records one TikTok post's hand-read metrics into the same dated metrics file
Instagram/YouTube collection writes (content/social/metrics/metrics-<date>.json).
Run once per TikTok post during the weekly staging session (see
plans/Pf39c2-social-pilot-03.md T13 and docs/SOCIAL_PILOT.md). Re-running with
the same --post-id replaces that row rather than duplicating it.

Required:
  --post-id <id>              TikTok's own video id.
  --published-at <ISO8601>    The post's publish instant, read off the app.
  --views <n>       Non-negative whole number.
  --likes <n>       Non-negative whole number.
  --comments <n>    Non-negative whole number.
  --shares <n>      Non-negative whole number.

Optional:
  --avg-percent-watched <n>   0-100. Omit unless the app shows a clean
                              percentage — retention otherwise stays manual.
  --collected-at <ISO8601>    Defaults to the real wall-clock time.
  --out-dir <path>            Defaults to content/social/metrics/.
  --help                      Show this help.`);
}

function parseRequiredNumber(raw: string | undefined, flag: string): number {
	if (raw === undefined) {
		throw new Error(`Missing required flag "${flag}".`);
	}
	const value = Number(raw);
	if (Number.isNaN(value)) {
		throw new Error(`Flag "${flag}" must be a number — got "${raw}".`);
	}
	return value;
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
			'post-id': { type: 'string' },
			'published-at': { type: 'string' },
			views: { type: 'string' },
			likes: { type: 'string' },
			comments: { type: 'string' },
			shares: { type: 'string' },
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

	if (!values['post-id']) {
		throw new Error('Missing required flag "--post-id".');
	}
	if (!values['published-at']) {
		throw new Error('Missing required flag "--published-at".');
	}

	// THE ONE WALL-CLOCK READ IN THIS FILE — mirrors `collect.ts`'s own
	// "DETERMINISM" discipline: `--collected-at` lets an operator override
	// this for a manual re-run against a specific instant.
	const collectedAt = values['collected-at'] ?? new Date().toISOString();
	const outDir = values['out-dir'] ?? DEFAULT_METRICS_DIR;

	const input: HandEnteredTikTokMetrics = {
		postId: values['post-id'],
		publishedAt: values['published-at'],
		views: parseRequiredNumber(values.views, '--views'),
		likes: parseRequiredNumber(values.likes, '--likes'),
		comments: parseRequiredNumber(values.comments, '--comments'),
		shares: parseRequiredNumber(values.shares, '--shares'),
		averagePercentWatched: values['avg-percent-watched'] !== undefined ? Number(values['avg-percent-watched']) : null,
		collectedAt
	};

	const collectionDate = input.publishedAt.slice(0, 10);
	const filePath = metricsFilePathFor(outDir, collectionDate);

	const existing = await readExistingRows(filePath);
	const updated = recordTikTokHandEntry(existing, input);
	await writeRows(filePath, updated);

	console.log(`Recorded TikTok post ${input.postId} into ${filePath} (${updated.length} row(s) total for that date).`);
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `collect.ts`'s own (see its bottom-of-file comment):
// importing this module for its exports (as every test in
// `__tests__/tiktok-manual.test.ts` does) must never itself parse
// `process.argv` as CLI flags or touch the filesystem.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
