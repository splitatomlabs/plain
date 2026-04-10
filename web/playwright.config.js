import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'CONTENT_DIR=fixtures npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	testDir: 'tests/e2e',
	projects: [
		{
			name: 'desktop-chrome',
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 720 }
			}
		},
		{
			name: 'mobile-chrome',
			use: {
				...devices['Pixel 5'],
				viewport: { width: 375, height: 812 }
			}
		}
	]
});
