/**
 * The Instagram metrics collector (Pf39c2-social-pilot-03 T12) — per-media
 * insights plus a daily ACCOUNT-level follower snapshot.
 *
 * Mirrors `publish/instagram.ts`'s injectable-`fetchFn`/error-class/
 * `redactUrl` patterns exactly (same file, same task family, same
 * discipline), not a divergent second style for reading vs. writing to the
 * same Graph API. Duplicated locally rather than imported — this module has
 * no other dependency on the publish adapter and duplicating ~15 lines is
 * cheaper than coupling metrics collection to the publish path's lifecycle.
 *
 * Plan Decision this module implements: "Instagram reports follower counts
 * at the ACCOUNT level only, so criterion A's conversion half must be
 * inferred from daily follower deltas aligned to post times." See
 * `fetchInstagramFollowerSnapshot` below.
 *
 * Plan Constraint this module implements: "Instagram account-level insights
 * are unreliable on a brand-new account: demographic breakdowns require
 * >=100 followers and return errors or empty below that. Per-media insights
 * work from day one." Per `plans/research/social-experiment-notes.md`: the
 * ACCOUNT-level `follower_count` INSIGHTS metric is the one gated behind the
 * 100-follower threshold; the plain `followers_count` FIELD on the IG user
 * node is ungated and always available. `fetchInstagramFollowerSnapshot`
 * attempts the (richer, but gated) Insights metric first and falls back to
 * the ungated field on ANY error response from that call — this is the
 * "handle it gracefully rather than failing the run" behaviour the task
 * calls for, and it still returns a real, usable number on a brand-new
 * account rather than skipping the day's snapshot entirely. Per-media
 * insights (`fetchInstagramMediaMetrics`) are never subject to this gate at
 * all, per the Constraint's own second sentence, and this module never
 * routes them through the fallback path.
 *
 * Never logs `config.accessToken` — same discipline as `publish/
 * instagram.ts`: the token is sent only as the Graph API's `access_token`
 * query parameter, and any error message that might mention "the URL it
 * called" goes through `redactUrl` first.
 */

import { isWithinPollingWindow, POLLING_WINDOW_DAYS, type InstagramFollowerSnapshot, type MetricsRow } from './schema.js';

/** A `fetch`-compatible function. Injectable so tests never make a real network call. */
export type FetchFn = typeof globalThis.fetch;

export interface InstagramMetricsConfig {
	/** The IG User ID (a Business/Creator account — same account `publish/instagram.ts` posts to). */
	igUserId: string;
	/** NEVER logged. Passed as the Graph API's `access_token` query parameter on every call. */
	accessToken: string;
	/** Overridable for tests; defaults to `DEFAULT_GRAPH_API_BASE_URL`. */
	graphApiBaseUrl?: string;
}

/** Same API version pin as `publish/instagram.ts`. */
export const DEFAULT_GRAPH_API_BASE_URL = 'https://graph.facebook.com/v21.0';

function graphApiBase(config: InstagramMetricsConfig): string {
	return config.graphApiBaseUrl ?? DEFAULT_GRAPH_API_BASE_URL;
}

/** Mirrors `publish/instagram.ts`'s own `redactUrl` — see this file's header. */
function redactUrl(url: URL | string): string {
	const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
	if (parsed.searchParams.has('access_token')) {
		parsed.searchParams.set('access_token', 'REDACTED');
	}
	return parsed.toString();
}

/** Mirrors `publish/instagram.ts`'s own `InstagramApiError` — see this file's header. */
export class InstagramMetricsApiError extends Error {
	readonly code?: number;
	readonly errorSubcode?: number;

	constructor(message: string, options: { code?: number; errorSubcode?: number } = {}) {
		super(message);
		this.name = 'InstagramMetricsApiError';
		this.code = options.code;
		this.errorSubcode = options.errorSubcode;
	}
}

interface GraphApiErrorBody {
	message?: string;
	code?: number;
	error_subcode?: number;
}

/** Calls the Graph API and returns the parsed JSON body. Throws `InstagramMetricsApiError` on `body.error`; callers decide which errors to swallow. */
async function callGraphApi(url: URL, fetchFn: FetchFn): Promise<Record<string, unknown>> {
	const response = await fetchFn(url.toString(), { method: 'GET' });

	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`Instagram Graph API response was not valid JSON (HTTP ${response.status}) at ${redactUrl(url)}.`);
	}

	const error = body?.error as GraphApiErrorBody | undefined;
	if (error) {
		throw new InstagramMetricsApiError(
			`Instagram Graph API error${error.code !== undefined ? ` (code ${error.code})` : ''}: ${error.message ?? 'no message provided'}`,
			{ code: error.code, errorSubcode: error.error_subcode }
		);
	}
	if (!response.ok) {
		throw new Error(`Instagram Graph API request failed with HTTP ${response.status} at ${redactUrl(url)}.`);
	}

	return body;
}

// ---------------------------------------------------------------------------
// Listing this account's media — the source of truth for WHICH Instagram
// posts exist and WHEN they were published. See `../collect.ts`'s header
// comment for why this module discovers posts from the platform itself
// rather than from a local job record.
// ---------------------------------------------------------------------------

export interface InstagramMediaSummary {
	id: string;
	/** ISO 8601 — Meta's own `timestamp` field on the media object. */
	publishedAt: string;
	mediaType: string;
	/** Seconds. Present for VIDEO/REELS media; absent for a still image. */
	videoDurationSec?: number;
}

/**
 * Lists this account's own media (`GET /{ig-user-id}/media`), most recent
 * first (Meta's own default ordering). Does not paginate: the pilot posts
 * at most one Instagram item a day, well under a single page, so a second
 * page is out of scope until that volume assumption changes.
 */
export async function listInstagramMedia(config: InstagramMetricsConfig, fetchFn: FetchFn): Promise<InstagramMediaSummary[]> {
	const url = new URL(`${graphApiBase(config)}/${config.igUserId}/media`);
	url.searchParams.set('fields', 'id,timestamp,media_type,video_duration');
	url.searchParams.set('access_token', config.accessToken);

	const body = await callGraphApi(url, fetchFn);
	const data = body.data;
	if (!Array.isArray(data)) {
		throw new Error('Instagram media list response did not include a "data" array.');
	}

	return data.map((item) => {
		const record = item as Record<string, unknown>;
		if (typeof record.id !== 'string' || typeof record.timestamp !== 'string') {
			throw new Error('Instagram media list item is missing a string "id" or "timestamp".');
		}
		return {
			id: record.id,
			publishedAt: record.timestamp,
			mediaType: typeof record.media_type === 'string' ? record.media_type : 'UNKNOWN',
			videoDurationSec: typeof record.video_duration === 'number' ? record.video_duration : undefined
		};
	});
}

// ---------------------------------------------------------------------------
// Per-media insights — works from day one, per the plan Constraint.
// ---------------------------------------------------------------------------

/** The Reels insights metrics this module requests. `ig_reels_avg_watch_time` is documented in milliseconds. */
const MEDIA_INSIGHTS_METRICS = ['plays', 'likes', 'comments', 'shares', 'saved', 'ig_reels_avg_watch_time'] as const;

export interface InstagramMediaMetrics {
	views: number;
	likes: number;
	comments: number;
	shares: number;
	saves: number;
	/** `null` when the media isn't a video/Reel or its duration is unknown — never a fabricated percentage. See `schema.ts`'s header. */
	averagePercentWatched: number | null;
}

/** Parses the Insights API's `{ data: [{ name, values: [{ value }] }] }` shape into a plain `name -> value` map. */
function parseInsightsValues(body: Record<string, unknown>): Map<string, number> {
	const data = body.data;
	if (!Array.isArray(data)) {
		throw new Error('Instagram media insights response did not include a "data" array.');
	}
	const map = new Map<string, number>();
	for (const entry of data) {
		const record = entry as Record<string, unknown>;
		const name = record.name;
		const values = record.values;
		if (typeof name !== 'string' || !Array.isArray(values) || values.length === 0) {
			continue;
		}
		const value = (values[0] as Record<string, unknown>).value;
		if (typeof value === 'number') {
			map.set(name, value);
		}
	}
	return map;
}

/**
 * Fetches one media item's insights and derives `averagePercentWatched` from
 * `ig_reels_avg_watch_time` (ms) against the media's own `video_duration`
 * (seconds, from `listInstagramMedia`) — the Insights endpoint reports
 * average watch TIME, never a ready-made percentage, so this module computes
 * one rather than leaving it as a raw duration a reader would have to
 * interpret themselves.
 */
export async function fetchInstagramMediaMetrics(
	config: InstagramMetricsConfig,
	media: InstagramMediaSummary,
	fetchFn: FetchFn
): Promise<InstagramMediaMetrics> {
	const url = new URL(`${graphApiBase(config)}/${media.id}/insights`);
	url.searchParams.set('metric', MEDIA_INSIGHTS_METRICS.join(','));
	url.searchParams.set('access_token', config.accessToken);

	const body = await callGraphApi(url, fetchFn);
	const values = parseInsightsValues(body);

	const avgWatchTimeMs = values.get('ig_reels_avg_watch_time');
	const averagePercentWatched =
		typeof avgWatchTimeMs === 'number' && typeof media.videoDurationSec === 'number' && media.videoDurationSec > 0
			? Math.min(100, (avgWatchTimeMs / 1000 / media.videoDurationSec) * 100)
			: null;

	return {
		views: values.get('plays') ?? 0,
		likes: values.get('likes') ?? 0,
		comments: values.get('comments') ?? 0,
		shares: values.get('shares') ?? 0,
		saves: values.get('saved') ?? 0,
		averagePercentWatched
	};
}

// ---------------------------------------------------------------------------
// The daily account-level follower snapshot — the graceful-fallback path.
// ---------------------------------------------------------------------------

export interface FetchFollowerSnapshotResult {
	snapshot: InstagramFollowerSnapshot;
	/** `true` when the gated Insights metric failed and this fell back to the ungated `followers_count` field. */
	usedFallback: boolean;
}

/**
 * Fetches ONE calendar date's account follower count, attempting the
 * (gated) `follower_count` Insights metric first and falling back to the
 * ungated `followers_count` field on any error from that call — see this
 * file's header. Only re-throws if BOTH calls fail: a genuine outage (bad
 * token, network down) should still surface, not be silently swallowed
 * forever.
 */
export async function fetchInstagramFollowerSnapshot(
	config: InstagramMetricsConfig,
	date: string,
	fetchFn: FetchFn
): Promise<FetchFollowerSnapshotResult> {
	try {
		const url = new URL(`${graphApiBase(config)}/${config.igUserId}/insights`);
		url.searchParams.set('metric', 'follower_count');
		url.searchParams.set('period', 'day');
		url.searchParams.set('access_token', config.accessToken);

		const body = await callGraphApi(url, fetchFn);
		const values = parseInsightsValues(body);
		const followerCount = values.get('follower_count');
		if (typeof followerCount !== 'number') {
			throw new Error('Instagram follower_count insights response had no usable value.');
		}
		return { snapshot: { date, followerCount }, usedFallback: false };
	} catch {
		// Gated below 100 followers (or any other failure) — fall back to the
		// UNGATED basic field. This call is allowed to throw for real: if even
		// the ungated field fails, that is a genuine outage, not the expected
		// small-account gating this module exists to route around.
		const url = new URL(`${graphApiBase(config)}/${config.igUserId}`);
		url.searchParams.set('fields', 'followers_count');
		url.searchParams.set('access_token', config.accessToken);

		const body = await callGraphApi(url, fetchFn);
		const followerCount = body.followers_count;
		if (typeof followerCount !== 'number') {
			throw new Error('Instagram followers_count fallback response had no usable value.');
		}
		return { snapshot: { date, followerCount }, usedFallback: true };
	}
}

// ---------------------------------------------------------------------------
// Orchestration — one call this platform's whole T12 slice reduces to.
// ---------------------------------------------------------------------------

export interface CollectInstagramRowsOptions {
	config: InstagramMetricsConfig;
	/** ISO 8601 — the collection instant. See `collect.ts`'s header on the single wall-clock call site this traces back to. */
	now: string;
	windowDays?: number;
	fetchFn: FetchFn;
}

/**
 * Lists this account's media, keeps only what's still inside the 30-day
 * polling window, and fetches per-media insights for each — building one
 * `MetricsRow` per live Instagram post. `follows` is always `null` — see
 * `schema.ts`'s header for why per-post follow attribution does not exist
 * on Instagram.
 */
export async function collectInstagramRows(options: CollectInstagramRowsOptions): Promise<MetricsRow[]> {
	const { config, now, windowDays = POLLING_WINDOW_DAYS, fetchFn } = options;

	const media = await listInstagramMedia(config, fetchFn);
	const withinWindow = media.filter((item) => isWithinPollingWindow(item.publishedAt, now, windowDays));

	const rows: MetricsRow[] = [];
	for (const item of withinWindow) {
		const metrics = await fetchInstagramMediaMetrics(config, item, fetchFn);
		rows.push({
			platform: 'instagram',
			postId: item.id,
			format: 'wall',
			publishedAt: item.publishedAt,
			views: metrics.views,
			averagePercentWatched: metrics.averagePercentWatched,
			likes: metrics.likes,
			comments: metrics.comments,
			shares: metrics.shares,
			saves: metrics.saves,
			follows: null,
			collectedAt: now
		});
	}
	return rows;
}
