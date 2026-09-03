/**
 * Tests for `../job-plan.ts` (Pf39c2-social-pilot-03 T08) — the pure
 * decision logic `job.ts`'s orchestration relies on. No I/O, no network, no
 * clock reads inside the module under test.
 */

import { describe, expect, it } from 'vitest';

import {
	YOUTUBE_TITLE_MAX_LENGTH,
	buildInstagramCaption,
	buildYouTubeDescription,
	buildYouTubeTitle,
	errorMessage,
	exitCodeForOutcomes,
	formatExpiryAlertLine,
	formatOutcomeLine,
	parsePendingFlips,
	serializePendingFlips,
	upsertPendingFlip,
	type PlatformOutcome
} from '../job-plan.js';
import type { PendingYouTubeFlip } from '../publish/tiktok-manual.js';
import type { TokenExpiryAlert } from '../publish/tokens.js';
import type { ScheduleSlot } from '../schedule-types.js';

const SLOT: ScheduleSlot = {
	day: 1,
	card_id: 'meditations-09-025',
	book_slug: 'meditations',
	author_slug: 'marcus-aurelius',
	content: { format: 'wall', original_excerpt: 'The excerpt.', landing_line: 'Every action has an end.' }
};

describe('buildYouTubeTitle', () => {
	it('returns the landing line verbatim when it fits', () => {
		expect(buildYouTubeTitle(SLOT)).toBe('Every action has an end.');
	});

	it('truncates a landing line longer than the YouTube title limit, with an ellipsis', () => {
		const longLine = 'a'.repeat(YOUTUBE_TITLE_MAX_LENGTH + 20);
		const slot: ScheduleSlot = { ...SLOT, content: { ...SLOT.content, landing_line: longLine } };
		const title = buildYouTubeTitle(slot);
		expect(title.length).toBeLessThanOrEqual(YOUTUBE_TITLE_MAX_LENGTH);
		expect(title.endsWith('…')).toBe(true);
	});

	it('is exactly at the limit for a landing line exactly that long', () => {
		const exactLine = 'a'.repeat(YOUTUBE_TITLE_MAX_LENGTH);
		const slot: ScheduleSlot = { ...SLOT, content: { ...SLOT.content, landing_line: exactLine } };
		expect(buildYouTubeTitle(slot)).toBe(exactLine);
	});
});

describe('buildYouTubeDescription / buildInstagramCaption', () => {
	it('both include the landing line and the platform-correct attribution link', () => {
		const description = buildYouTubeDescription(SLOT);
		const caption = buildInstagramCaption(SLOT);
		expect(description).toContain(SLOT.content.landing_line);
		expect(description).toContain('/go/yt');
		expect(caption).toContain(SLOT.content.landing_line);
		expect(caption).toContain('/go/ig');
	});
});

describe('exitCodeForOutcomes', () => {
	it('is 0 when every outcome is ok or dry-run', () => {
		const outcomes: PlatformOutcome[] = [
			{ platform: 'instagram', status: 'ok', message: 'fine' },
			{ platform: 'youtube', status: 'dry-run', message: 'would do x' }
		];
		expect(exitCodeForOutcomes(outcomes)).toBe(0);
	});

	it('is 1 when any outcome failed', () => {
		const outcomes: PlatformOutcome[] = [
			{ platform: 'instagram', status: 'failed', message: 'broke' },
			{ platform: 'youtube', status: 'ok', message: 'fine' }
		];
		expect(exitCodeForOutcomes(outcomes)).toBe(1);
	});

	it('is 1 when any outcome only partially succeeded (M4: an unrecorded YouTube flip is not a clean success)', () => {
		const outcomes: PlatformOutcome[] = [
			{ platform: 'instagram', status: 'ok', message: 'fine' },
			{ platform: 'youtube', status: 'partial', message: 'uploaded but not recorded' }
		];
		expect(exitCodeForOutcomes(outcomes)).toBe(1);
	});
});

describe('formatOutcomeLine / formatExpiryAlertLine', () => {
	it('formats an outcome as [platform] STATUS — message', () => {
		const line = formatOutcomeLine({ platform: 'instagram', status: 'ok', message: 'published media 123' });
		expect(line).toBe('[instagram] OK — published media 123');
	});

	it('formats an expiry alert with the platform, expiry date, and days remaining', () => {
		const alert: TokenExpiryAlert = { platform: 'youtube', expiresAt: '2026-09-20T00:00:00.000Z', daysRemaining: 12.4 };
		const line = formatExpiryAlertLine(alert);
		expect(line).toContain('youtube');
		expect(line).toContain('2026-09-20T00:00:00.000Z');
		expect(line).toContain('12.4');
	});
});

describe('errorMessage', () => {
	it('returns an Error instance\'s message', () => {
		expect(errorMessage(new Error('boom'))).toBe('boom');
	});

	it('stringifies a non-Error value', () => {
		expect(errorMessage('plain string')).toBe('plain string');
		expect(errorMessage(42)).toBe('42');
	});
});

describe('pending YouTube flips', () => {
	const FLIP_A: PendingYouTubeFlip = { date: '2026-09-01', cardId: 'meditations-09-025', videoId: 'yt-1' };
	const FLIP_B: PendingYouTubeFlip = { date: '2026-09-02', cardId: 'on-anger-02-054', videoId: 'yt-2' };

	it('upsertPendingFlip appends a new date and keeps the list sorted', () => {
		const result = upsertPendingFlip([FLIP_B], FLIP_A);
		expect(result).toEqual([FLIP_A, FLIP_B]);
	});

	it('upsertPendingFlip replaces an existing entry for the same date rather than duplicating it', () => {
		const replacement: PendingYouTubeFlip = { ...FLIP_A, videoId: 'yt-1-rerendered' };
		const result = upsertPendingFlip([FLIP_A, FLIP_B], replacement);
		expect(result.filter((f) => f.date === FLIP_A.date)).toHaveLength(1);
		expect(result.find((f) => f.date === FLIP_A.date)?.videoId).toBe('yt-1-rerendered');
	});

	it('parsePendingFlips returns [] for an empty or whitespace-only file', () => {
		expect(parsePendingFlips('')).toEqual([]);
		expect(parsePendingFlips('   \n  ')).toEqual([]);
	});

	it('parsePendingFlips parses a real JSON array', () => {
		expect(parsePendingFlips(JSON.stringify([FLIP_A, FLIP_B]))).toEqual([FLIP_A, FLIP_B]);
	});

	it('parsePendingFlips throws clearly on a non-array JSON value', () => {
		expect(() => parsePendingFlips(JSON.stringify({ not: 'an array' }))).toThrow(/JSON array/);
	});

	it('serializePendingFlips round-trips through parsePendingFlips', () => {
		const flips = [FLIP_A, FLIP_B];
		expect(parsePendingFlips(serializePendingFlips(flips))).toEqual(flips);
	});

	it('serializePendingFlips is newline-terminated pretty-printed JSON', () => {
		const serialized = serializePendingFlips([FLIP_A]);
		expect(serialized.endsWith('\n')).toBe(true);
		expect(serialized).toContain('\n  ');
	});
});
