import { describe, expect, it } from 'vitest';

import { ATTRIBUTION_URLS, HASHTAGS, YOUTUBE_TITLE_MAX_LENGTH, buildCaption, buildYouTubeTitle } from '../caption.js';
import type { ScheduleSlot } from '../../schedule-types.js';

const SLOT: ScheduleSlot = {
	day: 1,
	card_id: 'meditations-09-025',
	book_slug: 'meditations',
	author_slug: 'marcus-aurelius',
	content: {
		format: 'wall',
		original_excerpt: 'Of an operation and of a purpose there is an ending...',
		landing_line: 'Every action has an end.'
	}
};

describe('ATTRIBUTION_URLS', () => {
	it('matches the T11 attribution slugs exactly', () => {
		expect(ATTRIBUTION_URLS.tiktok).toBe('https://thinkplain.ai/go/tt');
		expect(ATTRIBUTION_URLS.instagram).toBe('https://thinkplain.ai/go/ig');
		expect(ATTRIBUTION_URLS.youtube).toBe('https://thinkplain.ai/go/yt');
	});
});

describe('buildCaption', () => {
	it('contains the landing line verbatim', () => {
		const caption = buildCaption({ slot: SLOT, platform: 'tiktok' });
		expect(caption).toContain('Every action has an end.');
	});

	it('contains the author and book, human-readable', () => {
		const caption = buildCaption({ slot: SLOT, platform: 'tiktok' });
		expect(caption).toContain('Marcus Aurelius');
		expect(caption).toContain('Meditations');
	});

	it.each([
		['tiktok', 'https://thinkplain.ai/go/tt'],
		['instagram', 'https://thinkplain.ai/go/ig'],
		['youtube', 'https://thinkplain.ai/go/yt']
	] as const)('uses the %s attribution link', (platform, url) => {
		const caption = buildCaption({ slot: SLOT, platform });
		expect(caption).toContain(url);
	});

	it('never mixes attribution links across platforms', () => {
		const tiktokCaption = buildCaption({ slot: SLOT, platform: 'tiktok' });
		expect(tiktokCaption).not.toContain(ATTRIBUTION_URLS.instagram);
		expect(tiktokCaption).not.toContain(ATTRIBUTION_URLS.youtube);
	});

	it('includes the fixed hashtag set and never #Shorts', () => {
		const caption = buildCaption({ slot: SLOT, platform: 'youtube' });
		expect(caption).toContain(HASHTAGS);
		expect(caption).not.toMatch(/#Shorts/i);
	});

	it('never attributes the framing text to the author (no quotation marks around the byline)', () => {
		const caption = buildCaption({ slot: SLOT, platform: 'tiktok' });
		expect(caption).not.toMatch(/"—\s*Marcus Aurelius/);
	});

	it('avoids hype punctuation and emoji-stacking', () => {
		const caption = buildCaption({ slot: SLOT, platform: 'tiktok' });
		expect(caption).not.toMatch(/!!!|🔥|😱|👀/u);
	});

	it('is deterministic for the same input', () => {
		const first = buildCaption({ slot: SLOT, platform: 'instagram' });
		const second = buildCaption({ slot: SLOT, platform: 'instagram' });
		expect(first).toBe(second);
	});

	it('falls back to a humanized display name for an unrecognized book or author slug', () => {
		const slot: ScheduleSlot = {
			...SLOT,
			book_slug: 'some-future-book',
			author_slug: 'some-future-author'
		};
		const caption = buildCaption({ slot, platform: 'tiktok' });
		expect(caption).toContain('Some Future Book');
		expect(caption).toContain('Some Future Author');
	});

	it('produces distinct captions for distinct slots', () => {
		const other: ScheduleSlot = {
			day: 2,
			card_id: 'on-anger-02-054',
			book_slug: 'on-anger',
			author_slug: 'seneca',
			content: {
				format: 'wall',
				original_excerpt: 'Once, a boy...',
				landing_line: "A boy was raised in Plato's household."
			}
		};
		expect(buildCaption({ slot: SLOT, platform: 'tiktok' })).not.toBe(
			buildCaption({ slot: other, platform: 'tiktok' })
		);
	});
});

// ---------------------------------------------------------------------------
// YouTube title — a separate upload field the caption (the description) does
// not cover.
// ---------------------------------------------------------------------------

describe('buildYouTubeTitle', () => {
	/** Builds a slot whose landing line is exactly `length` characters. */
	function slotWithLineLength(length: number): ScheduleSlot {
		return { ...SLOT, content: { ...SLOT.content, landing_line: 'x'.repeat(length) } };
	}

	it('is the landing line, then the author and book', () => {
		expect(buildYouTubeTitle(SLOT)).toBe('Every action has an end. — Marcus Aurelius, Meditations');
	});

	it('leads with the landing line, since the Shorts player truncates the tail', () => {
		expect(buildYouTubeTitle(SLOT).startsWith(SLOT.content.landing_line)).toBe(true);
	});

	it('week 1 day 4 — the real 100-character case — fits exactly, keeping the book', () => {
		const day4: ScheduleSlot = {
			day: 4,
			card_id: 'enchiridion-41-001',
			book_slug: 'enchiridion',
			author_slug: 'epictetus',
			content: {
				format: 'wall',
				original_excerpt: 'It is a mark of a mean capacity...',
				landing_line: "Don't overdo exercise, eating, drinking, or other basic physical needs."
			}
		};
		const title = buildYouTubeTitle(day4);
		expect(title).toBe("Don't overdo exercise, eating, drinking, or other basic physical needs. — Epictetus, The Enchiridion");
		expect(title).toHaveLength(YOUTUBE_TITLE_MAX_LENGTH);
	});

	it('drops the BOOK first when the full form would overflow, keeping the author', () => {
		// Long enough that "— Marcus Aurelius, Meditations" overflows but
		// "— Marcus Aurelius" still fits.
		const slot = slotWithLineLength(80);
		const title = buildYouTubeTitle(slot);
		expect(title).toBe(`${'x'.repeat(80)} — Marcus Aurelius`);
		expect(title.length).toBeLessThanOrEqual(YOUTUBE_TITLE_MAX_LENGTH);
	});

	it('drops the AUTHOR too rather than trimming the quote', () => {
		const slot = slotWithLineLength(95);
		expect(buildYouTubeTitle(slot)).toBe('x'.repeat(95));
	});

	it('NEVER truncates the landing line — an over-long line is returned whole and over the limit', () => {
		// A truncated quote would be a misquote, which Constraint 6 forbids.
		// Failing loudly in the upload form beats silently misquoting.
		const slot = slotWithLineLength(140);
		const title = buildYouTubeTitle(slot);
		expect(title).toBe('x'.repeat(140));
		expect(title.length).toBeGreaterThan(YOUTUBE_TITLE_MAX_LENGTH);
	});

	it('every title contains its landing line verbatim, at every fallback level', () => {
		for (const length of [10, 80, 95, 140]) {
			const slot = slotWithLineLength(length);
			expect(buildYouTubeTitle(slot)).toContain('x'.repeat(length));
		}
	});
});
