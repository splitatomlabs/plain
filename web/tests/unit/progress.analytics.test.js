import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock $app/environment before importing the store
vi.mock('$app/environment', () => ({
	browser: true,
	dev: false
}));

// In-memory localStorage shim (same pattern as progress.test.js)
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

// --- Analytics mock ---
// trackEvent spy plus in-memory stub implementations of first-session helpers.
// Using an object so the beforeEach reset can mutate in place without re-creating references.
const analyticsState = {
	firstSession: true,
	sessionCardCount: 0,
	booksStarted: []
};

const trackEventSpy = vi.fn();

vi.mock('$lib/analytics.js', () => {
	return {
		trackEvent: (...args) => trackEventSpy(...args),
		getFirstSessionState: () => ({
			firstSession: analyticsState.firstSession,
			sessionCardCount: analyticsState.sessionCardCount,
			booksStarted: [...analyticsState.booksStarted]
		}),
		incrementSessionCardCount: () => {
			analyticsState.sessionCardCount += 1;
			return analyticsState.sessionCardCount;
		},
		markFirstBookStarted: (slug) => {
			if (!analyticsState.booksStarted.includes(slug)) {
				analyticsState.booksStarted.push(slug);
			}
		},
		isFirstBook: () => analyticsState.booksStarted.length === 0,
		endFirstSession: () => {
			analyticsState.firstSession = false;
		}
	};
});

// Must import after mocks are set up.
// progress.js is a module singleton — import it once; call progress.reset() in beforeEach.
const { progress } = await import('$lib/stores/progress.js');

describe('progress store — analytics events', () => {
	beforeEach(() => {
		// Reset localStorage
		localStorageMock.clear();
		localStorageMock.getItem.mockClear();
		localStorageMock.setItem.mockClear();

		// Reset store state
		progress.reset();

		// Reset trackEvent spy
		trackEventSpy.mockClear();

		// Reset in-memory analytics state
		analyticsState.firstSession = true;
		analyticsState.sessionCardCount = 0;
		analyticsState.booksStarted = [];
	});

	// -----------------------------------------------------------------------
	// 1. book_started
	// -----------------------------------------------------------------------
	describe('book_started', () => {
		it('fires exactly once on the 0→1 cards_read transition for a book', () => {
			progress.markCardRead('meditations', 'meditations-01-001');

			const bookStartedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_started');
			expect(bookStartedCalls).toHaveLength(1);
			expect(bookStartedCalls[0][1]).toMatchObject({ book_id: 'meditations' });
		});

		it('fires with is_first_book=true for the very first book ever', () => {
			progress.markCardRead('meditations', 'meditations-01-001');

			const call = trackEventSpy.mock.calls.find((c) => c[0] === 'book_started');
			expect(call[1].is_first_book).toBe(true);
		});

		it('fires with is_first_book=false for a subsequent book', () => {
			// Start first book so booksStarted is no longer empty
			progress.markCardRead('meditations', 'meditations-01-001');
			trackEventSpy.mockClear();

			progress.markCardRead('enchiridion', 'enchiridion-01-001');

			const call = trackEventSpy.mock.calls.find((c) => c[0] === 'book_started');
			expect(call[1].is_first_book).toBe(false);
		});

		it('does NOT fire again when re-reading the same card (no new entry)', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			trackEventSpy.mockClear();

			progress.markCardRead('meditations', 'meditations-01-001');

			const bookStartedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_started');
			expect(bookStartedCalls).toHaveLength(0);
		});

		it('does NOT fire again for a second new card in the same book', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			trackEventSpy.mockClear();

			progress.markCardRead('meditations', 'meditations-01-002');

			const bookStartedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_started');
			expect(bookStartedCalls).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// 2. engaged_session
	// -----------------------------------------------------------------------
	describe('engaged_session', () => {
		it('fires exactly once after 2 distinct cards are marked read in a single session', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			progress.markCardRead('meditations', 'meditations-01-002');

			const engagedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'engaged_session');
			expect(engagedCalls).toHaveLength(1);
		});

		it('does NOT fire after only 1 distinct card', () => {
			progress.markCardRead('meditations', 'meditations-01-001');

			const engagedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'engaged_session');
			expect(engagedCalls).toHaveLength(0);
		});

		it('never fires again even across many more markCardRead calls', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			progress.markCardRead('meditations', 'meditations-01-002'); // fires here

			trackEventSpy.mockClear();

			// Read many more distinct cards
			for (let i = 3; i <= 10; i++) {
				progress.markCardRead('meditations', `meditations-01-00${i}`);
			}
			progress.markCardRead('enchiridion', 'enchiridion-01-001');

			const engagedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'engaged_session');
			expect(engagedCalls).toHaveLength(0);
		});

		it('does NOT fire for the re-read of the same card (only distinct cards count)', () => {
			progress.markCardRead('meditations', 'meditations-01-001');
			trackEventSpy.mockClear();

			// Re-read same card — should not increment session count
			progress.markCardRead('meditations', 'meditations-01-001');

			const engagedCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'engaged_session');
			expect(engagedCalls).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// 3. milestone_reached
	// -----------------------------------------------------------------------
	describe('milestone_reached', () => {
		// totalCards=4 → 1 card=25%, 2=50%, 3=75%, 4=100%
		const BOOK = 'meditations';
		const TOTAL = 4;

		it('fires milestone=25 when first card is read out of 4', () => {
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL);

			const calls = trackEventSpy.mock.calls.filter(
				(c) => c[0] === 'milestone_reached' && c[1]?.milestone === 25
			);
			expect(calls).toHaveLength(1);
			expect(calls[0][1]).toMatchObject({ book_id: BOOK, milestone: 25 });
		});

		it('fires milestone=50 when second card is read out of 4', () => {
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL);
			trackEventSpy.mockClear();

			progress.markCardRead(BOOK, `${BOOK}-01-002`, null, TOTAL);

			const calls = trackEventSpy.mock.calls.filter(
				(c) => c[0] === 'milestone_reached' && c[1]?.milestone === 50
			);
			expect(calls).toHaveLength(1);
		});

		it('fires milestone=75 when third card is read out of 4', () => {
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL);
			progress.markCardRead(BOOK, `${BOOK}-01-002`, null, TOTAL);
			trackEventSpy.mockClear();

			progress.markCardRead(BOOK, `${BOOK}-01-003`, null, TOTAL);

			const calls = trackEventSpy.mock.calls.filter(
				(c) => c[0] === 'milestone_reached' && c[1]?.milestone === 75
			);
			expect(calls).toHaveLength(1);
		});

		it('fires milestone=100 when fourth card is read out of 4', () => {
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL);
			progress.markCardRead(BOOK, `${BOOK}-01-002`, null, TOTAL);
			progress.markCardRead(BOOK, `${BOOK}-01-003`, null, TOTAL);
			trackEventSpy.mockClear();

			progress.markCardRead(BOOK, `${BOOK}-01-004`, null, TOTAL);

			const calls = trackEventSpy.mock.calls.filter(
				(c) => c[0] === 'milestone_reached' && c[1]?.milestone === 100
			);
			expect(calls).toHaveLength(1);
		});

		it('each milestone fires exactly once across the full read-through', () => {
			const cards = ['001', '002', '003', '004'];
			for (const n of cards) {
				progress.markCardRead(BOOK, `${BOOK}-01-${n}`, null, TOTAL);
			}

			for (const threshold of [25, 50, 75, 100]) {
				const calls = trackEventSpy.mock.calls.filter(
					(c) => c[0] === 'milestone_reached' && c[1]?.milestone === threshold
				);
				expect(calls).toHaveLength(1);
			}
		});

		it('re-reading a card does NOT re-fire the milestone', () => {
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL); // triggers 25
			trackEventSpy.mockClear();

			// Re-read the same card
			progress.markCardRead(BOOK, `${BOOK}-01-001`, null, TOTAL);

			const milestoneCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'milestone_reached');
			expect(milestoneCalls).toHaveLength(0);
		});

		it('does NOT fire when totalCards is not provided', () => {
			// markCardRead without totalCards arg
			progress.markCardRead(BOOK, `${BOOK}-01-001`);

			const milestoneCalls = trackEventSpy.mock.calls.filter((c) => c[0] === 'milestone_reached');
			expect(milestoneCalls).toHaveLength(0);
		});
	});

	// -----------------------------------------------------------------------
	// 4. book_completed
	// -----------------------------------------------------------------------
	describe('book_completed', () => {
		it('fires once from markCompleted', () => {
			progress.markCompleted('meditations');

			const calls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_completed');
			expect(calls).toHaveLength(1);
			expect(calls[0][1]).toMatchObject({ book_id: 'meditations' });
		});

		it('does NOT fire again on a second markCompleted call for the same book', () => {
			progress.markCompleted('meditations');
			trackEventSpy.mockClear();

			progress.markCompleted('meditations');

			const calls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_completed');
			expect(calls).toHaveLength(0);
		});

		it('fires independently for two different books', () => {
			progress.markCompleted('meditations');
			progress.markCompleted('enchiridion');

			const calls = trackEventSpy.mock.calls.filter((c) => c[0] === 'book_completed');
			expect(calls).toHaveLength(2);
			const bookIds = calls.map((c) => c[1].book_id);
			expect(bookIds).toContain('meditations');
			expect(bookIds).toContain('enchiridion');
		});
	});
});
