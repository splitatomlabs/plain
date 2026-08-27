/**
 * *** SPIKE — NOT A COLLECTOR. RUN ONCE BY HAND, THEN THROW THE RESULT AWAY
 * OR PROMOTE IT. *** (Pf39c2-social-pilot-03 T13)
 *
 * Task wording, verbatim: "Settle TikTok collection with a SPIKE before
 * building it — attempt the Display API `video.list` against the pilot
 * account with an unaudited app and record what it actually returns.
 * Automate it if it works; fall back to hand entry in the same schema
 * during the weekly session if it does not. ... Timebox this."
 *
 * WHAT THIS SCRIPT DOES: makes exactly ONE call — TikTok's Display API
 * `POST /v2/video/list/` (scope `video.list`) — against whatever access
 * token the operator supplies, prints the raw response (with the token
 * itself redacted from anything that could echo it back), and prints a
 * plain verdict: does the response actually carry per-video view/like/
 * comment/share counts, or not.
 *
 * THIS SESSION HAS NO TIKTOK ACCOUNT AND NO APP CREDENTIALS. Nobody has run
 * this script yet — see `docs/SOCIAL_PILOT.md`'s T13 section, which states
 * plainly that the finding is "undetermined, fallback in force" until a
 * human with real credentials runs it and records the result there. This
 * file's job is only to make that run cheap and its output legible, not to
 * claim an answer this session cannot possibly have obtained.
 *
 * THE TWO CANDIDATE READ PATHS the plan's Constraint names (only the first
 * is what this script attempts — see `docs/SOCIAL_PILOT.md` for both):
 *   1. Display API `video.list` (this script) — documented to return
 *      per-video view/like/comment/share counts. Reachable with an
 *      UNAUDITED app in TikTok's Sandbox mode, restricted to target users
 *      the developer explicitly added — exactly the pilot account, no App
 *      Review needed. This is the ONLY path worth spiking first: if it
 *      works, the automated path is viable outright; if it does not, the
 *      Business Account API (needs a Business account AND app approval —
 *      strictly more setup) would not be a lighter-weight fallback, hand
 *      entry already is.
 *   2. Business Account API — not attempted by this script at all. Needs a
 *      TikTok Business account and TikTok's own app approval process; out
 *      of this timeboxed spike's scope by design, not an oversight.
 *
 * DECISION RULE this script's verdict applies (see `docs/SOCIAL_PILOT.md`
 * for the same rule, stated once, not duplicated with drift risk): if the
 * response's video objects carry usable `view_count`/`like_count`/
 * `comment_count`/`share_count` fields, the automated path is viable —
 * build a real collector next, following `instagram.ts`'s/`youtube.ts`'s
 * shape (list -> filter to the 30-day window -> map to `MetricsRow` with
 * `platform: 'tiktok'`). If the call fails outright (unaudited app/scope
 * not granted/no Sandbox target user configured) or the fields are missing,
 * empty, or clearly placeholder values, the fallback in
 * `tiktok-manual.ts` (T13's OTHER deliverable, already fully built) is what
 * ships — no further TikTok automation work, per this task's own Timebox
 * instruction.
 *
 * RETENTION STAYS MANUAL EITHER WAY — this script does not attempt to
 * assess retention/traffic-source data at all, on either candidate path.
 * The plan's Constraint is explicit that those are in-app only on TikTok
 * regardless of which read path wins this spike.
 *
 * NEVER LOGS A TOKEN: the access token is sent only as an
 * `Authorization: Bearer` header (never a URL query parameter, so there is
 * no URL to redact), and `redactToken` scrubs any literal occurrence of it
 * out of every string this script prints, as defense in depth against a
 * future edit that logs a raw header object by mistake.
 *
 * `--help` prints usage and exits WITHOUT requiring a token or making any
 * network call — this is the one path this task's own Verify step can
 * actually exercise without live TikTok credentials.
 *
 * DO NOT run this against a live account from an automated test or CI —
 * this is a manual, by-hand spike the operator runs once with real
 * credentials, exactly as the task specifies.
 */

import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';

/** A `fetch`-compatible function. Injectable so `deriveVerdict`'s pure logic (below) is unit-testable without a real network call — this script itself is still meant to be run by hand, not from a test. */
export type FetchFn = typeof globalThis.fetch;

export const DEFAULT_DISPLAY_API_BASE_URL = 'https://open.tiktokapis.com/v2';

/** The four fields the plan's Constraint says `video.list` returns, and this spike exists to confirm or refute. */
const EXPECTED_ENGAGEMENT_FIELDS = ['view_count', 'like_count', 'comment_count', 'share_count'] as const;

const REQUESTED_FIELDS = ['id', 'create_time', 'title', ...EXPECTED_ENGAGEMENT_FIELDS] as const;

/** Scrubs every literal occurrence of `token` out of `text` — defense in depth alongside never putting the token in a URL. */
export function redactToken(text: string, token: string): string {
	if (!token) return text;
	return text.split(token).join('REDACTED');
}

export interface SpikeVerdict {
	/** Whether the HTTP call itself succeeded (2xx). */
	requestOk: boolean;
	/** How many video items came back, if any. */
	videoCount: number;
	/** Which of `EXPECTED_ENGAGEMENT_FIELDS` were present as a NUMBER on every returned video (only meaningful when `videoCount > 0`). */
	fieldsPresentOnEveryVideo: string[];
	/** True only when the request succeeded, at least one video came back, and every expected field was present on every video. */
	automatedPathViable: boolean;
	/** One human-readable line summarizing the verdict — printed verbatim by `main()`. */
	summary: string;
}

/**
 * Pure verdict logic, factored out of `main()` so it is unit-testable
 * without a real network call — this is the one piece of this spike script
 * worth a real test, since it encodes the actual decision rule.
 */
export function deriveVerdict(requestOk: boolean, body: unknown): SpikeVerdict {
	if (!requestOk) {
		return {
			requestOk: false,
			videoCount: 0,
			fieldsPresentOnEveryVideo: [],
			automatedPathViable: false,
			summary:
				'VERDICT: the video.list request failed outright (see the raw response above — likely the app/scope is ' +
				"not authorized for this account, or no Sandbox target user is configured). The Display API path is NOT " +
				'viable as tested. Use the documented fallback: social/src/metrics/tiktok-manual.ts.'
		};
	}

	const videos = extractVideos(body);
	if (videos.length === 0) {
		return {
			requestOk: true,
			videoCount: 0,
			fieldsPresentOnEveryVideo: [],
			automatedPathViable: false,
			summary:
				'VERDICT: the request succeeded but returned zero videos — nothing to confirm field availability against. ' +
				'Post at least one video to the pilot account and re-run this spike before drawing a conclusion.'
		};
	}

	const fieldsPresentOnEveryVideo = EXPECTED_ENGAGEMENT_FIELDS.filter((field) =>
		videos.every((video) => typeof video[field] === 'number')
	);
	const automatedPathViable = fieldsPresentOnEveryVideo.length === EXPECTED_ENGAGEMENT_FIELDS.length;

	const summary = automatedPathViable
		? `VERDICT: video.list returned all of ${EXPECTED_ENGAGEMENT_FIELDS.join(', ')} as numbers on every video. ` +
			'The automated path IS VIABLE — build a real collector following instagram.ts/youtube.ts\'s shape ' +
			"(list -> filter to the 30-day window -> map to a MetricsRow with platform: 'tiktok'). Record this in " +
			'docs/SOCIAL_PILOT.md\'s T13 section and retire the manual fallback\'s use for engagement counts (retention ' +
			'still stays manual regardless).'
		: `VERDICT: video.list responded, but only [${fieldsPresentOnEveryVideo.join(', ') || 'none'}] of ` +
			`[${EXPECTED_ENGAGEMENT_FIELDS.join(', ')}] came back as numbers on every video. The automated path is NOT ` +
			'fully viable as tested. Use the documented fallback: social/src/metrics/tiktok-manual.ts.';

	return { requestOk: true, videoCount: videos.length, fieldsPresentOnEveryVideo: [...fieldsPresentOnEveryVideo], automatedPathViable, summary };
}

function extractVideos(body: unknown): Array<Record<string, unknown>> {
	if (body === null || typeof body !== 'object') return [];
	const data = (body as Record<string, unknown>).data;
	if (data === null || typeof data !== 'object') return [];
	const videos = (data as Record<string, unknown>).videos;
	return Array.isArray(videos) ? (videos as Array<Record<string, unknown>>) : [];
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/metrics/tiktok-spike.ts --access-token <token> [options]

*** SPIKE — run once by hand with real TikTok credentials to settle whether
the Display API video.list path can be automated. See this file's header
and plans/Pf39c2-social-pilot-03.md T13. Do NOT wire this into any
scheduled job. ***

Makes ONE call to POST ${DEFAULT_DISPLAY_API_BASE_URL}/video/list/ with the
supplied access token (scope: video.list), prints the raw response with the
token redacted, and prints a verdict on whether per-video view/like/comment/
share counts came back usably.

Required (unless --help):
  --access-token <token>   An OAuth2 access token with the video.list scope,
                            authorized for the pilot TikTok account. Can
                            also be supplied via the TIKTOK_ACCESS_TOKEN
                            environment variable.

Optional:
  --base-url <url>         Overrides the Display API base URL (for testing
                            against a fixture server). Defaults to
                            ${DEFAULT_DISPLAY_API_BASE_URL}.
  --max-count <n>          Number of videos to request. Defaults to 20.
  --help                   Show this help and exit — no token or network
                            call required.`);
}

async function runSpike(accessToken: string, baseUrl: string, maxCount: number, fetchFn: FetchFn): Promise<void> {
	const url = `${baseUrl}/video/list/?fields=${REQUESTED_FIELDS.join(',')}`;

	console.log(`[tiktok-spike] POST ${redactToken(url, accessToken)}`);
	console.log(`[tiktok-spike] requesting fields: ${REQUESTED_FIELDS.join(', ')}`);

	const response = await fetchFn(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${accessToken}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ max_count: maxCount })
	});

	let body: unknown;
	let parseError: string | undefined;
	try {
		body = await response.json();
	} catch (error) {
		parseError = error instanceof Error ? error.message : String(error);
	}

	console.log(`[tiktok-spike] HTTP ${response.status}${response.ok ? ' (ok)' : ' (NOT ok)'}`);
	if (parseError !== undefined) {
		console.log(`[tiktok-spike] response body was not valid JSON: ${redactToken(parseError, accessToken)}`);
	} else {
		console.log('[tiktok-spike] raw response body (token redacted if echoed anywhere):');
		console.log(redactToken(JSON.stringify(body, null, 2), accessToken));
	}

	const verdict = deriveVerdict(response.ok && parseError === undefined, body);
	console.log('');
	console.log(verdict.summary);
	console.log(
		`[tiktok-spike] videoCount=${verdict.videoCount} fieldsPresentOnEveryVideo=[${verdict.fieldsPresentOnEveryVideo.join(', ')}] automatedPathViable=${verdict.automatedPathViable}`
	);
	console.log('');
	console.log('Record this result in docs/SOCIAL_PILOT.md\'s T13 section — do not leave the finding as "undetermined" once this has actually been run.');
}

async function main(): Promise<void> {
	const { values } = parseArgs({
		args: process.argv.slice(2),
		options: {
			'access-token': { type: 'string' },
			'base-url': { type: 'string' },
			'max-count': { type: 'string' },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		return;
	}

	const accessToken = values['access-token'] ?? process.env.TIKTOK_ACCESS_TOKEN;
	if (!accessToken) {
		throw new Error('Missing an access token — pass --access-token or set the TIKTOK_ACCESS_TOKEN environment variable.');
	}

	const baseUrl = values['base-url'] ?? DEFAULT_DISPLAY_API_BASE_URL;
	const maxCount = values['max-count'] !== undefined ? Number(values['max-count']) : 20;
	if (Number.isNaN(maxCount) || maxCount <= 0) {
		throw new Error(`--max-count must be a positive number — got "${values['max-count']}".`);
	}

	await runSpike(accessToken, baseUrl, maxCount, globalThis.fetch);
}

// Only auto-run `main()` when this file is the actual process entry point —
// same guard as every other CLI in this workspace (`collect.ts`,
// `tiktok-manual.ts`): importing this module for its exports (as
// `__tests__/tiktok-spike.test.ts` does, to test `deriveVerdict`/
// `redactToken` in isolation) must never parse `process.argv` or make a
// real network call.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
