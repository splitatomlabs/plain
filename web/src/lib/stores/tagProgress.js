import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'plain-tag-progress';
const RESUME_KEY = 'plain-tag-resume';

function loadFromStorage(key) {
	if (!browser) return {};
	try {
		const raw = localStorage.getItem(key);
		return raw ? JSON.parse(raw) : {};
	} catch {
		return {};
	}
}

function saveToStorage(key, data) {
	if (!browser) return;
	try {
		localStorage.setItem(key, JSON.stringify(data));
	} catch {
		// localStorage full or unavailable
	}
}

function createTagProgressStore() {
	const store = writable(loadFromStorage(STORAGE_KEY));
	const resumeStore = writable(loadFromStorage(RESUME_KEY));

	if (browser) {
		store.subscribe((value) => {
			saveToStorage(STORAGE_KEY, value);
		});
		resumeStore.subscribe((value) => {
			saveToStorage(RESUME_KEY, value);
		});
	}

	function ensureTag(data, tagSlug) {
		if (!data[tagSlug]) {
			data[tagSlug] = { cards_read: [] };
		}
		return data[tagSlug];
	}

	return {
		subscribe: store.subscribe,

		markTagCardRead(tagSlug, cardId) {
			store.update((data) => {
				const tag = ensureTag(data, tagSlug);
				if (!tag.cards_read.includes(cardId)) {
					tag.cards_read = [...tag.cards_read, cardId];
				}
				return { ...data };
			});
		},

		getTagProgress(tagSlug) {
			const data = get(store);
			const tag = data[tagSlug];
			if (!tag) {
				return { cardsRead: 0, cards: [] };
			}
			return {
				cardsRead: tag.cards_read.length,
				cards: [...tag.cards_read]
			};
		},

		getTagResumeIndex(tagSlug) {
			const data = get(resumeStore);
			return data[tagSlug] ?? 0;
		},

		setTagResumeIndex(tagSlug, index) {
			resumeStore.update((data) => {
				return { ...data, [tagSlug]: index };
			});
		},

		hasAnyTagProgress() {
			const data = get(store);
			return Object.values(data).some((tag) => tag.cards_read.length > 0);
		},

		reset() {
			store.set({});
			resumeStore.set({});
		}
	};
}

export const tagProgress = createTagProgressStore();
