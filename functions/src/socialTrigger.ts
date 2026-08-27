/**
 * The Firebase Functions v2 scheduled trigger for the daily social pilot job
 * (Pf39c2-social-pilot-03 T10).
 *
 * WHY THIS FILE DOES ALMOST NOTHING — quoting the plan's Decision verbatim:
 *
 *   "Firebase `onSchedule` is a THIN TRIGGER ONLY — scheduled functions are
 *   capped at 540s. It starts a Cloud Run Job, which allows a 168-hour
 *   timeout, 32 GiB and 8 vCPU."
 *
 * `social/src/job.ts` renders a video with headless Chrome, encodes it with
 * ffmpeg, uploads to R2, and publishes to Instagram/YouTube — comfortably
 * longer than a scheduled Cloud Function's hard 540-second ceiling once cold
 * starts and API backoffs are accounted for. So this function does exactly
 * ONE thing: start an execution of the `plain-social-daily` Cloud Run Job
 * (see `social/cloud-run-job.yaml` for its resource/secret configuration)
 * and return. It must NEVER render, upload, or publish anything itself — if
 * a future change adds that kind of work here, it belongs in `social/`'s
 * Cloud Run Job instead, not in this trigger.
 *
 * THE ONE LEGITIMATE WALL-CLOCK READ IN THIS SYSTEM: everything downstream
 * of this file (`job.ts`, `pilot-config.ts`, `job-plan.ts`) is deliberately
 * driven by an explicit `--date` argument and never reads the clock for
 * scheduling decisions (see `job.ts`'s own "DETERMINISM" header section).
 * This trigger is the exception, by necessity: something has to decide what
 * "today" means so the Cloud Run Job knows which schedule slot to render and
 * post. `computeTodayInTimezone` below is that one read, and it is pinned to
 * an explicit timezone (`PILOT_TIMEZONE`) rather than whatever timezone the
 * Cloud Functions runtime happens to be in (Cloud Functions run in UTC by
 * default) — so "today" always means the same calendar day a person in the
 * pilot's target audience would call "today", regardless of where the
 * function executes.
 *
 * SCHEDULED OFF THE HOUR: `SCHEDULE_CRON` fires at 07:53 in `PILOT_TIMEZONE`,
 * not on the hour (e.g. not `0 8 * * *`). Every cron job on every tenant of
 * a platform that *does* schedule on the hour fires at once, so :00 is
 * exactly when Cloud Scheduler's own dispatch latency and downstream API
 * rate limits (Cloud Run's admin API, in this case) are worst — an
 * off-the-hour minute avoids piling into that thundering herd. The plan's
 * T10 task description calls this out explicitly ("scheduled off the hour").
 *
 * NEVER LOGS CREDENTIALS: the only credential this file touches is the
 * short-lived OAuth access token `google-auth-library` mints for calling the
 * Cloud Run Admin API, and it is used exclusively as a request header value
 * — never interpolated into a log line or a thrown error's message.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { GoogleAuth } from 'google-auth-library';

/**
 * The pilot's target-audience timezone. See the header comment above for why
 * this is the one place in the whole system allowed to read a wall clock.
 * Kept as an explicit named constant (not inferred from the Cloud Functions
 * runtime's default UTC) so changing the pilot's intended posting timezone
 * is a one-line, reviewable change here rather than an implicit dependency
 * on wherever this function happens to run.
 */
export const PILOT_TIMEZONE = 'America/New_York';

/**
 * `M H * * *` — 07:53 daily. See the header comment's "SCHEDULED OFF THE
 * HOUR" section for why the minute is not `:00`.
 */
const SCHEDULE_CRON = '53 7 * * *';

/**
 * Cloud Run region the job lives in. Chosen for the deploy runbook
 * (`social/DEPLOY.md`) as a low-cost, widely-available region; kept as one
 * named constant so the trigger and the job config file
 * (`social/cloud-run-job.yaml`) can be kept in sync by inspection.
 */
const CLOUD_RUN_REGION = 'us-central1';

/** Must match `metadata.name` in `social/cloud-run-job.yaml`. */
const CLOUD_RUN_JOB_NAME = 'plain-social-daily';

/**
 * The trigger's OWN runtime identity — deliberately NOT the project's
 * default compute service account 2nd-gen functions use otherwise, which
 * would be broader than this function needs. `social/DEPLOY.md` creates this
 * account with exactly one narrow custom-role permission: starting an
 * execution of `CLOUD_RUN_JOB_NAME` (`run.jobs.run`/`run.jobs.get`), nothing
 * else — it deliberately has no Firestore or Secret Manager access, since
 * `socialTrigger.ts` never touches either.
 *
 * `PROJECT_ID` here is a literal placeholder, matching the same placeholder
 * convention `social/cloud-run-job.yaml` uses — replace it with the real GCP
 * project id before deploying (see `social/DEPLOY.md` step 0).
 */
const TRIGGER_SERVICE_ACCOUNT = 'plain-social-trigger@PROJECT_ID.iam.gserviceaccount.com';

/**
 * Formats `now` as a `YYYY-MM-DD` calendar date IN `timeZone` — pure given
 * its two arguments, so it is unit-testable without mocking the system
 * clock. The `en-CA` locale is a well-known trick for getting
 * `Intl.DateTimeFormat` to emit ISO-shaped (`YYYY-MM-DD`) output directly.
 */
export function computeTodayInTimezone(timeZone: string, now: Date): string {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	});
	return formatter.format(now);
}

/**
 * Starts one execution of the Cloud Run Job, overriding its container args
 * to `--date <date>` so this run renders/posts the correct day's schedule
 * slot rather than whatever `CMD` the image bakes in as a default (see
 * `social/Dockerfile`'s `CMD ["--help"]`, a safe no-args default that this
 * override replaces on every real scheduled run).
 *
 * Uses the Cloud Run Admin API v2 `jobs.run` REST method directly via
 * `google-auth-library` rather than a heavier client SDK — this function
 * makes exactly one API call, so a full `@google-cloud/run` client adds
 * dependency weight for no real benefit.
 *
 * This is the one piece of this file NOT worth a unit test (per this task's
 * own instruction): it is a single outbound REST call with no branching
 * logic of its own — the interesting logic here is `computeTodayInTimezone`,
 * which IS tested (see `__tests__/socialTrigger.test.ts`).
 */
async function triggerCloudRunJob(date: string): Promise<void> {
	const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
	const projectId = await auth.getProjectId();
	const client = await auth.getClient();
	const { token } = await client.getAccessToken();
	if (!token) {
		throw new Error('Failed to obtain an access token for the Cloud Run Admin API.');
	}

	const url = `https://run.googleapis.com/v2/projects/${projectId}/locations/${CLOUD_RUN_REGION}/jobs/${CLOUD_RUN_JOB_NAME}:run`;

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`,
			'Content-Type': 'application/json',
		},
		body: JSON.stringify({
			overrides: {
				containerOverrides: [{ args: ['--date', date] }],
			},
		}),
	});

	if (!response.ok) {
		// The response body is Cloud Run execution/error metadata, never a
		// credential — safe to include verbatim for debugging.
		const body = await response.text();
		throw new Error(
			`Cloud Run Admin API returned ${response.status} ${response.statusText} starting job ` +
				`"${CLOUD_RUN_JOB_NAME}": ${body}`
		);
	}
}

/**
 * The scheduled trigger itself. `timeoutSeconds`/`memory` are generous for a
 * function that makes one REST call and returns (well inside the 540s cap
 * this whole design exists to stay under) — not tuned tighter than that
 * because there is no cost benefit to shaving a function this cheap any
 * further. `retryCount: 0` is deliberate, not an oversight: starting a Cloud
 * Run Job execution is NOT idempotent from this system's point of view — a
 * second successful `jobs.run` call for the same day would re-render and
 * re-publish the same card, duplicate-posting to Instagram/YouTube. If a
 * scheduled run fails to even start the job, that needs a human to look at
 * the logs (see `social/DEPLOY.md`'s "verify a scheduled run" section), not
 * an automatic retry that risks a duplicate post.
 */
export const socialTrigger = onSchedule(
	{
		schedule: SCHEDULE_CRON,
		timeZone: PILOT_TIMEZONE,
		region: CLOUD_RUN_REGION,
		timeoutSeconds: 60,
		memory: '256MiB',
		retryCount: 0,
		serviceAccount: TRIGGER_SERVICE_ACCOUNT,
	},
	async () => {
		// THE ONE WALL-CLOCK READ — see this file's header comment.
		const date = computeTodayInTimezone(PILOT_TIMEZONE, new Date());
		logger.info(`Starting Cloud Run Job "${CLOUD_RUN_JOB_NAME}" for ${date}.`);
		await triggerCloudRunJob(date);
		logger.info(`Cloud Run Job "${CLOUD_RUN_JOB_NAME}" started for ${date}.`);
	}
);
