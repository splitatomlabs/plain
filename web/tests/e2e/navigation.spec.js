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

test.describe('Main menu drawer', () => {
	test('hamburger opens drawer showing Home/About/Support', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Open menu' }).click();
		const drawer = page.getByRole('dialog', { name: 'Main menu' });
		await expect(drawer).toBeVisible();
		await expect(drawer.getByRole('link', { name: 'Home' })).toBeVisible();
		await expect(drawer.getByRole('link', { name: 'About' })).toBeVisible();
		await expect(drawer.getByRole('link', { name: 'Support' })).toBeVisible();
	});

	test('Escape closes the drawer', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Main menu' })).not.toBeVisible();
	});

	test('drawer About link navigates to /about', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'About' }).click();
		await expect(page).toHaveURL(/\/about$/);
	});

	test('drawer Support link navigates to /support', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Support' }).click();
		await expect(page).toHaveURL(/\/support$/);
	});

	test('drawer Home link navigates to /', async ({ page }) => {
		await page.goto('/enchiridion');
		await page.getByRole('button', { name: 'Open menu' }).click();
		await page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Home' }).click();
		await expect(page).toHaveURL(/\/$/);
	});
});
