/**
 * Tests for `../schema.ts` (Pf39c2-social-pilot-03 T12).
 *
 * Coverage, matching this task's brief:
 *   - `MetricsRow`'s available-vs-zero distinction: a row can carry a real
 *     `0` for one field and `null` for another, and they must never collapse
 *     into each other through serialization or the upsert path.
 *   - `upsertMetricsRow`'s idempotency: re-upserting a row keyed on the same
 *     platform+postId replaces it in place rather than appending a
 *     duplicate — the pure building block `hand-entry.ts`'s own idempotent
 *     re-run acceptance test relies on.
 *   - Round-trip parse/serialize for both the metrics rows file and the
 *     Instagram follower-snapshots file.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
	DEFAULT_METRICS_DIR,
	FOLLOWER_SNAPSHOT_PLATFORMS,
	followersFilenameFor,
	followersFilePathFor,
	metricsFilePathFor,
	metricsRowKey,
	parseFollowerSnapshots,
	parseMetricsRows,
	serializeFollowerSnapshots,
	serializeMetricsRows,
	upsertFollowerSnapshot,
	upsertMetricsRow,
	type FollowerSnapshot,
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
	function snapshot(overrides: Partial<FollowerSnapshot> = {}): FollowerSnapshot {
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

	it('each platform gets its own followers file under the metrics outDir', () => {
		expect(followersFilePathFor('/content/social/metrics', 'instagram')).toBe('/content/social/metrics/instagram-followers.json');
		expect(followersFilePathFor('/content/social/metrics', 'tiktok')).toBe('/content/social/metrics/tiktok-followers.json');
	});

	it('instagram keeps its original filename, so an existing series file is still found after the rename', () => {
		expect(followersFilenameFor('instagram')).toBe('instagram-followers.json');
	});

	it('the two inferred-conversion platforms never share a file — youtube has none at all', () => {
		expect(FOLLOWER_SNAPSHOT_PLATFORMS).toEqual(['instagram', 'tiktok']);
		expect(FOLLOWER_SNAPSHOT_PLATFORMS).not.toContain('youtube');
		const paths = FOLLOWER_SNAPSHOT_PLATFORMS.map((p) => followersFilePathFor('/m', p));
		expect(new Set(paths).size).toBe(paths.length);
	});

	it('a trailing slash on outDir never doubles up, for either platform', () => {
		expect(followersFilePathFor('/content/social/metrics/', 'tiktok')).toBe('/content/social/metrics/tiktok-followers.json');
	});
});

// ---------------------------------------------------------------------------
// F3 (Pb4e17-social-native-scheduling review round 4) — DEFAULT_METRICS_DIR
// moved into this file in this diff, and nothing asserted its actual
// resolved value: mutating `path.resolve(moduleDir, '..', '..', '..')` to
// `'..', '..'` left all 462 social tests green before this test existed.
// Anchored on structural markers (`.git`, `package.json`), never on the
// repo directory's own name — that would break for anyone who clones this
// repo under a different name.
// ---------------------------------------------------------------------------

describe('DEFAULT_METRICS_DIR — resolved path pinning', () => {
	it('resolves to the repo root\'s content/social/metrics directory', () => {
		expect(DEFAULT_METRICS_DIR.endsWith(path.join('content', 'social', 'metrics'))).toBe(true);

		const resolvedRoot = path.join(DEFAULT_METRICS_DIR, '..', '..', '..');
		expect(existsSync(path.join(resolvedRoot, '.git'))).toBe(true);
		expect(existsSync(path.join(resolvedRoot, 'package.json'))).toBe(true);
		// social/ has its OWN package.json (it's a self-contained npm
		// project — see this file's header) — `.git` is what actually
		// distinguishes the true repo root from social/ itself, since a
		// `path.resolve` one level short would land exactly there and still
		// find A package.json, just the wrong one.
		expect(existsSync(path.join(resolvedRoot, 'social', 'package.json'))).toBe(true);
	});
});
