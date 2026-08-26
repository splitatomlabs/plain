/**
 * F05/F06: proves the committed artifact
 * `content/social/render-exclusions.json` (written by
 * `social/scripts/write-exclusions.ts`) matches what freshly running each
 * format's renderer gate computes RIGHT NOW against the real
 * `content/social/premises/{wall,question,objection}.json` pools and
 * `content/output/` corpus — so a corpus edit, a re-scored pool, or a
 * `wall-gate.ts`/`question-gate.ts`/`objection-gate.ts` constant change can
 * never silently leave the committed exclusion list stale (the scheduler,
 * `scripts/lib/schedule.ts`, trusts this file verbatim; a stale file would
 * either schedule an un-renderable card again or needlessly drop a
 * now-renderable one).
 *
 * The final `describe` block is the M2 regression proof specifically: it
 * independently re-derives the READ-THROUGH's own landing line for every
 * card of the read-through slice (`selectLandingLine(plainEnglish)` — the
 * same derivation `scripts/lib/schedule.ts`'s `tryReadThroughContent` uses,
 * NOT a scored Wall pool entry's `rubric.chosen_landing_line` — with NO `??
 * plainEnglish` fallback, social pilot 02a T02/T04: a card with no
 * qualifying landing line is excluded on that basis alone, never gated
 * against `gateWallCard`'s duration ceilings, matching the real
 * scheduler which never gets that far for such a card either) and asserts
 * every slice card is EITHER on the committed `read_through` exclusion list
 * OR passes that derivation — the assertion that would have caught M2 (a
 * card absent from the Wall pool survey, or surveyed with the wrong landing
 * line, silently slipping through as schedulable).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surveyWallPool, loadBookCards, resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';
import { computeWallPlainLines } from '../../cli-plan.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../duration-bounds.js';
import { gateWallCard } from '../wall-gate.js';
import { gateQuestionCard, QUESTION_MIN_LEGIBLE_FONT_PX, QUESTION_MAX_WORDS } from '../question-gate.js';
import { gateObjectionCard, OBJECTION_MIN_LEGIBLE_FONT_PX } from '../objection-gate.js';
import { selectLandingLine } from '../landing-line.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

interface PoolFile<T> {
	entries: T[];
}

interface QuestionPoolEntry {
	card_id: string;
	book_slug: string;
	question: string;
	answer: string;
	drift_verdict?: string;
	standalone_intelligible?: boolean;
	answer_has_substance?: boolean;
}

interface ObjectionPoolEntry {
	card_id: string;
	book_slug: string;
	objection: string;
	reply: string;
	rubric?: { verdict?: string; classification?: string };
}

interface ExclusionEntry {
	card_id: string;
	book_slug: string;
	axis: string;
	reason: string;
}

interface ExclusionsFile {
	meta: {
		generated_at: string;
		max_post_duration_frames: number;
		max_post_duration_seconds: number;
		question_min_legible_font_px: number;
		question_max_words: number;
		objection_min_legible_font_px: number;
		read_through_book: string;
		read_through_chapters: string[];
		wall: { submitted: number; succeeded: number; dropped: number };
		question: { submitted: number; succeeded: number; dropped: number };
		objection: { submitted: number; succeeded: number; dropped: number };
		read_through: { submitted: number; succeeded: number; dropped: number };
	};
	wall: ExclusionEntry[];
	question: ExclusionEntry[];
	objection: ExclusionEntry[];
	read_through: ExclusionEntry[];
}

function loadJson<T>(...parts: string[]): T {
	return JSON.parse(readFileSync(path.join(repoRoot, ...parts), 'utf-8')) as T;
}

const wallPool = loadJson<PoolFile<WallPoolEntry>>('content', 'social', 'premises', 'wall.json');
const questionPool = loadJson<PoolFile<QuestionPoolEntry>>('content', 'social', 'premises', 'question.json');
const objectionPool = loadJson<PoolFile<ObjectionPoolEntry>>('content', 'social', 'premises', 'objection.json');
const committed = loadJson<ExclusionsFile>('content', 'social', 'render-exclusions.json');

describe('content/social/render-exclusions.json matches a fresh survey — Wall', () => {
	const survey = surveyWallPool(wallPool.entries, outputDir);

	it('records the same constants the gate is currently computed against', () => {
		expect(committed.meta.max_post_duration_frames).toBe(MAX_POST_DURATION_FRAMES);
		expect(committed.meta.max_post_duration_seconds).toBe(MAX_POST_DURATION_SECONDS);
	});

	it('meta counts match a fresh survey of the same pool', () => {
		expect(committed.meta.wall.submitted).toBe(wallPool.entries.length);
		expect(committed.meta.wall.succeeded).toBe(survey.passed);
		expect(committed.meta.wall.dropped).toBe(survey.rejectedForDuration);
		expect(committed.wall.length).toBe(committed.meta.wall.dropped);
	});

	it('the exact set of excluded ids matches a fresh survey — the committed artifact is not stale', () => {
		const committedIds = new Set(committed.wall.map((e) => e.card_id));
		const surveyedIds = new Set(survey.rejectedIds);
		expect(committedIds).toEqual(surveyedIds);
	});

	it('every committed exclusion carries the same axis a fresh survey reports for that card', () => {
		const freshAxisById = new Map(survey.rejections.map((r) => [r.card_id, r.axis]));
		for (const entry of committed.wall) {
			expect(freshAxisById.get(entry.card_id)).toBe(entry.axis);
		}
	});

	it('includes the real over-long card this fix targets (on-anger-03-027)', () => {
		const entry = committed.wall.find((e) => e.card_id === 'on-anger-03-027');
		expect(entry).toBeDefined();
		expect(entry?.axis).toBe('duration');
	});
});

describe('content/social/render-exclusions.json matches a fresh survey — Question (F06)', () => {
	// F16 (2026-08-26): `survey()` here must mirror `write-exclusions.ts`'s
	// `surveyQuestion` EXACTLY, including its post-F16 addition — checking
	// the reused Wall gate against each entry's archaic excerpt, not just
	// `gateQuestionCard`'s own checks — or this test just re-proves the
	// STALE pre-F16 logic against itself. See that function's own doc
	// comment for why the reused check is no longer safe to omit.
	function survey() {
		const rejections: ExclusionEntry[] = [];
		let passed = 0;
		for (const entry of questionPool.entries) {
			const result = gateQuestionCard({
				question: entry.question,
				answer: entry.answer,
				drift_verdict: entry.drift_verdict,
				standalone_intelligible: entry.standalone_intelligible,
				answer_has_substance: entry.answer_has_substance
			});
			if (!result.ok) {
				rejections.push({ card_id: entry.card_id, book_slug: entry.book_slug, axis: result.axis, reason: result.reason });
				continue;
			}
			const excerpt = resolveWallCardExcerpt({ card_id: entry.card_id, book_slug: entry.book_slug }, outputDir);
			const wallResult = gateWallCard(excerpt);
			if (wallResult.ok) {
				passed++;
			} else {
				rejections.push({
					card_id: entry.card_id,
					book_slug: entry.book_slug,
					axis: `wall_${wallResult.failure}`,
					reason: `Question card's archaic excerpt fails the reused Wall gate: ${wallResult.reason}`
				});
			}
		}
		return { passed, rejections };
	}

	it('records the same constants the gate is currently computed against', () => {
		expect(committed.meta.question_min_legible_font_px).toBe(QUESTION_MIN_LEGIBLE_FONT_PX);
		expect(committed.meta.question_max_words).toBe(QUESTION_MAX_WORDS);
	});

	it('meta counts and excluded ids match a fresh survey of the same pool', () => {
		const { passed, rejections } = survey();
		expect(committed.meta.question.submitted).toBe(questionPool.entries.length);
		expect(committed.meta.question.succeeded).toBe(passed);
		expect(committed.meta.question.dropped).toBe(rejections.length);
		expect(committed.question.length).toBe(rejections.length);

		const committedIds = new Set(committed.question.map((e) => e.card_id));
		const surveyedIds = new Set(rejections.map((r) => r.card_id));
		expect(committedIds).toEqual(surveyedIds);

		const freshAxisById = new Map(rejections.map((r) => [r.card_id, r.axis]));
		for (const entry of committed.question) {
			expect(freshAxisById.get(entry.card_id)).toBe(entry.axis);
		}
	});

	it('includes the real M1 fixture (discourses-50-008 — 13 words, over the 12-word still-format floor)', () => {
		const entry = committed.question.find((e) => e.card_id === 'discourses-50-008');
		expect(entry).toBeDefined();
		expect(entry?.axis).toBe('word_count');
	});
});

describe('content/social/render-exclusions.json matches a fresh survey — Objection (F06)', () => {
	function survey() {
		const rejections: ExclusionEntry[] = [];
		let passed = 0;
		for (const entry of objectionPool.entries) {
			const result = gateObjectionCard({
				objection: entry.objection,
				reply: entry.reply,
				verdict: entry.rubric?.verdict,
				classification: entry.rubric?.classification
			});
			if (result.ok) {
				passed++;
			} else {
				rejections.push({ card_id: entry.card_id, book_slug: entry.book_slug, axis: result.axis, reason: result.reason });
			}
		}
		return { passed, rejections };
	}

	it('records the same constant the gate is currently computed against', () => {
		expect(committed.meta.objection_min_legible_font_px).toBe(OBJECTION_MIN_LEGIBLE_FONT_PX);
	});

	it('meta counts and excluded ids match a fresh survey of the same pool', () => {
		const { passed, rejections } = survey();
		expect(committed.meta.objection.submitted).toBe(objectionPool.entries.length);
		expect(committed.meta.objection.succeeded).toBe(passed);
		expect(committed.meta.objection.dropped).toBe(rejections.length);
		expect(committed.objection.length).toBe(rejections.length);

		const committedIds = new Set(committed.objection.map((e) => e.card_id));
		const surveyedIds = new Set(rejections.map((r) => r.card_id));
		expect(committedIds).toEqual(surveyedIds);

		const freshAxisById = new Map(rejections.map((r) => [r.card_id, r.axis]));
		for (const entry of committed.objection) {
			expect(freshAxisById.get(entry.card_id)).toBe(entry.axis);
		}
	});
});

// ---------------------------------------------------------------------------
// F06 (M2): the read-through slice — this is the assertion that would have
// caught M2. Independently rebuilds the read-through's own card sequence
// and its own landing-line derivation (never a scored Wall pool entry's
// `rubric.chosen_landing_line`), so a card the committed artifact's
// `read_through` section doesn't cover is only acceptable if it ALSO
// independently passes `gateWallCard` under that same derivation.
// ---------------------------------------------------------------------------
describe('content/social/render-exclusions.json — the read-through slice (F06/M2)', () => {
	function buildSlice(): ReturnType<typeof loadBookCards> {
		const bookCards = loadBookCards(committed.meta.read_through_book, outputDir);
		const chapters = committed.meta.read_through_chapters;
		if (!chapters || chapters.length === 0) return bookCards;
		const byChapter = new Map<string, typeof bookCards>();
		for (const c of bookCards) {
			const key = String(c.chapter_slug);
			if (!byChapter.has(key)) byChapter.set(key, []);
			byChapter.get(key)!.push(c);
		}
		const sequence: typeof bookCards = [];
		for (const chapterSlug of chapters) {
			const group = byChapter.get(chapterSlug) ?? [];
			sequence.push(...[...group].sort((a, b) => Number(a.card_number) - Number(b.card_number)));
		}
		return sequence;
	}

	const slice = buildSlice();

	it('grounds this suite\'s own numbers: the default Meditations Books 2-3 slice is 48 cards', () => {
		expect(committed.meta.read_through_book).toBe('meditations');
		expect(committed.meta.read_through_chapters).toEqual(['book-02', 'book-03']);
		expect(slice.length).toBe(48);
	});

	it('meta counts match a fresh survey of the slice', () => {
		expect(committed.meta.read_through.submitted).toBe(slice.length);
		expect(committed.meta.read_through.dropped).toBe(committed.read_through.length);
	});

	/**
	 * Re-derives one slice card's verdict exactly as `write-exclusions.ts`'s
	 * `surveyReadThrough` does (social pilot 02a T04): no `?? plainEnglish`
	 * fallback — a card with no qualifying landing line is rejected on that
	 * basis alone, never reaching `gateWallCard`'s duration checks,
	 * matching `scripts/lib/schedule.ts`'s `tryReadThroughContent`.
	 */
	function rederiveOk(card: (typeof slice)[number]): boolean {
		const plainEnglish = String(card.plain_english);
		const landingLine = selectLandingLine(plainEnglish);
		if (landingLine === null) return false;
		const plainLines = computeWallPlainLines(plainEnglish, landingLine);
		const result = gateWallCard(card.original_excerpt, { plainEnglish, landingLine, plainLines });
		return result.ok;
	}

	it('every read-through slice card is EITHER on the committed exclusion list OR independently passes gateWallCard under the READ-THROUGH\'s own landing-line derivation', () => {
		const excludedIds = new Set(committed.read_through.map((e) => e.card_id));
		const wrongfullyPermitted: string[] = [];

		for (const card of slice) {
			if (excludedIds.has(card.id)) continue;
			if (!rederiveOk(card)) {
				wrongfullyPermitted.push(card.id);
			}
		}

		expect(wrongfullyPermitted).toEqual([]);
	});

	it('every committed read-through exclusion is verified: a fresh survey (read-through derivation) also rejects it', () => {
		for (const entry of committed.read_through) {
			const card = slice.find((c) => c.id === entry.card_id);
			expect(card).toBeDefined();
			if (!card) continue;
			expect(rederiveOk(card)).toBe(false);
		}
	});
});
