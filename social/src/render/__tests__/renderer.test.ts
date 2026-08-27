import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { SIZES, formatForSize, type SizeName } from '../sizes.js';
import { ACCENTS, PAPER, type AuthorSlug } from '../theme.js';
import { fitFontSize } from '../fit.js';
import { buildCardHtml } from '../template.js';
import { renderCard } from '../card.js';
import { readJpegDimensions, readPngDimensions } from './image-dims.js';

// Playwright launches a real browser per render; give these plenty of room.
const RENDER_TIMEOUT_MS = 60_000;

const SHORT_TEXT = 'The obstacle is the way.';

// ~210 words, well past what a story frame can hold at a legible size.
const LONG_SENTENCE =
	'When the archaic wall of moving text finally gives way to stillness, the plain sentence should land like a held breath.';
const LONG_TEXT = Array.from({ length: 10 }, () => LONG_SENTENCE).join(' ');

const AUTHORS: AuthorSlug[] = ['epictetus', 'marcus-aurelius', 'seneca'];

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-render-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

describe('output dimensions', () => {
	it(
		'renders a story-size PNG at exactly 1080x1920',
		async () => {
			await withTempDir(async (dir) => {
				const outPath = path.join(dir, 'story.png');
				const result = await renderCard({
					text: SHORT_TEXT,
					author: 'epictetus',
					size: 'story',
					outPath
				});

				expect(result.format).toBe('png');
				expect(result.width).toBe(SIZES.story.width);
				expect(result.height).toBe(SIZES.story.height);

				const dims = readPngDimensions(result.path);
				expect(dims.width).toBe(1080);
				expect(dims.height).toBe(1920);
			});
		},
		RENDER_TIMEOUT_MS
	);
});

describe('IG feed format', () => {
	it('formatForSize maps story to png and igFeed to jpeg', () => {
		const cases: Array<[SizeName, 'png' | 'jpeg']> = [
			['story', 'png'],
			['igFeed', 'jpeg']
		];
		for (const [size, expected] of cases) {
			expect(formatForSize(size)).toBe(expected);
		}
	});

	it(
		'renders an igFeed-size JPEG at exactly 1080x1350, <=8MB',
		async () => {
			await withTempDir(async (dir) => {
				const outPath = path.join(dir, 'feed.jpg');
				const result = await renderCard({
					text: SHORT_TEXT,
					author: 'seneca',
					size: 'igFeed',
					outPath
				});

				expect(result.format).toBe('jpeg');
				expect(result.width).toBe(SIZES.igFeed.width);
				expect(result.height).toBe(SIZES.igFeed.height);

				const eightMb = 8 * 1024 * 1024;
				expect(result.bytes).toBeLessThanOrEqual(eightMb);

				const fileStat = await stat(result.path);
				expect(fileStat.size).toBeLessThanOrEqual(eightMb);

				const header = (await readFile(result.path)).subarray(0, 3);
				expect(Array.from(header)).toEqual([0xff, 0xd8, 0xff]);

				const dims = readJpegDimensions(result.path);
				expect(dims.width).toBe(1080);
				expect(dims.height).toBe(1350);
			});
		},
		RENDER_TIMEOUT_MS
	);
});

describe('long text shrinks rather than overflows', () => {
	const box = { maxWidth: 900, maxHeight: 1400, minFont: 24, maxFont: 96 };

	it('fitFontSize picks a strictly smaller size for a long passage than a short line', () => {
		const shortResult = fitFontSize(SHORT_TEXT, box);
		const longResult = fitFontSize(LONG_TEXT, box);

		expect(longResult.fontSize).toBeLessThan(shortResult.fontSize);
	});

	it('never returns a size below minFont, and reports fits:false rather than overflowing', () => {
		const impossibleText = Array.from({ length: 2000 }, (_, i) => `unbreakable-word-${i}`).join(' ');
		const result = fitFontSize(impossibleText, {
			maxWidth: 100,
			maxHeight: 100,
			minFont: 24,
			maxFont: 96
		});

		expect(result.fontSize).toBeGreaterThanOrEqual(24);
		expect(result.fits).toBe(false);
	});

	it(
		'end-to-end: a long card renders with a smaller fontSize than a short card',
		async () => {
			await withTempDir(async (dir) => {
				const shortResult = await renderCard({
					text: SHORT_TEXT,
					author: 'marcus-aurelius',
					size: 'story',
					outPath: path.join(dir, 'short.png')
				});
				const longResult = await renderCard({
					text: LONG_TEXT,
					author: 'marcus-aurelius',
					size: 'story',
					outPath: path.join(dir, 'long.png')
				});

				expect(longResult.fontSize).toBeLessThan(shortResult.fontSize);
			});
		},
		RENDER_TIMEOUT_MS * 2
	);
});

describe('accent per author', () => {
	it.each(AUTHORS)('buildCardHtml for %s contains its own accent and the paper background', (author) => {
		const html = buildCardHtml({
			text: SHORT_TEXT,
			author,
			width: SIZES.story.width,
			height: SIZES.story.height
		}).toLowerCase();

		expect(html).toContain(ACCENTS[author].toLowerCase());
		expect(html).toContain(PAPER.toLowerCase());
	});

	it.each(AUTHORS)('buildCardHtml for %s contains neither of the other two accents', (author) => {
		const html = buildCardHtml({
			text: SHORT_TEXT,
			author,
			width: SIZES.story.width,
			height: SIZES.story.height
		}).toLowerCase();

		const otherAuthors = AUTHORS.filter((candidate) => candidate !== author);
		for (const other of otherAuthors) {
			expect(html).not.toContain(ACCENTS[other].toLowerCase());
		}
	});
});
