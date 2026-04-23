import { test, expect } from '@playwright/test';

test.describe('Card reading experience', () => {
	test('renders card content on direct visit', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const article = page.locator('article:not([inert])');
		await expect(article).toBeVisible();

		// Card text is visible
		const cardText = page.locator('.card-swipe-current .card-front .card-text');
		await expect(cardText).not.toBeEmpty();

		// Source reference is visible
		const source = page.locator('.card-swipe-current .card-front .card-source');
		await expect(source).toContainText('Meditations');
	});

	test('shows beginning indicator on first card', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const boundary = page.locator('.card-boundary');
		await expect(boundary).toContainText('Beginning of Meditations');
	});

	test('navigates to next card via button', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const nextBtn = page.locator('.nav-btn', { hasText: 'Next' });
		await nextBtn.click();

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('navigates via keyboard ArrowRight', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

		await page.keyboard.press('ArrowRight');

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('navigates via keyboard ArrowLeft', async ({ page }) => {
		await page.goto('/meditations/book-01/2');
		await page.waitForSelector('[data-keyboard-ready]');

		await page.keyboard.press('ArrowLeft');

		await expect(page).toHaveURL(/\/meditations\/book-01\/1$/);
	});

	test('Show original flip toggles card faces', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

		const flipBtn = page.locator('.card-swipe-current .card-front .flip-btn');
		await expect(flipBtn).toBeVisible();

		// Click to flip to back
		await flipBtn.dispatchEvent('click');

		const inner = page.locator('.card-swipe-current .card-inner.flipped');
		await expect(inner).toHaveCount(1);

		// Click to flip back to front
		const flipBackBtn = page.locator('.card-swipe-current .card-back .flip-btn');
		await flipBackBtn.dispatchEvent('click');

		const unflipped = page.locator('.card-swipe-current .card-inner:not(.flipped)');
		await expect(unflipped).toHaveCount(1);
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
		await page.waitForSelector('[data-keyboard-ready]');

		const progressBar = page.locator('[role="progressbar"]');
		await expect(progressBar).toBeVisible();

		const initialText = await progressBar.getAttribute('aria-valuetext');

		// Navigate to next card
		await page.keyboard.press('ArrowRight');
		await page.waitForURL(/\/meditations\/book-01\/2$/);

		const newText = await progressBar.getAttribute('aria-valuetext');
		expect(newText).not.toBe(initialText);
	});

	test('card position indicator shows correct count', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const position = page.locator('.card-swipe-current .card-front .card-position');
		await expect(position).toContainText(' of ');
	});

	test('browser back button works after navigation', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

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

		const card = page.locator('.card-swipe-current .card-front');
		await expect(card).toBeVisible();
	});

	test('nav buttons visible on mobile', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const nextBtn = page.locator('.nav-btn', { hasText: 'Next' });
		await expect(nextBtn).toBeVisible();
	});
});
