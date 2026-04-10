import { writable, get } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'plain-favorites';

function loadFromStorage() {
	if (!browser) return [];
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? JSON.parse(raw) : [];
	} catch {
		return [];
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

function createFavoritesStore() {
	const store = writable(loadFromStorage());

	if (browser) {
		store.subscribe((value) => {
			saveToStorage(value);
		});
	}

	return {
		subscribe: store.subscribe,

		toggleFavorite(cardId) {
			store.update((favorites) => {
				if (favorites.includes(cardId)) {
					return favorites.filter((id) => id !== cardId);
				}
				return [...favorites, cardId];
			});
		},

		isFavorite(cardId) {
			return get(store).includes(cardId);
		},

		getFavorites() {
			return get(store);
		},

		reset() {
			store.set([]);
		}
	};
}

export const favorites = createFavoritesStore();
