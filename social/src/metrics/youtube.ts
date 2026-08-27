/**
 * The YouTube metrics collector (Pf39c2-social-pilot-03 T12) — Data API
 * `statistics` for counts, Analytics API `reports.query` for
 * `engagedViews`, `averageViewPercentage` and `subscribersGained` per video.
 *
 * *** TRACK `engagedViews`, NEVER `views` ***
 * Plan Constraint, verbatim: "Track YouTube `engagedViews`, not `views` —
 * since March 2025 `views` counts every Short start with no minimum watch
 * time." This module makes that impossible to get wrong by construction:
 * `fetchYouTubeVideoInfo` (the Data API call) deliberately never reads
 * `statistics.viewCount` at all — not even to discard it — and the ONLY
 * place a view count enters this module is `YouTubeEngagementMetrics.
 * engagedViews`, fetched from the Analytics API and named so a caller
 * cannot mistake it for the raw Data API count. `schema.ts`'s `MetricsRow.
 * views` field comment repeats this rule at the point a caller assigns into
 * it.
 *
 * OAUTH SCOPE: reuses the SAME OAuth token `publish/youtube.ts` already
 * refreshes for uploads, with the analytics READ scope added:
 *   `https://www.googleapis.com/auth/yt-analytics.readonly`
 * (alongside the existing `https://www.googleapis.com/auth/youtube.upload`).
 * Both scopes must be granted on the SAME OAuth consent — this module does
 * not perform its own separate OAuth flow, matching `publish/youtube.ts`'s
 * own `YouTubeConfig.accessToken` shape (a bearer token the caller already
 * holds).
 *
 * Never logs `config.accessToken` — same discipline as `publish/
 * youtube.ts`: the token is sent only as an `Authorization: Bearer` header,
 * never a URL query parameter, so there is no URL to redact, and no thrown
 * error interpolates it.
 */

import { POLLING_WINDOW_DAYS, isWithinPollingWindow, type MetricsRow } from './schema.js';
import type { PendingYouTubeFlip } from '../publish/tiktok-manual.js';

/** A `fetch`-compatible function. Injectable so tests never make a real network call. */
export type FetchFn = typeof globalThis.fetch;

export interface YouTubeMetricsConfig {
	/**
	 * An OAuth2 access token with BOTH `youtube.upload` (already required by
	 * `publish/youtube.ts`) and `yt-analytics.readonly` (added for this
	 * module) scopes. NEVER logged — see this file's header.
	 */
	accessToken: string;
	/** Overridable for tests; defaults to `DEFAULT_DATA_API_BASE_URL`. */
	dataApiBaseUrl?: string;
	/** Overridable for tests; defaults to `DEFAULT_ANALYTICS_API_BASE_URL`. */
	analyticsApiBaseUrl?: string;
}

export const DEFAULT_DATA_API_BASE_URL = 'https://www.googleapis.com/youtube/v3';
export const DEFAULT_ANALYTICS_API_BASE_URL = 'https://youtubeanalytics.googleapis.com/v2';

/** Raised for any non-OK YouTube Data/Analytics API response. Never constructed with a token in `message`. */
export class YouTubeMetricsApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'YouTubeMetricsApiError';
		this.status = status;
	}
}

async function apiErrorFrom(response: Response, action: string): Promise<YouTubeMetricsApiError> {
	let detail = '';
	try {
		detail = await response.text();
	} catch {
		// No readable body — fall through with an empty detail.
	}
	return new YouTubeMetricsApiError(
		`Failed to ${action}: YouTube API returned HTTP ${response.status}${detail ? ` — ${detail}` : ''}.`,
		response.status
	);
}

// ---------------------------------------------------------------------------
// Data API — statistics for counts, snippet for the real publish instant.
// ---------------------------------------------------------------------------

export interface YouTubeVideoInfo {
	/** ISO 8601 — `snippet.publishedAt`, the platform's own reported publish instant. */
	publishedAt: string;
	likes: number;
	comments: number;
}

/**
 * `GET videos?part=snippet,statistics&id=<id>`. Deliberately reads ONLY
 * `statistics.likeCount`/`commentCount` and `snippet.publishedAt` — see this
 * file's header for why `statistics.viewCount` is never read here at all.
 */
export async function fetchYouTubeVideoInfo(config: YouTubeMetricsConfig, videoId: string, fetchFn: FetchFn): Promise<YouTubeVideoInfo> {
	const base = config.dataApiBaseUrl ?? DEFAULT_DATA_API_BASE_URL;
	const url = new URL(`${base}/videos`);
	url.searchParams.set('part', 'snippet,statistics');
	url.searchParams.set('id', videoId);

	const response = await fetchFn(url.toString(), { headers: { Authorization: `Bearer ${config.accessToken}` } });
	if (!response.ok) {
		throw await apiErrorFrom(response, `fetch video info for ${videoId}`);
	}

	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`YouTube videos.list response for ${videoId} was not valid JSON.`);
	}

	const items = body.items;
	if (!Array.isArray(items) || items.length === 0) {
		throw new Error(`YouTube videos.list returned no item for video id "${videoId}".`);
	}
	const item = items[0] as Record<string, unknown>;
	const snippet = item.snippet as Record<string, unknown> | undefined;
	const statistics = item.statistics as Record<string, unknown> | undefined;

	const publishedAt = snippet?.publishedAt;
	if (typeof publishedAt !== 'string') {
		throw new Error(`YouTube videos.list item for ${videoId} is missing "snippet.publishedAt".`);
	}

	return {
		publishedAt,
		likes: Number(statistics?.likeCount ?? 0),
		comments: Number(statistics?.commentCount ?? 0)
	};
}

// ---------------------------------------------------------------------------
// Analytics API — engagedViews, averageViewPercentage, subscribersGained.
// ---------------------------------------------------------------------------

const ANALYTICS_METRICS = ['engagedViews', 'averageViewPercentage', 'subscribersGained'] as const;

export interface YouTubeEngagementMetrics {
	/** NEVER the Data API's `viewCount` — see this file's header. */
	engagedViews: number;
	averageViewPercentage: number;
	subscribersGained: number;
}

/**
 * `reports.query` scoped to one video via `dimensions=video`/
 * `filters=video==<id>`. Parses the response by matching `columnHeaders`
 * names to `ANALYTICS_METRICS` rather than assuming a fixed column order —
 * the API does not document column order as stable across requests with a
 * different metric string, and this module's own `ANALYTICS_METRICS`
 * ordering should not become a silent correctness dependency.
 *
 * An empty `rows` array (e.g. a video too new to have any Analytics data
 * yet) returns all-zero metrics — a real "nothing accrued yet," not a
 * fabricated unavailability, since these three metrics ARE always
 * available on YouTube once data exists.
 */
export async function fetchYouTubeEngagementMetrics(
	config: YouTubeMetricsConfig,
	videoId: string,
	startDate: string,
	endDate: string,
	fetchFn: FetchFn
): Promise<YouTubeEngagementMetrics> {
	const base = config.analyticsApiBaseUrl ?? DEFAULT_ANALYTICS_API_BASE_URL;
	const url = new URL(`${base}/reports`);
	url.searchParams.set('ids', 'channel==MINE');
	url.searchParams.set('startDate', startDate);
	url.searchParams.set('endDate', endDate);
	url.searchParams.set('metrics', ANALYTICS_METRICS.join(','));
	url.searchParams.set('dimensions', 'video');
	url.searchParams.set('filters', `video==${videoId}`);

	const response = await fetchFn(url.toString(), { headers: { Authorization: `Bearer ${config.accessToken}` } });
	if (!response.ok) {
		throw await apiErrorFrom(response, `fetch engagement metrics for ${videoId}`);
	}

	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`YouTube Analytics reports.query response for ${videoId} was not valid JSON.`);
	}

	const columnHeaders = body.columnHeaders;
	const rows = body.rows;
	if (!Array.isArray(columnHeaders)) {
		throw new Error(`YouTube Analytics reports.query response for ${videoId} is missing "columnHeaders".`);
	}
	if (!Array.isArray(rows) || rows.length === 0) {
		// No data has accrued for this video yet — real zeros, not "unavailable."
		return { engagedViews: 0, averageViewPercentage: 0, subscribersGained: 0 };
	}

	const row = rows[0] as unknown[];
	const indexOf = (metric: string): number =>
		columnHeaders.findIndex((header) => (header as Record<string, unknown>).name === metric);

	const engagedViewsIndex = indexOf('engagedViews');
	const averageViewPercentageIndex = indexOf('averageViewPercentage');
	const subscribersGainedIndex = indexOf('subscribersGained');
	if (engagedViewsIndex === -1 || averageViewPercentageIndex === -1 || subscribersGainedIndex === -1) {
		throw new Error(
			`YouTube Analytics reports.query response for ${videoId} did not include all of ${ANALYTICS_METRICS.join(', ')} in its columnHeaders.`
		);
	}

	return {
		engagedViews: Number(row[engagedViewsIndex] ?? 0),
		averageViewPercentage: Number(row[averageViewPercentageIndex] ?? 0),
		subscribersGained: Number(row[subscribersGainedIndex] ?? 0)
	};
}

// ---------------------------------------------------------------------------
// Orchestration — one call this platform's whole T12 slice reduces to.
// ---------------------------------------------------------------------------

export interface CollectYouTubeRowsOptions {
	config: YouTubeMetricsConfig;
	/**
	 * The pilot's own record of which videos it uploaded and when — see
	 * `../collect.ts`'s header for why `content/social/
	 * pending-youtube-flips.json` (via `job-plan.ts`'s `parsePendingFlips`)
	 * is the right source for YouTube specifically: it already carries the
	 * real video id T08's daily job learned at upload time, so no discovery
	 * call is needed the way Instagram's collector needs one.
	 */
	flips: PendingYouTubeFlip[];
	/** ISO 8601 — the collection instant. */
	now: string;
	windowDays?: number;
	fetchFn: FetchFn;
}

/**
 * Coarse pre-filter on `flip.date` (widened by one day, since `date` is a
 * calendar day with no time-of-day) so this module never makes a network
 * call for a flip long outside the window — `pending-youtube-flips.json`
 * accumulates for the pilot's whole life, so that list only grows. The
 * PRECISE window check happens after fetching each video's real
 * `snippet.publishedAt`, in `collectYouTubeRows` below.
 */
function isFlipDatePlausiblyInWindow(flip: PendingYouTubeFlip, now: string, windowDays: number): boolean {
	return isWithinPollingWindow(`${flip.date}T23:59:59.999Z`, now, windowDays + 1);
}

/**
 * Fetches Data API counts + Analytics engagement metrics for every pending
 * flip still inside its 30-day polling window, building one `MetricsRow`
 * per live YouTube post. `saves` is always `null` (no such concept on
 * YouTube); `shares` is always `null` (out of this task's literal scope —
 * see `schema.ts`'s header); `follows` is `subscribersGained`, the one
 * platform where per-post follow attribution is exact.
 */
export async function collectYouTubeRows(options: CollectYouTubeRowsOptions): Promise<MetricsRow[]> {
	const { config, flips, now, windowDays = POLLING_WINDOW_DAYS, fetchFn } = options;

	const plausiblyInWindow = flips.filter((flip) => isFlipDatePlausiblyInWindow(flip, now, windowDays));

	const rows: MetricsRow[] = [];
	for (const flip of plausiblyInWindow) {
		const info = await fetchYouTubeVideoInfo(config, flip.videoId, fetchFn);
		if (!isWithinPollingWindow(info.publishedAt, now, windowDays)) {
			continue;
		}

		const engagement = await fetchYouTubeEngagementMetrics(
			config,
			flip.videoId,
			info.publishedAt.slice(0, 10),
			now.slice(0, 10),
			fetchFn
		);

		rows.push({
			platform: 'youtube',
			postId: flip.videoId,
			format: 'wall',
			publishedAt: info.publishedAt,
			views: engagement.engagedViews,
			averagePercentWatched: engagement.averageViewPercentage,
			likes: info.likes,
			comments: info.comments,
			shares: null,
			saves: null,
			follows: engagement.subscribersGained,
			collectedAt: now
		});
	}
	return rows;
}
