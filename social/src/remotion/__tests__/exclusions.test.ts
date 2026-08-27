/**
 * F05: proves the committed artifact `content/social/render-exclusions.json`
 * (written by `social/scripts/write-exclusions.ts`) matches what freshly
 * running the Wall gate computes RIGHT NOW against the real
 * `content/social/premises/wall.json` pool and `content/output/` corpus — so
 * a corpus edit, a re-scored pool, or a `wall-gate.ts` constant change can
 * never silently leave the committed exclusion list stale (the scheduler,
 * `scripts/lib/schedule.ts`, trusts this file verbatim; a stale file would
 * either schedule an un-renderable card again or needlessly drop a
 * now-renderable one).
 *
 * Pf39c2-social-pilot-02a D01/D02/D04: Question, Objection and the
 * read-through were deleted outright — the channel is one pool-drawn Wall a
 * day — so their exclusion-survey proofs (against
 * `content/social/premises/{question,objection}.json`, both deleted, and the
 * read-through's own `read_through` section of this artifact, which D04's
 * regeneration no longer writes at all) are gone too, not merely skipped.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surveyWallPool, type WallPoolEntry } from '../wall-pool.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../duration-bounds.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

interface PoolFile<T> {
	entries: T[];
}

interface ExclusionEntry {
	card_id: string;
	book_slug: string;
	axis: string;
	reason: string;
}

interface ExclusionsFile {
	meta: {
		generated_at: string;
		max_post_duration_frames: number;
		max_post_duration_seconds: number;
		wall: { submitted: number; succeeded: number; dropped: number };
	};
	wall: ExclusionEntry[];
}

function loadJson<T>(...parts: string[]): T {
	return JSON.parse(readFileSync(path.join(repoRoot, ...parts), 'utf-8')) as T;
}

const wallPool = loadJson<PoolFile<WallPoolEntry>>('content', 'social', 'premises', 'wall.json');
const committed = loadJson<ExclusionsFile>('content', 'social', 'render-exclusions.json');

describe('content/social/render-exclusions.json matches a fresh survey — Wall', () => {
	const survey = surveyWallPool(wallPool.entries, outputDir);

	it('records the same constants the gate is currently computed against', () => {
		expect(committed.meta.max_post_duration_frames).toBe(MAX_POST_DURATION_FRAMES);
		expect(committed.meta.max_post_duration_seconds).toBe(MAX_POST_DURATION_SECONDS);
	});

	it('meta counts match a fresh survey of the same pool', () => {
		expect(committed.meta.wall.submitted).toBe(wallPool.entries.length);
		expect(committed.meta.wall.succeeded).toBe(survey.passed);
		expect(committed.meta.wall.dropped).toBe(survey.rejectedForDuration);
		expect(committed.wall.length).toBe(committed.meta.wall.dropped);
	});

	it('the exact set of excluded ids matches a fresh survey — the committed artifact is not stale', () => {
		const committedIds = new Set(committed.wall.map((e) => e.card_id));
		const surveyedIds = new Set(survey.rejectedIds);
		expect(committedIds).toEqual(surveyedIds);
	});

	it('every committed exclusion carries the same axis a fresh survey reports for that card', () => {
		const freshAxisById = new Map(survey.rejections.map((r) => [r.card_id, r.axis]));
		for (const entry of committed.wall) {
			expect(freshAxisById.get(entry.card_id)).toBe(entry.axis);
		}
	});

	// Pf39c2-social-pilot-02a V10: deleted "includes the real over-long card
	// this fix targets (on-anger-03-027)", which asserted the committed
	// exclusions file still carried a `duration`-axis entry for that card.
	// V02 added a <=5-payoff-screen cap to `wallGate`; `on-anger-03-027`'s
	// payoff runs past 5 screens, so it no longer survives the gate at all
	// and isn't in `content/social/premises/wall.json`'s 168 entries any
	// more (confirmed by loading the committed pool file directly) — it
	// can't appear in a *duration* exclusion for a pool it was never
	// admitted to. V04 also measured that the duration axis rejects nothing
	// at <=5 screens (a 5-screen payoff tops out around 17.5s against the
	// 40s ceiling), so `committed.wall` is now empty; the "meta counts
	// match" and "exact set of excluded ids matches" tests above already
	// guard that the (now-empty) committed list stays truthful to a fresh
	// survey, which is the property this file exists to protect.
});

// Pf39c2-social-pilot-02a D01/D02/D04: Question, Objection and the
// read-through were deleted outright — the channel is one pool-drawn Wall a
// day. This file used to also carry a "read-through slice (F06/M2)" describe
// block that independently re-derived the read-through's own landing-line
// exclusions; that whole mechanism (`read_through_book`/`read_through_chapters`/
// `read_through` in the committed artifact's meta, and `scripts/lib/
// schedule.ts`'s `tryReadThroughContent`) no longer exists, so the block was
// deleted outright rather than adapted — there is nothing left for it to
// prove.
