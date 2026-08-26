import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { selectComposition } from '@remotion/renderer';

import { FRAME_WIDTH, splitWords } from '../wall-timing.js';
import { MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';
import {
	gateWallCard,
	assertWallCardRenderable,
	WALL_REFERENCE_VIEWPORT_WIDTH,
	WALL_MIN_LEGIBLE_FONT_PX,
	WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX,
	// The named max-words backstop the plan's Decisions section calls for
	// (social pilot 02a T02): "Never fall back to the whole passage... a
	// word-count backstop in the composition so a whole-passage payoff can
	// never render again."
	WALL_LANDING_LINE_MAX_WORDS
} from '../wall-gate.js';
import { surveyWallPool, resolveWallCardExcerpt, loadOutputCard, type WallPoolEntry } from '../wall-pool.js';
import { computeWallPlainLines } from '../../cli-plan.js';
import { selectLandingLine } from '../landing-line.js';

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
const outputDir = path.join(repoRoot, 'content', 'output');

// --- The real Wall pool, loaded straight from content/social/premises -----

interface WallPool {
	entries: WallPoolEntry[];
}

function loadWallPool(): WallPool {
	return JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'wall.json'), 'utf-8')
	) as WallPool;
}

const POOL = loadWallPool();

function longestPoolEntry(): WallPoolEntry & { original_word_count: number } {
	let longest = POOL.entries[0] as WallPoolEntry & { original_word_count: number };
	for (const entry of POOL.entries) {
		const candidate = entry as WallPoolEntry & { original_word_count: number };
		if (candidate.original_word_count > longest.original_word_count) {
			longest = candidate;
		}
	}
	return longest;
}

describe('WALL_MIN_LEGIBLE_FONT_PX', () => {
	it('is derived from the reference viewport and never hardcoded', () => {
		// The documented derivation: 14 CSS px on a 390px-wide reference phone,
		// converted into the 1080-wide frame's px space, rounded up.
		const expected = Math.ceil(14 * (FRAME_WIDTH / WALL_REFERENCE_VIEWPORT_WIDTH));
		expect(WALL_MIN_LEGIBLE_FONT_PX).toBe(expected);
	});

	it('equals 39', () => {
		expect(WALL_MIN_LEGIBLE_FONT_PX).toBe(39);
	});

	// F16 (2026-08-26): the "sits strictly above WALL_MIN_FONT" invariant
	// test that used to live here is gone along with `WALL_MIN_FONT` and the
	// runtime assertion in `wall-gate.ts` it checked — F16's `computeWallLayout`
	// used a single FIXED `WALL_FONT_SIZE`, not a per-card search, so "did the
	// fit bottom out below the floor" was not a reachable failure mode for
	// `gateWallCard` to guard against at the time. F18 (2026-08-26) restored a
	// real per-card search (`fitWallFontSize`) — `WALL_MIN_LEGIBLE_FONT_PX` is
	// its own `WALL_FONT_FLOOR_PX` now, so bottoming out at the floor IS
	// reachable again, just no longer a `gateWallCard` REJECTION path: the
	// floor is a clamp `fitWallFontSize` returns (see `wall-gate.test.ts`'s own
	// `WALL_FONT_CAP_PX`-side coverage below for the actual rejection axis).
	// `WALL_MIN_LEGIBLE_FONT_PX` was never dead outside the Wall either:
	// `question-gate.ts` and `objection-gate.ts` also run a real per-card
	// `fitFontSize` search against it — see `wall-gate.ts`'s module doc comment.
});

describe('gateWallCard — the real longest card in the pool', () => {
	it('the longest original in content/social/premises/wall.json is ~201 words', () => {
		const longest = longestPoolEntry();
		expect(longest.original_word_count).toBeGreaterThan(150);
		expect(longest.original_word_count).toBeLessThan(220);
	});

	it('measures a real, reportable fitted font size', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		const result = gateWallCard(excerpt);

		// The corpus's longest original excerpt (~201 words) is not actually
		// long enough to breach the 39px legibility floor — it fits at a
		// generous size. That is the correct, honest result: we assert what
		// the gate actually reports rather than forcing a rejection. The
		// rejection path itself is proven separately below with a synthetic
		// excerpt built from this same real text.
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.layout.fontSize).toBeGreaterThanOrEqual(WALL_MIN_LEGIBLE_FONT_PX);
		}
	});
});

// F16 (2026-08-26): the rejection path this describe block proves is no
// longer "too LONG to fit legibly" — it is now too SHORT for the scroll to
// survive the wall phase without finishing before the cut. F18 (2026-08-26)
// re-derived the same axis around a per-card fit (`fitWallFontSize`) instead
// of F16's single fixed size, but the axis itself — and this describe
// block's rejection story — is unchanged: a card whose block can't reach
// `WALL_TARGET_BLOCK_HEIGHT_PX` even at `WALL_FONT_CAP_PX` still rejects,
// just via `layout.fits === false` now rather than a raw blockHeight
// comparison. These three tests replace (not weaken) the three the old
// "synthetic over-long excerpt" story covered — same rigor, the new axis.
describe('gateWallCard — rejection path (synthetic too-short excerpt)', () => {
	// A short, real slice of the real longest card's own text (the first 20
	// words) — nowhere near the real pool's empirical minimum passing word
	// count (97 words, `meditations-12-017` — see `wall-timing.ts`'s
	// `WALL_FONT_CAP_PX` doc comment) — proves the rejection path without
	// fabricating unrelated text.
	function syntheticTooShortExcerpt(): string {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		return splitWords(excerpt).slice(0, 20).join(' ');
	}

	it('rejects — ok is false, not a silent pass below the travel floor', () => {
		const synthetic = syntheticTooShortExcerpt();
		const result = gateWallCard(synthetic);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('travel');
			expect(result.blockHeight).toBeLessThanOrEqual(WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX);
			expect(result.wordCount).toBe(splitWords(synthetic).length);
			// The reason names the measured block height, the floor, and the word count.
			expect(result.reason).toContain(String(Math.round(result.blockHeight!)));
			expect(result.reason).toContain(String(WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX));
			expect(result.reason).toContain(String(result.wordCount));
		}
	});

	it('no ok:true result is ever returned at or under the travel floor (never a silent pass)', () => {
		const synthetic = syntheticTooShortExcerpt();
		const result = gateWallCard(synthetic);
		if (result.ok) {
			// If this ever ran, it would mean the gate rendered a card whose
			// scroll finishes before the cut instead of rejecting it — that is
			// the exact failure this gate exists to prevent.
			expect(result.layout.blockHeight).toBeGreaterThan(WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX);
		} else {
			expect(result.ok).toBe(false);
		}
	});

	it('assertWallCardRenderable throws a clear error naming the block height, cap and word count', () => {
		const synthetic = syntheticTooShortExcerpt();
		expect(() => assertWallCardRenderable(synthetic)).toThrow(/even at the \d+px font cap/);
	});
});

describe('the composition path surfaces the rejection (T06 wiring)', () => {
	it(
		'selectComposition throws for a too-short card, before any frame renders',
		async () => {
			const longest = longestPoolEntry();
			const excerpt = resolveWallCardExcerpt(longest, outputDir);
			const synthetic = splitWords(excerpt).slice(0, 20).join(' ');

			const bundleLocation = await bundle({
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

			await expect(
				selectComposition({
					serveUrl: bundleLocation,
					id: 'Wall',
					inputProps: {
						originalExcerpt: synthetic,
						landingLine: 'This is the landing line.',
						plainLines: ['This is the rest of the plain passage.'],
						author: 'marcus-aurelius'
					}
				})
			).rejects.toThrow(/even at the \d+px font cap/);
		},
		120_000
	);

	// T01 (social pilot 02a): the plan's decision is explicit — "Never fall
	// back to the whole passage... a word-count backstop in the composition
	// so a whole-passage payoff can never render again." Today, `Wall.tsx`
	// renders whatever `landingLine` prop it's given with no word-count
	// check of its own — `PayoffLine` just auto-fits the font size down,
	// however long the text is. This proves that gap: a `landingLine` far
	// longer than any real Wall payoff should ever be (well past the
	// existing 18-word `LANDING_LINE_MAX_WORDS` mechanical selection bound
	// duplicated in `landing-line.ts`/`scripts/lib/premises.ts`) must be
	// REJECTED by the composition itself — not merely by the upstream
	// mechanical gate that chose it — so a regression that feeds `Wall.tsx`
	// an unselected/whole passage can never silently render.
	it(
		'selectComposition throws for a landingLine over the named max-words backstop',
		async () => {
			const longest = longestPoolEntry();
			const excerpt = resolveWallCardExcerpt(longest, outputDir);

			// Far longer than any real landing line: 45 words, more than
			// double the existing 18-word mechanical selection cap.
			const overLongLandingLine = Array.from({ length: 45 }, (_, i) => `word${i + 1}`).join(' ') + '.';

			const bundleLocation = await bundle({
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

			await expect(
				selectComposition({
					serveUrl: bundleLocation,
					id: 'Wall',
					inputProps: {
						originalExcerpt: excerpt,
						landingLine: overLongLandingLine,
						plainLines: ['One short rest line.'],
						author: 'marcus-aurelius'
					}
				})
			).rejects.toThrow(/landing line/i);
		},
		120_000
	);
});

// T01/T02 (social pilot 02a): the payoff's whole-passage fallback
// (`tryReadThroughContent`'s old `selectLandingLine(card) ?? card.plain_english`
// in `scripts/lib/schedule.ts`) was the defect this plan exists to fix. Per
// the plan's Decisions section: "No qualifying landing line -> the card is
// not a Wall. It becomes a Still... Enforced in the gate at survey time."
// `gateWallCard` now looks at `plain_english`/the landing line too — not
// only the archaic `originalExcerpt`'s travel and duration axes — so this
// describe block proves that.
describe('gateWallCard — the landing-line requirement (T02)', () => {
	// A real slice of plain English with no terminal `.`/`!` anywhere — every
	// "sentence" `sentences()` extracts from it is therefore a fragment, so
	// `findLandingLines`/`selectLandingLine` can never find a qualifying line
	// no matter its word count or self-containedness.
	const NO_QUALIFYING_LANDING_LINE_PLAIN_ENGLISH =
		'This opens mid thought with no terminal punctuation anywhere in the passage so nothing here can ever complete a sentence';

	it('sanity: the fixture text really has no qualifying landing line (selectLandingLine returns null)', () => {
		expect(selectLandingLine(NO_QUALIFYING_LANDING_LINE_PLAIN_ENGLISH)).toBeNull();
	});

	it('a named max-words backstop constant exists on wall-gate.ts', () => {
		// Not 18 (LANDING_LINE_MAX_WORDS, the mechanical selection bound
		// already enforced upstream in landing-line.ts/premises.ts) — this is
		// meant as a defense-in-depth backstop against a whole passage ever
		// reaching the composition, not a restatement of the selection rule.
		expect(typeof WALL_LANDING_LINE_MAX_WORDS).toBe('number');
	});

	it('rejects a card whose plain_english yields no qualifying landing line', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);

		// `plainEnglish` does not exist on `WallGateContentInput` yet (T02) —
		// passed here as the shape T02's acceptance criterion requires this
		// test to compile and pass against.
		const result = gateWallCard(excerpt, { plainEnglish: NO_QUALIFYING_LANDING_LINE_PLAIN_ENGLISH } as Parameters<
			typeof gateWallCard
		>[1]);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('landingLine');
			expect(result.reason).toMatch(/landing line/i);
		}
	});

	it('assertWallCardRenderable throws naming the missing landing line', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);

		expect(() =>
			assertWallCardRenderable(excerpt, {
				plainEnglish: NO_QUALIFYING_LANDING_LINE_PLAIN_ENGLISH
			} as Parameters<typeof assertWallCardRenderable>[1])
		).toThrow(/landing line/i);
	});
});

describe('surveyWallPool — the real pool', () => {
	it('runs the gate over every entry and reports counts that sum to the pool size', () => {
		const result = surveyWallPool(POOL.entries, outputDir);
		expect(result.passed + result.rejectedForTravel + result.rejectedForDuration).toBe(POOL.entries.length);
		expect(result.passed).toBeGreaterThan(0);
	});

	it('every rejected id is a real pool id', () => {
		const result = surveyWallPool(POOL.entries, outputDir);
		const poolIds = new Set(POOL.entries.map((entry) => entry.card_id));
		for (const id of result.rejectedIds) {
			expect(poolIds.has(id)).toBe(true);
		}
	});

	it('resolves every excerpt from real files under content/output', () => {
		// Sanity check on the resolver itself — every book_slug referenced by
		// the pool must exist as a directory in content/output.
		const bookSlugs = new Set(POOL.entries.map((entry) => entry.book_slug));
		for (const slug of bookSlugs) {
			expect(() => readdirSync(path.join(outputDir, slug))).not.toThrow();
		}
	});

	it('reports the duration ceiling exclusions separately from travel exclusions (F03)', () => {
		const result = surveyWallPool(POOL.entries, outputDir);
		// The real over-long card below proves this is >0, not just structurally present.
		expect(result.rejectedForDuration).toBeGreaterThan(0);
		expect(result.rejectedForDuration).toBeLessThan(POOL.entries.length);
	});
});

describe('gateWallCard — the duration ceiling (F03)', () => {
	// `content/social/pilot-schedule-w01.json` day 6 slot 2 draws this exact
	// card and fails at render time (`padToMinimumDuration` throws: 1845
	// frames, 61.5s, over the 1770-frame/59s ceiling) — reproduced here as a
	// pool-survey-time rejection instead, per F03.
	const OVERLONG_ENTRY: WallPoolEntry = {
		card_id: 'on-anger-03-027',
		book_slug: 'on-anger'
	};

	it('rejects the real over-long card with a duration reason, naming the frame count, ceiling and line count', () => {
		const card = loadOutputCard(OVERLONG_ENTRY.book_slug, OVERLONG_ENTRY.card_id, outputDir);
		const landingLine = 'Too much flattery irritates people with bad tempers.';
		const plainLines = computeWallPlainLines(card.plain_english, landingLine);

		const result = gateWallCard(card.original_excerpt, { plainLines });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('duration');
			expect(result.totalFrames).toBeGreaterThan(MAX_POST_DURATION_FRAMES);
			expect(result.lineCount).toBe(plainLines.length);
			expect(result.reason).toContain(String(result.totalFrames));
			expect(result.reason).toContain(String(MAX_POST_DURATION_FRAMES));
			expect(result.reason).toContain(String(plainLines.length));
		}
	});

	it('assertWallCardRenderable throws the same duration reason', () => {
		const card = loadOutputCard(OVERLONG_ENTRY.book_slug, OVERLONG_ENTRY.card_id, outputDir);
		const landingLine = 'Too much flattery irritates people with bad tempers.';
		const plainLines = computeWallPlainLines(card.plain_english, landingLine);

		expect(() => assertWallCardRenderable(card.original_excerpt, { plainLines })).toThrow(
			new RegExp(`over the ${MAX_POST_DURATION_FRAMES}-frame`)
		);
	});

	it('a normal card (short plainLines) still passes both the travel and duration checks', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		const result = gateWallCard(excerpt, { plainLines: ['One short rest line.', 'Another short rest line.'] });

		expect(result.ok).toBe(true);
	});

	it('omitting plainLines never false-rejects for duration (fixed wall + landing-line phases only)', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		const result = gateWallCard(excerpt);

		expect(result.ok).toBe(true);
	});
});
