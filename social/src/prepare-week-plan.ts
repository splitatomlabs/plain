/**
 * Pure planning helpers for `prepare-week.ts` (`Pb4e17-social-native-
 * scheduling` T06) — everything computable WITHOUT touching the filesystem,
 * Remotion, or a network, split out here so it's directly unit-testable and
 * `prepare-week.ts` itself stays orchestration-only. Mirrors the
 * `cli.ts`/`cli-plan.ts` split (T18) for the same reason.
 *
 * `resolveWeekDays` derives each scheduled day's real calendar date and
 * expected MP4 path — the SAME `weekDayToDate`/`renderAssetPaths` the render
 * CLI and `weekly-prep.ts` already use, never re-derived. `planWeekPrepare`
 * then decides, per day, whether it needs rendering: given the schedule, the
 * output directory, and which of those MP4 paths already exist on disk
 * (`existingVideoPaths` — computed by the caller via `existsSync`, kept out
 * of this module so it stays a pure function of its inputs), it returns the
 * list of dates to render, to skip, and the local path `captions.txt` will
 * land at.
 *
 * SKIP BY DEFAULT, `--force` OVERRIDES: a render is minutes of CPU — re-
 * running this command after fixing one day's schedule entry must not redo
 * the whole week. `force=true` re-renders every day regardless of what's
 * already on disk (see `prepare-week.ts`'s `--force` flag).
 */

import path from 'node:path';

import { renderAssetPaths } from './cli-plan.js';
import { weekDayToDate } from './pilot-config.js';
import type { WeekSchedule } from './schedule-types.js';

// ---------------------------------------------------------------------------
// Resolving each scheduled day's real date + expected MP4 path
// ---------------------------------------------------------------------------

export interface ResolvedDay {
	date: string;
	/** 1-based, 1-7. */
	day: number;
	cardId: string;
	/** The local absolute path `cli.ts`'s render would write this day's MP4 to. */
	videoPath: string;
}

/** Every scheduled day, in day order, with its real calendar date and expected MP4 path resolved. */
export function resolveWeekDays(schedule: WeekSchedule, outDir: string): ResolvedDay[] {
	return [...schedule.slots]
		.sort((a, b) => a.day - b.day)
		.map((slot) => {
			const date = weekDayToDate(schedule.week, slot.day);
			const { video } = renderAssetPaths(outDir, slot.content.format, date);
			return { date, day: slot.day, cardId: slot.card_id, videoPath: video };
		});
}

// ---------------------------------------------------------------------------
// Deciding what needs rendering
// ---------------------------------------------------------------------------

export type DayAction = 'render' | 'skip';

export interface DayTask extends ResolvedDay {
	action: DayAction;
}

export interface WeekPreparePlan {
	week: number;
	/** In day order. */
	tasks: DayTask[];
	/** The local absolute path `captions.txt` will be written to (or would be, under `--dry-run`). */
	captionsPath: string;
}

/**
 * Decides, per scheduled day, whether it needs rendering — `'skip'` only
 * when `force` is `false` AND that day's expected MP4 path is already in
 * `existingVideoPaths`. Pure: the same three inputs always produce the same
 * plan.
 */
export function planWeekPrepare(
	schedule: WeekSchedule,
	outDir: string,
	existingVideoPaths: ReadonlySet<string>,
	force: boolean
): WeekPreparePlan {
	const days = resolveWeekDays(schedule, outDir);
	const tasks: DayTask[] = days.map((day) => ({
		...day,
		action: !force && existingVideoPaths.has(day.videoPath) ? 'skip' : 'render'
	}));

	return {
		week: schedule.week,
		tasks,
		captionsPath: path.join(outDir, 'captions.txt')
	};
}
