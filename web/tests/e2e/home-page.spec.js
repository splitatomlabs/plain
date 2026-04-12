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

test.describe('Home page — returning reader', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
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
	});

	test('shows progress rings', async ({ page }) => {
		await expect(page.locator('.progress-ring')).toHaveCount(3);
	});

	test('shows Continue Reading banner', async ({ page }) => {
		await expect(page.locator('.continue-banner')).toBeVisible();
		await expect(page.locator('.continue-book')).toContainText('Meditations');
	});

	test('shows authors in Slave, Emperor, Senator order', async ({ page }) => {
		const labels = page.locator('.ring-label');
		await expect(labels).toHaveCount(3);
		await expect(labels.nth(0)).toContainText('The Slave');
		await expect(labels.nth(1)).toContainText('The Emperor');
		await expect(labels.nth(2)).toContainText('The Senator');
	});
});

test.describe('Home page — per-book Continue/Start CTAs', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/');
		await page.evaluate(() => {
			localStorage.setItem('plain-progress', JSON.stringify({
				meditations: {
					cards_read: ['meditations-01-001', 'meditations-01-002'],
					last_card: 'meditations-01-002',
					last_read_at: new Date().toISOString(),
					resume_url: '/meditations/book-01/3',
					completed: false,
					completed_at: null
				},
				enchiridion: {
					cards_read: ['enchiridion-01-001'],
					last_card: 'enchiridion-01-001',
					last_read_at: new Date(Date.now() - 86400000).toISOString(),
					resume_url: '/enchiridion/sections-01-10/2',
					completed: false,
					completed_at: null
				}
			}));
		});
		await page.goto('/');
	});

	test('book with progress shows Continue CTA', async ({ page }) => {
		const meditationsCard = page.locator('.book-card', { has: page.locator('.title-link', { hasText: 'Meditations' }) });
		await expect(meditationsCard.locator('.cta')).toHaveText('Continue');
	});

	test('Continue CTA links to resume URL', async ({ page }) => {
		const meditationsCard = page.locator('.book-card', { has: page.locator('.title-link', { hasText: 'Meditations' }) });
		const href = await meditationsCard.locator('.cta').getAttribute('href');
		expect(href).toBe('/meditations/book-01/3');
	});

	test('book with progress shows progress bar', async ({ page }) => {
		const enchiridionCard = page.locator('.book-card', { has: page.locator('.title-link', { hasText: 'Enchiridion' }) });
		await expect(enchiridionCard.locator('.book-progress')).toBeVisible();
	});

	test('book without progress shows Start Reading', async ({ page }) => {
		const senecaBooks = page.locator('.book-card', { has: page.locator('.cta', { hasText: 'Start Reading' }) });
		const count = await senecaBooks.count();
		expect(count).toBeGreaterThanOrEqual(3);
	});
});
