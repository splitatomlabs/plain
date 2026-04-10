import { error } from '@sveltejs/kit';
import { getCard, getBookMeta, getAdjacentCard, getAuthors } from '$lib/utils/content.js';

export const config = {
	isr: {
		expiration: 86400
	}
};

export function load({ params }) {
	const cardNumber = parseInt(params.card, 10);
	if (isNaN(cardNumber) || cardNumber < 1) {
		throw error(404, 'Invalid card number');
	}

	const book = getBookMeta(params.book);
	const card = getCard(params.book, params.chapter, cardNumber);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === book.author_slug);

	const prevCard = getAdjacentCard(params.book, params.chapter, cardNumber, -1);
	const nextCard = getAdjacentCard(params.book, params.chapter, cardNumber, 1);

	// Calculate card's global index within the book
	let cardIndex = 0;
	for (const ch of book.chapters) {
		if (ch.slug === params.chapter) {
			cardIndex += cardNumber;
			break;
		}
		cardIndex += ch.card_count;
	}

	return {
		card,
		book,
		author,
		prevCard,
		nextCard,
		cardIndex,
		totalCards: book.total_cards
	};
}
