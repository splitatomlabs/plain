/**
 * Builds the wall's SCROLLING BLOCK from the surrounding CHAPTER, not just
 * the single card — social pilot 02a's central geometry fix (see
 * `plans/Pf39c2-social-pilot-02a.md`, "the wall is sourced from the
 * CHAPTER, not the card" and its "CONSTRAINT 6 AMENDMENT").
 *
 * The block starts at the target card's own verbatim `original_excerpt`,
 * continues with the FOLLOWING cards of the same chapter (same `book_slug`
 * AND `chapter_slug`) in `card_number` order, and wraps to the chapter's own
 * first card once it reaches the chapter's end — one full lap of the
 * chapter, reordered to start at the target card, never crossing into
 * another chapter or book. Every word in the block is a verbatim substring
 * of some card's `original_excerpt` — no fabrication, no paraphrase, no
 * reordering WITHIN an excerpt.
 */
import { loadBookCards } from '../remotion/wall-pool.js';

/**
 * The subset of `wall-pool.ts`'s `OutputCard` this module actually needs,
 * named separately so a synthetic test fixture (`chapter-text.test.ts`'s own
 * wrap-around cases) doesn't have to fabricate every field `OutputCard`'s
 * index signature allows.
 */
export interface ChapterTextCard {
	id: string;
	book_slug: string;
	chapter_slug: string;
	card_number: number;
	original_excerpt: string;
}

/**
 * Builds the verbatim scrolling block for `targetCardId`. `bookCards` may
 * contain cards from other chapters or even other books (e.g. a whole
 * book's cards, as `wall-pool.ts`'s `loadBookCards` returns) — this function
 * is responsible for filtering to the target card's own chapter internally
 * (`content/output/`'s `book_slug` + `chapter_slug`), never drawing text
 * from anywhere else.
 */
export function buildChapterTextBlock(targetCardId: string, bookCards: ChapterTextCard[]): string {
	const targetCard = bookCards.find((c) => c.id === targetCardId);
	if (!targetCard) {
		throw new Error(`buildChapterTextBlock: no card with id "${targetCardId}" in the given cards.`);
	}

	const chapterCards = bookCards
		.filter((c) => c.book_slug === targetCard.book_slug && c.chapter_slug === targetCard.chapter_slug)
		.sort((a, b) => a.card_number - b.card_number);

	const targetIndex = chapterCards.findIndex((c) => c.id === targetCardId);
	const lap = [...chapterCards.slice(targetIndex), ...chapterCards.slice(0, targetIndex)];

	return lap.map((c) => c.original_excerpt).join('\n\n');
}

/**
 * Disk-backed convenience: loads every card of `bookSlug` from
 * `content/output/` (via `wall-pool.ts`'s `loadBookCards`) and hands them to
 * `buildChapterTextBlock` for `cardId`.
 */
export function loadChapterTextBlock(bookSlug: string, cardId: string, outputDir?: string): string {
	const bookCards = loadBookCards(bookSlug, outputDir);
	return buildChapterTextBlock(cardId, bookCards);
}
