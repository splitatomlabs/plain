/**
 * Pure planning helpers for `cli.ts`'s `render` command (T18) — everything
 * that can be computed WITHOUT touching the filesystem, a browser, or
 * ffmpeg, split out here so it's directly unit-testable (and so `cli.ts`
 * itself stays orchestration-only).
 *
 * Pf39c2-social-pilot-02a D02: the read-through and the two-slot day are
 * both gone — every day is a single Wall slot, so `--slot` and every
 * slot-numbered helper here (`resolveSlot`, `postIndexForSlot`,
 * `renderAssetPaths`) collapsed to their day-only equivalents
 * (`resolveDay`, `postIndexForDay`, and `renderAssetPaths` dropping its
 * `slotNumber` parameter entirely).
 */

import path from 'node:path';

import { selectBed, type BedInfo } from './audio/beds.js';
import { splitPayoffLines } from './audio/timing.js';
import { dateToWeekDay } from './pilot-config.js';
import type { ScheduleSlot, WeekSchedule } from './schedule-types.js';

// ---------------------------------------------------------------------------
// Slot resolution
// ---------------------------------------------------------------------------

/** `content/social/pilot-schedule-w<NN>.json`'s filename for a given week. */
export function scheduleFileName(week: number): string {
	return `pilot-schedule-w${String(week).padStart(2, '0')}.json`;
}

/**
 * Finds `day`'s single Wall slot in an already-loaded `schedule`. Throws a
 * clear error (naming the week and day looked for) rather than returning
 * `undefined` — every caller of this needs a real slot to render.
 */
export function resolveDay(schedule: WeekSchedule, day: number): ScheduleSlot {
	const found = schedule.slots.find((s) => s.day === day);
	if (!found) {
		throw new Error(
			`Week ${schedule.week} has no slot for day ${day} — the schedule file may be corrupt, or this day was ` +
				'never generated.'
		);
	}
	return found;
}

// ---------------------------------------------------------------------------
// Deterministic per-day seeding — same --date always picks the same bed (see
// audio/beds.ts's selectBed, a pure function of an integer seed).
// ---------------------------------------------------------------------------

/**
 * A stable, strictly-increasing integer index for a given `date` — `0` for
 * week 1 day 1, `1` for week 1 day 2, ..., `7` for week 2 day 1, and so on
 * across the whole pilot. Pure function of its input (via `dateToWeekDay`,
 * itself pure and `Date.now()`-free) — no randomness, so the same date
 * always produces the same index, and therefore the same bed choice.
 */
export function postIndexForDay(date: string): number {
	const { week, day } = dateToWeekDay(date);
	return (week - 1) * 7 + (day - 1);
}

/** Chooses this slot's music bed — a thin, named wrapper around `selectBed`. */
export function chooseBed(seed: number): BedInfo {
	return selectBed(seed);
}

// ---------------------------------------------------------------------------
// Resolving The Wall's "rest of the plain passage" lines from the card
// ---------------------------------------------------------------------------

/**
 * Splits `plainEnglish` into the lines `Wall.tsx`'s `plainLines` prop
 * expects: every sentence of the plain passage EXCEPT `landingLine`, in
 * order. `landingLine` (`ScheduleSlot.content.landing_line`) is guaranteed
 * (by `scripts/lib/schedule.ts`'s own faithfulness check at schedule-
 * generation time) to be a verbatim substring of `plainEnglish` — this
 * splices that exact substring out (not a sentence-boundary match, which
 * could disagree with whatever splitter chose `landingLine` upstream) and
 * re-splits the remainder with `splitPayoffLines`, the one canonical
 * sentence splitter every payoff phase in this workspace uses.
 */
export function computeWallPlainLines(plainEnglish: string, landingLine: string): string[] {
	const idx = plainEnglish.indexOf(landingLine);
	if (idx === -1) {
		throw new Error(
			`computeWallPlainLines: landing line ${JSON.stringify(landingLine)} is not a verbatim substring of ` +
				'the card\'s plain_english — cannot resolve the rest of the passage.'
		);
	}
	const before = plainEnglish.slice(0, idx);
	const after = plainEnglish.slice(idx + landingLine.length);
	const remainder = `${before} ${after}`.replace(/\s+/g, ' ').trim();
	return splitPayoffLines(remainder);
}

// ---------------------------------------------------------------------------
// Output file naming
// ---------------------------------------------------------------------------

export interface RenderAssetPaths {
	video: string;
	feedStill: string;
}

/**
 * The conventional output filenames for a render — mirrors
 * `post-metadata.ts`'s own doc-comment example (`wall-2026-09-01.mp4` ->
 * `wall-2026-09-01.json`). The metadata sidecar path is derived from `video`
 * by `postMetadataPathFor` (`render/post-metadata.ts`), not repeated here.
 *
 * Pf39c2-social-pilot-02a D02: dropped the `-slotN` suffix — one post per
 * day now, so the date alone is unambiguous.
 */
export function renderAssetPaths(outDir: string, format: string, date: string): RenderAssetPaths {
	const stem = `${format}-${date}`;
	return {
		video: path.join(outDir, `${stem}.mp4`),
		feedStill: path.join(outDir, `${stem}-feed.jpg`)
	};
}
