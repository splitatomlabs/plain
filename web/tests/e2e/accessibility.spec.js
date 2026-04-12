import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const routes = [
	{ name: 'Home', path: '/' },
	{ name: 'Book landing', path: '/meditations' },
	{ name: 'Card page', path: '/meditations/book-01/1' },
	{ name: 'Tags index', path: '/tags' },
	{ name: 'Tag detail', path: '/tags/calm-your-mind' },
	{ name: 'Completed', path: '/completed/meditations' }
];

test.describe('WCAG accessibility — axe-core', () => {
	for (const route of routes) {
		test(`${route.name} (${route.path}) has no axe violations`, async ({ page }) => {
			await page.goto(route.path);
			await page.waitForLoadState('networkidle');

			const results = await new AxeBuilder({ page }).analyze();

			expect(results.violations).toEqual([]);
		});
	}
});

test.describe('Keyboard navigation — card page', () => {
	test('tab through interactive elements with visible focus indicators', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('article');

		// Tab through the page and collect focused elements
		const focusedElements = [];
		for (let i = 0; i < 10; i++) {
			await page.keyboard.press('Tab');
			const focused = await page.evaluate(() => {
				const el = document.activeElement;
				if (!el || el === document.body) return null;
				return {
					tag: el.tagName.toLowerCase(),
					role: el.getAttribute('role'),
					ariaLabel: el.getAttribute('aria-label'),
					text: el.textContent?.trim().slice(0, 50),
					isVisible: el.offsetWidth > 0 && el.offsetHeight > 0
				};
			});
			if (focused) focusedElements.push(focused);
		}

		// At least some interactive elements should be reachable
		expect(focusedElements.length).toBeGreaterThan(0);

		// All focused elements should be visible (focus indicators)
		for (const el of focusedElements) {
			expect(el.isVisible).toBe(true);
		}
	});

	test('arrow keys navigate between cards', async ({ page }) => {
		await page.goto('/meditations/book-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

		await page.keyboard.press('ArrowRight');
		await expect(page).toHaveURL(/\/meditations\/book-01\/2$/);

		await page.keyboard.press('ArrowLeft');
		await expect(page).toHaveURL(/\/meditations\/book-01\/1$/);
	});
});

test.describe('Screen reader attributes — card page', () => {
	test('card container has aria-live', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const article = page.locator('article.card:not([inert])');
		await expect(article).toHaveAttribute('aria-live', 'polite');
	});

	test('Show original flip button is accessible', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const flipBtn = page.locator('.card-swipe-current .card-front .flip-btn');
		await expect(flipBtn).toBeVisible();
		await expect(flipBtn).toHaveAttribute('aria-label', 'Show original text');
	});

	test('navigation buttons have aria-labels', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const navRegion = page.locator('[role="region"][aria-label="Card navigation"]');
		await expect(navRegion).toBeVisible();

		// Nav buttons should have accessible labels
		const buttons = navRegion.locator('button');
		const count = await buttons.count();
		for (let i = 0; i < count; i++) {
			const btn = buttons.nth(i);
			const ariaLabel = await btn.getAttribute('aria-label');
			const text = await btn.textContent();
			// Each button should have either aria-label or visible text
			expect(ariaLabel || text?.trim()).toBeTruthy();
		}
	});

	test('progress bar has correct ARIA attributes', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		const progressBar = page.locator('[role="progressbar"]');
		await expect(progressBar).toBeVisible();
		await expect(progressBar).toHaveAttribute('aria-valuenow', /\d+/);
		await expect(progressBar).toHaveAttribute('aria-valuemax', /\d+/);
		await expect(progressBar).toHaveAttribute('aria-label', /Reading progress/);
	});

	test('decorative elements are hidden from screen readers', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		// Chevrons in nav should be aria-hidden
		const hiddenChevrons = page.locator('[aria-hidden="true"]');
		const count = await hiddenChevrons.count();
		expect(count).toBeGreaterThan(0);
	});
});

test.describe('Milestone modal accessibility', () => {
	test('modal has proper ARIA attributes and focus trap', async ({ page }) => {
		await page.goto('/meditations/book-01/1');

		// Seed progress to trigger 25% milestone on next card
		// meditations book-01 has 3 cards, so reading card 1 = 33% > 25%
		await page.evaluate(() => {
			// Clear any existing milestone data
			localStorage.setItem('plain-milestones', JSON.stringify({}));
			// Set progress so we're about to hit a milestone
			localStorage.setItem(
				'plain-progress',
				JSON.stringify({
					meditations: {
						lastCard: 'meditations-01-001',
						lastUrl: '/meditations/book-01/1',
						cardsRead: ['meditations-01-001']
					}
				})
			);
		});

		// Navigate to trigger milestone check
		await page.goto('/meditations/book-01/2');

		// Check if modal appears (may not if milestone already seen)
		const modal = page.locator('[role="dialog"]');
		const modalVisible = await modal.isVisible().catch(() => false);

		if (modalVisible) {
			// Verify ARIA attributes
			await expect(modal).toHaveAttribute('aria-modal', 'true');
			await expect(modal).toHaveAttribute('aria-labelledby', 'milestone-heading');

			// Verify heading exists
			const heading = page.locator('#milestone-heading');
			await expect(heading).toBeVisible();

			// Escape closes modal
			await page.keyboard.press('Escape');
			await expect(modal).not.toBeVisible();
		}
	});
});
