/**
 * Tests for `../readout.ts` (Pf39c2-social-pilot-03 T14).
 *
 * THE PRE-REGISTERED CRITERION under test, quoted verbatim from
 * `plans/Pf39c2-social-pilot-index.md`'s "Success criterion (pre-registered
 * — do not renegotiate after posting)" section:
 *
 *   "A single 10x-median outlier is NOT sufficient; across ~168 posts one is
 *   expected from variance alone.
 *
 *   Viable requires at least one of:
 *   - A. Breakout with conversion — a post clearing ~10,000 views on any
 *     platform AND converting visibly to follows.
 *   - B. Accumulating standing — the account's median views trend upward
 *     from week 1 to week 4.
 *
 *   Neither met -> stop. An outlier with no conversion and no trend is
 *   explicitly a NO."
 *
 * This file's task-mandated acceptance criterion, verbatim: "over synthetic
 * data with an injected outlier, the readout correctly reports a breakout —
 * and correctly reports NO for an outlier with no conversion and no trend."
 * The two `describe('the acceptance criterion — ...')` blocks below are
 * exactly that pair of cases; everything else covers the smaller building
 * blocks (median/ratio math, null-vs-zero, insufficient-data honesty, top-5
 * ordering) this task's brief itemizes.
 *
 * `PILOT_WEEK_1_START` (`pilot-config.ts`) is `'2026-09-01'`, so throughout
 * this file: week 1 = 2026-09-01..07, week 2 = 09-08..14, week 3 =
 * 09-15..21, week 4 = 09-22..28.
 */

import { describe, expect, it } from 'vitest';

import {
	computeFollowConversion,
	computeReadout,
	computeVerdict,
	computeWeekTrend,
	maxToMedianRatio,
	median,
	medianViewsByWeek,
	parseBreakoutThreshold,
	type DailyFollowerSnapshot
} from '../readout.js';
import type { MetricsRow } from '../schema.js';

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
	return {
		platform: 'instagram',
		postId: 'post-1',
		format: 'wall',
		publishedAt: '2026-09-01T12:00:00.000Z',
		views: 100,
		averagePercentWatched: 50,
		likes: 10,
		comments: 2,
		shares: 1,
		saves: 3,
		follows: null,
		collectedAt: '2026-09-30T00:00:00.000Z',
		...overrides
	};
}

const NOW = '2026-09-30T00:00:00.000Z';

// ---------------------------------------------------------------------------
// The task's own acceptance criterion — the most important two tests here.
// ---------------------------------------------------------------------------

describe('the acceptance criterion — synthetic outlier with conversion reports a breakout', () => {
	it('reports VIABLE under criterion A for an outlier that clears the threshold and converts to follows', () => {
		// A week 1 baseline of ordinary posts (median well under 10,000), plus
		// one injected outlier clearing ~10,000 views on the day the follower
		// count visibly jumped.
		const baseline: MetricsRow[] = [100, 120, 90, 110, 95].map((views, i) =>
			row({ postId: `ig-baseline-${i}`, views, publishedAt: `2026-09-0${i + 1}T12:00:00.000Z` })
		);
		const outlier = row({ postId: 'ig-outlier', views: 15_000, publishedAt: '2026-09-06T12:00:00.000Z' });

		const followerSnapshots: DailyFollowerSnapshot[] = [
			{ date: '2026-09-05', followerCount: 500 },
			{ date: '2026-09-06', followerCount: 540 } // +40 the day the outlier published
		];

		const readout = computeReadout({
			rows: [...baseline, outlier],
			instagramFollowerSnapshots: followerSnapshots,
			now: NOW
		});

		expect(readout.verdict.viable).toBe(true);
		if (readout.verdict.viable) {
			expect(readout.verdict.criterion).toBe('A');
			expect(readout.verdict.evidence.platform).toBe('instagram');
			expect((readout.verdict.evidence as { postId: string }).postId).toBe('ig-outlier');
		}
		expect(readout.verdict.summary).toMatch(/VIABLE \(criterion A met\)/);

		const ig = readout.platforms.find((p) => p.platform === 'instagram')!;
		expect(ig.maxViews).toBe(15_000);
		expect(ig.followConversion.method).toBe('inferred');
		expect(ig.breakoutPosts).toHaveLength(1);
		expect(ig.breakoutPosts[0].follows).toBe(40);
	});
});

describe('the acceptance criterion — outlier with NO conversion and NO trend reports NO', () => {
	it('reports NOT VIABLE for an outlier that clears the threshold but never converts, with no week-1-to-week-4 trend evidence', () => {
		// Same shape of outlier as above, but no follower-snapshot data exists
		// at all (method must be 'unavailable', follows stays null — never a
		// fabricated 0 or a fabricated conversion), and all posts fall inside a
		// single week, so there is no week-4 data to show a trend either.
		const baseline: MetricsRow[] = [100, 120, 90, 110, 95].map((views, i) =>
			row({ platform: 'tiktok', postId: `tt-baseline-${i}`, views, publishedAt: `2026-09-0${i + 1}T12:00:00.000Z` })
		);
		const outlier = row({ platform: 'tiktok', postId: 'tt-outlier', views: 15_000, publishedAt: '2026-09-06T12:00:00.000Z' });

		const readout = computeReadout({
			rows: [...baseline, outlier],
			// No tiktokFollowerSnapshots supplied at all — deliberately, since no
			// TikTok follower-snapshot collector exists yet.
			now: NOW
		});

		expect(readout.verdict.viable).toBe(false);
		expect(readout.verdict.summary).toMatch(/NOT VIABLE/);
		expect(readout.verdict.summary).toMatch(/outlier with no conversion and no trend is explicitly a NO/);

		const tt = readout.platforms.find((p) => p.platform === 'tiktok')!;
		expect(tt.maxViews).toBe(15_000);
		expect(tt.followConversion.method).toBe('unavailable');
		expect(tt.breakoutPosts).toHaveLength(1);
		expect(tt.breakoutPosts[0].follows).toBeNull();
		expect(tt.weekTrend.status).toBe('insufficient-data');
	});

	it('does not let a big maximum alone flip the verdict even when the max/median ratio is very high', () => {
		// A near-10x-median-or-worse ratio on its own, with nothing else, must
		// not read as viable — "the maximum alone is not the signal."
		const rows: MetricsRow[] = [
			row({ postId: 'p1', views: 50 }),
			row({ postId: 'p2', views: 60 }),
			row({ postId: 'p3', views: 55 }),
			row({ postId: 'p4', views: 6_000 }) // high ratio, but well under the ~10,000 breakout threshold
		];
		const readout = computeReadout({ rows, now: NOW });
		expect(readout.verdict.viable).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// Criterion B — accumulating standing, with no outlier at all.
// ---------------------------------------------------------------------------

describe('criterion B — week-1-to-week-4 median trend', () => {
	it('reports VIABLE under criterion B when median views rise from week 1 to week 4, with no breakout post anywhere', () => {
		const week1: MetricsRow[] = [100, 90, 110].map((views, i) =>
			row({ postId: `w1-${i}`, views, publishedAt: `2026-09-0${i + 1}T12:00:00.000Z` })
		);
		const week4: MetricsRow[] = [300, 320, 280].map((views, i) =>
			row({ postId: `w4-${i}`, views, publishedAt: `2026-09-2${2 + i}T12:00:00.000Z` })
		);

		const readout = computeReadout({ rows: [...week1, ...week4], now: NOW });

		expect(readout.verdict.viable).toBe(true);
		if (readout.verdict.viable) {
			expect(readout.verdict.criterion).toBe('B');
		}
		expect(readout.verdict.summary).toMatch(/VIABLE \(criterion B met\)/);

		const ig = readout.platforms[0];
		expect(ig.weekTrend).toEqual({ status: 'up', week1Median: 100, week4Median: 300 });
	});

	it('reports insufficient-data, not a fabricated trend, with fewer than 4 weeks of posts', () => {
		const rows: MetricsRow[] = [
			row({ postId: 'w1-a', views: 100, publishedAt: '2026-09-01T12:00:00.000Z' }),
			row({ postId: 'w2-a', views: 400, publishedAt: '2026-09-08T12:00:00.000Z' })
		];
		const trend = computeWeekTrend(rows);
		expect(trend.status).toBe('insufficient-data');
		if (trend.status === 'insufficient-data') {
			expect(trend.weeksObserved.sort()).toEqual([1, 2]);
		}
	});

	it('medianViewsByWeek buckets by pilot week and computes each week’s median independently', () => {
		const rows: MetricsRow[] = [
			row({ postId: 'a', views: 10, publishedAt: '2026-09-01T00:00:00.000Z' }), // week 1
			row({ postId: 'b', views: 20, publishedAt: '2026-09-02T00:00:00.000Z' }), // week 1
			row({ postId: 'c', views: 1000, publishedAt: '2026-09-08T00:00:00.000Z' }) // week 2
		];
		expect(medianViewsByWeek(rows)).toEqual([
			{ week: 1, medianViews: 15, postCount: 2 },
			{ week: 2, medianViews: 1000, postCount: 1 }
		]);
	});
});

// ---------------------------------------------------------------------------
// M1 — a pre-pilot (or otherwise unbucketable) publishedAt must not crash the
// whole readout. `dateToWeekDay` throws for a date before `PILOT_WEEK_1_START`;
// the fix drops that row from the TREND only, never from median/max/top-5.
// ---------------------------------------------------------------------------

describe('week bucketing tolerates a pre-pilot publishedAt (M1)', () => {
	it('excludes a pre-pilot row from weekTrend but still counts it toward median/max/top posts', () => {
		const prePilot = row({ postId: 'pre-pilot', views: 5_000, publishedAt: '2026-08-20T12:00:00.000Z' });
		const week1: MetricsRow[] = [100, 90, 110].map((views, i) =>
			row({ postId: `w1-${i}`, views, publishedAt: `2026-09-0${i + 1}T12:00:00.000Z` })
		);
		const week4: MetricsRow[] = [300, 320, 280].map((views, i) =>
			row({ postId: `w4-${i}`, views, publishedAt: `2026-09-2${2 + i}T12:00:00.000Z` })
		);

		expect(() => computeReadout({ rows: [prePilot, ...week1, ...week4], now: NOW })).not.toThrow();

		const readout = computeReadout({ rows: [prePilot, ...week1, ...week4], now: NOW });
		expect(readout.verdict.viable).toBe(true);

		const ig = readout.platforms[0];
		// The pre-pilot row is dropped from the trend — week 1/4 medians are
		// exactly the non-pre-pilot rows' medians, unaffected by the outlier.
		expect(ig.weekTrend).toEqual({ status: 'up', week1Median: 100, week4Median: 300 });
		// But it still counts everywhere else: it is the highest-viewed post.
		expect(ig.maxViews).toBe(5_000);
		expect(ig.topPosts[0].postId).toBe('pre-pilot');
	});
});

// ---------------------------------------------------------------------------
// M9 — two single-post endpoint weeks must not read as a trend. The module
// header promises "insufficient-data" rather than a fabricated two-point
// trend; `MIN_TREND_SAMPLE_SIZE` is what actually enforces that.
// ---------------------------------------------------------------------------

describe('criterion B requires a minimum sample in both endpoint weeks, not just non-empty weeks (M9)', () => {
	it('reports insufficient-data for one week-1 post and one week-4 post with higher views, and the verdict is not viable on that alone', () => {
		const rows: MetricsRow[] = [
			row({ postId: 'w1-only', views: 100, publishedAt: '2026-09-01T12:00:00.000Z' }),
			row({ postId: 'w4-only', views: 500, publishedAt: '2026-09-22T12:00:00.000Z' })
		];

		const trend = computeWeekTrend(rows);
		expect(trend.status).toBe('insufficient-data');

		const readout = computeReadout({ rows, now: NOW });
		expect(readout.verdict.viable).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// The small pure statistics.
// ---------------------------------------------------------------------------

describe('median', () => {
	it('averages the two middle values for an even-length array', () => {
		expect(median([1, 2, 3, 4])).toBe(2.5);
	});

	it('returns the middle value for an odd-length array, regardless of input order', () => {
		expect(median([5, 1, 3])).toBe(3);
	});

	it('handles a single value', () => {
		expect(median([42])).toBe(42);
	});

	it('throws on an empty array rather than fabricating a value', () => {
		expect(() => median([])).toThrow();
	});
});

describe('maxToMedianRatio', () => {
	it('computes a straightforward ratio', () => {
		expect(maxToMedianRatio(1000, 100)).toBe(10);
	});

	it('returns null rather than Infinity/NaN when the median is 0', () => {
		expect(maxToMedianRatio(1000, 0)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// `follows: null` is never treated as a zero — the schema's own rule,
// carried through every follow-conversion computation.
// ---------------------------------------------------------------------------

describe('follow conversion — null is never a zero', () => {
	it('YouTube: passes a real per-post follows count through as EXACT', () => {
		const rows: MetricsRow[] = [row({ platform: 'youtube', postId: 'yt-1', views: 12_000, follows: 5 })];
		const fc = computeFollowConversion('youtube', rows);
		expect(fc.method).toBe('exact');
		expect(fc.posts[0].follows).toBe(5);
	});

	it('YouTube: a null follows (not yet collected) stays null, never coerced to 0', () => {
		const rows: MetricsRow[] = [row({ platform: 'youtube', postId: 'yt-2', views: 12_000, follows: null })];
		const fc = computeFollowConversion('youtube', rows);
		expect(fc.posts[0].follows).toBeNull();
	});

	it('a YouTube breakout post with follows: null does not satisfy criterion A', () => {
		const readout = computeReadout({
			rows: [
				row({ platform: 'youtube', postId: 'yt-1', views: 50, follows: null }),
				row({ platform: 'youtube', postId: 'yt-2', views: 60, follows: null }),
				row({ platform: 'youtube', postId: 'yt-breakout', views: 20_000, follows: null })
			],
			now: NOW
		});
		expect(readout.verdict.viable).toBe(false);
	});

	it('Instagram/TikTok: with no follower-snapshot series supplied, method is UNAVAILABLE and every post is null, not 0', () => {
		const rows: MetricsRow[] = [row({ platform: 'tiktok', postId: 'tt-1', views: 500 })];
		const fc = computeFollowConversion('tiktok', rows);
		expect(fc.method).toBe('unavailable');
		expect(fc.posts[0].follows).toBeNull();
	});

	it('Instagram: infers a delta only when both the publish-day and prior-day snapshots exist, else null', () => {
		const rows: MetricsRow[] = [row({ platform: 'instagram', postId: 'ig-1', publishedAt: '2026-09-10T12:00:00.000Z', views: 500 })];
		const snapshots: DailyFollowerSnapshot[] = [{ date: '2026-09-10', followerCount: 700 }]; // missing the prior day
		const fc = computeFollowConversion('instagram', rows, snapshots);
		expect(fc.method).toBe('inferred');
		expect(fc.posts[0].follows).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Top 5 posts, ordering and format labels.
// ---------------------------------------------------------------------------

describe('top posts', () => {
	it('lists at most the top 5 posts by views, richest first, each with its format', () => {
		const rows: MetricsRow[] = [10, 90, 30, 70, 50, 20, 60].map((views, i) => row({ postId: `p${i}`, views, format: 'wall' }));
		const readout = computeReadout({ rows, now: NOW });
		const ig = readout.platforms[0];
		expect(ig.topPosts).toHaveLength(5);
		expect(ig.topPosts.map((p) => p.views)).toEqual([90, 70, 60, 50, 30]);
		for (const post of ig.topPosts) {
			expect(post.format).toBe('wall');
		}
	});

	it('never fabricates a 6th entry when fewer than 5 posts exist', () => {
		const rows: MetricsRow[] = [10, 90].map((views, i) => row({ postId: `p${i}`, views }));
		const readout = computeReadout({ rows, now: NOW });
		expect(readout.platforms[0].topPosts).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// Small/empty datasets are handled honestly, not fabricated.
// ---------------------------------------------------------------------------

describe('empty datasets', () => {
	it('reports no platforms and a plain NOT VIABLE summary when there are no rows at all', () => {
		const readout = computeReadout({ rows: [], now: NOW });
		expect(readout.platforms).toEqual([]);
		expect(readout.verdict.viable).toBe(false);
	});
});

describe('computeVerdict is exercised through computeReadout, and directly', () => {
	it('is a pure function of the platform readouts it is given', () => {
		const readout = computeReadout({
			rows: [row({ platform: 'youtube', postId: 'yt-1', views: 100, follows: 0 })],
			now: NOW
		});
		const verdictAgain = computeVerdict(readout.platforms);
		expect(verdictAgain).toEqual(readout.verdict);
	});
});

// ---------------------------------------------------------------------------
// M8 — a non-numeric or negative --breakout-threshold must throw a clear
// error, not silently make criterion A unsatisfiable (`views >= NaN` is
// false for every row, which used to print a false "NOT VIABLE" with no
// error at all).
// ---------------------------------------------------------------------------

describe('parseBreakoutThreshold validates --breakout-threshold explicitly (M8)', () => {
	it('throws a clear error for a non-numeric value', () => {
		expect(() => parseBreakoutThreshold('ten-thousand')).toThrow(/breakout-threshold/);
	});

	it('throws a clear error for a negative value', () => {
		expect(() => parseBreakoutThreshold('-100')).toThrow(/breakout-threshold/);
	});

	it('throws a clear error for zero', () => {
		expect(() => parseBreakoutThreshold('0')).toThrow(/breakout-threshold/);
	});

	it('returns undefined when not supplied at all, so the default still applies', () => {
		expect(parseBreakoutThreshold(undefined)).toBeUndefined();
	});

	it('returns the parsed number for a valid positive value', () => {
		expect(parseBreakoutThreshold('5000')).toBe(5000);
	});
});
