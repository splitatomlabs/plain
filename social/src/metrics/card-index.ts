/**
 * Resolves a post's PUBLISHED DATE back to the card it was built from, so
 * the readout can name the premise rather than an opaque platform id.
 *
 * WHY: `MetricsRow` (`schema.ts`) deliberately stores the PLATFORM's own id
 * — an Instagram media id, a YouTube video id — because that is the only
 * stored pointer back to the real post (re-reading its analytics, checking
 * the right post was entered, chasing a flag). It carries no card id, and
 * nothing else in the row does either. That leaves the readout's two most
 * important outputs unreadable: the top-posts list, and the criterion-A
 * verdict sentence itself, which names the breakout post. "post ler2U2CFzHs
 * cleared the breakout threshold" does not tell you which premise did it,
 * which is exactly what the pre-registered criterion asks you to rebuild
 * around.
 *
 * The date is enough to recover the card WITHOUT storing a second id on
 * every row: the pilot publishes one post per platform per day, the schedule
 * files are committed, and `pilot-config.ts`'s `weekDayToDate` is the same
 * anchor the renderer used to pick that day's card in the first place. So
 * this reads the committed schedules and inverts them into `date -> card_id`.
 *
 * Reads the schedule JSON directly rather than importing `cli.ts`'s
 * `loadWeekSchedule`: that module imports `@remotion/bundler`/`renderer` at
 * top level, so importing it here would pull the whole renderer into the
 * metrics CLI (the same trap `prepare-week.ts`'s header documents, which it
 * avoids with a dynamic import). Only the filename helper is shared, from
 * the Remotion-free `cli-plan.ts` — this is reading a committed JSON
 * artifact, not a second implementation of the render path.
 */

import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

import { scheduleFileName } from '../cli-plan.js';
import { weekDayToDate } from '../pilot-config.js';
import type { WeekSchedule } from '../schedule-types.js';

/** `pilot-schedule-w<NN>.json`, and nothing else in the directory. */
const SCHEDULE_FILENAME_RE = /^pilot-schedule-w(\d+)\.json$/;

/**
 * Maps every scheduled day's calendar date to the card id scheduled for it,
 * across every committed `pilot-schedule-w<NN>.json` in `scheduleDir`.
 *
 * A missing directory yields an empty map rather than throwing: the readout
 * must still run (naming platform ids only) on a checkout with no schedules,
 * exactly as it did before this module existed. A schedule whose `week`
 * field disagrees with its own filename DOES throw — that mismatch would
 * silently map a week's cards onto the wrong calendar dates, and so
 * mislabel every post in the readout.
 */
export async function buildCardIndex(scheduleDir: string): Promise<Map<string, string>> {
	let entries: string[];
	try {
		entries = await readdir(scheduleDir);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
		throw e;
	}

	const index = new Map<string, string>();

	for (const entry of entries.filter((f) => SCHEDULE_FILENAME_RE.test(f)).sort()) {
		const week = Number(SCHEDULE_FILENAME_RE.exec(entry)![1]);
		const schedule = JSON.parse(await readFile(path.join(scheduleDir, entry), 'utf-8')) as WeekSchedule;

		// The filename is how every other caller resolves a week
		// (`cli.ts`'s `loadWeekSchedule` builds the path from the week
		// number), so a file whose contents claim a different week is
		// corrupt in a way that would misdate every one of its cards.
		if (schedule.week !== week) {
			throw new Error(
				`buildCardIndex: "${entry}" contains week ${schedule.week} but its filename says week ${week} — ` +
					`refusing to map its cards onto week ${week}'s dates. Expected ${scheduleFileName(schedule.week)}.`
			);
		}

		for (const slot of schedule.slots) {
			index.set(weekDayToDate(week, slot.day), slot.card_id);
		}
	}

	return index;
}

/**
 * The card scheduled for a post's publish date, or `null` when no schedule
 * covers it. `publishedAt` is an ISO instant; only its date part is used,
 * matching `readout.ts`'s own `publishedAt.slice(0, 10)` convention for week
 * bucketing and follower alignment.
 *
 * `null` is a normal result, not an error: a pre-pilot row, a post published
 * outside any generated week, or a checkout with no schedules all land here,
 * and the readout falls back to the platform id.
 */
export function cardIdForPublishedAt(publishedAt: string, index: ReadonlyMap<string, string> | undefined): string | null {
	if (!index) return null;
	return index.get(publishedAt.slice(0, 10)) ?? null;
}
