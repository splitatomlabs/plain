/**
 * The viability readout (Pf39c2-social-pilot-03 T14).
 *
 * Task wording, verbatim: "Implement the viability readout — per platform,
 * the median, the maximum, the max/median ratio, the week-1-vs-week-4
 * median trend, follow conversion (exact on YouTube, inferred from daily
 * deltas on Instagram and TikTok — label which is which), and the top 5
 * [the inferred half of that wording is obsolete: all three platforms report
 * follows per post, so conversion is exact or absent — see this file's
 * FOLLOW CONVERSION note below]
 * posts with their format. State plainly whether the pre-registered
 * criterion was met."
 *
 * THE PRE-REGISTERED CRITERION this module implements, quoted verbatim from
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
 *   Either met -> social is viable; rebuild around whatever premise did it.
 *   Neither met -> stop. An outlier with no conversion and no trend is
 *   explicitly a NO.
 *
 *   Track maximum AND median AND follow-conversion. The maximum alone is
 *   not the signal."
 *
 * PURE COMPUTATION, SEPARATE FROM IO/FORMATTING: every statistic below is a
 * plain function of its inputs — no `Date.now()`, no filesystem, no
 * network. `computeReadout` is the one entry point a test calls directly;
 * `formatReadout` turns its result into the human-readable report; this
 * file's own `main()` (bottom) is the thin CLI that reads the dated files
 * `hand-entry.ts` already writes and prints the report.
 * Mirrors this workspace's `cli-plan.ts`/`cli.ts` and
 * `prepare-week-plan.ts`/`prepare-week.ts` pure-plan-vs-IO split.
 *
 * FOLLOW CONVERSION IS EXACT, OR IT IS NOTHING — this file's label
 * discipline. Every platform reports a follow count per post on its own
 * analytics screen (YouTube Studio's subscribersGained, Meta Business
 * Suite's per-Reel Follows, TikTok's per-video Follows), hand-entered into
 * `MetricsRow.follows`. A platform whose posts carry such a figure reports
 * `'exact'`; one whose posts carry none reports `'unavailable'` — a real gap
 * in the recording, never a fabricated `0` and never a method named over
 * absent data.
 *
 * HISTORY (2026-09-21): this file used to carry a second, weaker path. The
 * plan's Decision held that "per-post follow attribution exists ONLY on
 * YouTube ... Instagram reports follower counts at the ACCOUNT level only,
 * so criterion A's conversion half must be inferred from daily follower
 * deltas aligned to post times", and TikTok was grouped with Instagram on
 * the same reasoning. Both premises were false: each platform does report
 * per-post follows. The inference (`inferFollowsForPost`, a daily
 * `<platform>-followers.json` series written by `follower-snapshot.ts`) and
 * its `'inferred'`/`'mixed'` labels were deleted once that was established,
 * rather than left as a dormant fallback — `git log` has them if the premise
 * ever needs revisiting. The daily series cost an un-backfillable manual
 * reading every day and, in practice, was missed for the whole of week 1.
 *
 * `follows: null` IS NEVER A ZERO — `schema.ts`'s own header states the
 * rule this file must not violate: "some fields are genuinely unavailable
 * on a given platform, not zero ... `null` means 'not available,' strictly
 * distinct from the number `0`." Every follow-conversion computation below
 * threads `number | null` through unchanged; a `null` is excluded from
 * "did this post convert" checks, never coerced to `0` first.
 *
 * WEEK BUCKETING reuses `pilot-config.ts`'s `dateToWeekDay` — the SAME
 * (week, day) anchor (`PILOT_WEEK_1_START`) the render CLI uses, so "week 1"
 * and "week 4" here mean exactly the same calendar weeks the schedule and
 * render pipeline already use, not a second, independently-invented
 * week-numbering scheme. `dateToWeekDay` THROWS for any date before
 * `PILOT_WEEK_1_START` (and for a malformed date string) — the Instagram
 * collector discovers posts from the account's own media list, so a
 * pre-pilot post (or a typo'd TikTok hand-entry date) can legitimately show
 * up in `rows`. `medianViewsByWeek` catches that per row and DROPS the row
 * from the trend bucketing rather than letting it crash the whole readout;
 * that row still counts everywhere else — median/max/max-to-median-ratio/
 * top-5/breakout-posts are all computed in `computePlatformReadout` directly
 * from `rows`, never through week bucketing, so dropping a row from the
 * trend does not drop it from anything else this module reports.
 *
 * HONEST ABOUT SMALL DATASETS: with fewer than 4 pilot weeks of published
 * posts, OR fewer than `MIN_TREND_SAMPLE_SIZE` posts in either week 1 or
 * week 4, the week-1-vs-week-4 trend is reported as `'insufficient-data'`
 * rather than computed from whatever points happen to exist — a two-point
 * "trend" (one post per endpoint week) this early would be noise dressed up
 * as a finding.
 */

import { readdir, readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

import { buildCardIndex, cardIdForPublishedAt } from './card-index.js';
import { dateToWeekDay } from '../pilot-config.js';
import { toDir } from './hand-entry.js';
import { DEFAULT_METRICS_DIR, DEFAULT_SCHEDULE_DIR, metricsRowKey, parseMetricsRows, type MetricsFormat, type MetricsPlatform, type MetricsRow } from './schema.js';

// ---------------------------------------------------------------------------
// Small pure statistics — each one independently unit-testable.
// ---------------------------------------------------------------------------

/**
 * The median of a non-empty array. Throws on an empty array deliberately —
 * every caller in this file already branches on `values.length === 0` and
 * reports "no data" honestly rather than asking this function to invent a
 * median from nothing.
 */
export function median(values: number[]): number {
	if (values.length === 0) {
		throw new Error('median() called with an empty array — callers must handle the empty case themselves.');
	}
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** `max / med`, or `null` when `med` is `0` — a ratio against a zero median is undefined, not infinite, and must not be reported as a number. */
export function maxToMedianRatio(max: number, med: number): number | null {
	return med === 0 ? null : max / med;
}

// ---------------------------------------------------------------------------
// Week-1-vs-week-4 median trend — reuses `pilot-config.ts`'s own
// (week, day) anchor rather than inventing a second week-numbering scheme.
// ---------------------------------------------------------------------------

export interface WeekMedian {
	/** 1-based, from `pilot-config.ts`'s `dateToWeekDay`. */
	week: number;
	medianViews: number;
	postCount: number;
}

/**
 * Groups `rows` by the pilot week their `publishedAt` date falls in, then
 * takes each week's median views. Sorted ascending by week.
 *
 * DEFENSIVE BUCKETING (M1): `dateToWeekDay` throws for a date before
 * `PILOT_WEEK_1_START` or a malformed date string — a real possibility here,
 * since the Instagram collector discovers posts from the account's own media
 * list (a pre-pilot post can be in `rows`) and TikTok's metrics are hand-
 * entered (a typo'd date can be too). A row that cannot be bucketed is
 * dropped from the TREND ONLY, not from the dataset as a whole — this
 * function's caller, `computeWeekTrend`, only ever affects `weekTrend`; every
 * other statistic (`median`, `maxViews`, `maxToMedianRatio`, `topPosts`,
 * `breakoutPosts`) is computed directly from the un-bucketed `rows` in
 * `computePlatformReadout` and never calls this function, so those figures
 * still include the dropped row.
 */
export function medianViewsByWeek(rows: Pick<MetricsRow, 'publishedAt' | 'views'>[]): WeekMedian[] {
	const byWeek = new Map<number, number[]>();
	for (const row of rows) {
		let week: number;
		try {
			({ week } = dateToWeekDay(row.publishedAt.slice(0, 10)));
		} catch {
			// Pre-pilot or otherwise unbucketable publishedAt — drop from the
			// trend only. See this function's doc comment above.
			continue;
		}
		const views = byWeek.get(week) ?? [];
		views.push(row.views);
		byWeek.set(week, views);
	}
	return [...byWeek.entries()]
		.map(([week, views]) => ({ week, medianViews: median(views), postCount: views.length }))
		.sort((a, b) => a.week - b.week);
}

export type WeekTrend =
	| { status: 'insufficient-data'; weeksObserved: number[] }
	| { status: 'up' | 'down' | 'flat'; week1Median: number; week4Median: number };

/**
 * The minimum post count required in EACH of week 1 and week 4 before this
 * file will report an "up"/"down"/"flat" trend at all (M9). A single post
 * per endpoint week is not a median trend — it is one data point compared to
 * another, and this file's own header already promises fewer-than-4-weeks
 * datasets are reported as `'insufficient-data'` rather than a fabricated
 * two-point "trend"; two single-post weeks are exactly that fabrication with
 * a full 4 weeks elapsed. Three is the smallest sample where "median" means
 * something more than "the value I happened to get" — the reviewer's
 * suggested minimum for the pilot's central go/no-go decision.
 */
const MIN_TREND_SAMPLE_SIZE = 3;

/**
 * The pre-registered criterion's "B. Accumulating standing" half, verbatim:
 * "the account's median views trend upward from week 1 to week 4." Requires
 * BOTH week 1 and week 4 to have at least `MIN_TREND_SAMPLE_SIZE` published
 * posts each; anything less is `'insufficient-data'`, never a fabricated
 * two-point trend.
 */
export function computeWeekTrend(rows: Pick<MetricsRow, 'publishedAt' | 'views'>[]): WeekTrend {
	const byWeek = medianViewsByWeek(rows);
	const week1 = byWeek.find((w) => w.week === 1);
	const week4 = byWeek.find((w) => w.week === 4);
	if (!week1 || !week4 || week1.postCount < MIN_TREND_SAMPLE_SIZE || week4.postCount < MIN_TREND_SAMPLE_SIZE) {
		return { status: 'insufficient-data', weeksObserved: byWeek.map((w) => w.week) };
	}
	if (week4.medianViews > week1.medianViews) return { status: 'up', week1Median: week1.medianViews, week4Median: week4.medianViews };
	if (week4.medianViews < week1.medianViews) return { status: 'down', week1Median: week1.medianViews, week4Median: week4.medianViews };
	return { status: 'flat', week1Median: week1.medianViews, week4Median: week4.medianViews };
}

// ---------------------------------------------------------------------------
// Follow conversion — EXACT from the platform's own per-post attribution
// wherever a figure was read, and UNAVAILABLE where none was. There is no
// third state: see this file's header for the daily-delta inference that
// used to sit here and why it was deleted rather than kept as a fallback.
// ---------------------------------------------------------------------------

export type FollowConversionMethod = 'exact' | 'unavailable';

export interface PostFollowConversion {
	postId: string;
	/** The card this post was built from, resolved from its publish date (`card-index.ts`). `null` when no schedule covers that date. */
	cardId: string | null;
	views: number;
	/** `null` = the platform's per-post figure was not read for this post. NEVER treated as `0` — see this file's header. */
	follows: number | null;
}

export interface PlatformFollowConversion {
	method: FollowConversionMethod;
	posts: PostFollowConversion[];
}

/**
 * Builds one platform's `PlatformFollowConversion`. Every platform reports a
 * per-post follow count on its own analytics screen, so a row's `follows` is
 * passed straight through as `'exact'` wherever one was read, and a row
 * without one simply has no number (`null`, NEVER a zero — see `schema.ts`'s
 * available-vs-zero rule).
 *
 * There is no inference path any more. A daily account-level follower series
 * (`follower-snapshot.ts`, `<platform>-followers.json`) used to stand in for
 * Instagram's and TikTok's conversion, on the belief that neither platform
 * attributed a follow to a post. Both do; the series was deleted once that
 * was established, along with the delta arithmetic that consumed it. `git
 * log` has it if the premise ever needs revisiting.
 */
export function computeFollowConversion(
	platform: MetricsPlatform,
	rows: Pick<MetricsRow, 'postId' | 'views' | 'publishedAt' | 'follows'>[],
	cardIdByDate?: ReadonlyMap<string, string>
): PlatformFollowConversion {
	const posts: PostFollowConversion[] = rows.map((r) => ({
		postId: r.postId,
		cardId: cardIdForPublishedAt(r.publishedAt, cardIdByDate),
		views: r.views,
		follows: r.follows
	}));

	return { method: aggregateFollowMethod(posts), posts };
}

/**
 * The platform-level label, derived from what its posts ACTUALLY carry
 * rather than from the platform's name.
 *
 * Computed rather than hardcoded because a platform's label now depends on
 * whether anyone read the figures, not on which platform it is: all three
 * report follows per post, so a platform is `'exact'` once any of its posts
 * carries one, and `'unavailable'` while none do. That second case is a real
 * gap in the recording, never a property of the platform — and it is
 * reported as `'unavailable'` rather than as the method that WOULD apply,
 * because naming a method while holding no data implies conversion evidence
 * that does not exist.
 */
function aggregateFollowMethod(posts: PostFollowConversion[]): FollowConversionMethod {
	return posts.some((p) => p.follows !== null) ? 'exact' : 'unavailable';
}

// ---------------------------------------------------------------------------
// Per-platform readout + top posts.
// ---------------------------------------------------------------------------

export interface TopPost {
	postId: string;
	/** The card this post was built from, resolved from its publish date (`card-index.ts`). `null` when no schedule covers that date. */
	cardId: string | null;
	views: number;
	format: MetricsFormat;
}

export interface PlatformReadout {
	platform: MetricsPlatform;
	postCount: number;
	/** `null` when this platform has zero rows — never a fabricated `0`. */
	medianViews: number | null;
	maxViews: number | null;
	maxToMedianRatio: number | null;
	weekTrend: WeekTrend;
	followConversion: PlatformFollowConversion;
	/** Rows clearing `breakoutViewThreshold`, richest-first — the candidate pool for criterion A. */
	breakoutPosts: PostFollowConversion[];
	/** Top 5 posts by views, richest-first. */
	topPosts: TopPost[];
}

function computePlatformReadout(
	platform: MetricsPlatform,
	rows: MetricsRow[],
	breakoutViewThreshold: number,
	cardIdByDate?: ReadonlyMap<string, string>
): PlatformReadout {
	const views = rows.map((r) => r.views);
	const medianViews = views.length > 0 ? median(views) : null;
	const maxViews = views.length > 0 ? Math.max(...views) : null;
	const ratio = medianViews !== null && maxViews !== null ? maxToMedianRatio(maxViews, medianViews) : null;
	const followConversion = computeFollowConversion(platform, rows, cardIdByDate);
	const conversionByPostId = new Map(followConversion.posts.map((p) => [p.postId, p]));

	const sortedByViewsDesc = [...rows].sort((a, b) => b.views - a.views);

	return {
		platform,
		postCount: rows.length,
		medianViews,
		maxViews,
		maxToMedianRatio: ratio,
		weekTrend: computeWeekTrend(rows),
		followConversion,
		breakoutPosts: sortedByViewsDesc
			.filter((r) => r.views >= breakoutViewThreshold)
			.map((r) => ({
				postId: r.postId,
				cardId: cardIdForPublishedAt(r.publishedAt, cardIdByDate),
				views: r.views,
				follows: conversionByPostId.get(r.postId)?.follows ?? null
			})),
		topPosts: sortedByViewsDesc.slice(0, 5).map((r) => ({
			postId: r.postId,
			cardId: cardIdForPublishedAt(r.publishedAt, cardIdByDate),
			views: r.views,
			format: r.format
		}))
	};
}

// ---------------------------------------------------------------------------
// The verdict — the whole point of this module. See this file's header for
// the exact pre-registered wording this implements.
// ---------------------------------------------------------------------------

export interface ViabilityEvidenceA {
	criterion: 'A';
	platform: MetricsPlatform;
	postId: string;
	views: number;
	follows: number;
}

export interface ViabilityEvidenceB {
	criterion: 'B';
	platform: MetricsPlatform;
	week1Median: number;
	week4Median: number;
}

export type ViabilityVerdict =
	| { viable: true; criterion: 'A'; summary: string; evidence: ViabilityEvidenceA }
	| { viable: true; criterion: 'B'; summary: string; evidence: ViabilityEvidenceB }
	| { viable: false; summary: string };

/**
 * How a post is NAMED wherever a human reads it — the criterion-A verdict
 * sentence and the top-posts list.
 *
 * Leads with the card id, because the pre-registered criterion's payoff is
 * "rebuild around whatever premise did it": a bare platform id answers the
 * wrong question at the exact moment the pilot's conclusion depends on it.
 * Keeps the platform id in brackets rather than replacing it, because it is
 * the only pointer back to the real post for re-reading its analytics.
 * Falls back to the platform id alone when no schedule covers the date (a
 * pre-pilot row, or a checkout with no schedules) — never to a fabricated
 * or guessed card.
 */
function describePost(post: { postId: string; cardId: string | null }): string {
	return post.cardId === null ? post.postId : `${post.cardId} [${post.postId}]`;
}

/**
 * The pre-registered criterion, applied. Checks A first (a breakout post
 * with visible follow conversion), then B (an upward
 * week-1-to-week-4 median trend on any platform). Neither met is reported
 * as `viable: false` with a plain, unhedged summary — "an outlier with no
 * conversion and no trend is explicitly a NO," per the plan.
 */
export function computeVerdict(platforms: PlatformReadout[]): ViabilityVerdict {
	for (const p of platforms) {
		for (const post of p.breakoutPosts) {
			if (post.follows !== null && post.follows > 0) {
				return {
					viable: true,
					criterion: 'A',
					summary:
						`VIABLE (criterion A met) — ${p.platform} post ${describePost(post)} cleared the breakout threshold ` +
						`with ${post.views} views and converted to ${post.follows} follow(s) ` +
						'(exact per-post attribution, read off the platform).',
					evidence: {
						criterion: 'A',
						platform: p.platform,
						postId: post.postId,
						views: post.views,
						follows: post.follows
					}
				};
			}
		}
	}

	for (const p of platforms) {
		if (p.weekTrend.status === 'up') {
			return {
				viable: true,
				criterion: 'B',
				summary:
					`VIABLE (criterion B met) — ${p.platform}'s median views rose from ${p.weekTrend.week1Median} ` +
					`(week 1) to ${p.weekTrend.week4Median} (week 4).`,
				evidence: { criterion: 'B', platform: p.platform, week1Median: p.weekTrend.week1Median, week4Median: p.weekTrend.week4Median }
			};
		}
	}

	const maxAcrossPlatforms = platforms
		.map((p) => p.maxViews)
		.filter((v): v is number => v !== null)
		.reduce((max, v) => Math.max(max, v), 0);
	const anyOutlier = platforms.some((p) => p.maxToMedianRatio !== null && p.maxToMedianRatio >= 10);

	return {
		viable: false,
		summary:
			`NOT VIABLE — neither criterion met. ${anyOutlier ? `A >=10x-median outlier exists (max ${maxAcrossPlatforms} views) but it did not convert to follows, and` : 'No breakout post cleared the threshold with visible follow conversion, and'} ` +
			'no platform shows an upward week-1-to-week-4 median trend. Per the pre-registered criterion, an outlier with no conversion and no trend is explicitly a NO.'
	};
}

// ---------------------------------------------------------------------------
// The top-level entry point a test (or the CLI) calls.
// ---------------------------------------------------------------------------

export interface ComputeReadoutOptions {
	/** One row per post — the LATEST known snapshot for each still-tracked post, not every historical day's row. Callers aggregating multiple dated files must dedupe to the latest `collectedAt` per `platform:postId` before calling this. */
	rows: MetricsRow[];
	/** ISO 8601 — the evaluation instant. Not used in any computation below (all of it is derived from `rows`' own `publishedAt`/`views`), but threaded through and stamped onto the result so the readout is reproducible against a fixed moment rather than implicitly "now." */
	now: string;
	/** Defaults to ~10,000, per the pre-registered criterion's "clearing ~10,000 views on any platform." */
	breakoutViewThreshold?: number;
	/**
	 * `date -> card_id`, from `card-index.ts`'s `buildCardIndex`. Optional:
	 * omit it and every `cardId` below is `null` and the readout names
	 * platform ids alone, exactly as it did before card resolution existed.
	 * Passing a plain map keeps this function pure — the schedule files are
	 * read by the CLI, never here.
	 */
	cardIdByDate?: ReadonlyMap<string, string>;
}

export interface Readout {
	evaluatedAt: string;
	breakoutViewThreshold: number;
	platforms: PlatformReadout[];
	verdict: ViabilityVerdict;
}

const DEFAULT_BREAKOUT_VIEW_THRESHOLD = 10_000;

/** The pure computation this whole module exists to provide. No `Date.now()`, no IO — see this file's header. */
export function computeReadout(options: ComputeReadoutOptions): Readout {
	const { rows, now, breakoutViewThreshold = DEFAULT_BREAKOUT_VIEW_THRESHOLD, cardIdByDate } = options;

	const byPlatform = new Map<MetricsPlatform, MetricsRow[]>();
	for (const row of rows) {
		const existing = byPlatform.get(row.platform) ?? [];
		existing.push(row);
		byPlatform.set(row.platform, existing);
	}

	const platforms = [...byPlatform.entries()]
		.map(([platform, platformRows]) => computePlatformReadout(platform, platformRows, breakoutViewThreshold, cardIdByDate))
		.sort((a, b) => a.platform.localeCompare(b.platform));

	return {
		evaluatedAt: now,
		breakoutViewThreshold,
		platforms,
		verdict: computeVerdict(platforms)
	};
}

// ---------------------------------------------------------------------------
// Formatting — turns a `Readout` into the human-readable report. Kept
// entirely separate from the computation above per this file's own "pure,
// testable computation" requirement.
// ---------------------------------------------------------------------------

function formatFollowConversionLine(fc: PlatformFollowConversion): string {
	if (fc.method === 'unavailable') {
		return 'Follow conversion: UNAVAILABLE (no per-post follow figure recorded for any of these posts).';
	}
	const read = fc.posts.filter((p) => p.follows !== null).length;
	return `Follow conversion: EXACT (per-post attribution reported by the platform; ${read}/${fc.posts.length} post(s) recorded).`;
}

/** Renders one `Readout` as plain text for the weekly session / T15's runbook / T16's findings. Pure string formatting — no IO. */
export function formatReadout(readout: Readout): string {
	const lines: string[] = [];
	lines.push(`Viability readout — evaluated ${readout.evaluatedAt}`);
	lines.push(`Breakout view threshold: ${readout.breakoutViewThreshold.toLocaleString()} views.`);
	lines.push('');

	if (readout.platforms.length === 0) {
		lines.push('No metrics rows supplied — nothing to evaluate yet.');
	}

	for (const p of readout.platforms) {
		lines.push(`## ${p.platform} (${p.postCount} post(s))`);
		lines.push(`Median views: ${p.medianViews ?? 'no data'}`);
		lines.push(`Max views: ${p.maxViews ?? 'no data'}`);
		lines.push(`Max/median ratio: ${p.maxToMedianRatio !== null ? `${p.maxToMedianRatio.toFixed(2)}x` : 'n/a'}`);
		if (p.weekTrend.status === 'insufficient-data') {
			lines.push(`Week-1-vs-week-4 trend: insufficient data (weeks observed: ${p.weekTrend.weeksObserved.join(', ') || 'none'}).`);
		} else {
			lines.push(`Week-1-vs-week-4 trend: ${p.weekTrend.status.toUpperCase()} (week 1 median ${p.weekTrend.week1Median} -> week 4 median ${p.weekTrend.week4Median}).`);
		}
		lines.push(formatFollowConversionLine(p.followConversion));
		lines.push(`Top ${Math.min(5, p.topPosts.length)} post(s):`);
		for (const post of p.topPosts) {
			lines.push(`  - ${describePost(post)} (${post.format}): ${post.views} views`);
		}
		lines.push('');
	}

	lines.push(readout.verdict.summary);
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/readout.ts`. Reads every
// dated metrics file `hand-entry.ts` already writes
// from `content/social/metrics/`, reduces them to the latest known row per
// post — with the collectors deleted (see `hand-entry.ts`'s header), a post
// is written exactly once, into the single dated file named by its own
// publish date, by one hand-entry run; if the same post is ever entered
// under two different dates (a correction re-run against a different
// `--published-at`, or an accidental double-entry) the LAST `collectedAt`
// wins — computes the readout, and prints the report. Shares
// `hand-entry.ts`'s own CLI conventions (ENOENT ->
// empty, guarded `main()` so importing this module for its exports never
// parses `process.argv` or touches the filesystem); the `--now` wall-clock
// override below is this file's own.
// ---------------------------------------------------------------------------

const METRICS_FILENAME_RE = /^metrics-\d{4}-\d{2}-\d{2}\.json$/;

/**
 * Parses `--breakout-threshold` strictly (M8). `Number(raw)` alone yields
 * `NaN` for a typo like `"10,000"` or `"abc"` — and `NaN !== undefined`, so
 * the CLI's own `values['breakout-threshold'] !== undefined` guard would
 * never fall back to the default; `views >= NaN` is `false` for every row,
 * silently making criterion A unsatisfiable and printing "NOT VIABLE ... no
 * breakout post cleared the threshold" with no error, turning an operator
 * typo into a false no-go on the pilot's central decision. This function
 * rejects a non-finite or non-positive value with a clear error naming the
 * bad input, rather than silently falling back to the default (which would
 * hide the typo just as effectively).
 */
export function parseBreakoutThreshold(raw: string | undefined): number | undefined {
	if (raw === undefined) return undefined;
	const parsed = Number(raw);
	if (!Number.isFinite(parsed) || parsed <= 0) {
		throw new Error(`Invalid --breakout-threshold "${raw}" — must be a positive, finite number of views.`);
	}
	return parsed;
}

/**
 * Reads and merges every `metrics-<date>.json` file in `metricsDir`, keeping
 * only the LATEST row (by `collectedAt`) per `platform:postId` — the
 * "current" snapshot this module's per-post statistics expect. Normally
 * there is only one row to keep: with the collectors deleted, a post is
 * hand-entered exactly once, into the one dated file named by its own
 * publish date (see this file's `main()` comment above). The LATEST-wins
 * merge exists for the one case where a post genuinely does appear in more
 * than one dated file — a same-post correction re-run under a different
 * `--published-at` — so that correction (the higher `collectedAt`) is the
 * row this module reports, not whichever file `readdir` happens to list
 * first. An empty or missing directory yields `[]`, matching this
 * workspace's ENOENT -> empty convention.
 */
export async function readLatestMetricsRows(metricsDir: string): Promise<MetricsRow[]> {
	let filenames: string[];
	try {
		filenames = (await readdir(metricsDir)).filter((name) => METRICS_FILENAME_RE.test(name));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}

	const latestByKey = new Map<string, MetricsRow>();
	for (const filename of filenames) {
		const raw = await readFile(`${metricsDir.replace(/[/\\]+$/, '')}/${filename}`, 'utf-8');
		for (const row of parseMetricsRows(raw)) {
			const key = metricsRowKey(row);
			const existing = latestByKey.get(key);
			if (!existing || Date.parse(row.collectedAt) >= Date.parse(existing.collectedAt)) {
				latestByKey.set(key, row);
			}
		}
	}
	return [...latestByKey.values()];
}


function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/readout.ts [options]

Reads every dated metrics file under content/social/metrics/ (written by
hand-entry.ts), computes the per-platform viability
readout — median, maximum, max/median ratio, week-1-vs-week-4 median trend,
follow conversion, and top 5 posts — and states plainly whether the
pre-registered criterion (plans/complete/Pf39c2-social-pilot-index.md) was met.

Follow conversion is EXACT wherever a per-post follow figure was recorded
(hand-entry.ts --follows; every platform reports one), and UNAVAILABLE for a
platform where none of its posts carry one.

Options:
  --metrics-dir <path>       Defaults to content/social/metrics/.
  --schedule-dir <path>      Where the committed pilot-schedule-w<NN>.json
                              files live (default: content/social/). Each
                              post's card is resolved from its publish date,
                              so the top-posts list and the criterion-A
                              verdict name the card, not just the platform's
                              own id. A missing directory is not an error —
                              posts are then named by platform id alone.
  --now <ISO 8601>           The evaluation instant stamped on the report
                              (default: real wall-clock time). Does not
                              affect any computed statistic — every one is
                              derived from the rows' own publishedAt/views.
  --breakout-threshold <n>   Views a post must clear to be a criterion-A
                              candidate (default: 10000). Must be a positive
                              finite number — a typo'd/negative value throws
                              rather than silently falling back to the
                              default.
  --help                      Show this help.`);
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			'metrics-dir': { type: 'string' },
			'schedule-dir': { type: 'string' },
			now: { type: 'string' },
			'breakout-threshold': { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		return;
	}

	// `toDir` (shared with `hand-entry.ts`) rejects an empty `--metrics-dir`
	// outright rather than falling through `?? DEFAULT_METRICS_DIR` — an
	// empty STRING value here is the one shell-level failure mode `toDir`
	// itself can see (`--metrics-dir=` with an unset variable). See `toDir`'s
	// own doc comment for that general class. It cannot see a typo'd or
	// nonexistent PATH, though — a value that is a syntactically fine,
	// non-empty string but names no real directory. That wider case (any
	// path, empty or missing or misspelled, that yields zero rows) is closed
	// below, after `readLatestMetricsRows` runs, by refusing to print a
	// verdict — "NOT VIABLE" or otherwise — over zero data. See that check's
	// own comment for why.
	const metricsDir = toDir(values['metrics-dir'], '--metrics-dir', DEFAULT_METRICS_DIR);

	// THE ONE WALL-CLOCK READ IN THIS FILE — matches this workspace's own
	// "DETERMINISM" discipline elsewhere (e.g. `hand-entry.ts`'s
	// `collectedAt` input). `--now` lets an
	// operator pin the evaluation instant stamped on the report for a
	// reproducible re-run.
	const now = values.now ?? new Date().toISOString();

	const breakoutViewThreshold = parseBreakoutThreshold(values['breakout-threshold']);

	const rows = await readLatestMetricsRows(metricsDir);

	// ZERO ROWS IS NEVER "NOT VIABLE" (review round 5). `computeVerdict` over
	// an empty platform list legitimately returns `viable: false` — that pure
	// behaviour is `readout.test.ts`'s own `empty datasets` block and stays
	// unchanged, since another caller may reasonably want "no data" folded
	// into "not viable" for its own purposes. But THIS CLI is the one output
	// the pilot exists to produce: a reader acts on "NOT VIABLE" as the
	// pre-registered negative result, and that phrase must never appear
	// without real rows behind it — a mistyped or not-yet-existing
	// `--metrics-dir` must not be indistinguishable from a genuine negative.
	// So this is a `main()`-level reporting guard, not a change to
	// `computeReadout`/`computeVerdict`: it reports "insufficient data" and
	// exits non-zero instead of ever calling `computeReadout` at all when
	// `rows` is empty. Anything above zero rows is left alone — a real but
	// thin dataset (one row, one day) is exactly what the pre-registered
	// criterion's own human-in-the-loop reading (see the plan's §8) is for,
	// and inventing a second "minimum viable N" here would just relocate the
	// same fabrication risk this guard exists to close.
	if (rows.length === 0) {
		throw new Error(`INSUFFICIENT DATA — no metrics rows found under ${metricsDir}.`);
	}

	// Resolve each post's card from its publish date, so the top-posts list
	// and the criterion-A verdict name the premise rather than an opaque
	// platform id (see `card-index.ts`). A missing schedule directory yields
	// an empty index and the readout simply names platform ids — never a
	// reason to fail the run that produces the pilot's verdict.
	const scheduleDir = toDir(values['schedule-dir'], '--schedule-dir', DEFAULT_SCHEDULE_DIR);
	const cardIdByDate = await buildCardIndex(scheduleDir);

	const readout = computeReadout({ rows, now, breakoutViewThreshold, cardIdByDate });
	console.log(formatReadout(readout));
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `hand-entry.ts`'s own:
// importing this module for its exports (as every test in
// `__tests__/readout.test.ts` does) must never itself parse `process.argv`
// or touch the filesystem.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
