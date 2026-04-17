import { test, expect } from '@playwright/test';

// Smoke test: verifies analytics events fire through the real app wiring.
// The built app runs with dev=false, so trackEvent() is active.
// window.umami is stubbed before any app code runs via addInitScript.

test.describe('Analytics event wiring', () => {
	test.beforeEach(async ({ page }) => {
		// Install the stub before the page loads so app code finds window.umami.
		// Persist captured calls in sessionStorage so they survive navigations.
		await page.addInitScript(() => {
			window.umami = {
				track: (name, data) => {
					const stored = JSON.parse(sessionStorage.getItem('__umamiCalls') || '[]');
					stored.push([name, data]);
					sessionStorage.setItem('__umamiCalls', JSON.stringify(stored));
				}
			};
		});

		// Clear storage so each test starts from a clean state.
		await page.goto('/');
		await page.evaluate(() => {
			localStorage.clear();
			sessionStorage.clear();
		});
	});

	test('book_landing_viewed fires on book landing visit', async ({ page }) => {
		await page.goto('/enchiridion');

		await expect
			.poll(async () =>
				page.evaluate(() => {
					const calls = JSON.parse(sessionStorage.getItem('__umamiCalls') || '[]');
					return calls.some((c) => c[0] === 'book_landing_viewed');
				})
			)
			.toBe(true);

		const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__umamiCalls') || '[]'));
		const landingCall = calls.find((c) => c[0] === 'book_landing_viewed');
		expect(landingCall[1]).toMatchObject({ book_id: 'enchiridion' });
	});

	test('book_started and first_engagement fire after reading 2 cards', async ({ page }) => {
		// Visit the landing first (matches real user flow).
		await page.goto('/enchiridion');

		// Wait for the landing-viewed event to be captured before navigating away,
		// otherwise the next goto can abort onMount on slower runs (e.g. mobile chrome).
		await expect
			.poll(async () =>
				page.evaluate(() => {
					const calls = JSON.parse(sessionStorage.getItem('__umamiCalls') || '[]');
					return calls.some((c) => c[0] === 'book_landing_viewed');
				})
			)
			.toBe(true);

		// Navigate to card 1 of the first chapter.
		await page.goto('/enchiridion/section-01/1');
		await page.waitForSelector('[data-keyboard-ready]');

		// Advance to card 2 — this marks card 1 as read and should fire book_started.
		await page.click('a[aria-label="Next card"]');
		await page.waitForURL(/\/enchiridion\/section-01\/2/);
		await page.waitForSelector('[data-keyboard-ready]');

		// Advance to card 3 — this marks card 2 as read and should fire first_engagement
		// (session_card_count hits 2 on a first session).
		await page.click('a[aria-label="Next card"]');
		await page.waitForURL(/\/enchiridion\/section-01\/[34]|\/(section-02)\/1/);

		const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem('__umamiCalls') || '[]'));
		const eventNames = calls.map((c) => c[0]);

		// book_landing_viewed from the landing visit.
		expect(eventNames).toContain('book_landing_viewed');

		// book_started fired when first card was marked read.
		expect(eventNames).toContain('book_started');

		const startedCall = calls.find((c) => c[0] === 'book_started');
		expect(startedCall[1]).toMatchObject({ book_id: 'enchiridion' });
		// is_first_book should be a boolean (true since localStorage was cleared).
		expect(typeof startedCall[1].is_first_book).toBe('boolean');

		// first_engagement fired when session card count reached 2.
		expect(eventNames).toContain('first_engagement');
	});
});
