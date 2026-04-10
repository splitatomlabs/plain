import { getAuthors, getBooksForAuthor } from '$lib/utils/content.js';

export function load() {
	const authors = getAuthors();

	// New visitor order: Marcus Aurelius first (highest recognition), then Epictetus, then Seneca
	const newVisitorOrder = ['marcus-aurelius', 'epictetus', 'seneca'];
	const orderedAuthors = newVisitorOrder.map((slug) => authors.find((a) => a.slug === slug));

	const authorData = orderedAuthors.map((author) => {
		const books = getBooksForAuthor(author.slug);
		return { author, books };
	});

	return { authorData };
}
