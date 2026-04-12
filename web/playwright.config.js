import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	testDir: 'tests',
	projects: [
		{
			name: 'desktop-chrome',
			testMatch: ['e2e/**/*.spec.js'],
			use: {
				...devices['Desktop Chrome'],
				viewport: { width: 1280, height: 720 }
			}
		},
		{
			name: 'mobile-chrome',
			testMatch: ['e2e/**/*.spec.js'],
			use: {
				...devices['Pixel 5'],
				viewport: { width: 375, height: 812 }
			}
		}
	]
});
