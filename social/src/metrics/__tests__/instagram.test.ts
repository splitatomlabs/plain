/**
 * Tests for `../instagram.ts` (Pf39c2-social-pilot-03 T12).
 *
 * No real network call happens anywhere in this file — `fetchFn` is always
 * a `vi.fn()` fake.
 *
 * Coverage, matching this task's brief:
 *   - `listInstagramMedia` parses the media-list response into
 *     `InstagramMediaSummary[]`.
 *   - `fetchInstagramMediaMetrics` parses per-media insights and derives
 *     `averagePercentWatched` from watch time + duration, or `null` when
 *     duration is unknown.
 *   - `fetchInstagramFollowerSnapshot` falls back to the ungated
 *     `followers_count` field when the gated `follower_count` insights call
 *     fails (the <100-follower case) — handled gracefully, never thrown —
 *     and still throws if BOTH calls fail (a genuine outage).
 *   - `collectInstagramRows` filters to the 30-day window and builds rows
 *     with `follows: null` always.
 */

import { describe, expect, it, vi } from 'vitest';

import {
	InstagramMetricsApiError,
	collectInstagramRows,
	fetchInstagramFollowerSnapshot,
	fetchInstagramMediaMetrics,
	listInstagramMedia,
	type InstagramMediaSummary,
	type InstagramMetricsConfig
} from '../instagram.js';

const CONFIG: InstagramMetricsConfig = {
	igUserId: 'ig-user-1',
	accessToken: 'super-secret-ig-token',
	graphApiBaseUrl: 'https://graph.facebook.test/v99.0'
};

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body
	} as Response;
}

function metaError(code: number, message = 'a Meta error') {
	return { error: { code, message } };
}

describe('listInstagramMedia', () => {
	it('parses id/timestamp/media_type/video_duration into InstagramMediaSummary[]', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				data: [
					{ id: 'media-1', timestamp: '2026-09-01T12:00:00+0000', media_type: 'VIDEO', video_duration: 12.5 },
					{ id: 'media-2', timestamp: '2026-08-30T09:00:00+0000', media_type: 'IMAGE' }
				]
			})
		);

		const media = await listInstagramMedia(CONFIG, fetchFn);

		expect(media).toEqual([
			{ id: 'media-1', publishedAt: '2026-09-01T12:00:00+0000', mediaType: 'VIDEO', videoDurationSec: 12.5 },
			{ id: 'media-2', publishedAt: '2026-08-30T09:00:00+0000', mediaType: 'IMAGE', videoDurationSec: undefined }
		]);

		const [url] = fetchFn.mock.calls[0];
		expect(String(url)).toContain(`${CONFIG.graphApiBaseUrl}/${CONFIG.igUserId}/media`);
		expect(String(url)).toContain('fields=id%2Ctimestamp%2Cmedia_type%2Cvideo_duration');
	});

	it('throws a redacted-URL error rather than the raw request URL on a non-JSON response', async () => {
		const fetchFn = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => { throw new Error('nope'); } } as unknown as Response);

		await expect(listInstagramMedia(CONFIG, fetchFn)).rejects.toThrow(/REDACTED/);
	});
});

describe('fetchInstagramMediaMetrics', () => {
	const REEL: InstagramMediaSummary = { id: 'media-1', publishedAt: '2026-09-01T00:00:00+0000', mediaType: 'VIDEO', videoDurationSec: 20 };

	it('parses views/likes/comments/shares/saves from the insights response', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				data: [
					{ name: 'plays', values: [{ value: 500 }] },
					{ name: 'likes', values: [{ value: 40 }] },
					{ name: 'comments', values: [{ value: 3 }] },
					{ name: 'shares', values: [{ value: 2 }] },
					{ name: 'saved', values: [{ value: 5 }] },
					{ name: 'ig_reels_avg_watch_time', values: [{ value: 10000 }] }
				]
			})
		);

		const metrics = await fetchInstagramMediaMetrics(CONFIG, REEL, fetchFn);

		expect(metrics.views).toBe(500);
		expect(metrics.likes).toBe(40);
		expect(metrics.comments).toBe(3);
		expect(metrics.shares).toBe(2);
		expect(metrics.saves).toBe(5);
		// 10000ms average watch time / 20s duration = 50%.
		expect(metrics.averagePercentWatched).toBe(50);
	});

	it('returns null averagePercentWatched when the media has no known duration (e.g. a still image)', async () => {
		const still: InstagramMediaSummary = { id: 'media-2', publishedAt: '2026-09-01T00:00:00+0000', mediaType: 'IMAGE' };
		const fetchFn = vi.fn().mockResolvedValue(
			jsonResponse({
				data: [
					{ name: 'likes', values: [{ value: 12 }] },
					{ name: 'comments', values: [{ value: 1 }] }
				]
			})
		);

		const metrics = await fetchInstagramMediaMetrics(CONFIG, still, fetchFn);

		expect(metrics.averagePercentWatched).toBeNull();
		// Metrics never returned by Meta for this media default to a real 0, not null — Instagram DOES report these for every media type.
		expect(metrics.views).toBe(0);
		expect(metrics.shares).toBe(0);
		expect(metrics.saves).toBe(0);
	});

	it('throws InstagramMetricsApiError on a Meta error response', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(100, 'Invalid parameter')));
		await expect(fetchInstagramMediaMetrics(CONFIG, REEL, fetchFn)).rejects.toBeInstanceOf(InstagramMetricsApiError);
	});
});

describe('fetchInstagramFollowerSnapshot — the <100-follower graceful fallback', () => {
	it('uses the gated follower_count insights metric when it succeeds', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ data: [{ name: 'follower_count', values: [{ value: 150 }] }] }));

		const result = await fetchInstagramFollowerSnapshot(CONFIG, '2026-09-01', fetchFn);

		expect(result).toEqual({ snapshot: { date: '2026-09-01', followerCount: 150 }, usedFallback: false });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it('falls back to the ungated followers_count field when the insights call errors (the <100-follower case), and does NOT throw', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(metaError(100, 'This metric requires at least 100 followers')))
			.mockResolvedValueOnce(jsonResponse({ followers_count: 37 }));

		const result = await fetchInstagramFollowerSnapshot(CONFIG, '2026-09-01', fetchFn);

		expect(result).toEqual({ snapshot: { date: '2026-09-01', followerCount: 37 }, usedFallback: true });
		expect(fetchFn).toHaveBeenCalledTimes(2);
		// The second (fallback) call hits the ungated basic-field endpoint, not another insights call.
		const [fallbackUrl] = fetchFn.mock.calls[1];
		expect(String(fallbackUrl)).toContain('fields=followers_count');
		expect(String(fallbackUrl)).not.toContain('/insights');
	});

	it('throws if BOTH the gated metric and the ungated fallback fail — a real outage is not silently swallowed', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(jsonResponse(metaError(100, 'not enough followers')))
			.mockResolvedValueOnce(jsonResponse(metaError(190, 'invalid access token')));

		await expect(fetchInstagramFollowerSnapshot(CONFIG, '2026-09-01', fetchFn)).rejects.toBeInstanceOf(InstagramMetricsApiError);
	});
});

describe('collectInstagramRows', () => {
	it('filters media outside the 30-day window and never includes them', async () => {
		const now = '2026-09-30T00:00:00.000Z';
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(
			jsonResponse({
				data: [
					{ id: 'recent', timestamp: '2026-09-01T00:00:00+0000', media_type: 'VIDEO', video_duration: 10 }, // 29 days old — in window
					{ id: 'old', timestamp: '2026-06-01T00:00:00+0000', media_type: 'VIDEO', video_duration: 10 } // long past 30 days
				]
			})
		);
		fetchFn.mockResolvedValueOnce(
			jsonResponse({ data: [{ name: 'plays', values: [{ value: 10 }] }] }) // insights for "recent" only
		);

		const rows = await collectInstagramRows({ config: CONFIG, now, fetchFn });

		expect(rows).toHaveLength(1);
		expect(rows[0].postId).toBe('recent');
		// Exactly 2 calls: one media list, one insights call for the single in-window item.
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('always sets follows to null — per-post follow attribution does not exist on Instagram', async () => {
		const now = '2026-09-01T00:00:00.000Z';
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(jsonResponse({ data: [{ id: 'm1', timestamp: now, media_type: 'IMAGE' }] }));
		fetchFn.mockResolvedValueOnce(jsonResponse({ data: [{ name: 'likes', values: [{ value: 5 }] }] }));

		const rows = await collectInstagramRows({ config: CONFIG, now, fetchFn });

		expect(rows).toHaveLength(1);
		expect(rows[0].follows).toBeNull();
		expect(rows[0].platform).toBe('instagram');
		expect(rows[0].format).toBe('wall');
	});
});

describe('never logs the access token', () => {
	it('does not appear in a thrown error message', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(100, 'Invalid parameter')));
		let thrown: unknown;
		try {
			await listInstagramMedia(CONFIG, fetchFn);
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
	});
});
