/**
 * The metrics collection run entry point (Pf39c2-social-pilot-03 T12).
 *
 * Task wording: "Poll for 30 days after publication, since metrics keep
 * accruing... it needs to know each post's publish date." This module picks
 * ONE source per platform, justified below, rather than inventing a third
 * shape:
 *
 *   - **YouTube -> `content/social/pending-youtube-flips.json`** (T08's own
 *     file, parsed here via `job-plan.ts`'s `parsePendingFlips` — reused,
 *     not reimplemented). `job.ts`'s own header explains why this file
 *     exists at all: it is "the only place that calls
 *     `uploadVideoToYouTube` and therefore the only place that learns a
 *     real video id," so it is exactly and only the record of which videos
 *     the pilot actually uploaded and when. It is durable (committed JSON,
 *     not the ephemeral `--out` render directory) and already carries the
 *     one piece of information this module cannot get any other way: the
 *     real YouTube video id.
 *
 *   - **Instagram -> Instagram's OWN media list, not a local record.**
 *     Neither candidate local source fits: the pending-flips file is
 *     YouTube-only by construction (see the quote above — nothing in
 *     `job.ts` ever learns or persists an Instagram media id; `job.ts`'s
 *     `publishInstagramOutcome` only puts the media id into a log line's
 *     `message` string, never into a durable record), and extending
 *     `job.ts` to add one is out of this task's own Files scope
 *     (`social/src/metrics/` and `content/social/metrics/*.json` only —
 *     see the plan). The metadata sidecar (`render/post-metadata.ts`) is
 *     unusable for a second, independent reason even if it were in scope:
 *     it lives beside the rendered asset in the ephemeral, gitignored
 *     `--out` directory, not a durable location, and it records only
 *     `card_id`/`format`/`rendered_at` — never a platform post id for
 *     EITHER platform, only what was rendered, not what was actually
 *     published or under what live id. Rather than block this task on a
 *     job.ts change, Instagram's own `GET /{ig-user-id}/media` list (each
 *     item already carrying its own `timestamp`, per
 *     `metrics/instagram.ts`'s `listInstagramMedia`) is authoritative for
 *     which Instagram posts exist and when they went live — the platform is
 *     definitionally never wrong about its own publish instant, where a
 *     local record could drift (a manual repost, or a run where Instagram's
 *     publish actually succeeded after `job.ts` reported a false failure).
 *
 * IDEMPOTENCY — the acceptance criterion, verbatim: "a run appends a dated
 * file with one row per live post, and re-running is idempotent rather than
 * duplicating rows." One file per collection DATE
 * (`content/social/metrics/metrics-<date>.json`, via `schema.ts`'s
 * `metricsFilePathFor`); a re-run for the same date reads the existing file,
 * UPSERTS each freshly-fetched row by `platform:postId` (`schema.ts`'s
 * `upsertMetricsRow`), and writes the merged result back — never appending a
 * second row for a post already in the file. The follower-snapshot file
 * (`instagram-followers.json`) follows the identical discipline, keyed by
 * calendar date instead of post id.
 *
 * PLATFORM ISOLATION: mirrors `job.ts`'s own reasoning — an Instagram outage
 * must not prevent YouTube's rows from being collected, and vice versa, and
 * a follower-snapshot failure must not prevent per-post rows from being
 * written. Each platform's whole sequence is wrapped in its own try/catch;
 * a failure is logged via the injected `logger`, never thrown out of
 * `runMetricsCollection`, so a partial platform outage still leaves the
 * dated file up to date for whichever platform succeeded.
 *
 * DETERMINISM: `now` (the collection instant) is an explicit, caller-
 * supplied parameter — nothing in this module calls `Date.now()`/
 * `new Date()`. The ONE real wall-clock read for a production run belongs
 * in this file's own CLI entry point (`main()`, bottom of this file),
 * clearly commented at its single call site, matching `job.ts`'s and
 * `tokens.ts`'s own determinism discipline.
 *
 * Never logs a token — `InstagramMetricsConfig.accessToken`/
 * `YouTubeMetricsConfig.accessToken` are passed straight through to
 * `metrics/instagram.ts`/`metrics/youtube.ts`, which already hold
 * themselves to the "never log" bar; this file adds no new place either
 * value could leak (it never logs a whole config object, only fixed
 * strings, dates, ids, and `errorMessage(error)`).
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
	instagramFollowersFilePathFor,
	metricsFilePathFor,
	parseFollowerSnapshots,
	parseMetricsRows,
	serializeFollowerSnapshots,
	serializeMetricsRows,
	upsertFollowerSnapshot,
	upsertMetricsRow,
	type InstagramFollowerSnapshot,
	type MetricsRow
} from './schema.js';
import { collectInstagramRows, fetchInstagramFollowerSnapshot, type InstagramMetricsConfig, type FetchFn as InstagramFetchFn } from './instagram.js';
import { collectYouTubeRows, type YouTubeMetricsConfig, type FetchFn as YouTubeFetchFn } from './youtube.js';
import { parsePendingFlips } from '../job-plan.js';
import type { PendingYouTubeFlip } from '../publish/tiktok-manual.js';
import { createFirestoreTokenStore } from '../publish/token-store-firestore.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/metrics` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..', '..');
const DEFAULT_METRICS_DIR = path.join(REPO_ROOT, 'content', 'social', 'metrics');
const DEFAULT_PENDING_FLIPS_PATH = path.join(REPO_ROOT, 'content', 'social', 'pending-youtube-flips.json');

// ---------------------------------------------------------------------------
// Injectable collaborators — every one of these is a plain function/store so
// tests never touch a real network or filesystem.
// ---------------------------------------------------------------------------

export interface MetricsRowsStore {
	read(filePath: string): Promise<MetricsRow[]>;
	write(filePath: string, rows: MetricsRow[]): Promise<void>;
}

export interface FollowerSnapshotStore {
	read(filePath: string): Promise<InstagramFollowerSnapshot[]>;
	write(filePath: string, snapshots: InstagramFollowerSnapshot[]): Promise<void>;
}

export type PendingFlipsReader = () => Promise<PendingYouTubeFlip[]>;

export interface CollectionLogger {
	info(line: string): void;
	warn(line: string): void;
}

const noopLogger: CollectionLogger = { info: () => {}, warn: () => {} };

export interface RunMetricsCollectionOptions {
	/** ISO 8601 — the collection instant. See this file's header on the single wall-clock call site. */
	now: string;
	/** Defaults to `content/social/metrics/`. */
	outDir?: string;
	/** Omit to skip Instagram collection entirely for this run. */
	instagram?: { config: InstagramMetricsConfig; fetchFn: InstagramFetchFn };
	/** Omit to skip YouTube collection entirely for this run. */
	youtube?: { config: YouTubeMetricsConfig; fetchFn: YouTubeFetchFn };
	windowDays?: number;
	readPendingYouTubeFlips?: PendingFlipsReader;
	rowsStore?: MetricsRowsStore;
	followerStore?: FollowerSnapshotStore;
	logger?: CollectionLogger;
}

export interface RunMetricsCollectionResult {
	/** The full, merged contents of today's dated file after this run. */
	rows: MetricsRow[];
	/** Present only when Instagram collection ran and the snapshot succeeded (directly or via the graceful fallback). */
	followerSnapshot?: InstagramFollowerSnapshot;
	filePath: string;
}

/** `error.message` if `error` is an `Error`, else its string form. Never a token. */
function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Runs one collection pass: fetches fresh rows for every platform supplied,
 * upserts them into the collection date's dated file, and (Instagram only)
 * upserts today's account follower snapshot into the separate followers
 * file. See this file's header for the idempotency and platform-isolation
 * guarantees.
 */
export async function runMetricsCollection(options: RunMetricsCollectionOptions): Promise<RunMetricsCollectionResult> {
	const {
		now,
		outDir = DEFAULT_METRICS_DIR,
		instagram,
		youtube,
		windowDays,
		readPendingYouTubeFlips = createDefaultPendingFlipsReader(),
		rowsStore = createDefaultMetricsRowsStore(),
		followerStore = createDefaultFollowerSnapshotStore(),
		logger = noopLogger
	} = options;

	const collectionDate = now.slice(0, 10);
	const filePath = metricsFilePathFor(outDir, collectionDate);

	let rows = await rowsStore.read(filePath);

	if (instagram) {
		try {
			const newRows = await collectInstagramRows({
				config: instagram.config,
				now,
				windowDays,
				fetchFn: instagram.fetchFn
			});
			for (const row of newRows) rows = upsertMetricsRow(rows, row);
			logger.info(`[instagram] collected ${newRows.length} row(s) for ${collectionDate}.`);
		} catch (error) {
			logger.warn(`[instagram] per-media collection failed for ${collectionDate}: ${errorMessage(error)}`);
		}
	}

	if (youtube) {
		try {
			const flips = await readPendingYouTubeFlips();
			const newRows = await collectYouTubeRows({
				config: youtube.config,
				flips,
				now,
				windowDays,
				fetchFn: youtube.fetchFn
			});
			for (const row of newRows) rows = upsertMetricsRow(rows, row);
			logger.info(`[youtube] collected ${newRows.length} row(s) for ${collectionDate}.`);
		} catch (error) {
			logger.warn(`[youtube] collection failed for ${collectionDate}: ${errorMessage(error)}`);
		}
	}

	await rowsStore.write(filePath, rows);

	let followerSnapshot: InstagramFollowerSnapshot | undefined;
	if (instagram) {
		const followersFilePath = instagramFollowersFilePathFor(outDir);
		try {
			const { snapshot, usedFallback } = await fetchInstagramFollowerSnapshot(instagram.config, collectionDate, instagram.fetchFn);
			const existing = await followerStore.read(followersFilePath);
			await followerStore.write(followersFilePath, upsertFollowerSnapshot(existing, snapshot));
			followerSnapshot = snapshot;
			if (usedFallback) {
				logger.warn(
					`[instagram] follower_count insights unavailable for ${collectionDate} (likely under the 100-follower ` +
						'threshold) — used the ungated followers_count field instead.'
				);
			}
		} catch (error) {
			logger.warn(`[instagram] follower snapshot failed for ${collectionDate}: ${errorMessage(error)}`);
		}
	}

	return { rows, followerSnapshot, filePath };
}

// ---------------------------------------------------------------------------
// Default (production) file-backed stores — plain JSON files, matching
// `job.ts`'s `createDefaultPendingFlipsStore` convention exactly (ENOENT ->
// empty, not an error; `mkdir` the parent before writing).
// ---------------------------------------------------------------------------

function createDefaultMetricsRowsStore(): MetricsRowsStore {
	return {
		async read(filePath) {
			try {
				const raw = await readFile(filePath, 'utf-8');
				return parseMetricsRows(raw);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
				throw error;
			}
		},
		async write(filePath, rows) {
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, serializeMetricsRows(rows), 'utf-8');
		}
	};
}

function createDefaultFollowerSnapshotStore(): FollowerSnapshotStore {
	return {
		async read(filePath) {
			try {
				const raw = await readFile(filePath, 'utf-8');
				return parseFollowerSnapshots(raw);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
				throw error;
			}
		},
		async write(filePath, snapshots) {
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, serializeFollowerSnapshots(snapshots), 'utf-8');
		}
	};
}

function createDefaultPendingFlipsReader(): PendingFlipsReader {
	return async () => {
		try {
			const raw = await readFile(DEFAULT_PENDING_FLIPS_PATH, 'utf-8');
			return parsePendingFlips(raw);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
			throw error;
		}
	};
}

export { DEFAULT_METRICS_DIR, DEFAULT_PENDING_FLIPS_PATH };

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/collect.ts`. Reuses the same
// Firestore-backed `TokenStore` T04/T10 already wired for publishing
// (`token-store-firestore.ts`); this collector only READS whatever token is
// currently stored — token FRESHNESS is `job.ts`'s responsibility (it calls
// `ensureFreshToken` daily, well inside `REFRESH_WINDOW_MS`). If this
// collector is ever run detached from the daily job's own cadence and needs
// its own freshness guarantee too, layer `ensureFreshToken` in here with a
// real `RefreshFn` once one exists — the same documented follow-up `job.ts`'s
// own header already flags for `notImplementedRefresh`, not guessed here.
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/collect.ts [options]

Collects Instagram per-media insights + a daily account follower snapshot,
and YouTube Data/Analytics metrics for every video still inside its 30-day
polling window, upserting the results into a dated file under
content/social/metrics/. Re-running for the same day updates rows in place
rather than duplicating them. See plans/Pf39c2-social-pilot-03.md T12.

Options:
  --now <ISO 8601>   Override the collection instant (default: real wall-clock time).
                      Mainly for a manual re-run against a specific day.
  --help              Show this help.`);
}

function errorMessageForCli(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			now: { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		return;
	}

	// THE ONE WALL-CLOCK READ IN THIS WHOLE MODULE — see the header comment's
	// "DETERMINISM" section. Every other function above takes `now` as an
	// explicit parameter; `--now` lets an operator override this for a manual
	// re-run against a specific day without touching the system clock.
	const now = values.now ?? new Date().toISOString();

	const logger = { info: (line: string) => console.log(line), warn: (line: string) => console.warn(line) };
	const tokenStore = createFirestoreTokenStore();

	let instagram: RunMetricsCollectionOptions['instagram'];
	try {
		const igUserId = process.env.IG_USER_ID;
		if (!igUserId) {
			throw new Error('Missing the "IG_USER_ID" environment variable.');
		}
		const token = await tokenStore.get('instagram');
		if (!token) {
			throw new Error('No stored Instagram token — nothing to collect with.');
		}
		instagram = { config: { igUserId, accessToken: token.value }, fetchFn: globalThis.fetch };
	} catch (error) {
		logger.warn(`[instagram] skipped for this run — ${errorMessageForCli(error)}`);
	}

	let youtube: RunMetricsCollectionOptions['youtube'];
	try {
		const token = await tokenStore.get('youtube');
		if (!token) {
			throw new Error('No stored YouTube token — nothing to collect with.');
		}
		youtube = { config: { accessToken: token.value }, fetchFn: globalThis.fetch };
	} catch (error) {
		logger.warn(`[youtube] skipped for this run — ${errorMessageForCli(error)}`);
	}

	const result = await runMetricsCollection({ now, instagram, youtube, logger });
	logger.info(`Wrote ${result.rows.length} row(s) to ${result.filePath}.`);
	if (result.followerSnapshot) {
		logger.info(`Instagram follower snapshot for ${now.slice(0, 10)}: ${result.followerSnapshot.followerCount}.`);
	}
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard and rationale to `job.ts`'s own (see its bottom-of-file
// comment): importing `collect.ts` for its exports (as every test in
// `__tests__/collect.test.ts` does) must never itself parse `process.argv`
// as CLI flags or make a real network/Firestore call.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
