import { test, expect } from '@playwright/test';

test.describe('Card page visual regression', () => {
	test('light mode', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('card-light.png', { fullPage: true });
	});

	test('dark mode', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'dark');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('card-dark.png', { fullPage: true });
	});

	test('show original expanded', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});

		const summary = page.locator('details.card-original summary');
		await summary.click();
		await expect(page.locator('details.card-original')).toHaveAttribute('open', '');

		await expect(page).toHaveScreenshot('card-original-expanded.png', { fullPage: true });
	});
});
