#!/usr/bin/env node
/**
 * The daily job (Pf39c2-social-pilot-03 T08): `social/src/job.ts --date
 * <YYYY-MM-DD>`.
 *
 * One day's full pipeline: resolve the schedule slot for `--date` -> render
 * it (REUSING `cli.ts`'s existing render path — `renderCommand`/
 * `loadWeekSchedule`, both exported from `cli.ts` for exactly this reuse,
 * never re-implemented here) -> upload every rendered asset to R2 -> publish
 * independently to Instagram and YouTube.
 *
 * ORDERING (plan Decision, verbatim): "Assets are uploaded to R2 before any
 * post is attempted, so a posting failure never loses a render." Enforced
 * structurally below: `runJob` uploads both rendered assets and only THEN
 * starts either publish call — there is no code path that publishes before
 * both uploads have resolved.
 *
 * PLATFORM ISOLATION (T08's acceptance criterion): an Instagram failure must
 * never prevent the YouTube upload, and vice versa. Each platform's whole
 * sequence (token refresh -> publish -> bookkeeping) is wrapped in its own
 * try/catch that ALWAYS resolves to a `PlatformOutcome` (`job-plan.ts`) —
 * never rejects — so the `Promise.allSettled` around both of them can never
 * see one platform's failure short-circuit the other. This is deliberately
 * NOT a bare `Promise.all` over the raw publish calls: `Promise.all` would
 * reject on the FIRST rejection, which (depending on scheduling) can abandon
 * the still-in-flight other platform's promise with its rejection becoming
 * unhandled. The job's own exit code reflects a failure (`exitCodeForOutcomes`)
 * only after BOTH platforms have been attempted and reported.
 *
 * TOKENS: `ensureFreshToken` (`publish/tokens.ts`) is called per platform
 * before publishing, and `expiryAlert`'s result (if any) is logged — plan
 * Constraint: expiry inside 30 days raises an alert. NEVER logs a token
 * value: every log line and every `PlatformOutcome.message` below is built
 * from either a fixed string, a card id/date, or `errorMessage(error)` —
 * and every error this file can catch already comes from a module
 * (`tokens.ts`, `instagram.ts`, `youtube.ts`) independently audited to never
 * put a token value in a thrown error's message. No real OAuth REFRESH
 * implementation exists anywhere in this codebase yet (T05/T06 deliberately
 * scoped to publish/upload only, not the refresh-token endpoint calls) —
 * `notImplementedRefresh` below is what a real run's `JobDeps.refresh` falls
 * back to, and throws a clear, named error rather than silently doing
 * nothing; a caller with a real refresh implementation supplies its own
 * `RefreshFn` per platform instead.
 *
 * PENDING YOUTUBE FLIPS: T07's `stageTikTokWeek` needs the week's uploaded
 * YouTube video ids (`PendingYouTubeFlip[]`, defined in
 * `publish/tiktok-manual.ts` and reused here, not redefined). This job is
 * the only place that calls `uploadVideoToYouTube` and therefore the only
 * place that learns a real video id, so it is the natural place to persist
 * that list.
 *
 * PERSISTED IN FIRESTORE BY DEFAULT (code review M4 fix, superseding this
 * comment's original "plain JSON file, not Firestore" reasoning): under
 * Cloud Run the job's OWN container filesystem is throwaway — a file written
 * to `content/social/pending-youtube-flips.json` there vanishes the moment
 * the execution ends, so every real run was silently losing every video id,
 * and `metrics/collect.ts`'s YouTube collection (reading that same path) was
 * permanently empty. `createFirestorePendingFlipsStore`
 * (`publish/pending-flips-store-firestore.ts`, mirroring
 * `token-store-firestore.ts`'s pattern exactly — ADC, a `runTransaction`
 * write-back) is now the default `pendingFlips` store, so both this job and
 * `metrics/collect.ts` read/write the same durable Firestore document. The
 * plain-JSON-file implementation (`createLocalPendingFlipsStore`, still
 * below) is NOT gone — it stays available for local runs and manual testing
 * via `--pending-flips-store local`, selected EXPLICITLY on the command
 * line, never silently defaulted to (so nobody accidentally runs a real
 * production day against a throwaway file again).
 *
 * A failed flip-record write is never reported as a clean success either: a
 * YouTube upload whose id could not be durably recorded is a `'partial'`
 * outcome (`job-plan.ts`'s `PlatformStatus`), which `exitCodeForOutcomes`
 * treats as a failure — see `publishYouTubeOutcome` below.
 *
 * DETERMINISM: `--date` is the ONLY source of scheduling decisions — nothing
 * here calls `Date.now()`/`new Date()` for anything that affects WHAT gets
 * rendered or published (see `dateToWeekDay`/`resolveDay`, both re-exported
 * pure functions). A real wall-clock "now" IS legitimately needed for token
 * freshness (`ensureFreshToken`/`expiryAlert` compare a token's expiry
 * against "right now", not against `--date`) — `main()` below has the ONE
 * call site in this whole file (`const now = new Date().toISOString()`),
 * clearly commented there, and that same value is reused verbatim for this
 * run's log-line timestamps rather than reading the clock a second time.
 *
 * DRY RUN: `--dry-run` renders for real (the plan's own wording: "does
 * everything up to and including render") but performs NO uploads and NO
 * posts — `runJob` returns immediately after logging what each platform
 * WOULD do. Because none of `uploadAsset`/`tokenStore`/`publishInstagram`/
 * `publishYouTube`/`loadInstagramAccountConfig`/`pendingFlips` are ever
 * invoked on that path, and every one of those dependencies loads its own
 * config LAZILY (on first real call, never at construction) rather than
 * eagerly at module load, `--dry-run` needs no credentials of any kind —
 * see `createDefaultUploadAsset`/`createDefaultTokenStore`/
 * `createDefaultInstagramAccountConfigLoader` below, each a closure that
 * defers its `loadR2Config()`/`new Firestore()`/`process.env` read until it
 * is actually called.
 *
 * TESTING: `job.test.ts` calls `runJob` directly with every collaborator
 * injected (`JobDeps`) — no network, no Firestore, no credentials, and
 * critically no Remotion render: the default `render`/`loadSchedule`
 * dependencies below import `cli.ts` DYNAMICALLY
 * (`await import('./cli.js')`), not at this file's top level, specifically
 * so importing `job.ts` itself never pulls in `@remotion/bundler`/
 * `@remotion/renderer` — those only load the moment a REAL (non-test)
 * default `render` call actually runs.
 *
 * Orchestration only: every piece of pure decision logic (outcome
 * formatting, YouTube title/description, the pending-flip list's parse/
 * merge/serialize) lives in `job-plan.ts`, mirroring the `cli.ts`/
 * `cli-plan.ts` split.
 *
 * R2 IS A PER-PLATFORM PRECONDITION, NOT A WHOLE-RUN ONE (code review M7
 * fix): Instagram genuinely needs the asset's public R2 URL (Meta's Graph
 * API fetches the video FROM that URL), but YouTube's resumable upload reads
 * straight from the local rendered file and never touches R2 at all. Both
 * `uploadAsset` calls below are wrapped in `Promise.allSettled`, not two bare
 * unguarded `await`s: an R2 outage (or any failure uploading either asset)
 * now makes ONLY Instagram's outcome `'failed'` — with the R2 error as its
 * message — while YouTube is still attempted from the local file, exactly as
 * platform isolation requires. The plan's Decision ("assets are uploaded to
 * R2 before any post is attempted") still holds structurally: both uploads
 * are still fully settled, success or failure, before either publish call
 * starts.
 */

import { parseArgs } from 'node:util';
import { appendFileSync, mkdirSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import type { S3Client } from '@aws-sdk/client-s3';

import { dateToWeekDay } from './pilot-config.js';
import { resolveDay, renderAssetPaths } from './cli-plan.js';
import type { WeekSchedule, ScheduleSlot } from './schedule-types.js';
import { loadR2Config, type R2Config } from './publish/env.js';
import { createR2Client, contentTypeFor, postKeyFor, uploadFile } from './publish/storage.js';
import {
	ensureFreshToken,
	expiryAlert,
	type Platform,
	type RefreshFn,
	type StoredToken,
	type TokenStore
} from './publish/tokens.js';
import { createFirestoreTokenStore } from './publish/token-store-firestore.js';
import { createFirestorePendingFlipsStore } from './publish/pending-flips-store-firestore.js';
import { publishToInstagram, type PublishToInstagramOptions, type PublishToInstagramResult } from './publish/instagram.js';
import { uploadVideoToYouTube, type UploadVideoOptions, type UploadVideoResult } from './publish/youtube.js';
import type { PendingYouTubeFlip } from './publish/tiktok-manual.js';
import {
	buildInstagramCaption,
	buildYouTubeDescription,
	buildYouTubeTitle,
	errorMessage,
	exitCodeForOutcomes,
	formatExpiryAlertLine,
	formatOutcomeLine,
	parsePendingFlips,
	serializePendingFlips,
	upsertPendingFlip,
	type PendingFlipsStore,
	type PlatformName,
	type PlatformOutcome
} from './job-plan.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..');
const SCHEDULE_DIR = path.join(REPO_ROOT, 'content', 'social');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'social', 'out');
const DEFAULT_PENDING_FLIPS_PATH = path.join(REPO_ROOT, 'content', 'social', 'pending-youtube-flips.json');
const JOB_LOG_DIR = path.join(REPO_ROOT, 'content', 'social', 'job-logs');

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/job.ts --date <YYYY-MM-DD> [options]

Runs one day's full publish pipeline: resolves the schedule slot for --date,
renders it (reusing cli.ts's render path), uploads every rendered asset to
R2, then publishes independently to Instagram and YouTube — a failure on one
platform never stops the other. See plans/Pf39c2-social-pilot-03.md T08.

Options:
  --date <YYYY-MM-DD>          The post's calendar date (required).
  --out <dir>                    Render output directory (default: social/out/).
  --schedule-dir <dir>           Directory to read pilot-schedule-w<NN>.json
                                  from (default: content/social/).
  --pending-flips-store <kind>   Where the week's pending YouTube video ids
                                  are durably recorded for T07's weekly
                                  TikTok/flip session and for
                                  metrics/collect.ts's YouTube polling:
                                  "firestore" (default — the same project
                                  the OAuth tokens already live in) or
                                  "local" (a plain JSON file — for local
                                  runs/testing only; a Cloud Run execution's
                                  filesystem is throwaway, so "local" there
                                  silently loses every video id).
  --pending-flips-file <path>    The JSON file path used ONLY when
                                  --pending-flips-store=local (default:
                                  content/social/pending-youtube-flips.json).
  --dry-run                      Render for real, but perform NO uploads and
                                  NO posts — logs exactly what each platform
                                  WOULD do. Needs no credentials at all.
  --help                        Show this help.`);
}

export type PendingFlipsStoreKind = 'firestore' | 'local';

export interface JobArgs {
	date: string;
	outDir: string;
	scheduleDir: string;
	pendingFlipsPath: string;
	pendingFlipsStore: PendingFlipsStoreKind;
	dryRun: boolean;
}

function parsePendingFlipsStoreKind(value: string | undefined): PendingFlipsStoreKind {
	if (value === undefined || value === 'firestore') return 'firestore';
	if (value === 'local') return 'local';
	throw new Error(`--pending-flips-store must be "firestore" or "local", got "${value}"`);
}

export function parseJobArgs(argv: string[]): JobArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			date: { type: 'string' },
			out: { type: 'string', default: DEFAULT_OUT_DIR },
			'schedule-dir': { type: 'string', default: SCHEDULE_DIR },
			'pending-flips-store': { type: 'string' },
			'pending-flips-file': { type: 'string', default: DEFAULT_PENDING_FLIPS_PATH },
			'dry-run': { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	if (!values.date) {
		throw new Error('Specify --date <YYYY-MM-DD>');
	}

	return {
		date: values.date,
		outDir: values.out ?? DEFAULT_OUT_DIR,
		scheduleDir: values['schedule-dir'] ?? SCHEDULE_DIR,
		pendingFlipsPath: values['pending-flips-file'] ?? DEFAULT_PENDING_FLIPS_PATH,
		pendingFlipsStore: parsePendingFlipsStoreKind(values['pending-flips-store']),
		dryRun: Boolean(values['dry-run'])
	};
}

// ---------------------------------------------------------------------------
// Dependencies — every collaborator this job needs is injectable, so
// job.test.ts never touches a network, Firestore, credentials, or a real
// Remotion render. `buildDefaultJobDeps` (bottom of this section) wires the
// real implementations `main()` uses.
// ---------------------------------------------------------------------------

export type RenderFn = (args: { date: string; outDir: string; scheduleDir: string }) => Promise<void>;
export type LoadScheduleFn = (week: number, scheduleDir: string) => Promise<WeekSchedule>;

export interface UploadAssetInput {
	filePath: string;
	key: string;
	contentType: string;
}
/** Uploads one local file to R2 and returns its public URL. Matches `storage.ts`'s `uploadFile`'s effect, minus the client/config plumbing. */
export type UploadAssetFn = (input: UploadAssetInput) => Promise<string>;

export interface InstagramAccountConfig {
	igUserId: string;
}
export type LoadInstagramAccountConfigFn = () => InstagramAccountConfig;

// `PendingFlipsStore` itself now lives in `job-plan.ts` (imported above) —
// see that file's doc comment for why: both this module's Firestore-backed
// default and `metrics/collect.ts`'s reader depend on the same shape without
// either needing to import this file.
export type { PendingFlipsStore } from './job-plan.js';

export interface PlatformRefreshFns {
	instagram: RefreshFn;
	youtube: RefreshFn;
}

export interface JobLogger {
	info(line: string): void;
	warn(line: string): void;
	error(line: string): void;
}

export interface JobDeps {
	loadSchedule: LoadScheduleFn;
	render: RenderFn;
	uploadAsset: UploadAssetFn;
	tokenStore: TokenStore;
	refresh: PlatformRefreshFns;
	loadInstagramAccountConfig: LoadInstagramAccountConfigFn;
	publishInstagram: (options: PublishToInstagramOptions) => Promise<PublishToInstagramResult>;
	publishYouTube: (options: UploadVideoOptions) => Promise<UploadVideoResult>;
	pendingFlips: PendingFlipsStore;
	/** ISO 8601 — see this file's header comment on the ONE wall-clock call site. */
	now: string;
	logger: JobLogger;
}

// ---------------------------------------------------------------------------
// runJob — the orchestration itself
// ---------------------------------------------------------------------------

export interface RunJobResult {
	outcomes: PlatformOutcome[];
	exitCode: number;
}

export async function runJob(args: JobArgs, deps: JobDeps): Promise<RunJobResult> {
	const { logger } = deps;
	logger.info(`=== Daily job for ${args.date}${args.dryRun ? ' (DRY RUN)' : ''} ===`);

	const { week, day } = dateToWeekDay(args.date);
	logger.info(`Resolved ${args.date} -> week ${week}, day ${day}.`);

	const schedule = await deps.loadSchedule(week, args.scheduleDir);
	const slot = resolveDay(schedule, day);
	logger.info(`Slot: card ${slot.card_id} (${slot.book_slug}, ${slot.author_slug}), format ${slot.content.format}.`);

	logger.info('Rendering...');
	await deps.render({ date: args.date, outDir: args.outDir, scheduleDir: args.scheduleDir });
	const assetPaths = renderAssetPaths(args.outDir, slot.content.format, args.date);
	logger.info(`Rendered video: ${assetPaths.video}`);
	logger.info(`Rendered feed still: ${assetPaths.feedStill}`);

	if (args.dryRun) {
		const outcomes: PlatformOutcome[] = [
			{
				platform: 'instagram',
				status: 'dry-run',
				message:
					`would upload ${assetPaths.video} to R2, then publish it as a Reel with the caption built from ` +
					`card ${slot.card_id}`
			},
			{
				platform: 'youtube',
				status: 'dry-run',
				message:
					`would upload ${assetPaths.video} to R2, then upload it to YouTube (private) titled ` +
					`"${buildYouTubeTitle(slot)}"`
			}
		];
		for (const outcome of outcomes) logger.info(formatOutcomeLine(outcome));
		logger.info('Dry run complete — no uploads, no posts.');
		return { outcomes, exitCode: exitCodeForOutcomes(outcomes) };
	}

	// Plan Decision, enforced structurally: both uploads below are fully
	// SETTLED (success or failure — `Promise.allSettled`, not a bare `await`
	// on each) BEFORE either publish call starts, so a posting failure can
	// never lose a render. But an R2 failure is now a PER-PLATFORM
	// precondition, not a whole-run one (code review M7 fix): Instagram
	// genuinely needs the video's public R2 URL, so a failed video upload
	// makes ONLY the Instagram outcome 'failed' below — YouTube reads the
	// local rendered file directly and never touches R2, so it is still
	// attempted regardless of how the uploads went.
	logger.info('Uploading assets to R2...');
	const [videoUploadResult, feedStillUploadResult] = await Promise.allSettled([
		deps.uploadAsset({
			filePath: assetPaths.video,
			key: postKeyFor(args.date, path.basename(assetPaths.video)),
			contentType: contentTypeFor(assetPaths.video)
		}),
		deps.uploadAsset({
			filePath: assetPaths.feedStill,
			key: postKeyFor(args.date, path.basename(assetPaths.feedStill)),
			contentType: contentTypeFor(assetPaths.feedStill)
		})
	]);

	let videoUploadError: string | undefined;
	if (videoUploadResult.status === 'fulfilled') {
		logger.info(`Uploaded ${videoUploadResult.value}`);
	} else {
		videoUploadError = errorMessage(videoUploadResult.reason);
		logger.error(`Failed to upload the video to R2: ${videoUploadError}`);
	}

	if (feedStillUploadResult.status === 'fulfilled') {
		logger.info('Uploaded the Instagram feed still.');
	} else {
		// Not fed into either platform's publish call today (see
		// `renderAssetPaths`/`publishInstagramOutcome` — only the video's R2
		// URL is ever used), so this alone does not fail an outcome; it is
		// still logged loudly rather than silently dropped.
		logger.error(`Failed to upload the Instagram feed still to R2: ${errorMessage(feedStillUploadResult.reason)}`);
	}

	// Publish independently. Each helper below catches its own errors and
	// ALWAYS resolves to a PlatformOutcome — see this file's header comment
	// for why that (not a bare Promise.all over the raw publish calls) is
	// what actually guarantees platform isolation.
	const settled = await Promise.allSettled([
		videoUploadResult.status === 'fulfilled'
			? publishInstagramOutcome({ deps, slot, videoUrl: videoUploadResult.value })
			: Promise.resolve<PlatformOutcome>({
					platform: 'instagram',
					status: 'failed',
					message: `R2 upload of the video failed, so Instagram was never attempted: ${videoUploadError}`
				}),
		publishYouTubeOutcome({ deps, args, slot, videoPath: assetPaths.video })
	]);

	const platformOrder: PlatformName[] = ['instagram', 'youtube'];
	const outcomes = settled.map((result, index) =>
		result.status === 'fulfilled'
			? result.value
			: ({
					platform: platformOrder[index],
					status: 'failed',
					message: `unexpected error outside its own try/catch: ${errorMessage(result.reason)}`
				} satisfies PlatformOutcome)
	);

	for (const outcome of outcomes) logger.info(formatOutcomeLine(outcome));
	return { outcomes, exitCode: exitCodeForOutcomes(outcomes) };
}

// ---------------------------------------------------------------------------
// Per-platform publish — each of these is the ENTIRE unit `Promise.allSettled`
// runs concurrently for its platform: token refresh, expiry alert, publish,
// and (YouTube only) recording the pending flip. Every thrown error inside
// is caught here and turned into a 'failed' outcome, never rethrown — this
// is what makes the other platform's promise unaffected by this one's
// failure.
// ---------------------------------------------------------------------------

async function publishInstagramOutcome(ctx: {
	deps: JobDeps;
	slot: ScheduleSlot;
	videoUrl: string;
}): Promise<PlatformOutcome> {
	const { deps, slot, videoUrl } = ctx;
	try {
		const token = await ensureFreshToken({
			store: deps.tokenStore,
			platform: 'instagram',
			now: deps.now,
			refresh: deps.refresh.instagram
		});
		const alert = expiryAlert(token, deps.now);
		if (alert) deps.logger.warn(formatExpiryAlertLine(alert));

		const { igUserId } = deps.loadInstagramAccountConfig();
		const caption = buildInstagramCaption(slot);
		const result = await deps.publishInstagram({
			config: { igUserId, accessToken: token.value },
			mediaUrl: videoUrl,
			caption,
			mediaKind: 'reel'
		});
		return {
			platform: 'instagram',
			status: 'ok',
			message: `published Reel, media id ${result.mediaId} (container ${result.containerId})`
		};
	} catch (error) {
		return { platform: 'instagram', status: 'failed', message: errorMessage(error) };
	}
}

async function publishYouTubeOutcome(ctx: {
	deps: JobDeps;
	args: JobArgs;
	slot: ScheduleSlot;
	videoPath: string;
}): Promise<PlatformOutcome> {
	const { deps, args, slot, videoPath } = ctx;
	try {
		const token = await ensureFreshToken({
			store: deps.tokenStore,
			platform: 'youtube',
			now: deps.now,
			refresh: deps.refresh.youtube
		});
		const alert = expiryAlert(token, deps.now);
		if (alert) deps.logger.warn(formatExpiryAlertLine(alert));

		const result = await deps.publishYouTube({
			config: { accessToken: token.value },
			video: { filePath: videoPath },
			title: buildYouTubeTitle(slot),
			description: buildYouTubeDescription(slot)
		});

		const flipRecorded = await recordPendingFlip(deps, args, slot, result.videoId);
		if (!flipRecorded) {
			// M4 fix: the upload itself succeeded, but the durable record of its
			// video id did not — that is not a clean success (T07's weekly
			// flip session and the metrics readout's ONLY source of exact
			// per-post follow attribution can never find this video again), so
			// this is 'partial', not 'ok'. `exitCodeForOutcomes` treats
			// 'partial' as a failure — see `job-plan.ts`.
			return {
				platform: 'youtube',
				status: 'partial',
				message:
					`uploaded private video, id ${result.videoId}, but FAILED to durably record its pending flip — ` +
					'see the run log; this video is unreachable to the weekly flip session and metrics collection until fixed'
			};
		}
		return { platform: 'youtube', status: 'ok', message: `uploaded private video, id ${result.videoId}` };
	} catch (error) {
		return { platform: 'youtube', status: 'failed', message: errorMessage(error) };
	}
}

/**
 * Records this run's YouTube upload in the week's pending-flip list
 * (read-modify-write against the durable `deps.pendingFlips` store — see
 * `job-plan.ts`'s `PendingFlipsStore` doc comment). A failure here does NOT
 * throw — the video already landed on YouTube successfully — but it is never
 * silently absorbed either: the caller (`publishYouTubeOutcome`) downgrades
 * an otherwise-`ok` outcome to `'partial'` on a `false` return, which
 * `exitCodeForOutcomes` treats as a failed run (M4 fix — this used to be a
 * warning on an `ok` outcome, which let a lost video id pass as a clean
 * success).
 */
async function recordPendingFlip(
	deps: JobDeps,
	args: JobArgs,
	slot: ScheduleSlot,
	videoId: string
): Promise<boolean> {
	try {
		const existing = await deps.pendingFlips.read();
		const updated = upsertPendingFlip(existing, { date: args.date, cardId: slot.card_id, videoId });
		await deps.pendingFlips.write(updated);
		return true;
	} catch (error) {
		deps.logger.error(`Failed to record the pending YouTube flip for ${args.date}: ${errorMessage(error)}`);
		return false;
	}
}

// ---------------------------------------------------------------------------
// Default (production) dependencies — every one of these defers its config
// load/network/credential use to the moment it is actually CALLED, never to
// construction time, so building this whole `JobDeps` object is safe even
// with zero credentials set (the dry-run path never calls any of them).
// ---------------------------------------------------------------------------

function createDefaultUploadAsset(): UploadAssetFn {
	let cached: { client: S3Client; config: R2Config } | undefined;
	return async ({ filePath, key, contentType }) => {
		if (!cached) {
			const config = loadR2Config();
			cached = { client: createR2Client(config), config };
		}
		return uploadFile({ client: cached.client, config: cached.config, filePath, key, contentType });
	};
}

/**
 * Wraps `createFirestoreTokenStore` (which itself constructs a real
 * `Firestore` client, per `token-store-firestore.ts`'s header, using
 * Application Default Credentials) so that construction is deferred until
 * the FIRST real `get`/`set` call — never at `JobDeps` build time — matching
 * every other default dependency in this section. `--dry-run` never calls
 * either method, so the Firestore client is never constructed at all on
 * that path.
 */
function createDefaultTokenStore(): TokenStore {
	let store: TokenStore | undefined;
	function ensure(): TokenStore {
		if (!store) store = createFirestoreTokenStore();
		return store;
	}
	return {
		get: (platform: Platform): Promise<StoredToken | undefined> => ensure().get(platform),
		set: (platform: Platform, record: StoredToken): Promise<void> => ensure().set(platform, record)
	};
}

function createDefaultInstagramAccountConfigLoader(): LoadInstagramAccountConfigFn {
	return () => {
		const igUserId = process.env.IG_USER_ID;
		if (!igUserId) {
			throw new Error(
				'Instagram configuration is missing the "IG_USER_ID" environment variable (the IG Business/Creator ' +
					"account's id — not a secret, but not defaulted here either)."
			);
		}
		return { igUserId };
	};
}

/**
 * The default refresh for a platform, used only until a real OAuth refresh
 * implementation exists (see this file's header comment). Throws a clearly
 * named error rather than silently no-op'ing — a job that actually reaches
 * this (a token near enough to expiry and old enough to refresh) needs a
 * human to notice, not a swallowed failure.
 */
function notImplementedRefresh(platform: Platform): RefreshFn {
	return async () => {
		throw new Error(
			`No real OAuth refresh is implemented for "${platform}" yet (T05/T06 built publish/upload only, not the ` +
				'refresh-token endpoint calls). Re-authenticate the account by hand and update its stored token, or ' +
				'supply a real RefreshFn via JobDeps.refresh once one exists.'
		);
	};
}

/**
 * The LOCAL-FILE `PendingFlipsStore` implementation. NOT the production
 * default (see `buildDefaultJobDeps` below) — a Cloud Run execution's
 * filesystem is throwaway, so writing here in production silently loses
 * every video id (the M4 bug this whole store split fixes). Kept for local
 * runs and manual testing, selected explicitly via `--pending-flips-store
 * local`, never by omission.
 */
function createLocalPendingFlipsStore(filePath: string): PendingFlipsStore {
	return {
		async read() {
			try {
				const raw = await readFile(filePath, 'utf-8');
				return parsePendingFlips(raw);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
				throw error;
			}
		},
		async write(flips) {
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, serializePendingFlips(flips), 'utf-8');
		}
	};
}

/**
 * The DURABLE default `PendingFlipsStore` — Firestore, mirroring
 * `createDefaultTokenStore`'s deferred-construction pattern exactly: the real
 * `Firestore` client (`createFirestorePendingFlipsStore`,
 * `publish/pending-flips-store-firestore.ts`) is built on the FIRST real
 * `read`/`write` call, never at `JobDeps` build time, so `--dry-run` (which
 * never calls either method) needs no Firestore credentials at all.
 */
function createDefaultFirestorePendingFlipsStore(): PendingFlipsStore {
	let store: PendingFlipsStore | undefined;
	function ensure(): PendingFlipsStore {
		if (!store) store = createFirestorePendingFlipsStore();
		return store;
	}
	return {
		read: (): Promise<PendingYouTubeFlip[]> => ensure().read(),
		write: (flips: PendingYouTubeFlip[]): Promise<void> => ensure().write(flips)
	};
}

/**
 * Selects the `PendingFlipsStore` implementation for a real run — Firestore
 * by default, the plain-JSON-file implementation only when
 * `--pending-flips-store local` is passed explicitly (see this file's header
 * comment's "PENDING YOUTUBE FLIPS" section).
 */
function createPendingFlipsStoreFor(args: JobArgs): PendingFlipsStore {
	return args.pendingFlipsStore === 'local'
		? createLocalPendingFlipsStore(args.pendingFlipsPath)
		: createDefaultFirestorePendingFlipsStore();
}

/**
 * Dynamic import (not a top-level one) — see this file's header comment on
 * why: it keeps `@remotion/bundler`/`@remotion/renderer` out of every test
 * that imports `job.ts` with `render` itself injected.
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

function buildDefaultJobDeps(args: JobArgs, now: string, logger: JobLogger): JobDeps {
	return {
		loadSchedule: defaultLoadSchedule,
		render: defaultRender,
		uploadAsset: createDefaultUploadAsset(),
		tokenStore: createDefaultTokenStore(),
		refresh: { instagram: notImplementedRefresh('instagram'), youtube: notImplementedRefresh('youtube') },
		loadInstagramAccountConfig: createDefaultInstagramAccountConfigLoader(),
		publishInstagram: publishToInstagram,
		publishYouTube: uploadVideoToYouTube,
		pendingFlips: createPendingFlipsStoreFor(args),
		now,
		logger
	};
}

// ---------------------------------------------------------------------------
// Logging — console plus a per-day append-only file under
// content/social/job-logs/, in the spirit of `content/pipeline/<slug>/
// pipeline.log` (see CLAUDE.md's "Pipeline logs" section): a human-readable
// record of what a run decided and did, kept even after the process exits.
// Timestamps reuse `now` (this file's one wall-clock read, see the header
// comment) rather than reading the clock again per line — every line in a
// single run shares that run's start time.
// ---------------------------------------------------------------------------

function createJobLogger(date: string, now: string): JobLogger {
	const logPath = path.join(JOB_LOG_DIR, `job-${date}.log`);

	function write(level: 'INFO' | 'WARN' | 'ERROR', line: string): void {
		const formatted = `[${now}] [${level}] ${line}`;
		if (level === 'ERROR') {
			console.error(formatted);
		} else {
			console.log(formatted);
		}
		try {
			mkdirSync(JOB_LOG_DIR, { recursive: true });
			appendFileSync(logPath, `${formatted}\n`, 'utf-8');
		} catch {
			// Logging to disk is best-effort — never let a logging failure crash the job.
		}
	}

	return {
		info: (line) => write('INFO', line),
		warn: (line) => write('WARN', line),
		error: (line) => write('ERROR', line)
	};
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const args = parseJobArgs(argv);

	// THE ONE WALL-CLOCK READ IN THIS FILE — see the header comment's
	// "DETERMINISM" section. Used only for token-freshness decisions
	// (`ensureFreshToken`/`expiryAlert`) and reused verbatim for this run's
	// log-line timestamps; every SCHEDULING decision above and below this
	// line comes from `--date` alone.
	const now = new Date().toISOString();

	const logger = createJobLogger(args.date, now);
	const deps = buildDefaultJobDeps(args, now, logger);

	const result = await runJob(args, deps);
	process.exit(result.exitCode);
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard and rationale to `cli.ts`'s own (see its bottom-of-file
// comment): importing `job.ts` for its exports (as `job.test.ts` and
// `job-plan.test.ts` do) must never itself parse `process.argv` as job flags
// or call `process.exit()`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
