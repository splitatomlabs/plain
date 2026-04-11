import { test, expect } from '@playwright/test';

test.describe('Card stack and swipe', () => {
	test('card renders with front face visible', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const front = page.locator('.card-front');
		await expect(front).toBeVisible();
	});

	test('next card visible below as muted', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const muted = page.locator('.card-muted');
		await expect(muted).toBeVisible();
	});

	test('pointer drag past threshold navigates to next URL', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('.card-swipe');

		const box = await page.locator('.card-swipe').boundingBox();
		const startX = box.x + box.width / 2;
		const startY = box.y + box.height / 2;

		// Drag far enough to trigger dismiss (>30% viewport width)
		const dragDistance = box.width * 0.5;

		await page.mouse.move(startX, startY);
		await page.mouse.down();
		// Move in steps to build velocity
		for (let i = 1; i <= 5; i++) {
			await page.mouse.move(startX - (dragDistance * i) / 5, startY, { steps: 1 });
		}
		await page.mouse.up();

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('flip button toggles card and shows original text', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const flipBtn = page.locator('button', { hasText: 'Show original' });
		await expect(flipBtn).toBeVisible();

		await flipBtn.click();

		const backFace = page.locator('.card-back');
		await expect(backFace).toBeVisible();

		// Original text should be visible on back
		const originalText = page.locator('.card-back .original-text');
		await expect(originalText).toBeVisible();

		// Flip back
		const flipBackBtn = page.locator('button', { hasText: 'Show translation' });
		await flipBackBtn.click();

		const frontFace = page.locator('.card-front');
		await expect(frontFace).toBeVisible();
	});

	test('nav buttons work', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const nextBtn = page.locator('.nav-btn', { hasText: 'Next' });
		await nextBtn.click();

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});

	test('keyboard ArrowRight navigates forward', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

		await page.keyboard.press('ArrowRight');

		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);
	});
});

test.describe('Chapter markers and progress', () => {
	test('chapter marker visible at chapter boundary on Meditations', async ({ page }) => {
		// Book 2 first card should show chapter marker
		await page.goto('/meditations/book-02/1');

		const marker = page.locator('.chapter-marker');
		await expect(marker).toBeVisible();
		await expect(marker).toContainText('Book 2');
	});

	test('reading time hint visible on card', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const readingTime = page.locator('.reading-time');
		await expect(readingTime).toBeVisible();
		await expect(readingTime).toContainText('read');
	});

	test('segmented progress bar on Meditations', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const progressBar = page.locator('[role="progressbar"]');
		await expect(progressBar).toBeVisible();

		// Should have tick marks for chapter boundaries
		const ticks = page.locator('.progress-tick');
		const tickCount = await ticks.count();
		expect(tickCount).toBeGreaterThan(0);
	});

	test('simple progress bar on Enchiridion', async ({ page }) => {
		await page.goto('/enchiridion/section-01/1');

		const progressBar = page.locator('[role="progressbar"]');
		await expect(progressBar).toBeVisible();

		// Should NOT have tick marks
		const ticks = page.locator('.progress-tick');
		await expect(ticks).toHaveCount(0);
	});
});
