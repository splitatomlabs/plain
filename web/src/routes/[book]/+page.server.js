import { getBookMeta, getAuthors } from '$lib/utils/content.js';
import { getTagsForBook } from '$lib/utils/tags.js';

export function load({ params }) {
	const meta = getBookMeta(params.book);
	const authors = getAuthors();
	const author = authors.find((a) => a.slug === meta.author_slug);
	const tags = getTagsForBook(params.book);

	return { book: meta, author, tags };
}
