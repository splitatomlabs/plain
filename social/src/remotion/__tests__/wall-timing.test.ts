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
	fitWallFontSize,
	computeWallTiming,
	wallScrollOffsetAtFrame,
	splitWords,
	FPS,
	FRAME_HEIGHT,
	WALL_FRAMES,
	WALL_MIN_FRAMES,
	WALL_MAX_FRAMES,
	WALL_LINE_HEIGHT_RATIO,
	WALL_FONT_FLOOR_PX,
	WALL_FONT_CAP_PX,
	WALL_TARGET_BLOCK_HEIGHT_PX,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_SCROLL_PX_PER_FRAME,
	WALL_SECONDS,
	LANDING_LINE_FRAMES,
	DEFAULT_LINE_SECONDS,
	DEFAULT_LINE_FRAMES,
	// social pilot 02a T07 (2026-08-26): neither of these exists on
	// `wall-timing.ts` yet (F18 fits a font size PER CARD instead — see
	// `fitWallFontSize`). Importing a name `wall-timing.ts` does not export
	// resolves to `undefined` in this project's Vitest/esbuild ESM transform
	// (confirmed empirically — it does not throw a module-resolution error),
	// so the "T07 — the new wall geometry" describe blocks below fail as
	// ordinary assertion failures against `undefined`, not as import crashes
	// that would take the rest of this file's (pre-T07, already-passing)
	// tests down with them. T08 adds these two real exports.
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

// F18 (2026-08-26): retired F16's single FIXED `WALL_FONT_SIZE` (76px) —
// `computeWallLayout` now calls `fitWallFontSize`, which binary-searches
// `[WALL_FONT_FLOOR_PX, WALL_FONT_CAP_PX]` for the smallest font size whose
// block reaches `WALL_TARGET_BLOCK_HEIGHT_PX`. A fixed size cost 76% of the
// real Wall pool (219/896 renderable) because "never finishes before the
// cut" needs a block over the travel floor, and 76px only reached that
// above ~130 words. The per-card fit restores supply: short cards get a
// LARGER font (to reach the target), long cards a SMALLER one (to avoid
// wildly overshooting it) — `screens` is still descriptive/reporting only;
// the load-bearing invariant is the travel floor checked below.
describe('block geometry at F18 numbers — real cards, real Playwright-measured Literata', () => {
	it('the fixture card (150 words, the Wall word floor) computes the exact real-measured geometry', () => {
		const layout = computeWallLayout(FIXTURE_CARD.original_excerpt);
		expect(layout.fits).toBe(true);
		expect(layout.blockHeight).toBe(layout.estimatedLines * layout.lineHeight);
		expect(layout.blockHeight).toBeGreaterThanOrEqual(WALL_TARGET_BLOCK_HEIGHT_PX);
		// Real Playwright `boundingClientRect` measurement (real Literata
		// Variable) at this card's own fitted size (77px): 35 real wrapped
		// lines, 3368.75px tall — comfortably above both the 3170px real
		// travel floor and the (lower) estimate. `computeWallLayout`'s
		// estimate at this same size (36 estimated lines, 3465px) is the SAFE
		// direction for the TRAVEL FLOOR specifically even though it slightly
		// OVER-counts real here — see `WALL_LINE_ESTIMATE_OVERSHOOT`'s doc
		// comment for the full-pool false-positive sweep this is drawn from
		// (this exact overshoot/target pairing was chosen because it produces
		// zero false positives across the real pool, not because every single
		// card's estimate sits on one side of real).
		expect(layout.fontSize).toBe(77);
		expect(layout.estimatedLines).toBe(36);
		expect(layout.blockHeight).toBe(3465);
	});

	it('the longest real excerpt in the pool (201 words) computes real-measured geometry too', () => {
		const layout = computeWallLayout(LONGEST_EXCERPT);
		expect(layout.fits).toBe(true);
		expect(layout.blockHeight).toBeGreaterThanOrEqual(WALL_TARGET_BLOCK_HEIGHT_PX);
		// Real measurement at this card's own fitted size (72px): 40 real
		// wrapped lines, 3600px — the estimate (38 lines, 3420px) under-counts
		// slightly here, the safe direction for the travel floor.
		expect(layout.fontSize).toBe(72);
		expect(layout.estimatedLines).toBe(38);
		expect(layout.blockHeight).toBe(3420);
	});

	it('uses a tight line height (<= 1.3), not comfortable reading spacing', () => {
		expect(WALL_LINE_HEIGHT_RATIO).toBeLessThanOrEqual(1.3);
	});

	it('fits every candidate font size within [WALL_FONT_FLOOR_PX, WALL_FONT_CAP_PX]', () => {
		for (const excerpt of [FIXTURE_CARD.original_excerpt, LONGEST_EXCERPT]) {
			const layout = computeWallLayout(excerpt);
			expect(layout.fontSize).toBeGreaterThanOrEqual(WALL_FONT_FLOOR_PX);
			expect(layout.fontSize).toBeLessThanOrEqual(WALL_FONT_CAP_PX);
		}
	});
});

describe('fitWallFontSize — a short excerpt cannot reach the target within the cap', () => {
	it('returns fits: false and clamps fontSize at WALL_FONT_CAP_PX rather than searching past it', () => {
		// The first 20 words of the longest real pool excerpt — short enough
		// that even the largest allowed font size can't reach the target
		// block height (see `wall-gate.test.ts`'s equivalent rejection-path
		// coverage for the gate itself).
		const synthetic = splitWords(LONGEST_EXCERPT).slice(0, 20).join(' ');
		const layout = fitWallFontSize(synthetic);
		expect(layout.fits).toBe(false);
		expect(layout.fontSize).toBe(WALL_FONT_CAP_PX);
		expect(layout.blockHeight).toBeLessThan(WALL_TARGET_BLOCK_HEIGHT_PX);
	});
});

describe('fitWallFontSize — an extremely long excerpt clamps at the floor rather than searching smaller', () => {
	it('returns fits: true at exactly WALL_FONT_FLOOR_PX when even the floor overshoots the target', () => {
		const veryLong = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
		const layout = fitWallFontSize(veryLong);
		expect(layout.fits).toBe(true);
		expect(layout.fontSize).toBe(WALL_FONT_FLOOR_PX);
		expect(layout.blockHeight).toBeGreaterThanOrEqual(WALL_TARGET_BLOCK_HEIGHT_PX);
	});
});

describe('the scroll does not finish before the cut — the invariant F15 requires, F16 re-derives, and F18\'s per-card fit still guarantees for EVERY renderable card', () => {
	it('at the last wall frame, the fixture block is still taller than what has scrolled past — its bottom is below the frame bottom', () => {
		const layout = computeWallLayout(FIXTURE_CARD.original_excerpt);
		const lastWallFrame = WALL_FRAMES - 1;
		const offsetAtLastFrame = wallScrollOffsetAtFrame(lastWallFrame);
		// The block's bottom edge, in frame-space, after scrolling: blockHeight - offset.
		// "Below the frame's bottom edge" means this is still > FRAME_HEIGHT.
		const blockBottomY = layout.blockHeight - offsetAtLastFrame;
		expect(blockBottomY).toBeGreaterThan(FRAME_HEIGHT);
	});

	it('holds for the longest real excerpt in the pool too', () => {
		const layout = computeWallLayout(LONGEST_EXCERPT);
		const offsetAtLastFrame = wallScrollOffsetAtFrame(WALL_FRAMES - 1);
		expect(layout.blockHeight - offsetAtLastFrame).toBeGreaterThan(FRAME_HEIGHT);
	});

	it('matches the documented arithmetic: rate * wallPhaseSeconds < blockHeight - FRAME_HEIGHT', () => {
		const layout = computeWallLayout(FIXTURE_CARD.original_excerpt);
		const totalTravel = WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS;
		expect(totalTravel).toBeLessThan(layout.blockHeight - FRAME_HEIGHT);
	});

	// F16 inverts F15's framing here: F15 derived a "safe rate ceiling" from
	// an ASSUMED worst-case block (2 screens); F16 instead derives the
	// travel floor a card's block must clear FROM the chosen rate — see
	// `wall-gate.ts`'s `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`, which is the actual
	// figure `gateWallCard` checks every real card against. This test
	// re-derives that same arithmetic independently (without importing
	// `wall-gate.ts`, keeping this file's own dependency graph unchanged)
	// and checks it against both real fixture cards directly.
	it('the derived travel floor (FRAME_HEIGHT + rate * WALL_SECONDS) is exactly 3170px, and both fixtures clear it', () => {
		const travelFloor = FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS;
		expect(travelFloor).toBe(3170);

		const fixtureLayout = computeWallLayout(FIXTURE_CARD.original_excerpt);
		expect(fixtureLayout.blockHeight).toBeGreaterThan(travelFloor);

		const longestLayout = computeWallLayout(LONGEST_EXCERPT);
		expect(longestLayout.blockHeight).toBeGreaterThan(travelFloor);
	});
});

// ---------------------------------------------------------------------------
// social pilot 02a T07 — the new wall geometry (TDD, written ahead of T08).
//
// The defect these guard against: "the wall reads as a large-print book, not
// a wall" — F18's per-card fit (`fitWallFontSize`, above) buys travel by
// magnifying type (block height scales with the SQUARE of font size), which
// is the opposite of the dense, small-set look the format wants. T08's fix
// (see `plans/Pf39c2-social-pilot-02a.md`): a FIXED font size (~44px, not a
// per-card fit), a scroll rate expressed in LINES PER SECOND (~4.5, derived
// into px/s from the fixed font size — not a bare px/s constant), and the
// never-finishes invariant satisfied BY CONSTRUCTION once the block is
// chapter-sourced (T05/T06, already landed) rather than by rejecting short
// cards on a travel axis.
//
// Every describe block below is written against `wall-timing.ts` as it
// stands TODAY (F18's per-card fit) — some fail outright (`WALL_FONT_SIZE`
// and `WALL_SCROLL_LINES_PER_SEC` do not exist yet, so they import as
// `undefined`); others (the chapter-sourced travel/no-rejection guards)
// already hold today, because T06's chapter-text block is already long
// enough to clear even F18's own target — those are kept as forward-looking
// regression guards T08 must not break, not as tests this task expects to
// fail. T08 is expected to make ALL of them pass; until then, this whole
// section is this task's own documented acceptance criterion.
// ---------------------------------------------------------------------------

describe('social pilot 02a T07 — WALL_FONT_SIZE is FIXED, not fit per card', () => {
	it('WALL_FONT_SIZE is defined and close to the plan\'s ~44px figure — FAILS today (no such export until T08)', () => {
		expect(WALL_FONT_SIZE).toBeDefined();
		expect(WALL_FONT_SIZE).toBeGreaterThanOrEqual(40);
		expect(WALL_FONT_SIZE).toBeLessThanOrEqual(48);
	});

	it('computeWallLayout uses the SAME fontSize for a short passage and a long one — no per-card fit — FAILS today (F18 fits per card)', () => {
		const shortExcerpt = 'one two three four five';
		const longExcerpt = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
		const shortLayout = computeWallLayout(shortExcerpt);
		const longLayout = computeWallLayout(longExcerpt);
		expect(shortLayout.fontSize).toBe(WALL_FONT_SIZE);
		expect(longLayout.fontSize).toBe(WALL_FONT_SIZE);
	});

	it('the fixture card (150 words) and the longest real pool excerpt (201 words) both render at WALL_FONT_SIZE — FAILS today (F18 measures 77px/72px, a per-card fit, not a fixed size)', () => {
		expect(computeWallLayout(FIXTURE_CARD.original_excerpt).fontSize).toBe(WALL_FONT_SIZE);
		expect(computeWallLayout(LONGEST_EXCERPT).fontSize).toBe(WALL_FONT_SIZE);
	});
});

describe('social pilot 02a T07 — the scroll rate is expressed in LINES PER SECOND, derived into px/s (not a bare px/s constant)', () => {
	it('WALL_SCROLL_LINES_PER_SEC is defined and close to the plan\'s ~4.5 lines/s figure — FAILS today (no such export until T08)', () => {
		expect(WALL_SCROLL_LINES_PER_SEC).toBeDefined();
		expect(WALL_SCROLL_LINES_PER_SEC).toBeGreaterThanOrEqual(4);
		expect(WALL_SCROLL_LINES_PER_SEC).toBeLessThanOrEqual(5);
	});

	it('WALL_SCROLL_RATE_PX_PER_SEC is DERIVED from WALL_SCROLL_LINES_PER_SEC and the fixed font size\'s line height — FAILS today (F16/F18\'s 500px/s is a bare constant, not derived from any lines/sec figure)', () => {
		const lineHeightPx = WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO;
		const derivedRatePxPerSec = WALL_SCROLL_LINES_PER_SEC * lineHeightPx;
		expect(WALL_SCROLL_RATE_PX_PER_SEC).toBe(derivedRatePxPerSec);
	});

	it('at ~44px and ~4.5 lines/s the derived rate is roughly 250px/s, well under F16/F18\'s 500px/s — FAILS today', () => {
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
	const exclusions = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'render-exclusions.json'), 'utf-8')
	) as { read_through: { card_id: string; book_slug: string; axis: string }[] };
	const travelRejectedIds = exclusions.read_through.filter((e) => e.axis === 'travel').map((e) => e.card_id);

	it('grounds this test\'s own numbers: T04 measured 14 read-through cards rejected on the travel axis under the per-card, single-excerpt fit', () => {
		expect(travelRejectedIds.length).toBe(14);
	});

	it('confirms those same 14 cards DO fail computeWallLayout.fits on their OWN single-card excerpt today — the defect T05/T06/T07/T08 fix', () => {
		const slice = loadBookCards('meditations', outputDir);
		const stillPassingOnOwnExcerpt: string[] = [];
		for (const cardId of travelRejectedIds) {
			const card = slice.find((c) => c.id === cardId);
			expect(card, `card ${cardId} not found in the meditations corpus`).toBeDefined();
			if (!card) continue;
			const layout = computeWallLayout(card.original_excerpt);
			if (layout.fits) {
				stillPassingOnOwnExcerpt.push(cardId);
			}
		}
		expect(stillPassingOnOwnExcerpt).toEqual([]);
	});

	it('every one of those 14 cards clears computeWallLayout.fits once its own excerpt is replaced by its CHAPTER-sourced block', () => {
		const stillFailing: string[] = [];
		for (const cardId of travelRejectedIds) {
			const block = loadChapterTextBlock('meditations', cardId, outputDir);
			const layout = computeWallLayout(block);
			if (!layout.fits) {
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
