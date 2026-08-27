/**
 * Tests for `../tiktok-spike.ts`'s pure logic (Pf39c2-social-pilot-03 T13).
 *
 * This spike script is meant to be run BY HAND, once, against a real
 * TikTok account — nothing in this test file makes a real network call or
 * exercises `main()`. It covers only `deriveVerdict` (the decision rule:
 * automate if `video.list` returns per-video view/like/comment/share counts,
 * else the fallback) and `redactToken` (never letting the access token leak
 * into anything printed), both pure functions factored out specifically so
 * they are testable without touching TikTok's API.
 */

import { describe, expect, it } from 'vitest';

import { deriveVerdict, redactToken } from '../tiktok-spike.js';

describe('redactToken', () => {
	it('replaces every occurrence of the token with REDACTED', () => {
		const text = 'Authorization: Bearer secret-token-123, url?access_token=secret-token-123';
		expect(redactToken(text, 'secret-token-123')).toBe('Authorization: Bearer REDACTED, url?access_token=REDACTED');
	});

	it('returns the text unchanged when the token is empty', () => {
		expect(redactToken('nothing to redact here', '')).toBe('nothing to redact here');
	});

	it('leaves text with no token occurrence unchanged', () => {
		expect(redactToken('no secrets here', 'secret-token-123')).toBe('no secrets here');
	});
});

describe('deriveVerdict', () => {
	it('reports the automated path viable when every video carries all four counts as numbers', () => {
		const body = {
			data: {
				videos: [
					{ id: '1', view_count: 100, like_count: 10, comment_count: 2, share_count: 1 },
					{ id: '2', view_count: 200, like_count: 20, comment_count: 4, share_count: 3 }
				]
			}
		};
		const verdict = deriveVerdict(true, body);
		expect(verdict.automatedPathViable).toBe(true);
		expect(verdict.videoCount).toBe(2);
		expect(verdict.fieldsPresentOnEveryVideo.sort()).toEqual(['comment_count', 'like_count', 'share_count', 'view_count']);
		expect(verdict.summary).toMatch(/VIABLE/);
	});

	it('reports NOT viable when the request itself failed', () => {
		const verdict = deriveVerdict(false, { error: { code: 'access_token_invalid' } });
		expect(verdict.requestOk).toBe(false);
		expect(verdict.automatedPathViable).toBe(false);
		expect(verdict.videoCount).toBe(0);
		expect(verdict.summary).toMatch(/NOT/);
		expect(verdict.summary).toMatch(/tiktok-manual\.ts/);
	});

	it('reports NOT viable when the request succeeded but returned zero videos', () => {
		const verdict = deriveVerdict(true, { data: { videos: [] } });
		expect(verdict.automatedPathViable).toBe(false);
		expect(verdict.videoCount).toBe(0);
	});

	it('reports NOT viable when a field is present on some but not all videos', () => {
		const body = {
			data: {
				videos: [
					{ id: '1', view_count: 100, like_count: 10, comment_count: 2, share_count: 1 },
					{ id: '2', view_count: 200, like_count: 20, comment_count: 4 } // no share_count
				]
			}
		};
		const verdict = deriveVerdict(true, body);
		expect(verdict.automatedPathViable).toBe(false);
		expect(verdict.fieldsPresentOnEveryVideo).not.toContain('share_count');
	});

	it('reports NOT viable when a field is present but not a number (e.g. a string placeholder)', () => {
		const body = {
			data: {
				videos: [{ id: '1', view_count: '100', like_count: 10, comment_count: 2, share_count: 1 }]
			}
		};
		const verdict = deriveVerdict(true, body);
		expect(verdict.automatedPathViable).toBe(false);
		expect(verdict.fieldsPresentOnEveryVideo).not.toContain('view_count');
	});

	it('handles a malformed body gracefully (no data.videos array) as zero videos', () => {
		const verdict = deriveVerdict(true, { unexpected: 'shape' });
		expect(verdict.videoCount).toBe(0);
		expect(verdict.automatedPathViable).toBe(false);
	});

	it('handles a null body gracefully', () => {
		const verdict = deriveVerdict(true, null);
		expect(verdict.videoCount).toBe(0);
		expect(verdict.automatedPathViable).toBe(false);
	});
});
