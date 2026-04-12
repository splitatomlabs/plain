import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$app/environment', () => ({
	browser: true
}));

const localStorageMock = (() => {
	let store = {};
	return {
		getItem: vi.fn((key) => store[key] ?? null),
		setItem: vi.fn((key, value) => {
			store[key] = value;
		}),
		removeItem: vi.fn((key) => {
			delete store[key];
		}),
		clear: vi.fn(() => {
			store = {};
		}),
		_getStore: () => store
	};
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

const { tagProgress } = await import('$lib/stores/tagProgress.js');

describe('tagProgress store', () => {
	beforeEach(() => {
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();
		tagProgress.reset();
	});

	describe('markTagCardRead', () => {
		it('adds card to tag cards_read', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			const p = tagProgress.getTagProgress('calm-your-mind');
			expect(p.cardsRead).toBe(1);
			expect(p.cards).toContain('meditations-02-001');
		});

		it('does not duplicate cards already read', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			const p = tagProgress.getTagProgress('calm-your-mind');
			expect(p.cardsRead).toBe(1);
		});

		it('tracks multiple tags independently', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			tagProgress.markTagCardRead('freedom-and-control', 'enchiridion-01-001');
			expect(tagProgress.getTagProgress('calm-your-mind').cardsRead).toBe(1);
			expect(tagProgress.getTagProgress('freedom-and-control').cardsRead).toBe(1);
		});

		it('tracks multiple cards within a tag', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-03-005');
			tagProgress.markTagCardRead('calm-your-mind', 'enchiridion-01-002');
			const p = tagProgress.getTagProgress('calm-your-mind');
			expect(p.cardsRead).toBe(3);
			expect(p.cards).toEqual(['meditations-02-001', 'meditations-03-005', 'enchiridion-01-002']);
		});
	});

	describe('getTagProgress', () => {
		it('returns zeros for a tag with no progress', () => {
			const p = tagProgress.getTagProgress('calm-your-mind');
			expect(p.cardsRead).toBe(0);
			expect(p.cards).toEqual([]);
		});

		it('returns a copy of cards array', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			const p = tagProgress.getTagProgress('calm-your-mind');
			p.cards.push('fake-card');
			expect(tagProgress.getTagProgress('calm-your-mind').cardsRead).toBe(1);
		});
	});

	describe('resume index', () => {
		it('returns 0 for a tag with no resume index', () => {
			expect(tagProgress.getTagResumeIndex('calm-your-mind')).toBe(0);
		});

		it('persists resume index', () => {
			tagProgress.setTagResumeIndex('calm-your-mind', 42);
			expect(tagProgress.getTagResumeIndex('calm-your-mind')).toBe(42);
		});

		it('tracks resume indices independently per tag', () => {
			tagProgress.setTagResumeIndex('calm-your-mind', 10);
			tagProgress.setTagResumeIndex('freedom-and-control', 25);
			expect(tagProgress.getTagResumeIndex('calm-your-mind')).toBe(10);
			expect(tagProgress.getTagResumeIndex('freedom-and-control')).toBe(25);
		});
	});

	describe('hasAnyTagProgress', () => {
		it('returns false with no progress', () => {
			expect(tagProgress.hasAnyTagProgress()).toBe(false);
		});

		it('returns true after reading a card', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			expect(tagProgress.hasAnyTagProgress()).toBe(true);
		});
	});

	describe('localStorage sync', () => {
		it('persists tag progress to localStorage', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			const stored = JSON.parse(localStorageMock._getStore()['plain-tag-progress']);
			expect(stored['calm-your-mind'].cards_read).toContain('meditations-02-001');
		});

		it('persists resume index to localStorage', () => {
			tagProgress.setTagResumeIndex('calm-your-mind', 15);
			const stored = JSON.parse(localStorageMock._getStore()['plain-tag-resume']);
			expect(stored['calm-your-mind']).toBe(15);
		});
	});

	describe('reset', () => {
		it('clears all tag progress and resume indices', () => {
			tagProgress.markTagCardRead('calm-your-mind', 'meditations-02-001');
			tagProgress.setTagResumeIndex('calm-your-mind', 10);
			tagProgress.reset();
			expect(tagProgress.getTagProgress('calm-your-mind').cardsRead).toBe(0);
			expect(tagProgress.getTagResumeIndex('calm-your-mind')).toBe(0);
			expect(tagProgress.hasAnyTagProgress()).toBe(false);
		});
	});
});
