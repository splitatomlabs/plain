import path from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { R2Config } from '../env.js';
import { publicUrlFor, tiktokStagingKeyFor } from '../storage.js';
import type { PendingYouTubeFlip } from '../tiktok-manual.js';
import { stageTikTokWeek } from '../tiktok-manual.js';
import { renderAssetPaths } from '../../cli-plan.js';
import { weekDayToDate } from '../../pilot-config.js';
import type { WeekSchedule } from '../../schedule-types.js';

vi.mock('node:fs/promises', () => ({
	readFile: vi.fn().mockResolvedValue(Buffer.from('fake video bytes'))
}));

const existsSyncMock = vi.fn();
vi.mock('node:fs', () => ({
	existsSync: (...args: unknown[]) => existsSyncMock(...args)
}));

const CONFIG: R2Config = {
	accountId: 'test-account-id',
	bucketName: 'plain-social-media',
	accessKeyId: 'test-access-key-id',
	secretAccessKey: 'super-secret-value-do-not-log',
	publicBaseUrl: 'https://media.thinkplain.ai'
};

const OUT_DIR = '/fake/out';

function fakeClient() {
	return { send: vi.fn().mockResolvedValue({}) };
}

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

const PENDING_FLIPS: PendingYouTubeFlip[] = [
	{ date: '2026-09-01', cardId: 'meditations-09-025', videoId: 'yt-video-1' },
	{ date: '2026-09-02', cardId: 'on-anger-02-054', videoId: 'yt-video-2' }
];

describe('stageTikTokWeek', () => {
	it('stages every day in a 7-slot schedule: 7 videos, 7 captions, and the pending-flip list', async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		const manifest = await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: PENDING_FLIPS
		});

		expect(manifest.days).toHaveLength(SCHEDULE.slots.length);
		expect(manifest.days).toHaveLength(7);
		for (const day of manifest.days) {
			expect(typeof day.caption).toBe('string');
			expect(day.caption.length).toBeGreaterThan(0);
		}
		expect(manifest.pendingYouTubeFlips).toBe(PENDING_FLIPS);
		expect(manifest.pendingYouTubeFlips).toHaveLength(2);
	});

	it('derives the count from the schedule, not a hard-coded constant', async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		const threeDaySchedule: WeekSchedule = { ...SCHEDULE, slots: SCHEDULE.slots.slice(0, 3) };

		const manifest = await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: threeDaySchedule,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		expect(manifest.days).toHaveLength(3);
	});

	it('resolves each day to its rendered MP4 via renderAssetPaths and weekDayToDate', async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		const manifest = await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		for (const slot of SCHEDULE.slots) {
			const expectedDate = weekDayToDate(SCHEDULE.week, slot.day);
			const expectedVideoPath = renderAssetPaths(OUT_DIR, 'wall', expectedDate).video;
			const expectedKey = tiktokStagingKeyFor(weekDayToDate(SCHEDULE.week, 1), path.basename(expectedVideoPath));
			const expectedUrl = publicUrlFor(CONFIG, expectedKey);

			const day = manifest.days.find((d) => d.cardId === slot.card_id);
			expect(day).toBeDefined();
			expect(day?.date).toBe(expectedDate);
			expect(day?.videoUrl).toBe(expectedUrl);
		}
	});

	it('fails clearly, naming the missing date, when a scheduled day has no rendered MP4', async () => {
		existsSyncMock.mockImplementation((filePath: unknown) => {
			const missingDate = weekDayToDate(SCHEDULE.week, 5);
			return !String(filePath).includes(missingDate);
		});
		const client = fakeClient();

		await expect(
			stageTikTokWeek({
				client: client as never,
				config: CONFIG,
				schedule: SCHEDULE,
				outDir: OUT_DIR,
				pendingYouTubeFlips: []
			})
		).rejects.toThrowError(new RegExp(weekDayToDate(SCHEDULE.week, 5)));

		expect(client.send).not.toHaveBeenCalled();
	});

	it('never stages a short week — no upload happens when any day is missing', async () => {
		existsSyncMock.mockImplementation((filePath: unknown) => !String(filePath).includes('2026-09-07'));
		const client = fakeClient();

		await expect(
			stageTikTokWeek({
				client: client as never,
				config: CONFIG,
				schedule: SCHEDULE,
				outDir: OUT_DIR,
				pendingYouTubeFlips: []
			})
		).rejects.toThrow();

		expect(client.send).not.toHaveBeenCalled();
	});

	it('uploads every object with an explicit content-type', async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		// 7 videos + 1 captions file.
		expect(client.send).toHaveBeenCalledTimes(8);
		for (const call of client.send.mock.calls) {
			const input = call[0].input;
			expect(input.ContentType).toBeTruthy();
		}
	});

	it("uploads videos as video/mp4 and the captions file as text/plain", async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		const contentTypes = client.send.mock.calls.map((call) => call[0].input.ContentType as string);
		expect(contentTypes.filter((t) => t === 'video/mp4')).toHaveLength(7);
		expect(contentTypes.filter((t) => t === 'text/plain')).toHaveLength(1);
	});

	it("the manifest's video links match publicUrlFor output", async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		const manifest = await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		for (const day of manifest.days) {
			expect(day.videoUrl.startsWith(publicUrlFor(CONFIG, ''))).toBe(true);
		}
	});

	it("the manifest's captions link matches publicUrlFor output", async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		const manifest = await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		const weekStartDate = weekDayToDate(SCHEDULE.week, 1);
		const expectedKey = tiktokStagingKeyFor(weekStartDate, 'captions.txt');
		expect(manifest.captionsUrl).toBe(publicUrlFor(CONFIG, expectedKey));
	});

	it('stages every file under the same week-start-dated folder', async () => {
		existsSyncMock.mockReturnValue(true);
		const client = fakeClient();

		await stageTikTokWeek({
			client: client as never,
			config: CONFIG,
			schedule: SCHEDULE,
			outDir: OUT_DIR,
			pendingYouTubeFlips: []
		});

		const weekStartDate = weekDayToDate(SCHEDULE.week, 1);
		for (const call of client.send.mock.calls) {
			const key = call[0].input.Key as string;
			expect(key.startsWith(`tiktok-staging/${weekStartDate}/`)).toBe(true);
		}
	});

	it('never logs or throws with a credential in the message', async () => {
		existsSyncMock.mockImplementation(() => false);
		const client = fakeClient();
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

		try {
			await expect(
				stageTikTokWeek({
					client: client as never,
					config: CONFIG,
					schedule: SCHEDULE,
					outDir: OUT_DIR,
					pendingYouTubeFlips: []
				})
			).rejects.toThrow();
		} finally {
			for (const spy of [consoleSpy, logSpy]) {
				for (const call of spy.mock.calls) {
					expect(JSON.stringify(call)).not.toContain(CONFIG.secretAccessKey);
					expect(JSON.stringify(call)).not.toContain(CONFIG.accessKeyId);
				}
			}
			consoleSpy.mockRestore();
			logSpy.mockRestore();
		}
	});
});
