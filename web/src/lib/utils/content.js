import { error } from '@sveltejs/kit';

const authorModules = import.meta.glob('$content/authors.json', { eager: true, import: 'default' });
const metaModules = import.meta.glob('$content/*/_meta.json', { eager: true, import: 'default' });
const allJsonModules = import.meta.glob('$content/**/*.json', { eager: true, import: 'default' });

const authors = Object.values(authorModules)[0];
const authorsBySlug = Object.fromEntries(authors.map((a) => [a.slug, a]));

const META_BY_SLUG = {};
for (const meta of Object.values(metaModules)) {
	META_BY_SLUG[meta.slug] = meta;
}

const CHAPTER_DATA = {};
for (const [path, data] of Object.entries(allJsonModules)) {
	// Skip meta files and authors
	if (path.endsWith('_meta.json') || path.endsWith('authors.json')) continue;
	// Extract book slug and chapter slug from path like ".../meditations/book-01.json"
	const parts = path.split('/');
	const bookSlug = parts[parts.length - 2];
	const chapterSlug = parts[parts.length - 1].replace('.json', '');
	CHAPTER_DATA[`${bookSlug}/${chapterSlug}`] = data;
}

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
