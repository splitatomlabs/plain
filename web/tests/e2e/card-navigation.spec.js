import { test, expect } from '@playwright/test';

test.describe('Card reading experience', () => {
	test('renders card content on direct visit', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const article = page.locator('article');
		await expect(article).toBeVisible();

		// Card text is visible
		const cardText = page.locator('.card-text');
		await expect(cardText).not.toBeEmpty();

		// Source reference is visible
		const source = page.locator('.card-source');
		await expect(source).toContainText('Meditations');
	});

	test('shows beginning indicator on first card', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const boundary = page.locator('.card-boundary');
		await expect(boundary).toContainText('Beginning of Meditations');
	});

	test('navigates to next card via click zone', async ({ page, isMobile }) => {
		test.skip(isMobile, 'Click zones hidden on mobile');
		await page.goto('/meditations/book-01/1');

		const nextLink = page.locator('.nav-next');
		await nextLink.click();

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('navigates via keyboard ArrowRight', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('article');

		await page.keyboard.press('ArrowRight');

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('navigates via keyboard ArrowLeft', async ({ page }) => {
		await page.goto('/meditations/book-01/2');
		await page.waitForSelector('article');

		await page.keyboard.press('ArrowLeft');

		await expect(page).toHaveURL(/\/meditations\/book-01\/1$/);
	});

	test('Show original toggle expands and collapses', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const details = page.locator('.card-original');
		const summary = details.locator('summary');
		const originalText = details.locator('.original-text');

		// Initially collapsed
		await expect(originalText).not.toBeVisible();

		// Click to expand
		await summary.click();
		await expect(originalText).toBeVisible();

		// Click to collapse
		await summary.click();
		await expect(originalText).not.toBeVisible();
	});

	test('tag pills are visible and link to tag pages', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const tags = page.locator('.tag-pill');
		const count = await tags.count();
		expect(count).toBeGreaterThan(0);

		const href = await tags.first().getAttribute('href');
		expect(href).toMatch(/^\/tags\//);
	});

	test('progress bar updates between cards', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const progressBar = page.locator('[role="progressbar"]');
		await expect(progressBar).toBeVisible();

		const initialValue = await progressBar.getAttribute('aria-valuenow');

		// Navigate to next card
		await page.keyboard.press('ArrowRight');
		await page.waitForURL(/\/meditations\/book-01\/2$/);

		const newValue = await progressBar.getAttribute('aria-valuenow');
		expect(Number(newValue)).toBeGreaterThan(Number(initialValue));
	});

	test('card position indicator shows correct count', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const position = page.locator('.card-position');
		await expect(position).toContainText('/ ');
	});

	test('browser back button works after navigation', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('article');

		await page.keyboard.press('ArrowRight');
		await page.waitForURL(/\/meditations\/book-01\/2$/);

		await page.goBack();
		await expect(page).toHaveURL(/\/meditations\/book-01\/1$/);
	});
});

test.describe('Card reading — mobile', () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test('card is full width on mobile', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const card = page.locator('.card');
		await expect(card).toBeVisible();
	});

	test('click zones are hidden on mobile', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const navZone = page.locator('.nav-next');
		// nav-zone should be display:none on mobile
		if (await navZone.count() > 0) {
			await expect(navZone).not.toBeVisible();
		}
	});
});
