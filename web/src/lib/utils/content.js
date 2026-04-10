import authors from '$content/authors.json';
import meditationsMeta from '$content/meditations/_meta.json';
import enchiridionMeta from '$content/enchiridion/_meta.json';
import shortnessMeta from '$content/shortness-of-life/_meta.json';
import happyMeta from '$content/happy-life/_meta.json';
import peaceMeta from '$content/peace-of-mind/_meta.json';

import meditationsBook01 from '$content/meditations/book-01.json';
import meditationsBook02 from '$content/meditations/book-02.json';
import enchiridionSections0110 from '$content/enchiridion/sections-01-10.json';
import enchiridionSections1120 from '$content/enchiridion/sections-11-20.json';
import shortnessSections0107 from '$content/shortness-of-life/sections-01-07.json';
import shortnessSections0814 from '$content/shortness-of-life/sections-08-14.json';
import happySections0110 from '$content/happy-life/sections-01-10.json';
import happySections1120 from '$content/happy-life/sections-11-20.json';
import peaceSections0109 from '$content/peace-of-mind/sections-01-09.json';
import peaceSections1017 from '$content/peace-of-mind/sections-10-17.json';

import { error } from '@sveltejs/kit';

const META_BY_SLUG = {
	meditations: meditationsMeta,
	enchiridion: enchiridionMeta,
	'shortness-of-life': shortnessMeta,
	'happy-life': happyMeta,
	'peace-of-mind': peaceMeta
};

const CHAPTER_DATA = {
	'meditations/book-01': meditationsBook01,
	'meditations/book-02': meditationsBook02,
	'enchiridion/sections-01-10': enchiridionSections0110,
	'enchiridion/sections-11-20': enchiridionSections1120,
	'shortness-of-life/sections-01-07': shortnessSections0107,
	'shortness-of-life/sections-08-14': shortnessSections0814,
	'happy-life/sections-01-10': happySections0110,
	'happy-life/sections-11-20': happySections1120,
	'peace-of-mind/sections-01-09': peaceSections0109,
	'peace-of-mind/sections-10-17': peaceSections1017
};

const authorsBySlug = Object.fromEntries(authors.map((a) => [a.slug, a]));

export function getAuthors() {
	return [...authors].sort((a, b) => a.sort_order - b.sort_order);
}

export function getBookMeta(bookSlug) {
	const meta = META_BY_SLUG[bookSlug];
	if (!meta) throw error(404, `Book not found: ${bookSlug}`);
	return meta;
}

export function getBooks() {
	return Object.values(META_BY_SLUG).sort((a, b) => {
		const authorA = authorsBySlug[a.author_slug];
		const authorB = authorsBySlug[b.author_slug];
		return authorA.sort_order - authorB.sort_order;
	});
}

export function getBooksForAuthor(authorSlug) {
	return Object.values(META_BY_SLUG).filter((b) => b.author_slug === authorSlug);
}

export function getChapterCards(bookSlug, chapterSlug) {
	const key = `${bookSlug}/${chapterSlug}`;
	const cards = CHAPTER_DATA[key];
	if (!cards) throw error(404, `Chapter not found: ${key}`);
	return cards;
}

export function getCard(bookSlug, chapterSlug, cardNumber) {
	const cards = getChapterCards(bookSlug, chapterSlug);
	const card = cards.find((c) => c.card_number === cardNumber);
	if (!card) throw error(404, `Card not found: ${bookSlug}/${chapterSlug}/${cardNumber}`);
	return card;
}

export function getAdjacentCard(bookSlug, chapterSlug, cardNumber, direction) {
	const meta = getBookMeta(bookSlug);
	const chapters = meta.chapters;
	const chapterIndex = chapters.findIndex((ch) => ch.slug === chapterSlug);
	if (chapterIndex === -1) return null;

	const currentCards = getChapterCards(bookSlug, chapterSlug);
	const targetNumber = cardNumber + direction;
	const targetCard = currentCards.find((c) => c.card_number === targetNumber);
	if (targetCard) return targetCard;

	// Cross chapter boundary
	const nextChapterIndex = chapterIndex + direction;
	if (nextChapterIndex < 0 || nextChapterIndex >= chapters.length) return null;

	const nextChapter = chapters[nextChapterIndex];
	const nextCards = getChapterCards(bookSlug, nextChapter.slug);
	if (direction > 0) return nextCards[0] || null;
	return nextCards[nextCards.length - 1] || null;
}

export function getCardsByTag(tagSlug) {
	const allCards = getAllCards();
	return allCards.filter((c) => c.tags.includes(tagSlug));
}

export function getAllCards() {
	return Object.values(CHAPTER_DATA).flat();
}
