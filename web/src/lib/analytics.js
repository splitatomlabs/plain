import { browser, dev } from '$app/environment';

let analyticsEnabled = false;

if (browser && !dev) {
	analyticsEnabled = navigator.doNotTrack !== '1';
}

export function trackEvent(name, properties = {}) {
	if (!analyticsEnabled) return;
	try {
		// @vercel/analytics track function is injected via the Analytics component
		if (typeof window !== 'undefined' && window.va) {
			window.va('event', { name, ...properties });
		}
	} catch {
		// Analytics unavailable
	}
}

// ---------------------------------------------------------------------------
// First-session state helpers
// All keys are in localStorage under the "plain:" namespace, separate from
// "plain-progress" so they never collide with the progress store.
// ---------------------------------------------------------------------------

const KEY_FIRST_SESSION = 'plain:first_session';
const KEY_SESSION_CARD_COUNT = 'plain:session_card_count';
const KEY_BOOKS_STARTED = 'plain:books_started';
const KEY_LAST_VISIT_AT = 'plain:last_visit_at';

/** Returns the current first-session state, using safe defaults when absent. */
export function getFirstSessionState() {
	if (!browser) return { firstSession: true, sessionCardCount: 0, booksStarted: [] };
	try {
		const firstSession = localStorage.getItem(KEY_FIRST_SESSION) !== 'false';
		const rawCount = sessionStorage.getItem(KEY_SESSION_CARD_COUNT);
		const sessionCardCount = rawCount !== null ? parseInt(rawCount, 10) : 0;
		const rawBooks = localStorage.getItem(KEY_BOOKS_STARTED);
		const booksStarted = rawBooks ? JSON.parse(rawBooks) : [];
		return { firstSession, sessionCardCount, booksStarted };
	} catch {
		return { firstSession: true, sessionCardCount: 0, booksStarted: [] };
	}
}

/** Increments the session card count. Returns the new value. */
export function incrementSessionCardCount() {
	if (!browser) return 0;
	try {
		const rawCount = sessionStorage.getItem(KEY_SESSION_CARD_COUNT);
		const next = (rawCount !== null ? parseInt(rawCount, 10) : 0) + 1;
		sessionStorage.setItem(KEY_SESSION_CARD_COUNT, String(next));
		return next;
	} catch {
		return 0;
	}
}

/** Appends slug to the books-started list if not already present. */
export function markFirstBookStarted(slug) {
	if (!browser) return;
	try {
		const rawBooks = localStorage.getItem(KEY_BOOKS_STARTED);
		const books = rawBooks ? JSON.parse(rawBooks) : [];
		if (!books.includes(slug)) {
			books.push(slug);
			localStorage.setItem(KEY_BOOKS_STARTED, JSON.stringify(books));
		}
	} catch {
		// localStorage unavailable
	}
}

/** Returns true iff the books-started list is empty or missing (next book would be first). */
export function isFirstBook() {
	if (!browser) return true;
	try {
		const rawBooks = localStorage.getItem(KEY_BOOKS_STARTED);
		if (!rawBooks) return true;
		const books = JSON.parse(rawBooks);
		return books.length === 0;
	} catch {
		return true;
	}
}

/** Permanently ends the first session by setting the flag to false. */
export function endFirstSession() {
	if (!browser) return;
	try {
		localStorage.setItem(KEY_FIRST_SESSION, 'false');
	} catch {
		// localStorage unavailable
	}
}

/**
 * Fires `return_visit` if the last visit was >24 h ago AND the caller reports
 * existing progress. Always updates `plain:last_visit_at` to now.
 *
 * @param {{ hasProgress: boolean }} options
 */
export function trackReturnVisit({ hasProgress } = {}) {
	if (!browser) return;
	try {
		const now = new Date();
		const rawLast = localStorage.getItem(KEY_LAST_VISIT_AT);
		if (rawLast && hasProgress) {
			const last = new Date(rawLast);
			const diffMs = now - last;
			if (diffMs > 24 * 60 * 60 * 1000) {
				trackEvent('return_visit');
			}
		}
		if (analyticsEnabled) {
			localStorage.setItem(KEY_LAST_VISIT_AT, now.toISOString());
		}
	} catch {
		// localStorage unavailable
	}
}
