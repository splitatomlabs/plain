import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import {
	computeWallLayout,
	computeWallTiming,
	wallScrollOffsetAtFrame,
	splitWords,
	FPS,
	FRAME_HEIGHT,
	WALL_FRAMES,
	WALL_MIN_FRAMES,
	WALL_MAX_FRAMES,
	WALL_LINE_HEIGHT_RATIO,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_SCROLL_PX_PER_FRAME,
	WALL_SECONDS,
	LANDING_LINE_FRAMES,
	DEFAULT_LINE_SECONDS,
	DEFAULT_LINE_FRAMES,
	WALL_FONT_SIZE,
	WALL_SCROLL_LINES_PER_SEC,
	type NarrationLineTiming
} from '../wall-timing.js';
import { MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';
import { resolveWallCardExcerpt, loadBookCards, type WallPoolEntry } from '../wall-pool.js';
import { loadChapterTextBlock } from '../../render/chapter-text.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// bundle() defaults to a fresh, never-cleaned-up
// os.tmpdir()/remotion-webpack-bundle-* directory. Bundle into an
// mkdtemp'd directory this file owns and removes in afterAll, so
// running this suite doesn't leak temp directories (social pilot 02 F07).
let bundleDir: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-test-bundle-'));
});

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});
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

// --- The longest real original excerpt in the pool, per WALL_FONT_SIZE's
// own doc comment — used to check the 2-3 screen target and the
// scroll-does-not-finish invariant against more than one real card.
const LONGEST_ENTRY: WallPoolEntry = { card_id: 'discourses-59-004', book_slug: 'discourses' };
const outputDir = path.join(repoRoot, 'content', 'output');
const LONGEST_EXCERPT = resolveWallCardExcerpt(LONGEST_ENTRY, outputDir);

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

// social pilot 02a T03: "shorten the payoff by pacing, not by rejecting
// cards" — DEFAULT_LINE_SECONDS dropped from 3.5s to 3.0s, paired with
// wall-gate.ts's new WALL_MAX_DURATION_SECONDS ceiling (see that file's own
// test coverage for the ceiling side of this change).
describe('social pilot 02a T03 — the payoff pacing fallback', () => {
	it('DEFAULT_LINE_SECONDS is 3.0s, not the pre-T03 3.5s', () => {
		expect(DEFAULT_LINE_SECONDS).toBe(3.0);
	});

	it('DEFAULT_LINE_FRAMES is derived from DEFAULT_LINE_SECONDS at FPS, not hardcoded', () => {
		expect(DEFAULT_LINE_FRAMES).toBe(Math.round(DEFAULT_LINE_SECONDS * FPS));
	});

	it('still clears the house rule\'s >=2.5s motionless-payoff floor, with margin', () => {
		// The house rule: "payoff frame motionless >= 2.5s". 3.0s leaves 0.5s
		// of margin — this is a floor to clear, not a target to sit exactly on.
		expect(DEFAULT_LINE_SECONDS).toBeGreaterThanOrEqual(2.5);
		expect(DEFAULT_LINE_SECONDS).toBeGreaterThan(2.5);
	});

	it('every fallback-timed rest line in a real schedule holds for at least 2.5s (75 frames)', () => {
		const shortLines = ['A short first line.', 'A short second line.', 'A short third line.'];
		const timing = computeWallTiming({ originalExcerpt: 'one two three', plainLines: shortLines });
		const houseRuleFloorFrames = Math.round(2.5 * FPS);
		for (const line of timing.restLines) {
			expect(line.endFrame - line.startFrame).toBeGreaterThanOrEqual(houseRuleFloorFrames);
		}
	});
});

// social pilot 02 F15 (2026-08-26): the wall's motion is now a fixed-rate
// SCROLL, not a push-in zoom with a karaoke highlight — see
// `wall-timing.ts`'s `WALL_SCROLL_RATE_PX_PER_SEC` and `WALL_FONT_SIZE` doc
// comments for the full arithmetic these guards check against a real card.

describe('frame 0 scroll velocity — already in motion, no ease-in', () => {
	it('scroll offset is exactly 0 at frame 0 — the block top sits exactly at the frame top', () => {
		expect(wallScrollOffsetAtFrame(0)).toBe(0);
	});

	it('the frame-0-to-frame-1 delta is EXACTLY WALL_SCROLL_PX_PER_FRAME, not a fraction of it ramping up', () => {
		const offsetAtZero = wallScrollOffsetAtFrame(0);
		const offsetAtOne = wallScrollOffsetAtFrame(1);
		expect(offsetAtOne - offsetAtZero).toBe(WALL_SCROLL_PX_PER_FRAME);
		// Sanity: WALL_SCROLL_PX_PER_FRAME itself is the documented rate/FPS split.
		expect(WALL_SCROLL_PX_PER_FRAME).toBe(WALL_SCROLL_RATE_PX_PER_SEC / FPS);
	});

	it('is linear — the frame-9-to-frame-10 delta is the same per-frame rate', () => {
		const delta = wallScrollOffsetAtFrame(10) - wallScrollOffsetAtFrame(9);
		// F16's rate (500px/s) is NOT an exact multiple of FPS (500/30 ≈
		// 16.667px/frame, unlike F15's 720/30 = 24, a clean integer) — two
		// different floating-point computations (`500 * 10/30 - 500 * 9/30` vs
		// `500 / 30`) can differ in their last representable bit even though
		// they are mathematically identical, so an EXACT `.toBe()` here would
		// be asserting IEEE754 rounding behaviour, not linearity. `toBeCloseTo`
		// at 9 decimal places (1e-9px, far tighter than anything visible in a
		// rendered frame) keeps this a real regression guard without being
		// sensitive to that rounding noise.
		expect(delta).toBeCloseTo(WALL_SCROLL_PX_PER_FRAME, 9);
	});
});

// social pilot 02a T08 (2026-08-26): DELETED four F18-era describe blocks
// that lived here and asserted the per-card fit directly —
// "block geometry at F18 numbers" (fontSize 77/72px on a single card's own
// excerpt), both "fitWallFontSize — a short/long excerpt..." blocks (the
// now-deleted target/floor/cap clamp behavior), and "the scroll does not
// finish before the cut" (F15/F16/F18's version, which asserted the
// invariant against a single card's own excerpt directly — no longer true
// at a fixed 44px font: a single ~150-200 word card's own excerpt does NOT
// clear the new travel floor on its own; only a chapter-sourced block does,
// which is why this coverage was replaced, not merely re-numbered). The
// same invariant, correctly re-derived against chapter-sourced blocks and
// the real read-through slice, lives in the "T07 — the new wall geometry"
// section below ("the scroll never finishes before the cut, BY
// CONSTRUCTION..."). `fitWallFontSize` itself is gone from `wall-timing.ts`
// — `computeWallLayout` no longer searches, it measures once at the fixed
// `WALL_FONT_SIZE`.

// ---------------------------------------------------------------------------
// social pilot 02a T07 — the new wall geometry (TDD, written ahead of T08;
// T08 implements the geometry these tests describe — see `wall-timing.ts`).
//
// The defect these guard against: "the wall reads as a large-print book, not
// a wall" — F18's per-card fit bought travel by magnifying type (block
// height scales with the SQUARE of font size), which is the opposite of the
// dense, small-set look the format wants. T08's fix (see
// `plans/Pf39c2-social-pilot-02a.md`): a FIXED font size (`WALL_FONT_SIZE`,
// 44px, not a per-card fit), a scroll rate expressed in LINES PER SECOND
// (`WALL_SCROLL_LINES_PER_SEC`, ~4.5, derived into px/s from the fixed font
// size — not a bare px/s constant), and the never-finishes invariant
// satisfied BY CONSTRUCTION once the block is chapter-sourced (T05/T06)
// rather than by rejecting short cards on a travel axis.
// ---------------------------------------------------------------------------

describe('social pilot 02a T07 — WALL_FONT_SIZE is FIXED, not fit per card', () => {
	it('WALL_FONT_SIZE is defined and close to the plan\'s ~44px figure (implemented T08)', () => {
		expect(WALL_FONT_SIZE).toBeDefined();
		expect(WALL_FONT_SIZE).toBeGreaterThanOrEqual(40);
		expect(WALL_FONT_SIZE).toBeLessThanOrEqual(48);
	});

	it('computeWallLayout uses the SAME fontSize for a short passage and a long one — no per-card fit', () => {
		const shortExcerpt = 'one two three four five';
		const longExcerpt = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
		const shortLayout = computeWallLayout(shortExcerpt);
		const longLayout = computeWallLayout(longExcerpt);
		expect(shortLayout.fontSize).toBe(WALL_FONT_SIZE);
		expect(longLayout.fontSize).toBe(WALL_FONT_SIZE);
	});

	it('the fixture card (150 words) and the longest real pool excerpt (201 words) both render at WALL_FONT_SIZE', () => {
		expect(computeWallLayout(FIXTURE_CARD.original_excerpt).fontSize).toBe(WALL_FONT_SIZE);
		expect(computeWallLayout(LONGEST_EXCERPT).fontSize).toBe(WALL_FONT_SIZE);
	});
});

describe('social pilot 02a T07 — the scroll rate is expressed in LINES PER SECOND, derived into px/s (not a bare px/s constant)', () => {
	it('WALL_SCROLL_LINES_PER_SEC is defined and close to the plan\'s ~4.5 lines/s figure (implemented T08)', () => {
		expect(WALL_SCROLL_LINES_PER_SEC).toBeDefined();
		expect(WALL_SCROLL_LINES_PER_SEC).toBeGreaterThanOrEqual(4);
		expect(WALL_SCROLL_LINES_PER_SEC).toBeLessThanOrEqual(5);
	});

	it('WALL_SCROLL_RATE_PX_PER_SEC is DERIVED from WALL_SCROLL_LINES_PER_SEC and the fixed font size\'s line height', () => {
		const lineHeightPx = WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO;
		const derivedRatePxPerSec = WALL_SCROLL_LINES_PER_SEC * lineHeightPx;
		expect(WALL_SCROLL_RATE_PX_PER_SEC).toBe(derivedRatePxPerSec);
	});

	it('at ~44px and ~4.5 lines/s the derived rate is roughly 250px/s, well under F16/F18\'s 500px/s', () => {
		expect(WALL_SCROLL_RATE_PX_PER_SEC).toBeLessThan(400);
	});
});

describe('social pilot 02a T07 — frame-0 velocity is already full under whatever rate ships (no ease-in ramp) — the house rule, re-checked against a rate that is about to change value', () => {
	it('the frame-0-to-frame-1 delta already equals the full derived per-frame rate, not a fraction of it ramping up', () => {
		const offsetAtZero = wallScrollOffsetAtFrame(0);
		const offsetAtOne = wallScrollOffsetAtFrame(1);
		expect(offsetAtOne - offsetAtZero).toBe(WALL_SCROLL_RATE_PX_PER_SEC / FPS);
	});

	it('offset(0) is exactly 0 regardless of the rate\'s value — the block top sits exactly at the frame top on frame 0', () => {
		expect(wallScrollOffsetAtFrame(0)).toBe(0);
	});
});

describe('social pilot 02a T07 — the scroll never finishes before the cut, BY CONSTRUCTION, for the whole read-through slice (chapter-sourced blocks, T05/T06)', () => {
	const READ_THROUGH_BOOK = 'meditations';
	const READ_THROUGH_CHAPTERS = ['book-02', 'book-03'];

	const bookCards = loadBookCards(READ_THROUGH_BOOK, outputDir);
	const readThroughSlice = bookCards
		.filter((c) => READ_THROUGH_CHAPTERS.includes(String(c.chapter_slug)))
		.sort((a, b) => {
			const chapterOrder =
				READ_THROUGH_CHAPTERS.indexOf(String(a.chapter_slug)) - READ_THROUGH_CHAPTERS.indexOf(String(b.chapter_slug));
			return chapterOrder !== 0 ? chapterOrder : Number(a.card_number) - Number(b.card_number);
		});

	it('grounds this suite\'s own numbers: the read-through slice is 48 real cards (same slice T04/T06 measured)', () => {
		expect(readThroughSlice.length).toBe(48);
	});

	it('every one of the 48 read-through slice cards\' CHAPTER-sourced block still outruns the wall phase — no per-card rejection needed', () => {
		const offsetAtLastFrame = wallScrollOffsetAtFrame(WALL_FRAMES - 1);
		const shortfalls: { id: string; blockHeight: number }[] = [];
		for (const card of readThroughSlice) {
			const block = loadChapterTextBlock(READ_THROUGH_BOOK, card.id, outputDir);
			const layout = computeWallLayout(block);
			const blockBottomY = layout.blockHeight - offsetAtLastFrame;
			if (!(blockBottomY > FRAME_HEIGHT)) {
				shortfalls.push({ id: card.id, blockHeight: layout.blockHeight });
			}
		}
		expect(shortfalls).toEqual([]);
	});
});

describe('social pilot 02a T07 — no read-through card is rejected for block height once the block is chapter-sourced (T04\'s 14 travel rejections must all clear)', () => {
	// social pilot 02a T08 (2026-08-26): a FROZEN snapshot of the 14 card ids
	// T04 measured as rejected on the (now-deleted) travel axis, taken from
	// `content/social/render-exclusions.json` as committed at T04
	// (`git show <T04-era commit>:content/social/render-exclusions.json`) —
	// NOT read live from that file anymore. `gateWallCard` no longer produces
	// a `'travel'` axis at all once T08 lands (see `wall-gate.ts`'s own doc
	// comment), so a fresh regeneration of the committed artifact (which T08
	// itself triggers) reports zero `'travel'` entries — reading the axis
	// live here would make this test's own grounding assertion vacuous
	// (`0 !== 14`) the moment the artifact catches up with the code. The
	// historical fact this test needs — "these particular 14 real cards were
	// too short to survive the wall phase on their own single-card excerpt" —
	// doesn't depend on the gate's CURRENT axis taxonomy, so it's pinned here
	// instead.
	const TRAVEL_REJECTED_IDS = [
		'meditations-02-001',
		'meditations-02-003',
		'meditations-02-004',
		'meditations-02-007',
		'meditations-02-010',
		'meditations-02-016',
		'meditations-02-019',
		'meditations-03-006',
		'meditations-03-013',
		'meditations-03-020',
		'meditations-03-024',
		'meditations-03-025',
		'meditations-03-026',
		'meditations-03-027'
	];

	it('grounds this test\'s own numbers: T04 measured 14 read-through cards rejected on the travel axis under the per-card, single-excerpt fit', () => {
		expect(TRAVEL_REJECTED_IDS.length).toBe(14);
	});

	it('confirms those same 14 cards\' OWN single-card excerpt still does not survive the wall phase at the new fixed-size geometry — the defect T05/T06/T07/T08 fix', () => {
		const slice = loadBookCards('meditations', outputDir);
		const offsetAtLastFrame = wallScrollOffsetAtFrame(WALL_FRAMES - 1);
		const stillSurvivingOnOwnExcerpt: string[] = [];
		for (const cardId of TRAVEL_REJECTED_IDS) {
			const card = slice.find((c) => c.id === cardId);
			expect(card, `card ${cardId} not found in the meditations corpus`).toBeDefined();
			if (!card) continue;
			const layout = computeWallLayout(card.original_excerpt);
			const blockBottomY = layout.blockHeight - offsetAtLastFrame;
			if (blockBottomY > FRAME_HEIGHT) {
				stillSurvivingOnOwnExcerpt.push(cardId);
			}
		}
		expect(stillSurvivingOnOwnExcerpt).toEqual([]);
	});

	it('every one of those 14 cards clears the wall phase once its own excerpt is replaced by its CHAPTER-sourced block', () => {
		const offsetAtLastFrame = wallScrollOffsetAtFrame(WALL_FRAMES - 1);
		const stillFailing: string[] = [];
		for (const cardId of TRAVEL_REJECTED_IDS) {
			const block = loadChapterTextBlock('meditations', cardId, outputDir);
			const layout = computeWallLayout(block);
			const blockBottomY = layout.blockHeight - offsetAtLastFrame;
			if (!(blockBottomY > FRAME_HEIGHT)) {
				stillFailing.push(cardId);
			}
		}
		expect(stillFailing).toEqual([]);
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

describe('source guard — the karaoke highlight is gone (F15), the scroll is the only motion', () => {
	const wallSource = readFileSync(path.join(moduleDir, '..', 'Wall.tsx'), 'utf-8');
	const wallTimingSource = readFileSync(path.join(moduleDir, '..', 'wall-timing.ts'), 'utf-8');

	it('Wall.tsx never reads a karaoke word-timing schedule (only mentions it in historical doc comments)', () => {
		expect(wallSource).not.toMatch(/timing\.karaoke/);
		expect(wallSource).not.toMatch(/KaraokeWordTiming/);
		expect(wallSource).not.toMatch(/computeKaraokeWordTimings/);
	});

	it('Wall.tsx never builds a per-word accent-tinted span (the old highlight band)', () => {
		expect(wallSource).not.toMatch(/words\.map/);
		expect(wallSource).not.toMatch(/\$\{accent\}CC/);
		expect(wallSource).not.toMatch(/\$\{accent\}66/);
	});

	it('wall-timing.ts no longer exports a karaoke word-timing computation', () => {
		expect(wallTimingSource).not.toMatch(/export function computeKaraokeWordTimings/);
		expect(wallTimingSource).not.toMatch(/export const KARAOKE_WPM/);
	});

	it('Wall.tsx uses wallScrollOffsetAtFrame, not wallScaleAtFrame, to drive the wall phase', () => {
		expect(wallSource).toMatch(/wallScrollOffsetAtFrame/);
		expect(wallSource).not.toMatch(/wallScaleAtFrame/);
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
				outDir: bundleDir,
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
