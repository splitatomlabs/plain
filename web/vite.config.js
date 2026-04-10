import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

const contentDir = process.env.CONTENT_DIR === 'fixtures'
	? path.resolve(__dirname, '../content/fixtures')
	: path.resolve(__dirname, '../content');

export default defineConfig({
	plugins: [sveltekit()],
	resolve: {
		alias: {
			$content: contentDir
		}
	},
	test: {
		globals: true,
		include: ['tests/**/*.test.js'],
		alias: {
			$content: path.resolve(__dirname, '../content/fixtures')
		}
	}
});
