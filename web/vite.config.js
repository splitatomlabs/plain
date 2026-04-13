import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
	plugins: [sveltekit()],
	server: {
		watch: {
			ignored: ['**/.vercel/**', '**/.svelte-kit/**']
		}
	},
	resolve: {
		alias: {
			$content: path.resolve(__dirname, '../content/output')
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
