import { getBookMeta, getAuthors, getCard } from '$lib/utils/content.js';
import { getTagsForBook } from '$lib/utils/tags.js';

export function load({ params }) {
	const meta = getBookMeta(params.book);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === meta.author_slug);
	const tags = getTagsForBook(params.book);

	const hasChapters = meta.slug === 'meditations';
	let previewCard = null;
	if (!hasChapters && meta.chapters.length > 0) {
		previewCard = getCard(meta.slug, meta.chapters[0].slug, 1);
	}

	return { book: meta, author, tags, previewCard };
}
