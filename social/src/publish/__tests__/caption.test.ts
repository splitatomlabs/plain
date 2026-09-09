import { describe, expect, it } from 'vitest';

import { ATTRIBUTION_URLS, HASHTAGS, buildCaption } from '../caption.js';
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
