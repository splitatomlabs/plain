/**
 * Tests for `../youtube.ts` (Pf39c2-social-pilot-03 T12).
 *
 * No real network call happens anywhere in this file — `fetchFn` is always a
 * `vi.fn()` fake.
 *
 * Coverage, matching this task's brief and the plan's own Constraint
 * ("Track YouTube `engagedViews`, not `views`"):
 *   - `fetchYouTubeVideoInfo` reads `likes`/`comments`/`publishedAt` and
 *     PROVABLY never reads `statistics.viewCount` — a fixture with a huge
 *     `viewCount` and no `views`/`engagedViews` field asserted absent from
 *     the parsed result.
 *   - `fetchYouTubeEngagementMetrics` parses `engagedViews`/
 *     `averageViewPercentage`/`subscribersGained` by matching
 *     `columnHeaders` names, independent of column order.
 *   - `collectYouTubeRows` builds a row whose `views` field is the
 *     Analytics API's `engagedViews`, never the Data API's `viewCount`, even
 *     when the two disagree — the exact scenario the March 2025 Shorts
 *     view-counting change makes possible.
 *   - The 30-day polling window is respected using the video's real
 *     `snippet.publishedAt`, not the pending-flip's coarse calendar date.
 */

import { describe, expect, it, vi } from 'vitest';

import {
	collectYouTubeRows,
	fetchYouTubeEngagementMetrics,
	fetchYouTubeVideoInfo,
	YouTubeMetricsApiError,
	type YouTubeMetricsConfig
} from '../youtube.js';
import type { PendingYouTubeFlip } from '../../publish/tiktok-manual.js';

const CONFIG: YouTubeMetricsConfig = {
	accessToken: 'super-secret-yt-token',
	dataApiBaseUrl: 'https://data.youtube.test/v3',
	analyticsApiBaseUrl: 'https://analytics.youtube.test/v2'
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body,
		text: async () => JSON.stringify(body)
	} as Response;
}

describe('fetchYouTubeVideoInfo — never reads statistics.viewCount', () => {
	it('parses likes/comments/publishedAt and never surfaces viewCount anywhere in the result', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				items: [
					{
						snippet: { publishedAt: '2026-09-01T12:00:00Z' },
						// A deliberately huge, misleading viewCount — since March 2025 this
						// counts every Short start with no minimum watch time (the plan's
						// own Constraint). This test proves it never reaches the result.
						statistics: { viewCount: '999999999', likeCount: '40', commentCount: '3' }
					}
				]
			})
		);

		const info = await fetchYouTubeVideoInfo(CONFIG, 'video-1', fetchFn);

		expect(info).toEqual({ publishedAt: '2026-09-01T12:00:00Z', likes: 40, comments: 3 });
		expect(Object.keys(info)).not.toContain('viewCount');
		expect(Object.keys(info)).not.toContain('views');

		const [url, init] = fetchFn.mock.calls[0];
		expect(String(url)).toContain(`${CONFIG.dataApiBaseUrl}/videos`);
		expect(String(url)).toContain('part=snippet%2Cstatistics');
		expect((init as RequestInit).headers).toEqual({ Authorization: `Bearer ${CONFIG.accessToken}` });
	});

	it('throws YouTubeMetricsApiError on a non-OK response', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 404 }));
		await expect(fetchYouTubeVideoInfo(CONFIG, 'missing', fetchFn)).rejects.toBeInstanceOf(YouTubeMetricsApiError);
	});
});

describe('fetchYouTubeEngagementMetrics', () => {
	it('parses engagedViews/averageViewPercentage/subscribersGained regardless of column order', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				columnHeaders: [{ name: 'video' }, { name: 'subscribersGained' }, { name: 'averageViewPercentage' }, { name: 'engagedViews' }],
				rows: [['video-1', 7, 65.5, 1200]]
			})
		);

		const metrics = await fetchYouTubeEngagementMetrics(CONFIG, 'video-1', '2026-09-01', '2026-09-30', fetchFn);

		expect(metrics).toEqual({ engagedViews: 1200, averageViewPercentage: 65.5, subscribersGained: 7 });

		const [url] = fetchFn.mock.calls[0];
		expect(String(url)).toContain(`${CONFIG.analyticsApiBaseUrl}/reports`);
		expect(String(url)).toContain('metrics=engagedViews%2CaverageViewPercentage%2CsubscribersGained');
		expect(String(url)).toContain('dimensions=video');
		expect(String(url)).toContain('filters=video%3D%3Dvideo-1');
	});

	it('returns real zeros (not an error) when no rows have accrued yet', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({ columnHeaders: [{ name: 'video' }, { name: 'engagedViews' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }], rows: [] })
		);

		const metrics = await fetchYouTubeEngagementMetrics(CONFIG, 'video-1', '2026-09-01', '2026-09-01', fetchFn);
		expect(metrics).toEqual({ engagedViews: 0, averageViewPercentage: 0, subscribersGained: 0 });
	});

	it('throws if a required metric is missing from columnHeaders', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ columnHeaders: [{ name: 'video' }, { name: 'engagedViews' }], rows: [['video-1', 10]] }));
		await expect(fetchYouTubeEngagementMetrics(CONFIG, 'video-1', '2026-09-01', '2026-09-01', fetchFn)).rejects.toThrow(/columnHeaders/);
	});
});

describe('collectYouTubeRows', () => {
	const FLIP: PendingYouTubeFlip = { date: '2026-09-01', cardId: 'card-1', videoId: 'video-1' };

	it('builds a row whose views is engagedViews, never the Data API viewCount, even when they disagree wildly', async () => {
		const now = '2026-09-05T00:00:00.000Z';
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(
			jsonResponse({
				items: [
					{
						snippet: { publishedAt: '2026-09-01T00:00:00Z' },
						statistics: { viewCount: '5000000', likeCount: '20', commentCount: '4' }
					}
				]
			})
		);
		fetchFn.mockResolvedValueOnce(
			jsonResponse({
				columnHeaders: [{ name: 'engagedViews' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }],
				rows: [[300, 72.1, 2]]
			})
		);

		const rows = await collectYouTubeRows({ config: CONFIG, flips: [FLIP], now, fetchFn });

		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			platform: 'youtube',
			postId: 'video-1',
			format: 'wall',
			views: 300, // engagedViews — NOT the 5,000,000 viewCount fixture above.
			averagePercentWatched: 72.1,
			likes: 20,
			comments: 4,
			shares: null,
			saves: null,
			follows: 2
		});
	});

	it('excludes a flip whose real publishedAt falls outside the 30-day window', async () => {
		// Chosen so the COARSE pre-filter (widened by 1 day, keyed on the flip's
		// calendar date) still passes, but the PRECISE filter (keyed on the
		// video's real `snippet.publishedAt`, fetched below) does not — proving
		// the exclusion happens on the real timestamp, not the coarse one.
		const now = '2026-10-02T00:00:00.000Z'; // exactly 31 days after the real publishedAt (2026-09-01T00:00:00Z)
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				items: [{ snippet: { publishedAt: '2026-09-01T00:00:00Z' }, statistics: { likeCount: '1', commentCount: '0' } }]
			})
		);

		const rows = await collectYouTubeRows({ config: CONFIG, flips: [FLIP], now, fetchFn });

		expect(rows).toHaveLength(0);
		// Only the Data API call happened — no wasted Analytics call for an out-of-window video.
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('skips a network call entirely for a flip whose coarse date is far outside the window (pre-filter)', async () => {
		const now = '2026-12-01T00:00:00.000Z';
		const fetchFn = vi.fn();

		const rows = await collectYouTubeRows({ config: CONFIG, flips: [FLIP], now, fetchFn });

		expect(rows).toHaveLength(0);
		expect(fetchFn).not.toHaveBeenCalled();
	});
});

describe('never logs the access token', () => {
	it('does not appear in a thrown error message', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
		let thrown: unknown;
		try {
			await fetchYouTubeVideoInfo(CONFIG, 'video-1', fetchFn);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
	});
});
