/**
 * TikTok manual staging — the weekly run (Pf39c2-social-pilot-03 T07).
 *
 * Decision (plan 03): "TikTok posts via its native scheduler, manually,
 * ~20 min/week — its POSTING API is unusable here." This module does
 * everything that CAN be automated ahead of that manual session: it writes
 * the week's rendered MP4s and a captions file up to GCS's dated
 * `tiktok-staging/<weekStartDate>/` folder (`storage.ts`'s
 * `tiktokStagingKeyFor`) and returns a manifest with direct links, so the
 * human only has to open each link and paste the matching caption into
 * TikTok's app.
 *
 * ---------------------------------------------------------------------
 * TASK WORDING DISCREPANCIES (both flagged by the task brief, documented
 * here per its instructions):
 *
 * 1. "Acceptance: a run produces 14 videos" is STALE. It predates
 *    `Pf39c2-social-pilot-02a` D02, which collapsed the channel to a SINGLE
 *    Wall post per day — a week is now schedule.slots.length videos, which
 *    is 7 for every schedule this pipeline currently generates (one slot
 *    per day, 7 days), NOT 14. `stageTikTokWeek` below derives the day
 *    count from `schedule.slots` rather than hard-coding 7 OR 14 — if a
 *    future schedule format ever carries more than one slot per day, this
 *    module keeps working without a code change.
 *
 * 2. No caption generator existed anywhere in this repo before this task —
 *    `caption.ts` (also added by T07) is it. `buildCaption` is the only
 *    caption source this module calls.
 * ---------------------------------------------------------------------
 *
 * One session covers both platforms: the returned manifest also carries
 * that WEEK's YouTube video ids awaiting a manual visibility flip (plan
 * Decision: "YouTube uploads land private and are flipped by hand in Studio
 * during the weekly session"). `pendingYouTubeFlips` is accepted as a plain
 * INPUT parameter, not read from Firestore or any other store here — T08
 * (the daily job) is the one place that uploads to YouTube and therefore
 * the one place that knows a video's id; it is expected to accumulate the
 * week's ids and pass them into this function once a week, not this module
 * inventing its own read path.
 *
 * Fails clearly, naming the missing date, rather than silently staging a
 * short week — checked with `existsSync` (mirrors `cli.ts`'s own use of it
 * for the schedule file) BEFORE any upload is attempted, so a run either
 * stages the whole week or uploads nothing.
 *
 * Every object this module uploads goes through `contentTypeFor` (never a
 * hand-picked or default content-type). GCS auth is via Application Default
 * Credentials (see `env.ts`'s header for the R2-to-GCS migration), so there
 * is no access-key material anywhere in this pipeline for this module — or
 * any other — to touch or log; the credential-leak surface the original R2
 * version of this comment was guarding against no longer exists.
 *
 * Captions ship as a single `.txt` file, not `.json`: the weekly session is
 * a HUMAN reading captions off a screen while manually pasting them into
 * TikTok's app one at a time (per the plan's "~20 min/week, manual"
 * Decision) — a person does not want to parse JSON mid-session, and the
 * structured version of the same data is already available to any caller
 * as the returned `TikTokWeekManifest.days[].caption`, so nothing is lost
 * by choosing a human-readable format for the artifact that actually gets
 * read by a human.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

import type { Storage } from '@google-cloud/storage';

import { buildCaption } from './caption.js';
import type { GcsConfig } from './env.js';
import { contentTypeFor, tiktokStagingKeyFor, uploadFile, uploadObject } from './storage.js';
import { renderAssetPaths } from '../cli-plan.js';
import { weekDayToDate } from '../pilot-config.js';
import type { ScheduleSlot, WeekSchedule } from '../schedule-types.js';

// ---------------------------------------------------------------------------
// YouTube's pending-flip list
// ---------------------------------------------------------------------------

/**
 * One YouTube upload from THIS week awaiting its manual visibility flip in
 * Studio. T08 (the daily job) is the one place that calls
 * `uploadVideoToYouTube` (`youtube.ts`) and therefore the one place that
 * learns a real video id — this module never uploads to YouTube itself and
 * never invents one.
 */
export interface PendingYouTubeFlip {
	/** Calendar date (`YYYY-MM-DD`) the video was uploaded for. */
	date: string;
	cardId: string;
	/** The id `videos.insert` returned when T08 uploaded this video. */
	videoId: string;
}

// ---------------------------------------------------------------------------
// The staging run
// ---------------------------------------------------------------------------

export interface StageTikTokWeekOptions {
	client: Storage;
	config: GcsConfig;
	/** An already-loaded `pilot-schedule-w<NN>.json`. */
	schedule: WeekSchedule;
	/**
	 * The directory rendered assets were written to — the same `--out` the
	 * render CLI (`cli.ts`) used, so `renderAssetPaths(outDir, format, date)`
	 * resolves to the real file on disk.
	 */
	outDir: string;
	/** That week's YouTube uploads still awaiting a manual flip. See `PendingYouTubeFlip`. */
	pendingYouTubeFlips: PendingYouTubeFlip[];
}

export interface TikTokStagedDay {
	date: string;
	cardId: string;
	/** The direct GCS link to the day's MP4 — `publicUrlFor`'s output, never hand-built. */
	videoUrl: string;
	caption: string;
}

export interface TikTokWeekManifest {
	week: number;
	/** The ISO date of day 1 of this week — also the folder this week staged under. */
	weekStartDate: string;
	days: TikTokStagedDay[];
	/** The direct GCS link to the week's `captions.txt`. */
	captionsUrl: string;
	pendingYouTubeFlips: PendingYouTubeFlip[];
}

/**
 * Builds the human-readable captions file: one block per day, in day order,
 * separated by a rule — meant to be read top to bottom during the weekly
 * session, matching each block to the day's video by date and card id.
 */
function buildCaptionsFileContents(days: Array<{ date: string; cardId: string; caption: string }>): string {
	return days
		.map(({ date, cardId, caption }) => `${date} — ${cardId}\n\n${caption}`)
		.join('\n\n---\n\n');
}

/**
 * Stages one week's Wall videos for TikTok's manual posting session and
 * returns a manifest with direct GCS links, captions, and that week's
 * pending YouTube flips.
 *
 * Order of operations: EVERY scheduled day's MP4 is checked to exist on
 * disk before ANY upload is attempted — see this module's header comment
 * for why (never silently stage a short week).
 */
export async function stageTikTokWeek(options: StageTikTokWeekOptions): Promise<TikTokWeekManifest> {
	const { client, config, schedule, outDir, pendingYouTubeFlips } = options;

	const orderedSlots = [...schedule.slots].sort((a, b) => a.day - b.day);

	const resolved = orderedSlots.map((slot: ScheduleSlot) => {
		const date = weekDayToDate(schedule.week, slot.day);
		const assetPaths = renderAssetPaths(outDir, slot.content.format, date);
		return { slot, date, videoPath: assetPaths.video };
	});

	const missing = resolved.filter(({ videoPath }) => !existsSync(videoPath));
	if (missing.length > 0) {
		const missingDates = missing.map(({ date, videoPath }) => `${date} (expected ${videoPath})`).join(', ');
		throw new Error(
			`TikTok staging for week ${schedule.week} is missing rendered MP4s for: ${missingDates}. ` +
				'Render every day of this week before staging it — refusing to stage a short week.'
		);
	}

	const weekStartDate = weekDayToDate(schedule.week, 1);

	const days: TikTokStagedDay[] = [];
	for (const { slot, date, videoPath } of resolved) {
		const caption = buildCaption({ slot, platform: 'tiktok' });
		const key = tiktokStagingKeyFor(weekStartDate, path.basename(videoPath));
		const videoUrl = await uploadFile({
			client,
			config,
			filePath: videoPath,
			key,
			contentType: contentTypeFor(videoPath)
		});
		days.push({ date, cardId: slot.card_id, videoUrl, caption });
	}

	const captionsFileName = 'captions.txt';
	const captionsKey = tiktokStagingKeyFor(weekStartDate, captionsFileName);
	const captionsUrl = await uploadObject({
		client,
		config,
		key: captionsKey,
		body: Buffer.from(buildCaptionsFileContents(days), 'utf-8'),
		contentType: contentTypeFor(captionsFileName)
	});

	return {
		week: schedule.week,
		weekStartDate,
		days,
		captionsUrl,
		pendingYouTubeFlips
	};
}
