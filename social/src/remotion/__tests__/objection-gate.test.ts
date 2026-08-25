import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { bundle } from '@remotion/bundler';
import { selectComposition } from '@remotion/renderer';

import { splitPayoffLines } from '../../audio/timing.js';
import {
	gateObjectionCard,
	assertObjectionRenderable,
	orderObjectionPool,
	surveyObjectionPool,
	DISCOURSE_CONNECTIVES,
	OBJECTION_REFERENCE_VIEWPORT_WIDTH,
	OBJECTION_MIN_LEGIBLE_FONT_PX,
	OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX,
	type ObjectionGateInput,
	type ObjectionPoolSurveyEntry
} from '../objection-gate.js';
import { OBJECTION_MIN_FONT } from '../objection-timing.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

// --- The real Objection pool, loaded straight from content/social/premises ---

function loadObjectionPool(): { entries: ObjectionPoolSurveyEntry[] } {
	return JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'objection.json'), 'utf-8')
	) as { entries: ObjectionPoolSurveyEntry[] };
}

const POOL = loadObjectionPool();

describe('OBJECTION_MIN_LEGIBLE_FONT_PX', () => {
	it('is derived from the reference viewport and never hardcoded', () => {
		const expected = Math.ceil(28 * (1080 / OBJECTION_REFERENCE_VIEWPORT_WIDTH));
		expect(OBJECTION_MIN_LEGIBLE_FONT_PX).toBe(expected);
	});

	it('equals 78 — the same headline floor as The Question uses for its own frame 0', () => {
		expect(OBJECTION_MIN_LEGIBLE_FONT_PX).toBe(78);
	});

	it('sits strictly above OBJECTION_MIN_FONT, so a total non-fit is also caught by the floor check', () => {
		expect(OBJECTION_MIN_FONT).toBeLessThan(OBJECTION_MIN_LEGIBLE_FONT_PX);
	});

	it('sits comfortably above the 18px/14px-bold floor docs/BRANDING.md sets for accent-coloured text', () => {
		expect(OBJECTION_MIN_LEGIBLE_FONT_PX).toBeGreaterThan(18);
	});
});

describe('OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX', () => {
	it('reuses the Wall body-text floor (39px) rather than inventing a second number', () => {
		expect(OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX).toBe(39);
	});
});

describe('DISCOURSE_CONNECTIVES', () => {
	it('is a non-empty, named, exported list', () => {
		expect(DISCOURSE_CONNECTIVES.length).toBeGreaterThan(0);
	});

	it('contains the canonical continuation words', () => {
		for (const word of ['But', 'So', 'Therefore', 'Yet', 'However', 'And', 'Because']) {
			expect(DISCOURSE_CONNECTIVES).toContain(word);
		}
	});
});

describe('gateObjectionCard — the two-sentence cap and rejection rule', () => {
	const BASE: Omit<ObjectionGateInput, 'reply'> = {
		objection: 'Is that really so bad?',
		verdict: 'accept',
		classification: 'viewer_position'
	};

	it('a clean two-sentence reply passes, and the returned lines are VERBATIM, ending in terminal punctuation', () => {
		const reply = 'This is the first sentence. This is the second sentence. A third, unrelated sentence follows.';
		const result = gateObjectionCard({ ...BASE, reply });
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		const expectedSentences = splitPayoffLines(reply);
		expect(result.replyLines).toEqual([expectedSentences[0], expectedSentences[1]]);
		expect(result.replyLines[0]).toBe('This is the first sentence.');
		expect(result.replyLines[1]).toBe('This is the second sentence.');
		for (const line of result.replyLines) {
			expect(line).toMatch(/[.!?]$/);
			// VERBATIM — every returned line is a real substring of the source reply.
			expect(reply).toContain(line);
		}
	});

	it('a one-sentence reply is rejected, not padded or shown alone', () => {
		const result = gateObjectionCard({ ...BASE, reply: 'Only one sentence here.' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/only 1 complete sentence/);
	});

	it('an empty reply is rejected', () => {
		const result = gateObjectionCard({ ...BASE, reply: '' });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/only 0 complete sentence/);
	});

	it('a reply whose third sentence starts with a connective ("But") is rejected — leaving the argument hanging', () => {
		const reply = 'First sentence here. Second sentence here. But this continues the exact same argument.';
		const result = gateObjectionCard({ ...BASE, reply });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/discourse connective "But"/);
	});

	it('a reply whose third sentence starts with a connective ("Therefore") is also rejected', () => {
		const reply = 'First sentence here. Second sentence here. Therefore this is a continuation, not a new thought.';
		const result = gateObjectionCard({ ...BASE, reply });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/discourse connective "Therefore"/);
	});

	it('a reply whose third sentence is a genuinely fresh thought (no connective) passes', () => {
		const reply = 'First sentence here. Second sentence here. Completely unrelated new thought follows.';
		const result = gateObjectionCard({ ...BASE, reply });
		expect(result.ok).toBe(true);
	});

	it('REJECTS rather than truncates: a synthetic reply that would be cut mid-argument is never trimmed to two lines', () => {
		// The whole point of the two-sentence cap's rejection rule: a reply
		// whose sentence 3 continues sentence 2's thought must never be
		// silently shown as if the cap were the actual end of the argument.
		const midArgumentReply =
			'Revenge feels satisfying in the moment. It seems to settle the score. ' +
			'But that satisfaction fades and leaves you worse off than before.';
		const result = gateObjectionCard({ ...BASE, reply: midArgumentReply });
		expect(result.ok).toBe(false);
	});

	it('a reply ending mid-sentence (no terminal punctuation on sentence two) is rejected, never emitted as a partial sentence', () => {
		// splitPayoffLines emits an unterminated final fragment verbatim (see
		// that function's own doc comment) — this reply is built so that
		// fragment lands as sentence two.
		const reply = 'This is the first, complete sentence. This second one has no ending punctuation';
		const sentences = splitPayoffLines(reply);
		expect(sentences.length).toBe(2);
		expect(sentences[1]).not.toMatch(/[.!?]$/);

		const result = gateObjectionCard({ ...BASE, reply });
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/terminal punctuation boundary/);
	});
});

describe('gateObjectionCard — pool rubric flags', () => {
	const BASE_REPLY = 'This is the first sentence. This is the second sentence. A third sentence follows, unrelated.';

	it('rejects a "reject" verdict even when the reply structure is otherwise clean', () => {
		const result = gateObjectionCard({
			objection: 'Anything.',
			reply: BASE_REPLY,
			verdict: 'reject',
			classification: 'viewer_position'
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/verdict is "reject"/);
	});

	it('rejects a "dramatized_scene" classification — a line spoken by a character in a scene, not a viewer position', () => {
		const result = gateObjectionCard({
			objection: 'Anything.',
			reply: BASE_REPLY,
			verdict: 'accept',
			classification: 'dramatized_scene'
		});
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.reason).toMatch(/"dramatized_scene"/);
	});

	it('rejects a "doctrinal_dispute" classification', () => {
		const result = gateObjectionCard({
			objection: 'Anything.',
			reply: BASE_REPLY,
			verdict: 'accept',
			classification: 'doctrinal_dispute'
		});
		expect(result.ok).toBe(false);
	});

	it('a real pool entry recorded as "reject"/"dramatized_scene" is rejected by the gate', () => {
		const entry = POOL.entries.find(
			(e) => e.rubric.verdict === 'reject' && e.rubric.classification === 'dramatized_scene'
		);
		expect(entry).toBeDefined();
		if (!entry) return;

		const result = gateObjectionCard({
			objection: entry.objection,
			reply: entry.reply,
			verdict: entry.rubric.verdict,
			classification: entry.rubric.classification
		});
		expect(result.ok).toBe(false);
	});

	it('a real pool entry recorded as "reject"/"doctrinal_dispute" is rejected by the gate', () => {
		const entry = POOL.entries.find(
			(e) => e.rubric.verdict === 'reject' && e.rubric.classification === 'doctrinal_dispute'
		);
		expect(entry).toBeDefined();
		if (!entry) return;

		const result = gateObjectionCard({
			objection: entry.objection,
			reply: entry.reply,
			verdict: entry.rubric.verdict,
			classification: entry.rubric.classification
		});
		expect(result.ok).toBe(false);
	});
});

describe('gateObjectionCard — reply is used verbatim, never re-sliced by reply_start', () => {
	it('reply_start indexes into the source card plain_english, not into `reply` — the pool `reply` field is already the correct text', () => {
		// on-anger-02-087: reply_start (33) is larger than a naive
		// `reply.slice(reply_start)` could sensibly consume without special
		// knowledge of the source card — proof this gate must NOT apply
		// reply_start to its own `reply` field.
		const entry = POOL.entries.find((e) => e.card_id === 'on-anger-02-087');
		expect(entry).toBeDefined();
		if (!entry) return;
		expect(entry.reply_start).toBeGreaterThan(0);

		const result = gateObjectionCard({
			objection: entry.objection,
			reply: entry.reply,
			verdict: entry.rubric.verdict,
			classification: entry.rubric.classification
		});
		// This entry's reply, used AS GIVEN, yields two real sentences.
		expect(result.ok).toBe(true);
	});

	it('every pool entry\'s `reply` field is byte-identical to its source card\'s plain_english sliced at reply_start', () => {
		const outputDir = path.join(repoRoot, 'content', 'output');
		const bookCache = new Map<string, Map<string, { plain_english: string }>>();

		function loadBook(bookSlug: string): Map<string, { plain_english: string }> {
			const cached = bookCache.get(bookSlug);
			if (cached) return cached;
			const bookDir = path.join(outputDir, bookSlug);
			const index = new Map<string, { plain_english: string }>();
			for (const file of readdirSync(bookDir).filter((f) => f.endsWith('.json') && f !== '_meta.json')) {
				const cards = JSON.parse(readFileSync(path.join(bookDir, file), 'utf-8')) as Array<{
					id: string;
					plain_english: string;
				}>;
				for (const card of cards) {
					index.set(card.id, card);
				}
			}
			bookCache.set(bookSlug, index);
			return index;
		}

		for (const entry of POOL.entries) {
			const card = loadBook(entry.book_slug).get(entry.card_id);
			expect(card).toBeDefined();
			if (!card) continue;
			expect(card.plain_english.slice(entry.reply_start).trim()).toBe(entry.reply);
		}
	});
});

describe('assertObjectionRenderable', () => {
	it('throws naming the rejection reason', () => {
		expect(() =>
			assertObjectionRenderable({
				objection: 'Anything.',
				reply: 'Only one sentence.'
			})
		).toThrow(/only 1 complete sentence/);
	});

	it('returns the gate payload for a passing card', () => {
		const reply = 'This is the first sentence. This is the second sentence. A third, unrelated sentence follows.';
		const result = assertObjectionRenderable({
			objection: 'Is that really so bad?',
			reply,
			verdict: 'accept',
			classification: 'viewer_position'
		});
		expect(result.replyLines).toHaveLength(2);
	});
});

describe('orderObjectionPool — LEAD WITH ON ANGER', () => {
	it('puts every On Anger entry ahead of every other entry', () => {
		const ordered = orderObjectionPool(POOL.entries);
		const firstNonOnAngerIndex = ordered.findIndex((e) => e.book_slug !== 'on-anger');
		expect(firstNonOnAngerIndex).toBeGreaterThan(-1);
		for (let i = 0; i < firstNonOnAngerIndex; i++) {
			expect(ordered[i].book_slug).toBe('on-anger');
		}
		for (let i = firstNonOnAngerIndex; i < ordered.length; i++) {
			expect(ordered[i].book_slug).not.toBe('on-anger');
		}
	});

	it('is stable within the On Anger group — same relative order as the input', () => {
		const ordered = orderObjectionPool(POOL.entries);
		const onAngerIds = POOL.entries.filter((e) => e.book_slug === 'on-anger').map((e) => e.card_id);
		const orderedOnAngerIds = ordered.filter((e) => e.book_slug === 'on-anger').map((e) => e.card_id);
		expect(orderedOnAngerIds).toEqual(onAngerIds);
	});

	it('is stable within the non-On-Anger group — same relative order as the input', () => {
		const ordered = orderObjectionPool(POOL.entries);
		const restIds = POOL.entries.filter((e) => e.book_slug !== 'on-anger').map((e) => e.card_id);
		const orderedRestIds = ordered.filter((e) => e.book_slug !== 'on-anger').map((e) => e.card_id);
		expect(orderedRestIds).toEqual(restIds);
	});

	it('never drops or duplicates an entry — same multiset of ids as the input (a few card ids legitimately repeat, e.g. two distinct objections quoted from the same card)', () => {
		const ordered = orderObjectionPool(POOL.entries);
		expect(ordered.length).toBe(POOL.entries.length);
		expect(ordered.map((e) => e.card_id).sort()).toEqual(POOL.entries.map((e) => e.card_id).sort());
	});
});

describe('surveying the real 59-entry pool', () => {
	it('reports how many of the 59 pool entries pass the full gate, and how many of those are On Anger', () => {
		expect(POOL.entries.length).toBe(59);

		const result = surveyObjectionPool(POOL.entries);

		// eslint-disable-next-line no-console
		console.log(
			`objection gate: ${result.passed}/${result.total} pool entries pass ` +
				`(${result.onAngerPassed} of those are On Anger; rejected: ${result.rejected})`
		);

		expect(result.total).toBe(59);
		expect(result.passed + result.rejected).toBe(59);
		// 31 of the 59 entries carry rubric.verdict "accept" and
		// rubric.classification "viewer_position"; of those, 27 also survive
		// the two-sentence cap's rejection rules (empty/one-sentence replies,
		// or a hanging third sentence) and the legibility floor — none of the
		// 31 fail on legibility alone. 9 of the 27 survivors are On Anger.
		expect(result.passed).toBe(27);
		expect(result.onAngerPassed).toBe(9);
	});

	it('every rejected id is a real pool id', () => {
		const result = surveyObjectionPool(POOL.entries);
		const poolIds = new Set(POOL.entries.map((e) => e.card_id));
		for (const id of result.rejectedIds) {
			expect(poolIds.has(id)).toBe(true);
		}
	});
});

describe('the composition path surfaces the rejection (T08 wiring)', () => {
	it(
		'selectComposition throws for a one-sentence reply, before any frame renders',
		async () => {
			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
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
					id: 'Objection',
					inputProps: {
						objection: 'Anything.',
						reply: 'Only one sentence.',
						author: 'seneca'
					}
				})
			).rejects.toThrow(/only 1 complete sentence/);
		},
		120_000
	);
});
