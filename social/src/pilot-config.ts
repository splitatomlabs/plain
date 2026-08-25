/**
 * The pilot's date <-> schedule-week/day mapping (T18).
 *
 * `content/social/pilot-schedule-w<NN>.json` files are indexed by WEEK
 * (1-based) and DAY-WITHIN-WEEK (1-7), not by calendar date — the schedule
 * generator (`scripts/generate-schedule.ts`) knows nothing about real
 * dates at all. `PILOT_WEEK_1_START` is the ONE place that anchors week 1
 * day 1 to a real calendar date, so the render CLI (`cli.ts`) can turn a
 * `--date` flag into the `(week, day)` pair a schedule file is keyed by.
 *
 * `PILOT_WEEK_1_START` IS THE ANCHOR — changing it retroactively shifts
 * every date's mapped (week, day), which invalidates every render already
 * produced under the old mapping (a render's filename and metadata sidecar
 * both embed the `--date` it was rendered for, but the schedule CONTENT
 * that date now resolves to would be different). Treat this constant as
 * fixed for the life of the pilot once the first real render has shipped;
 * changing it is a deliberate, one-time decision, not a config tweak.
 *
 * Nothing in this module reads `Date.now()` — every date comes from the
 * caller (ultimately, the CLI's `--date` flag), matching every other
 * date-taking tool in this pipeline (`scripts/review-week.ts --date`,
 * `social/src/render/post-metadata.ts`'s caller-supplied `rendered_at`).
 * All arithmetic is done in UTC calendar days (`Date.UTC`), so this is
 * unaffected by the host machine's local timezone or DST — mirrors
 * `social/src/audio/beds.ts`'s `slotIndex` helper.
 */

/** Week 1, day 1 of the pilot schedule — see the module doc comment above. */
export const PILOT_WEEK_1_START = '2026-09-01';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole calendar days since the Unix epoch, in UTC — pure, no wall-clock reads. */
function isoDateToEpochDay(date: string): number {
	const match = ISO_DATE_RE.exec(date);
	if (!match) {
		throw new Error(`Invalid date "${date}" — expected "YYYY-MM-DD".`);
	}
	const [, yearStr, monthStr, dayStr] = match;
	const year = Number(yearStr);
	const month = Number(monthStr);
	const day = Number(dayStr);

	const ms = Date.UTC(year, month - 1, day);

	// `Date.UTC` silently normalizes an out-of-range day/month (e.g.
	// 2026-02-30 rolls forward into March) rather than throwing — round-trip
	// through a real `Date` and compare components back against the parsed
	// input to catch that rather than silently accepting a date that does
	// not exist.
	const roundTrip = new Date(ms);
	if (
		roundTrip.getUTCFullYear() !== year ||
		roundTrip.getUTCMonth() !== month - 1 ||
		roundTrip.getUTCDate() !== day
	) {
		throw new Error(`Invalid date "${date}" — "${monthStr}-${dayStr}" does not exist in ${yearStr}.`);
	}

	return Math.floor(ms / 86_400_000);
}

function epochDayToIsoDate(epochDay: number): string {
	const ms = epochDay * 86_400_000;
	const dt = new Date(ms);
	const year = String(dt.getUTCFullYear()).padStart(4, '0');
	const month = String(dt.getUTCMonth() + 1).padStart(2, '0');
	const day = String(dt.getUTCDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

const WEEK_1_START_EPOCH_DAY = isoDateToEpochDay(PILOT_WEEK_1_START);

export interface WeekDay {
	/** 1-based. */
	week: number;
	/** 1-based, 1-7. */
	day: number;
}

/**
 * Maps a calendar date to the `(week, day)` pair its schedule slot lives
 * under, anchored at `PILOT_WEEK_1_START` (week 1, day 1). Throws on an
 * invalid date string, or a date that falls before the pilot's own start
 * (there is no schedule for it — a negative week/day is never returned).
 */
export function dateToWeekDay(date: string): WeekDay {
	const epochDay = isoDateToEpochDay(date);
	const offsetDays = epochDay - WEEK_1_START_EPOCH_DAY;

	if (offsetDays < 0) {
		throw new Error(
			`Date "${date}" is before the pilot's own start date (${PILOT_WEEK_1_START}, week 1 day 1) — ` +
				'no schedule covers it.'
		);
	}

	const week = Math.floor(offsetDays / 7) + 1;
	const day = (offsetDays % 7) + 1;
	return { week, day };
}

/**
 * The inverse of `dateToWeekDay` — resolves the calendar date a given
 * `(week, day)` pair falls on. Throws on an out-of-range `week` (< 1) or
 * `day` (outside 1-7).
 */
export function weekDayToDate(week: number, day: number): string {
	if (!Number.isInteger(week) || week < 1) {
		throw new Error(`Invalid week ${week} — must be a positive integer.`);
	}
	if (!Number.isInteger(day) || day < 1 || day > 7) {
		throw new Error(`Invalid day ${day} — must be an integer in 1-7.`);
	}

	const offsetDays = (week - 1) * 7 + (day - 1);
	return epochDayToIsoDate(WEEK_1_START_EPOCH_DAY + offsetDays);
}
