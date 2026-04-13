import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';
import { trackEvent } from '$lib/analytics.js';

const STORAGE_KEY = 'plain-progress';

function loadFromStorage() {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function saveToStorage(data) {
	if (!browser) return;
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
	} catch {
		// localStorage full or unavailable
	}
}

function createProgressStore() {
	const store = writable(loadFromStorage());

	if (browser) {
		store.subscribe((value) => {
			saveToStorage(value);
		});
	}

	function ensureBook(data, bookSlug) {
		if (!data[bookSlug]) {
			data[bookSlug] = {
				cards_read: [],
				last_card: null,
				last_read_at: null,
				completed: false,
				completed_at: null
			};
		}
		return data[bookSlug];
	}

	return {
		subscribe: store.subscribe,

		markCardRead(bookSlug, cardId, resumeUrl = null) {
			store.update((data) => {
				const book = ensureBook(data, bookSlug);
				if (!book.cards_read.includes(cardId)) {
					book.cards_read = [...book.cards_read, cardId];
				}
				book.last_card = cardId;
				book.last_read_at = new Date().toISOString();
				if (resumeUrl !== null) {
					book.resume_url = resumeUrl;
				}
				return { ...data };
			});
		},

		getProgress(bookSlug, totalCards) {
			const data = get(store);
			const book = data[bookSlug];
			if (!book) {
				return { cardsRead: 0, totalCards, percentage: 0, lastCard: null };
			}
			const cardsRead = book.cards_read.length;
			return {
				cardsRead,
				totalCards,
				percentage: totalCards > 0 ? Math.round((cardsRead / totalCards) * 100) : 0,
				lastCard: book.last_card
			};
		},

		getAuthorProgress(authorSlug, booksByAuthor) {
			const data = get(store);
			let cardsRead = 0;
			let totalCards = 0;
			for (const book of booksByAuthor) {
				totalCards += book.total_cards;
				const bookData = data[book.slug];
				if (bookData) {
					cardsRead += bookData.cards_read.length;
				}
			}
			return {
				cardsRead,
				totalCards,
				percentage: totalCards > 0 ? Math.round((cardsRead / totalCards) * 100) : 0
			};
		},

		getChapterProgress(bookSlug, chapterSlug, chapterCardCount) {
			const data = get(store);
			const book = data[bookSlug];
			if (!book) {
				return { cardsRead: 0, total: chapterCardCount, percentage: 0, completed: false };
			}
			const chapterMatch = chapterSlug.match(/(\d+)/);
			const chapterNum = chapterMatch ? chapterMatch[1] : '00';
			const prefix = `${bookSlug}-${chapterNum}-`;
			const cardsRead = book.cards_read.filter((id) => id.startsWith(prefix)).length;
			return {
				cardsRead,
				total: chapterCardCount,
				percentage: chapterCardCount > 0 ? Math.round((cardsRead / chapterCardCount) * 100) : 0,
				completed: cardsRead >= chapterCardCount
			};
		},

		getResumeUrl(bookSlug) {
			const data = get(store);
			return data[bookSlug]?.resume_url || null;
		},

		getLastReadBook() {
			const data = get(store);
			let lastBook = null;
			let lastTime = null;
			for (const [slug, book] of Object.entries(data)) {
				if (book.last_read_at) {
					if (!lastTime || book.last_read_at > lastTime) {
						lastTime = book.last_read_at;
						lastBook = slug;
					}
				}
			}
			return lastBook;
		},

		isCompleted(bookSlug) {
			const data = get(store);
			return data[bookSlug]?.completed === true;
		},

		markCompleted(bookSlug) {
			store.update((data) => {
				const book = ensureBook(data, bookSlug);
				book.completed = true;
				book.completed_at = new Date().toISOString();
				return { ...data };
			});
		},

		hasAnyProgress() {
			const data = get(store);
			return Object.values(data).some((book) => book.cards_read.length > 0);
		},

		trackBookLandingViewed(bookSlug) {
			trackEvent('book_landing_viewed', { book_id: bookSlug });
		},

		reset() {
			store.set({});
		}
	};
}

export const progress = createProgressStore();
