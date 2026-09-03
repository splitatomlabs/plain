/**
 * Pure planning/decision helpers for `job.ts`'s daily orchestration
 * (Pf39c2-social-pilot-03 T08) — everything computable WITHOUT touching the
 * filesystem, a network call, or a real clock, split out here so it is
 * directly unit-testable and `job.ts` itself stays orchestration-only.
 * Mirrors the `cli.ts`/`cli-plan.ts` split (T18) for the same reason.
 *
 * Nothing here reads `Date.now()` — every function that needs "now" (only
 * `formatExpiryAlertLine`, and only to render a value it's handed) takes it
 * as an explicit input, matching this workspace's determinism policy
 * (`pilot-config.ts`'s header comment).
 */

import { buildCaption } from './publish/caption.js';
import type { TokenExpiryAlert } from './publish/tokens.js';
import type { PendingYouTubeFlip } from './publish/tiktok-manual.js';
import type { ScheduleSlot } from './schedule-types.js';

// ---------------------------------------------------------------------------
// Per-platform outcomes — the acceptance criterion's own vocabulary: T08's
// acceptance is "a dry-run completes and logs per-platform outcomes."
// ---------------------------------------------------------------------------

export type PlatformName = 'instagram' | 'youtube';
/**
 * `'partial'` (code review M4 fix): the platform's own post genuinely
 * succeeded, but some piece of required bookkeeping around it did not — right
 * now that means exactly one thing, a YouTube upload whose video id failed to
 * be recorded in the durable pending-flips store. Deliberately NOT folded
 * into `'ok'`: a video that landed on YouTube but that T07's weekly
 * TikTok/flip session and the metrics readout can never find again is not a
 * clean success, and `exitCodeForOutcomes` treats it as a failure for exactly
 * that reason — a human needs to notice and re-record it by hand.
 */
export type PlatformStatus = 'ok' | 'partial' | 'failed' | 'dry-run';

export interface PlatformOutcome {
	platform: PlatformName;
	status: PlatformStatus;
	/** Human-readable detail. NEVER a token value — see `job.ts`'s header comment. */
	message: string;
}

/** The job's own exit status: non-zero once ANYTHING failed OR partially failed, but only decided after every platform was attempted. */
export function exitCodeForOutcomes(outcomes: PlatformOutcome[]): number {
	return outcomes.some((outcome) => outcome.status === 'failed' || outcome.status === 'partial') ? 1 : 0;
}

/** One structured, human-readable log line per outcome — `job.ts` logs exactly one of these per platform, every run. */
export function formatOutcomeLine(outcome: PlatformOutcome): string {
	return `[${outcome.platform}] ${outcome.status.toUpperCase()} — ${outcome.message}`;
}

/** Formats an `expiryAlert` (`tokens.ts`) result for the run log — plan Constraint: expiry inside 30 days raises an alert. */
export function formatExpiryAlertLine(alert: TokenExpiryAlert): string {
	return (
		`[${alert.platform}] TOKEN EXPIRY ALERT — expires ${alert.expiresAt} ` +
		`(${alert.daysRemaining.toFixed(1)} day(s) remaining)`
	);
}

/** `error.message` if `error` is an `Error`, else its string form. Never a token — see `job.ts`'s header comment. */
export function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// YouTube title/description — built from the same caption `caption.ts`
// already produces for the other platforms, not a separate copy source.
// ---------------------------------------------------------------------------

/** YouTube's title field has a hard length cap; truncate cleanly rather than letting the API reject the upload. */
export const YOUTUBE_TITLE_MAX_LENGTH = 100;

/**
 * The video's title — the card's own landing line, truncated to
 * `YOUTUBE_TITLE_MAX_LENGTH` if needed. Never rewritten otherwise: the
 * landing line is the card's own verbatim payoff sentence (see
 * `cli-plan.ts`'s `computeWallPlainLines` doc comment for how the render
 * pipeline treats it the same way).
 */
export function buildYouTubeTitle(slot: ScheduleSlot): string {
	const line = slot.content.landing_line.trim();
	if (line.length <= YOUTUBE_TITLE_MAX_LENGTH) {
		return line;
	}
	return `${line.slice(0, YOUTUBE_TITLE_MAX_LENGTH - 1).trimEnd()}…`;
}

/** The video's description — `caption.ts`'s own YouTube caption, unchanged. */
export function buildYouTubeDescription(slot: ScheduleSlot): string {
	return buildCaption({ slot, platform: 'youtube' });
}

/** The Instagram post's caption — `caption.ts`'s own Instagram caption, unchanged. */
export function buildInstagramCaption(slot: ScheduleSlot): string {
	return buildCaption({ slot, platform: 'instagram' });
}

// ---------------------------------------------------------------------------
// The pending-YouTube-flip list — T07's `stageTikTokWeek` consumes exactly
// this shape (`PendingYouTubeFlip`, defined in `publish/tiktok-manual.ts` —
// reused here, not redefined, since T07 already owns that shape).
// ---------------------------------------------------------------------------

/**
 * Replaces any existing entry for `flip.date` (a re-run of the same day's
 * job must not leave two entries for it) and appends otherwise, keeping the
 * list sorted by date so the file reads top-to-bottom in the order the
 * weekly session will work through it.
 */
export function upsertPendingFlip(existing: PendingYouTubeFlip[], flip: PendingYouTubeFlip): PendingYouTubeFlip[] {
	const withoutSameDate = existing.filter((entry) => entry.date !== flip.date);
	return [...withoutSameDate, flip].sort((a, b) => a.date.localeCompare(b.date));
}

/** Parses the pending-flips JSON file's contents. An empty/missing file is `[]`, not an error. */
export function parsePendingFlips(raw: string): PendingYouTubeFlip[] {
	const trimmed = raw.trim();
	if (trimmed === '') {
		return [];
	}
	const parsed: unknown = JSON.parse(trimmed);
	if (!Array.isArray(parsed)) {
		throw new Error('Pending YouTube flips file did not contain a JSON array.');
	}
	return parsed as PendingYouTubeFlip[];
}

/** The pending-flips file's on-disk shape: pretty-printed JSON, newline-terminated (matches `post-metadata.ts`'s convention). */
export function serializePendingFlips(flips: PendingYouTubeFlip[]): string {
	return `${JSON.stringify(flips, null, 2)}\n`;
}

/**
 * The durable store `job.ts` records a day's uploaded YouTube video id into,
 * and `metrics/collect.ts` reads back to know which videos to poll (M4 fix,
 * Pf39c2-social-pilot-03 code review). Defined here (not in `job.ts`) so both
 * `job.ts`'s Firestore-backed default and `metrics/collect.ts`'s reader can
 * depend on this one shape without importing `job.ts` itself — mirrors
 * `tokens.ts` defining `TokenStore` for `token-store-firestore.ts` to
 * implement, rather than the store's own module owning the type.
 *
 * `append` takes exactly ONE new flip and is responsible for the whole
 * read-modify-write (merge via `upsertPendingFlip`, persist the merged list)
 * ATOMICALLY, in one step no caller can split. This shape is deliberate
 * (follow-up code review after M4, Pf39c2-social-pilot-03): an earlier
 * version of this interface exposed `read()`/`write(flips)` separately, and
 * `job.ts`'s `recordPendingFlip` called them as two independent steps —
 * `read()`, append the day's flip in memory, `write(merged)` — with the
 * read happening entirely OUTSIDE whatever atomicity the durable
 * implementation's `write` provided. Two overlapping runs (the exact
 * scenario M4 already worried about — a retried Cloud Run execution racing
 * the previous one) could each `read()` the same starting list, each append
 * their own day in memory, and whichever called `write()` second would
 * silently discard the other's already-committed entry: a lost YouTube
 * video id, permanently unreachable to the weekly flip session and to
 * `metrics/collect.ts`. Collapsing read-modify-write into a single
 * `append(flip)` call makes that caller-side race unrepresentable — there
 * is no longer a window between "read" and "write" for another writer to
 * land in, because there is no separate "read" for callers to call. `read()`
 * remains a separate, read-only method for `metrics/collect.ts`'s
 * read-everything-back use, which never modifies the list.
 */
export interface PendingFlipsStore {
	read(): Promise<PendingYouTubeFlip[]>;
	/** Merges `flip` into the stored list (replacing any existing entry for the same date) and persists the result, atomically. */
	append(flip: PendingYouTubeFlip): Promise<void>;
}
