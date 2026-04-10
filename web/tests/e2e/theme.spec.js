import { test, expect } from '@playwright/test';

test.describe('Theme toggle', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.goto('/');
	});

	test('theme toggle changes theme', async ({ page }) => {
		const toggle = page.locator('.theme-toggle');
		await expect(toggle).toBeVisible();

		// Default is light
		const initialTheme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(initialTheme).toBe('light');

		// Click toggle → dark
		await toggle.click();
		const darkTheme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(darkTheme).toBe('dark');

		// Click toggle → light again
		await toggle.click();
		const lightTheme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(lightTheme).toBe('light');
	});

	test('theme persists across page loads', async ({ page }) => {
		const toggle = page.locator('.theme-toggle');

		// Switch to dark
		await toggle.click();
		const darkTheme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(darkTheme).toBe('dark');

		// Reload page
		await page.reload();
		await page.waitForSelector('.theme-toggle');

		const persistedTheme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(persistedTheme).toBe('dark');
	});

	test('card page renders in dark mode', async ({ page }) => {
		// Set dark theme
		const toggle = page.locator('.theme-toggle');
		await toggle.click();

		// Navigate to card page
		await page.goto('/meditations/book-01/1');

		const theme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(theme).toBe('dark');

		// Card should be visible
		const card = page.locator('article');
		await expect(card).toBeVisible();
	});

	test('card page renders in light mode', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const card = page.locator('article');
		await expect(card).toBeVisible();

		const theme = await page.evaluate(() =>
			document.documentElement.getAttribute('data-theme')
		);
		expect(theme).toBe('light');
	});
});
