/**
 * The YouTube adapter (Pf39c2-social-pilot-03 T06) — implements the YouTube
 * Data API v3 resumable upload protocol: initiate a session, PUT the bytes,
 * and correctly resume from wherever the server left off if a 308 or a 5xx
 * interrupts the upload.
 *
 * Constraint from `plans/Pf39c2-social-pilot-03.md` this module implements:
 *   "YouTube uploads land private and are flipped by hand in Studio during
 *   the weekly session." — every upload this module makes sets
 *   `privacyStatus: 'private'`. There is deliberately NO way for a caller to
 *   override this: `UploadVideoOptions` below exposes no privacy parameter
 *   at all, so a caller cannot accidentally publish public even by mistake.
 *
 *   "YouTube: always set `notifySubscribers=false` (it defaults to TRUE)
 *   and `selfDeclaredMadeForKids=false`." Both are sent unconditionally on
 *   every upload, with no override:
 *     - `notifySubscribers=false` is a QUERY PARAMETER on the session-
 *       initiation call (`videos.insert`), not a body field — getting this
 *       wrong (e.g. putting it in the JSON body instead) would silently
 *       leave it at the API's TRUE default and spam every subscriber on
 *       every upload.
 *     - `selfDeclaredMadeForKids: false` is a `status` body field.
 *
 *   "Shorts classification is automatic from aspect ratio and duration;
 *   `#Shorts` is not required." This module does not add any `#Shorts` tag
 *   or hashtag to the title/description/tags — nothing here needs to, and
 *   nothing here should.
 *
 * OPERATOR NOTE — read this before the pilot's first live upload: "The
 * YouTube OAuth app MUST be published to 'In production', or refresh tokens
 * expire every 7 days and the cron dies weekly. Costs 1 of 100 lifetime user
 * slots, needs no verification." This module has no way to enforce that from
 * code — it is a one-time console setting on the Google Cloud OAuth consent
 * screen — so it is called out here, in the file an operator debugging a
 * dead weekly cron is most likely to open.
 *
 * RESUMABLE UPLOAD PROTOCOL — the two-step dance this module implements:
 *   1. POST to the upload endpoint with `uploadType=resumable` and the
 *      `snippet`/`status` metadata as the JSON body, plus
 *      `X-Upload-Content-Length`/`X-Upload-Content-Type` headers describing
 *      the bytes that will follow. The session URI to PUT those bytes to
 *      comes back in the `Location` response header — not the body.
 *   2. PUT the video bytes to that session URI, with a `Content-Range:
 *      bytes <start>-<end>/<total>` header on every attempt (even the
 *      first, which is `bytes 0-<total-1>/<total>`) and an `Authorization:
 *      Bearer <token>` header — the session URI is not itself a bearer of
 *      auth; every PUT to it (including the wildcard status-query PUT) still
 *      needs the credential, or YouTube 401s the upload.
 *
 *   **308 Resume Incomplete**: the server may accept only part of the PUT
 *   body (e.g. behind a flaky connection) and respond `308` with a `Range`
 *   response header naming what it actually received, e.g. `bytes=0-262143`.
 *   THE OFF-BY-ONE THAT MOST IMPLEMENTATIONS GET WRONG: that header names an
 *   inclusive END byte index, so `bytes=0-262143` means 262144 bytes (0
 *   through 262143, inclusive) were received — the next PUT must resume at
 *   offset 262144, not 262143. See `bytesReceivedFromRangeHeader` below,
 *   which is the one place this arithmetic happens.
 *
 *   A 308 with NO `Range` header at all means zero bytes were received —
 *   resume from offset 0.
 *
 *   **Querying status after an interruption**: if a 5xx (rather than a
 *   clean 308) interrupts the PUT, this module does not know how many bytes
 *   actually landed before the failure. Per the protocol, it queries by
 *   PUTting to the same session URI with a wildcard `Content-Range` header
 *   (`bytes` then `*` then `/<total>`, written split apart here to avoid
 *   closing this comment) and an EMPTY body — the server replies exactly as
 *   it would to a real PUT: `308` + `Range` if partial, or `200`/`201` +
 *   the finished video body if the upload had actually completed despite
 *   the 5xx. If that query is ITSELF inconclusive (e.g. it also comes back
 *   5xx), that is a failed probe, not proof nothing landed — this module
 *   falls back to retrying the same offset on the next bounded attempt
 *   rather than treating the probe's own failure as fatal.
 *
 * **Exponential backoff** applies to 5xx responses (at both the session-
 * initiation step and the byte-upload step) and to a 308 that reports NO
 * forward progress (the same byte offset as last time) — a 308 that DOES
 * report progress is resumed immediately, with no sleep, since the server
 * is telling us to continue, not to back off. All backoff is bounded to
 * `UPLOAD_MAX_ATTEMPTS` total attempts and uses an injectable `sleep` so
 * tests never wait in real time.
 *
 * Never logs `config.accessToken` — same discipline as `instagram.ts`. The
 * token is only ever sent as an `Authorization: Bearer <token>` request
 * header (never a URL query parameter, so there is nothing to redact from a
 * logged URL either), and no function in this module interpolates the
 * token, a header value, or a full request object into a thrown error's
 * message — only HTTP status codes and the response body YouTube itself
 * returned.
 */

import { readFile } from 'node:fs/promises';

/** A `fetch`-compatible function. Injectable so tests never make a real network call. */
export type FetchFn = typeof globalThis.fetch;

/** A function that resolves after `ms` milliseconds. Injectable so tests never actually wait. */
export type SleepFn = (ms: number) => Promise<void>;

/** The default `SleepFn` — a real timer. Only used outside tests. */
export const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface YouTubeConfig {
	/**
	 * An OAuth2 access token for a user/channel with upload scope
	 * (`https://www.googleapis.com/auth/youtube.upload`). NEVER logged —
	 * see this file's header. Sent only as an `Authorization` header value.
	 */
	accessToken: string;
	/** Overridable for tests; defaults to `DEFAULT_UPLOAD_BASE_URL`. */
	uploadBaseUrl?: string;
}

/** The real YouTube Data API v3 resumable-upload endpoint for `videos.insert`. */
export const DEFAULT_UPLOAD_BASE_URL = 'https://www.googleapis.com/upload/youtube/v3/videos';

/**
 * The upload's non-negotiable `status` fields — plan Constraints, not
 * caller-configurable defaults. `UploadVideoOptions` below intentionally
 * exposes no way to override any of these: proving a caller cannot
 * accidentally publish public is part of this task's acceptance criteria.
 */
const REQUIRED_STATUS = {
	privacyStatus: 'private',
	selfDeclaredMadeForKids: false,
} as const;

export interface UploadVideoOptions {
	config: YouTubeConfig;
	/**
	 * The rendered video's bytes. Either an in-memory `Buffer`, or a
	 * `{ filePath }` to read from disk via `node:fs/promises` — the daily
	 * job (T08) is expected to pass whichever it already has in hand
	 * without an extra read/write round trip.
	 */
	video: Buffer | { filePath: string };
	title: string;
	description: string;
	/** Defaults to no tags. */
	tags?: string[];
	/** Defaults to `'video/mp4'` — the only container this pipeline renders. */
	mimeType?: string;
	/** Defaults to the real global `fetch`. Override in tests to avoid any real network call. */
	fetchFn?: FetchFn;
	/** Defaults to a real timer (`realSleep`). Override in tests so backoff runs instantly. */
	sleep?: SleepFn;
}

export interface UploadVideoResult {
	/** The new video's id, as assigned by YouTube. */
	videoId: string;
}

/**
 * Total attempts across the whole byte-upload phase — every PUT (an initial
 * attempt, a 308-with-progress resume, a 308-with-no-progress retry, or a
 * post-5xx status-query-then-resume) counts as one attempt against this
 * bound, so the upload cannot loop forever no matter which case keeps
 * recurring.
 */
export const UPLOAD_MAX_ATTEMPTS = 5;

/** Total attempts at session initiation (`videos.insert`) on a 5xx. */
export const INITIATE_MAX_ATTEMPTS = 5;

/** Base delay for exponential backoff; doubles each attempt (1s, 2s, 4s, 8s, ...). */
export const RETRY_BASE_DELAY_MS = 1_000;

function backoffDelayMs(attempt: number): number {
	return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

function isRetryableServerError(status: number): boolean {
	return status >= 500 && status < 600;
}

/**
 * Raised for any non-OK YouTube API response this module cannot otherwise
 * make progress on. `status` is the HTTP status code, carried through so a
 * caller can branch on it without re-parsing the message string. Never
 * constructed with a token, header, or full request in `message` — only the
 * HTTP status and whatever body YouTube itself returned.
 */
export class YouTubeApiError extends Error {
	readonly status: number;

	constructor(message: string, status: number) {
		super(message);
		this.name = 'YouTubeApiError';
		this.status = status;
	}
}

/** Builds a `YouTubeApiError` from a failed response, reading its body for detail (never a request header/token). */
async function apiErrorFrom(response: Response, action: string): Promise<YouTubeApiError> {
	let detail = '';
	try {
		detail = await response.text();
	} catch {
		// No readable body — fall through with an empty detail.
	}
	return new YouTubeApiError(
		`Failed to ${action}: YouTube API returned HTTP ${response.status}${detail ? ` — ${detail}` : ''}.`,
		response.status
	);
}

/** Parses the finished-upload response body and returns the new video's id. */
async function parseVideoIdFromBody(response: Response): Promise<string> {
	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`YouTube upload finished (HTTP ${response.status}) but the response body was not valid JSON.`);
	}
	if (typeof body.id !== 'string') {
		throw new Error('YouTube upload finished but the response did not include a string "id" field.');
	}
	return body.id;
}

/**
 * Parses a `Range` response header (e.g. `bytes=0-262143`) into the number
 * of bytes the server has actually received. `bytes=0-262143` names an
 * INCLUSIVE end byte index, so it means 262144 bytes were received (0
 * through 262143) — the next PUT must resume at offset 262144. A missing
 * header means zero bytes were received; resume from offset 0.
 */
export function bytesReceivedFromRangeHeader(rangeHeader: string | null): number {
	if (!rangeHeader) {
		return 0;
	}
	const match = rangeHeader.match(/^bytes=\d+-(\d+)$/);
	if (!match) {
		throw new Error(`YouTube resumable upload returned an unparseable Range header: "${rangeHeader}".`);
	}
	const inclusiveEndByte = Number(match[1]);
	return inclusiveEndByte + 1;
}

/** Reads `video` into an in-memory `Buffer`, from disk if given a `filePath`. */
async function resolveVideoBytes(video: Buffer | { filePath: string }): Promise<Buffer> {
	if (Buffer.isBuffer(video)) {
		return video;
	}
	return readFile(video.filePath);
}

// ---------------------------------------------------------------------------
// Step 1 — initiate the resumable session
// ---------------------------------------------------------------------------

interface InitiateSessionParams {
	config: YouTubeConfig;
	title: string;
	description: string;
	tags: string[];
	totalBytes: number;
	mimeType: string;
	fetchFn: FetchFn;
	sleep: SleepFn;
}

/**
 * POSTs to `{uploadBaseUrl}?uploadType=resumable&part=snippet,status` with
 * the video's metadata and returns the session URI to PUT bytes to (read
 * from the `Location` response header, per the protocol — never the body).
 *
 * `notifySubscribers=false` is sent as a QUERY PARAMETER here (this is the
 * `videos.insert` call) — see this file's header for why that placement
 * matters. `status.privacyStatus`/`status.selfDeclaredMadeForKids` come
 * from `REQUIRED_STATUS`, never from a caller-supplied override.
 *
 * Retries a 5xx with exponential backoff, bounded at
 * `INITIATE_MAX_ATTEMPTS`. A 4xx fails immediately, no retry.
 */
async function initiateResumableSession(params: InitiateSessionParams): Promise<string> {
	const { config, title, description, tags, totalBytes, mimeType, fetchFn, sleep } = params;
	const uploadBaseUrl = config.uploadBaseUrl ?? DEFAULT_UPLOAD_BASE_URL;
	const url = `${uploadBaseUrl}?uploadType=resumable&part=snippet%2Cstatus&notifySubscribers=false`;

	const body = JSON.stringify({
		snippet: { title, description, tags },
		status: {
			privacyStatus: REQUIRED_STATUS.privacyStatus,
			selfDeclaredMadeForKids: REQUIRED_STATUS.selfDeclaredMadeForKids,
		},
	});

	for (let attempt = 1; attempt <= INITIATE_MAX_ATTEMPTS; attempt++) {
		const response = await fetchFn(url, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.accessToken}`,
				'Content-Type': 'application/json; charset=UTF-8',
				'X-Upload-Content-Length': String(totalBytes),
				'X-Upload-Content-Type': mimeType,
			},
			body,
		});

		if (response.ok) {
			const location = response.headers.get('location');
			if (!location) {
				throw new Error('YouTube resumable session initiation succeeded but returned no Location header.');
			}
			return location;
		}

		if (!isRetryableServerError(response.status) || attempt === INITIATE_MAX_ATTEMPTS) {
			throw await apiErrorFrom(response, 'initiate a resumable upload session');
		}

		await sleep(backoffDelayMs(attempt));
	}

	// Unreachable: the loop above always either returns or throws.
	throw new Error('YouTube resumable session initiation retry loop exited without returning or throwing.');
}

// ---------------------------------------------------------------------------
// Step 2 — upload the bytes, with 308-resume and 5xx backoff
// ---------------------------------------------------------------------------

type UploadStatusResult = { done: true; videoId: string } | { done: false; bytesReceived: number };

/**
 * Queries how many bytes the server has actually received after an
 * interruption, per the protocol: PUT to the session URI with a wildcard
 * `Content-Range` header (`bytes` then `*` then `/<total>`) and an empty
 * body. The server replies exactly as it would to a real PUT — `308` +
 * `Range` if partial, or a
 * `200`/`201` completion body if the upload had actually finished.
 *
 * Sends `Authorization: Bearer <config.accessToken>` — like every other
 * request in this module, YouTube requires a credential on this PUT too,
 * not just on session initiation.
 */
async function queryUploadStatus(
	sessionUri: string,
	total: number,
	fetchFn: FetchFn,
	config: YouTubeConfig
): Promise<UploadStatusResult> {
	const response = await fetchFn(sessionUri, {
		method: 'PUT',
		headers: {
			Authorization: `Bearer ${config.accessToken}`,
			'Content-Range': `bytes */${total}`,
		},
	});

	if (response.status === 200 || response.status === 201) {
		return { done: true, videoId: await parseVideoIdFromBody(response) };
	}
	if (response.status === 308) {
		return { done: false, bytesReceived: bytesReceivedFromRangeHeader(response.headers.get('range')) };
	}
	throw await apiErrorFrom(response, 'query resumable upload status');
}

interface UploadBytesParams {
	config: YouTubeConfig;
	sessionUri: string;
	bytes: Buffer;
	mimeType: string;
	fetchFn: FetchFn;
	sleep: SleepFn;
}

/**
 * PUTs `bytes` to `sessionUri`, resuming from wherever the server last left
 * off on a 308 and backing off on a 5xx, per this file's header. Bounded at
 * `UPLOAD_MAX_ATTEMPTS` total attempts; a 4xx fails immediately.
 *
 * Sends `Authorization: Bearer <config.accessToken>` on every byte PUT —
 * session initiation authenticating is not enough; YouTube requires the
 * bearer token on the upload PUTs too, per the resumable-upload protocol.
 */
async function uploadBytesResumable(params: UploadBytesParams): Promise<string> {
	const { config, sessionUri, bytes, mimeType, fetchFn, sleep } = params;
	const total = bytes.length;
	let offset = 0;

	for (let attempt = 1; attempt <= UPLOAD_MAX_ATTEMPTS; attempt++) {
		const chunk = bytes.subarray(offset);
		const response = await fetchFn(sessionUri, {
			method: 'PUT',
			headers: {
				Authorization: `Bearer ${config.accessToken}`,
				'Content-Length': String(chunk.length),
				'Content-Type': mimeType,
				'Content-Range': `bytes ${offset}-${total - 1}/${total}`,
			},
			// Cast: Node's `fetch` accepts a `Buffer` body at runtime, but
			// lib.dom's `BodyInit` type (loaded alongside @types/node's `Buffer`)
			// does not structurally recognize it — same accommodation any
			// Node+DOM-typed fetch body needs, nothing YouTube-specific.
			body: chunk as unknown as BodyInit,
		});

		if (response.status === 200 || response.status === 201) {
			return parseVideoIdFromBody(response);
		}

		if (response.status === 308) {
			const received = bytesReceivedFromRangeHeader(response.headers.get('range'));
			if (received > offset) {
				// Progress was made — resume immediately, no backoff sleep.
				offset = received;
				continue;
			}
			// No progress: back off before retrying the same offset.
			if (attempt === UPLOAD_MAX_ATTEMPTS) {
				throw new Error(
					`YouTube resumable upload made no progress after ${UPLOAD_MAX_ATTEMPTS} attempts ` +
						`(stuck at byte offset ${offset} of ${total}).`
				);
			}
			await sleep(backoffDelayMs(attempt));
			continue;
		}

		if (isRetryableServerError(response.status)) {
			if (attempt === UPLOAD_MAX_ATTEMPTS) {
				throw await apiErrorFrom(response, 'upload video bytes');
			}
			await sleep(backoffDelayMs(attempt));
			// A 5xx does not tell us how many bytes landed before the failure —
			// query, per the protocol, before resuming. If the query itself is
			// inconclusive (e.g. it also fails with a 5xx), that is a failed
			// PROBE, not proof nothing landed — fall back to retrying from the
			// same offset on the next attempt rather than treating the probe's
			// own failure as fatal.
			try {
				const queried = await queryUploadStatus(sessionUri, total, fetchFn, config);
				if (queried.done) {
					return queried.videoId;
				}
				offset = queried.bytesReceived;
			} catch {
				// Inconclusive — retry the same offset on the next attempt.
			}
			continue;
		}

		// Any other status (4xx) — do not retry.
		throw await apiErrorFrom(response, 'upload video bytes');
	}

	throw new Error(`YouTube resumable upload did not complete after ${UPLOAD_MAX_ATTEMPTS} attempts.`);
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

/**
 * Uploads one video to YouTube via the resumable upload protocol described
 * in this file's header, end to end, in one call. Always uploads private,
 * never notifies subscribers, and always marks the video not made for kids
 * — see `REQUIRED_STATUS` and this file's header for why none of those are
 * caller-configurable.
 */
export async function uploadVideoToYouTube(options: UploadVideoOptions): Promise<UploadVideoResult> {
	const {
		config,
		video,
		title,
		description,
		tags = [],
		mimeType = 'video/mp4',
		fetchFn = globalThis.fetch,
		sleep = realSleep,
	} = options;

	const bytes = await resolveVideoBytes(video);
	const sessionUri = await initiateResumableSession({
		config,
		title,
		description,
		tags,
		totalBytes: bytes.length,
		mimeType,
		fetchFn,
		sleep,
	});
	const videoId = await uploadBytesResumable({ config, sessionUri, bytes, mimeType, fetchFn, sleep });

	return { videoId };
}
