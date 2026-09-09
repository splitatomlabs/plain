/**
 * Tests for `../prepare-week-plan.ts` — the pure planning half of the
 * weekly prep CLI (`Pb4e17-social-native-scheduling` T06). No filesystem, no
 * Remotion, no network: every input here is plain data.
 */

import { describe, expect, it } from 'vitest';

import { planWeekPrepare, resolveWeekDays } from '../prepare-week-plan.js';
import { renderAssetPaths } from '../cli-plan.js';
import { weekDayToDate } from '../pilot-config.js';
import type { WeekSchedule } from '../schedule-types.js';

const OUT_DIR = '/fake/out';

/** A real-shaped 3-slot week schedule, deliberately out of day order to exercise sorting. */
const SCHEDULE: WeekSchedule = {
	week: 1,
	slots: [
		{
			day: 3,
			card_id: 'card-day-3',
			book_slug: 'enchiridion',
			author_slug: 'epictetus',
			content: { format: 'wall', original_excerpt: 'excerpt-3', landing_line: 'Landing three.' }
		},
		{
			day: 1,
			card_id: 'card-day-1',
			book_slug: 'meditations',
			author_slug: 'marcus-aurelius',
			content: { format: 'wall', original_excerpt: 'excerpt-1', landing_line: 'Landing one.' }
		},
		{
			day: 2,
			card_id: 'card-day-2',
			book_slug: 'on-anger',
			author_slug: 'seneca',
			content: { format: 'wall', original_excerpt: 'excerpt-2', landing_line: 'Landing two.' }
		}
	]
};

function videoPathFor(day: number): string {
	const date = weekDayToDate(SCHEDULE.week, day);
	return renderAssetPaths(OUT_DIR, 'wall', date).video;
}

describe('resolveWeekDays', () => {
	it('resolves every slot to its real date and expected MP4 path, in day order', () => {
		const days = resolveWeekDays(SCHEDULE, OUT_DIR);
		expect(days.map((d) => d.day)).toEqual([1, 2, 3]);
		expect(days.map((d) => d.cardId)).toEqual(['card-day-1', 'card-day-2', 'card-day-3']);
		for (const day of days) {
			expect(day.videoPath).toBe(videoPathFor(day.day));
			expect(day.date).toBe(weekDayToDate(SCHEDULE.week, day.day));
		}
	});
});

describe('planWeekPrepare', () => {
	it('marks every day for render when no MP4s exist', () => {
		const plan = planWeekPrepare(SCHEDULE, OUT_DIR, new Set(), false);
		expect(plan.tasks).toHaveLength(3);
		expect(plan.tasks.every((t) => t.action === 'render')).toBe(true);
		// Day order, not schedule-slot order.
		expect(plan.tasks.map((t) => t.day)).toEqual([1, 2, 3]);
	});

	it('skips days whose MP4 already exists on disk', () => {
		const existing = new Set([videoPathFor(1), videoPathFor(3)]);
		const plan = planWeekPrepare(SCHEDULE, OUT_DIR, existing, false);

		const byDay = Object.fromEntries(plan.tasks.map((t) => [t.day, t.action]));
		expect(byDay[1]).toBe('skip');
		expect(byDay[2]).toBe('render');
		expect(byDay[3]).toBe('skip');
	});

	it('--force re-renders every day regardless of what already exists', () => {
		const existing = new Set([videoPathFor(1), videoPathFor(2), videoPathFor(3)]);
		const plan = planWeekPrepare(SCHEDULE, OUT_DIR, existing, true);

		expect(plan.tasks.every((t) => t.action === 'render')).toBe(true);
	});

	it('derives captionsPath as captions.txt inside outDir', () => {
		const plan = planWeekPrepare(SCHEDULE, OUT_DIR, new Set(), false);
		expect(plan.captionsPath).toBe(`${OUT_DIR}/captions.txt`);
	});

	it('carries the schedule week through unchanged', () => {
		const plan = planWeekPrepare(SCHEDULE, OUT_DIR, new Set(), false);
		expect(plan.week).toBe(SCHEDULE.week);
	});
});
