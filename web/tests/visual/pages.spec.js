import { test, expect } from '@playwright/test';

test.describe('Home page visual regression', () => {
	test('new visitor', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('home-new-visitor.png', { fullPage: true });
	});

	test('returning reader', async ({ page }) => {
		// Seed localStorage with reading progress
		await page.goto('/');
		await page.evaluate(() => {
			localStorage.setItem(
				'plain-progress',
				JSON.stringify({
					meditations: {
						lastCard: 'meditations-01-002',
						lastUrl: '/meditations/book-01/2',
						cardsRead: ['meditations-01-001', 'meditations-01-002']
					}
				})
			);
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.reload();
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('home-returning-reader.png', { fullPage: true });
	});
});

test.describe('Book landing page visual regression', () => {
	test('book landing', async ({ page }) => {
		await page.goto('/meditations');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('book-landing.png', { fullPage: true });
	});
});

test.describe('Tags visual regression', () => {
	test('tag index', async ({ page }) => {
		await page.goto('/tags');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('tags-index.png', { fullPage: true });
	});

	test('tag detail', async ({ page }) => {
		await page.goto('/tags/calm-your-mind');
		await page.evaluate(() => {
			document.documentElement.setAttribute('data-theme', 'light');
		});
		await page.waitForLoadState('networkidle');

		await expect(page).toHaveScreenshot('tag-detail.png', { fullPage: true });
	});
});
