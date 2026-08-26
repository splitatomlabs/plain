/**
 * social pilot 02a T05: the chapter-text loader — `chapter-text.ts` is the
 * module that sources the wall's scrolling block from the surrounding
 * CHAPTER, not the single card (see `plans/Pf39c2-social-pilot-02a.md`,
 * "the wall is sourced from the CHAPTER, not the card" and its "CONSTRAINT 6
 * AMENDMENT"). This file is written AHEAD of T06's real implementation —
 * `chapter-text.ts` today is an empty stub whose exports throw, so every
 * test below is expected to FAIL until T06 lands (that failure is this
 * task's own acceptance criterion, not a defect in this file).
 *
 * What must hold once T06 implements it:
 *   1. The block STARTS at the target card's own `original_excerpt`.
 *   2. It CONTINUES with the FOLLOWING cards' `original_excerpt`, in
 *      document order (`card_number` ascending within the chapter).
 *   3. It WRAPS to the chapter's own PRECEDING cards once it reaches the
 *      chapter's end — one full lap, reordered to start at the target.
 *   4. It never draws from another chapter or book, even when the input
 *      cards include them.
 *   5. It returns enough text to clear the travel requirement
 *      (`WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`, `wall-gate.ts`) for EVERY card in
 *      the real read-through slice (Meditations Books 2-3, 48 cards) — this
 *      is the whole point of sourcing from the chapter instead of the card.
 *   6. The text is VERBATIM and UNMODIFIED — no fabrication, no paraphrase,
 *      no reordering within an excerpt; the block is nothing but the
 *      expected excerpts themselves, in the expected order, with only
 *      whitespace between them.
 */
import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildChapterTextBlock, loadChapterTextBlock, type ChapterTextCard } from '../chapter-text.js';
import { loadBookCards } from '../../remotion/wall-pool.js';
import { computeWallLayout } from '../../remotion/wall-timing.js';
import { WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX } from '../../remotion/wall-gate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/render/__tests__` -> `render` -> `src` -> `social` -> repo root — same depth as `remotion/__tests__`'s own `repoRoot`. */
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

// ---------------------------------------------------------------------------
// Shared assertion: the block is EXACTLY the given excerpts, in order, with
// nothing but whitespace between/around them. Proves start position,
// continuation order, wrap-around order, and verbatim/unmodified text all at
// once — a fabricated word, a paraphrase, a dropped excerpt, a reordering,
// or an excerpt from the wrong chapter would all fail this.
// ---------------------------------------------------------------------------
function expectExactExcerptSequence(block: string, excerpts: string[]): void {
	let remaining = block;
	for (const [i, excerpt] of excerpts.entries()) {
		const idx = remaining.indexOf(excerpt);
		expect(idx, `excerpt #${i} not found (in order) in the remaining block`).toBeGreaterThanOrEqual(0);
		const before = remaining.slice(0, idx);
		expect(before.trim(), `unexpected non-whitespace text before excerpt #${i}: ${JSON.stringify(before)}`).toBe('');
		remaining = remaining.slice(idx + excerpt.length);
	}
	expect(remaining.trim(), `unexpected trailing text after the last excerpt: ${JSON.stringify(remaining)}`).toBe('');
}

// ---------------------------------------------------------------------------
// Synthetic fixture — a small, fully controlled 5-card chapter, plus decoy
// cards from a different chapter and a different book, so ordering/wrapping/
// chapter-scoping can be asserted precisely without depending on a real
// book's exact card count.
// ---------------------------------------------------------------------------

function chapterCard(cardNumber: number, text: string): ChapterTextCard {
	return {
		id: `synthetic-chapter-1-card-${cardNumber}`,
		book_slug: 'synthetic-book',
		chapter_slug: 'chapter-1',
		card_number: cardNumber,
		original_excerpt: text
	};
}

const CH1_CARD_1 = chapterCard(1, 'Card one of five, first in the chapter.');
const CH1_CARD_2 = chapterCard(2, 'Card two of five, second in the chapter.');
const CH1_CARD_3 = chapterCard(3, 'Card three of five, the target card.');
const CH1_CARD_4 = chapterCard(4, 'Card four of five, right after the target.');
const CH1_CARD_5 = chapterCard(5, 'Card five of five, the last in the chapter.');

/** A different chapter of the SAME book — must never appear in card 3's block. */
const OTHER_CHAPTER_CARD: ChapterTextCard = {
	id: 'synthetic-chapter-2-card-1',
	book_slug: 'synthetic-book',
	chapter_slug: 'chapter-2',
	card_number: 1,
	original_excerpt: 'A card from an entirely different chapter of the same book.'
};

/** A different book entirely — must never appear in card 3's block. */
const OTHER_BOOK_CARD: ChapterTextCard = {
	id: 'other-book-chapter-1-card-1',
	book_slug: 'another-synthetic-book',
	chapter_slug: 'chapter-1',
	card_number: 1,
	original_excerpt: 'A card from an entirely different book that happens to share a chapter slug.'
};

const SYNTHETIC_BOOK_CARDS: ChapterTextCard[] = [
	CH1_CARD_1,
	CH1_CARD_2,
	CH1_CARD_3,
	CH1_CARD_4,
	CH1_CARD_5,
	OTHER_CHAPTER_CARD,
	OTHER_BOOK_CARD
];

describe('buildChapterTextBlock — ordering, wrap-around, and chapter scoping (synthetic fixture)', () => {
	it('starts at the target card\'s own excerpt', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		expect(block.startsWith(CH1_CARD_3.original_excerpt)).toBe(true);
	});

	it('continues with the following cards, in document order, before wrapping', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		// Full lap starting at card 3: 3, 4, 5, then wrap to 1, 2.
		expectExactExcerptSequence(block, [
			CH1_CARD_3.original_excerpt,
			CH1_CARD_4.original_excerpt,
			CH1_CARD_5.original_excerpt,
			CH1_CARD_1.original_excerpt,
			CH1_CARD_2.original_excerpt
		]);
	});

	it('wraps to the chapter\'s own preceding cards once it reaches the chapter end', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		// The last card in document order (5) must be followed by the
		// chapter's OWN first card (1), not by nothing, not by a decoy.
		const idxOfLast = block.indexOf(CH1_CARD_5.original_excerpt);
		const idxOfFirst = block.indexOf(CH1_CARD_1.original_excerpt);
		expect(idxOfLast).toBeGreaterThanOrEqual(0);
		expect(idxOfFirst).toBeGreaterThan(idxOfLast);
	});

	it('never draws text from a different chapter of the same book', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		expect(block).not.toContain(OTHER_CHAPTER_CARD.original_excerpt);
	});

	it('never draws text from a different book, even one sharing a chapter slug', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		expect(block).not.toContain(OTHER_BOOK_CARD.original_excerpt);
	});

	it('starting from the chapter\'s FIRST card still produces a full lap (wraps trivially — nothing precedes it)', () => {
		const block = buildChapterTextBlock(CH1_CARD_1.id, SYNTHETIC_BOOK_CARDS);
		expectExactExcerptSequence(block, [
			CH1_CARD_1.original_excerpt,
			CH1_CARD_2.original_excerpt,
			CH1_CARD_3.original_excerpt,
			CH1_CARD_4.original_excerpt,
			CH1_CARD_5.original_excerpt
		]);
	});

	it('starting from the chapter\'s LAST card wraps immediately to the first', () => {
		const block = buildChapterTextBlock(CH1_CARD_5.id, SYNTHETIC_BOOK_CARDS);
		expectExactExcerptSequence(block, [
			CH1_CARD_5.original_excerpt,
			CH1_CARD_1.original_excerpt,
			CH1_CARD_2.original_excerpt,
			CH1_CARD_3.original_excerpt,
			CH1_CARD_4.original_excerpt
		]);
	});

	it('a single-card chapter is just that card\'s own excerpt, verbatim', () => {
		const soloCard = chapterCard(1, 'The only card in its chapter.');
		const block = buildChapterTextBlock(soloCard.id, [soloCard, OTHER_CHAPTER_CARD, OTHER_BOOK_CARD]);
		expectExactExcerptSequence(block, [soloCard.original_excerpt]);
	});

	it('throws when the target card id is not present in the given cards', () => {
		expect(() => buildChapterTextBlock('does-not-exist', SYNTHETIC_BOOK_CARDS)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Real corpus — the read-through slice this exists for (Meditations Books
// 2-3, 48 cards). Confirms the loader's behaviour holds against real card
// data, not just a synthetic fixture, and that every one of the 48 cards
// clears the real travel requirement once its own chapter supplies the
// scrolling block.
// ---------------------------------------------------------------------------

const READ_THROUGH_BOOK = 'meditations';
const READ_THROUGH_CHAPTERS = ['book-02', 'book-03'];

describe('buildChapterTextBlock / loadChapterTextBlock — the real read-through slice (Meditations Books 2-3)', () => {
	const bookCards = loadBookCards(READ_THROUGH_BOOK, outputDir);
	const slice = bookCards
		.filter((c) => READ_THROUGH_CHAPTERS.includes(String(c.chapter_slug)))
		.sort((a, b) => {
			const chapterOrder = READ_THROUGH_CHAPTERS.indexOf(String(a.chapter_slug))
				- READ_THROUGH_CHAPTERS.indexOf(String(b.chapter_slug));
			return chapterOrder !== 0 ? chapterOrder : Number(a.card_number) - Number(b.card_number);
		});

	it('grounds this suite\'s own numbers: the slice is 48 real cards', () => {
		expect(slice.length).toBe(48);
	});

	it('for the real first card of the slice, the block starts at its own excerpt and continues in document order', () => {
		const firstCard = slice[0];
		expect(firstCard.id).toBe('meditations-02-001');
		const chapterCards = bookCards.filter((c) => c.chapter_slug === firstCard.chapter_slug);
		const expectedOrder = [...chapterCards]
			.sort((a, b) => Number(a.card_number) - Number(b.card_number))
			.map((c) => c.original_excerpt);

		const block = buildChapterTextBlock(firstCard.id, bookCards);
		expectExactExcerptSequence(block, expectedOrder);
	});

	it('for a real card near the end of a chapter, the block wraps to that SAME chapter\'s own earlier cards, never the next chapter\'s', () => {
		const book02Cards = bookCards
			.filter((c) => c.chapter_slug === 'book-02')
			.sort((a, b) => Number(a.card_number) - Number(b.card_number));
		const lastOfBook02 = book02Cards[book02Cards.length - 1];

		const block = buildChapterTextBlock(lastOfBook02.id, bookCards);

		// Must contain book-02's own first card next (the wrap)...
		expect(block).toContain(book02Cards[0].original_excerpt);
		// ...and must never contain any book-03 text (a different chapter).
		const book03Cards = bookCards.filter((c) => c.chapter_slug === 'book-03');
		for (const card of book03Cards) {
			expect(block).not.toContain(card.original_excerpt);
		}
	});

	it('loadChapterTextBlock (the disk-backed loader) agrees with buildChapterTextBlock over the same book cards', () => {
		const cardId = 'meditations-03-001';
		expect(loadChapterTextBlock(READ_THROUGH_BOOK, cardId, outputDir)).toBe(
			buildChapterTextBlock(cardId, bookCards)
		);
	});

	it('every one of the 48 read-through slice cards clears the real travel requirement once sourced from its own chapter', () => {
		const shortfalls: { id: string; blockHeight: number }[] = [];
		for (const card of slice) {
			const block = loadChapterTextBlock(READ_THROUGH_BOOK, card.id, outputDir);
			const layout = computeWallLayout(block);
			if (!(layout.blockHeight > WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX) || !layout.fits) {
				shortfalls.push({ id: card.id, blockHeight: layout.blockHeight });
			}
		}
		expect(shortfalls).toEqual([]);
	});

	it('the block for every slice card is verbatim: every substring is drawn only from original_excerpt fields in its own chapter', () => {
		for (const card of slice) {
			const chapterCards = bookCards
				.filter((c) => c.chapter_slug === card.chapter_slug)
				.sort((a, b) => Number(a.card_number) - Number(b.card_number));
			const targetIndex = chapterCards.findIndex((c) => c.id === card.id);
			const expectedOrder = [
				...chapterCards.slice(targetIndex),
				...chapterCards.slice(0, targetIndex)
			].map((c) => c.original_excerpt);

			const block = loadChapterTextBlock(READ_THROUGH_BOOK, card.id, outputDir);
			expectExactExcerptSequence(block, expectedOrder);
		}
	});
});
