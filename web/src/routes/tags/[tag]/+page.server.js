import { error } from '@sveltejs/kit';
import { getTagBySlug } from '$lib/utils/tags.js';
import { getCardsByTag, getAuthors } from '$lib/utils/content.js';

export function load({ params }) {
	const tag = getTagBySlug(params.tag);
	if (!tag) throw error(404, `Tag not found: ${params.tag}`);

	const cards = getCardsByTag(params.tag);
	const authors = getAuthors();

	// Slave → Emperor → Senator order for tag pages
	const authorOrder = ['epictetus', 'marcus-aurelius', 'seneca'];
	const grouped = authorOrder
		.map((slug) => {
			const author = authors.find((a) => a.slug === slug);
			const authorCards = cards.filter((c) => c.author_slug === slug);
			return { author, cards: authorCards };
		})
		.filter((g) => g.cards.length > 0);

	return { tag, grouped };
}
