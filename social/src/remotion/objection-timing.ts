/**
 * Pure timing/geometry math for The Objection composition (see
 * `Objection.tsx`).
 *
 * Same discipline as `wall-timing.ts` and `question-timing.ts`: nothing
 * here touches React, Remotion's runtime, or the DOM, so the whole
 * schedule is unit-testable without rendering a single frame.
 * `Objection.tsx` turns these frame numbers into JSX and never recomputes
 * its own boundaries.
 *
 * Unlike The Wall and The Question, The Objection has no variable-length
 * "moving wall" phase and no variable count of payoff lines: the gate
 * (`objection-gate.ts`) caps the reply at EXACTLY two sentences and rejects
 * anything that cannot be cleanly reduced to that shape, so this schedule
 * is fixed — the objection hold, then exactly two reply-line holds. There
 * is no per-card branching here the way `computeWallTiming`'s `restLines`
 * or `computeQuestionTiming`'s wall-phase length require.
 */

import { fitFontSize } from '../render/fit.js';
import { FPS, FRAME_WIDTH } from './wall-timing.js';

// Re-exported so `Objection.tsx` and callers can import everything they
// need from this module's "timing" surface without also reaching into
// `wall-timing.ts` directly for the shared frame-rate/frame-size constants.
export { FPS, FRAME_WIDTH } from './wall-timing.js';

// ---------------------------------------------------------------------------
// Phase 1 — the objection alone, still (frame 0)
// ---------------------------------------------------------------------------

/**
 * How long the objection is held alone, motionless, before the reply
 * begins. Set to the house rule's general payoff-frame floor (>= 2.5s) —
 * The Objection has no format-specific "readable in N seconds" acceptance
 * clause the way The Question does (1.5s, tied to its own acceptance
 * criterion), so this defaults to the same floor every other still payoff
 * frame in this workspace is held to (see `ANSWER_MIN_SECONDS` in
 * `question-timing.ts`, `LANDING_LINE_SECONDS` in `wall-timing.ts`).
 */
export const OBJECTION_MIN_SECONDS = 2.5;
export const OBJECTION_HOLD_SECONDS = 2.5;
export const OBJECTION_HOLD_FRAMES = Math.round(OBJECTION_HOLD_SECONDS * FPS);

export const OBJECTION_BOX_PADDING_X = 120;
export const OBJECTION_BOX_WIDTH = FRAME_WIDTH - 2 * OBJECTION_BOX_PADDING_X;
/** Generous vertical budget — a single thought set large, not a wall of text. */
export const OBJECTION_BOX_HEIGHT = 700;

export const OBJECTION_MIN_FONT = 48;
export const OBJECTION_MAX_FONT = 120;
/** Comfortable reading spacing — this is a still, readable line, not dense set type. */
export const OBJECTION_LINE_HEIGHT_RATIO = 1.35;

/**
 * Wraps `objection` in the straight double quotes it renders inside at
 * frame 0. The ONE place this quoting happens — `Objection.tsx` renders
 * exactly this string and `computeObjectionLayout` fits exactly this
 * string, so gate, layout and render can never disagree about how much
 * text (quotes included) has to fit in the box.
 */
export function quoteObjection(objection: string): string {
	return `"${objection}"`;
}

export interface ObjectionLayout {
	fontSize: number;
	lineHeight: number;
	boxWidth: number;
	boxHeight: number;
}

/**
 * Resolves frame 0's exact font size for `objection` (quotes included),
 * packed into `OBJECTION_BOX_WIDTH`x`OBJECTION_BOX_HEIGHT`. `Objection.tsx`
 * must render with exactly this number, not recompute its own fit —
 * mirrors `computeQuestionLayout`'s role in `question-timing.ts`.
 */
export function computeObjectionLayout(objection: string): ObjectionLayout {
	const fit = fitFontSize(quoteObjection(objection), {
		maxWidth: OBJECTION_BOX_WIDTH,
		maxHeight: OBJECTION_BOX_HEIGHT,
		minFont: OBJECTION_MIN_FONT,
		maxFont: OBJECTION_MAX_FONT,
		lineHeightRatio: OBJECTION_LINE_HEIGHT_RATIO
	});

	return {
		fontSize: fit.fontSize,
		lineHeight: fit.lineHeight,
		boxWidth: OBJECTION_BOX_WIDTH,
		boxHeight: OBJECTION_BOX_HEIGHT
	};
}

// ---------------------------------------------------------------------------
// Phase 2 — the reply resolves in stillness, one line at a time
// ---------------------------------------------------------------------------

/**
 * The gate caps the reply at exactly this many sentences (see
 * `objection-gate.ts`'s two-sentence cap) — never more, never fewer, or
 * the card is rejected before it reaches this schedule.
 */
export const OBJECTION_REPLY_LINE_COUNT = 2;

/** The house rule's floor for a payoff frame: motionless, held >= 2.5s. */
export const OBJECTION_REPLY_MIN_SECONDS = 2.5;
export const OBJECTION_REPLY_LINE_SECONDS = 2.5;
export const OBJECTION_REPLY_LINE_FRAMES = Math.round(OBJECTION_REPLY_LINE_SECONDS * FPS);

// ---------------------------------------------------------------------------
// Full schedule
// ---------------------------------------------------------------------------

export interface ObjectionPhaseWindow {
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
	/** True if nothing may move, fade, or otherwise animate during this window. */
	motionless: boolean;
}

export interface ObjectionTimingSchedule {
	totalFrames: number;
	/** Phase 1 — the objection alone, still. Zero motion at frame 0. */
	objection: ObjectionPhaseWindow;
	/**
	 * Phase 2 — the reply resolves in stillness, one line at a time. Always
	 * exactly `OBJECTION_REPLY_LINE_COUNT` (2) windows, each held for
	 * `OBJECTION_REPLY_LINE_FRAMES` — see this module's top-of-file comment
	 * on why the count is fixed rather than derived per card.
	 */
	replyLines: [ObjectionPhaseWindow, ObjectionPhaseWindow];
}

/**
 * Computes every frame boundary of The Objection. The only place in this
 * composition where phase lengths are decided — `Objection.tsx` reads the
 * result and never computes a frame boundary itself. Takes no per-card
 * input because, unlike `computeWallTiming`/`computeQuestionTiming`, none
 * of these boundaries vary by card content — the gate has already reduced
 * every renderable card to the same fixed shape (one held objection, two
 * held reply lines) before this schedule is ever consulted.
 */
export function computeObjectionTiming(): ObjectionTimingSchedule {
	const objection: ObjectionPhaseWindow = {
		startFrame: 0,
		endFrame: OBJECTION_HOLD_FRAMES,
		motionless: true
	};

	const firstReplyLine: ObjectionPhaseWindow = {
		startFrame: objection.endFrame,
		endFrame: objection.endFrame + OBJECTION_REPLY_LINE_FRAMES,
		motionless: true
	};

	const secondReplyLine: ObjectionPhaseWindow = {
		startFrame: firstReplyLine.endFrame,
		endFrame: firstReplyLine.endFrame + OBJECTION_REPLY_LINE_FRAMES,
		motionless: true
	};

	return {
		totalFrames: secondReplyLine.endFrame,
		objection,
		replyLines: [firstReplyLine, secondReplyLine]
	};
}
