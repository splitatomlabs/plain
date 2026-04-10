import { getBookMeta, getAuthors, getBooks } from '$lib/utils/content.js';

export function load({ params }) {
	const book = getBookMeta(params.book);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === book.author_slug);
	const allBooks = getBooks();
	const otherBooks = allBooks.filter((b) => b.slug !== book.slug);

	// Suggest a book: prefer same author, otherwise different author
	const sameAuthorBooks = otherBooks.filter((b) => b.author_slug === book.author_slug);
	const suggestion = sameAuthorBooks[0] || otherBooks[0] || null;

	return { book, author, suggestion };
}
