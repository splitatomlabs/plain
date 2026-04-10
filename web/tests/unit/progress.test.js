import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock $app/environment before importing the store
vi.mock('$app/environment', () => ({
	browser: true
}));

// Mock localStorage
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

// Must import after mocks are set up
const { progress } = await import('$lib/stores/progress.js');
const { favorites } = await import('$lib/stores/favorites.js');

describe('progress store', () => {
	beforeEach(() => {
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();
		progress.reset();
		favorites.reset();
	});

	describe('markCardRead', () => {
		it('adds card to cards_read and updates last_card and last_read_at', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			const p = progress.getProgress('meditations', 6);
			expect(p.cardsRead).toBe(1);
			expect(p.lastCard).toBe('meditations-01-001');
		});

		it('does not duplicate cards already read', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			progress.markCardRead('meditations', 'meditations-01-001');
			const p = progress.getProgress('meditations', 6);
			expect(p.cardsRead).toBe(1);
		});

		it('initializes book entry if not present', () => {
			progress.markCardRead('enchiridion', 'enchiridion-01-001');
			const p = progress.getProgress('enchiridion', 10);
			expect(p.cardsRead).toBe(1);
		});
	});

	describe('getProgress', () => {
		it('returns zeros for a book with no progress', () => {
			const p = progress.getProgress('meditations', 6);
			expect(p.cardsRead).toBe(0);
			expect(p.totalCards).toBe(6);
			expect(p.percentage).toBe(0);
			expect(p.lastCard).toBeNull();
		});

		it('calculates correct percentage', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			progress.markCardRead('meditations', 'meditations-01-002');
			progress.markCardRead('meditations', 'meditations-01-003');
			const p = progress.getProgress('meditations', 6);
			expect(p.cardsRead).toBe(3);
			expect(p.percentage).toBe(50);
		});
	});

	describe('getAuthorProgress', () => {
		it('aggregates progress across books for an author', () => {
			const senecaBooks = [
				{ slug: 'shortness-of-life', total_cards: 10 },
				{ slug: 'happy-life', total_cards: 10 },
				{ slug: 'peace-of-mind', total_cards: 10 }
			];
			progress.markCardRead('shortness-of-life', 'shortness-of-life-01-001');
			progress.markCardRead('happy-life', 'happy-life-01-001');
			progress.markCardRead('happy-life', 'happy-life-01-002');
			const p = progress.getAuthorProgress('seneca', senecaBooks);
			expect(p.cardsRead).toBe(3);
			expect(p.totalCards).toBe(30);
			expect(p.percentage).toBe(10);
		});

		it('returns zero for author with no progress', () => {
			const books = [{ slug: 'meditations', total_cards: 6 }];
			const p = progress.getAuthorProgress('marcus-aurelius', books);
			expect(p.cardsRead).toBe(0);
			expect(p.percentage).toBe(0);
		});
	});

	describe('getLastReadBook', () => {
		it('returns null when no books have been read', () => {
			expect(progress.getLastReadBook()).toBeNull();
		});

		it('returns most recently read book', () => {
			const realDateNow = Date.now;
			let time = 1000000;
			Date.now = () => time;
			const RealDate = globalThis.Date;
			const OrigDate = Date;
			globalThis.Date = class extends RealDate {
				constructor(...args) {
					if (args.length === 0) super(time);
					else super(...args);
				}
			};
			globalThis.Date.now = () => time;

			progress.markCardRead('meditations', 'meditations-01-001');
			time = 2000000;
			progress.markCardRead('enchiridion', 'enchiridion-01-001');

			expect(progress.getLastReadBook()).toBe('enchiridion');

			globalThis.Date = RealDate;
			Date.now = realDateNow;
		});
	});

	describe('isCompleted / markCompleted', () => {
		it('returns false for unread book', () => {
			expect(progress.isCompleted('meditations')).toBe(false);
		});

		it('marks book as completed with timestamp', () => {
			progress.markCompleted('meditations');
			expect(progress.isCompleted('meditations')).toBe(true);
		});
	});

	describe('hasAnyProgress', () => {
		it('returns false with no progress', () => {
			expect(progress.hasAnyProgress()).toBe(false);
		});

		it('returns true after reading a card', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			expect(progress.hasAnyProgress()).toBe(true);
		});
	});

	describe('localStorage sync', () => {
		it('persists to localStorage on mutation', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			const stored = JSON.parse(localStorageMock._getStore()['plain-progress']);
			expect(stored.meditations.cards_read).toContain('meditations-01-001');
		});
	});
});

describe('favorites store', () => {
	beforeEach(() => {
		localStorageMock.clear();
		favorites.reset();
	});

	describe('toggleFavorite', () => {
		it('adds a card to favorites', () => {
			favorites.toggleFavorite('meditations-05-016');
			expect(favorites.isFavorite('meditations-05-016')).toBe(true);
		});

		it('removes a card when toggled again', () => {
			favorites.toggleFavorite('meditations-05-016');
			favorites.toggleFavorite('meditations-05-016');
			expect(favorites.isFavorite('meditations-05-016')).toBe(false);
		});
	});

	describe('isFavorite', () => {
		it('returns false for unfavorited card', () => {
			expect(favorites.isFavorite('meditations-05-016')).toBe(false);
		});

		it('reflects current state after toggles', () => {
			favorites.toggleFavorite('meditations-05-016');
			expect(favorites.isFavorite('meditations-05-016')).toBe(true);
			favorites.toggleFavorite('meditations-05-016');
			expect(favorites.isFavorite('meditations-05-016')).toBe(false);
		});
	});

	describe('getFavorites', () => {
		it('returns empty array initially', () => {
			expect(favorites.getFavorites()).toEqual([]);
		});

		it('returns all favorited card IDs', () => {
			favorites.toggleFavorite('meditations-05-016');
			favorites.toggleFavorite('enchiridion-01-008');
			expect(favorites.getFavorites()).toEqual(['meditations-05-016', 'enchiridion-01-008']);
		});
	});

	describe('localStorage sync', () => {
		it('persists favorites to localStorage', () => {
			favorites.toggleFavorite('meditations-05-016');
			const stored = JSON.parse(localStorageMock._getStore()['plain-favorites']);
			expect(stored).toContain('meditations-05-016');
		});
	});
});
