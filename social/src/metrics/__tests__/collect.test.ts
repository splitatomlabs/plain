/**
 * Tests for `../collect.ts` (Pf39c2-social-pilot-03 T12).
 *
 * No real network call or filesystem access happens anywhere in this file —
 * `fetchFn`s are `vi.fn()` fakes, and the rows/follower/pending-flips stores
 * are plain in-memory fakes injected via `RunMetricsCollectionOptions`.
 *
 * Coverage, matching this task's brief:
 *   - **THE ACCEPTANCE CRITERION**: running the same collection twice for
 *     the same collection date does not duplicate rows — the row count and
 *     content converge, not double.
 *   - Platform isolation: an Instagram failure does not prevent YouTube's
 *     rows from being collected, and vice versa.
 *   - The Instagram follower-snapshot file is upserted (not duplicated) on
 *     a same-day re-run, and a follower-snapshot failure does not prevent
 *     per-post rows from being written.
 */

import { describe, expect, it, vi } from 'vitest';

import { runMetricsCollection, type FollowerSnapshotStore, type MetricsRowsStore } from '../collect.js';
import type { InstagramFollowerSnapshot, MetricsRow } from '../schema.js';
import type { InstagramMetricsConfig } from '../instagram.js';
import type { YouTubeMetricsConfig } from '../youtube.js';
import type { PendingYouTubeFlip } from '../../publish/tiktok-manual.js';

const NOW = '2026-09-05T00:00:00.000Z';

const IG_CONFIG: InstagramMetricsConfig = { igUserId: 'ig-user-1', accessToken: 'ig-secret' };
const YT_CONFIG: YouTubeMetricsConfig = { accessToken: 'yt-secret' };

const FLIP: PendingYouTubeFlip = { date: '2026-09-01', cardId: 'card-1', videoId: 'video-1' };

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body,
		text: async () => JSON.stringify(body)
	} as Response;
}

/**
 * A stable, repeatable Instagram Graph API fake — same response every call,
 * since a re-run re-fetches "current" data. `media_type: 'VIDEO'` (not
 * `IMAGE`) throughout this file: instagram.ts's M5 fix skips non-`VIDEO`
 * media before ever requesting the Reels-only `plays`/`ig_reels_avg_watch_time`
 * metrics these fixtures return, so an `IMAGE` item paired with a `plays`
 * value is a combination Meta's real API never produces (and, since the
 * fix, one this suite would never see collected anyway).
 */
function buildInstagramFetchFn() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes(`/${IG_CONFIG.igUserId}/media?`)) {
			return jsonResponse({ data: [{ id: 'media-1', timestamp: '2026-09-01T00:00:00+0000', media_type: 'VIDEO' }] });
		}
		if (url.includes('/media-1/insights')) {
			return jsonResponse({ data: [{ name: 'plays', values: [{ value: 42 }] }, { name: 'likes', values: [{ value: 5 }] }] });
		}
		if (url.includes(`/${IG_CONFIG.igUserId}/insights?metric=follower_count`)) {
			return jsonResponse({ data: [{ name: 'follower_count', values: [{ value: 120 }] }] });
		}
		throw new Error(`unexpected Instagram fetch: ${url}`);
	});
}

/** A stable, repeatable YouTube API fake. */
function buildYouTubeFetchFn() {
	return vi.fn(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.includes('/videos?')) {
			return jsonResponse({
				items: [{ snippet: { publishedAt: '2026-09-01T00:00:00Z' }, statistics: { viewCount: '999999', likeCount: '9', commentCount: '1' } }]
			});
		}
		if (url.includes('/reports?')) {
			return jsonResponse({
				columnHeaders: [{ name: 'engagedViews' }, { name: 'averageViewPercentage' }, { name: 'subscribersGained' }],
				rows: [[80, 55, 1]]
			});
		}
		throw new Error(`unexpected YouTube fetch: ${url}`);
	});
}

function createInMemoryRowsStore(): MetricsRowsStore {
	const files = new Map<string, MetricsRow[]>();
	return {
		async read(filePath) {
			return files.get(filePath) ?? [];
		},
		async write(filePath, rows) {
			files.set(filePath, rows);
		}
	};
}

function createInMemoryFollowerStore(): FollowerSnapshotStore {
	const files = new Map<string, InstagramFollowerSnapshot[]>();
	return {
		async read(filePath) {
			return files.get(filePath) ?? [];
		},
		async write(filePath, snapshots) {
			files.set(filePath, snapshots);
		}
	};
}

describe('runMetricsCollection — THE ACCEPTANCE CRITERION: idempotent re-runs do not duplicate rows', () => {
	it('running the same collection twice for the same date leaves exactly one row per live post', async () => {
		const rowsStore = createInMemoryRowsStore();
		const followerStore = createInMemoryFollowerStore();

		const runOnce = () =>
			runMetricsCollection({
				now: NOW,
				outDir: '/fake/metrics',
				instagram: { config: IG_CONFIG, fetchFn: buildInstagramFetchFn() },
				youtube: { config: YT_CONFIG, fetchFn: buildYouTubeFetchFn() },
				readPendingYouTubeFlips: async () => [FLIP],
				rowsStore,
				followerStore
			});

		const first = await runOnce();
		expect(first.rows).toHaveLength(2); // one Instagram row, one YouTube row.

		const second = await runOnce();
		expect(second.rows).toHaveLength(2); // NOT 4 — re-running must update in place, not append.

		// The same two platform+postId keys, not a duplicate of either.
		const keys = second.rows.map((row) => `${row.platform}:${row.postId}`).sort();
		expect(keys).toEqual(['instagram:media-1', 'youtube:video-1']);

		// Both runs wrote to the SAME dated file path.
		expect(first.filePath).toBe(second.filePath);
		expect(first.filePath).toBe('/fake/metrics/metrics-2026-09-05.json');
	});

	it('re-running with CHANGED metrics updates the row in place rather than keeping the stale one', async () => {
		const rowsStore = createInMemoryRowsStore();
		const followerStore = createInMemoryFollowerStore();

		await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: buildInstagramFetchFn() },
			readPendingYouTubeFlips: async () => [],
			rowsStore,
			followerStore
		});

		// A second run where the post's like count has grown.
		const updatedFetchFn = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes(`/${IG_CONFIG.igUserId}/media?`)) {
				return jsonResponse({ data: [{ id: 'media-1', timestamp: '2026-09-01T00:00:00+0000', media_type: 'VIDEO' }] });
			}
			if (url.includes('/media-1/insights')) {
				return jsonResponse({ data: [{ name: 'plays', values: [{ value: 999 }] }, { name: 'likes', values: [{ value: 50 }] }] });
			}
			if (url.includes('/insights?metric=follower_count')) {
				return jsonResponse({ data: [{ name: 'follower_count', values: [{ value: 121 }] }] });
			}
			throw new Error(`unexpected: ${url}`);
		});

		const second = await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: updatedFetchFn },
			readPendingYouTubeFlips: async () => [],
			rowsStore,
			followerStore
		});

		expect(second.rows).toHaveLength(1);
		expect(second.rows[0].views).toBe(999);
		expect(second.rows[0].likes).toBe(50);
	});
});

describe('runMetricsCollection — platform isolation', () => {
	it('a YouTube failure does not prevent Instagram rows from being collected', async () => {
		const failingYouTubeFetch = vi.fn().mockRejectedValue(new Error('YouTube is down'));

		const result = await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: buildInstagramFetchFn() },
			youtube: { config: YT_CONFIG, fetchFn: failingYouTubeFetch },
			readPendingYouTubeFlips: async () => [FLIP],
			rowsStore: createInMemoryRowsStore(),
			followerStore: createInMemoryFollowerStore()
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].platform).toBe('instagram');
	});

	it('an Instagram failure does not prevent YouTube rows from being collected', async () => {
		const failingInstagramFetch = vi.fn().mockRejectedValue(new Error('Instagram is down'));

		const result = await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: failingInstagramFetch },
			youtube: { config: YT_CONFIG, fetchFn: buildYouTubeFetchFn() },
			readPendingYouTubeFlips: async () => [FLIP],
			rowsStore: createInMemoryRowsStore(),
			followerStore: createInMemoryFollowerStore()
		});

		expect(result.rows).toHaveLength(1);
		expect(result.rows[0].platform).toBe('youtube');
		// The follower snapshot attempt also failed gracefully — no snapshot, no throw.
		expect(result.followerSnapshot).toBeUndefined();
	});

	it('never throws out of runMetricsCollection even when both platforms fail', async () => {
		await expect(
			runMetricsCollection({
				now: NOW,
				outDir: '/fake/metrics',
				instagram: { config: IG_CONFIG, fetchFn: vi.fn().mockRejectedValue(new Error('down')) },
				youtube: { config: YT_CONFIG, fetchFn: vi.fn().mockRejectedValue(new Error('down')) },
				readPendingYouTubeFlips: async () => [FLIP],
				rowsStore: createInMemoryRowsStore(),
				followerStore: createInMemoryFollowerStore()
			})
		).resolves.toMatchObject({ rows: [] });
	});
});

describe('runMetricsCollection — Instagram follower snapshot', () => {
	it('upserts (not duplicates) the same-day follower snapshot on a re-run', async () => {
		const followerStore = createInMemoryFollowerStore();
		const rowsStore = createInMemoryRowsStore();

		await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: buildInstagramFetchFn() },
			readPendingYouTubeFlips: async () => [],
			rowsStore,
			followerStore
		});
		const second = await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: buildInstagramFetchFn() },
			readPendingYouTubeFlips: async () => [],
			rowsStore,
			followerStore
		});

		expect(second.followerSnapshot).toEqual({ date: '2026-09-05', followerCount: 120 });

		const snapshots = await followerStore.read('/fake/metrics/instagram-followers.json');
		expect(snapshots).toHaveLength(1);
	});

	it('a follower-snapshot failure does not prevent per-post rows from being written', async () => {
		const flakyFetchFn = vi.fn(async (input: RequestInfo | URL) => {
			const url = String(input);
			if (url.includes(`/${IG_CONFIG.igUserId}/media?`)) {
				return jsonResponse({ data: [{ id: 'media-1', timestamp: '2026-09-01T00:00:00+0000', media_type: 'VIDEO' }] });
			}
			if (url.includes('/media-1/insights')) {
				return jsonResponse({ data: [{ name: 'plays', values: [{ value: 1 }] }] });
			}
			// Both the gated metric AND the ungated fallback fail — a genuine outage.
			return jsonResponse({ error: { code: 190, message: 'invalid token' } });
		});

		const result = await runMetricsCollection({
			now: NOW,
			outDir: '/fake/metrics',
			instagram: { config: IG_CONFIG, fetchFn: flakyFetchFn },
			readPendingYouTubeFlips: async () => [],
			rowsStore: createInMemoryRowsStore(),
			followerStore: createInMemoryFollowerStore()
		});

		expect(result.rows).toHaveLength(1);
		expect(result.followerSnapshot).toBeUndefined();
	});
});
