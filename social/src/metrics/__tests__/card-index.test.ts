/**
 * Tests for `card-index.ts` — resolving a post's publish date back to the
 * card it was built from.
 *
 * The property that matters: the readout's two human-read outputs (the
 * top-posts list and the criterion-A verdict sentence) must name the
 * PREMISE, because "rebuild around whatever premise did it" is what the
 * pre-registered criterion asks of whoever reads them. A bare platform id
 * answers the wrong question.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { buildCardIndex, cardIdForPublishedAt } from '../card-index.js';
import { PILOT_WEEK_1_START, weekDayToDate } from '../../pilot-config.js';

let scheduleDir: string;

beforeEach(async () => {
	scheduleDir = await mkdtemp(path.join(tmpdir(), 'plain-card-index-'));
});

afterEach(async () => {
	await rm(scheduleDir, { recursive: true, force: true });
});

async function writeSchedule(week: number, cardIds: string[], overrides: Record<string, unknown> = {}): Promise<void> {
	const file = `pilot-schedule-w${String(week).padStart(2, '0')}.json`;
	await writeFile(
		path.join(scheduleDir, file),
		JSON.stringify({
			week,
			seed: 1,
			slots: cardIds.map((card_id, i) => ({
				day: i + 1,
				card_id,
				book_slug: 'meditations',
				author_slug: 'marcus-aurelius',
				content: { format: 'wall', original_excerpt: 'x', landing_line: 'y' }
			})),
			...overrides
		}),
		'utf-8'
	);
}

describe('buildCardIndex', () => {
	it('maps each scheduled day to its card, anchored at the pilot start date', async () => {
		await writeSchedule(1, ['card-a', 'card-b', 'card-c']);
		const index = await buildCardIndex(scheduleDir);

		expect(index.get(PILOT_WEEK_1_START)).toBe('card-a');
		expect(index.get(weekDayToDate(1, 2))).toBe('card-b');
		expect(index.get(weekDayToDate(1, 3))).toBe('card-c');
	});

	it('spans multiple weeks without collision', async () => {
		await writeSchedule(1, ['w1d1']);
		await writeSchedule(2, ['w2d1']);
		const index = await buildCardIndex(scheduleDir);

		expect(index.get(weekDayToDate(1, 1))).toBe('w1d1');
		expect(index.get(weekDayToDate(2, 1))).toBe('w2d1');
	});

	// The readout must still produce a verdict on a checkout with no
	// schedules — naming platform ids only is a degraded label, not a
	// failure.
	it('returns an empty map for a missing directory rather than throwing', async () => {
		const index = await buildCardIndex(path.join(scheduleDir, 'nope'));
		expect(index.size).toBe(0);
	});

	it('ignores non-schedule files in the directory', async () => {
		await writeSchedule(1, ['card-a']);
		await writeFile(path.join(scheduleDir, 'rejected-cards.json'), '{"meta":{},"wall":[]}', 'utf-8');
		await writeFile(path.join(scheduleDir, 'pilot-review-w01.md'), '# note', 'utf-8');

		const index = await buildCardIndex(scheduleDir);
		expect(index.size).toBe(1);
	});

	// A week field disagreeing with the filename would silently map that
	// week's cards onto the wrong calendar dates — mislabelling every post.
	it('throws when a schedule file\'s week disagrees with its filename', async () => {
		await writeSchedule(1, ['card-a'], { week: 3 });
		await expect(buildCardIndex(scheduleDir)).rejects.toThrow(/filename says week 1/);
	});
});

describe('cardIdForPublishedAt', () => {
	it('resolves an ISO instant by its date part', () => {
		const index = new Map([['2026-09-14', 'meditations-09-025']]);
		expect(cardIdForPublishedAt('2026-09-14T11:30:00.000Z', index)).toBe('meditations-09-025');
	});

	it('returns null for a date no schedule covers', () => {
		expect(cardIdForPublishedAt('1999-01-01T00:00:00.000Z', new Map([['2026-09-14', 'x']]))).toBeNull();
	});

	it('returns null when no index was supplied at all', () => {
		expect(cardIdForPublishedAt('2026-09-14T11:30:00.000Z', undefined)).toBeNull();
	});
});
