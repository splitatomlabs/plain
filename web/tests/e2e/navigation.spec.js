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

test.describe('Home page stale state on client-side re-entry', () => {
	// Seed localStorage and cookie so the home page renders the returning-reader branch.
	// These tests reproduce symptom 2: the $effect in +page.svelte has no reactive dependency
	// on page.url.pathname, so navigating away and back via client-side nav leaves the page
	// showing stale (or missing) state and potentially non-interactive.

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
		// Also set the cookie so the server-side load sees hasProgress=true
		await page.context().addCookies([
			{ name: 'plain_has_progress', value: '1', domain: 'localhost', path: '/' }
		]);
	}

	test('home page is interactive after browser back navigation from /enchiridion', async ({ page }) => {
		await seedProgress(page);

		// Start on home (returns returning-reader branch with progress seeded)
		await page.goto('/');
		await expect(page.locator('main#main-content')).toBeVisible();

		// Navigate to /enchiridion via client-side link (not full reload)
		await page.locator('main#main-content').getByRole('link', { name: /Enchiridion/i }).first().click();
		await expect(page).toHaveURL(/\/enchiridion/);

		// Go back via browser history — this is the client-side re-entry path
		await page.goBack();
		await expect(page).toHaveURL(/\/$/);

		// main must not be inert
		const mainInert = await page.evaluate(() =>
			document.querySelector('main#main-content')?.hasAttribute('inert') ?? false
		);
		expect(mainInert).toBe(false);

		// A clickable element inside main must respond (returning-hero has an anchor/link)
		const mainLink = page.locator('main#main-content a').first();
		await expect(mainLink).toBeVisible();
		await expect(mainLink).toBeEnabled();
		// Clicking must not throw (inert elements silently swallow events)
		await mainLink.click({ timeout: 3000 });

		// The returning-hero section (author rings) must be present — stale state would hide it
		await expect(page.locator('.author-rings')).toBeVisible();
	});

	test('home page is interactive after navigating back via the menu Home link', async ({ page }) => {
		await seedProgress(page);

		// Start on /enchiridion
		await page.goto('/enchiridion');
		await expect(page.locator('main#main-content')).toBeVisible();

		// Open the menu and click Home — client-side nav to /
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();
		await page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Home' }).click();
		await expect(page).toHaveURL(/\/$/);

		// main must not be inert
		const mainInert = await page.evaluate(() =>
			document.querySelector('main#main-content')?.hasAttribute('inert') ?? false
		);
		expect(mainInert).toBe(false);

		// The returning-hero section (author rings) must be visible
		await expect(page.locator('.author-rings')).toBeVisible();

		// A link inside main must be clickable
		const mainLink = page.locator('main#main-content a').first();
		await expect(mainLink).toBeVisible();
		await mainLink.click({ timeout: 3000 });
	});
});

test.describe('Main menu self-healing', () => {
	test('clicking current-page Home link closes drawer and restores interactivity', async ({ page }) => {
		await page.goto('/');

		// Open the main menu
		await page.getByRole('button', { name: 'Open menu' }).click();
		await expect(page.getByRole('dialog', { name: 'Main menu' })).toBeVisible();

		// Click the Home link while already on /
		await page.getByRole('dialog', { name: 'Main menu' }).getByRole('link', { name: 'Home' }).click();

		// Drawer must be gone
		await expect(page.getByRole('dialog', { name: 'Main menu' })).not.toBeVisible();

		// body must have no inline overflow style
		const bodyOverflow = await page.evaluate(() => document.body.style.overflow);
		expect(bodyOverflow).toBe('');

		// main#main-content must not be inert
		const mainInert = await page.evaluate(() =>
			document.querySelector('main#main-content')?.hasAttribute('inert') ?? false
		);
		expect(mainInert).toBe(false);

		// An interactive element inside <main> must be clickable (respond to click without error)
		const mainInteractive = page.locator('main#main-content a, main#main-content button').first();
		await expect(mainInteractive).toBeVisible();
		await mainInteractive.click({ timeout: 3000 });
	});
});
