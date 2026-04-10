import { getBookMeta } from './content.js';

export const TAGS = [
	{ slug: 'calm-your-mind', label: 'Calm Your Mind' },
	{ slug: 'facing-fear', label: 'Facing Fear' },
	{ slug: 'dealing-with-anger', label: 'Dealing With Anger' },
	{ slug: 'death-and-mortality', label: 'Death & Mortality' },
	{ slug: 'doing-the-right-thing', label: 'Doing The Right Thing' },
	{ slug: 'self-discipline', label: 'Self-Discipline' },
	{ slug: 'ambition-and-power', label: 'Ambition & Power' },
	{ slug: 'leading-others', label: 'Leading Others' },
	{ slug: 'freedom-and-control', label: 'Freedom & Control' },
	{ slug: 'human-nature', label: 'Human Nature' },
	{ slug: 'standing-alone', label: 'Standing Alone' },
	{ slug: 'what-really-matters', label: 'What Really Matters' }
];

const tagsBySlug = Object.fromEntries(TAGS.map((t) => [t.slug, t]));

export function getTagBySlug(slug) {
	return tagsBySlug[slug];
}

export function getTagsForBook(bookSlug) {
	const meta = getBookMeta(bookSlug);
	return TAGS.filter((t) => meta.tags.includes(t.slug));
}
