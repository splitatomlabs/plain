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
 *   5. It returns enough text to clear the travel requirement (the scroll
 *      never finishing before the wall phase's hard cut — see
 *      `wall-timing.ts`'s `WALL_SCROLL_RATE_PX_PER_SEC`/`WALL_SECONDS`, and
 *      social pilot 02a T08, which deleted the gate-side constant this
 *      comment used to name once the invariant started holding by
 *      construction instead) for EVERY card in the real read-through slice
 *      (Meditations Books 2-3, 48 cards) — this is the whole point of
 *      sourcing from the chapter instead of the card.
 *   6. The text is VERBATIM and UNMODIFIED — no fabrication, no paraphrase,
 *      no reordering within an excerpt; the block is nothing but the
 *      expected excerpts themselves, in the expected order, with only
 *      whitespace between them.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	buildChapterTextBlock,
	loadChapterTextBlock,
	chapterEntryOffsetWords,
	applyChapterEntryOffset,
	type ChapterTextCard
} from '../chapter-text.js';
import { loadBookCards } from '../../remotion/wall-pool.js';
import {
	computeWallLayout,
	FRAME_HEIGHT,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_SECONDS
} from '../../remotion/wall-timing.js';

/**
 * social pilot 02a T08 (2026-08-26): `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` was
 * deleted from `wall-gate.ts` along with the gate rejection it drove — the
 * never-finishes invariant this test guards now holds BY CONSTRUCTION (a
 * chapter-sourced block is always long enough at the fixed `WALL_FONT_SIZE`),
 * not by a gate check. Re-derived locally (matches
 * `wall-timing.test.ts`'s own independent re-derivation) so this file keeps
 * proving the real arithmetic rather than importing a constant that no
 * longer exists.
 */
const TRAVEL_FLOOR_PX = FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS;

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

/**
 * R02: `buildChapterTextBlock` no longer returns exactly ONE lap — a
 * chapter too short to clear the never-finishes travel floor gets its one
 * lap sequence repeated whole, as many times as needed (see
 * `chapter-text.ts`'s module doc comment). This is `expectExactExcerptSequence`'s
 * sibling for that case: asserts the block is nothing but WHOLE, unbroken
 * repeats of exactly `excerpts`, in order — no decoy content, no partial
 * trailing repeat — and returns how many repeats it found (>= 1) so a
 * caller can assert on the count itself where that matters.
 */
function expectRepeatedExcerptSequence(block: string, excerpts: string[]): number {
	let remaining = block;
	let repeats = 0;
	while (remaining.trim().length > 0) {
		for (const [i, excerpt] of excerpts.entries()) {
			const idx = remaining.indexOf(excerpt);
			expect(
				idx,
				`repeat #${repeats}, excerpt #${i} not found (in order) in the remaining block`
			).toBeGreaterThanOrEqual(0);
			const before = remaining.slice(0, idx);
			expect(
				before.trim(),
				`repeat #${repeats}, unexpected non-whitespace text before excerpt #${i}: ${JSON.stringify(before)}`
			).toBe('');
			remaining = remaining.slice(idx + excerpt.length);
		}
		repeats++;
	}
	expect(repeats, 'expected at least one full repeat of the lap sequence').toBeGreaterThanOrEqual(1);
	return repeats;
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

	it('continues with the following cards, in document order, before wrapping (repeated whole-lap by whole-lap — R02, this synthetic chapter is short enough to need repeats)', () => {
		const block = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);
		// Full lap starting at card 3: 3, 4, 5, then wrap to 1, 2 — repeated as
		// many whole times as buildChapterTextBlock needed to clear the floor.
		expectRepeatedExcerptSequence(block, [
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

	it('starting from the chapter\'s FIRST card still produces a full lap (wraps trivially — nothing precedes it), repeated as needed', () => {
		const block = buildChapterTextBlock(CH1_CARD_1.id, SYNTHETIC_BOOK_CARDS);
		expectRepeatedExcerptSequence(block, [
			CH1_CARD_1.original_excerpt,
			CH1_CARD_2.original_excerpt,
			CH1_CARD_3.original_excerpt,
			CH1_CARD_4.original_excerpt,
			CH1_CARD_5.original_excerpt
		]);
	});

	it('starting from the chapter\'s LAST card wraps immediately to the first, repeated as needed', () => {
		const block = buildChapterTextBlock(CH1_CARD_5.id, SYNTHETIC_BOOK_CARDS);
		expectRepeatedExcerptSequence(block, [
			CH1_CARD_5.original_excerpt,
			CH1_CARD_1.original_excerpt,
			CH1_CARD_2.original_excerpt,
			CH1_CARD_3.original_excerpt,
			CH1_CARD_4.original_excerpt
		]);
	});

	it('a single-card chapter is just that card\'s own excerpt, verbatim, repeated whole as many times as R02\'s travel floor needs', () => {
		const soloCard = chapterCard(1, 'The only card in its chapter.');
		const block = buildChapterTextBlock(soloCard.id, [soloCard, OTHER_CHAPTER_CARD, OTHER_BOOK_CARD]);
		const repeats = expectRepeatedExcerptSequence(block, [soloCard.original_excerpt]);
		// This solo excerpt (6 words) is nowhere near the ~412-word travel
		// floor on its own — sanity-check that R02's repeat behaviour
		// actually engaged rather than this test accidentally passing on a
		// single, unrepeated copy.
		expect(repeats).toBeGreaterThan(1);
	});

	it('throws when the target card id is not present in the given cards', () => {
		expect(() => buildChapterTextBlock('does-not-exist', SYNTHETIC_BOOK_CARDS)).toThrow();
	});
});

// ---------------------------------------------------------------------------
// Mid-chapter entry (social pilot 02a T18) — `chapterEntryOffsetWords` /
// `applyChapterEntryOffset`. See `chapter-text.ts`'s own "DESIGN DECISION"
// comment for the reasoning these tests hold it to.
// ---------------------------------------------------------------------------

describe('chapterEntryOffsetWords — deterministic, in range, never mid-word', () => {
	it('is deterministic: the same (postIndex, excerptWordCount) always returns the same offset', () => {
		expect(chapterEntryOffsetWords(7, 42)).toBe(chapterEntryOffsetWords(7, 42));
	});

	it('varies across consecutive postIndex values (the acceptance criterion: consecutive posts differ)', () => {
		const offsets = [0, 1, 2, 3, 4].map((i) => chapterEntryOffsetWords(i, 50));
		expect(new Set(offsets).size).toBeGreaterThan(1);
	});

	it('is always in range [0, excerptWordCount) for a wide sweep of postIndex values', () => {
		for (let postIndex = 0; postIndex < 500; postIndex++) {
			const offset = chapterEntryOffsetWords(postIndex, 37);
			expect(offset).toBeGreaterThanOrEqual(0);
			expect(offset).toBeLessThan(37);
		}
	});

	it('returns 0 for excerpts with fewer than 2 words (no interior word boundary to enter on)', () => {
		expect(chapterEntryOffsetWords(3, 0)).toBe(0);
		expect(chapterEntryOffsetWords(3, 1)).toBe(0);
	});

	it('handles a hypothetical negative postIndex without going out of range (defensive — postIndexForSlot never actually produces one)', () => {
		const offset = chapterEntryOffsetWords(-5, 12);
		expect(offset).toBeGreaterThanOrEqual(0);
		expect(offset).toBeLessThan(12);
	});
});

describe('applyChapterEntryOffset — never mid-word, honest (drawn from the target card\'s own excerpt only)', () => {
	const FIVE_CARD_BLOCK = buildChapterTextBlock(CH1_CARD_3.id, SYNTHETIC_BOOK_CARDS);

	it('offset 0 (postIndex a multiple of the excerpt\'s word count) returns the block unmodified', () => {
		const excerptWordCount = CH1_CARD_3.original_excerpt.split(/\s+/).filter(Boolean).length;
		expect(applyChapterEntryOffset(FIVE_CARD_BLOCK, excerptWordCount)).toBe(FIVE_CARD_BLOCK);
	});

	it('a nonzero offset returns a real suffix of the block, never mid-word', () => {
		const shifted = applyChapterEntryOffset(FIVE_CARD_BLOCK, 2);
		expect(FIVE_CARD_BLOCK.endsWith(shifted)).toBe(true);
		expect(shifted.length).toBeLessThan(FIVE_CARD_BLOCK.length);
		// Never mid-word: the character immediately before the cut (in the
		// original block) must be whitespace or the string's own start —
		// i.e. the cut lands exactly on a word boundary, never inside one.
		const cutIndex = FIVE_CARD_BLOCK.length - shifted.length;
		expect(cutIndex).toBeGreaterThan(0);
		expect(/\s/.test(FIVE_CARD_BLOCK[cutIndex - 1])).toBe(true);
		// And the shifted text itself starts with a real word, not whitespace.
		expect(/^\S/.test(shifted)).toBe(true);
	});

	it('two different postIndex values on the same card open at different points (the acceptance criterion, direct)', () => {
		const openingA = applyChapterEntryOffset(FIVE_CARD_BLOCK, 1).slice(0, 20);
		const openingB = applyChapterEntryOffset(FIVE_CARD_BLOCK, 3).slice(0, 20);
		expect(openingA).not.toBe(openingB);
	});

	it('honesty: every offset within the excerpt\'s own word count still opens somewhere INSIDE the target card\'s own excerpt, never past it', () => {
		const excerptWordCount = CH1_CARD_3.original_excerpt.split(/\s+/).filter(Boolean).length;
		for (let postIndex = 0; postIndex < excerptWordCount; postIndex++) {
			const shifted = applyChapterEntryOffset(FIVE_CARD_BLOCK, postIndex);
			// The shifted opening must still be a substring of the target
			// card's OWN excerpt (plus whatever follows it in the block) —
			// concretely: the excerpt itself, from some interior point
			// onward, must still be a PREFIX of what's left.
			const offsetWords = chapterEntryOffsetWords(postIndex, excerptWordCount);
			const excerptWords = CH1_CARD_3.original_excerpt.split(/\s+/).filter(Boolean);
			const expectedExcerptTail = excerptWords.slice(offsetWords).join(' ');
			// Loose containment check (whitespace between words in the source
			// text need not be single spaces) — the FIRST word of the
			// expected tail must be the first word of what's shifted.
			expect(shifted.split(/\s+/)[0]).toBe(expectedExcerptTail.split(' ')[0]);
		}
	});

	it('a block with no "\\n\\n" at all (applyChapterEntryOffset\'s own guard branch) still offsets correctly', () => {
		// R02: `buildChapterTextBlock` itself can no longer be relied on to
		// produce a real "\n\n"-free block for a short solo-card chapter — it
		// now repeats a too-short lap (joined with "\n\n") until the block
		// clears the travel floor, so even a single-card chapter's block
		// contains "\n\n" once it needs more than one repeat. This test
		// exercises `applyChapterEntryOffset`'s own defensive guard for a
		// chapterBlock with NO paragraph break at all directly, by
		// constructing that string by hand rather than via
		// `buildChapterTextBlock` — the guard branch (`paragraphBreak === -1`)
		// stays real code to test even though this exact shape is no longer
		// what R02's `buildChapterTextBlock` itself would hand it.
		const block = 'One two three four five six seven eight nine ten.';
		const shifted = applyChapterEntryOffset(block, 3);
		expect(shifted.startsWith('four')).toBe(true);
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
			if (!(layout.blockHeight > TRAVEL_FLOOR_PX)) {
				shortfalls.push({ id: card.id, blockHeight: layout.blockHeight });
			}
		}
		expect(shortfalls).toEqual([]);
	});

	it(
		'T18: every one of the 48 read-through slice cards STILL clears the real travel requirement at its own ' +
			'WORST-CASE mid-chapter entry offset (excerptWordCount - 1 words consumed off the front) — the ' +
			'never-finishes invariant holds at every offset the scheme can produce, not just offset 0',
		() => {
			const results: { id: string; worstOffset: number; blockHeight: number; marginPx: number }[] = [];
			const shortfalls: typeof results = [];
			for (const card of slice) {
				const rawBlock = loadChapterTextBlock(READ_THROUGH_BOOK, card.id, outputDir);
				const excerptWordCount = card.original_excerpt.split(/\s+/).filter(Boolean).length;
				const worstOffset = Math.max(0, excerptWordCount - 1);
				const shifted = applyChapterEntryOffset(rawBlock, worstOffset);
				const layout = computeWallLayout(shifted);
				const marginPx = layout.blockHeight - TRAVEL_FLOOR_PX;
				const row = { id: card.id, worstOffset, blockHeight: layout.blockHeight, marginPx };
				results.push(row);
				if (!(layout.blockHeight > TRAVEL_FLOOR_PX)) {
					shortfalls.push(row);
				}
			}
			expect(shortfalls).toEqual([]);
			// Report the worst-case (smallest) margin across the whole slice —
			// this is the number the task asks to be reported, not just a
			// pass/fail.
			const worstMargin = results.reduce((min, r) => Math.min(min, r.marginPx), Infinity);
			// eslint-disable-next-line no-console
			console.log(
				`T18 never-finishes worst-case margin across the 48-card slice: ${worstMargin.toFixed(1)}px ` +
					`(travel floor ${TRAVEL_FLOOR_PX.toFixed(1)}px)`
			);
			expect(worstMargin).toBeGreaterThan(0);
		}
	);

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

// ---------------------------------------------------------------------------
// R02's own acceptance test — sweeps EVERY non-excluded entry of the real
// `content/social/premises/wall.json` pool (685 of 896 entries; the other
// 211 are already excluded upstream for `duration`, an unrelated axis — see
// `content/social/render-exclusions.json`'s `wall` section), not just the
// 48-card Meditations read-through slice above. That slice alone couldn't
// have caught this defect: every Meditations chapter is thousands of words
// long, so T05-T09's tests against it never exercised a chapter anywhere
// near the travel floor. This sweep spans every book in the real Wall pool
// — including Enchiridion, whose 51 chapters median just 94 words — so a
// regression that only shows up on a short chapter can't hide behind a
// Meditations-only fixture again.
// ---------------------------------------------------------------------------

describe('buildChapterTextBlock — R02 acceptance: every non-excluded wall.json entry clears the travel floor', () => {
	const wallPoolPath = path.join(repoRoot, 'content', 'social', 'premises', 'wall.json');
	const exclusionsPath = path.join(repoRoot, 'content', 'social', 'render-exclusions.json');

	const wallPool = JSON.parse(readFileSync(wallPoolPath, 'utf-8')) as {
		entries: { card_id: string; book_slug: string }[];
	};
	const exclusions = JSON.parse(readFileSync(exclusionsPath, 'utf-8')) as {
		wall: { card_id: string }[];
	};
	const excludedIds = new Set(exclusions.wall.map((e) => e.card_id));
	const nonExcludedEntries = wallPool.entries.filter((e) => !excludedIds.has(e.card_id));

	const bookCardsCache = new Map<string, ReturnType<typeof loadBookCards>>();
	function getBookCards(bookSlug: string) {
		let cards = bookCardsCache.get(bookSlug);
		if (!cards) {
			cards = loadBookCards(bookSlug, outputDir);
			bookCardsCache.set(bookSlug, cards);
		}
		return cards;
	}

	it('grounds this suite\'s own numbers: the pool has non-excluded entries across more than one book (not just Meditations)', () => {
		expect(nonExcludedEntries.length).toBeGreaterThan(600);
		const books = new Set(nonExcludedEntries.map((e) => e.book_slug));
		expect(books.size).toBeGreaterThan(1);
		expect(books.has('enchiridion')).toBe(true);
	});

	it(
		'every non-excluded wall.json entry clears the travel floor at offset 0 AND at its own worst-case ' +
			'mid-chapter offset (excerptWordCount - 1) — the never-finishes invariant R02 restores',
		() => {
			const shortfallsAtZero: { id: string; book: string; blockHeight: number }[] = [];
			const shortfallsAtWorstOffset: { id: string; book: string; worstOffset: number; blockHeight: number }[] = [];
			let worstMarginAtZero = Infinity;
			let worstMarginAtWorstOffset = Infinity;

			for (const entry of nonExcludedEntries) {
				const bookCards = getBookCards(entry.book_slug);
				const block = buildChapterTextBlock(entry.card_id, bookCards);

				const layoutAtZero = computeWallLayout(block);
				worstMarginAtZero = Math.min(worstMarginAtZero, layoutAtZero.blockHeight - TRAVEL_FLOOR_PX);
				if (!(layoutAtZero.blockHeight > TRAVEL_FLOOR_PX)) {
					shortfallsAtZero.push({ id: entry.card_id, book: entry.book_slug, blockHeight: layoutAtZero.blockHeight });
				}

				const targetCard = bookCards.find((c) => c.id === entry.card_id)!;
				const excerptWordCount = targetCard.original_excerpt.split(/\s+/).filter(Boolean).length;
				const worstOffset = Math.max(0, excerptWordCount - 1);
				const shifted = applyChapterEntryOffset(block, worstOffset);
				const layoutAtWorstOffset = computeWallLayout(shifted);
				worstMarginAtWorstOffset = Math.min(worstMarginAtWorstOffset, layoutAtWorstOffset.blockHeight - TRAVEL_FLOOR_PX);
				if (!(layoutAtWorstOffset.blockHeight > TRAVEL_FLOOR_PX)) {
					shortfallsAtWorstOffset.push({
						id: entry.card_id,
						book: entry.book_slug,
						worstOffset,
						blockHeight: layoutAtWorstOffset.blockHeight
					});
				}
			}

			// eslint-disable-next-line no-console
			console.log(
				`R02 sweep across ${nonExcludedEntries.length} non-excluded wall.json entries: ` +
					`worst margin at offset 0 = ${worstMarginAtZero.toFixed(1)}px, ` +
					`worst margin at worst-case offset = ${worstMarginAtWorstOffset.toFixed(1)}px ` +
					`(travel floor ${TRAVEL_FLOOR_PX.toFixed(1)}px)`
			);

			expect(shortfallsAtZero, `${shortfallsAtZero.length} entries fail at offset 0`).toEqual([]);
			expect(
				shortfallsAtWorstOffset,
				`${shortfallsAtWorstOffset.length} entries fail at their worst-case offset`
			).toEqual([]);
		}
	);
});
