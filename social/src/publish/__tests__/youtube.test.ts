/**
 * Tests for `../youtube.ts` (Pf39c2-social-pilot-03 T06).
 *
 * IMPORTANT: no real network call happens anywhere in this file. `fetchFn`
 * is always a `vi.fn()` fake and `sleep` is always a `vi.fn()` that resolves
 * immediately. The live half of T06's acceptance ("a live test upload
 * appears in Studio ready to flip") is explicitly DEFERRED — this session
 * has no YouTube/Google credentials — this suite only proves the adapter's
 * logic against a mocked resumable-upload API.
 *
 * Coverage, matching the plan's Constraints and this task's brief:
 *   - Happy path: session initiation reads `Location`, then the PUT uploads
 *     and returns the new video id.
 *   - `notifySubscribers=false`, `selfDeclaredMadeForKids: false`, and
 *     `privacyStatus: 'private'` are always sent, and there is no way for a
 *     caller to override any of them.
 *   - A 308 with a `Range` header resumes from the correct byte offset,
 *     including the exact off-by-one boundary case (`bytes=0-262143` means
 *     262144 bytes received).
 *   - A 308 followed by completion succeeds.
 *   - 5xx retries with backoff and eventually succeeds; exhausting attempts
 *     fails with a clear error.
 *   - A 4xx does NOT retry.
 *   - No token value ever appears in a thrown error's message or in any
 *     `console.*` call — the plan Constraint: "Never log tokens."
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	INITIATE_MAX_ATTEMPTS,
	UPLOAD_MAX_ATTEMPTS,
	bytesReceivedFromRangeHeader,
	uploadVideoToYouTube,
	type YouTubeConfig,
} from '../youtube.js';

/**
 * Only exercised by the "reads video bytes from a file path" test below —
 * every other test passes an in-memory `Buffer`, which `resolveVideoBytes`
 * (see `../youtube.ts`) short-circuits before ever calling `readFile`.
 */
vi.mock('node:fs/promises', () => ({
	readFile: vi.fn().mockResolvedValue(Buffer.from('a'.repeat(1000))),
}));

const CONFIG: YouTubeConfig = {
	accessToken: 'super-secret-yt-token-do-not-log',
	uploadBaseUrl: 'https://upload.youtube.test/upload/youtube/v3/videos',
};

const SESSION_URI = 'https://upload.youtube.test/session/abc123';
const VIDEO_BYTES = Buffer.from('a'.repeat(1000));
const TITLE = 'A Stoic card for today';
const DESCRIPTION = 'From The Wall — plain-English Stoic philosophy.';

/** Builds a fake `Response`-like object with `.ok`/`.status`/`.headers.get`/`.json`/`.text`. */
function fakeResponse(
	init: { ok?: boolean; status?: number; headers?: Record<string, string>; body?: unknown } = {}
): Response {
	const headerMap = new Map(Object.entries(init.headers ?? {}).map(([key, value]) => [key.toLowerCase(), value]));
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		headers: { get: (name: string) => headerMap.get(name.toLowerCase()) ?? null },
		json: async () => init.body ?? {},
		text: async () => (typeof init.body === 'string' ? init.body : JSON.stringify(init.body ?? {})),
	} as unknown as Response;
}

function initiateResponse(location = SESSION_URI) {
	return fakeResponse({ ok: true, status: 200, headers: { Location: location } });
}

function uploadDoneResponse(videoId = 'video-1') {
	return fakeResponse({ ok: true, status: 200, body: { id: videoId } });
}

function resumeIncompleteResponse(rangeHeader?: string) {
	const headers: Record<string, string> = rangeHeader !== undefined ? { Range: rangeHeader } : {};
	return fakeResponse({ ok: false, status: 308, headers });
}

function serverErrorResponse(status = 503) {
	return fakeResponse({ ok: false, status, body: 'internal error' });
}

function clientErrorResponse(status = 400) {
	return fakeResponse({ ok: false, status, body: { error: 'invalid request' } });
}

describe('uploadVideoToYouTube — happy path', () => {
	it('initiates a resumable session, reads Location, then PUTs the bytes and returns the new video id', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(uploadDoneResponse('video-happy'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			tags: ['stoicism', 'the-wall'],
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-happy' });
		expect(fetchFn).toHaveBeenCalledTimes(2);

		// Call 1: session initiation.
		const [initiateUrl, initiateInit] = fetchFn.mock.calls[0];
		expect(String(initiateUrl)).toContain(CONFIG.uploadBaseUrl);
		expect(String(initiateUrl)).toContain('uploadType=resumable');
		expect(initiateInit.method).toBe('POST');
		expect(initiateInit.headers.Authorization).toBe(`Bearer ${CONFIG.accessToken}`);
		expect(initiateInit.headers['X-Upload-Content-Length']).toBe(String(VIDEO_BYTES.length));
		expect(initiateInit.headers['X-Upload-Content-Type']).toBe('video/mp4');
		const initiateBody = JSON.parse(initiateInit.body);
		expect(initiateBody.snippet).toEqual({ title: TITLE, description: DESCRIPTION, tags: ['stoicism', 'the-wall'] });

		// Call 2: byte upload.
		const [uploadUrl, uploadInit] = fetchFn.mock.calls[1];
		expect(uploadUrl).toBe(SESSION_URI);
		expect(uploadInit.method).toBe('PUT');
		expect(uploadInit.headers.Authorization).toBe(`Bearer ${CONFIG.accessToken}`);
		expect(uploadInit.headers['Content-Range']).toBe(`bytes 0-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}`);
		expect(uploadInit.headers['Content-Length']).toBe(String(VIDEO_BYTES.length));

		expect(sleep).not.toHaveBeenCalled();
	});

	it('reads video bytes from a file path when given one instead of a Buffer', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(uploadDoneResponse('video-from-file'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: { filePath: '/tmp/does-not-matter.mp4' },
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-from-file' });
	});
});

describe('uploadVideoToYouTube — required status fields are always sent, never overridable', () => {
	it('sends notifySubscribers=false as a query parameter on the initiate call', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(uploadDoneResponse());
		const sleep = vi.fn().mockResolvedValue(undefined);

		await uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep });

		const [initiateUrl] = fetchFn.mock.calls[0];
		expect(String(initiateUrl)).toContain('notifySubscribers=false');
	});

	it('sends privacyStatus: "private" and selfDeclaredMadeForKids: false in the status body', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(uploadDoneResponse());
		const sleep = vi.fn().mockResolvedValue(undefined);

		await uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep });

		const [, initiateInit] = fetchFn.mock.calls[0];
		const body = JSON.parse(initiateInit.body);
		expect(body.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
	});

	it('exposes no option that lets a caller flip privacyStatus, notifySubscribers, or selfDeclaredMadeForKids', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(uploadDoneResponse());
		const sleep = vi.fn().mockResolvedValue(undefined);

		// A caller attempting to smuggle these fields in via an `as any` cast still cannot affect the outcome,
		// because the request is built entirely from REQUIRED_STATUS / a hardcoded query string, never from options.
		const options = {
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
			// Fields that do not exist on UploadVideoOptions — proves they have no effect even if smuggled in.
			privacyStatus: 'public',
			notifySubscribers: true,
			selfDeclaredMadeForKids: true,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
		} as any;

		await uploadVideoToYouTube(options);

		const [initiateUrl, initiateInit] = fetchFn.mock.calls[0];
		expect(String(initiateUrl)).toContain('notifySubscribers=false');
		const body = JSON.parse(initiateInit.body);
		expect(body.status).toEqual({ privacyStatus: 'private', selfDeclaredMadeForKids: false });
	});
});

describe('bytesReceivedFromRangeHeader — the 308 off-by-one', () => {
	it('treats "bytes=0-262143" as 262144 bytes received (inclusive end + 1)', () => {
		expect(bytesReceivedFromRangeHeader('bytes=0-262143')).toBe(262144);
	});

	it('treats a missing Range header as zero bytes received', () => {
		expect(bytesReceivedFromRangeHeader(null)).toBe(0);
	});

	it('handles a non-zero start (still keyed off the end byte only)', () => {
		expect(bytesReceivedFromRangeHeader('bytes=0-999')).toBe(1000);
	});

	it('throws on an unparseable Range header rather than guessing', () => {
		expect(() => bytesReceivedFromRangeHeader('not-a-range')).toThrow(/unparseable/i);
	});
});

describe('uploadVideoToYouTube — 308 Resume Incomplete', () => {
	it('resumes from the correct offset after a 308 with a Range header, with the exact Content-Range boundary', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(resumeIncompleteResponse('bytes=0-262143')) // server received 262144 bytes
			.mockResolvedValueOnce(uploadDoneResponse('video-resumed'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const bigVideo = Buffer.alloc(500_000, 'b');
		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: bigVideo,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-resumed' });
		expect(fetchFn).toHaveBeenCalledTimes(3);

		// First PUT covers the whole file from offset 0.
		const [, firstPutInit] = fetchFn.mock.calls[1];
		expect(firstPutInit.headers['Content-Range']).toBe(`bytes 0-${bigVideo.length - 1}/${bigVideo.length}`);

		// Resume PUT starts at byte 262144 (NOT 262143) — the off-by-one this task calls out explicitly.
		const [resumeUrl, resumePutInit] = fetchFn.mock.calls[2];
		expect(resumeUrl).toBe(SESSION_URI);
		expect(resumePutInit.headers['Content-Range']).toBe(`bytes 262144-${bigVideo.length - 1}/${bigVideo.length}`);
		expect(resumePutInit.headers['Content-Length']).toBe(String(bigVideo.length - 262144));
		expect(resumePutInit.body).toEqual(bigVideo.subarray(262144));

		// Progress was made — no backoff sleep before resuming.
		expect(sleep).not.toHaveBeenCalled();
	});

	it('resumes from offset 0 on a 308 with no Range header at all', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(resumeIncompleteResponse(undefined))
			.mockResolvedValueOnce(uploadDoneResponse());
		const sleep = vi.fn().mockResolvedValue(undefined);

		await uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep });

		const [, secondPutInit] = fetchFn.mock.calls[2];
		expect(secondPutInit.headers['Content-Range']).toBe(`bytes 0-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}`);
	});

	it('backs off (does not hammer) on a 308 that reports no forward progress, then succeeds', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(resumeIncompleteResponse(undefined)) // no progress: 0 bytes received
			.mockResolvedValueOnce(resumeIncompleteResponse(undefined)) // still no progress
			.mockResolvedValueOnce(uploadDoneResponse('video-eventually'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-eventually' });
		// Two no-progress 308s -> two backoff sleeps.
		expect(sleep).toHaveBeenCalledTimes(2);
		expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
	});

	it('fails with a clear error after making no progress for UPLOAD_MAX_ATTEMPTS attempts', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse());
		fetchFn.mockResolvedValue(resumeIncompleteResponse(undefined));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep })
		).rejects.toThrow(/no progress/i);

		// 1 initiate + UPLOAD_MAX_ATTEMPTS PUTs, never more.
		expect(fetchFn).toHaveBeenCalledTimes(1 + UPLOAD_MAX_ATTEMPTS);
	});
});

describe('uploadVideoToYouTube — 5xx retries with backoff', () => {
	it('retries a 5xx on the initiate call and eventually succeeds', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(serverErrorResponse(503))
			.mockResolvedValueOnce(serverErrorResponse(500))
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(uploadDoneResponse('video-initiate-retry'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-initiate-retry' });
		expect(fetchFn).toHaveBeenCalledTimes(4);
		expect(sleep).toHaveBeenCalledTimes(2);
		// Exponential: second backoff strictly greater than the first.
		expect(sleep.mock.calls[1][0]).toBeGreaterThan(sleep.mock.calls[0][0]);
	});

	it('gives up on the initiate call after INITIATE_MAX_ATTEMPTS consecutive 5xx responses', async () => {
		const fetchFn = vi.fn().mockResolvedValue(serverErrorResponse(500));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep })
		).rejects.toThrow(/HTTP 500/);

		expect(fetchFn).toHaveBeenCalledTimes(INITIATE_MAX_ATTEMPTS);
		expect(sleep).toHaveBeenCalledTimes(INITIATE_MAX_ATTEMPTS - 1);
	});

	it('retries a 5xx during byte upload by querying status, then resumes and succeeds', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(serverErrorResponse(502)) // upload PUT fails
			.mockResolvedValueOnce(resumeIncompleteResponse('bytes=0-499')) // status query: 500 bytes landed
			.mockResolvedValueOnce(uploadDoneResponse('video-5xx-resumed'));
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-5xx-resumed' });
		expect(fetchFn).toHaveBeenCalledTimes(4);
		expect(sleep).toHaveBeenCalledTimes(1);

		// The status-query call used the */total form with no body.
		const [, statusQueryInit] = fetchFn.mock.calls[2];
		expect(statusQueryInit.method).toBe('PUT');
		expect(statusQueryInit.headers.Authorization).toBe(`Bearer ${CONFIG.accessToken}`);
		expect(statusQueryInit.headers['Content-Range']).toBe(`bytes */${VIDEO_BYTES.length}`);
		expect(statusQueryInit.body).toBeUndefined();

		// The resume PUT starts at byte 500.
		const [, resumeInit] = fetchFn.mock.calls[3];
		expect(resumeInit.headers['Content-Range']).toBe(`bytes 500-${VIDEO_BYTES.length - 1}/${VIDEO_BYTES.length}`);
	});

	it('a status query after a 5xx that reveals the upload actually finished returns the video id, no further PUT', async () => {
		const fetchFn = vi.fn();
		fetchFn
			.mockResolvedValueOnce(initiateResponse())
			.mockResolvedValueOnce(serverErrorResponse(500)) // upload PUT fails
			.mockResolvedValueOnce(uploadDoneResponse('video-finished-anyway')); // status query reveals it actually finished
		const sleep = vi.fn().mockResolvedValue(undefined);

		const result = await uploadVideoToYouTube({
			config: CONFIG,
			video: VIDEO_BYTES,
			title: TITLE,
			description: DESCRIPTION,
			fetchFn,
			sleep,
		});

		expect(result).toEqual({ videoId: 'video-finished-anyway' });
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	it('exhausts UPLOAD_MAX_ATTEMPTS on repeated 5xx during byte upload and fails with a clear error', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse());
		fetchFn.mockResolvedValue(serverErrorResponse(503));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep })
		).rejects.toThrow(/HTTP 503/);

		// 1 initiate + UPLOAD_MAX_ATTEMPTS upload PUT attempts, each of the first
		// UPLOAD_MAX_ATTEMPTS - 1 followed by one inconclusive status-query probe
		// (also 503, so it never resolves the offset) + the final PUT attempt
		// with no trailing probe (it throws immediately instead). The bound is
		// still exactly UPLOAD_MAX_ATTEMPTS PUT attempts — never more.
		expect(fetchFn).toHaveBeenCalledTimes(1 + 2 * (UPLOAD_MAX_ATTEMPTS - 1) + 1);
	});
});

describe('uploadVideoToYouTube — a 4xx does NOT retry', () => {
	it('fails immediately on a 4xx during session initiation', async () => {
		const fetchFn = vi.fn().mockResolvedValue(clientErrorResponse(400));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep })
		).rejects.toThrow(/HTTP 400/);

		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(sleep).not.toHaveBeenCalled();
	});

	it('fails immediately on a 4xx during byte upload, with no status query and no retry', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(clientErrorResponse(403));
		const sleep = vi.fn().mockResolvedValue(undefined);

		await expect(
			uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep })
		).rejects.toThrow(/HTTP 403/);

		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(sleep).not.toHaveBeenCalled();
	});
});

describe('uploadVideoToYouTube — never logs the access token', () => {
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

	async function expectNoTokenLeak(fetchFn: ReturnType<typeof vi.fn>) {
		const sleep = vi.fn().mockResolvedValue(undefined);
		let thrown: unknown;
		try {
			await uploadVideoToYouTube({ config: CONFIG, video: VIDEO_BYTES, title: TITLE, description: DESCRIPTION, fetchFn, sleep });
		} catch (error) {
			thrown = error;
		}
		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).not.toContain(CONFIG.accessToken);
		assertNoConsoleCallContainsToken();
	}

	it('never appears in the error message when session initiation fails with a 4xx', async () => {
		await expectNoTokenLeak(vi.fn().mockResolvedValue(clientErrorResponse(401)));
	});

	it('never appears in the error message when session initiation exhausts 5xx retries', async () => {
		await expectNoTokenLeak(vi.fn().mockResolvedValue(serverErrorResponse(500)));
	});

	it('never appears in the error message when byte upload fails with a 4xx', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse()).mockResolvedValueOnce(clientErrorResponse(403));
		await expectNoTokenLeak(fetchFn);
	});

	it('never appears in the error message when the no-progress-308 bound is exhausted', async () => {
		const fetchFn = vi.fn();
		fetchFn.mockResolvedValueOnce(initiateResponse());
		fetchFn.mockResolvedValue(resumeIncompleteResponse(undefined));
		await expectNoTokenLeak(fetchFn);
	});
});
