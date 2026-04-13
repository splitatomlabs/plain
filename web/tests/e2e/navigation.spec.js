import { test, expect } from '@playwright/test';

test.describe('Footer navigation links', () => {
	const paths = ['/', '/enchiridion', '/meditations/book-01/1'];

	for (const path of paths) {
		test(`footer shows About and Support links on ${path}`, async ({ page }) => {
			await page.goto(path);
			const footer = page.locator('.site-footer');
			await expect(footer.getByRole('link', { name: 'About' })).toBeVisible();
			await expect(footer.getByRole('link', { name: 'Support' })).toBeVisible();
		});
	}

	test('footer About link navigates to /about', async ({ page }) => {
		await page.goto('/');
		await page.locator('.site-footer').getByRole('link', { name: 'About' }).click();
		await expect(page).toHaveURL(/\/about$/);
		await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
	});

	test('footer Support link navigates to /support', async ({ page }) => {
		await page.goto('/');
		await page.locator('.site-footer').getByRole('link', { name: 'Support' }).click();
		await expect(page).toHaveURL(/\/support$/);
		await expect(page.getByRole('heading', { name: 'Support', exact: true })).toBeVisible();
	});
});

test.describe('Home page stale state on client-side re-entry', () => {
	async function seedProgress(page) {
		await page.addInitScript(() => {
			const progressData = {
				enchiridion: {
					cards_read: ['enchiridion-01-1'],
					last_card: 'enchiridion-01-1',
					last_read_at: new Date().toISOString(),
					resume_url: '/enchiridion/book-01/1',
					completed: false,
					completed_at: null
				}
			};
			localStorage.setItem('plain-progress', JSON.stringify(progressData));
		});
		await page.context().addCookies([
			{ name: 'plain_has_progress', value: '1', domain: 'localhost', path: '/' }
		]);
	}

	test('home page is interactive after browser back navigation from /enchiridion', async ({ page }) => {
		await seedProgress(page);

		await page.goto('/');
		await expect(page.locator('main#main-content')).toBeVisible();

		await page.locator('main#main-content').getByRole('link', { name: /Enchiridion/i }).first().click();
		await expect(page).toHaveURL(/\/enchiridion/);

		await page.goBack();
		await expect(page).toHaveURL(/\/$/);

		const mainLink = page.locator('main#main-content a').first();
		await expect(mainLink).toBeVisible();
		await mainLink.click({ timeout: 3000 });

		await expect(page.locator('.author-rings')).toBeVisible();
	});
});
