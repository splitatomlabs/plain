import { test, expect } from '@playwright/test';

test.describe('Home page — new visitor', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.goto('/');
	});

	test('shows hero text', async ({ page }) => {
		await expect(page.locator('h1')).toContainText('Three men');
	});

	test('shows Marcus Aurelius first', async ({ page }) => {
		const sections = page.locator('.author-section');
		await expect(sections).toHaveCount(3);

		const firstAuthorName = sections.first().locator('.author-name');
		await expect(firstAuthorName).toContainText('Marcus Aurelius');
	});

	test('shows all three authors', async ({ page }) => {
		const authorNames = page.locator('.author-name');
		await expect(authorNames).toHaveCount(3);
		await expect(authorNames.nth(0)).toContainText('Marcus Aurelius');
		await expect(authorNames.nth(1)).toContainText('Epictetus');
		await expect(authorNames.nth(2)).toContainText('Seneca');
	});

	test('Start Reading CTA links to book page', async ({ page }) => {
		const firstCta = page.locator('.cta').first();
		await expect(firstCta).toHaveText('Start Reading');
		const href = await firstCta.getAttribute('href');
		expect(href).toMatch(/^\//);
	});
});
