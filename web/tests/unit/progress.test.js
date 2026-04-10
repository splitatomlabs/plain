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

describe('progress store', () => {
	beforeEach(() => {
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();
		progress.reset();
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
			const now = Date.now();
			vi.spyOn(Date.prototype, 'toISOString')
				.mockReturnValueOnce(new Date(now).toISOString())
				.mockReturnValueOnce(new Date(now + 1000).toISOString());
			progress.markCardRead('meditations', 'meditations-01-001');
			progress.markCardRead('enchiridion', 'enchiridion-01-001');
			expect(progress.getLastReadBook()).toBe('enchiridion');
			vi.restoreAllMocks();
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
