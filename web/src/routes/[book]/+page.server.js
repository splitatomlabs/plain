import { getBookMeta, getAuthors, getChapterCards } from '$lib/utils/content.js';
import { getTagsForBook } from '$lib/utils/tags.js';

export function load({ params }) {
	const meta = getBookMeta(params.book);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === meta.author_slug);
	const tags = getTagsForBook(params.book);

	const hasChapters = meta.has_chapters;
	let previewCard = null;
	if (!hasChapters && meta.chapters.length > 0) {
		const allCards = meta.chapters.flatMap((ch) => getChapterCards(meta.slug, ch.slug));
		const shortCards = allCards.filter((c) => c.reading_time_seconds <= 30);
		const pool = shortCards.length > 0 ? shortCards : allCards;
		previewCard = pool[Math.floor(Math.random() * pool.length)];
	}

	return { book: meta, author, tags, previewCard };
}
