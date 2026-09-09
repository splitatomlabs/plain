/**
 * Local weekly prep — the weekly desktop session
 * (`Pb4e17-social-native-scheduling` T05, superseding `Pf39c2-social-pilot-03`
 * T07's GCS-staging version of this file).
 *
 * Decision (`Pb4e17-social-native-scheduling`): "Post via each platform's own
 * scheduler in one weekly desktop session; record all metrics by hand." There
 * is no remote upload step any more — TikTok, Instagram, and YouTube all get
 * their content the same way now, a human dragging a file into that
 * platform's own scheduler from the machine that just rendered it. This
 * module does everything that CAN be prepared ahead of that session: it
 * confirms the week's rendered MP4s exist on disk and writes a single local
 * `captions.txt` carrying all three platforms' captions for every day, so
 * the operator has one file to read top to bottom while working through
 * three browser tabs.
 *
 * ---------------------------------------------------------------------
 * TASK WORDING DISCREPANCY (flagged by the original task brief this module
 * traces back to, preserved here since it is still true):
 *
 * "Acceptance: a run produces 14 videos" is STALE. It predates
 * `Pf39c2-social-pilot-02a` D02, which collapsed the channel to a SINGLE
 * Wall post per day — a week is `schedule.slots.length` videos, which is 7
 * for every schedule this pipeline currently generates (one slot per day,
 * 7 days), NOT 14. `prepareWeek` below still reads the slot count from
 * `schedule.slots.length` rather than hard-coding 7 OR 14, so a captions
 * block per day falls out of iterating the schedule's own slots rather than
 * a hardcoded loop bound.
 *
 * EVERY DAY EXACTLY ONCE — enforced, not aspirational: every day in
 * `pilot-config.ts`'s `DAYS_PER_WEEK` range must appear in the schedule, and
 * NONE may appear more than once (`prepareWeek`'s guard checks both,
 * deliberately in that order — see the guard's own comment). A duplicated
 * day is corruption (a hand-edited or malformed schedule file), not a
 * legitimate multiple-posts-per-day format: this pipeline has only ever
 * generated one slot per day, and a schedule that silently posts the same
 * day twice while skipping another is precisely the bug this guard exists to
 * catch. If a future schedule format genuinely needs more than one slot on
 * the same day, that is a deliberate change to this invariant and must
 * update this guard (and this comment) at the same time — it is not
 * something this module accommodates by default today.
 * ---------------------------------------------------------------------
 *
 * No GCS, no upload, no credentials: this module imports nothing from
 * `publish/storage.ts` or `publish/env.ts` (both deleted by
 * `Pb4e17-social-native-scheduling` T07) — every path it deals with is a
 * local absolute path on the machine running this code.
 *
 * Never silently prepares a short week — checked in two passes, both before
 * the captions file is written, so a run either prepares the whole week or
 * writes nothing: first, that the schedule itself covers every day 1-
 * `DAYS_PER_WEEK` exactly once (catches a short or malformed schedule file);
 * second, `existsSync` per resolved day (mirrors `cli.ts`'s own use of it
 * for the schedule file), which fails clearly, naming the missing date,
 * when a day IS scheduled but its render hasn't happened yet.
 *
 * Captions ship as a single `.txt` file, not `.json`: the weekly session is
 * a HUMAN reading captions off a screen while manually pasting them into
 * three platforms' native schedulers, one at a time — a person does not
 * want to parse JSON mid-session. Each day carries all three platforms'
 * captions, clearly labelled, built via `buildCaption({ slot, platform })`
 * for each of `tiktok` / `instagram` / `youtube` — never a hand-rolled
 * second caption source. `caption.ts`'s `buildCaption` picks a different
 * attribution URL per platform (`utm_source=<platform>`, via its
 * `ATTRIBUTION_URLS`), so the three captions for a given day are never
 * identical strings — an earlier version of this module hardcoded
 * `platform: 'tiktok'` for every caption regardless of destination, which
 * this rewrite fixes.
 */

import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { buildCaption, type CaptionPlatform } from './caption.js';
import { renderAssetPaths } from '../cli-plan.js';
import { DAYS_PER_WEEK, weekDayToDate } from '../pilot-config.js';
import type { ScheduleSlot, WeekSchedule } from '../schedule-types.js';

// ---------------------------------------------------------------------------
// The weekly prep run
// ---------------------------------------------------------------------------

/**
 * The three platforms every day's captions block covers, in the order they
 * appear in `captions.txt`. Single source of truth for that iteration — see
 * this module's header comment for why looping over this (rather than three
 * literal `buildCaption` calls) is the point of this rewrite.
 */
export const WEEKLY_CAPTION_PLATFORMS: readonly CaptionPlatform[] = ['tiktok', 'instagram', 'youtube'];

export interface PrepareWeekOptions {
	/** An already-loaded `pilot-schedule-w<NN>.json`. */
	schedule: WeekSchedule;
	/**
	 * The directory rendered assets were written to — the same `--out` the
	 * render CLI (`cli.ts`) used, so `renderAssetPaths(outDir, format, date)`
	 * resolves to the real file on disk. `captions.txt` is written into this
	 * same directory.
	 */
	outDir: string;
}

export interface PreparedDay {
	date: string;
	cardId: string;
	/** The local absolute path to the day's rendered MP4, ready to drag into a browser tab. */
	videoPath: string;
	/** This day's caption for each platform, keyed the same way `WEEKLY_CAPTION_PLATFORMS` orders them. */
	captions: Record<CaptionPlatform, string>;
}

export interface WeekPrepManifest {
	week: number;
	/** The ISO date of day 1 of this week. */
	weekStartDate: string;
	days: PreparedDay[];
	/** The local absolute path `captions.txt` was written to. */
	captionsPath: string;
}

/**
 * Builds the human-readable captions file: one block per day, in day order,
 * each day carrying all three platforms' captions clearly labelled, meant to
 * be read top to bottom during the weekly session while working through
 * three browser tabs.
 */
function buildCaptionsFileContents(
	days: Array<{ date: string; cardId: string; captions: Record<CaptionPlatform, string> }>
): string {
	return days
		.map(({ date, cardId, captions }) => {
			const platformBlocks = WEEKLY_CAPTION_PLATFORMS.map(
				(platform) => `[${platform}]\n${captions[platform]}`
			).join('\n\n');
			return `${date} — ${cardId}\n\n${platformBlocks}`;
		})
		.join('\n\n---\n\n');
}

/**
 * Prepares one week for the manual weekly posting session: confirms every
 * scheduled day's MP4 is on disk and writes a local `captions.txt` covering
 * all three platforms for every day.
 *
 * Order of operations: EVERY scheduled day's MP4 is checked to exist on disk
 * before the captions file is written — see this module's header comment for
 * why (never silently prepare a short week).
 */
export async function prepareWeek(options: PrepareWeekOptions): Promise<WeekPrepManifest> {
	const { schedule, outDir } = options;

	const orderedSlots = [...schedule.slots].sort((a, b) => a.day - b.day);

	// Guard against a SHORT OR DUPLICATED SCHEDULE, not just a missing
	// render — two checks, in this order, both before anything is written:
	//
	// 1. NO DAY MAY REPEAT. Comparing `orderedSlots.length` against
	//    `distinctDays.size` catches a duplicated day even when the total
	//    slot count still happens to equal `DAYS_PER_WEEK` overall (e.g. an
	//    8-slot schedule covering days 1-7 with day 3 duplicated: 7 distinct
	//    days present, which the coverage check below would accept on its
	//    own) — see this module's header comment for why a duplicate day is
	//    treated as corruption rather than a valid format, and is checked
	//    FIRST, ahead of the coverage check, so a duplicate is reported as
	//    exactly that rather than a confusing "day count" mismatch.
	// 2. EVERY DAY 1-DAYS_PER_WEEK MUST BE PRESENT. Once no day repeats,
	//    `distinctDays.size !== DAYS_PER_WEEK` means the schedule is simply
	//    short — missing a day outright.
	//
	// Either failure would otherwise sail through the per-slot `existsSync`
	// check below and silently produce a short or duplicated `captions.txt`.
	const distinctDays = new Set(orderedSlots.map((slot) => slot.day));
	if (distinctDays.size !== orderedSlots.length) {
		const dayCounts = new Map<number, number>();
		for (const slot of orderedSlots) {
			dayCounts.set(slot.day, (dayCounts.get(slot.day) ?? 0) + 1);
		}
		const duplicatedDays = [...dayCounts.entries()]
			.filter(([, count]) => count > 1)
			.map(([day]) => day)
			.sort((a, b) => a - b);
		throw new Error(
			`Week ${schedule.week}'s schedule has ${orderedSlots.length} slot(s) but only ${distinctDays.size} distinct ` +
				`day(s) — day(s) ${duplicatedDays.join(', ')} appear more than once. Refusing to prepare a week with a ` +
				'duplicated day.'
		);
	}
	if (distinctDays.size !== DAYS_PER_WEEK) {
		const presentDays = orderedSlots.map((slot) => slot.day).join(', ') || '(none)';
		throw new Error(
			`Week ${schedule.week} covers ${distinctDays.size} of ${DAYS_PER_WEEK} scheduled day(s) ` +
				`(days present: ${presentDays}) — refusing to prepare a short week.`
		);
	}

	const resolved = orderedSlots.map((slot: ScheduleSlot) => {
		const date = weekDayToDate(schedule.week, slot.day);
		const assetPaths = renderAssetPaths(outDir, slot.content.format, date);
		return { slot, date, videoPath: assetPaths.video };
	});

	const missing = resolved.filter(({ videoPath }) => !existsSync(videoPath));
	if (missing.length > 0) {
		const missingDates = missing.map(({ date, videoPath }) => `${date} (expected ${videoPath})`).join(', ');
		throw new Error(
			`Weekly prep for week ${schedule.week} is missing rendered MP4s for: ${missingDates}. ` +
				'Render every day of this week before preparing it — refusing to prepare a short week.'
		);
	}

	const weekStartDate = weekDayToDate(schedule.week, 1);

	const days: PreparedDay[] = resolved.map(({ slot, date, videoPath }) => {
		const captions = Object.fromEntries(
			WEEKLY_CAPTION_PLATFORMS.map((platform) => [platform, buildCaption({ slot, platform })])
		) as Record<CaptionPlatform, string>;
		return { date, cardId: slot.card_id, videoPath, captions };
	});

	const captionsPath = path.join(outDir, 'captions.txt');
	await mkdir(path.dirname(captionsPath), { recursive: true });
	await writeFile(captionsPath, buildCaptionsFileContents(days), 'utf-8');

	return {
		week: schedule.week,
		weekStartDate,
		days,
		captionsPath
	};
}
