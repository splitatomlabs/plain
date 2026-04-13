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
