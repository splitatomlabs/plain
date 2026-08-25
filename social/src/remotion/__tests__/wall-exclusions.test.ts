/**
 * F05: proves the committed artifact `content/social/wall-exclusions.json`
 * (written by `social/scripts/write-wall-exclusions.ts`) matches what
 * `surveyWallPool()` computes RIGHT NOW against the real
 * `content/social/premises/wall.json` pool and `content/output/` corpus —
 * so a corpus edit, a re-scored Wall pool, or a `wall-gate.ts`/
 * `wall-timing.ts` constant change can never silently leave the committed
 * exclusion list stale (the scheduler, `scripts/lib/schedule.ts`, trusts
 * this file verbatim; a stale file would either schedule an un-renderable
 * card again or needlessly drop a now-renderable one).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surveyWallPool, type WallPoolEntry } from '../wall-pool.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../duration-bounds.js';
import { WALL_MIN_LEGIBLE_FONT_PX } from '../wall-gate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

interface WallPool {
	entries: WallPoolEntry[];
}

interface WallExclusionEntry {
	card_id: string;
	book_slug: string;
	axis: 'legibility' | 'duration';
	reason: string;
}

interface WallExclusionsFile {
	meta: {
		submitted: number;
		succeeded: number;
		dropped: number;
		limited: boolean;
		generated_at: string;
		max_post_duration_frames: number;
		max_post_duration_seconds: number;
		wall_min_legible_font_px: number;
	};
	entries: WallExclusionEntry[];
}

function loadWallPool(): WallPool {
	return JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'wall.json'), 'utf-8')
	) as WallPool;
}

function loadCommittedExclusions(): WallExclusionsFile {
	return JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'wall-exclusions.json'), 'utf-8')
	) as WallExclusionsFile;
}

describe('content/social/wall-exclusions.json matches surveyWallPool()', () => {
	const pool = loadWallPool();
	const committed = loadCommittedExclusions();
	const survey = surveyWallPool(pool.entries, outputDir);

	it('records the same constants the gate is currently computed against', () => {
		expect(committed.meta.max_post_duration_frames).toBe(MAX_POST_DURATION_FRAMES);
		expect(committed.meta.max_post_duration_seconds).toBe(MAX_POST_DURATION_SECONDS);
		expect(committed.meta.wall_min_legible_font_px).toBe(WALL_MIN_LEGIBLE_FONT_PX);
	});

	it('meta counts match a fresh survey of the same pool', () => {
		expect(committed.meta.submitted).toBe(pool.entries.length);
		expect(committed.meta.succeeded).toBe(survey.passed);
		expect(committed.meta.dropped).toBe(survey.rejectedForLegibility + survey.rejectedForDuration);
		expect(committed.entries.length).toBe(committed.meta.dropped);
	});

	it('the exact set of excluded ids matches a fresh survey — the committed artifact is not stale', () => {
		const committedIds = new Set(committed.entries.map((e) => e.card_id));
		const surveyedIds = new Set(survey.rejectedIds);
		expect(committedIds).toEqual(surveyedIds);
	});

	it('every committed exclusion carries the same axis a fresh survey reports for that card', () => {
		const freshAxisById = new Map(survey.rejections.map((r) => [r.card_id, r.axis]));
		for (const entry of committed.entries) {
			expect(freshAxisById.get(entry.card_id)).toBe(entry.axis);
		}
	});

	it('includes the real over-long card this fix targets (on-anger-03-027)', () => {
		const entry = committed.entries.find((e) => e.card_id === 'on-anger-03-027');
		expect(entry).toBeDefined();
		expect(entry?.axis).toBe('duration');
	});
});
