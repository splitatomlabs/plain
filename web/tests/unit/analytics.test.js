import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock $app/environment before importing analytics
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false
}));

// In-memory localStorage shim
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

// Stub window.va so trackEvent calls are observable without relying on real Vercel
const vaSpy = vi.fn();
Object.defineProperty(globalThis, 'window', {
	value: { va: vaSpy },
	writable: true
});

// Must import after mocks are set up
const {
	getFirstSessionState,
	incrementSessionCardCount,
	markFirstBookStarted,
	isFirstBook,
	endFirstSession,
	trackReturnVisit
} = await import('$lib/analytics.js');

describe('analytics first-session helpers', () => {
	beforeEach(() => {
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();
		vaSpy.mockClear();
	});

	describe('getFirstSessionState', () => {
		it('returns defaults when keys are absent', () => {
			const state = getFirstSessionState();
			expect(state.firstSession).toBe(true);
			expect(state.sessionCardCount).toBe(0);
			expect(state.booksStarted).toEqual([]);
		});

		it('reflects persisted values', () => {
			localStorageMock._getStore()['plain:first_session'] = 'false';
			localStorageMock._getStore()['plain:session_card_count'] = '3';
			localStorageMock._getStore()['plain:books_started'] = JSON.stringify(['enchiridion']);
			const state = getFirstSessionState();
			expect(state.firstSession).toBe(false);
			expect(state.sessionCardCount).toBe(3);
			expect(state.booksStarted).toEqual(['enchiridion']);
		});
	});

	describe('incrementSessionCardCount', () => {
		it('returns 1 on first call when key is absent', () => {
			expect(incrementSessionCardCount()).toBe(1);
		});

		it('increments and persists correctly across multiple calls', () => {
			incrementSessionCardCount();
			incrementSessionCardCount();
			const result = incrementSessionCardCount();
			expect(result).toBe(3);
			expect(localStorageMock._getStore()['plain:session_card_count']).toBe('3');
		});
	});

	describe('markFirstBookStarted', () => {
		it('appends a slug to the list', () => {
			markFirstBookStarted('meditations');
			const stored = JSON.parse(localStorageMock._getStore()['plain:books_started']);
			expect(stored).toContain('meditations');
		});

		it('deduplicates — adding the same slug twice keeps only one entry', () => {
			markFirstBookStarted('meditations');
			markFirstBookStarted('meditations');
			const stored = JSON.parse(localStorageMock._getStore()['plain:books_started']);
			expect(stored.filter((s) => s === 'meditations').length).toBe(1);
		});

		it('appends distinct slugs without removing previous ones', () => {
			markFirstBookStarted('meditations');
			markFirstBookStarted('enchiridion');
			const stored = JSON.parse(localStorageMock._getStore()['plain:books_started']);
			expect(stored).toContain('meditations');
			expect(stored).toContain('enchiridion');
		});
	});

	describe('isFirstBook', () => {
		it('returns true when list is absent', () => {
			expect(isFirstBook()).toBe(true);
		});

		it('returns false after markFirstBookStarted is called', () => {
			markFirstBookStarted('meditations');
			expect(isFirstBook()).toBe(false);
		});
	});

	describe('endFirstSession', () => {
		it('sets the first_session flag to false', () => {
			endFirstSession();
			expect(localStorageMock._getStore()['plain:first_session']).toBe('false');
		});

		it('getFirstSessionState reflects the flip', () => {
			endFirstSession();
			expect(getFirstSessionState().firstSession).toBe(false);
		});
	});

	describe('trackReturnVisit', () => {
		it('does nothing on first visit (no last_visit_at key)', () => {
			trackReturnVisit({ hasProgress: true });
			expect(vaSpy).not.toHaveBeenCalled();
		});

		it('writes last_visit_at even on first call', () => {
			trackReturnVisit({ hasProgress: false });
			expect(localStorageMock._getStore()['plain:last_visit_at']).toBeDefined();
		});

		it('does not fire when hasProgress is false even after >24h', () => {
			const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = past;
			trackReturnVisit({ hasProgress: false });
			expect(vaSpy).not.toHaveBeenCalled();
		});

		it('does not fire when last visit is within 24h', () => {
			const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = recent;
			trackReturnVisit({ hasProgress: true });
			expect(vaSpy).not.toHaveBeenCalled();
		});

		it('fires return_visit when last visit is >24h ago and hasProgress is true', () => {
			const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = past;
			trackReturnVisit({ hasProgress: true });
			expect(vaSpy).toHaveBeenCalledWith('event', { name: 'return_visit' });
		});

		it('updates last_visit_at to now on every call', () => {
			const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = past;
			const before = Date.now();
			trackReturnVisit({ hasProgress: true });
			const stored = new Date(localStorageMock._getStore()['plain:last_visit_at']).getTime();
			expect(stored).toBeGreaterThanOrEqual(before);
		});
	});
});
