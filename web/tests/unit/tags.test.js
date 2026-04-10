import { describe, it, expect } from 'vitest';
import { TAGS, getTagBySlug, getTagsForBook } from '$lib/utils/tags.js';

describe('TAGS', () => {
	it('has 8 entries', () => {
		expect(TAGS).toHaveLength(8);
	});

	it('each has slug and label', () => {
		TAGS.forEach((tag) => {
			expect(tag.slug).toBeTruthy();
			expect(tag.label).toBeTruthy();
		});
	});
});

describe('getTagBySlug', () => {
	it('returns correct tag', () => {
		const tag = getTagBySlug('calm-your-mind');
		expect(tag).toEqual({ slug: 'calm-your-mind', label: 'Calm Your Mind' });
	});

	it('returns undefined for nonexistent slug', () => {
		expect(getTagBySlug('nonexistent')).toBeUndefined();
	});
});

describe('getTagsForBook', () => {
	it('returns subset matching book meta tags', () => {
		const tags = getTagsForBook('meditations');
		expect(tags.length).toBeGreaterThan(0);
		tags.forEach((t) => expect(TAGS).toContainEqual(t));
	});

	it('only returns tags present in the book meta', () => {
		const tags = getTagsForBook('happy-life');
		const slugs = tags.map((t) => t.slug);
		// happy-life meta has these tags
		expect(slugs).toContain('what-matters-most');
		expect(slugs).toContain('knowing-yourself');
	});
});
