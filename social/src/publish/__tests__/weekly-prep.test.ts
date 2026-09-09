/**
 * Tests for `../weekly-prep.ts` — the local weekly prep run
 * (`Pb4e17-social-native-scheduling` T05).
 *
 * These run against a real temp directory rather than a mocked `fs`: there
 * is no remote upload any more, so the whole point of this module is its
 * on-disk behaviour (which MP4s it expects, where it writes `captions.txt`,
 * and what that file actually contains) — mocking the filesystem would test
 * the mock rather than any of that. Matches `post-metadata.test.ts`'s
 * own rationale for the same choice.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ATTRIBUTION_URLS } from '../caption.js';
import { prepareWeek } from '../weekly-prep.js';
import { renderAssetPaths } from '../../cli-plan.js';
import { weekDayToDate } from '../../pilot-config.js';
import type { WeekSchedule } from '../../schedule-types.js';

/** A real 7-slot week schedule (one per day), mirroring pilot-schedule-w01.json's shape. */
const SCHEDULE: WeekSchedule = {
	week: 1,
	seed: 42,
	slots: [
		{
			day: 1,
			card_id: 'meditations-09-025',
			book_slug: 'meditations',
			author_slug: 'marcus-aurelius',
			content: { format: 'wall', original_excerpt: 'excerpt-1', landing_line: 'Every action has an end.' }
		},
		{
			day: 2,
			card_id: 'on-anger-02-054',
			book_slug: 'on-anger',
			author_slug: 'seneca',
			content: { format: 'wall', original_excerpt: 'excerpt-2', landing_line: "A boy was raised in Plato's household." }
		},
		{
			day: 3,
			card_id: 'discourses-60-001',
			book_slug: 'discourses',
			author_slug: 'epictetus',
			content: { format: 'wall', original_excerpt: 'excerpt-3', landing_line: 'When you see someone rich, think about what you have instead of riches.' }
		},
		{
			day: 4,
			card_id: 'enchiridion-41-001',
			book_slug: 'enchiridion',
			author_slug: 'epictetus',
			content: { format: 'wall', original_excerpt: 'excerpt-4', landing_line: "Don't overdo exercise, eating, drinking, or other basic physical needs." }
		},
		{
			day: 5,
			card_id: 'shortness-of-life-02-003',
			book_slug: 'shortness-of-life',
			author_slug: 'seneca',
			content: { format: 'wall', original_excerpt: 'excerpt-5', landing_line: 'We actually live only a small part of our lives.' }
		},
		{
			day: 6,
			card_id: 'enchiridion-27-001',
			book_slug: 'enchiridion',
			author_slug: 'epictetus',
			content: { format: 'wall', original_excerpt: 'excerpt-6', landing_line: "In the same way, evil doesn't exist in the world by nature." }
		},
		{
			day: 7,
			card_id: 'happy-life-03-004',
			book_slug: 'happy-life',
			author_slug: 'seneca',
			content: { format: 'wall', original_excerpt: 'excerpt-7', landing_line: 'Cruelty always comes from weakness.' }
		}
	]
};

let outDir: string;

beforeEach(async () => {
	outDir = await mkdtemp(path.join(tmpdir(), 'plain-weekly-prep-'));
});

afterEach(async () => {
	await rm(outDir, { recursive: true, force: true });
});

/** Writes an empty placeholder MP4 for every slot in `schedule`, matching what `cli.ts` would have rendered. */
async function writeRenderedVideos(schedule: WeekSchedule): Promise<void> {
	for (const slot of schedule.slots) {
		const date = weekDayToDate(schedule.week, slot.day);
		const { video } = renderAssetPaths(outDir, slot.content.format, date);
		await writeFile(video, 'fake video bytes');
	}
}

describe('prepareWeek', () => {
	it('prepares every day in a 7-slot schedule: 7 days, each with a video path and three captions', async () => {
		await writeRenderedVideos(SCHEDULE);

		const manifest = await prepareWeek({ schedule: SCHEDULE, outDir });

		expect(manifest.days).toHaveLength(SCHEDULE.slots.length);
		expect(manifest.days).toHaveLength(7);
		for (const day of manifest.days) {
			expect(day.videoPath.length).toBeGreaterThan(0);
			expect(Object.keys(day.captions).sort()).toEqual(['instagram', 'tiktok', 'youtube']);
			for (const caption of Object.values(day.captions)) {
				expect(typeof caption).toBe('string');
				expect(caption.length).toBeGreaterThan(0);
			}
		}
	});

	it('derives the day count from the schedule itself, not from a hard-coded SCHEDULE fixture', async () => {
		// A different 7-day schedule than the module-level SCHEDULE fixture
		// (different week number, card ids, and day order) — proves
		// `prepareWeek` reads days from whatever schedule it's given rather
		// than being coupled to a specific fixture shape.
		const otherSchedule: WeekSchedule = {
			...SCHEDULE,
			week: 2,
			slots: [...SCHEDULE.slots].reverse().map((slot) => ({ ...slot, card_id: `${slot.card_id}-w2` }))
		};
		await writeRenderedVideos(otherSchedule);

		const manifest = await prepareWeek({ schedule: otherSchedule, outDir });

		expect(manifest.days).toHaveLength(7);
	});

	it('refuses to prepare a short week — throws and writes no captions file when the schedule itself covers fewer than 7 days', async () => {
		const sixDaySchedule: WeekSchedule = { ...SCHEDULE, slots: SCHEDULE.slots.filter((s) => s.day !== 4) };
		await writeRenderedVideos(sixDaySchedule);

		await expect(prepareWeek({ schedule: sixDaySchedule, outDir })).rejects.toThrow(/short week/);

		await expect(readFile(path.join(outDir, 'captions.txt'))).rejects.toThrow();
	});

	it('resolves each day to its rendered MP4 via renderAssetPaths and weekDayToDate', async () => {
		await writeRenderedVideos(SCHEDULE);

		const manifest = await prepareWeek({ schedule: SCHEDULE, outDir });

		for (const slot of SCHEDULE.slots) {
			const expectedDate = weekDayToDate(SCHEDULE.week, slot.day);
			const expectedVideoPath = renderAssetPaths(outDir, 'wall', expectedDate).video;

			const day = manifest.days.find((d) => d.cardId === slot.card_id);
			expect(day).toBeDefined();
			expect(day?.date).toBe(expectedDate);
			expect(day?.videoPath).toBe(expectedVideoPath);
		}
	});

	it('fails clearly, naming the missing date, when a scheduled day has no rendered MP4', async () => {
		// Render every day except day 5.
		const missingDaySchedule: WeekSchedule = { ...SCHEDULE, slots: SCHEDULE.slots.filter((s) => s.day !== 5) };
		await writeRenderedVideos(missingDaySchedule);

		await expect(prepareWeek({ schedule: SCHEDULE, outDir })).rejects.toThrowError(
			new RegExp(weekDayToDate(SCHEDULE.week, 5))
		);
	});

	it('never prepares a short week — writes no captions file when any day is missing', async () => {
		const missingDaySchedule: WeekSchedule = { ...SCHEDULE, slots: SCHEDULE.slots.filter((s) => s.day !== 7) };
		await writeRenderedVideos(missingDaySchedule);

		await expect(prepareWeek({ schedule: SCHEDULE, outDir })).rejects.toThrow();

		await expect(readFile(path.join(outDir, 'captions.txt'))).rejects.toThrow();
	});

	it('writes captions.txt into outDir, alongside the rendered videos', async () => {
		await writeRenderedVideos(SCHEDULE);

		const manifest = await prepareWeek({ schedule: SCHEDULE, outDir });

		expect(manifest.captionsPath).toBe(path.join(outDir, 'captions.txt'));
		const contents = await readFile(manifest.captionsPath, 'utf-8');
		expect(contents.length).toBeGreaterThan(0);
	});

	it('lists every day in the captions file, labelled by date and card id, separated by a rule', async () => {
		await writeRenderedVideos(SCHEDULE);

		const manifest = await prepareWeek({ schedule: SCHEDULE, outDir });
		const contents = await readFile(manifest.captionsPath, 'utf-8');

		for (const slot of SCHEDULE.slots) {
			const date = weekDayToDate(SCHEDULE.week, slot.day);
			expect(contents).toContain(`${date} — ${slot.card_id}`);
		}
		expect(contents).toContain('\n\n---\n\n');
	});

	it("gives each day a distinct caption per platform, with the attribution URL matching that platform", async () => {
		await writeRenderedVideos(SCHEDULE);

		const manifest = await prepareWeek({ schedule: SCHEDULE, outDir });
		const contents = await readFile(manifest.captionsPath, 'utf-8');

		for (const day of manifest.days) {
			const { tiktok, instagram, youtube } = day.captions;
			// The bug this task fixes: every caption used to be built with
			// `platform: 'tiktok'` hardcoded, so all three were identical.
			expect(tiktok).not.toBe(instagram);
			expect(tiktok).not.toBe(youtube);
			expect(instagram).not.toBe(youtube);

			expect(tiktok).toContain(ATTRIBUTION_URLS.tiktok);
			expect(instagram).toContain(ATTRIBUTION_URLS.instagram);
			expect(youtube).toContain(ATTRIBUTION_URLS.youtube);
			expect(tiktok).not.toContain(ATTRIBUTION_URLS.instagram);
			expect(tiktok).not.toContain(ATTRIBUTION_URLS.youtube);
		}

		// And the file on disk actually carries all three, clearly labelled, per day.
		for (const day of manifest.days) {
			expect(contents).toContain(`[tiktok]\n${day.captions.tiktok}`);
			expect(contents).toContain(`[instagram]\n${day.captions.instagram}`);
			expect(contents).toContain(`[youtube]\n${day.captions.youtube}`);
		}
	});
});
