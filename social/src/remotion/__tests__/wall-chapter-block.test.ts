/**
 * social pilot 02a T09: `Wall.tsx` renders the moving wall phase from the
 * CHAPTER-sourced block (`WallProps.chapterBlock`,
 * `social/src/render/chapter-text.ts`), not just the single card's own
 * excerpt. This is an END-TO-END proof against a REAL rendered frame (real
 * Remotion bundle, real font, real card from `content/output/`) — reuses
 * the exact `bundle` + `selectComposition` + `renderStill` + `pngjs`
 * machinery `counter.test.ts` already established, rather than inventing a
 * second way to render a frame for a test.
 *
 * What must hold:
 *   1. Frame 0 (before any scroll — `wallScrollOffsetAtFrame(0)` is exactly
 *      0) shows this card's OWN first words at the top of the frame, same
 *      as before `chapterBlock` existed — chapter-sourcing must never
 *      change what frame 0 opens on.
 *   2. The block below that is CONTINUOUS, chapter-sourced text — visibly
 *      more content than the card's own excerpt alone would produce, not a
 *      blank/repeat/truncation.
 *
 * The proof is pixel-based, not text-based (Remotion renders to a canvas,
 * not a DOM tree a test can inspect for text content): render frame 0 twice,
 * once with `chapterBlock` omitted (the pre-T09 shape — the wall phase
 * falls back to `originalExcerpt` alone) and once with the real
 * chapter-sourced block, and compare the two PNGs directly.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PNG } from 'pngjs';

import { loadOutputCard } from '../wall-pool.js';
import { loadChapterTextBlock } from '../../render/chapter-text.js';
import { PAPER } from '../../render/theme.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

// The exact same real card `cli.test.ts` renders end-to-end (day 6, slot 1
// of the committed week-1 schedule) — a real Wall read-through slot whose
// landing line is a genuine (non-whole-passage) substring, so it's a
// realistic, already-load-bearing fixture rather than a novel pick.
const READ_THROUGH_BOOK = 'meditations';
const CARD_ID = 'meditations-02-006';
const CARD = loadOutputCard(READ_THROUGH_BOOK, CARD_ID, outputDir);
// This card's own landing line, from the committed schedule
// (`content/social/pilot-schedule-w01.json`, day 6 slot 1) — hardcoded here
// (rather than re-parsing the schedule) since this test only needs SOME
// valid landing line under `WALL_LANDING_LINE_MAX_WORDS`, not the schedule
// machinery itself.
const LANDING_LINE = 'Theophrastus compares different types of wrongdoing.';

const CHAPTER_BLOCK = loadChapterTextBlock(READ_THROUGH_BOOK, CARD_ID, outputDir);

let bundleDir: string;
let bundleLocation: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-wall-chapter-test-bundle-'));
	bundleLocation = await bundle({
		entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
		outDir: bundleDir,
		webpackOverride: (config) => ({
			...config,
			resolve: {
				...config.resolve,
				extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
			}
		})
	});
}, 60_000);

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});

async function renderWallFrame0(chapterBlock: string | undefined): Promise<PNG> {
	const inputProps: Record<string, unknown> = {
		originalExcerpt: CARD.original_excerpt,
		landingLine: LANDING_LINE,
		// A single short rest line — this test never reaches phase 2/3, but
		// `assertWallCardRenderable` (called inside `Wall.tsx` before phase 1
		// renders) needs a computable, in-bounds duration.
		plainLines: ['A short rest line.'],
		author: 'marcus-aurelius',
		...(chapterBlock !== undefined ? { chapterBlock } : {})
	};
	const composition = await selectComposition({ serveUrl: bundleLocation, id: 'Wall', inputProps });
	const outPath = path.join(
		os.tmpdir(),
		`plain-wall-chapter-${chapterBlock ? 'full' : 'alone'}-${Math.random().toString(36).slice(2)}.png`
	);
	await renderStill({ composition, serveUrl: bundleLocation, output: outPath, frame: 0, inputProps, imageFormat: 'png' });
	return PNG.sync.read(await readFile(outPath));
}

const PAPER_RGB = [
	parseInt(PAPER.slice(1, 3), 16),
	parseInt(PAPER.slice(3, 5), 16),
	parseInt(PAPER.slice(5, 7), 16)
];

/** A pixel counts as "ink" (part of some glyph, including AA fringing) once it deviates meaningfully from the paper background. */
function isInkPixel(png: PNG, x: number, y: number): boolean {
	const idx = (png.width * y + x) << 2;
	const diff =
		Math.abs(png.data[idx] - PAPER_RGB[0]) +
		Math.abs(png.data[idx + 1] - PAPER_RGB[1]) +
		Math.abs(png.data[idx + 2] - PAPER_RGB[2]);
	return diff > 30;
}

function rowHasInk(png: PNG, y: number): boolean {
	for (let x = 0; x < png.width; x++) {
		if (isInkPixel(png, x, y)) return true;
	}
	return false;
}

/** The last (bottom-most) row containing any glyph ink — `-1` if the frame is entirely blank. */
function lastInkRow(png: PNG): number {
	for (let y = png.height - 1; y >= 0; y--) {
		if (rowHasInk(png, y)) return y;
	}
	return -1;
}

describe('Wall.tsx — chapter-sourced block wiring (social pilot 02a T09), real card meditations-02-006', () => {
	it('sanity: the real chapter block starts with this card\'s own excerpt and is far longer than it alone', () => {
		// Already the subject of chapter-text.test.ts's own dedicated coverage
		// — restated here only as a precondition for the render assertions
		// below, so a failure here points at chapter-text.ts, not this file.
		expect(CHAPTER_BLOCK.startsWith(CARD.original_excerpt)).toBe(true);
		const excerptWords = CARD.original_excerpt.split(/\s+/).filter(Boolean).length;
		const blockWords = CHAPTER_BLOCK.split(/\s+/).filter(Boolean).length;
		expect(blockWords).toBeGreaterThan(excerptWords * 5);
	});

	it(
		'frame 0 rendered with the real chapter block still shows this card\'s own first words at the top ' +
			'(pixel-identical to a render of the card\'s own excerpt alone, everywhere the excerpt-alone render has ink)',
		async () => {
			const alone = await renderWallFrame0(undefined);
			const full = await renderWallFrame0(CHAPTER_BLOCK);

			expect(alone.width).toBe(full.width);
			expect(alone.height).toBe(full.height);

			const aloneLastInk = lastInkRow(alone);
			// This card's own 157-word excerpt must not fill the whole
			// 1920px-tall frame on its own — otherwise this test could not
			// distinguish "frame 0 is the excerpt" from "frame 0 is the whole
			// chapter" by comparing top regions. (Confirmed by direct
			// measurement: it fills to ~1156px, not 1920.)
			expect(aloneLastInk).toBeGreaterThan(0);
			expect(aloneLastInk).toBeLessThan(alone.height - 100);

			// Every row from the top down through the excerpt-alone render's
			// own last line of ink must be BYTE-IDENTICAL between the two
			// renders — i.e. chapter-sourcing changes nothing about what
			// frame 0 opens on. (Direct measurement confirms the two renders
			// first diverge only ~10px after this boundary — deep inside the
			// wrap-boundary line where the excerpt's own last words and the
			// next chapter card's first words share a line — so comparing up
			// to and including `aloneLastInk` itself is safe, not just "close
			// enough".)
			const { width } = alone;
			for (let y = 0; y <= aloneLastInk; y++) {
				for (let x = 0; x < width; x++) {
					const idx = (width * y + x) << 2;
					for (let channel = 0; channel < 4; channel++) {
						const a = alone.data[idx + channel];
						const b = full.data[idx + channel];
						if (a !== b) {
							throw new Error(
								`Pixel (${x}, ${y}) channel ${channel} differs between the excerpt-alone render ` +
									`(${a}) and the chapter-block render (${b}), inside the region that should be ` +
									`identical (rows 0-${aloneLastInk}). Chapter-sourcing must never change what ` +
									'frame 0 opens on.'
							);
						}
					}
				}
			}
		},
		30_000
	);

	it(
		'the block below the card\'s own excerpt is continuous chapter text, not blank space — the ' +
			'chapter-block render has ink well past where the excerpt-alone render runs out',
		async () => {
			const alone = await renderWallFrame0(undefined);
			const full = await renderWallFrame0(CHAPTER_BLOCK);

			const aloneLastInk = lastInkRow(alone);
			const margin = 40; // clear of the wrap-boundary line the two renders may legitimately differ on
			const checkRow = Math.min(alone.height - 1, aloneLastInk + margin);

			// The excerpt alone has no ink this far down the frame...
			expect(rowHasInk(alone, checkRow)).toBe(false);
			// ...but the chapter-sourced block does, and in fact runs to (or
			// past) the bottom of the frame, since a 2,196-word chapter block
			// at 44px/4.5-lines-per-second easily clears far more than one
			// screen height — confirming the wall keeps scrolling through
			// real, continuing chapter text rather than stopping where this
			// one card's excerpt ends.
			expect(rowHasInk(full, checkRow)).toBe(true);
			expect(rowHasInk(full, full.height - 1)).toBe(true);
		},
		30_000
	);
});
