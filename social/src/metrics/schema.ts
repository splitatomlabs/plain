/**
 * The one shared metrics row schema (Pf39c2-social-pilot-03 T12) plus the
 * pure serialization/idempotency helpers `collect.ts` builds on. Everything
 * here is pure — no I/O, no `Date.now()` — matching this workspace's
 * `job-plan.ts`/`cli-plan.ts` split (pure planning logic lives in its own
 * file so it is directly unit-testable without a network or filesystem).
 *
 * Task wording this file implements verbatim: "Implement automated
 * collection for Instagram and YouTube against ONE SHARED ROW SCHEMA —
 * platform, format, publish time, views, average percent watched, likes,
 * comments, shares, saves, follows. (No opening variant column — the
 * opening comparison was CANCELLED outright, social pilot 02a T17.)"
 *
 * NO `opening` FIELD: `render/post-metadata.ts`'s `opening` field was
 * deleted along with the opening-rotation comparison it existed to run (see
 * this plan's own Decision, quoting social pilot 02a T17 verbatim). Nothing
 * in this module reintroduces it, under this or any other name.
 *
 * AVAILABLE VS. ZERO — the single most important rule this schema encodes:
 * some fields are genuinely unavailable on a given platform, not zero.
 * Fabricating a `0` for an unavailable metric would silently lie in any
 * later readout (T14) that averages or ranks rows — a real zero-engagement
 * post and an unmeasured field would become indistinguishable. So every
 * field that isn't universally available is typed `number | null`, where
 * `null` means "not available on this platform," strictly distinct from the
 * number `0` ("available, and the true value is zero"):
 *
 *   - `saves` — Instagram-only. Meta's Reels insights report a `saved`
 *     metric; YouTube's Data/Analytics APIs have no equivalent concept at
 *     all. YouTube rows: `saves: null`, always.
 *   - `follows` — PER-POST follow attribution exists ONLY on YouTube
 *     (Analytics API's `subscribersGained` metric, scoped to one video via
 *     `dimensions=video`/`filters=video==<id>`). Per the plan's Decision:
 *     "Instagram reports follower counts at the ACCOUNT level only, so
 *     criterion A's conversion half must be inferred from daily follower
 *     deltas aligned to post times — with two posts a day, attribution is
 *     directional, not exact." Instagram rows therefore carry
 *     `follows: null` always — the inferred, directional account-level
 *     series lives in a SEPARATE structure (`InstagramFollowerSnapshot`
 *     below), never smuggled into a per-post row as a fabricated number.
 *   - `shares` — Instagram's Reels insights genuinely report a `shares`
 *     metric, so Instagram rows carry a real number. YouTube's Data API
 *     `statistics` resource has no shares count, and this task's own
 *     Constraint enumerates exactly `engagedViews`/`averageViewPercentage`/
 *     `subscribersGained` to pull from the Analytics API — even though
 *     Analytics also exposes a `shares` metric, pulling it would be scope
 *     creep beyond what this task specifies. YouTube rows: `shares: null`
 *     — genuinely not collected, not a claimed zero.
 *   - `averagePercentWatched` — computed for Instagram from
 *     `ig_reels_avg_watch_time` (insights) against the media's own
 *     `video_duration` (see `instagram.ts`); `null` when the media isn't a
 *     video/Reel or its duration is unknown, rather than a fabricated 0%.
 *     YouTube always reports a real `averageViewPercentage` from Analytics.
 *
 * `format` is hardcoded to the single literal `'wall'` throughout this
 * module — mirrors `render/post-metadata.ts`'s own `PostFormat`, which
 * narrowed to the same single value after Pf39c2-social-pilot-02a D01/D02
 * deleted every other format. Kept as its own local type (not imported)
 * for the same reason `post-metadata.ts` and `schedule-types.ts` each keep
 * their own local copy: `social/` is a self-contained npm project (T01's
 * scope note), not a workspace member of the root content-pipeline package.
 */

export type MetricsPlatform = 'instagram' | 'youtube';

/** Mirrors `render/post-metadata.ts`'s `PostFormat` — see this file's header for why it's a local copy, not an import. */
export type MetricsFormat = 'wall';

/**
 * One platform's snapshot of one live post, as of `collectedAt`. See this
 * file's header for the available-vs-zero (`null` vs `number`) rule that
 * governs every optional field below.
 */
export interface MetricsRow {
	platform: MetricsPlatform;
	/** The platform's own id for this post — Instagram media id, or YouTube video id. */
	postId: string;
	format: MetricsFormat;
	/** ISO 8601 — the platform's own reported publish instant, never a locally-guessed date. */
	publishedAt: string;
	/**
	 * On YouTube this is `engagedViews`, NEVER the Data API's `viewCount` —
	 * see `youtube.ts`'s header for the March 2025 Shorts view-counting
	 * change this schema field name deliberately does not let a caller
	 * confuse itself about.
	 */
	views: number;
	averagePercentWatched: number | null;
	likes: number | null;
	comments: number | null;
	/** Instagram: real. YouTube: `null` — see this file's header. */
	shares: number | null;
	/** Instagram-only. Always `null` on YouTube. */
	saves: number | null;
	/** YouTube-only (`subscribersGained`, per-post). Always `null` on Instagram — see this file's header. */
	follows: number | null;
	/** ISO 8601 — when THIS row's numbers were fetched (distinct from `publishedAt`). */
	collectedAt: string;
}

/**
 * A single day's Instagram ACCOUNT-level follower count. The plan's
 * Decision: Instagram reports followers only at the account level, so this
 * is deliberately a SEPARATE series from `MetricsRow`, never folded into a
 * per-post row as a fabricated `follows` number — see this file's header.
 */
export interface InstagramFollowerSnapshot {
	/** ISO calendar date (`YYYY-MM-DD`) this snapshot represents. */
	date: string;
	followerCount: number;
}

// ---------------------------------------------------------------------------
// The 30-day polling window — plan Constraint: "Poll for 30 days after
// publication, since metrics keep accruing."
// ---------------------------------------------------------------------------

export const POLLING_WINDOW_DAYS = 30;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whether a post published at `publishedAt` is still inside its polling
 * window at instant `now`. INCLUSIVE at exactly `windowDays` days old —
 * matches `tokens.ts`'s own inclusive-boundary convention
 * (`expiryAlert`/`needsRefresh`'s `<=`) rather than an off-by-one exclusive
 * cut. A post published in the future relative to `now` (clock skew, a bad
 * fixture) is excluded rather than silently treated as "always in window."
 */
export function isWithinPollingWindow(publishedAt: string, now: string, windowDays: number = POLLING_WINDOW_DAYS): boolean {
	const publishedMs = Date.parse(publishedAt);
	const nowMs = Date.parse(now);
	if (Number.isNaN(publishedMs) || Number.isNaN(nowMs)) {
		throw new Error(`Invalid ISO 8601 timestamp — publishedAt="${publishedAt}", now="${now}".`);
	}
	const ageMs = nowMs - publishedMs;
	return ageMs >= 0 && ageMs <= windowDays * DAY_MS;
}

// ---------------------------------------------------------------------------
// Idempotency — the acceptance criterion: "a run appends a dated file with
// one row per live post, and re-running is idempotent rather than
// duplicating rows." Rows are keyed on platform + post id: stable across
// re-runs of the same collection date, per this task's own instruction.
// ---------------------------------------------------------------------------

/** The stable key a row is upserted on. Deliberately NOT including `collectedAt` — a re-run must UPDATE the row, not key a fresh one by its own timestamp. */
export function metricsRowKey(row: Pick<MetricsRow, 'platform' | 'postId'>): string {
	return `${row.platform}:${row.postId}`;
}

/**
 * Replaces any existing row with the same `metricsRowKey` and appends
 * otherwise — the idempotent upsert `collect.ts` runs once per fetched row,
 * per platform, per collection run. Keeps the result sorted by key so the
 * on-disk file reads deterministically regardless of fetch order.
 */
export function upsertMetricsRow(existing: MetricsRow[], row: MetricsRow): MetricsRow[] {
	const key = metricsRowKey(row);
	const withoutSameKey = existing.filter((entry) => metricsRowKey(entry) !== key);
	return [...withoutSameKey, row].sort((a, b) => metricsRowKey(a).localeCompare(metricsRowKey(b)));
}

/** The dated metrics file's path — one file per collection date, per this task's acceptance wording ("a dated file"). */
export function metricsFilePathFor(outDir: string, collectionDate: string): string {
	return `${outDir.replace(/[/\\]+$/, '')}/metrics-${collectionDate}.json`;
}

/** Parses a metrics file's contents. An empty/missing file is `[]`, not an error — matches `job-plan.ts`'s `parsePendingFlips` convention. */
export function parseMetricsRows(raw: string): MetricsRow[] {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return [];
	}
	const parsed: unknown = JSON.parse(trimmed);
	if (!Array.isArray(parsed)) {
		throw new Error('Metrics file did not contain a JSON array.');
	}
	return parsed as MetricsRow[];
}

/** Pretty-printed, newline-terminated — matches `job-plan.ts`'s `serializePendingFlips` and `post-metadata.ts`'s convention. */
export function serializeMetricsRows(rows: MetricsRow[]): string {
	return `${JSON.stringify(rows, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Instagram's daily account-level follower series — a separate file, same
// idempotency discipline: one snapshot per calendar date, keyed by date so a
// same-day re-run replaces rather than duplicates.
// ---------------------------------------------------------------------------

export const INSTAGRAM_FOLLOWERS_FILENAME = 'instagram-followers.json';

export function instagramFollowersFilePathFor(outDir: string): string {
	return `${outDir.replace(/[/\\]+$/, '')}/${INSTAGRAM_FOLLOWERS_FILENAME}`;
}

export function upsertFollowerSnapshot(
	existing: InstagramFollowerSnapshot[],
	snapshot: InstagramFollowerSnapshot
): InstagramFollowerSnapshot[] {
	const withoutSameDate = existing.filter((entry) => entry.date !== snapshot.date);
	return [...withoutSameDate, snapshot].sort((a, b) => a.date.localeCompare(b.date));
}

export function parseFollowerSnapshots(raw: string): InstagramFollowerSnapshot[] {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return [];
	}
	const parsed: unknown = JSON.parse(trimmed);
	if (!Array.isArray(parsed)) {
		throw new Error('Instagram followers file did not contain a JSON array.');
	}
	return parsed as InstagramFollowerSnapshot[];
}

export function serializeFollowerSnapshots(snapshots: InstagramFollowerSnapshot[]): string {
	return `${JSON.stringify(snapshots, null, 2)}\n`;
}
