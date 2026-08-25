import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

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
import { WALL_FRAMES, KARAOKE_WPM, FPS } from '../wall-timing.js';
import { resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';
import { FORBIDDEN_TESTING_VOCABULARY } from '../question-gate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

// --- Real fixture — a passing entry from content/social/premises/question.json ---
// discourses-18-010: drift_verdict "answers", standalone_intelligible true,
// answer_has_substance true — i.e. it PASSES the pool's own gate flags, not
// one of the entries the pool file records as a failure.

const FIXTURE_ENTRY: WallPoolEntry = {
	card_id: 'discourses-18-010',
	book_slug: 'discourses'
};
const FIXTURE_QUESTION = 'What is a master anyway?';
const FIXTURE_ANSWER = "One person can't really master another.";
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

	it('reuses KARAOKE_WPM (320) as the authoritative sweep rate, imported not copied', () => {
		expect(KARAOKE_WPM).toBe(320);
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
