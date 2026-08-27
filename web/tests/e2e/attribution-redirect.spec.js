import { test, expect } from '@playwright/test';

// `/go/<slug>` is the attribution redirect (Pf39c2-social-pilot-03 T11):
// a click on an in-bio/caption link should 302 straight through to
// thinkplain.ai with UTM params, never get cached as a permanent redirect,
// and always be logged server-side.
//
// "a click was recorded" (the acceptance criterion's other half) is asserted
// in the unit suite instead of here: tests/unit/go-redirect.test.js spies on
// console.log directly. This spec's `webServer` (npm run build && npm run
// preview, per playwright.config.js) runs as a detached child process with
// no config wiring its stdout back to an individual test, so there is no
// reliable way from this file to observe the click-log line over a real HTTP
// round trip — asserting it here would mean either not asserting anything or
// pretending to. The unit test asserts the exact thing this route logs; this
// spec asserts the exact thing a client actually receives.
//
// Playwright's request fixture follows redirects by default, so every
// request below passes `maxRedirects: 0` to actually observe the 302 instead
// of the page it points to.

test.describe('Attribution redirect /go/[slug]', () => {
	const cases = [
		['ig', 'instagram'],
		['tt', 'tiktok'],
		['yt', 'youtube']
	];

	for (const [slug, platform] of cases) {
		test(`/go/${slug} responds 302 to thinkplain.ai with utm_source=${platform}`, async ({
			request
		}) => {
			const res = await request.get(`/go/${slug}`, { maxRedirects: 0 });

			expect(res.status()).toBe(302);

			const location = new URL(res.headers()['location']);
			expect(location.origin + location.pathname).toBe('https://thinkplain.ai/');
			expect(location.searchParams.get('utm_source')).toBe(platform);
			expect(location.searchParams.get('utm_medium')).toBe('organic-social');
			expect(location.searchParams.get('utm_campaign')).toBe('stoic-pilot');
			expect(location.searchParams.get('utm_content')).toBe('wall');
		});
	}

	test('an unknown slug 404s rather than redirecting with a bogus utm_source', async ({
		request
	}) => {
		const res = await request.get('/go/bogus', { maxRedirects: 0 });
		expect(res.status()).toBe(404);
		expect(res.headers()['location']).toBeUndefined();
	});
});
