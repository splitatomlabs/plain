import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { selectComposition } from '@remotion/renderer';

import { FRAME_WIDTH, DEFAULT_LINE_FRAMES } from '../wall-timing.js';
import { MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';
import {
	gateWallCard,
	assertWallCardRenderable,
	WALL_REFERENCE_VIEWPORT_WIDTH,
	WALL_MIN_LEGIBLE_FONT_PX,
	// The named max-words backstop the plan's Decisions section calls for
	// (social pilot 02a T02): "Never fall back to the whole passage... a
	// word-count backstop in the composition so a whole-passage payoff can
	// never render again."
	WALL_LANDING_LINE_MAX_WORDS,
	// The Wall-specific duration ceiling (social pilot 02a T03) — see this
	// constant's own doc comment in wall-gate.ts for why it's stricter than
	// (and checked in addition to) MAX_POST_DURATION_FRAMES.
	WALL_MAX_DURATION_SECONDS,
	WALL_MAX_DURATION_FRAMES
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
	// `gateWallCard` to guard against at the time. F18 (2026-08-26) briefly
	// restored a real per-card search (`fitWallFontSize`), making
	// `WALL_MIN_LEGIBLE_FONT_PX` load-bearing for the Wall again as its own
	// floor. social pilot 02a T08 (2026-08-26) deleted that search — the Wall's
	// font size is fixed again (`WALL_FONT_SIZE`, comfortably above this
	// floor) — so `WALL_MIN_LEGIBLE_FONT_PX` is once again dead weight for the
	// Wall specifically, though it stays load-bearing for `question-gate.ts`
	// and `objection-gate.ts`, which still run real per-card `fitFontSize`
	// searches against it — see `wall-gate.ts`'s module doc comment.
});

describe('gateWallCard — the real longest card in the pool', () => {
	it('the longest original in content/social/premises/wall.json is ~201 words', () => {
		const longest = longestPoolEntry();
		expect(longest.original_word_count).toBeGreaterThan(150);
		expect(longest.original_word_count).toBeLessThan(220);
	});

	it('measures a real, reportable font size at the fixed WALL_FONT_SIZE', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		const result = gateWallCard(excerpt);

		// social pilot 02a T08: every card renders at the same fixed font size
		// now — no per-card fit, no rejection on block height — so this is
		// always `ok: true` (the composition's font size and legibility floor
		// were never in tension in the first place; the never-finishes
		// invariant this excerpt alone couldn't clear is now satisfied by the
		// chapter-sourced block, not by this single-card excerpt — see
		// `chapter-text.ts` and `wall-timing.test.ts`'s own T07 coverage).
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.layout.fontSize).toBeGreaterThanOrEqual(WALL_MIN_LEGIBLE_FONT_PX);
		}
	});
});

describe('the composition path surfaces the rejection (T02 wiring)', () => {
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
		// social pilot 02a T08: `rejectedForTravel` is gone along with the axis
		// it counted (`gateWallCard` no longer rejects on block height) —
		// `passed + rejectedForDuration` is the whole pool now, since
		// `surveyWallPool` never passes `plainEnglish`/`landingLine` (the only
		// other reachable axis is structurally unreachable here — see
		// `WallPoolRejection.axis`'s own doc comment).
		const result = surveyWallPool(POOL.entries, outputDir);
		expect(result.passed + result.rejectedForDuration).toBe(POOL.entries.length);
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

	// Pf39c2-social-pilot-02a V10: deleted "reports a real, non-trivial count
	// of duration ceiling exclusions (F03)", which asserted
	// `result.rejectedForDuration` was both >0 and <POOL.entries.length.
	// V02 added a <=5-payoff-screen cap to `wallGate`; V04 measured that at
	// <=5 screens no Wall card can approach the 40s WALL_MAX_DURATION_SECONDS
	// ceiling (a 5-screen payoff tops out around 17.5s), so
	// `surveyWallPool(POOL.entries, ...)` now reports `rejectedForDuration:
	// 0` for all 168 pool entries — re-confirmed here by running the real
	// survey, not assumed. The duration axis isn't gone from the code (it's
	// still reachable and still correctly rejects a card passed directly by
	// id, independent of pool membership — see "gateWallCard — the duration
	// ceiling (F03)" below, which loads `on-anger-03-027` straight from
	// `content/output` rather than through the pool), but the property this
	// deleted test guarded — that surveying the REAL WALL POOL finds a
	// non-trivial number of duration rejects — no longer holds, and can't,
	// by construction of the screen cap. The remaining "runs the gate over
	// every entry and reports counts that sum to the pool size" test above
	// already guards that `surveyWallPool` still runs and returns a verdict
	// for every pool entry.
});

describe('surveyWallPool — the rejection path (F05)', () => {
	// Pf39c2-social-pilot-02a V12: the real 168-entry pool never takes this
	// branch any more (see V10's comment above — a <=5-screen payoff can't
	// reach the 40s ceiling), so `wall-pool.ts`'s `else` branch (`rejectedIds
	// .push` / `rejections.push` / `axis` / `rejectedForDuration`) has no
	// surviving caller that exercises it. `result.rejections` is written
	// verbatim into `content/social/render-exclusions.json` by
	// `write-exclusions.ts`, so that branch still has to work — this test
	// drives it with a synthetic one-entry pool built from the same real
	// over-long card the "gateWallCard — the duration ceiling (F03)" block
	// below uses directly (`on-anger-03-027`), so it fails a real gate rather
	// than a fabricated one. This asserts the SHAPE of a rejection
	// (`rejectedForDuration`, `rejectedIds`, and `rejections[0]`'s `axis`/
	// `book_slug`/`reason`), not any property of the real pool's rejection
	// COUNT — that property is gone by construction (V02/V04) and should stay
	// gone.
	it('records a rejected duration card with the full shape write-exclusions.ts commits', () => {
		const syntheticPool: WallPoolEntry[] = [
			{
				card_id: 'on-anger-03-027',
				book_slug: 'on-anger',
				landing_line: 'Too much flattery irritates people with bad tempers.'
			}
		];

		const result = surveyWallPool(syntheticPool, outputDir);

		expect(result.passed).toBe(0);
		expect(result.rejectedForDuration).toBe(1);
		expect(result.rejectedIds).toEqual(['on-anger-03-027']);
		expect(result.rejections).toHaveLength(1);
		expect(result.rejections[0].axis).toBe('duration');
		expect(result.rejections[0].book_slug).toBe('on-anger');
		expect(result.rejections[0].reason).toContain(String(WALL_MAX_DURATION_FRAMES));
	});
});

describe('gateWallCard — the duration ceiling (F03)', () => {
	// `content/social/pilot-schedule-w01.json` day 6 slot 2 originally drew
	// this exact card and failed at render time under F03's pre-T03 pacing
	// (`padToMinimumDuration` threw: 1845 frames, 61.5s, over the
	// 1770-frame/59s ceiling). social pilot 02a T03 dropped `DEFAULT_LINE_SECONDS`
	// 3.5s -> 3.0s, so this same real card (16 fallback-timed lines) now
	// computes to 1605 frames (53.5s) — under the shared 59s ceiling, but
	// still over T03's new, stricter Wall-specific 40s ceiling
	// (`WALL_MAX_DURATION_FRAMES`), so it's still correctly rejected, just by
	// the OTHER duration axis. See the block below this one for a synthetic
	// case that proves the shared 59s ceiling still rejects on its own.
	const OVERLONG_ENTRY: WallPoolEntry = {
		card_id: 'on-anger-03-027',
		book_slug: 'on-anger'
	};

	it('rejects the real card with a duration reason, now via the Wall-specific ceiling at the new pacing', () => {
		const card = loadOutputCard(OVERLONG_ENTRY.book_slug, OVERLONG_ENTRY.card_id, outputDir);
		const landingLine = 'Too much flattery irritates people with bad tempers.';
		const plainLines = computeWallPlainLines(card.plain_english, landingLine);

		const result = gateWallCard(card.original_excerpt, { plainLines });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('duration');
			expect(result.totalFrames).toBeLessThan(MAX_POST_DURATION_FRAMES);
			expect(result.totalFrames).toBeGreaterThan(WALL_MAX_DURATION_FRAMES);
			expect(result.lineCount).toBe(plainLines.length);
			expect(result.reason).toContain(String(result.totalFrames));
			expect(result.reason).toContain(String(WALL_MAX_DURATION_FRAMES));
			expect(result.reason).toContain(String(plainLines.length));
		}
	});

	it('assertWallCardRenderable throws the same duration reason', () => {
		const card = loadOutputCard(OVERLONG_ENTRY.book_slug, OVERLONG_ENTRY.card_id, outputDir);
		const landingLine = 'Too much flattery irritates people with bad tempers.';
		const plainLines = computeWallPlainLines(card.plain_english, landingLine);

		expect(() => assertWallCardRenderable(card.original_excerpt, { plainLines })).toThrow(
			new RegExp(`over the ${WALL_MAX_DURATION_FRAMES}-frame`)
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

// social pilot 02a T03: "shorten the payoff by pacing, not by rejecting
// cards" pairs DEFAULT_LINE_SECONDS's drop (3.5s -> 3.0s, see
// wall-timing.test.ts) with a Wall-specific ceiling stricter than the
// shared 59s one (MAX_POST_DURATION_FRAMES) above — a card whose payoff
// runs long is rejected outright here, never truncated mid-passage.
describe('gateWallCard — the Wall-specific duration ceiling (T03)', () => {
	it('WALL_MAX_DURATION_SECONDS is 40s, stricter than the shared 59s ceiling', () => {
		expect(WALL_MAX_DURATION_SECONDS).toBe(40);
		expect(WALL_MAX_DURATION_FRAMES).toBeLessThan(MAX_POST_DURATION_FRAMES);
	});

	it('rejects a card whose fallback-timed lines cross 40s but stay well under the shared 59s ceiling', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);

		// 12 fallback-timed lines (DEFAULT_LINE_FRAMES each) push the total
		// just over WALL_MAX_DURATION_FRAMES (40s) while staying comfortably
		// under MAX_POST_DURATION_FRAMES (59s) — proves the Wall-specific
		// ceiling rejects independently of the shared one, not merely as a
		// restatement of it.
		const plainLines = Array.from({ length: 12 }, (_, i) => `Rest line number ${i + 1}.`);
		const result = gateWallCard(excerpt, { plainLines });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('duration');
			expect(result.totalFrames).toBeGreaterThan(WALL_MAX_DURATION_FRAMES);
			expect(result.totalFrames).toBeLessThan(MAX_POST_DURATION_FRAMES);
			expect(result.lineCount).toBe(plainLines.length);
			expect(result.reason).toContain(String(result.totalFrames));
			expect(result.reason).toContain(String(WALL_MAX_DURATION_FRAMES));
			expect(result.reason).toMatch(/Wall-specific/);
		}
	});

	it('assertWallCardRenderable throws naming the Wall-specific ceiling for the same card', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);
		const plainLines = Array.from({ length: 12 }, (_, i) => `Rest line number ${i + 1}.`);

		expect(() => assertWallCardRenderable(excerpt, { plainLines })).toThrow(
			new RegExp(`over the ${WALL_MAX_DURATION_FRAMES}-frame`)
		);
	});

	it('a card just under the 40s ceiling still passes', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);

		// 11 fallback-timed lines lands under WALL_MAX_DURATION_FRAMES —
		// proves the ceiling isn't so tight it rejects a merely-long-ish card.
		const plainLines = Array.from({ length: 11 }, (_, i) => `Rest line number ${i + 1}.`);
		const result = gateWallCard(excerpt, { plainLines });

		expect(result.ok).toBe(true);
	});

	it('a card whose duration crosses the shared 59s ceiling reports that ceiling, not the 40s one, since it is checked first', () => {
		const longest = longestPoolEntry();
		const excerpt = resolveWallCardExcerpt(longest, outputDir);

		// 18 fallback-timed lines pushes the total to 1785 frames (59.5s) —
		// over BOTH ceilings. The shared 59s ceiling is checked BEFORE the
		// Wall-specific 40s one (see gateWallCard), so this proves the two
		// checks compose rather than one silently shadowing the other's own
		// reporting: a card this long still reports against the SHARED
		// ceiling's own number, not the stricter one.
		const plainLines = Array.from({ length: 18 }, (_, i) => `Rest line number ${i + 1}.`);
		const result = gateWallCard(excerpt, { plainLines });

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failure).toBe('duration');
			expect(result.totalFrames).toBeGreaterThan(MAX_POST_DURATION_FRAMES);
			expect(result.reason).toContain(String(MAX_POST_DURATION_FRAMES));
			expect(result.reason).not.toMatch(/Wall-specific/);
		}
	});

	it('DEFAULT_LINE_FRAMES-driven arithmetic sanity: 12 lines really do cross the 40s ceiling at 3.0s/line', () => {
		// wall (2.5s) + landing line (3s) + 12 * DEFAULT_LINE_FRAMES must exceed
		// WALL_MAX_DURATION_FRAMES for the rejection test above to be testing
		// what it claims to test, not an accidental pass on the 59s ceiling.
		const fixedPhasesFrames = Math.round(2.5 * 30) + Math.round(3 * 30);
		const twelveLinesFrames = fixedPhasesFrames + 12 * DEFAULT_LINE_FRAMES;
		expect(twelveLinesFrames).toBeGreaterThan(WALL_MAX_DURATION_FRAMES);
		expect(twelveLinesFrames).toBeLessThan(MAX_POST_DURATION_FRAMES);
	});
});
