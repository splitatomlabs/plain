import { test, expect } from '@playwright/test';

test.describe('Tag detail page — card stack', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/tags/calm-your-mind');
		await page.evaluate(() => localStorage.clear());
		await page.goto('/tags/calm-your-mind');
	});

	test('renders card stack with current card visible', async ({ page }) => {
		const front = page.locator('.card-swipe-current .card-front');
		await expect(front).toBeVisible();
	});

	test('shows tag name and position in header', async ({ page }) => {
		await expect(page.locator('h1')).toContainText('Calm Your Mind');
		await expect(page.locator('.tag-progress-count')).toContainText('1 /');
	});

	test('shows muted next card underneath', async ({ page }) => {
		const muted = page.locator('.card-muted');
		await expect(muted).toBeVisible();
	});

	test('author interleaving — current and next cards have different authors', async ({ page }) => {
		// The muted next card underneath should show a different author (interleaving)
		const currentAuthor = await page.locator('.card-swipe-current .card-front .card-author').textContent();
		const nextAuthor = await page.locator('.card-swipe-next .card-front .card-author').textContent();
		expect(currentAuthor).not.toBe(nextAuthor);
	});

	test('source reference is a link to book page', async ({ page }) => {
		const sourceLink = page.locator('.card-swipe-current .card-source-link');
		await expect(sourceLink).toBeVisible();
		const href = await sourceLink.getAttribute('href');
		expect(href).toMatch(/^\//);
		expect(href).not.toContain('/tags/');
	});

	test('Next and Previous buttons are present', async ({ page }) => {
		// At card 0, only Next should be visible (no Previous)
		await expect(page.locator('.nav-btn', { hasText: 'Next' })).toBeVisible();
		const prevButtons = page.locator('.nav-btn', { hasText: 'Previous' });
		await expect(prevButtons).toHaveCount(0);
	});
});

test.describe('Tag index page — progress badges', () => {
	test('shows tag cards with counts', async ({ page }) => {
		await page.goto('/tags');
		const tagCards = page.locator('.tag-card');
		const count = await tagCards.count();
		expect(count).toBe(8);
	});

	test('shows progress badge when localStorage has data', async ({ page }) => {
		await page.goto('/tags');
		await page.evaluate(() => {
			localStorage.setItem(
				'plain-tag-progress',
				JSON.stringify({ 'calm-your-mind': { cards_read: ['a', 'b', 'c'] } })
			);
		});
		await page.goto('/tags');

		const badge = page.locator('.tag-read-badge');
		await expect(badge.first()).toContainText('3 read');
	});
});

test.describe('Home page — themes section', () => {
	test('has browse by theme section with anchor', async ({ page }) => {
		await page.goto('/');
		const section = page.locator('#themes');
		await expect(section).toBeVisible();
		await expect(section.locator('.themes-heading')).toContainText('Browse by theme');
	});

	test('has theme CTA link in hero', async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
		await page.goto('/');

		const cta = page.locator('.theme-cta');
		await expect(cta).toBeVisible();
		await expect(cta).toContainText('explore by theme');
		const href = await cta.getAttribute('href');
		expect(href).toBe('#themes');
	});

	test('theme section contains 8 tag pills', async ({ page }) => {
		await page.goto('/');
		const pills = page.locator('#themes .tag-pill');
		await expect(pills).toHaveCount(8);
	});
});
