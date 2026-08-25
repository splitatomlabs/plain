import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import {
	computeKaraokeWordTimings,
	computeWallLayout,
	computeWallTiming,
	wallScaleAtFrame,
	splitWords,
	FPS,
	FRAMES_PER_WORD,
	KARAOKE_WPM,
	WALL_FRAMES,
	WALL_MIN_FRAMES,
	WALL_MAX_FRAMES,
	WALL_LINE_HEIGHT_RATIO,
	WALL_MIN_FILL_RATIO,
	LANDING_LINE_FRAMES,
	DEFAULT_LINE_FRAMES,
	type NarrationLineTiming
} from '../wall-timing.js';
import { MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

// --- Real >=150-word fixture, straight out of content/output ---------------
// meditations-07-031 is 150 words per content/social/premises/wall.json.

interface Card {
	id: string;
	plain_english: string;
	original_excerpt: string;
	author_slug: 'epictetus' | 'marcus-aurelius' | 'seneca';
}

function loadFixtureCard(): Card {
	const chapter = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'output', 'meditations', 'book-07.json'), 'utf-8')
	) as Card[];
	const card = chapter.find((c) => c.id === 'meditations-07-031');
	if (!card) {
		throw new Error('Fixture card meditations-07-031 not found in content/output/meditations/book-07.json');
	}
	return card;
}

const FIXTURE_CARD = loadFixtureCard();
const FIXTURE_LANDING_LINE = 'Here is the truth, men of Athens.';

// Every sentence of the plain passage except the landing line, in order —
// mirrors what an upstream assembly step (see plan T05/T13) would hand the
// composition as `plainLines`.
const FIXTURE_PLAIN_LINES = FIXTURE_CARD.plain_english
	.split(/(?<=[.?!])\s+(?=[A-Z'])/)
	.filter((line) => line.trim() !== FIXTURE_LANDING_LINE);

describe('fixture sanity', () => {
	it('the fixture card clears the 150-word Wall floor', () => {
		expect(splitWords(FIXTURE_CARD.original_excerpt).length).toBeGreaterThanOrEqual(150);
	});

	it('the landing line was actually removed from the rest of the passage', () => {
		expect(FIXTURE_PLAIN_LINES).not.toContain(FIXTURE_LANDING_LINE);
		expect(FIXTURE_PLAIN_LINES.length).toBeGreaterThan(0);
	});
});

describe('phase 1 — the wall phase length is fixed, not derived from word count', () => {
	it('WALL_FRAMES sits inside the mandated [2s, 3s] window', () => {
		expect(WALL_FRAMES).toBeGreaterThanOrEqual(WALL_MIN_FRAMES);
		expect(WALL_FRAMES).toBeLessThanOrEqual(WALL_MAX_FRAMES);
	});

	it('is the same regardless of excerpt length — short and long inputs alike', () => {
		const short = computeWallTiming({ originalExcerpt: 'one two three', plainLines: [] });
		const long = computeWallTiming({
			originalExcerpt: Array.from({ length: 600 }, (_, i) => `word${i}`).join(' '),
			plainLines: []
		});
		expect(short.wall.endFrame).toBe(WALL_FRAMES);
		expect(long.wall.endFrame).toBe(WALL_FRAMES);
	});

	it('KARAOKE_WPM is exported as the documented named constant', () => {
		expect(KARAOKE_WPM).toBe(320);
	});
});

describe('the hard cut and the landing line hold', () => {
	const timing = computeWallTiming({
		originalExcerpt: FIXTURE_CARD.original_excerpt,
		plainLines: FIXTURE_PLAIN_LINES
	});

	it('the wall phase is marked as moving (not motionless)', () => {
		expect(timing.wall.motionless).toBe(false);
	});

	it('the landing line window starts exactly where the wall phase ends — a hard cut, no overlap', () => {
		expect(timing.landingLine.startFrame).toBe(timing.wall.endFrame);
	});

	it('the landing line is held motionless for a full 3s (>=90 frames)', () => {
		expect(timing.landingLine.motionless).toBe(true);
		const holdFrames = timing.landingLine.endFrame - timing.landingLine.startFrame;
		expect(holdFrames).toBeGreaterThanOrEqual(90);
		expect(LANDING_LINE_FRAMES).toBeGreaterThanOrEqual(90);
	});

	it('every rest-of-passage line is motionless and lines never overlap', () => {
		for (const line of timing.restLines) {
			expect(line.motionless).toBe(true);
			expect(line.endFrame).toBeGreaterThan(line.startFrame);
		}
		for (let i = 1; i < timing.restLines.length; i++) {
			expect(timing.restLines[i].startFrame).toBe(timing.restLines[i - 1].endFrame);
		}
	});

	it('the first rest line starts exactly where the landing line hold ends', () => {
		if (timing.restLines.length > 0) {
			expect(timing.restLines[0].startFrame).toBe(timing.landingLine.endFrame);
		}
	});

	it('respects supplied narration timings instead of the default per-line duration', () => {
		const narrationTimings: NarrationLineTiming[] = FIXTURE_PLAIN_LINES.map((_, i) => ({
			startSeconds: i * 2,
			endSeconds: i * 2 + 1.5
		}));
		const withNarration = computeWallTiming({
			originalExcerpt: FIXTURE_CARD.original_excerpt,
			plainLines: FIXTURE_PLAIN_LINES,
			narrationTimings
		});
		const expectedFrames = Math.round(1.5 * FPS);
		expect(withNarration.restLines[0].endFrame - withNarration.restLines[0].startFrame).toBe(expectedFrames);
	});
});

describe('T18 — the composed total clears the 15s MP4 duration floor', () => {
	it('a short card (no plainLines) is padded up to MIN_POST_DURATION_FRAMES by extending the landing line hold', () => {
		const timing = computeWallTiming({ originalExcerpt: 'one two three', plainLines: [] });
		expect(timing.restLines.length).toBe(0);
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
		expect(timing.wall.endFrame - timing.wall.startFrame).toBe(WALL_FRAMES);
		expect(timing.landingLine.endFrame - timing.landingLine.startFrame).toBeGreaterThan(LANDING_LINE_FRAMES);
		expect(timing.landingLine.motionless).toBe(true);
		expect(timing.totalFrames).toBe(timing.landingLine.endFrame);
	});

	it('a real >=150-word card with several rest lines already clears the floor without any padding', () => {
		const timing = computeWallTiming({
			originalExcerpt: FIXTURE_CARD.original_excerpt,
			plainLines: FIXTURE_PLAIN_LINES
		});
		expect(timing.restLines.length).toBeGreaterThan(0);
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBe(timing.restLines[timing.restLines.length - 1].endFrame);
	});

	it('when padding a card WITH rest lines, only the LAST rest line is extended', () => {
		const shortLines = ['A short first line.', 'A short second line.'];
		const timing = computeWallTiming({ originalExcerpt: 'one two three', plainLines: shortLines });
		expect(timing.restLines.length).toBe(2);
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		// The first rest line keeps its default duration; only the final one grows.
		expect(timing.restLines[0].endFrame - timing.restLines[0].startFrame).toBe(DEFAULT_LINE_FRAMES);
		expect(timing.restLines[1].endFrame - timing.restLines[1].startFrame).toBeGreaterThanOrEqual(DEFAULT_LINE_FRAMES);
		expect(timing.totalFrames).toBe(timing.restLines[1].endFrame);
	});
});

describe('frame 0 push-in', () => {
	it('scale at frame 0 is strictly greater than the rest scale (1.0) and still increasing', () => {
		const restScale = 1.0;
		const scaleAtZero = wallScaleAtFrame(0, WALL_FRAMES);
		const scaleAtOne = wallScaleAtFrame(1, WALL_FRAMES);

		expect(scaleAtZero).toBeGreaterThan(restScale);
		expect(scaleAtOne).toBeGreaterThan(scaleAtZero);
	});
});

describe('karaoke sweep — rate is authoritative, coverage is not', () => {
	it('advances at exactly KARAOKE_WPM (within one frame of rounding tolerance), starting at word 0', () => {
		const timings = computeKaraokeWordTimings(FIXTURE_CARD.original_excerpt);
		expect(timings[0].startFrame).toBeLessThanOrEqual(1);

		for (let i = 0; i < timings.length; i++) {
			const expectedStart = i * FRAMES_PER_WORD;
			expect(Math.abs(timings[i].startFrame - expectedStart)).toBeLessThanOrEqual(1);
		}
	});

	it('for a >=150-word excerpt, strictly fewer than a quarter of the words are highlighted by the cut', () => {
		const timing = computeWallTiming({
			originalExcerpt: FIXTURE_CARD.original_excerpt,
			plainLines: FIXTURE_PLAIN_LINES
		});
		expect(timing.karaoke.length).toBe(splitWords(FIXTURE_CARD.original_excerpt).length);

		const highlightedByCut = timing.karaoke.filter((w) => w.startFrame < timing.wall.endFrame).length;
		expect(highlightedByCut).toBeLessThan(timing.karaoke.length / 4);
	});
});

describe('the wall packs edge to edge — regression guard for the layout defects', () => {
	const layout = computeWallLayout(FIXTURE_CARD.original_excerpt);

	it('really does fill the frame vertically (fillRatio >= 0.9)', () => {
		expect(layout.fillRatio).toBeGreaterThanOrEqual(WALL_MIN_FILL_RATIO);
		expect(layout.fillRatio).toBeGreaterThanOrEqual(0.9);
	});

	it('reads as small, dense type — many short lines (estimatedLines >= 20)', () => {
		expect(layout.estimatedLines).toBeGreaterThanOrEqual(20);
	});

	it('uses a tight line height (<= 1.3), not comfortable reading spacing', () => {
		expect(WALL_LINE_HEIGHT_RATIO).toBeLessThanOrEqual(1.3);
	});

	it('the push-in can never clip a glyph — the inset always exceeds the max crop', () => {
		expect(layout.maxCropPx).toBeLessThan(layout.insetPx);
	});
});

describe('source guard — no overshoot easing anywhere in Wall.tsx', () => {
	const wallSource = readFileSync(path.join(moduleDir, '..', 'Wall.tsx'), 'utf-8');

	it('never calls spring(', () => {
		expect(wallSource).not.toMatch(/\bspring\s*\(/);
	});

	it('never uses Easing.back, Easing.elastic, or Easing.bounce', () => {
		expect(wallSource).not.toMatch(/Easing\.back/);
		expect(wallSource).not.toMatch(/Easing\.elastic/);
		expect(wallSource).not.toMatch(/Easing\.bounce/);
	});
});

describe('end-to-end smoke: renders real still frames at the key boundaries', () => {
	it(
		'renders frame 0, mid-wall, the last wall frame, and the first payoff frame, each at 1080x1920',
		async () => {
			const timing = computeWallTiming({
				originalExcerpt: FIXTURE_CARD.original_excerpt,
				plainLines: FIXTURE_PLAIN_LINES
			});

			const inputProps = {
				originalExcerpt: FIXTURE_CARD.original_excerpt,
				landingLine: FIXTURE_LANDING_LINE,
				plainLines: FIXTURE_PLAIN_LINES,
				author: FIXTURE_CARD.author_slug
			};

			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				// Source imports use explicit `.js` extensions (required by the
				// `NodeNext` module resolution in tsconfig.json), which point at
				// the `.ts`/`.tsx` files webpack actually needs to bundle — map
				// that alias so webpack resolves them.
				webpackOverride: (config) => ({
					...config,
					resolve: {
						...config.resolve,
						extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
					}
				})
			});

			const composition = await selectComposition({
				serveUrl: bundleLocation,
				id: 'Wall',
				inputProps
			});

			const framesToCheck = [0, Math.floor(timing.wall.endFrame / 2), timing.wall.endFrame - 1, timing.wall.endFrame];

			for (const frame of framesToCheck) {
				const outPath = path.join(os.tmpdir(), `plain-wall-still-${frame}-${Date.now()}.png`);
				await renderStill({
					composition,
					serveUrl: bundleLocation,
					output: outPath,
					frame,
					inputProps,
					imageFormat: 'png'
				});

				const buf = readFileSync(outPath);
				expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
				expect(buf.readUInt32BE(16)).toBe(1080);
				expect(buf.readUInt32BE(20)).toBe(1920);
			}
		},
		120_000
	);
});
