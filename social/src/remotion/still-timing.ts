/**
 * Pure timing/geometry math for The Still composition (see `Still.tsx`) —
 * social pilot 02 F19.
 *
 * The Still is the read-through's FALLBACK format, reached only when a card
 * can render as none of Wall/Question/Objection (see
 * `scripts/lib/schedule.ts`'s `resolveReadThrough`, the root pipeline's
 * cascade). It has exactly one phase: the card's `plain_english`, verbatim,
 * set on warm paper, motionless, for the WHOLE post — no wall, no reveal, no
 * second phase. That makes this module the simplest of the four: there is no
 * per-card branching (`WallLayout`'s scroll geometry, `QuestionTimingSchedule`'s
 * variable wall-phase length, `ObjectionTimingSchedule`'s fixed two-reply-line
 * shape) — only a single motionless window, held for the whole composition.
 *
 * Duration: the Still has no natural length of its own the way The Wall's
 * narration-driven schedule does — it is ALL payoff, so its raw length before
 * padding is 0 frames, and `padToMinimumDuration` (the same 15s floor every
 * other format clears via padding) does the entire job of deciding how long
 * it holds: every Still runs for exactly `MIN_POST_DURATION_FRAMES` (15s).
 *
 * Nothing here touches React, Remotion's runtime, or the DOM — mirrors
 * `wall-timing.ts`/`question-timing.ts`/`objection-timing.ts`'s own
 * discipline, so this module is directly unit-testable and safe to bundle
 * into Remotion's browser-side webpack build.
 */

import { fitFontSize, type FitResult } from '../render/fit.js';
import { padToMinimumDuration } from './duration-bounds.js';
import { FPS, FRAME_WIDTH, FRAME_HEIGHT, PAYOFF_BOX_WIDTH, PAYOFF_PADDING_X, PAYOFF_LINE_HEIGHT_RATIO } from './wall-timing.js';

// Re-exported so `Still.tsx` and `still-gate.ts` can import everything they
// need from this module's "timing" surface without also reaching into
// `wall-timing.ts` directly for the shared frame-rate/frame-size constants —
// mirrors `objection-timing.ts`'s own re-export block.
export { FPS, FRAME_WIDTH, FRAME_HEIGHT } from './wall-timing.js';

// ---------------------------------------------------------------------------
// Layout — the whole card's plain_english, set in one centred block
// ---------------------------------------------------------------------------

/**
 * Horizontal margins and box width are shared verbatim with every other
 * still, centred payoff text in this workspace (`PayoffLine` in `Wall.tsx`,
 * reused by The Objection's reply lines and The Question's answer) — same
 * paper, same margins, same face, so a viewer never sees the Still as a
 * visually different channel. See `fitFontSize`, not a fourth fitting
 * routine of its own.
 */
export const STILL_BOX_PADDING_X = PAYOFF_PADDING_X;
export const STILL_BOX_WIDTH = PAYOFF_BOX_WIDTH;

/**
 * Taller than `PAYOFF_BOX_HEIGHT` (800px, sized for one held sentence) —
 * the Still holds the ENTIRE plain_english passage (measured across the
 * real Meditations book-02/03 slice: 37-156 words), not one line, so its
 * box needs real vertical room. `FRAME_HEIGHT` is 1920; 1600 leaves a
 * generous, symmetric top/bottom margin around the fitted block (more when
 * the block is short) while keeping clear of the read-through counter's own
 * top-left inset.
 */
export const STILL_BOX_HEIGHT = 1600;

/**
 * `fitFontSize`'s own default floor (20) — deliberately far below
 * `STILL_MIN_LEGIBLE_FONT_PX` (see `still-gate.ts`), so a card that cannot
 * fit at any legible size still resolves to SOME numeric font size (rather
 * than `fitFontSize` itself throwing), letting `gateStillCard` reject it by
 * comparing the fitted size against the legibility floor — same pattern as
 * `OBJECTION_MIN_FONT`/`OBJECTION_MIN_LEGIBLE_FONT_PX` in `objection-gate.ts`.
 */
export const STILL_MIN_FONT = 20;
/** Same display cap as a single held payoff line — a short card should never read as large-print. */
export const STILL_MAX_FONT = 88;
export const STILL_LINE_HEIGHT_RATIO = PAYOFF_LINE_HEIGHT_RATIO;

export interface StillLayout {
	fontSize: number;
	lineHeight: number;
	boxWidth: number;
	boxHeight: number;
	/** `false` when even `STILL_MIN_FONT` overflows `STILL_BOX_HEIGHT` — see `fitFontSize`'s own `fits` field. */
	fits: boolean;
}

/**
 * Resolves the Still's exact font size for `text` (the card's verbatim
 * `plain_english`), packed into `STILL_BOX_WIDTH`x`STILL_BOX_HEIGHT`.
 * `Still.tsx` must render with exactly this number, not recompute its own
 * fit — mirrors `computeObjectionLayout`/`computeQuestionLayout`'s role in
 * their own modules.
 */
export function computeStillLayout(text: string): StillLayout {
	const fit: FitResult = fitFontSize(text, {
		maxWidth: STILL_BOX_WIDTH,
		maxHeight: STILL_BOX_HEIGHT,
		minFont: STILL_MIN_FONT,
		maxFont: STILL_MAX_FONT,
		lineHeightRatio: STILL_LINE_HEIGHT_RATIO
	});

	return {
		fontSize: fit.fontSize,
		lineHeight: fit.lineHeight,
		boxWidth: STILL_BOX_WIDTH,
		boxHeight: STILL_BOX_HEIGHT,
		fits: fit.fits
	};
}

// ---------------------------------------------------------------------------
// Timing — one motionless phase, the whole post
// ---------------------------------------------------------------------------

export interface StillPhaseWindow {
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
	/** Always `true` — the Still never moves anything, ever (the plain side of the house rule, at its purest). */
	motionless: true;
}

export interface StillTimingSchedule {
	totalFrames: number;
	/** The one phase this format has: the whole composition, held motionless. */
	still: StillPhaseWindow;
}

/**
 * Computes The Still's only frame boundary. Takes no per-card input —
 * unlike every other format's `compute*Timing`, nothing about the Still's
 * SCHEDULE varies by card content (only its `computeStillLayout` font size
 * does): the whole post is one held frame, padded to the 15s floor. See the
 * module doc comment for why `padToMinimumDuration(0)` is the entire
 * computation.
 */
export function computeStillTiming(): StillTimingSchedule {
	const { totalFrames } = padToMinimumDuration(0);
	return {
		totalFrames,
		still: { startFrame: 0, endFrame: totalFrames, motionless: true }
	};
}
