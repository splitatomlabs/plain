/**
 * Tests for `../readout.ts` (Pf39c2-social-pilot-03 T14).
 *
 * THE PRE-REGISTERED CRITERION under test, quoted verbatim from
 * `plans/complete/Pf39c2-social-pilot-index.md`'s "Success criterion (pre-registered
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
 * Every pilot-week date below is derived from `PILOT_WEEK_1_START` via
 * `weekDayToDate` (the `at` helper), never written as a literal — so moving
 * the pilot's anchor date shifts these fixtures with it instead of silently
 * pushing them outside the pilot window.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	computeFollowConversion,
	computeReadout,
	computeVerdict,
	computeWeekTrend,
	maxToMedianRatio,
	median,
	medianViewsByWeek,
	formatReadout,
	parseBreakoutThreshold
} from '../readout.js';
import { metricsFilePathFor, serializeMetricsRows, type MetricsRow } from '../schema.js';
import { weekDayToDate } from '../../pilot-config.js';

/** A `publishedAt` for pilot week `week`, day `day` — anchored, never a literal date. */
function at(week: number, day: number, time = 'T12:00:00.000Z'): string {
	return `${weekDayToDate(week, day)}${time}`;
}

function row(overrides: Partial<MetricsRow> = {}): MetricsRow {
	return {
		platform: 'instagram',
		postId: 'post-1',
		format: 'wall',
		publishedAt: at(1, 1),
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
			row({ postId: `ig-baseline-${i}`, views, publishedAt: at(1, i + 1) })
		);
		// +40 follows, read off Business Suite for that post.
		const outlier = row({ postId: 'ig-outlier', views: 15_000, publishedAt: at(1, 6), follows: 40 });

		const readout = computeReadout({
			rows: [...baseline, outlier],
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
		expect(ig.followConversion.method).toBe('exact');
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
			row({ platform: 'tiktok', postId: `tt-baseline-${i}`, views, publishedAt: at(1, i + 1) })
		);
		const outlier = row({ platform: 'tiktok', postId: 'tt-outlier', views: 15_000, publishedAt: at(1, 6) });

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
			row({ postId: `w1-${i}`, views, publishedAt: at(1, i + 1) })
		);
		const week4: MetricsRow[] = [300, 320, 280].map((views, i) =>
			row({ postId: `w4-${i}`, views, publishedAt: at(4, i + 1) })
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
			row({ postId: 'w1-a', views: 100, publishedAt: at(1, 1) }),
			row({ postId: 'w2-a', views: 400, publishedAt: at(2, 1) })
		];
		const trend = computeWeekTrend(rows);
		expect(trend.status).toBe('insufficient-data');
		if (trend.status === 'insufficient-data') {
			expect(trend.weeksObserved.sort()).toEqual([1, 2]);
		}
	});

	it('medianViewsByWeek buckets by pilot week and computes each week’s median independently', () => {
		const rows: MetricsRow[] = [
			row({ postId: 'a', views: 10, publishedAt: at(1, 1, 'T00:00:00.000Z') }), // week 1
			row({ postId: 'b', views: 20, publishedAt: at(1, 2, 'T00:00:00.000Z') }), // week 1
			row({ postId: 'c', views: 1000, publishedAt: at(2, 1, 'T00:00:00.000Z') }) // week 2
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
			row({ postId: `w1-${i}`, views, publishedAt: at(1, i + 1) })
		);
		const week4: MetricsRow[] = [300, 320, 280].map((views, i) =>
			row({ postId: `w4-${i}`, views, publishedAt: at(4, i + 1) })
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
			row({ postId: 'w1-only', views: 100, publishedAt: at(1, 1) }),
			row({ postId: 'w4-only', views: 500, publishedAt: at(4, 1) })
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

	it.each(['instagram', 'tiktok'] as const)('%s: an unread follows is UNAVAILABLE and stays null, never 0', (platform) => {
		const rows: MetricsRow[] = [row({ platform, postId: `${platform}-1`, views: 500, follows: null })];
		const fc = computeFollowConversion(platform, rows);
		expect(fc.method).toBe('unavailable');
		expect(fc.posts[0].follows).toBeNull();
	});

	// UPDATED 2026-09-21: the tests this replaces drove conversion off a
	// daily account-level follower series, inferring each post's follows
	// from a day-over-day delta. All three platforms turned out to report
	// follows per post, so that series and its inference were deleted; what
	// those tests protected — that a breakout only counts when it actually
	// converted, and that one platform's data is never borrowed for another
	// — is asserted here against the per-post figures instead.
	it.each(['instagram', 'tiktok', 'youtube'] as const)('%s: a breakout only satisfies criterion A once it converts', (platform) => {
		const base: MetricsRow[] = [
			row({ platform, postId: `${platform}-1`, publishedAt: at(1, 1), views: 400, follows: 0 }),
			row({ platform, postId: `${platform}-2`, publishedAt: at(1, 2), views: 500, follows: 0 })
		];

		const unconverted = [...base, row({ platform, postId: 'breakout', publishedAt: at(2, 3), views: 20_000, follows: 0 })];
		expect(computeReadout({ rows: unconverted, now: NOW }).verdict.viable).toBe(false);

		const converted = [...base, row({ platform, postId: 'breakout', publishedAt: at(2, 3), views: 20_000, follows: 800 })];
		expect(computeReadout({ rows: converted, now: NOW }).verdict.viable).toBe(true);
	});

	it('one platform\'s follows never count toward another\'s conversion', () => {
		const rows: MetricsRow[] = [
			row({ platform: 'tiktok', postId: 'tt-1', publishedAt: at(2, 3), views: 500, follows: 42 }),
			row({ platform: 'instagram', postId: 'ig-1', publishedAt: at(2, 3), views: 500, follows: null })
		];
		const readout = computeReadout({ rows, now: NOW });
		expect(readout.platforms.find((p) => p.platform === 'instagram')?.followConversion.method).toBe('unavailable');
		expect(readout.platforms.find((p) => p.platform === 'tiktok')?.followConversion.method).toBe('exact');
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

// ---------------------------------------------------------------------------
// F4 (Pb4e17-social-native-scheduling review round 4) / round 5 — a real
// subprocess run, mirroring `hand-entry.test.ts`'s/`follower-snapshot.test.ts`'s
// own CLI subprocess convention.
//
// Round 4's `toDir` closed the empty-STRING half of "a bad --metrics-dir
// silently reports a verdict over zero rows": `--metrics-dir=` now throws
// before any directory is ever read. But a directory that IS a syntactically
// fine, non-empty path — a typo, or one that simply does not exist yet, or
// one that exists but is empty — reached `readLatestMetricsRows`, got `[]`
// back, and this CLI printed a confident "NOT VIABLE" verdict over zero data
// with exit code 0 regardless. Round 5 closes that wider case in `main()`
// itself (see its own comment): zero rows, from ANY cause, is reported as
// "INSUFFICIENT DATA" and exits non-zero, never "NOT VIABLE" with exit 0.
// ---------------------------------------------------------------------------

describe('CLI — main()', () => {
	const moduleDir = path.dirname(fileURLToPath(import.meta.url));
	const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
	const cliPath = path.join(repoRoot, 'social', 'src', 'metrics', 'readout.ts');

	let metricsDir: string;

	beforeEach(async () => {
		metricsDir = await mkdtemp(path.join(tmpdir(), 'plain-readout-'));
	});

	afterEach(async () => {
		await rm(metricsDir, { recursive: true, force: true });
	});

	function runCli(args: string[]): { status: number; stdout: string; stderr: string } {
		try {
			const stdout = execFileSync('npx', ['tsx', cliPath, ...args], {
				cwd: repoRoot,
				encoding: 'utf-8',
				stdio: ['ignore', 'pipe', 'pipe']
			});
			return { status: 0, stdout, stderr: '' };
		} catch (e) {
			const err = e as { status: number | null; stdout: string; stderr: string };
			return { status: err.status ?? 1, stdout: err.stdout ?? '', stderr: err.stderr ?? '' };
		}
	}

	it('round 5 — an empty-but-existing --metrics-dir never reports a verdict over zero rows: exits non-zero, names the directory, and never prints NOT VIABLE', () => {
		const result = runCli(['--metrics-dir', metricsDir, '--now', '2026-09-09T00:00:00.000Z']);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/INSUFFICIENT DATA/);
		expect(result.stderr).toContain(metricsDir);
		expect(result.stdout).not.toMatch(/NOT VIABLE/);
		expect(result.stderr).not.toMatch(/NOT VIABLE/);
	});

	it('round 5 — a --metrics-dir that does not exist at all behaves identically: never prints NOT VIABLE, names the directory, exits non-zero', () => {
		const nonexistentDir = path.join(metricsDir, 'does-not-exist');
		const result = runCli(['--metrics-dir', nonexistentDir, '--now', '2026-09-09T00:00:00.000Z']);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/INSUFFICIENT DATA/);
		expect(result.stderr).toContain(nonexistentDir);
		expect(result.stdout).not.toMatch(/NOT VIABLE/);
		expect(result.stderr).not.toMatch(/NOT VIABLE/);
	});

	it('round 5 — a real negative result (rows exist, neither criterion met) still prints NOT VIABLE and exits 0, unchanged', async () => {
		const rows: MetricsRow[] = [
			row({ platform: 'tiktok', postId: 'tt-1', views: 100 }),
			row({ platform: 'tiktok', postId: 'tt-2', views: 120 }),
			row({ platform: 'tiktok', postId: 'tt-3', views: 90 })
		];
		await writeFile(metricsFilePathFor(metricsDir, '2026-09-09'), serializeMetricsRows(rows), 'utf-8');

		const result = runCli(['--metrics-dir', metricsDir, '--now', '2026-09-09T00:00:00.000Z']);
		expect(result.status).toBe(0);
		expect(result.stdout).toMatch(/NOT VIABLE — neither criterion met\./);
		expect(result.stdout).not.toMatch(/INSUFFICIENT DATA/);
	});

	it('F4 — an empty-STRING --metrics-dir (--metrics-dir=) exits non-zero, names the flag, and never silently reports a verdict over zero rows', () => {
		const result = runCli(['--metrics-dir', '', '--now', '2026-09-09T00:00:00.000Z']);

		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/--metrics-dir/);
		expect(result.stdout).not.toMatch(/VIABLE/);
	});
});

// ---------------------------------------------------------------------------
// Card resolution (card-index.ts) surfacing in the readout.
//
// The pre-registered criterion's payoff is "rebuild around whatever premise
// did it", so the two outputs a human actually reads — the top-posts list
// and the criterion-A verdict sentence — have to name the CARD. A bare
// platform id answers the wrong question at exactly the moment the pilot's
// conclusion depends on it.
// ---------------------------------------------------------------------------

describe('card resolution in the readout', () => {
	const cardIdByDate = new Map([
		[weekDayToDate(1, 1), 'meditations-09-025'],
		[weekDayToDate(4, 1), 'happy-life-03-004']
	]);

	it('attaches the card id to top posts, resolved from the publish date', () => {
		const readout = computeReadout({
			rows: [row({ postId: 'ler2U2CFzHs', publishedAt: at(1, 1) })],
			now: NOW,
			cardIdByDate
		});
		expect(readout.platforms[0].topPosts[0].cardId).toBe('meditations-09-025');
	});

	it('leaves cardId null when no schedule covers the date, never guessing', () => {
		const readout = computeReadout({
			rows: [row({ publishedAt: at(2, 1) })],
			now: NOW,
			cardIdByDate
		});
		expect(readout.platforms[0].topPosts[0].cardId).toBeNull();
	});

	it('omitting cardIdByDate entirely leaves every cardId null — the pre-resolution behaviour', () => {
		const readout = computeReadout({ rows: [row()], now: NOW });
		expect(readout.platforms[0].topPosts[0].cardId).toBeNull();
		expect(readout.platforms[0].followConversion.posts[0].cardId).toBeNull();
	});

	it('names the card, and keeps the platform id, in the top-posts list', () => {
		const readout = computeReadout({
			rows: [row({ postId: 'ler2U2CFzHs', publishedAt: at(1, 1) })],
			now: NOW,
			cardIdByDate
		});
		expect(formatReadout(readout)).toContain('meditations-09-025 [ler2U2CFzHs]');
	});

	it('falls back to the platform id alone when the card is unknown', () => {
		const readout = computeReadout({ rows: [row({ postId: 'ABC123', publishedAt: at(2, 1) })], now: NOW, cardIdByDate });
		const text = formatReadout(readout);
		expect(text).toContain('ABC123');
		expect(text).not.toContain('[ABC123]');
	});

	// THE SENTENCE THE WHOLE PILOT PRODUCES.
	it('names the card in the criterion-A verdict', () => {
		const readout = computeReadout({
			rows: [
				row({ platform: 'youtube', postId: 'ler2U2CFzHs', publishedAt: at(1, 1), views: 40_000, follows: 25 })
			],
			now: NOW,
			cardIdByDate
		});
		const verdict = readout.verdict;
		expect(verdict.viable).toBe(true);
		if (!verdict.viable) throw new Error('expected a viable verdict');
		expect(verdict.criterion).toBe('A');
		expect(verdict.summary).toContain('meditations-09-025 [ler2U2CFzHs]');
	});

	// The structured evidence keeps the platform id as its own field, so a
	// consumer is never forced to parse the prose.
	it('keeps the raw platform id in the verdict evidence', () => {
		const readout = computeReadout({
			rows: [row({ platform: 'youtube', postId: 'ler2U2CFzHs', publishedAt: at(1, 1), views: 40_000, follows: 25 })],
			now: NOW,
			cardIdByDate
		});
		const verdict = readout.verdict;
		if (!verdict.viable) throw new Error('expected a viable verdict');
		expect(verdict.evidence).toMatchObject({ postId: 'ler2U2CFzHs' });
	});
});

// ---------------------------------------------------------------------------
// Per-post follow attribution, on every platform.
//
// `follows` began as YouTube-only, on the belief that Instagram and TikTok
// reported follower counts at the account level only. That was wrong about
// both, and until it was corrected the tooling REJECTED the real per-post
// number as a fabrication while routing conversion through a daily
// account-level delta instead. All three platforms report it per post; the
// delta series and its inference are gone.
// ---------------------------------------------------------------------------

describe('per-post follow attribution', () => {
	it.each(['instagram', 'tiktok', 'youtube'] as const)('trusts a real per-post follows on %s', (platform) => {
		const rows: MetricsRow[] = [row({ platform, postId: 'p-1', publishedAt: at(2, 3), views: 500, follows: 9 })];
		const fc = computeFollowConversion(platform, rows);
		expect(fc.method).toBe('exact');
		expect(fc.posts[0].follows).toBe(9);
	});

	it('reports EXACT for the platform once any post carries a figure, counting how many were recorded', () => {
		const rows: MetricsRow[] = [
			row({ platform: 'instagram', postId: 'ig-read', publishedAt: at(2, 3), views: 500, follows: 9 }),
			row({ platform: 'instagram', postId: 'ig-unread', publishedAt: at(2, 5), views: 400, follows: null })
		];
		const readout = computeReadout({ rows, now: NOW });
		expect(readout.platforms[0].followConversion.method).toBe('exact');
		expect(formatReadout(readout)).toContain('1/2 post(s) recorded');
	});

	it('an Instagram breakout with a real per-post follows satisfies criterion A as exact evidence', () => {
		const readout = computeReadout({
			rows: [
				row({ platform: 'instagram', postId: 'ig-1', publishedAt: at(1, 1), views: 400, follows: 0 }),
				row({ platform: 'instagram', postId: 'ig-breakout', publishedAt: at(1, 2), views: 20_000, follows: 310 })
			],
			now: NOW
		});
		const verdict = readout.verdict;
		expect(verdict.viable).toBe(true);
		if (!verdict.viable) throw new Error('expected a viable verdict');
		expect(verdict.criterion).toBe('A');
		expect(verdict.summary).toContain('exact per-post attribution');
		expect(verdict.evidence).toMatchObject({ platform: 'instagram', follows: 310 });
	});

	// A read zero is data — "this post converted nobody" — and must not
	// satisfy criterion A, which requires visible conversion. It is still
	// distinct from null, which means the figure was never read.
	it('a real follows of 0 is recorded but does not satisfy criterion A', () => {
		const readout = computeReadout({
			rows: [row({ platform: 'instagram', postId: 'ig-breakout', publishedAt: at(1, 2), views: 20_000, follows: 0 })],
			now: NOW
		});
		expect(readout.verdict.viable).toBe(false);
		expect(readout.platforms[0].followConversion.posts[0].follows).toBe(0);
		expect(readout.platforms[0].followConversion.method).toBe('exact');
	});
});
