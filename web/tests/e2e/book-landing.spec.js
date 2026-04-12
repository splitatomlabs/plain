import { test, expect } from '@playwright/test';

test.describe('Book landing page — essay-style (Shortness of Life)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/shortness-of-life');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test('shows scope line with card count and reading time', async ({ page }) => {
		const scope = page.locator('.book-scope');
		await expect(scope).toBeVisible();
		await expect(scope).toContainText('cards');
		await expect(scope).toContainText('min read');
	});

	test('has no chapter list', async ({ page }) => {
		await expect(page.locator('.chapter-list')).not.toBeVisible();
	});

	test('shows preview card', async ({ page }) => {
		const preview = page.locator('.book-preview');
		await expect(preview).toBeVisible();
		await expect(preview.locator('.preview-text')).not.toBeEmpty();
	});

	test('CTA appears before preview card', async ({ page }) => {
		const ctaBox = await page.locator('.cta-row').first().boundingBox();
		const previewBox = await page.locator('.book-preview').boundingBox();
		expect(ctaBox.y).toBeLessThan(previewBox.y);
	});
});

test.describe('Book landing page — chapter-style (Meditations)', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/meditations');
		await page.evaluate(() => localStorage.clear());
		await page.reload();
	});

	test('shows scope line', async ({ page }) => {
		const scope = page.locator('.book-scope');
		await expect(scope).toBeVisible();
		await expect(scope).toContainText('cards');
		await expect(scope).toContainText('min read');
	});

	test('has chapter list with progress indicators', async ({ page }) => {
		const chapters = page.locator('.chapter-list .chapter-item');
		await expect(chapters).toHaveCount(12);
	});

	test('CTA appears before chapter list', async ({ page }) => {
		const ctaBox = await page.locator('.cta-row').first().boundingBox();
		const chapterBox = await page.locator('.chapter-list').boundingBox();
		expect(ctaBox.y).toBeLessThan(chapterBox.y);
	});

	test('chapter rows are not clickable links', async ({ page }) => {
		const firstChapter = page.locator('.chapter-item').first();
		const tag = await firstChapter.evaluate((el) => el.tagName.toLowerCase());
		expect(tag).toBe('li');
		const links = await firstChapter.locator('a').count();
		expect(links).toBe(0);
	});
});

test.describe('Book landing page — returning reader', () => {
	test('essay book shows Continue with progress', async ({ page }) => {
		await page.goto('/shortness-of-life');
		await page.evaluate(() => {
			localStorage.setItem('plain-progress', JSON.stringify({
				'shortness-of-life': {
					cards_read: ['shortness-of-life-01-001', 'shortness-of-life-02-001'],
					last_card: 'shortness-of-life-02-001',
					last_read_at: new Date().toISOString(),
					resume_url: '/shortness-of-life/section-02/1',
					completed: false,
					completed_at: null
				}
			}));
		});
		await page.reload();

		await expect(page.locator('.cta-primary')).toContainText('Continue');
		await expect(page.locator('.book-landing-progress')).toBeVisible();
	});

	test('chapter book shows per-chapter progress', async ({ page }) => {
		await page.goto('/meditations');
		await page.evaluate(() => {
			const cards = Array.from({ length: 26 }, (_, i) =>
				`meditations-01-${String(i + 1).padStart(3, '0')}`
			);
			localStorage.setItem('plain-progress', JSON.stringify({
				meditations: {
					cards_read: cards,
					last_card: cards[cards.length - 1],
					last_read_at: new Date().toISOString(),
					resume_url: '/meditations/book-02/1',
					completed: false,
					completed_at: null
				}
			}));
		});
		await page.reload();

		await expect(page.locator('.cta-primary')).toContainText('Continue');
		// Book 1 chapter row should be visible
		const firstChapter = page.locator('.chapter-item').first();
		await expect(firstChapter).toContainText('Book 1');
	});
});
