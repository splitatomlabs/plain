import { getAuthors, getBooksForAuthor } from '$lib/utils/content.js';
import { getTagsForBook } from '$lib/utils/tags.js';

export function load() {
	const authors = getAuthors();

	// New visitor order: Marcus Aurelius first (highest recognition), then Epictetus, then Seneca
	const newVisitorOrder = ['marcus-aurelius', 'epictetus', 'seneca'];
	const orderedAuthors = newVisitorOrder.map((slug) => authors.find((a) => a.slug === slug));

	const authorData = orderedAuthors.map((author) => {
		const books = getBooksForAuthor(author.slug);
		const tagsByBook = Object.fromEntries(
			books.map((book) => [book.slug, getTagsForBook(book.slug)])
		);
		return { author, books, tagsByBook };
	});

	return { authorData };
}
