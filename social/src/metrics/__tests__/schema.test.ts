/**
 * Tests for `../schema.ts` (Pf39c2-social-pilot-03 T12).
 *
 * Coverage, matching this task's brief:
 *   - `MetricsRow`'s available-vs-zero distinction: a row can carry a real
 *     `0` for one field and `null` for another, and they must never collapse
 *     into each other through serialization or the upsert path.
 *   - `isWithinPollingWindow`'s 30-day boundary, inclusive at exactly 30
 *     days, exclusive one millisecond past it.
 *   - `upsertMetricsRow`'s idempotency: re-upserting a row keyed on the same
 *     platform+postId replaces it in place rather than appending a
 *     duplicate — the pure building block `collect.ts`'s own idempotent
 *     re-run acceptance test relies on.
 *   - Round-trip parse/serialize for both the metrics rows file and the
 *     Instagram follower-snapshots file.
 */

import { describe, expect, it } from 'vitest';

import {
	INSTAGRAM_FOLLOWERS_FILENAME,
	POLLING_WINDOW_DAYS,
	instagramFollowersFilePathFor,
	isWithinPollingWindow,
	metricsFilePathFor,
	metricsRowKey,
	parseFollowerSnapshots,
	parseMetricsRows,
	serializeFollowerSnapshots,
	serializeMetricsRows,
	upsertFollowerSnapshot,
	upsertMetricsRow,
	type InstagramFollowerSnapshot,
	type MetricsRow
} from '../schema.js';

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
	return {
		platform: 'instagram',
		postId: 'media-1',
		format: 'wall',
		publishedAt: '2026-09-01T12:00:00.000Z',
		views: 100,
		averagePercentWatched: 50,
		likes: 10,
		comments: 2,
		shares: 1,
		saves: 3,
		follows: null,
		collectedAt: '2026-09-02T00:00:00.000Z',
		...overrides
	};
}

describe('MetricsRow — available vs. zero', () => {
	it('never collapses a real 0 and a null into the same value across a round trip', () => {
		const withRealZeroSaves = row({ saves: 0, follows: null });
		const serialized = serializeMetricsRows([withRealZeroSaves]);
		const parsed = parseMetricsRows(serialized);

		expect(parsed[0].saves).toBe(0);
		expect(parsed[0].saves).not.toBeNull();
		expect(parsed[0].follows).toBeNull();
		expect(parsed[0].follows).not.toBe(0);
	});

	it('a YouTube row keeps saves/shares null while views is a real number, including 0', () => {
		const youtubeRow = row({
			platform: 'youtube',
			postId: 'yt-1',
			views: 0,
			shares: null,
			saves: null,
			follows: 5
		});

		expect(youtubeRow.views).toBe(0);
		expect(youtubeRow.saves).toBeNull();
		expect(youtubeRow.shares).toBeNull();
		expect(youtubeRow.follows).toBe(5);
	});
});

describe('isWithinPollingWindow', () => {
	const PUBLISHED_AT = '2026-09-01T00:00:00.000Z';

	it('is true immediately at publication', () => {
		expect(isWithinPollingWindow(PUBLISHED_AT, PUBLISHED_AT)).toBe(true);
	});

	it('is true at exactly the 30-day boundary (inclusive)', () => {
		const exactlyThirtyDaysLater = '2026-10-01T00:00:00.000Z';
		expect(isWithinPollingWindow(PUBLISHED_AT, exactlyThirtyDaysLater, POLLING_WINDOW_DAYS)).toBe(true);
	});

	it('is false one millisecond past the 30-day boundary', () => {
		const oneMsPastThirtyDays = '2026-10-01T00:00:00.001Z';
		expect(isWithinPollingWindow(PUBLISHED_AT, oneMsPastThirtyDays, POLLING_WINDOW_DAYS)).toBe(false);
	});

	it('is false for a post published in the future relative to now', () => {
		const before = '2026-08-31T00:00:00.000Z';
		expect(isWithinPollingWindow(PUBLISHED_AT, before)).toBe(false);
	});

	it('respects a custom windowDays', () => {
		const sevenDaysLater = '2026-09-08T00:00:00.000Z';
		expect(isWithinPollingWindow(PUBLISHED_AT, sevenDaysLater, 7)).toBe(true);
		expect(isWithinPollingWindow(PUBLISHED_AT, sevenDaysLater, 6)).toBe(false);
	});
});

describe('upsertMetricsRow — the acceptance criterion\'s building block', () => {
	it('appends a row for a new platform+postId key', () => {
		const existing = [row({ postId: 'media-1' })];
		const updated = upsertMetricsRow(existing, row({ postId: 'media-2' }));
		expect(updated).toHaveLength(2);
	});

	it('replaces, not duplicates, a row with the same platform+postId', () => {
		const existing = [row({ postId: 'media-1', views: 100 })];
		const updated = upsertMetricsRow(existing, row({ postId: 'media-1', views: 250 }));

		expect(updated).toHaveLength(1);
		expect(updated[0].views).toBe(250);
	});

	it('keys on platform AND postId — same postId on a different platform is a distinct row', () => {
		const existing = [row({ platform: 'instagram', postId: 'shared-id' })];
		const updated = upsertMetricsRow(existing, row({ platform: 'youtube', postId: 'shared-id' }));
		expect(updated).toHaveLength(2);
	});

	it('is stable/deterministic regardless of upsert order', () => {
		const a = row({ postId: 'a' });
		const b = row({ postId: 'b' });
		const viaAB = upsertMetricsRow(upsertMetricsRow([], a), b);
		const viaBA = upsertMetricsRow(upsertMetricsRow([], b), a);
		expect(viaAB).toEqual(viaBA);
	});
});

describe('metricsRowKey', () => {
	it('combines platform and postId', () => {
		expect(metricsRowKey({ platform: 'instagram', postId: 'abc' })).toBe('instagram:abc');
		expect(metricsRowKey({ platform: 'youtube', postId: 'abc' })).toBe('youtube:abc');
	});
});

describe('metricsFilePathFor', () => {
	it('names the file after the collection date, tolerating a trailing slash on outDir', () => {
		expect(metricsFilePathFor('/content/social/metrics', '2026-09-15')).toBe('/content/social/metrics/metrics-2026-09-15.json');
		expect(metricsFilePathFor('/content/social/metrics/', '2026-09-15')).toBe('/content/social/metrics/metrics-2026-09-15.json');
	});
});

describe('parseMetricsRows / serializeMetricsRows round trip', () => {
	it('round-trips a list of rows exactly', () => {
		const rows = [row({ postId: 'a' }), row({ postId: 'b', platform: 'youtube', saves: null, shares: null, follows: 4 })];
		expect(parseMetricsRows(serializeMetricsRows(rows))).toEqual(rows);
	});

	it('treats an empty/whitespace-only file as an empty array, not an error', () => {
		expect(parseMetricsRows('')).toEqual([]);
		expect(parseMetricsRows('   \n')).toEqual([]);
	});

	it('throws if the file does not contain a JSON array', () => {
		expect(() => parseMetricsRows('{"not":"an array"}')).toThrow(/JSON array/);
	});
});

describe('Instagram follower snapshots — upsert + round trip', () => {
	function snapshot(overrides: Partial<InstagramFollowerSnapshot> = {}): InstagramFollowerSnapshot {
		return { date: '2026-09-01', followerCount: 42, ...overrides };
	}

	it('replaces a same-date snapshot rather than duplicating it', () => {
		const existing = [snapshot({ date: '2026-09-01', followerCount: 42 })];
		const updated = upsertFollowerSnapshot(existing, snapshot({ date: '2026-09-01', followerCount: 50 }));

		expect(updated).toHaveLength(1);
		expect(updated[0].followerCount).toBe(50);
	});

	it('appends a distinct date', () => {
		const existing = [snapshot({ date: '2026-09-01' })];
		const updated = upsertFollowerSnapshot(existing, snapshot({ date: '2026-09-02' }));
		expect(updated).toHaveLength(2);
	});

	it('round-trips through parse/serialize', () => {
		const snapshots = [snapshot({ date: '2026-09-01' }), snapshot({ date: '2026-09-02', followerCount: 43 })];
		expect(parseFollowerSnapshots(serializeFollowerSnapshots(snapshots))).toEqual(snapshots);
	});

	it('the followers file lives under the metrics outDir, named INSTAGRAM_FOLLOWERS_FILENAME', () => {
		expect(instagramFollowersFilePathFor('/content/social/metrics')).toBe(`/content/social/metrics/${INSTAGRAM_FOLLOWERS_FILENAME}`);
	});
});
