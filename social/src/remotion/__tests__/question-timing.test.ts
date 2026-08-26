import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import {
	computeQuestionLayout,
	computeQuestionTiming,
	QUESTION_HOLD_FRAMES,
	QUESTION_HOLD_SECONDS,
	ANSWER_FRAMES,
	ANSWER_SECONDS,
	ANSWER_MIN_SECONDS
} from '../question-timing.js';
import {
	WALL_FRAMES,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_SCROLL_LINES_PER_SEC,
	WALL_FONT_SIZE,
	WALL_LINE_HEIGHT_RATIO,
	FPS
} from '../wall-timing.js';
import { resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';
import { FORBIDDEN_TESTING_VOCABULARY } from '../question-gate.js';
import { MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';

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

// --- Real fixture — a passing entry from content/social/premises/question.json ---
// discourses-64-006: drift_verdict "answers", standalone_intelligible true,
// answer_has_substance true — i.e. it PASSES the pool's own gate flags, not
// one of the entries the pool file records as a failure. F16 (2026-08-26):
// swapped from discourses-18-010, whose 152-word archaic excerpt no longer
// clears `wall-gate.ts`'s new travel floor at the smaller 76px/500px-s
// geometry (blockHeight 3040px, under the 3170px floor) — this fixture's
// 176-word excerpt clears it with real margin (blockHeight 3420px).
const FIXTURE_ENTRY: WallPoolEntry = {
	card_id: 'discourses-64-006',
	book_slug: 'discourses'
};
const FIXTURE_QUESTION = 'You want me to trust you with my business?';
const FIXTURE_ANSWER = "You're a man who has corrupted his own will.";
const FIXTURE_ORIGINAL_EXCERPT = resolveWallCardExcerpt(FIXTURE_ENTRY, outputDir);
const FIXTURE_AUTHOR = 'epictetus';

describe('fixture sanity', () => {
	it('the fixture question is short enough for the still-format 12-word rule', () => {
		expect(FIXTURE_QUESTION.split(/\s+/).length).toBeLessThanOrEqual(12);
	});

	it('the fixture resolves a real, non-empty archaic excerpt from content/output', () => {
		expect(FIXTURE_ORIGINAL_EXCERPT.length).toBeGreaterThan(0);
	});
});

describe('phase 1 — the question alone, still', () => {
	const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });

	it('starts at frame 0', () => {
		expect(timing.question.startFrame).toBe(0);
	});

	it('is motionless — zero motion at frame 0, unlike The Wall', () => {
		expect(timing.question.motionless).toBe(true);
	});

	it('holds for exactly QUESTION_HOLD_SECONDS (the 1.5s the acceptance criterion is measured against)', () => {
		expect(QUESTION_HOLD_SECONDS).toBe(1.5);
		expect(timing.question.endFrame - timing.question.startFrame).toBe(QUESTION_HOLD_FRAMES);
		expect(QUESTION_HOLD_FRAMES).toBe(Math.round(1.5 * FPS));
	});
});

describe('phase 2 — the archaic original arrives as the moving wall', () => {
	const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });

	it('starts exactly where the question hold ends — a hard handoff, no overlap', () => {
		expect(timing.wall.startFrame).toBe(timing.question.endFrame);
	});

	it('is marked as moving (not motionless)', () => {
		expect(timing.wall.motionless).toBe(false);
	});

	it("reuses The Wall's own WALL_FRAMES constant for its length — not a redefined copy", () => {
		expect(timing.wall.endFrame - timing.wall.startFrame).toBe(WALL_FRAMES);
	});

	it('reuses WALL_SCROLL_RATE_PX_PER_SEC as the authoritative scroll rate, imported not copied (F15/F16)', () => {
		// social pilot 02a T08 (2026-08-26): the rate itself is no longer a bare
		// px/s constant (F16/F18's 500) — it's derived from WALL_SCROLL_LINES_PER_SEC
		// and the fixed WALL_FONT_SIZE (see wall-timing.ts). This test's own
		// point — that question-timing.ts REUSES whatever that rate is, rather
		// than hardcoding a second copy — doesn't depend on its numeric value,
		// so it's checked against the real derivation, not a hardcoded literal.
		expect(WALL_SCROLL_RATE_PX_PER_SEC).toBe(WALL_SCROLL_LINES_PER_SEC * WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO);
	});

	it('question-timing.ts imports WALL_FRAMES from wall-timing.js rather than redefining it', () => {
		const source = readFileSync(path.join(moduleDir, '..', 'question-timing.ts'), 'utf-8');
		expect(source).toMatch(/import\s*\{[^}]*\bWALL_FRAMES\b[^}]*\}\s*from\s*['"]\.\/wall-timing\.js['"]/);
		// And never redeclares its own WALL_FRAMES-shaped constant.
		expect(source).not.toMatch(/export const WALL_FRAMES/);
	});

	it('Question.tsx reuses WallPhase, computeWallTiming and computeWallLayout rather than forking a copy', () => {
		const source = readFileSync(path.join(moduleDir, '..', 'Question.tsx'), 'utf-8');
		expect(source).toMatch(/import\s*\{[^}]*\bWallPhase\b[^}]*\}\s*from\s*['"]\.\/Wall\.js['"]/);
		expect(source).toMatch(/import\s*\{[^}]*\bcomputeWallTiming\b[^}]*\}\s*from\s*['"]\.\/wall-timing\.js['"]/);
		expect(source).toMatch(/import\s*\{[^}]*\bcomputeWallLayout\b[^}]*\}\s*from\s*['"]\.\/wall-timing\.js['"]/);
		expect(source).not.toMatch(/function WallPhase/);
	});
});

describe('phase 3 — the answer resolves in stillness', () => {
	const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });

	it('starts exactly where the archaic wall phase ends — a hard cut, no overlap', () => {
		expect(timing.answer.startFrame).toBe(timing.wall.endFrame);
	});

	it('is motionless', () => {
		expect(timing.answer.motionless).toBe(true);
	});

	it('is held for at least ANSWER_MIN_SECONDS (2.5s, the house rule floor for a payoff frame)', () => {
		expect(ANSWER_MIN_SECONDS).toBe(2.5);
		expect(ANSWER_SECONDS).toBeGreaterThanOrEqual(ANSWER_MIN_SECONDS);
		const holdFrames = timing.answer.endFrame - timing.answer.startFrame;
		expect(holdFrames).toBeGreaterThanOrEqual(Math.round(2.5 * FPS));
		expect(ANSWER_FRAMES).toBeGreaterThanOrEqual(Math.round(2.5 * FPS));
	});
});

// social pilot 02a T16 (F04): computeQuestionTiming now accepts
// narrationTimings, matching computeWallTiming's own contract, so real
// narration drives the answer hold instead of the fixed ANSWER_FRAMES
// fallback.
//
// Important wrinkle, shared with T18's own coverage above: The Question's
// fixed shape (195 raw frames / 6.5s) is always well under the 15s MP4
// floor (MIN_POST_DURATION_FRAMES), so `padToMinimumDuration` ALWAYS
// extends the answer hold to fill it — with no narrationTimings, the
// fallback ANSWER_FRAMES (75) never survives as the real answer duration;
// it's padded to `MIN_POST_DURATION_FRAMES - wall.endFrame` (330 frames)
// every time. A narrationTimings duration that is ALSO under that same pad
// point therefore lands on the exact same padded total as the no-narration
// default — that's real, correct behavior (the 15s floor is a floor
// regardless of source), not something these tests should paper over. To
// prove a drifted timing set actually MOVES the boundary (this task's own
// acceptance criterion), the fixture durations below are chosen to clear
// the pad point, so the difference is real and not masked by padding.
describe('social pilot 02a T16 — narration-driven answer duration (F04)', () => {
	// The exact pad point below which any duration (whether the fallback or
	// a real narration timing) is masked by the 15s floor.
	const padPointFrames = MIN_POST_DURATION_FRAMES - WALL_FRAMES - Math.round(QUESTION_HOLD_SECONDS * FPS);

	it('with no narrationTimings supplied, the answer holds for the padded default (ANSWER_FRAMES extended to clear the 15s floor)', () => {
		const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });
		expect(timing.answer.endFrame - timing.answer.startFrame).toBe(padPointFrames);
		expect(padPointFrames).toBeGreaterThan(ANSWER_FRAMES);
	});

	it('respects a supplied narration timing that clears the 15s pad point instead of the padded default duration', () => {
		const narrationTimings = [{ startSeconds: 0, endSeconds: 14 }];
		const timing = computeQuestionTiming({ question: FIXTURE_QUESTION, narrationTimings });
		const expectedFrames = Math.round(14 * FPS);
		expect(timing.answer.endFrame - timing.answer.startFrame).toBe(expectedFrames);
		// Sanity: this is a real change from BOTH the bare fallback and the
		// padded default, not a coincidence.
		expect(expectedFrames).not.toBe(ANSWER_FRAMES);
		expect(expectedFrames).not.toBe(padPointFrames);
	});

	it('a DRIFTED narration timing set moves the on-screen answer-frame boundary — concrete frame numbers, not masked by the 15s pad floor', () => {
		const fixedTiming = computeQuestionTiming({ question: FIXTURE_QUESTION });
		// "Drifted" here means: real narration audio running a genuinely
		// different length than the fixed fallback would have produced — the
		// acceptance criterion this test exists to prove. Both durations
		// below (12s, 20s) clear the 15s pad point so the difference is real.
		const driftedShorter = computeQuestionTiming({
			question: FIXTURE_QUESTION,
			narrationTimings: [{ startSeconds: 0, endSeconds: 12 }]
		});
		const driftedLonger = computeQuestionTiming({
			question: FIXTURE_QUESTION,
			narrationTimings: [{ startSeconds: 0, endSeconds: 20 }]
		});

		// The answer phase starts at the same frame regardless (the wall
		// phase's own length never changes) — only its END, and therefore
		// totalFrames, moves.
		expect(driftedShorter.answer.startFrame).toBe(fixedTiming.answer.startFrame);
		expect(driftedLonger.answer.startFrame).toBe(fixedTiming.answer.startFrame);

		expect(driftedShorter.answer.endFrame).not.toBe(fixedTiming.answer.endFrame);
		expect(driftedLonger.answer.endFrame).not.toBe(fixedTiming.answer.endFrame);
		expect(driftedShorter.answer.endFrame).not.toBe(driftedLonger.answer.endFrame);

		expect(driftedLonger.answer.endFrame).toBeGreaterThan(driftedShorter.answer.endFrame);
		expect(driftedLonger.answer.endFrame).toBeGreaterThan(fixedTiming.answer.endFrame);
		expect(driftedLonger.totalFrames).toBeGreaterThan(fixedTiming.totalFrames);

		// Concrete frame numbers, for the record: fixed default answer window
		// is [120, 450); a 12s narrated answer is [120, 480); a 20s narrated
		// answer is [120, 720).
		expect(fixedTiming.answer.startFrame).toBe(120);
		expect(fixedTiming.answer.endFrame).toBe(450);
		expect(driftedShorter.answer.endFrame).toBe(480);
		expect(driftedLonger.answer.endFrame).toBe(720);
	});

	it('a very short narration timing (below the 15s pad point) is padded up to the same floor as the fixed-hold fallback — never left shorter than MIN_POST_DURATION_FRAMES', () => {
		const timing = computeQuestionTiming({
			question: FIXTURE_QUESTION,
			narrationTimings: [{ startSeconds: 0, endSeconds: 0.5 }]
		});
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBe(timing.answer.endFrame);
	});

	it('the question and wall phases are unaffected by narrationTimings — only the answer phase moves', () => {
		const fixedTiming = computeQuestionTiming({ question: FIXTURE_QUESTION });
		const narratedTiming = computeQuestionTiming({
			question: FIXTURE_QUESTION,
			narrationTimings: [{ startSeconds: 0, endSeconds: 14 }]
		});
		expect(narratedTiming.question).toEqual(fixedTiming.question);
		expect(narratedTiming.wall).toEqual(fixedTiming.wall);
	});
});

describe('T18 — the composed total clears the 15s MP4 duration floor', () => {
	it('the fixed shape (195 raw frames / 6.5s) is padded up to MIN_POST_DURATION_FRAMES, by extending only the answer hold', () => {
		const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);

		expect(timing.question.endFrame - timing.question.startFrame).toBe(QUESTION_HOLD_FRAMES);
		expect(timing.wall.endFrame - timing.wall.startFrame).toBe(WALL_FRAMES);
		expect(timing.answer.endFrame - timing.answer.startFrame).toBeGreaterThan(ANSWER_FRAMES);
		expect(timing.answer.motionless).toBe(true);
	});
});

describe('opening-frame layout', () => {
	it('computeQuestionLayout fits the fixture question well above the legibility floor', () => {
		const layout = computeQuestionLayout(FIXTURE_QUESTION);
		expect(layout.fontSize).toBeGreaterThan(0);
		expect(layout.lineHeight).toBeGreaterThan(layout.fontSize);
	});
});

describe('frame 0 renders ONLY the question — no label, no author, no counter, no archaic text', () => {
	const source = readFileSync(path.join(moduleDir, '..', 'Question.tsx'), 'utf-8');

	// Isolate the opening-phase branch's body: from `if (frame < timing.question.endFrame)`
	// up to (but excluding) the next phase's `if` — the archaic-wall branch.
	const openingStart = source.indexOf('if (frame < timing.question.endFrame)');
	const archaicStart = source.indexOf('if (frame < timing.wall.endFrame)');
	const openingBranch = source.slice(openingStart, archaicStart);

	it('the opening branch exists and precedes the archaic-wall branch', () => {
		expect(openingStart).toBeGreaterThan(-1);
		expect(archaicStart).toBeGreaterThan(openingStart);
	});

	it('never references originalExcerpt, WallPhase, accent, or a card counter in the opening branch', () => {
		expect(openingBranch).not.toMatch(/originalExcerpt/);
		expect(openingBranch).not.toMatch(/WallPhase/);
		expect(openingBranch).not.toMatch(/accent/);
		expect(openingBranch).not.toMatch(/Card \d/);
		expect(openingBranch).not.toMatch(/counter/i);
	});

	it('only renders the question text, via QuestionLine (props.answer is used only to validate, never rendered)', () => {
		expect(openingBranch).toMatch(/<QuestionLine text=\{props\.question\}\s*\/>/);
		// The gate call may reference `props.answer` (it validates the pair,
		// e.g. via `assertQuestionRenderable`) — but nothing in this branch
		// may put it inside JSX text content or a rendered prop.
		expect(openingBranch).not.toMatch(/<[^>]*\{props\.answer\}/);
		expect(openingBranch).not.toMatch(/>\s*\{props\.answer\}/);
	});
});

describe('source guard — no overshoot easing anywhere in Question.tsx', () => {
	const source = readFileSync(path.join(moduleDir, '..', 'Question.tsx'), 'utf-8');

	it('never calls spring(', () => {
		expect(source).not.toMatch(/\bspring\s*\(/);
	});

	it('never uses Easing.back, Easing.elastic, or Easing.bounce', () => {
		expect(source).not.toMatch(/Easing\.back/);
		expect(source).not.toMatch(/Easing\.elastic/);
		expect(source).not.toMatch(/Easing\.bounce/);
	});
});

/**
 * Strips `//` and `/* *\/` comments before scanning for forbidden
 * vocabulary. The house rule itself is documented IN comments (naming the
 * exact forbidden phrases, per the task's own instruction to "write them
 * down as a comment") — scanning raw source would flag that documentation
 * as a violation of the rule it's explaining. What must actually stay
 * clean is the renderable code: JSX, string literals, template strings.
 */
function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('source guard — never reads as testing the viewer', () => {
	const rawSource = readFileSync(path.join(moduleDir, '..', 'Question.tsx'), 'utf-8');
	const renderableSource = stripComments(rawSource).toLowerCase();

	it('has a non-empty forbidden-vocabulary list to check against', () => {
		expect(FORBIDDEN_TESTING_VOCABULARY.length).toBeGreaterThan(0);
	});

	it("the house rule's forbidden vocabulary is documented as a comment (per the task spec)", () => {
		// At least one forbidden phrase appears in the comments, proving the
		// rule is written down where a reader/reviewer will see it — the
		// other half of this guard (below) proves it never leaks into what
		// actually renders.
		const rawLower = rawSource.toLowerCase();
		const documented = FORBIDDEN_TESTING_VOCABULARY.some((phrase) => rawLower.includes(phrase.toLowerCase()));
		expect(documented).toBe(true);
	});

	for (const phrase of FORBIDDEN_TESTING_VOCABULARY) {
		it(`never contains "${phrase}" outside a comment`, () => {
			expect(renderableSource).not.toContain(phrase.toLowerCase());
		});
	}
});

describe('end-to-end smoke: renders real still frames at the key boundaries', () => {
	it(
		'renders frame 0 (question), mid-archaic, and the answer frame, each at 1080x1920',
		async () => {
			const timing = computeQuestionTiming({ question: FIXTURE_QUESTION });

			const inputProps = {
				question: FIXTURE_QUESTION,
				answer: FIXTURE_ANSWER,
				originalExcerpt: FIXTURE_ORIGINAL_EXCERPT,
				author: FIXTURE_AUTHOR
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
				id: 'Question',
				inputProps
			});

			const framesToCheck = [
				0,
				Math.floor((timing.wall.startFrame + timing.wall.endFrame) / 2),
				timing.answer.startFrame
			];

			for (const frame of framesToCheck) {
				const outPath = path.join(os.tmpdir(), `plain-question-still-${frame}-${Date.now()}.png`);
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
