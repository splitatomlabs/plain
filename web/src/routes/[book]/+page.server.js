import { getBookMeta, getAuthors, getSectionsForBook } from '$lib/utils/content.js';
import { getTagsForBook } from '$lib/utils/tags.js';

export function load({ params }) {
	const meta = getBookMeta(params.book);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === meta.author_slug);
	const tags = getTagsForBook(params.book);
	const sections = meta.has_author_chapters ? [] : getSectionsForBook(params.book);

	return { book: meta, author, tags, sections };
}
