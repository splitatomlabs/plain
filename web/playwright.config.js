import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
	projects: [
		{
			name: 'desktop',
			use: {
				viewport: { width: 1280, height: 720 }
			}
		},
		{
			name: 'mobile',
			use: {
				...devices['iPhone SE'],
				viewport: { width: 375, height: 812 }
			}
		}
	]
});
