/**
 * Pure planning helpers for `cli.ts`'s `render` command (T18) — everything
 * that can be computed WITHOUT touching the filesystem, a browser, or
 * ffmpeg, split out here so it's directly unit-testable (and so `cli.ts`
 * itself stays orchestration-only).
 */

import path from 'node:path';

import type { WallOpening } from './remotion/wall-openings.js';
import { rotateOpening } from './remotion/wall-openings.js';
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
 * Finds `day`/`slotNumber`'s entry in an already-loaded `schedule`. Throws
 * a clear error (naming the week, day, and slot looked for) rather than
 * returning `undefined` — every caller of this needs a real slot to
 * render.
 */
export function resolveSlot(schedule: WeekSchedule, day: number, slotNumber: number): ScheduleSlot {
	const found = schedule.slots.find((s) => s.day === day && s.slot === slotNumber);
	if (!found) {
		throw new Error(
			`Week ${schedule.week} has no slot for day ${day}, slot ${slotNumber} — the schedule file may be ` +
				'corrupt, or this day/slot was never generated.'
		);
	}
	return found;
}

// ---------------------------------------------------------------------------
// Deterministic per-slot seeding — same --date/--slot always picks the same
// opening and the same bed (see wall-openings.ts's rotateOpening and
// audio/beds.ts's selectBed, both pure functions of an integer seed).
// ---------------------------------------------------------------------------

/**
 * A stable, strictly-increasing integer index for a given `(date,
 * slotNumber)` — `0` for week 1 day 1 slot 1, `1` for week 1 day 1 slot 2,
 * `2` for week 1 day 2 slot 1, and so on across the whole pilot. Pure
 * function of its inputs (via `dateToWeekDay`, itself pure and
 * `Date.now()`-free) — no randomness, so the same date/slot always
 * produces the same index, and therefore the same opening/bed choice.
 */
export function postIndexForSlot(date: string, slotNumber: number): number {
	const { week, day } = dateToWeekDay(date);
	return (week - 1) * 14 + (day - 1) * 2 + (slotNumber - 1);
}

/**
 * Chooses The Wall's opening for a slot: `rotateOpening(seed)`'s candidate,
 * gated by `eligibleOpenings` — falling back to `standard` (always
 * eligible) when the rotation's candidate isn't one this specific card can
 * show. Deterministic: the same `seed` and `eligibleOpenings` always
 * return the same opening.
 */
export function chooseWallOpening(seed: number, eligibleOpenings: readonly WallOpening[]): WallOpening {
	const candidate = rotateOpening(seed);
	return eligibleOpenings.includes(candidate) ? candidate : 'standard';
}

/** Chooses this slot's music bed — a thin, named wrapper around `selectBed` for symmetry with `chooseWallOpening`. */
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
 * `post-metadata.ts`'s own doc-comment example
 * (`wall-2026-09-01-slot1.mp4` -> `wall-2026-09-01-slot1.json`). The
 * metadata sidecar path is derived from `video` by `postMetadataPathFor`
 * (`render/post-metadata.ts`), not repeated here.
 */
export function renderAssetPaths(outDir: string, format: string, date: string, slotNumber: number): RenderAssetPaths {
	const stem = `${format}-${date}-slot${slotNumber}`;
	return {
		video: path.join(outDir, `${stem}.mp4`),
		feedStill: path.join(outDir, `${stem}-feed.jpg`)
	};
}
