/**
 * The viability readout (Pf39c2-social-pilot-03 T14).
 *
 * Task wording, verbatim: "Implement the viability readout — per platform,
 * the median, the maximum, the max/median ratio, the week-1-vs-week-4
 * median trend, follow conversion (exact on YouTube, inferred from daily
 * deltas on Instagram and TikTok — label which is which), and the top 5
 * posts with their format. State plainly whether the pre-registered
 * criterion was met."
 *
 * THE PRE-REGISTERED CRITERION this module implements, quoted verbatim from
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
 * `collect.ts`/`tiktok-manual.ts` already write and prints the report.
 * Mirrors this workspace's `job-plan.ts`/`job.ts` and `cli-plan.ts`/`cli.ts`
 * pure-plan-vs-IO split.
 *
 * EXACT VS. INFERRED FOLLOW CONVERSION — this file's own label discipline,
 * per `schema.ts`'s header and the plan's Decision it quotes: "per-post
 * follow attribution exists ONLY on YouTube ... Instagram reports follower
 * counts at the ACCOUNT level only, so criterion A's conversion half must be
 * inferred from daily follower deltas aligned to post times — with two
 * posts a day, attribution is directional, not exact." (Social pilot 02a
 * D02 later collapsed both channels to one post a day, which makes the
 * day-over-day attribution in this file more directly aligned to a single
 * post, but it is STILL an inference from an account-level series, not a
 * per-post count — this file never upgrades it to "exact" and always labels
 * it `'inferred'` in its own output.) TikTok has no follower-snapshot
 * collector at all yet (see `tiktok-manual.ts`'s header) — this module's
 * `PlatformFollowConversion.method` reports `'unavailable'` for a platform
 * with per-post `follows: null` on every row and no snapshot series
 * supplied, rather than silently reporting `0` or fabricating an inference
 * from nothing.
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

import { dateToWeekDay } from '../pilot-config.js';
import { DEFAULT_METRICS_DIR } from './collect.js';
import { instagramFollowersFilePathFor, metricsRowKey, parseFollowerSnapshots, parseMetricsRows, type MetricsFormat, type MetricsPlatform, type MetricsRow } from './schema.js';

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
// Follow conversion — exact on YouTube, inferred (and labeled as such) on
// Instagram/TikTok. See this file's header for why "inferred" never
// upgrades to "exact" even under the pilot's current one-post-a-day cadence.
// ---------------------------------------------------------------------------

export type FollowConversionMethod = 'exact' | 'inferred' | 'unavailable';

export interface PostFollowConversion {
	postId: string;
	views: number;
	/** `null` = not available / not measurable for this post. NEVER treated as `0` — see this file's header. */
	follows: number | null;
}

export interface PlatformFollowConversion {
	method: FollowConversionMethod;
	posts: PostFollowConversion[];
}

/** A generic daily account-level snapshot — same shape as `schema.ts`'s `InstagramFollowerSnapshot`, reused here (not reimported by name) so this file can also accept a TikTok series once one exists, without `schema.ts` growing a TikTok-specific type for a collector that isn't built yet. */
export interface DailyFollowerSnapshot {
	/** ISO calendar date (`YYYY-MM-DD`). */
	date: string;
	followerCount: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** One calendar day before `date` (`YYYY-MM-DD` in, `YYYY-MM-DD` out), computed in UTC — matches `schema.ts`'s own `DAY_MS` convention. */
function previousIsoDate(date: string): string {
	const ms = Date.parse(`${date}T00:00:00.000Z`);
	return new Date(ms - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Infers one post's follow conversion from a day-over-day delta in the
 * account's follower count, aligned to the post's own publish date — the
 * plan's Decision, verbatim: "inferred from daily follower deltas aligned
 * to post times." Returns `null` (never a fabricated `0`) whenever either
 * the publish day's or the prior day's snapshot is missing, since a delta
 * cannot be computed without both endpoints.
 */
function inferFollowsForPost(publishedAt: string, snapshots: DailyFollowerSnapshot[]): number | null {
	const date = publishedAt.slice(0, 10);
	const prevDate = previousIsoDate(date);
	const today = snapshots.find((s) => s.date === date);
	const prev = snapshots.find((s) => s.date === prevDate);
	if (!today || !prev) return null;
	return today.followerCount - prev.followerCount;
}

/**
 * Builds one platform's `PlatformFollowConversion`. YouTube rows already
 * carry a real `follows` (per-post `subscribersGained`) — `method: 'exact'`,
 * passed straight through. Instagram/TikTok rows always carry
 * `follows: null` on the row itself (see `schema.ts`'s header); this
 * function infers a number from `snapshots` when supplied (`method:
 * 'inferred'`), or reports `method: 'unavailable'` with every post's
 * `follows: null` when no snapshot series exists for that platform yet —
 * exactly TikTok's current state until a follower-snapshot collector is
 * built for it.
 */
export function computeFollowConversion(
	platform: MetricsPlatform,
	rows: Pick<MetricsRow, 'postId' | 'views' | 'publishedAt' | 'follows'>[],
	snapshots?: DailyFollowerSnapshot[]
): PlatformFollowConversion {
	if (platform === 'youtube') {
		return {
			method: 'exact',
			posts: rows.map((r) => ({ postId: r.postId, views: r.views, follows: r.follows }))
		};
	}
	if (!snapshots || snapshots.length === 0) {
		return {
			method: 'unavailable',
			posts: rows.map((r) => ({ postId: r.postId, views: r.views, follows: null }))
		};
	}
	return {
		method: 'inferred',
		posts: rows.map((r) => ({ postId: r.postId, views: r.views, follows: inferFollowsForPost(r.publishedAt, snapshots) }))
	};
}

// ---------------------------------------------------------------------------
// Per-platform readout + top posts.
// ---------------------------------------------------------------------------

export interface TopPost {
	postId: string;
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
	followerSnapshots: DailyFollowerSnapshot[] | undefined
): PlatformReadout {
	const views = rows.map((r) => r.views);
	const medianViews = views.length > 0 ? median(views) : null;
	const maxViews = views.length > 0 ? Math.max(...views) : null;
	const ratio = medianViews !== null && maxViews !== null ? maxToMedianRatio(maxViews, medianViews) : null;
	const followConversion = computeFollowConversion(platform, rows, followerSnapshots);
	const followsByPostId = new Map(followConversion.posts.map((p) => [p.postId, p.follows]));

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
			.map((r) => ({ postId: r.postId, views: r.views, follows: followsByPostId.get(r.postId) ?? null })),
		topPosts: sortedByViewsDesc.slice(0, 5).map((r) => ({ postId: r.postId, views: r.views, format: r.format }))
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
 * The pre-registered criterion, applied. Checks A first (a breakout post
 * with visible follow conversion, exact or inferred), then B (an upward
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
						`VIABLE (criterion A met) — ${p.platform} post ${post.postId} cleared the breakout threshold ` +
						`with ${post.views} views and converted to ${post.follows} follow(s) ` +
						`(${p.followConversion.method === 'exact' ? 'exact per-post attribution' : 'inferred from daily follower deltas — directional, not exact'}).`,
					evidence: { criterion: 'A', platform: p.platform, postId: post.postId, views: post.views, follows: post.follows }
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
	/** Instagram's daily account-level follower series, for inferred follow conversion. Omit to report `'unavailable'`. */
	instagramFollowerSnapshots?: DailyFollowerSnapshot[];
	/** TikTok's daily account-level follower series, if one is ever collected (no such collector exists yet — see this file's header). Omit to report `'unavailable'`. */
	tiktokFollowerSnapshots?: DailyFollowerSnapshot[];
	/** ISO 8601 — the evaluation instant. Not used in any computation below (all of it is derived from `rows`' own `publishedAt`/`views`), but threaded through and stamped onto the result so the readout is reproducible against a fixed moment rather than implicitly "now." */
	now: string;
	/** Defaults to ~10,000, per the pre-registered criterion's "clearing ~10,000 views on any platform." */
	breakoutViewThreshold?: number;
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
	const { rows, instagramFollowerSnapshots, tiktokFollowerSnapshots, now, breakoutViewThreshold = DEFAULT_BREAKOUT_VIEW_THRESHOLD } = options;

	const byPlatform = new Map<MetricsPlatform, MetricsRow[]>();
	for (const row of rows) {
		const existing = byPlatform.get(row.platform) ?? [];
		existing.push(row);
		byPlatform.set(row.platform, existing);
	}

	const snapshotsFor = (platform: MetricsPlatform): DailyFollowerSnapshot[] | undefined => {
		if (platform === 'instagram') return instagramFollowerSnapshots;
		if (platform === 'tiktok') return tiktokFollowerSnapshots;
		return undefined;
	};

	const platforms = [...byPlatform.entries()]
		.map(([platform, platformRows]) => computePlatformReadout(platform, platformRows, breakoutViewThreshold, snapshotsFor(platform)))
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
	if (fc.method === 'exact') return 'Follow conversion: EXACT (per-post subscribersGained).';
	if (fc.method === 'inferred') return 'Follow conversion: INFERRED (from daily follower-count deltas aligned to publish date — directional, not exact).';
	return 'Follow conversion: UNAVAILABLE (no per-post attribution and no follower-snapshot series supplied for this platform).';
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
			lines.push(`  - ${post.postId} (${post.format}): ${post.views} views`);
		}
		lines.push('');
	}

	lines.push(readout.verdict.summary);
	return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI entry point — `npx tsx social/src/metrics/readout.ts`. Reads every
// dated metrics file `collect.ts`/`tiktok-manual.ts` already write from
// `content/social/metrics/`, reduces them to the latest known row per post
// (a post appears in every dated file inside its 30-day polling window, so
// the LAST `collectedAt` wins), reads Instagram's daily follower-snapshot
// file if present, computes the readout, and prints the report. Mirrors
// `collect.ts`'s own CLI conventions (ENOENT -> empty, a single
// `--now` wall-clock override, guarded `main()` so importing this module
// for its exports never parses `process.argv` or touches the filesystem).
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
 * "current" snapshot this module's per-post statistics expect, not every
 * historical day's row for a post still inside its polling window. An empty
 * or missing directory yields `[]`, matching this workspace's ENOENT ->
 * empty convention.
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

/** Reads Instagram's daily follower-snapshot file if present. Missing file -> `[]` (report `'unavailable'`), never a fabricated series. */
async function readInstagramFollowerSnapshots(metricsDir: string): Promise<DailyFollowerSnapshot[]> {
	try {
		const raw = await readFile(instagramFollowersFilePathFor(metricsDir), 'utf-8');
		return parseFollowerSnapshots(raw);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
		throw error;
	}
}

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/readout.ts [options]

Reads every dated metrics file under content/social/metrics/ (written by
collect.ts and tiktok-manual.ts), computes the per-platform viability
readout — median, maximum, max/median ratio, week-1-vs-week-4 median trend,
follow conversion, and top 5 posts — and states plainly whether the
pre-registered criterion (plans/Pf39c2-social-pilot-index.md) was met.

No TikTok follower-snapshot collector exists yet, so TikTok's follow
conversion always reports UNAVAILABLE until one is built — see this file's
own header.

Options:
  --metrics-dir <path>       Defaults to content/social/metrics/.
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

	const metricsDir = values['metrics-dir'] ?? DEFAULT_METRICS_DIR;

	// THE ONE WALL-CLOCK READ IN THIS FILE — see `collect.ts`'s identical
	// "DETERMINISM" discipline. `--now` lets an operator pin the evaluation
	// instant stamped on the report for a reproducible re-run.
	const now = values.now ?? new Date().toISOString();

	const breakoutViewThreshold = parseBreakoutThreshold(values['breakout-threshold']);

	const rows = await readLatestMetricsRows(metricsDir);
	const instagramFollowerSnapshots = await readInstagramFollowerSnapshots(metricsDir);

	const readout = computeReadout({ rows, instagramFollowerSnapshots, now, breakoutViewThreshold });
	console.log(formatReadout(readout));
}

// Only auto-run `main()` when this file is the actual process entry point —
// identical guard to `collect.ts`'s/`tiktok-manual.ts`'s own: importing this
// module for its exports (as every test in `__tests__/readout.test.ts`
// does) must never itself parse `process.argv` or touch the filesystem.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
