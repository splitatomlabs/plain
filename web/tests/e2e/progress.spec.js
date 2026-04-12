import { test, expect } from '@playwright/test';

test.describe('Progress tracking', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => localStorage.clear());
	});

	test('navigating to next card marks current card as read', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');
		// Click next to navigate to card 2 (marks card 1 as read)
		await page.click('a[aria-label="Next card"]');
		await expect(page).toHaveURL(/\/meditations\/book-01\/2/);

		// Check localStorage
		const progress = await page.evaluate(() => {
			return JSON.parse(localStorage.getItem('plain-progress') || '{}');
		});
		expect(progress.meditations).toBeDefined();
		expect(progress.meditations.cards_read).toContain('meditations-01-001');
		expect(progress.meditations.last_card).toBe('meditations-01-001');
	});

	test('progress persists across page reloads', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');
		await page.click('a[aria-label="Next card"]');
		await page.waitForURL(/\/meditations\/book-01\/2/);
		await page.waitForSelector('[data-keyboard-ready]');

		// Navigate to next card — may trigger 25% milestone modal
		await page.click('a[aria-label="Next card"]');

		// Dismiss milestone modal if it appears (25% threshold at 2/6 cards)
		const modal = page.locator('.modal-button');
		if (await modal.isVisible({ timeout: 500 }).catch(() => false)) {
			await modal.click();
		}
		await page.waitForURL(/\/meditations\/book-01\/3/);

		// Reload and check progress is still there
		await page.reload();
		const progress = await page.evaluate(() => {
			return JSON.parse(localStorage.getItem('plain-progress') || '{}');
		});
		expect(progress.meditations.cards_read).toHaveLength(2);
		expect(progress.meditations.cards_read).toContain('meditations-01-001');
		expect(progress.meditations.cards_read).toContain('meditations-01-002');
	});

	test('returning reader sees Continue Reading banner on home page', async ({ page }) => {
		// Seed progress
		await page.evaluate(() => {
			localStorage.setItem('plain-progress', JSON.stringify({
				meditations: {
					cards_read: ['meditations-01-001', 'meditations-01-002'],
					last_card: 'meditations-01-002',
					last_read_at: new Date().toISOString(),
					resume_url: '/meditations/book-01/3',
					completed: false,
					completed_at: null
				}
			}));
		});

		await page.goto('/');
		await expect(page.locator('.continue-banner')).toBeVisible();
		await expect(page.locator('.continue-book')).toContainText('Meditations');
	});
});
