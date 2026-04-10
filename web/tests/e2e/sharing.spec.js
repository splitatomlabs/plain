import { test, expect } from '@playwright/test';

test.describe('Share button', () => {
	test('share button is visible on card page', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		const shareButton = page.locator('button[aria-label="Share this card"]');
		await expect(shareButton).toBeVisible();
	});
});

test.describe('Gift-a-book', () => {
	test('gift banner displays with decoded note', async ({ page }) => {
		const note = 'I thought you would love this!';
		const encoded = Buffer.from(note).toString('base64');
		await page.goto(`/meditations?gift=true&note=${encoded}`);

		const banner = page.locator('.gift-banner');
		await expect(banner).toBeVisible();
		await expect(banner).toContainText(note);
	});

	test('gift banner has Start reading CTA', async ({ page }) => {
		const note = 'Enjoy!';
		const encoded = Buffer.from(note).toString('base64');
		await page.goto(`/meditations?gift=true&note=${encoded}`);

		const cta = page.locator('.gift-cta');
		await expect(cta).toHaveText('Start reading');
		const href = await cta.getAttribute('href');
		expect(href).toMatch(/\/meditations\/book-01\/1/);
	});

	test('no gift banner when gift params absent', async ({ page }) => {
		await page.goto('/meditations');
		await expect(page.locator('.gift-banner')).toHaveCount(0);
	});
});
