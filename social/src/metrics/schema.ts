/**
 * The one shared metrics row schema (Pf39c2-social-pilot-03 T12) plus the
 * pure serialization/idempotency helpers built on top of it. Everything here
 * is pure — no I/O, no `Date.now()` — matching this workspace's
 * `prepare-week-plan.ts`/`cli-plan.ts` split (pure planning logic lives in
 * its own file so it is directly unit-testable without a network or
 * filesystem). The
 * one exception is `DEFAULT_METRICS_DIR` below: a module-level path constant
 * is not I/O (it performs no read, write, or filesystem access itself — it
 * is just a string), so it lives here as the shared default every metrics
 * module (`hand-entry.ts`, `readout.ts`) imports,
 * rather than being duplicated or re-exported from whichever module happened
 * to define it first (Pb4e17-social-native-scheduling T03).
 *
 * NO API COLLECTORS: this schema originally backed automated collection for
 * Instagram and YouTube via each platform's own API (`collect.ts`,
 * `instagram.ts`, `youtube.ts`, `tiktok-spike.ts`). Pb4e17-social-native-
 * scheduling T07/T08 deleted the API publish and read pipelines outright —
 * every platform now posts through its own native scheduler by hand, and
 * every metric is hand-entered too (`hand-entry.ts`). The row shape below is
 * unchanged; only how each row gets filled in has changed. A second CLI,
 * `follower-snapshot.ts`, once recorded a daily account-level follower
 * series alongside it; it was deleted on 2026-09-21 once every platform was
 * confirmed to report follows per post (see `follows` below).
 *
 * Task wording the schema itself still implements verbatim: "... against
 * ONE SHARED ROW SCHEMA — platform, format, publish time, views, average
 * percent watched, likes, comments, shares, saves, follows. (No opening
 * variant column — the opening comparison was CANCELLED outright, social
 * pilot 02a T17.)"
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
 *   - `saves` — ALWAYS `null`, on every platform, in this pipeline.
 *     Instagram's app and TikTok's own analytics both surface a per-post
 *     saves/Favorites count and YouTube has no equivalent concept, but
 *     `hand-entry.ts` — the only writer of a `MetricsRow` — does not ask
 *     for it on any platform, so no row ever carries a number here. The
 *     field is kept for the pre-registered schema wording only.
 *   - `follows` — a REAL per-post number on ALL THREE platforms: YouTube
 *     Studio's per-video "subscribers gained", Meta Business Suite's
 *     per-Reel Follows, and TikTok's per-video Follows. Read by hand off
 *     that platform's own screen (`hand-entry.ts`'s `--follows`) and
 *     reported as `readout.ts`'s `FollowConversionMethod: 'exact'`. Here
 *     `null` means "not read" rather than "not available on this platform",
 *     and is still strictly distinct from `0` ("read, and this post
 *     converted nobody").
 *
 *     HISTORY, because this field's rule was wrong twice and the wrongness
 *     was enforced rather than merely written down: the plan's original
 *     Decision held that "Instagram reports follower counts at the ACCOUNT
 *     level only, so criterion A's conversion half must be inferred from
 *     daily follower deltas", and TikTok was grouped with it on the same
 *     reasoning. Both platforms do in fact report follows per post, which
 *     was established by looking at the screens (2026-09-21). Until then
 *     `hand-entry.ts` REJECTED the real number on those platforms as a
 *     fabrication, and a separate daily account-level series
 *     (`follower-snapshot.ts`, `<platform>-followers.json`) existed solely
 *     to infer what the platforms were reporting exactly all along. That
 *     series and its inference were deleted once all three platforms were
 *     confirmed; `git log` has them if the premise ever needs revisiting.
 *   - `shares` — a real number on all three platforms: Instagram, YouTube,
 *     and TikTok each show a per-post share count on their own analytics
 *     screen, and `hand-entry.ts` requires it as one of the four counts a
 *     human reads off any of the three.
 *   - `averagePercentWatched` — optional on every platform, defaulting to
 *     `null` in `hand-entry.ts` rather than a fabricated 0%. YouTube Studio
 *     shows a real average-percentage-watched figure per video, so it is the
 *     platform this is most often filled in for. Instagram's Insights screen
 *     shows average watch *time*, not a percentage, so entering this field
 *     for Instagram requires converting time against the post's own
 *     duration by hand. TikTok's retention curves are in-app only and not
 *     part of what `hand-entry.ts` requires anywhere; it accepts this field
 *     only as an optional override for the rare case a human genuinely has
 *     a clean percentage to enter, never requires it.
 *
 * `format` is hardcoded to the single literal `'wall'` throughout this
 * module — mirrors `render/post-metadata.ts`'s own `PostFormat`, which
 * narrowed to the same single value after Pf39c2-social-pilot-02a D01/D02
 * deleted every other format. Kept as its own local type (not imported)
 * for the same reason `post-metadata.ts` and `schedule-types.ts` each keep
 * their own local copy: `social/` is a self-contained npm project (T01's
 * scope note), not a workspace member of the root content-pipeline package.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/metrics` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..', '..');
/** The default metrics output directory every metrics module shares — see this file's header. */
export const DEFAULT_METRICS_DIR = path.join(REPO_ROOT, 'content', 'social', 'metrics');
/** Where the committed `pilot-schedule-w<NN>.json` files live — `readout.ts` reads them to name a post's card (`card-index.ts`). Same "a path constant is not I/O" rationale as `DEFAULT_METRICS_DIR` above. */
export const DEFAULT_SCHEDULE_DIR = path.join(REPO_ROOT, 'content', 'social');

export type MetricsPlatform = 'instagram' | 'youtube' | 'tiktok';

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
	 * On YouTube, whoever is hand-entering this row should read Studio's
	 * `engagedViews`-equivalent figure, NEVER the raw "Views" count — since
	 * March 2025 YouTube's raw view count counts every Short start with no
	 * minimum watch time, which would silently inflate this field on Shorts.
	 * This field name is deliberately not `viewCount` so a caller cannot
	 * confuse itself about which number belongs here.
	 */
	views: number;
	averagePercentWatched: number | null;
	likes: number | null;
	comments: number | null;
	/** Real on Instagram, YouTube, and TikTok — see this file's header. */
	shares: number | null;
	/** Always `null` — not collected on any platform; see this file's header. */
	saves: number | null;
	/** Real per-post follow attribution, reported by all three platforms: YouTube Studio's subscribersGained, Meta Business Suite's per-Reel Follows, TikTok's per-video Follows. `null` means "not read", never zero — see this file's header. */
	follows: number | null;
	/** ISO 8601 — when THIS row's numbers were read/entered (distinct from `publishedAt`). */
	collectedAt: string;
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
 * otherwise — the idempotent upsert `hand-entry.ts` runs once per
 * hand-entered row, per platform, per weekly session. Keeps the result
 * sorted by key so the on-disk file reads deterministically regardless of
 * entry order.
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

/** Parses a metrics file's contents. An empty/missing file is `[]`, not an error — matches the standing convention this workspace's pure planning files use for optional on-disk state (see `cli-plan.ts`). */
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

/** Pretty-printed, newline-terminated — matches `post-metadata.ts`'s convention. */
export function serializeMetricsRows(rows: MetricsRow[]): string {
	return `${JSON.stringify(rows, null, 2)}\n`;
}
