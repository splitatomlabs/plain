/**
 * Tests for `../tiktok-manual.ts` (Pf39c2-social-pilot-03 T13 — the
 * documented hand-entry fallback).
 *
 * Coverage, matching this task's brief:
 *   - Valid hand entry produces a correct row in the shared `MetricsRow`
 *     schema, with `platform: 'tiktok'`.
 *   - TikTok rows carry `null` where the platform genuinely cannot report
 *     per-post (`follows`, `saves`) — distinct from a real `0`.
 *   - Validation rejects negative counts, non-integer counts,
 *     out-of-range percentages, and malformed/unparseable dates — each
 *     with `TikTokHandEntryValidationError`.
 *   - Hand-entered rows upsert idempotently alongside Instagram/YouTube
 *     rows already present in the same dated file (same
 *     `upsertMetricsRow` keying `collect.ts` relies on).
 */

import { describe, expect, it } from 'vitest';

import {
	TikTokHandEntryValidationError,
	buildTikTokMetricsRow,
	recordTikTokHandEntry,
	validateHandEnteredTikTokMetrics,
	type HandEnteredTikTokMetrics
} from '../tiktok-manual.js';
import type { MetricsRow } from '../schema.js';

function validInput(overrides: Partial<HandEnteredTikTokMetrics> = {}): HandEnteredTikTokMetrics {
	return {
		postId: 'tiktok-video-1',
		publishedAt: '2026-09-01T12:00:00.000Z',
		views: 1000,
		likes: 50,
		comments: 5,
		shares: 3,
		collectedAt: '2026-09-02T00:00:00.000Z',
		...overrides
	};
}

describe('buildTikTokMetricsRow — valid hand entry', () => {
	it('produces a correct MetricsRow with platform: tiktok', () => {
		const row = buildTikTokMetricsRow(validInput());
		expect(row).toEqual<MetricsRow>({
			platform: 'tiktok',
			postId: 'tiktok-video-1',
			format: 'wall',
			publishedAt: '2026-09-01T12:00:00.000Z',
			views: 1000,
			averagePercentWatched: null,
			likes: 50,
			comments: 5,
			shares: 3,
			saves: null,
			follows: null,
			collectedAt: '2026-09-02T00:00:00.000Z'
		});
	});

	it('carries a real number for shares — TikTok is not YouTube', () => {
		const row = buildTikTokMetricsRow(validInput({ shares: 42 }));
		expect(row.shares).toBe(42);
	});

	it('accepts an optional averagePercentWatched override within range', () => {
		const row = buildTikTokMetricsRow(validInput({ averagePercentWatched: 63.5 }));
		expect(row.averagePercentWatched).toBe(63.5);
	});

	it('treats explicit null averagePercentWatched the same as omitting it', () => {
		const row = buildTikTokMetricsRow(validInput({ averagePercentWatched: null }));
		expect(row.averagePercentWatched).toBeNull();
	});

	it('allows a real zero count without collapsing it into null', () => {
		const row = buildTikTokMetricsRow(validInput({ shares: 0 }));
		expect(row.shares).toBe(0);
		expect(row.shares).not.toBeNull();
	});
});

describe('TikTok rows — null where the platform genuinely cannot report per-post', () => {
	it('always sets follows to null — no TikTok read path attributes follows per video', () => {
		const row = buildTikTokMetricsRow(validInput());
		expect(row.follows).toBeNull();
	});

	it('always sets saves to null — not one of the four hand-readable counts', () => {
		const row = buildTikTokMetricsRow(validInput());
		expect(row.saves).toBeNull();
	});

	it('null is distinct from a real 0 across every nullable field', () => {
		const row = buildTikTokMetricsRow(validInput({ views: 0, likes: 0, comments: 0, shares: 0 }));
		// The four hand-read counts really are zero...
		expect(row.views).toBe(0);
		expect(row.likes).toBe(0);
		expect(row.comments).toBe(0);
		expect(row.shares).toBe(0);
		// ...while the genuinely-unavailable fields remain null, not 0.
		expect(row.follows).toBeNull();
		expect(row.saves).toBeNull();
		expect(row.averagePercentWatched).toBeNull();
	});
});

describe('validateHandEnteredTikTokMetrics — fails loudly on a typo', () => {
	it('rejects an empty postId', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ postId: '' }))).toThrow(TikTokHandEntryValidationError);
	});

	it.each(['views', 'likes', 'comments', 'shares'] as const)('rejects a negative %s', (field) => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ [field]: -1 }))).toThrow(TikTokHandEntryValidationError);
	});

	it.each(['views', 'likes', 'comments', 'shares'] as const)('rejects a non-integer %s', (field) => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ [field]: 1.5 }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects a NaN count', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ views: Number.NaN }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects an out-of-range averagePercentWatched above 100', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ averagePercentWatched: 101 }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects a negative averagePercentWatched', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ averagePercentWatched: -0.1 }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects a malformed publishedAt', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ publishedAt: 'not-a-date' }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects an empty publishedAt', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ publishedAt: '' }))).toThrow(TikTokHandEntryValidationError);
	});

	it('rejects a malformed collectedAt', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput({ collectedAt: '2026-13-45' }))).toThrow(TikTokHandEntryValidationError);
	});

	it('accepts a fully valid entry without throwing', () => {
		expect(() => validateHandEnteredTikTokMetrics(validInput())).not.toThrow();
	});

	it('never reaches buildTikTokMetricsRow with a bad row — invalid input throws before any row is built', () => {
		expect(() => buildTikTokMetricsRow(validInput({ views: -5 }))).toThrow(TikTokHandEntryValidationError);
	});
});

describe('recordTikTokHandEntry — idempotent upsert alongside other platforms\' rows', () => {
	const instagramRow: MetricsRow = {
		platform: 'instagram',
		postId: 'ig-1',
		format: 'wall',
		publishedAt: '2026-09-01T09:00:00.000Z',
		views: 200,
		averagePercentWatched: 55,
		likes: 20,
		comments: 4,
		shares: 2,
		saves: 6,
		follows: null,
		collectedAt: '2026-09-02T00:00:00.000Z'
	};

	const youtubeRow: MetricsRow = {
		platform: 'youtube',
		postId: 'yt-1',
		format: 'wall',
		publishedAt: '2026-09-01T10:00:00.000Z',
		views: 300,
		averagePercentWatched: 60,
		likes: 30,
		comments: 6,
		shares: null,
		saves: null,
		follows: 2,
		collectedAt: '2026-09-02T00:00:00.000Z'
	};

	it('adds a TikTok row alongside existing Instagram and YouTube rows in the same file', () => {
		const updated = recordTikTokHandEntry([instagramRow, youtubeRow], validInput());

		expect(updated).toHaveLength(3);
		const platforms = updated.map((row) => row.platform).sort();
		expect(platforms).toEqual(['instagram', 'tiktok', 'youtube']);
	});

	it('re-entering the same postId replaces the row rather than duplicating it', () => {
		const first = recordTikTokHandEntry([instagramRow, youtubeRow], validInput({ views: 1000 }));
		const second = recordTikTokHandEntry(first, validInput({ views: 1234 }));

		expect(second).toHaveLength(3);
		const tiktokRow = second.find((row) => row.platform === 'tiktok');
		expect(tiktokRow?.views).toBe(1234);
	});

	it('a correction to shares/likes mid-session updates in place, not appended', () => {
		const first = recordTikTokHandEntry([], validInput({ likes: 10 }));
		const corrected = recordTikTokHandEntry(first, validInput({ likes: 11 }));

		expect(corrected).toHaveLength(1);
		expect(corrected[0].likes).toBe(11);
	});

	it('two different TikTok posts both persist as separate rows', () => {
		const afterFirst = recordTikTokHandEntry([], validInput({ postId: 'tiktok-video-1' }));
		const afterSecond = recordTikTokHandEntry(afterFirst, validInput({ postId: 'tiktok-video-2' }));

		expect(afterSecond).toHaveLength(2);
		expect(afterSecond.map((row) => row.postId).sort()).toEqual(['tiktok-video-1', 'tiktok-video-2']);
	});

	it('does not mutate the existing rows array passed in', () => {
		const existing = [instagramRow];
		const existingCopy = [...existing];
		recordTikTokHandEntry(existing, validInput());
		expect(existing).toEqual(existingCopy);
	});
});
