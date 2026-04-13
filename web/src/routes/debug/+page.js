import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getBooks } from '$lib/utils/content.js';

export const prerender = false;

export function load() {
	if (!dev) {
		throw error(404, 'Not found');
	}
	return { books: getBooks() };
}
