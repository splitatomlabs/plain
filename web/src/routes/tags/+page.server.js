import { TAGS } from '$lib/utils/tags.js';
import { getCardsByTag } from '$lib/utils/content.js';

export function load() {
	const tagsWithCounts = TAGS.map((tag) => ({
		...tag,
		count: getCardsByTag(tag.slug).length
	}));

	return { tags: tagsWithCounts };
}
