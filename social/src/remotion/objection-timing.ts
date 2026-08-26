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
import { FPS, FRAME_WIDTH, type NarrationLineTiming } from './wall-timing.js';
import { padToMinimumDuration } from './duration-bounds.js';

// Re-exported so `Objection.tsx` and callers can import everything they
// need from this module's "timing" surface without also reaching into
// `wall-timing.ts` directly for the shared frame-rate/frame-size constants.
export { FPS, FRAME_WIDTH, type NarrationLineTiming } from './wall-timing.js';

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
/** `OBJECTION_REPLY_MIN_SECONDS` in frames — the floor `computeObjectionTiming` clamps a narration-driven reply-line hold to. See that constant's doc comment. */
export const OBJECTION_REPLY_MIN_FRAMES = Math.round(OBJECTION_REPLY_MIN_SECONDS * FPS);

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

export interface ObjectionTimingInput {
	/**
	 * Optional per-reply-line narration timing (native provider data — see
	 * T13). `narrationTimings[0]` drives the first reply line's hold,
	 * `narrationTimings[1]` the second — only each entry's DURATION is
	 * read, never its absolute position on the timeline, exactly mirroring
	 * `wall-timing.ts`'s own `WallTimingInput.narrationTimings` contract
	 * (see that module's `restLineFrameCounts`). Falls back to the fixed
	 * `OBJECTION_REPLY_LINE_FRAMES` per line when absent, or per-index when
	 * only one of the two is supplied. A supplied line's DURATION is
	 * clamped to `OBJECTION_REPLY_MIN_FRAMES` (social pilot 02a R06) — a
	 * sentence narrated shorter than the house rule's 2.5s payoff floor
	 * still HOLDS on screen for the full 2.5s; it just finishes speaking
	 * before the hold ends. A beat of trailing silence is part of this
	 * format's grammar (see the plan), so this is a deliberate floor, not a
	 * clipped-audio bug.
	 *
	 * social pilot 02a T16 (F04): before this, both reply-line holds were
	 * always exactly `OBJECTION_REPLY_LINE_FRAMES`, so real narration that
	 * ran longer or shorter than that fixed window could drift out of sync
	 * with the on-screen line.
	 */
	narrationTimings?: NarrationLineTiming[];
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
 * held reply lines) before this schedule is ever consulted. `input` is
 * optional (defaults to `{}`) so every existing no-argument call site
 * (Remotion Studio's `defaultProps`, most tests) keeps working unchanged —
 * social pilot 02a T16 (F04) added `narrationTimings` as the one field that
 * DOES vary this schedule, once real narration is available.
 */
export function computeObjectionTiming(input: ObjectionTimingInput = {}): ObjectionTimingSchedule {
	const objection: ObjectionPhaseWindow = {
		startFrame: 0,
		endFrame: OBJECTION_HOLD_FRAMES,
		motionless: true
	};

	// social pilot 02a T16 (F04) — narration-driven per reply line when
	// supplied, else the fixed OBJECTION_REPLY_LINE_FRAMES fallback. Mirrors
	// wall-timing.ts's `restLineFrameCounts`, with one deliberate departure:
	// T16 only floored a narrated line at 1 frame (never vanish), which is
	// enough to stop a line disappearing but not enough to hold THE HOUSE
	// RULE's payoff-motionless floor (>= 2.5s, `OBJECTION_REPLY_MIN_FRAMES`).
	//
	// social pilot 02a R06 (2026-08-26): both reply lines are clamped to
	// that floor here, not just the first. The fixed-length fallback below
	// (no narrationTimings supplied) already equals the floor exactly, so
	// this only ever changes the narration-driven branch. Line 1 (the
	// final line) is ALSO extended by `padToMinimumDuration` below, which
	// happens to guarantee its floor in the common case — but only when the
	// schedule's raw total still falls under the 15s MP4 floor. A card
	// whose first reply line runs long enough on its own (e.g. a long first
	// sentence) can push the raw total past that floor before padding is
	// even considered, leaving a genuinely short second sentence
	// unprotected — so line 1 needs this same floor in its own right, not
	// just line 0 (the case a genuinely short first sentence was flagged
	// against — see objection-timing.test.ts's R06 describe for concrete
	// frame numbers proving both).
	const replyLineFrames: [number, number] = [0, 1].map((index) => {
		const timing = input.narrationTimings?.[index];
		if (!timing) {
			return OBJECTION_REPLY_LINE_FRAMES;
		}
		const narratedFrames = Math.max(1, Math.round((timing.endSeconds - timing.startSeconds) * FPS));
		return Math.max(OBJECTION_REPLY_MIN_FRAMES, narratedFrames);
	}) as [number, number];

	const firstReplyLine: ObjectionPhaseWindow = {
		startFrame: objection.endFrame,
		endFrame: objection.endFrame + replyLineFrames[0],
		motionless: true
	};

	const secondReplyLine: ObjectionPhaseWindow = {
		startFrame: firstReplyLine.endFrame,
		endFrame: firstReplyLine.endFrame + replyLineFrames[1],
		motionless: true
	};

	// The 15s MP4 floor (T18): The Objection's fixed shape totals only 225
	// frames (7.5s) on its own. Extend the second (final) reply line's
	// hold — the format's last payoff phase, already motionless — never the
	// first reply line and never a new phase. See `duration-bounds.ts`.
	const { totalFrames, padFrames } = padToMinimumDuration(secondReplyLine.endFrame);
	if (padFrames > 0) {
		secondReplyLine.endFrame += padFrames;
	}

	return {
		totalFrames,
		objection,
		replyLines: [firstReplyLine, secondReplyLine]
	};
}
