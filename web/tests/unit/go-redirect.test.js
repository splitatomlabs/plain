import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from '../../src/routes/go/[slug]/+server.js';

// Exercises the URL-building and click-logging logic directly, since
// `redirect()`/`error()` from @sveltejs/kit throw rather than return —
// a plain unit test is a faster, more precise fit for this than spinning
// up a real request for every case. The e2e suite (og-redirect.spec.js)
// covers the same slugs over real HTTP to prove the thrown redirect
// actually reaches the client as a 302 with this exact Location.

function callGet(slug, searchParams = '') {
	const url = new URL(`https://thinkplain.ai/go/${slug}${searchParams}`);
	return GET({ params: { slug }, url });
}

describe('GET /go/[slug]', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each([
		['ig', 'instagram'],
		['tt', 'tiktok'],
		['yt', 'youtube']
	])('redirects %s to thinkplain.ai with utm_source=%s', (slug, platform) => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		let thrown;
		try {
			callGet(slug);
		} catch (e) {
			thrown = e;
		}

		expect(thrown).toBeDefined();
		expect(thrown.status).toBe(302);
		const location = new URL(thrown.location);
		expect(location.origin + location.pathname).toBe('https://thinkplain.ai/');
		expect(location.searchParams.get('utm_source')).toBe(platform);
		expect(location.searchParams.get('utm_medium')).toBe('organic-social');
		expect(location.searchParams.get('utm_campaign')).toBe('stoic-pilot');
		expect(location.searchParams.get('utm_content')).toBe('wall');
	});

	it('defaults utm_content to wall when ?f= is absent', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		let thrown;
		try {
			callGet('ig');
		} catch (e) {
			thrown = e;
		}
		expect(new URL(thrown.location).searchParams.get('utm_content')).toBe('wall');
	});

	it('rejects an unknown ?f= value rather than reflecting it', () => {
		vi.spyOn(console, 'log').mockImplementation(() => {});
		let thrown;
		try {
			callGet('ig', '?f=<script>alert(1)</script>');
		} catch (e) {
			thrown = e;
		}
		expect(new URL(thrown.location).searchParams.get('utm_content')).toBe('wall');
	});

	it('never redirects an unknown slug — 404 instead', () => {
		let thrown;
		try {
			callGet('bogus');
		} catch (e) {
			thrown = e;
		}
		expect(thrown).toBeDefined();
		expect(thrown.status).toBe(404);
	});

	it('logs a structured click with platform, format, and a timestamp', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			callGet('tt');
		} catch {
			// redirect() throws by design; the click log must happen before it does.
		}

		expect(logSpy).toHaveBeenCalledTimes(1);
		const logged = JSON.parse(logSpy.mock.calls[0][0]);
		expect(logged).toMatchObject({ event: 'attribution_click', platform: 'tiktok', format: 'wall' });
		expect(new Date(logged.at).toISOString()).toBe(logged.at);
	});

	it('never logs anything identifying a viewer', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			callGet('yt');
		} catch {
			// expected throw from redirect()
		}
		const logged = JSON.parse(logSpy.mock.calls[0][0]);
		const keys = Object.keys(logged).sort();
		expect(keys).toEqual(['at', 'event', 'format', 'platform']);
	});

	it('does not log a click for an unknown slug', () => {
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
		try {
			callGet('bogus');
		} catch {
			// expected 404 throw
		}
		expect(logSpy).not.toHaveBeenCalled();
	});
});
