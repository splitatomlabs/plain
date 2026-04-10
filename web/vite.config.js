import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$content: path.resolve(__dirname, '../content')
		}
	},
	test: {
		environment: 'jsdom',
		globals: true
	}
});
