/**
 * social pilot 02a U02 (2026-08-27) — corpus-wide non-collision proof for
 * the read-through counter's new CENTRED-BELOW-TEXT placement.
 *
 * `wall-timing.ts`'s own module-level invariant already proves the safety
 * bound THEORETICALLY (any payoff text, at `PAYOFF_BOX_HEIGHT`'s hard
 * ceiling, still clears the bottom platform-chrome band) — this file proves
 * it EMPIRICALLY, against the real content this workspace actually ships:
 * every landing line and every real read-through rest line in
 * `content/social/premises/wall.json`/`content/output/meditations`. Pure
 * computation — no rendering, no bundling — so this runs in milliseconds,
 * unlike the pixel-proof suites in `counter.test.ts`/`source-head.test.ts`.
 *
 * Pf39c2-social-pilot-02a D01: this used to also corpus-prove Question
 * answers and Objection reply lines; both formats were deleted outright, so
 * only the Wall corpus proof remains.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computePayoffCounterBox, FRAME_HEIGHT } from '../wall-timing.js';
import { COUNTER_BOTTOM_UNSAFE_ZONE_PX, COUNTER_BELOW_TEXT_BOX_WIDTH_PX, COUNTER_GAP_BELOW_TEXT_PX } from '../counter-layout.js';
import { SOURCE_HEAD_BOUNDING_BOX } from '../source-head-layout.js';
import { computeWallPlainLines } from '../../cli-plan.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

const UNSAFE_BELOW_PX = FRAME_HEIGHT - COUNTER_BOTTOM_UNSAFE_ZONE_PX;
const PLATE_BOTTOM_PX = SOURCE_HEAD_BOUNDING_BOX.top + SOURCE_HEAD_BOUNDING_BOX.height;

/** Fails loudly (rather than silently passing on an empty corpus) — same discipline `wall-timing.test.ts`'s own corpus checks use. */
function expectNonEmpty(label: string, length: number): void {
	expect(length, `${label} must be non-empty for this to be a real corpus proof`).toBeGreaterThan(0);
}

/**
 * Every assertion this file makes about a single payoff text — factored out
 * so the three corpora below (Wall/Question/Objection) all get the exact
 * same checks, not three hand-copied variants that could drift apart.
 */
function assertCounterBoxIsSafe(text: string, note: string): void {
	const box = computePayoffCounterBox(text);

	// Clear of the bottom platform-chrome band.
	expect(box.top + box.height, `${note}: counter box bottom edge`).toBeLessThanOrEqual(UNSAFE_BELOW_PX);
	// Clear of the running-head/payoff-label plate above it.
	expect(box.top, `${note}: counter box top edge`).toBeGreaterThan(PLATE_BOTTOM_PX);
	// Horizontally centred: the box itself is centred on the frame's own
	// midline (left + width/2 === FRAME_WIDTH/2), regardless of text length.
	expect(box.left + box.width / 2, `${note}: counter box horizontal centre`).toBeCloseTo(540, 5);
	expect(box.width, `${note}: counter box width`).toBe(COUNTER_BELOW_TEXT_BOX_WIDTH_PX);
}

describe('U02 corpus proof — Wall landing lines (content/social/premises/wall.json)', () => {
	const pool = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'wall.json'), 'utf-8')
	) as { entries: Array<{ card_id: string; landing_line: string }> };

	it('every real landing line in the Wall pool keeps the counter clear of both the plate and the bottom chrome band', () => {
		expectNonEmpty('wall.json entries', pool.entries.length);
		for (const entry of pool.entries) {
			assertCounterBoxIsSafe(entry.landing_line, `wall landing line (${entry.card_id})`);
		}
	});
});

describe('U02 corpus proof — Wall rest lines (the real read-through slice, Meditations book-02/03)', () => {
	const pool = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'wall.json'), 'utf-8')
	) as { entries: Array<{ card_id: string; landing_line: string }> };
	const landingLineByCardId = new Map(pool.entries.map((entry) => [entry.card_id, entry.landing_line]));

	function loadRestLines(bookSlug: string, chapterFile: string): Array<{ cardId: string; text: string }> {
		const cards = JSON.parse(
			readFileSync(path.join(repoRoot, 'content', 'output', bookSlug, chapterFile), 'utf-8')
		) as Array<{ id: string; plain_english: string }>;
		const restLines: Array<{ cardId: string; text: string }> = [];
		for (const card of cards) {
			const landingLine = landingLineByCardId.get(card.id);
			if (!landingLine) continue; // not every card made the Wall pool — same filter wall-timing.test.ts's own corpus checks use
			const plainLines = computeWallPlainLines(card.plain_english, landingLine);
			for (const line of plainLines) {
				restLines.push({ cardId: card.id, text: line });
			}
		}
		return restLines;
	}

	const restLines = [...loadRestLines('meditations', 'book-02.json'), ...loadRestLines('meditations', 'book-03.json')];

	it('every real rest line in the read-through book keeps the counter clear of both the plate and the bottom chrome band', () => {
		expectNonEmpty('read-through rest lines', restLines.length);
		for (const { cardId, text } of restLines) {
			assertCounterBoxIsSafe(text, `wall rest line (${cardId})`);
		}
	});

	it('the longest real rest line in this slice is close to, but under, PAYOFF_BOX_HEIGHT’s hard ceiling (empirical confirmation the theoretical worst case is not merely academic)', () => {
		let longest = { height: 0, cardId: '' };
		for (const { cardId, text } of restLines) {
			const box = computePayoffCounterBox(text);
			// box.top = FRAME_HEIGHT/2 + blockHeight/2 + GAP, so back out blockHeight for reporting.
			const blockHeight = (box.top - FRAME_HEIGHT / 2 - COUNTER_GAP_BELOW_TEXT_PX) * 2;
			if (blockHeight > longest.height) longest = { height: blockHeight, cardId };
		}
		expect(longest.height).toBeGreaterThan(600); // genuinely exercises a tall block, not a trivial one-liner
		expect(longest.height).toBeLessThanOrEqual(800); // PAYOFF_BOX_HEIGHT
	});
});

// Pf39c2-social-pilot-02a D01: Question, Objection and Still were deleted
// outright — the channel is one Wall a day — so their corpus proofs
// (question.json answers, objection.json reply lines) are gone too.
