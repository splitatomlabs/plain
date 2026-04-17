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

// In-memory sessionStorage shim
const sessionStorageMock = (() => {
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
Object.defineProperty(globalThis, 'sessionStorage', { value: sessionStorageMock });

// Stub window.umami.track so trackEvent calls are observable without loading the real Umami script
const umamiTrackSpy = vi.fn();
Object.defineProperty(globalThis, 'window', {
	value: { umami: { track: umamiTrackSpy } },
	writable: true
});

// Must import after mocks are set up
const {
	getFirstSessionState,
	incrementSessionCardCount,
	markFirstBookStarted,
	isFirstBook,
	markFirstEngagementFired,
	trackReturnVisit
} = await import('$lib/analytics.js');

describe('analytics first-session helpers', () => {
	beforeEach(() => {
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();
		sessionStorageMock.clear();
		sessionStorageMock.getItem.mockClear();
		sessionStorageMock.setItem.mockClear();
		umamiTrackSpy.mockClear();
	});

	describe('getFirstSessionState', () => {
		it('returns defaults when keys are absent', () => {
			const state = getFirstSessionState();
			expect(state.firstEngagementFired).toBe(false);
			expect(state.sessionCardCount).toBe(0);
			expect(state.booksStarted).toEqual([]);
		});

		it('reflects persisted values', () => {
			localStorageMock._getStore()['plain:first_engagement_fired'] = 'true';
			sessionStorageMock._getStore()['plain:session_card_count'] = '3';
			localStorageMock._getStore()['plain:books_started'] = JSON.stringify(['enchiridion']);
			const state = getFirstSessionState();
			expect(state.firstEngagementFired).toBe(true);
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
			expect(sessionStorageMock._getStore()['plain:session_card_count']).toBe('3');
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

	describe('markFirstEngagementFired', () => {
		it('sets the first_engagement_fired flag to true', () => {
			markFirstEngagementFired();
			expect(localStorageMock._getStore()['plain:first_engagement_fired']).toBe('true');
		});

		it('getFirstSessionState reflects the flip', () => {
			markFirstEngagementFired();
			expect(getFirstSessionState().firstEngagementFired).toBe(true);
		});
	});

	describe('trackReturnVisit', () => {
		it('does nothing on first visit (no last_visit_at key)', () => {
			trackReturnVisit({ hasProgress: true });
			expect(umamiTrackSpy).not.toHaveBeenCalled();
		});

		it('writes last_visit_at even on first call', () => {
			trackReturnVisit({ hasProgress: false });
			expect(localStorageMock._getStore()['plain:last_visit_at']).toBeDefined();
		});

		it('does not fire when hasProgress is false even after >24h', () => {
			const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = past;
			trackReturnVisit({ hasProgress: false });
			expect(umamiTrackSpy).not.toHaveBeenCalled();
		});

		it('does not fire when last visit is within 24h', () => {
			const recent = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = recent;
			trackReturnVisit({ hasProgress: true });
			expect(umamiTrackSpy).not.toHaveBeenCalled();
		});

		it('fires return_visit when last visit is >24h ago and hasProgress is true', () => {
			const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
			localStorageMock._getStore()['plain:last_visit_at'] = past;
			trackReturnVisit({ hasProgress: true });
			expect(umamiTrackSpy).toHaveBeenCalledWith('return_visit', {});
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
