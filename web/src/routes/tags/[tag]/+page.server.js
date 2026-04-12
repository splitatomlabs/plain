import { error } from '@sveltejs/kit';
import { getTagBySlug } from '$lib/utils/tags.js';
import { getCardsByTag, getAuthors } from '$lib/utils/content.js';

/** Round-robin interleave cards by author, keeping each author's natural book order. */
function interleaveByAuthor(cards, authorOrder) {
	const piles = new Map();
	for (const slug of authorOrder) {
		piles.set(slug, []);
	}
	for (const card of cards) {
		const pile = piles.get(card.author_slug);
		if (pile) pile.push(card);
	}

	const result = [];
	let exhausted = 0;
	const iterators = authorOrder.map((slug) => ({ slug, index: 0 }));

	while (exhausted < iterators.length) {
		for (const it of iterators) {
			const pile = piles.get(it.slug);
			if (it.index < pile.length) {
				result.push(pile[it.index]);
				it.index++;
				if (it.index >= pile.length) exhausted++;
			}
		}
	}

	return result;
}

export function load({ params }) {
	const tag = getTagBySlug(params.tag);
	if (!tag) throw error(404, `Tag not found: ${params.tag}`);

	const cards = getCardsByTag(params.tag);
	const authors = getAuthors();

	const authorOrder = ['epictetus', 'marcus-aurelius', 'seneca'];
	const sequence = interleaveByAuthor(cards, authorOrder);

	const authorMap = Object.fromEntries(authors.map((a) => [a.slug, a]));

	return { tag, sequence, authorMap, totalCards: sequence.length };
}
