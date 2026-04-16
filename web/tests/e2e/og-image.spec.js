import { test, expect } from '@playwright/test';

test.describe('OG image endpoint', () => {
	const shortCard = 'enchiridion-33-003';
	const longCard = 'enchiridion-32-001';

	for (const cardId of [shortCard, longCard]) {
		test(`returns a valid PNG for ${cardId}`, async ({ request }) => {
			const res = await request.get(`/api/og/${cardId}`);
			expect(res.status()).toBe(200);
			expect(res.headers()['content-type']).toContain('image/png');

			const body = await res.body();
			expect(body.length).toBeGreaterThan(1024);
		});

		test(`sets immutable cache headers for ${cardId}`, async ({ request }) => {
			const res = await request.get(`/api/og/${cardId}`);
			const cacheControl = res.headers()['cache-control'];
			expect(cacheControl).toContain('public');
			expect(cacheControl).toContain('immutable');
		});
	}

	test('returns 404 for unknown card', async ({ request }) => {
		const res = await request.get('/api/og/nonexistent-card');
		expect(res.status()).toBe(404);
	});

	test('returns a valid PNG for completion OG image', async ({ request }) => {
		const res = await request.get('/api/og/completed-enchiridion');
		expect(res.status()).toBe(200);
		expect(res.headers()['content-type']).toContain('image/png');

		const body = await res.body();
		expect(body.length).toBeGreaterThan(1024);
	});
});
