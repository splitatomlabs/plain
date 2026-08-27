/**
 * Tests for `../job.ts` (Pf39c2-social-pilot-03 T08 — the daily job).
 *
 * Every collaborator `runJob` needs (render, uploader, token store, both
 * publishers, the pending-flips store, the clock, the logger) is injected
 * via `JobDeps` — nothing here makes a network call, touches Firestore or
 * R2, needs a credential, or triggers a real Remotion render. `runJob` is
 * called directly; `main()`/`parseJobArgs`'s `--help` exit path is exercised
 * only via a real subprocess in a couple of smoke checks, mirroring
 * `cli.test.ts`'s own convention for the same reason (calling a
 * `process.exit`-invoking function in-process would kill the test worker).
 *
 * Coverage, matching this task's brief:
 *   - THE ACCEPTANCE CRITERION: a failure on one platform does not stop the
 *     other from being attempted and reported (both directions).
 *   - Every rendered asset is uploaded to R2 BEFORE either publish call
 *     starts — asserted via a recorded call-order sequence, not by
 *     inspecting the implementation's shape.
 *   - `--dry-run` performs no uploads and no posts, and still reports one
 *     outcome per platform.
 *   - `ensureFreshToken` is invoked per platform, and an expiry alert
 *     surfaces in the run log when a token is inside the 30-day window but
 *     not yet due for refresh.
 *   - No token value ever appears in a log line or an outcome's message,
 *     including on the failure path.
 */

import { describe, expect, it, vi } from 'vitest';

import { runJob, type JobArgs, type JobDeps, type JobLogger } from '../job.js';
import { createInMemoryTokenStore, type StoredToken } from '../publish/tokens.js';
import type { WeekSchedule, ScheduleSlot } from '../schedule-types.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DATE = '2026-09-01'; // PILOT_WEEK_1_START — week 1, day 1.
const NOW = '2026-08-27T00:00:00.000Z';
const DAY_MS = 24 * 60 * 60 * 1000;

function offset(iso: string, ms: number): string {
	return new Date(Date.parse(iso) + ms).toISOString();
}

const SLOT: ScheduleSlot = {
	day: 1,
	card_id: 'meditations-09-025',
	book_slug: 'meditations',
	author_slug: 'marcus-aurelius',
	content: { format: 'wall', original_excerpt: 'The original excerpt.', landing_line: 'Every action has an end.' }
};

const SCHEDULE: WeekSchedule = { week: 1, slots: [SLOT] };

const ARGS: JobArgs = {
	date: DATE,
	outDir: '/fake/out',
	scheduleDir: '/fake/schedule-dir',
	pendingFlipsPath: '/fake/pending-youtube-flips.json',
	pendingFlipsStore: 'firestore',
	dryRun: false
};

function farFromExpiry(platform: 'instagram' | 'youtube'): StoredToken {
	return {
		platform,
		value: `super-secret-${platform}-token-do-not-log`,
		obtainedAt: '2026-01-01T00:00:00.000Z',
		expiresAt: offset(NOW, 120 * DAY_MS)
	};
}

interface RecordingLogger extends JobLogger {
	infoLines: string[];
	warnLines: string[];
	errorLines: string[];
}

function createRecordingLogger(): RecordingLogger {
	const infoLines: string[] = [];
	const warnLines: string[] = [];
	const errorLines: string[] = [];
	return {
		infoLines,
		warnLines,
		errorLines,
		info: (line) => infoLines.push(line),
		warn: (line) => warnLines.push(line),
		error: (line) => errorLines.push(line)
	};
}

/**
 * Builds a full `JobDeps` with every collaborator mocked to a harmless,
 * successful default. `calls` (shared, ordered) records each side-effecting
 * call by name — the ordering test reads this back.
 */
function makeDeps(overrides: Partial<JobDeps> = {}, calls: string[] = []): JobDeps {
	const tokenStore = createInMemoryTokenStore([farFromExpiry('instagram'), farFromExpiry('youtube')]);

	return {
		loadSchedule: vi.fn(async () => SCHEDULE),
		render: vi.fn(async () => {
			calls.push('render');
		}),
		uploadAsset: vi.fn(async ({ key }) => {
			calls.push(`upload:${key}`);
			return `https://media.thinkplain.ai/${key}`;
		}),
		tokenStore,
		refresh: {
			instagram: vi.fn(async () => farFromExpiry('instagram')),
			youtube: vi.fn(async () => farFromExpiry('youtube'))
		},
		loadInstagramAccountConfig: vi.fn(() => ({ igUserId: 'ig-account-1' })),
		publishInstagram: vi.fn(async () => {
			calls.push('instagram:publish');
			return { containerId: 'container-1', mediaId: 'media-1' };
		}),
		publishYouTube: vi.fn(async () => {
			calls.push('youtube:publish');
			return { videoId: 'yt-video-1' };
		}),
		pendingFlips: {
			read: vi.fn(async () => []),
			write: vi.fn(async () => {})
		},
		now: NOW,
		logger: createRecordingLogger(),
		...overrides
	};
}

// ---------------------------------------------------------------------------
// Platform isolation — the acceptance criterion.
// ---------------------------------------------------------------------------

describe('platform isolation — a failure on one platform never stops the other', () => {
	it('an Instagram failure does not prevent YouTube from being attempted and reported', async () => {
		const calls: string[] = [];
		const deps = makeDeps({}, calls);
		deps.publishInstagram = vi.fn(async () => {
			calls.push('instagram:publish');
			throw new Error('Instagram Graph API error: rate limited');
		});

		const result = await runJob(ARGS, deps);

		expect(deps.publishYouTube).toHaveBeenCalledTimes(1);
		expect(calls).toContain('youtube:publish');

		const instagram = result.outcomes.find((o) => o.platform === 'instagram');
		const youtube = result.outcomes.find((o) => o.platform === 'youtube');
		expect(instagram?.status).toBe('failed');
		expect(instagram?.message).toContain('rate limited');
		expect(youtube?.status).toBe('ok');
		expect(result.exitCode).toBe(1); // something failed...
		expect(result.outcomes).toHaveLength(2); // ...but only after BOTH were attempted.
	});

	it('a YouTube failure does not prevent Instagram from being attempted and reported', async () => {
		const calls: string[] = [];
		const deps = makeDeps({}, calls);
		deps.publishYouTube = vi.fn(async () => {
			calls.push('youtube:publish');
			throw new Error('YouTube API returned HTTP 500');
		});

		const result = await runJob(ARGS, deps);

		expect(deps.publishInstagram).toHaveBeenCalledTimes(1);
		expect(calls).toContain('instagram:publish');

		const instagram = result.outcomes.find((o) => o.platform === 'instagram');
		const youtube = result.outcomes.find((o) => o.platform === 'youtube');
		expect(youtube?.status).toBe('failed');
		expect(youtube?.message).toContain('HTTP 500');
		expect(instagram?.status).toBe('ok');
		expect(result.exitCode).toBe(1);
	});

	it('both platforms succeeding reports exit code 0', async () => {
		const deps = makeDeps();
		const result = await runJob(ARGS, deps);
		expect(result.outcomes.every((o) => o.status === 'ok')).toBe(true);
		expect(result.exitCode).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Upload-before-publish ordering — the plan's Decision.
// ---------------------------------------------------------------------------

describe('assets are uploaded to R2 before any post is attempted', () => {
	it('both uploads complete before either publish call starts', async () => {
		const calls: string[] = [];
		const deps = makeDeps({}, calls);

		await runJob(ARGS, deps);

		const uploadIndices = calls.map((c, i) => (c.startsWith('upload:') ? i : -1)).filter((i) => i >= 0);
		const publishIndices = calls
			.map((c, i) => (c.endsWith(':publish') ? i : -1))
			.filter((i) => i >= 0);

		expect(uploadIndices).toHaveLength(2); // video + feed still.
		expect(publishIndices).toHaveLength(2); // instagram + youtube.
		expect(Math.max(...uploadIndices)).toBeLessThan(Math.min(...publishIndices));
	});

	it('still uploads both assets even when a publish call is going to fail', async () => {
		const calls: string[] = [];
		const deps = makeDeps({}, calls);
		deps.publishInstagram = vi.fn(async () => {
			throw new Error('boom');
		});

		await runJob(ARGS, deps);

		const uploadCalls = calls.filter((c) => c.startsWith('upload:'));
		expect(uploadCalls).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// M7 regression (code review): an R2 failure is a per-platform precondition,
// not a whole-run one — Instagram needs the public R2 URL, YouTube does not.
// ---------------------------------------------------------------------------

describe('an R2 upload failure only fails Instagram, never YouTube', () => {
	it('uploadAsset rejecting fails Instagram with a clear reason but still attempts and reports YouTube ok, and the run exit status reflects the partial failure', async () => {
		const deps = makeDeps();
		deps.uploadAsset = vi.fn(async () => {
			throw new Error('R2 outage: connection refused');
		});

		const result = await runJob(ARGS, deps);

		const instagram = result.outcomes.find((o) => o.platform === 'instagram');
		const youtube = result.outcomes.find((o) => o.platform === 'youtube');

		expect(instagram?.status).toBe('failed');
		expect(instagram?.message).toContain('R2 outage: connection refused');
		expect(deps.publishInstagram).not.toHaveBeenCalled(); // never attempted without a video URL.

		expect(deps.publishYouTube).toHaveBeenCalledTimes(1); // attempted from the local file regardless.
		expect(youtube?.status).toBe('ok');

		expect(result.exitCode).toBe(1); // something failed...
		expect(result.outcomes).toHaveLength(2); // ...but only after BOTH were attempted.
	});
});

// ---------------------------------------------------------------------------
// --dry-run
// ---------------------------------------------------------------------------

describe('dry run', () => {
	it('performs no uploads and no posts, and still reports one outcome per platform', async () => {
		const calls: string[] = [];
		const deps = makeDeps({}, calls);
		const getSpy = vi.spyOn(deps.tokenStore, 'get');

		const result = await runJob({ ...ARGS, dryRun: true }, deps);

		expect(deps.render).toHaveBeenCalledTimes(1); // rendering itself still happens.
		expect(deps.uploadAsset).not.toHaveBeenCalled();
		expect(deps.publishInstagram).not.toHaveBeenCalled();
		expect(deps.publishYouTube).not.toHaveBeenCalled();
		expect(deps.pendingFlips.read).not.toHaveBeenCalled();
		expect(deps.pendingFlips.write).not.toHaveBeenCalled();
		expect(getSpy).not.toHaveBeenCalled(); // no token operations either.

		expect(result.outcomes).toHaveLength(2);
		expect(result.outcomes.every((o) => o.status === 'dry-run')).toBe(true);
		expect(result.outcomes.map((o) => o.platform).sort()).toEqual(['instagram', 'youtube']);
		expect(result.exitCode).toBe(0);
	});

	it('logs what each platform would do', async () => {
		const deps = makeDeps();
		await runJob({ ...ARGS, dryRun: true }, deps);
		const logger = deps.logger as RecordingLogger;
		const allInfo = logger.infoLines.join('\n');
		expect(allInfo).toMatch(/\[instagram] DRY-RUN/);
		expect(allInfo).toMatch(/\[youtube] DRY-RUN/);
	});
});

// ---------------------------------------------------------------------------
// Token refresh + expiry alerts
// ---------------------------------------------------------------------------

describe('token handling', () => {
	it('calls ensureFreshToken (via tokenStore.get) for both platforms before publishing', async () => {
		const deps = makeDeps();
		const getSpy = vi.spyOn(deps.tokenStore, 'get');

		await runJob(ARGS, deps);

		expect(getSpy).toHaveBeenCalledWith('instagram');
		expect(getSpy).toHaveBeenCalledWith('youtube');
	});

	it('refreshes and persists a token that is near expiry and old enough', async () => {
		const nearExpiry: StoredToken = {
			platform: 'instagram',
			value: 'old-instagram-secret',
			obtainedAt: '2026-01-01T00:00:00.000Z', // long before NOW — well past the 24h floor.
			expiresAt: offset(NOW, 2 * DAY_MS) // inside the 7-day refresh window.
		};
		const tokenStore = createInMemoryTokenStore([nearExpiry, farFromExpiry('youtube')]);
		const refreshedToken = { ...nearExpiry, value: 'refreshed-instagram-secret', obtainedAt: NOW };
		const deps = makeDeps({
			tokenStore,
			refresh: {
				instagram: vi.fn(async () => refreshedToken),
				youtube: vi.fn(async () => farFromExpiry('youtube'))
			}
		});

		await runJob(ARGS, deps);

		expect(deps.refresh.instagram).toHaveBeenCalledTimes(1);
		await expect(tokenStore.get('instagram')).resolves.toEqual(refreshedToken);
	});

	it('surfaces an expiry alert in the run log when a token is inside the 30-day window but not yet due for refresh', async () => {
		const soonToken: StoredToken = {
			platform: 'instagram',
			value: 'ig-soon-secret',
			obtainedAt: '2026-01-01T00:00:00.000Z',
			expiresAt: offset(NOW, 10 * DAY_MS) // inside 30d alert window, outside the 7d refresh window.
		};
		const tokenStore = createInMemoryTokenStore([soonToken, farFromExpiry('youtube')]);
		const deps = makeDeps({ tokenStore });

		await runJob(ARGS, deps);

		expect(deps.refresh.instagram).not.toHaveBeenCalled(); // not due for refresh yet...
		const logger = deps.logger as RecordingLogger;
		const warnLine = logger.warnLines.find((l) => l.includes('instagram') && l.includes('TOKEN EXPIRY ALERT'));
		expect(warnLine).toBeDefined(); // ...but the alert still fires.
	});
});

// ---------------------------------------------------------------------------
// Never log a token.
// ---------------------------------------------------------------------------

describe('never logs a token value', () => {
	it('does not leak a token in any log line or outcome message, including on the failure path', async () => {
		const secretIg = 'super-secret-instagram-token-do-not-log';
		const secretYt = 'super-secret-youtube-token-do-not-log';
		const tokenStore = createInMemoryTokenStore([
			{ platform: 'instagram', value: secretIg, obtainedAt: '2026-01-01T00:00:00.000Z', expiresAt: offset(NOW, 120 * DAY_MS) },
			{ platform: 'youtube', value: secretYt, obtainedAt: '2026-01-01T00:00:00.000Z', expiresAt: offset(NOW, 120 * DAY_MS) }
		]);
		const deps = makeDeps({
			tokenStore,
			publishInstagram: vi.fn(async () => {
				throw new Error('Instagram publish failed');
			}),
			publishYouTube: vi.fn(async () => {
				throw new Error('YouTube publish failed');
			})
		});

		const result = await runJob(ARGS, deps);

		const logger = deps.logger as RecordingLogger;
		const everyLine = [...logger.infoLines, ...logger.warnLines, ...logger.errorLines].join('\n');
		expect(everyLine).not.toContain(secretIg);
		expect(everyLine).not.toContain(secretYt);
		for (const outcome of result.outcomes) {
			expect(outcome.message).not.toContain(secretIg);
			expect(outcome.message).not.toContain(secretYt);
		}
	});
});

// ---------------------------------------------------------------------------
// Pending YouTube flips
// ---------------------------------------------------------------------------

describe('pending YouTube flips', () => {
	it('records the uploaded video id for the week pending-flip list on a successful upload', async () => {
		const deps = makeDeps();
		await runJob(ARGS, deps);

		expect(deps.pendingFlips.write).toHaveBeenCalledTimes(1);
		const written = (deps.pendingFlips.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(written).toEqual([{ date: DATE, cardId: SLOT.card_id, videoId: 'yt-video-1' }]);
	});

	it('does not record a pending flip when the YouTube upload itself fails', async () => {
		const deps = makeDeps();
		deps.publishYouTube = vi.fn(async () => {
			throw new Error('upload failed');
		});

		await runJob(ARGS, deps);

		expect(deps.pendingFlips.write).not.toHaveBeenCalled();
	});

	// M4 regression (code review): the flips store used to be a plain JSON
	// file on Cloud Run's throwaway container filesystem, so every real run
	// effectively started from an empty read — the durable fix is only
	// proven if a run whose store ALREADY holds a previous day's entry
	// preserves it, rather than a write that happens to look right against
	// an empty starting list.
	it('writes the MERGED list — a previously-stored day survives alongside today\'s new entry (proves read-modify-write against durable state)', async () => {
		const priorFlip = { date: '2026-08-25', cardId: 'meditations-08-020', videoId: 'yt-video-0' };
		const deps = makeDeps({
			pendingFlips: {
				read: vi.fn(async () => [priorFlip]),
				write: vi.fn(async () => {})
			}
		});

		await runJob(ARGS, deps);

		expect(deps.pendingFlips.write).toHaveBeenCalledTimes(1);
		const written = (deps.pendingFlips.write as ReturnType<typeof vi.fn>).mock.calls[0][0];
		expect(written).toEqual([priorFlip, { date: DATE, cardId: SLOT.card_id, videoId: 'yt-video-1' }]);
	});

	it('reports YouTube as "partial" (not "ok") and fails the run\'s exit code when recording the flip fails, even though the upload itself succeeded', async () => {
		const deps = makeDeps();
		deps.pendingFlips = {
			read: vi.fn(async () => []),
			write: vi.fn(async () => {
				throw new Error('Firestore write failed: deadline exceeded');
			})
		};

		const result = await runJob(ARGS, deps);

		const youtube = result.outcomes.find((o) => o.platform === 'youtube');
		expect(youtube?.status).toBe('partial');
		expect(youtube?.message).toContain('yt-video-1');
		expect(result.exitCode).toBe(1); // a video whose id was never durably recorded is not a clean success.
	});
});
