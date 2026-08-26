import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { selectComposition } from '@remotion/renderer';

import { QUESTION_MIN_FONT } from '../question-timing.js';
import {
	gateQuestionCard,
	assertQuestionRenderable,
	QUESTION_MAX_WORDS,
	QUESTION_REFERENCE_VIEWPORT_WIDTH,
	QUESTION_MIN_LEGIBLE_FONT_PX,
	type QuestionGateInput
} from '../question-gate.js';
import { resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';

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

// --- The real Question pool, loaded straight from content/social/premises ---

interface QuestionPoolEntry {
	card_id: string;
	book_slug: string;
	author_slug: string;
	question: string;
	answer: string;
	drift_verdict: string;
	standalone_intelligible: boolean;
	answer_has_substance: boolean;
}

interface QuestionPool {
	entries: QuestionPoolEntry[];
}

function loadQuestionPool(): QuestionPool {
	return JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'question.json'), 'utf-8')
	) as QuestionPool;
}

const POOL = loadQuestionPool();

describe('QUESTION_MIN_LEGIBLE_FONT_PX', () => {
	it('is derived from the reference viewport and never hardcoded', () => {
		const expected = Math.ceil(28 * (1080 / QUESTION_REFERENCE_VIEWPORT_WIDTH));
		expect(QUESTION_MIN_LEGIBLE_FONT_PX).toBe(expected);
	});

	it('equals 78', () => {
		expect(QUESTION_MIN_LEGIBLE_FONT_PX).toBe(78);
	});

	it('sits far above the Wall body-text floor (39px) — a headline, not merely legible text', () => {
		expect(QUESTION_MIN_LEGIBLE_FONT_PX).toBeGreaterThanOrEqual(2 * 39);
	});

	it('sits strictly above QUESTION_MIN_FONT, so a total non-fit is also caught by the floor check', () => {
		expect(QUESTION_MIN_FONT).toBeLessThan(QUESTION_MIN_LEGIBLE_FONT_PX);
	});
});

describe('QUESTION_MAX_WORDS — the still-format 12-word rule', () => {
	it('is 12, per the index plan: "The 12-word rule still applies to STILL formats"', () => {
		expect(QUESTION_MAX_WORDS).toBe(12);
	});
});

describe('gateQuestionCard — word count rejection', () => {
	it('rejects a >12-word question even when every pool flag passes', () => {
		const input: QuestionGateInput = {
			question: 'This question has exactly thirteen words in it to trip the still format floor',
			answer: 'A real, substantive answer with real content in it.',
			drift_verdict: 'answers',
			standalone_intelligible: true,
			answer_has_substance: true
		};
		const result = gateQuestionCard(input);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.wordCount).toBeGreaterThan(QUESTION_MAX_WORDS);
			expect(result.reason).toContain(String(QUESTION_MAX_WORDS));
		}
	});

	it('a real pool entry that passes every flag but is 13 words is still rejected', () => {
		// discourses-50-008: drift_verdict "answers", standalone_intelligible
		// true, answer_has_substance true — but the question itself is 13
		// words, one over the still-format floor. Proves the word-count check
		// does real work beyond the pool's own flags.
		const entry = POOL.entries.find((e) => e.card_id === 'discourses-50-008');
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.question.split(/\s+/).length).toBe(13);

		const result = gateQuestionCard({
			question: entry.question,
			answer: entry.answer,
			drift_verdict: entry.drift_verdict,
			standalone_intelligible: entry.standalone_intelligible,
			answer_has_substance: entry.answer_has_substance
		});
		expect(result.ok).toBe(false);
	});

	it('assertQuestionRenderable throws naming the word count and the floor', () => {
		const input: QuestionGateInput = {
			question: 'This question has exactly thirteen words in it to trip the still format floor',
			answer: 'A real, substantive answer with real content in it.'
		};
		expect(() => assertQuestionRenderable(input)).toThrow(/12-word/);
	});
});

describe('gateQuestionCard — pool validation flags', () => {
	it('rejects the pool\'s own first recorded failure (standalone_intelligible: false)', () => {
		// meditations-04-015 — "Do you have reason?" / "Yes, I do." — is the
		// entry the task description calls out by name as a gate FAILURE
		// already recorded in content/social/premises/question.json.
		const entry = POOL.entries.find((e) => e.card_id === 'meditations-04-015');
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.standalone_intelligible).toBe(false);

		const result = gateQuestionCard({
			question: entry.question,
			answer: entry.answer,
			drift_verdict: entry.drift_verdict,
			standalone_intelligible: entry.standalone_intelligible,
			answer_has_substance: entry.answer_has_substance
		});
		expect(result.ok).toBe(false);
	});

	it('rejects any entry whose drift_verdict is not "answers"', () => {
		const driftedEntry = POOL.entries.find((e) => e.drift_verdict !== 'answers');
		expect(driftedEntry).toBeDefined();
		if (!driftedEntry) return;

		const result = gateQuestionCard({
			question: driftedEntry.question,
			answer: driftedEntry.answer,
			drift_verdict: driftedEntry.drift_verdict,
			standalone_intelligible: driftedEntry.standalone_intelligible,
			answer_has_substance: driftedEntry.answer_has_substance
		});
		expect(result.ok).toBe(false);
	});

	it('rejects any entry with answer_has_substance: false', () => {
		const noSubstanceEntry = POOL.entries.find((e) => e.answer_has_substance === false);
		expect(noSubstanceEntry).toBeDefined();
		if (!noSubstanceEntry) return;

		const result = gateQuestionCard({
			question: noSubstanceEntry.question,
			answer: noSubstanceEntry.answer,
			drift_verdict: noSubstanceEntry.drift_verdict,
			standalone_intelligible: noSubstanceEntry.standalone_intelligible,
			answer_has_substance: noSubstanceEntry.answer_has_substance
		});
		expect(result.ok).toBe(false);
	});
});

// F16 (2026-08-26): swapped from discourses-18-010 ("What is a master
// anyway?"), whose 152-word archaic excerpt no longer clears
// `wall-gate.ts`'s new travel floor at the smaller 76px/500px-s geometry
// (blockHeight 3040px, under the 3170px floor) — see
// `question-timing.test.ts`'s matching fixture comment for the numbers.
// discourses-64-006's 176-word excerpt clears it with real margin
// (blockHeight 3420px).
describe('gateQuestionCard — a REAL validated pool entry passes', () => {
	it('discourses-64-006 ("You want me to trust you with my business?") passes every check', () => {
		const entry = POOL.entries.find((e) => e.card_id === 'discourses-64-006');
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.drift_verdict).toBe('answers');
		expect(entry.standalone_intelligible).toBe(true);
		expect(entry.answer_has_substance).toBe(true);

		const result = gateQuestionCard({
			question: entry.question,
			answer: entry.answer,
			drift_verdict: entry.drift_verdict,
			standalone_intelligible: entry.standalone_intelligible,
			answer_has_substance: entry.answer_has_substance
		});
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.layout.fontSize).toBeGreaterThanOrEqual(QUESTION_MIN_LEGIBLE_FONT_PX);
		}
	});

	it('also resolves and gates its archaic excerpt via the Wall gate (reused, not re-derived)', async () => {
		const { gateWallCard } = await import('../wall-gate.js');
		const entry: WallPoolEntry = { card_id: 'discourses-64-006', book_slug: 'discourses' };
		const excerpt = resolveWallCardExcerpt(entry, outputDir);
		const result = gateWallCard(excerpt);
		expect(result.ok).toBe(true);
	});
});

describe('surveying the real 88-entry pool', () => {
	it('reports how many of the 88 pool entries pass the full gate (word count, floor, and pool flags)', () => {
		expect(POOL.entries.length).toBe(88);

		let passed = 0;
		const rejectedIds: string[] = [];
		for (const entry of POOL.entries) {
			const result = gateQuestionCard({
				question: entry.question,
				answer: entry.answer,
				drift_verdict: entry.drift_verdict,
				standalone_intelligible: entry.standalone_intelligible,
				answer_has_substance: entry.answer_has_substance
			});
			if (result.ok) {
				passed++;
			} else {
				rejectedIds.push(entry.card_id);
			}
		}

		// eslint-disable-next-line no-console
		console.log(`question gate: ${passed}/${POOL.entries.length} pool entries pass (rejected: ${rejectedIds.length})`);

		// 48 of 88 — the 51 entries that pass the pool's own drift/standalone/
		// substance flags, minus the 3 of those that are 13 words and so fail
		// the still-format 12-word rule this gate adds on top.
		expect(passed).toBe(48);
		expect(passed + rejectedIds.length).toBe(POOL.entries.length);
	});
});

describe('the composition path surfaces the rejection (T07 wiring)', () => {
	it(
		'selectComposition throws for a >12-word question, before any frame renders',
		async () => {
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
					id: 'Question',
					inputProps: {
						question: 'This question has exactly thirteen words in it to trip the still format floor',
						answer: 'A real, substantive answer with real content in it.',
						originalExcerpt: 'This is placeholder archaic text standing in for a real card excerpt.',
						author: 'marcus-aurelius'
					}
				})
			).rejects.toThrow(/12-word/);
		},
		120_000
	);
});
