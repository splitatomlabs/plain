import { getBookMeta } from './content.js';

export const TAGS = [
	{ slug: 'calm-your-mind', label: 'Calm Your Mind' },
	{ slug: 'death-and-mortality', label: 'Death & Mortality' },
	{ slug: 'doing-the-right-thing', label: 'Doing The Right Thing' },
	{ slug: 'facing-hardship', label: 'Facing Hardship' },
	{ slug: 'freedom-and-control', label: 'Freedom & Control' },
	{ slug: 'human-nature', label: 'Human Nature' },
	{ slug: 'knowing-yourself', label: 'Knowing Yourself' },
	{ slug: 'what-matters-most', label: 'What Matters Most' }
];

const tagsBySlug = Object.fromEntries(TAGS.map((t) => [t.slug, t]));

export function getTagBySlug(slug) {
	return tagsBySlug[slug];
}

export function getTagsForBook(bookSlug) {
	const meta = getBookMeta(bookSlug);
	return TAGS.filter((t) => meta.tags.includes(t.slug));
}
