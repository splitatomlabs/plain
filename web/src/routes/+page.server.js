import { getAuthors, getBooksForAuthor, getCardsByTag } from '$lib/utils/content.js';
import { TAGS } from '$lib/utils/tags.js';

export function load({ cookies }) {
	const hasProgress = cookies.get('plain_has_progress') === '1';
	const authors = getAuthors();

	// New visitor order: Marcus Aurelius first (highest recognition), then Epictetus, then Seneca
	const newVisitorOrder = ['marcus-aurelius', 'epictetus', 'seneca'];
	const orderedAuthors = newVisitorOrder.map((slug) => authors.find((a) => a.slug === slug));

	// Returning reader order: Slave → Emperor → Senator (standard sort_order)
	const returningOrder = ['epictetus', 'marcus-aurelius', 'seneca'];
	const returningAuthors = returningOrder.map((slug) => authors.find((a) => a.slug === slug));

	const authorData = orderedAuthors.map((author) => {
		const books = getBooksForAuthor(author.slug);
		return { author, books };
	});

	const returningAuthorData = returningAuthors.map((author) => {
		const books = getBooksForAuthor(author.slug);
		return { author, books };
	});

	const tags = TAGS.map((tag) => ({
		...tag,
		count: getCardsByTag(tag.slug).length
	}));

	return { authorData, returningAuthorData, tags, hasProgress };
}
