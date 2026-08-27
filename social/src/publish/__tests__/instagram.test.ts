/**
 * Tests for `../instagram.ts` (Pf39c2-social-pilot-03 T05).
 *
 * IMPORTANT: no real network call happens anywhere in this file. `fetchFn`
 * is always a `vi.fn()` fake and `sleep` is always a `vi.fn()` that resolves
 * immediately — the "once a minute, max 5 minutes" poll bound from the plan
 * Constraint is exercised by counting fake calls, never by waiting real
 * time. The live half of T05's acceptance ("a live test post succeeds and
 * is publicly visible") is explicitly DEFERRED — this suite only proves the
 * adapter's logic against a mocked Graph API.
 *
 * Coverage, matching the plan's Constraints and this task's brief:
 *   - Happy path: container -> poll -> publish, in that order, with the
 *     right endpoints and `media_type: 'REELS'` for a Reel.
 *   - Polling stops on `FINISHED` and fails on `ERROR`/`EXPIRED`.
 *   - Polling gives up after the 5-minute / 5-attempt bound rather than
 *     looping forever.
 *   - Error 2207052 (transient media-fetch failure) triggers a retry of
 *     CONTAINER CREATION and succeeds on a later attempt.
 *   - Error code 4 (rate limit) does NOT retry-storm — asserted via a
 *     bounded call count, per the plan Constraint: "Instagram's rate limit
 *     is '4800 x Number of Impressions' per 24h, which computes to near
 *     zero on a brand-new account. Expect error code 4 and back off rather
 *     than retry-storm."
 *   - No token value ever appears in a thrown error's message or in any
 *     `console.*` call — the plan Constraint: "Never log tokens."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	CONTAINER_CREATE_MAX_ATTEMPTS,
	MEDIA_FETCH_ERROR_CODE,
	POLL_MAX_ATTEMPTS,
	RATE_LIMIT_ERROR_CODE,
	publishToInstagram,
	type InstagramConfig,
} from '../instagram.js';

const CONFIG: InstagramConfig = {
	igUserId: 'ig-user-12345',
	accessToken: 'super-secret-ig-token-do-not-log',
	graphApiBaseUrl: 'https://graph.facebook.test/v99.0',
};

const MEDIA_URL = 'https://media.thinkplain.ai/posts/2026-09-01/wall-2026-09-01.mp4';
const CAPTION = 'A Stoic card for today.';

/** Builds a fake `Response`-like object with a `.json()` and `.ok`/`.status`. */
function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}) {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		json: async () => body,
	} as Response;
}

function metaError(code: number, message = 'a Meta error', errorSubcode?: number) {
	return { error: { code, message, ...(errorSubcode !== undefined ? { error_subcode: errorSubcode } : {}) } };
}

describe('publishToInstagram — happy path', () => {
	it('creates a container, polls until FINISHED, then publishes, in that order', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(jsonResponse({ id: 'container-1' })) // create
			.mockResolvedValueOnce(jsonResponse({ status_code: 'IN_PROGRESS' })) // poll 1
			.mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' })) // poll 2
			.mockResolvedValueOnce(jsonResponse({ id: 'media-1' })); // publish
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await publishToInstagram({
			config: CONFIG,
			mediaUrl: MEDIA_URL,
			caption: CAPTION,
			mediaKind: 'reel',
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ containerId: 'container-1', mediaId: 'media-1' });
		expect(fetchFn).toHaveBeenCalledTimes(4);

		// Call 1: create container.
		const [createUrl, createInit] = fetchFn.mock.calls[0];
		expect(createInit).toEqual({ method: 'POST' });
		expect(String(createUrl)).toContain(`${CONFIG.graphApiBaseUrl}/${CONFIG.igUserId}/media`);
		expect(String(createUrl)).toContain(`video_url=${encodeURIComponent(MEDIA_URL)}`);
		expect(String(createUrl)).toContain('media_type=REELS');

		// Calls 2 and 3: poll.
		const [pollUrl1] = fetchFn.mock.calls[1];
		expect(String(pollUrl1)).toContain(`${CONFIG.graphApiBaseUrl}/container-1`);
		expect(String(pollUrl1)).toContain('fields=status_code');
		const [pollUrl2] = fetchFn.mock.calls[2];
		expect(String(pollUrl2)).toContain('container-1');

		// Call 4: publish.
		const [publishUrl, publishInit] = fetchFn.mock.calls[3];
		expect(publishInit).toEqual({ method: 'POST' });
		expect(String(publishUrl)).toContain(`${CONFIG.graphApiBaseUrl}/${CONFIG.igUserId}/media_publish`);
		expect(String(publishUrl)).toContain('creation_id=container-1');

		// Only one poll sleep happened (between poll 1 and poll 2), not before create or publish.
		expect(sleep).toHaveBeenCalledTimes(1);
	});

	it('uses image_url (not video_url) and omits media_type for a feed still', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(jsonResponse({ id: 'container-2' }))
			.mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
			.mockResolvedValueOnce(jsonResponse({ id: 'media-2' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await publishToInstagram({
			config: CONFIG,
			mediaUrl: 'https://media.thinkplain.ai/posts/2026-09-01/still.jpg',
			caption: CAPTION,
			mediaKind: 'image',
			fetchFn,
			sleep,
		});

		const [createUrl] = fetchFn.mock.calls[0];
		expect(String(createUrl)).toContain('image_url=');
		expect(String(createUrl)).not.toContain('video_url=');
		expect(String(createUrl)).not.toContain('media_type=');
	});
});

describe('publishToInstagram — polling terminal states', () => {
	it('fails immediately when the container status is ERROR, surfacing status_msg', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(jsonResponse({ id: 'container-err' }))
			.mockResolvedValueOnce(jsonResponse({ status_code: 'ERROR', status_msg: 'media could not be processed' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep })
		).rejects.toThrow(/ERROR.*media could not be processed/s);

		// No publish call — the container never reached FINISHED.
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('fails immediately when the container status is EXPIRED', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(jsonResponse({ id: 'container-exp' }))
			.mockResolvedValueOnce(jsonResponse({ status_code: 'EXPIRED' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep })
		).rejects.toThrow(/EXPIRED/);

		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('gives up after the 5-attempt / 5-minute bound rather than polling forever', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(jsonResponse({ id: 'container-slow' }));
		// Every poll call returns IN_PROGRESS, forever, if allowed to.
		fetchFn.mockResolvedValue(jsonResponse({ status_code: 'IN_PROGRESS' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep })
		).rejects.toThrow(new RegExp(`${POLL_MAX_ATTEMPTS} polls`));

		// 1 create call + exactly POLL_MAX_ATTEMPTS poll calls — never a 6th poll, never a publish call.
		expect(fetchFn).toHaveBeenCalledTimes(1 + POLL_MAX_ATTEMPTS);
		// A sleep happens between polls, not after the last one: POLL_MAX_ATTEMPTS - 1 sleeps.
		expect(sleep).toHaveBeenCalledTimes(POLL_MAX_ATTEMPTS - 1);
	});
});

describe('publishToInstagram — error 2207052 (transient media-fetch failure) retries container creation', () => {
	it('retries and succeeds on a later attempt', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(jsonResponse(metaError(MEDIA_FETCH_ERROR_CODE, 'could not fetch media')))
			.mockResolvedValueOnce(jsonResponse(metaError(MEDIA_FETCH_ERROR_CODE, 'could not fetch media')))
			.mockResolvedValueOnce(jsonResponse({ id: 'container-retry' })) // succeeds on 3rd attempt
			.mockResolvedValueOnce(jsonResponse({ status_code: 'FINISHED' }))
			.mockResolvedValueOnce(jsonResponse({ id: 'media-retry' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await publishToInstagram({
			config: CONFIG,
			mediaUrl: MEDIA_URL,
			caption: CAPTION,
			mediaKind: 'reel',
			fetchFn,
			sleep,
		});

		expect(result.containerId).toBe('container-retry');
		// 2 failed creates + 1 successful create + 1 poll + 1 publish.
		expect(fetchFn).toHaveBeenCalledTimes(5);
		// Backoff sleeps happened for the 2 failed create attempts, plus none needed for the single FINISHED poll.
		expect(sleep).toHaveBeenCalledTimes(2);
	});

	it('gives up after CONTAINER_CREATE_MAX_ATTEMPTS attempts rather than retrying forever', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(MEDIA_FETCH_ERROR_CODE, 'could not fetch media')));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep })
		).rejects.toThrow(/could not fetch media/);

		expect(fetchFn).toHaveBeenCalledTimes(CONTAINER_CREATE_MAX_ATTEMPTS);
		expect(sleep).toHaveBeenCalledTimes(CONTAINER_CREATE_MAX_ATTEMPTS - 1);
	});
});

describe('publishToInstagram — error code 4 (rate limit) does not retry-storm', () => {
	it('fails on the very first container-creation call, with no retry at all', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(RATE_LIMIT_ERROR_CODE, 'Application request limit reached')));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep })
		).rejects.toThrow(/rate limit/i);

		// Exactly one call — proves this is NOT retried like MEDIA_FETCH_ERROR_CODE is.
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('the surfaced error clearly names it a rate limit / give-up condition', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(RATE_LIMIT_ERROR_CODE, 'Application request limit reached')));
		const sleep = vi.fn().mockResolvedValue(undefined);

		let thrown: unknown;
		try {
			await publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toMatch(/rate limit/i);
		expect((thrown as Error).message).toMatch(/back ?off|giving up/i);
	});
});

describe('publishToInstagram — never logs the access token', () => {
	let consoleSpies: ReturnType<typeof vi.spyOn>[];

	beforeEach(() => {
		consoleSpies = [
			vi.spyOn(console, 'log').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'info').mockImplementation(() => {}),
			vi.spyOn(console, 'debug').mockImplementation(() => {}),
		];
	});

	afterEach(() => {
		for (const spy of consoleSpies) spy.mockRestore();
	});

	function assertNoConsoleCallContainsToken() {
		for (const spy of consoleSpies) {
			for (const call of spy.mock.calls) {
				const serialized = call.map((arg) => String(arg)).join(' ');
				expect(serialized).not.toContain(CONFIG.accessToken);
			}
		}
	}

	it('never appears in a thrown error message on a generic Graph API error', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(100, 'Invalid parameter')));
		const sleep = vi.fn().mockResolvedValue(undefined);

		let thrown: unknown;
		try {
			await publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
		assertNoConsoleCallContainsToken();
	});

	it('never appears in a thrown error message when the HTTP response itself is a non-OK, non-JSON-error failure', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		let thrown: unknown;
		try {
			await publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
		assertNoConsoleCallContainsToken();
	});

	it('never appears in the rate-limit error message', async () => {
		const fetchFn = vi.fn().mockResolvedValue(jsonResponse(metaError(RATE_LIMIT_ERROR_CODE, 'Application request limit reached')));
		const sleep = vi.fn().mockResolvedValue(undefined);

		let thrown: unknown;
		try {
			await publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
		assertNoConsoleCallContainsToken();
	});

	it('never appears in the polling-timeout error message', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(jsonResponse({ id: 'container-slow' }));
		fetchFn.mockResolvedValue(jsonResponse({ status_code: 'IN_PROGRESS' }));
		const sleep = vi.fn().mockResolvedValue(undefined);

		let thrown: unknown;
		try {
			await publishToInstagram({ config: CONFIG, mediaUrl: MEDIA_URL, caption: CAPTION, mediaKind: 'reel', fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
		assertNoConsoleCallContainsToken();
	});
});
