import { describe, it, expect } from 'vitest';
import {
	getAuthors,
	getBookMeta,
	getBooks,
	getBooksForAuthor,
	getCard,
	getChapterCards,
	getAdjacentCard,
	getCardsByTag,
	getAllCards
} from '$lib/utils/content.js';

describe('getAuthors', () => {
	it('returns 3 authors in sort_order', () => {
		const authors = getAuthors();
		expect(authors).toHaveLength(3);
		expect(authors[0].slug).toBe('epictetus');
		expect(authors[1].slug).toBe('marcus-aurelius');
		expect(authors[2].slug).toBe('seneca');
	});
});

describe('getBookMeta', () => {
	it('returns valid metadata for meditations', () => {
		const meta = getBookMeta('meditations');
		expect(meta.slug).toBe('meditations');
		expect(meta.title).toBe('Meditations');
		expect(meta.author_slug).toBe('marcus-aurelius');
		expect(meta.chapters).toBeInstanceOf(Array);
		expect(meta.total_cards).toBeGreaterThan(0);
	});

	it('throws 404 for nonexistent book', () => {
		expect(() => getBookMeta('nonexistent')).toThrow();
	});
});

describe('getBooks', () => {
	it('returns all 5 books sorted by author sort_order', () => {
		const books = getBooks();
		expect(books).toHaveLength(5);
		// Epictetus first (sort_order 1)
		expect(books[0].author_slug).toBe('epictetus');
		// Marcus Aurelius second (sort_order 2)
		expect(books[1].author_slug).toBe('marcus-aurelius');
		// Seneca last (sort_order 3, 3 books)
		expect(books[2].author_slug).toBe('seneca');
		expect(books[3].author_slug).toBe('seneca');
		expect(books[4].author_slug).toBe('seneca');
	});
});

describe('getBooksForAuthor', () => {
	it('returns 3 books for seneca', () => {
		const books = getBooksForAuthor('seneca');
		expect(books).toHaveLength(3);
	});

	it('returns 1 book for epictetus', () => {
		const books = getBooksForAuthor('epictetus');
		expect(books).toHaveLength(1);
	});
});

describe('getCard', () => {
	it('returns correct card shape', () => {
		const card = getCard('meditations', 'book-01', 1);
		expect(card.id).toBe('meditations-01-001');
		expect(card.book_slug).toBe('meditations');
		expect(card.chapter_slug).toBe('book-01');
		expect(card.card_number).toBe(1);
		expect(card.plain_english).toBeTruthy();
		expect(card.original_excerpt).toBeTruthy();
		expect(card.source_reference).toBeTruthy();
		expect(card.author_slug).toBe('marcus-aurelius');
		expect(card.tags).toBeInstanceOf(Array);
		expect(card.reading_time_seconds).toBeGreaterThan(0);
	});

	it('throws for nonexistent card', () => {
		expect(() => getCard('meditations', 'book-01', 999)).toThrow();
	});
});

describe('getChapterCards', () => {
	it('returns cards for a valid chapter', () => {
		const cards = getChapterCards('meditations', 'book-01');
		expect(cards).toHaveLength(3);
		expect(cards[0].chapter_slug).toBe('book-01');
	});
});

describe('getAdjacentCard', () => {
	it('returns next card within same chapter', () => {
		const next = getAdjacentCard('meditations', 'book-01', 1, 1);
		expect(next.card_number).toBe(2);
	});

	it('crosses chapter boundary forward', () => {
		const next = getAdjacentCard('meditations', 'book-01', 3, 1);
		expect(next.chapter_slug).toBe('book-02');
		expect(next.card_number).toBe(1);
	});

	it('crosses chapter boundary backward', () => {
		const prev = getAdjacentCard('meditations', 'book-02', 1, -1);
		expect(prev.chapter_slug).toBe('book-01');
		expect(prev.card_number).toBe(3);
	});

	it('returns null at book start', () => {
		const prev = getAdjacentCard('meditations', 'book-01', 1, -1);
		expect(prev).toBeNull();
	});

	it('returns null at book end', () => {
		const next = getAdjacentCard('meditations', 'book-02', 3, 1);
		expect(next).toBeNull();
	});
});

describe('getCardsByTag', () => {
	it('returns cards matching a tag', () => {
		const cards = getCardsByTag('calm-your-mind');
		expect(cards.length).toBeGreaterThan(0);
		cards.forEach((c) => expect(c.tags).toContain('calm-your-mind'));
	});
});

describe('getAllCards', () => {
	it('returns all 30 fixture cards', () => {
		const cards = getAllCards();
		expect(cards).toHaveLength(30);
	});
});
