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

	test('navigates to next card via button', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const nextBtn = page.locator('.nav-btn', { hasText: 'Next' });
		await nextBtn.click();

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

	test('nav buttons visible on mobile', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const nextBtn = page.locator('.nav-btn', { hasText: 'Next' });
		await expect(nextBtn).toBeVisible();
	});

	test('swipe left navigates to next card', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('article');

		// Simulate swipe left (finger moves from right to left)
		const box = await page.locator('.card-nav').boundingBox();
		const startX = box.x + box.width * 0.8;
		const endX = box.x + box.width * 0.2;
		const y = box.y + box.height / 2;

		await page.evaluate(
			({ sx, ex, cy }) => {
				const el = document.querySelector('.card-nav');
				el.dispatchEvent(new TouchEvent('touchstart', {
					bubbles: true,
					touches: [new Touch({ identifier: 0, target: el, clientX: sx, clientY: cy })]
				}));
				el.dispatchEvent(new TouchEvent('touchend', {
					bubbles: true,
					changedTouches: [new Touch({ identifier: 0, target: el, clientX: ex, clientY: cy })]
				}));
			},
			{ sx: startX, ex: endX, cy: y }
		);

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('swipe right navigates to previous card', async ({ page }) => {
		await page.goto('/meditations/book-01/2');
		await page.waitForSelector('article');

		const box = await page.locator('.card-nav').boundingBox();
		const startX = box.x + box.width * 0.2;
		const endX = box.x + box.width * 0.8;
		const y = box.y + box.height / 2;

		await page.evaluate(
			({ sx, ex, cy }) => {
				const el = document.querySelector('.card-nav');
				el.dispatchEvent(new TouchEvent('touchstart', {
					bubbles: true,
					touches: [new Touch({ identifier: 0, target: el, clientX: sx, clientY: cy })]
				}));
				el.dispatchEvent(new TouchEvent('touchend', {
					bubbles: true,
					changedTouches: [new Touch({ identifier: 0, target: el, clientX: ex, clientY: cy })]
				}));
			},
			{ sx: startX, ex: endX, cy: y }
		);

		await expect(page).toHaveURL(/\/meditations\/book-01\/1$/);
	});
});
