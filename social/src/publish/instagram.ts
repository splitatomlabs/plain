/**
 * The Instagram adapter (Pf39c2-social-pilot-03 T05) — creates a media
 * container, polls it until Meta finishes processing, then publishes it.
 *
 * Constraint from `plans/Pf39c2-social-pilot-03.md` this module implements:
 *   "Instagram: JPEG only for feed, <=8MB; Reels 3s-15min, <=300MB.
 *   Container -> poll `status_code` (once a minute, max 5 minutes) ->
 *   publish. Containers expire after 24h."
 *
 * NOTE ON THE 24H EXPIRY: a container that finishes processing but is never
 * published (`media_publish`) becomes unusable after 24 hours and must be
 * recreated from scratch. Nothing in THIS module enforces that — it always
 * runs container -> poll -> publish back to back in one call — but a caller
 * (T08's daily job) that persists a bare container id across process
 * restarts must not try to resume publishing against a container older
 * than 24h; it should start over from `publishToInstagram`.
 *
 * Two distinct Meta Graph API error codes get special handling, both named
 * explicitly by the plan's Constraints rather than treated as "retry
 * everything":
 *
 *   - **2207052** — a transient failure where Meta's servers could not fetch
 *     the media from `mediaUrl` (GCS). This is retried, with backoff, up to
 *     `CONTAINER_CREATE_MAX_ATTEMPTS` total attempts at container creation
 *     ONLY — polling and the final publish call are not retried on this
 *     code, since a failed fetch means no container was ever created to
 *     poll or publish.
 *   - **4** — Meta's generic rate-limit code. The plan's Constraint:
 *     "Instagram's rate limit is '4800 x Number of Impressions' per 24h,
 *     which computes to near zero on a brand-new account. Expect error code
 *     4 and back off rather than retry-storm." This code is deliberately
 *     NOT retried by this module at all — it is surfaced as a clearly
 *     labeled `InstagramApiError` so the caller (and whatever alerting T08
 *     wires up) can back off for the rest of the run instead of hammering
 *     an account that is already being throttled.
 *
 * Every other Graph API error (including any other code, or a container
 * that lands in `ERROR`/`EXPIRED` during polling) fails immediately with no
 * retry.
 *
 * Constraint: "Never log tokens. Store them in Secret Manager or Firestore,
 * never env vars." This module never passes `config.accessToken` to
 * `console.*`, never interpolates it into a thrown error's message, and
 * never returns a raw request URL from any function that could end up
 * logged — `redactUrl` strips `access_token` from a URL before it is ever
 * allowed into an error message, since Meta's Graph API takes the token as
 * a query parameter on every request this module makes (container create,
 * poll, and publish alike).
 *
 * `fetchFn` and `sleep` are both injectable (defaulting to the real global
 * `fetch` and a real `setTimeout`-based sleep) so tests can mock the
 * network and run the 5-attempt / once-a-minute poll loop instantly instead
 * of waiting up to 5 real minutes.
 */

/** A `fetch`-compatible function. Injectable so tests never make a real network call. */
export type FetchFn = typeof globalThis.fetch;

/** A function that resolves after `ms` milliseconds. Injectable so tests never actually wait. */
export type SleepFn = (ms: number) => Promise<void>;

/** The default `SleepFn` — a real timer. Only used outside tests. */
export const realSleep: SleepFn = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export interface InstagramConfig {
	/** The IG User ID (a Business/Creator account, per this plan's Decision — no App Review needed). */
	igUserId: string;
	/** NEVER logged. Passed as the Graph API's `access_token` query parameter on every call. */
	accessToken: string;
	/** Overridable for tests; defaults to `DEFAULT_GRAPH_API_BASE_URL`. */
	graphApiBaseUrl?: string;
}

export const DEFAULT_GRAPH_API_BASE_URL = 'https://graph.facebook.com/v21.0';

/** `'reel'` posts as a Reel (`video_url` + `media_type: 'REELS'`); `'image'` posts as a feed still (`image_url`). */
export type MediaKind = 'reel' | 'image';

// ---------------------------------------------------------------------------
// Timing constants — the plan's "once a minute, max 5 minutes" poll bound.
// ---------------------------------------------------------------------------

/** Poll `status_code` once a minute, per the plan Constraint. */
export const POLL_INTERVAL_MS = 60_000;

/** "Max 5 minutes" at one poll a minute is 5 attempts, not 5 sleeps — see `pollContainerUntilFinished`. */
export const POLL_MAX_ATTEMPTS = 5;

/**
 * Total attempts at CONTAINER CREATION (not polling, not publish) when Meta
 * returns error 2207052. 1 initial attempt + 3 retries. Bounded rather than
 * unbounded, per the task's "bounded attempts" requirement.
 */
export const CONTAINER_CREATE_MAX_ATTEMPTS = 4;

/** Base delay for the container-creation retry backoff; doubles each attempt. */
export const CONTAINER_CREATE_RETRY_BASE_DELAY_MS = 30_000;

// ---------------------------------------------------------------------------
// Meta Graph API error codes with special handling — see this file's header.
// ---------------------------------------------------------------------------

/** Transient media-fetch failure during container creation. Retried with backoff. */
export const MEDIA_FETCH_ERROR_CODE = 2207052;

/** Meta's rate-limit code. Never retried here — surfaced as a give-up-for-this-run error. */
export const RATE_LIMIT_ERROR_CODE = 4;

/**
 * Raised for any Meta Graph API error response (`body.error`). `code` and
 * `errorSubcode` are Meta's own fields, carried through so a caller can
 * branch on them (as this module does for `MEDIA_FETCH_ERROR_CODE` and
 * `RATE_LIMIT_ERROR_CODE`) without re-parsing the message string.
 */
export class InstagramApiError extends Error {
	readonly code?: number;
	readonly errorSubcode?: number;
	readonly fbtraceId?: string;

	constructor(message: string, options: { code?: number; errorSubcode?: number; fbtraceId?: string } = {}) {
		super(message);
		this.name = 'InstagramApiError';
		this.code = options.code;
		this.errorSubcode = options.errorSubcode;
		this.fbtraceId = options.fbtraceId;
	}
}

/**
 * Strips `access_token` from a URL before it is allowed anywhere near a log
 * line or thrown error. Meta puts the token in the query string on every
 * request this module makes, so any code path that wants to mention "the
 * URL it called" in an error message MUST go through this first.
 */
function redactUrl(url: URL | string): string {
	const parsed = typeof url === 'string' ? new URL(url) : new URL(url.toString());
	if (parsed.searchParams.has('access_token')) {
		parsed.searchParams.set('access_token', 'REDACTED');
	}
	return parsed.toString();
}

function graphApiBase(config: InstagramConfig): string {
	return config.graphApiBaseUrl ?? DEFAULT_GRAPH_API_BASE_URL;
}

/** Builds a Meta Graph API error from a `body.error` object, giving `RATE_LIMIT_ERROR_CODE` a distinct, clear message. */
function instagramApiErrorFrom(error: {
	message?: string;
	code?: number;
	error_subcode?: number;
	fbtrace_id?: string;
}): InstagramApiError {
	const { code, error_subcode: errorSubcode, fbtrace_id: fbtraceId } = error;
	const metaMessage = error.message ?? 'no message provided';

	if (code === RATE_LIMIT_ERROR_CODE) {
		return new InstagramApiError(
			`Instagram rate limit hit (error code ${RATE_LIMIT_ERROR_CODE}): ${metaMessage}. Giving up for this ` +
				'run rather than retrying — see the plan Constraint on the "4800 x Number of Impressions" per-24h ' +
				'limit, which computes to near zero on a brand-new account.',
			{ code, errorSubcode, fbtraceId }
		);
	}

	return new InstagramApiError(
		`Instagram Graph API error${code !== undefined ? ` (code ${code})` : ''}: ${metaMessage}`,
		{ code, errorSubcode, fbtraceId }
	);
}

/** Calls the Graph API and returns the parsed JSON body, throwing `InstagramApiError` on a `body.error`. */
async function callGraphApi(url: URL, method: 'GET' | 'POST', fetchFn: FetchFn): Promise<Record<string, unknown>> {
	const response = await fetchFn(url.toString(), { method });

	let body: Record<string, unknown>;
	try {
		body = (await response.json()) as Record<string, unknown>;
	} catch {
		throw new Error(`Instagram Graph API response was not valid JSON (HTTP ${response.status}) at ${redactUrl(url)}.`);
	}

	const error = body?.error as { message?: string; code?: number; error_subcode?: number; fbtrace_id?: string } | undefined;
	if (error) {
		throw instagramApiErrorFrom(error);
	}
	if (!response.ok) {
		throw new Error(`Instagram Graph API request failed with HTTP ${response.status} at ${redactUrl(url)}.`);
	}

	return body;
}

// ---------------------------------------------------------------------------
// Step 1 — create container
// ---------------------------------------------------------------------------

export interface CreateContainerParams {
	config: InstagramConfig;
	/** The public GCS URL from `storage.ts`'s `publicUrlFor` — the asset Meta will fetch. */
	mediaUrl: string;
	caption: string;
	mediaKind: MediaKind;
	fetchFn: FetchFn;
}

/**
 * POSTs to `/{ig-user-id}/media` with `video_url`+`media_type: 'REELS'` for
 * a Reel, or `image_url` for a feed still, plus `caption`. Returns the new
 * container's id. A single attempt — see `createContainerWithRetry` for the
 * 2207052 retry wrapper this is meant to be called through in practice.
 */
export async function createContainer(params: CreateContainerParams): Promise<string> {
	const { config, mediaUrl, caption, mediaKind, fetchFn } = params;

	const url = new URL(`${graphApiBase(config)}/${config.igUserId}/media`);
	if (mediaKind === 'reel') {
		url.searchParams.set('video_url', mediaUrl);
		url.searchParams.set('media_type', 'REELS');
	} else {
		url.searchParams.set('image_url', mediaUrl);
	}
	url.searchParams.set('caption', caption);
	url.searchParams.set('access_token', config.accessToken);

	const body = await callGraphApi(url, 'POST', fetchFn);
	if (typeof body.id !== 'string') {
		throw new Error('Instagram container creation response did not include a string "id" field.');
	}
	return body.id;
}

export interface CreateContainerWithRetryParams extends CreateContainerParams {
	sleep: SleepFn;
}

/**
 * Wraps `createContainer` with the plan's error-2207052 retry: "retry
 * container creation with backoff, bounded attempts." Any other error
 * (including `RATE_LIMIT_ERROR_CODE`) is NOT retried and propagates on the
 * first attempt — see this file's header for why rate limiting must not be
 * retry-stormed.
 */
export async function createContainerWithRetry(params: CreateContainerWithRetryParams): Promise<string> {
	const { sleep, ...createParams } = params;

	for (let attempt = 1; attempt <= CONTAINER_CREATE_MAX_ATTEMPTS; attempt++) {
		try {
			return await createContainer(createParams);
		} catch (error) {
			const isRetryableMediaFetchFailure = error instanceof InstagramApiError && error.code === MEDIA_FETCH_ERROR_CODE;
			if (!isRetryableMediaFetchFailure || attempt >= CONTAINER_CREATE_MAX_ATTEMPTS) {
				throw error;
			}
			await sleep(CONTAINER_CREATE_RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
		}
	}

	// Unreachable: the loop above always either returns or throws.
	throw new Error('Instagram container creation retry loop exited without returning or throwing.');
}

// ---------------------------------------------------------------------------
// Step 2 — poll status_code
// ---------------------------------------------------------------------------

export interface PollContainerParams {
	config: InstagramConfig;
	containerId: string;
	fetchFn: FetchFn;
	sleep: SleepFn;
}

/**
 * Polls `/{container-id}?fields=status_code` once a minute, per the plan
 * Constraint, up to `POLL_MAX_ATTEMPTS` times ("max 5 minutes"). Resolves
 * once `status_code` is `FINISHED`. Throws — surfacing Meta's own
 * `status_msg` when present — on `ERROR` or `EXPIRED`, and throws a
 * distinct timeout error if the container never reaches a terminal state
 * within the bound, rather than polling forever.
 */
export async function pollContainerUntilFinished(params: PollContainerParams): Promise<void> {
	const { config, containerId, fetchFn, sleep } = params;

	const url = new URL(`${graphApiBase(config)}/${containerId}`);
	url.searchParams.set('fields', 'status_code');
	url.searchParams.set('access_token', config.accessToken);

	for (let attempt = 1; attempt <= POLL_MAX_ATTEMPTS; attempt++) {
		const body = await callGraphApi(url, 'GET', fetchFn);
		const statusCode = body.status_code;

		if (statusCode === 'FINISHED') {
			return;
		}
		if (statusCode === 'ERROR' || statusCode === 'EXPIRED') {
			const statusMsg = typeof body.status_msg === 'string' ? body.status_msg : undefined;
			throw new Error(
				`Instagram media container ${containerId} entered status "${String(statusCode)}"` +
					(statusMsg ? `: ${statusMsg}` : '.')
			);
		}

		if (attempt === POLL_MAX_ATTEMPTS) {
			throw new Error(
				`Instagram media container ${containerId} did not reach FINISHED after ${POLL_MAX_ATTEMPTS} polls ` +
					`(${(POLL_MAX_ATTEMPTS * POLL_INTERVAL_MS) / 60_000} minute(s) at ${POLL_INTERVAL_MS / 60_000} ` +
					`minute intervals); last status_code was "${String(statusCode)}".`
			);
		}

		await sleep(POLL_INTERVAL_MS);
	}
}

// ---------------------------------------------------------------------------
// Step 3 — publish
// ---------------------------------------------------------------------------

export interface PublishContainerParams {
	config: InstagramConfig;
	containerId: string;
	fetchFn: FetchFn;
}

/** POSTs to `/{ig-user-id}/media_publish` with `creation_id`. Returns the published media's id. */
export async function publishContainer(params: PublishContainerParams): Promise<string> {
	const { config, containerId, fetchFn } = params;

	const url = new URL(`${graphApiBase(config)}/${config.igUserId}/media_publish`);
	url.searchParams.set('creation_id', containerId);
	url.searchParams.set('access_token', config.accessToken);

	const body = await callGraphApi(url, 'POST', fetchFn);
	if (typeof body.id !== 'string') {
		throw new Error('Instagram publish response did not include a string "id" field.');
	}
	return body.id;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

export interface PublishToInstagramOptions {
	config: InstagramConfig;
	/** The public GCS URL from `storage.ts`'s `publicUrlFor`. */
	mediaUrl: string;
	caption: string;
	mediaKind: MediaKind;
	/** Defaults to the real global `fetch`. Override in tests to avoid any real network call. */
	fetchFn?: FetchFn;
	/** Defaults to a real timer (`realSleep`). Override in tests so the poll loop runs instantly. */
	sleep?: SleepFn;
}

export interface PublishToInstagramResult {
	containerId: string;
	/** The id of the now-published media (post/Reel), returned by `/media_publish`. */
	mediaId: string;
}

/**
 * Runs the full container -> poll -> publish flow described in this file's
 * header, end to end, for one asset. Callers needing to persist and resume
 * a container across restarts (rather than always running the whole flow
 * in one call) should use `createContainerWithRetry`, `pollContainerUntilFinished`,
 * and `publishContainer` directly instead — but MUST NOT resume against a
 * container older than 24h (see this file's header note on expiry).
 */
export async function publishToInstagram(options: PublishToInstagramOptions): Promise<PublishToInstagramResult> {
	const { config, mediaUrl, caption, mediaKind, fetchFn = globalThis.fetch, sleep = realSleep } = options;

	const containerId = await createContainerWithRetry({ config, mediaUrl, caption, mediaKind, fetchFn, sleep });
	await pollContainerUntilFinished({ config, containerId, fetchFn, sleep });
	const mediaId = await publishContainer({ config, containerId, fetchFn });

	return { containerId, mediaId };
}
