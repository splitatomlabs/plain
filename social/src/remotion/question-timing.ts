/**
 * Pure timing/geometry math for The Question composition (see `Question.tsx`).
 *
 * Same discipline as `wall-timing.ts`: nothing here touches React, Remotion's
 * runtime, or the DOM, so the whole schedule is unit-testable without
 * rendering a single frame. `Question.tsx` turns these frame numbers into
 * JSX and never recomputes its own boundaries.
 *
 * The Question's middle phase — the archaic original arriving as a moving
 * wall — is NOT reimplemented here. It is the exact same visual grammar as
 * The Wall (packed, push-in already underway, karaoke sweep at
 * `KARAOKE_WPM`), so this module imports and re-exports `wall-timing.ts`'s
 * `WALL_FRAMES`, `computeWallTiming`, `computeWallLayout` and friends for
 * that phase rather than forking a second copy of the layout/scale/karaoke
 * math. Only the two things genuinely new to this format — the opening
 * question hold and the closing answer hold — are defined here.
 */

import { fitFontSize } from '../render/fit.js';
import { FPS, FRAME_WIDTH, WALL_FRAMES, splitWords } from './wall-timing.js';

// Re-exported so `Question.tsx` and callers can import everything they need
// from this module's "timing" surface without also reaching into
// `wall-timing.ts` directly for the shared archaic-phase constant.
export { FPS, FRAME_WIDTH, WALL_FRAMES, splitWords } from './wall-timing.js';

// ---------------------------------------------------------------------------
// Phase 1 — the question alone, still (NEW to this format)
// ---------------------------------------------------------------------------

/**
 * How long the question is held alone, motionless, before the archaic wall
 * arrives. Set to exactly the acceptance criterion's own number — "legible
 * and answerable within 1.5s" — so the hold window IS the 1.5s the format
 * is measured against, not a separate, looser value. `QUESTION_MAX_WORDS`
 * (12 words) and `QUESTION_MIN_LEGIBLE_FONT_PX` (see `question-gate.ts`)
 * are what make that window actually sufficient to read and silently
 * answer a short question, rather than a hopeful number on its own.
 */
export const QUESTION_HOLD_SECONDS = 1.5;
export const QUESTION_HOLD_FRAMES = Math.round(QUESTION_HOLD_SECONDS * FPS);

export const QUESTION_BOX_PADDING_X = 120;
export const QUESTION_BOX_WIDTH = FRAME_WIDTH - 2 * QUESTION_BOX_PADDING_X;
/** Generous vertical budget — a short question set large, not a wall of text. */
export const QUESTION_BOX_HEIGHT = 700;

export const QUESTION_MIN_FONT = 48;
export const QUESTION_MAX_FONT = 120;
/** Comfortable reading spacing — this is a still, readable line, not dense set type. */
export const QUESTION_LINE_HEIGHT_RATIO = 1.35;

// ---------------------------------------------------------------------------
// Phase 3 — the answer resolves in stillness (NEW to this format)
// ---------------------------------------------------------------------------

/**
 * The house rule's floor for a payoff frame: motionless, held for at least
 * 2.5s so it has time to land. (The Wall's landing line uses a longer 3s
 * hold because it is followed by more narrated lines; here the answer is
 * the entire payoff, so the 2.5s floor itself is the hold.)
 */
export const ANSWER_MIN_SECONDS = 2.5;
export const ANSWER_SECONDS = 2.5;
export const ANSWER_FRAMES = Math.round(ANSWER_SECONDS * FPS);

export const ANSWER_BOX_PADDING_X = 96;
export const ANSWER_BOX_WIDTH = FRAME_WIDTH - 2 * ANSWER_BOX_PADDING_X;
export const ANSWER_BOX_HEIGHT = 800;
export const ANSWER_MIN_FONT = 40;
export const ANSWER_MAX_FONT = 88;
export const ANSWER_LINE_HEIGHT_RATIO = 1.4;

// ---------------------------------------------------------------------------
// Opening-frame layout (question alone)
// ---------------------------------------------------------------------------

export interface QuestionLayout {
	fontSize: number;
	lineHeight: number;
	boxWidth: number;
	boxHeight: number;
}

/**
 * Resolves the opening frame's exact font size for `question`, packed into
 * `QUESTION_BOX_WIDTH`x`QUESTION_BOX_HEIGHT`. `Question.tsx` must render
 * with exactly this number, not recompute its own fit — mirrors
 * `computeWallLayout`'s role for the wall phase.
 */
export function computeQuestionLayout(question: string): QuestionLayout {
	const fit = fitFontSize(question, {
		maxWidth: QUESTION_BOX_WIDTH,
		maxHeight: QUESTION_BOX_HEIGHT,
		minFont: QUESTION_MIN_FONT,
		maxFont: QUESTION_MAX_FONT,
		lineHeightRatio: QUESTION_LINE_HEIGHT_RATIO
	});

	return {
		fontSize: fit.fontSize,
		lineHeight: fit.lineHeight,
		boxWidth: QUESTION_BOX_WIDTH,
		boxHeight: QUESTION_BOX_HEIGHT
	};
}

// ---------------------------------------------------------------------------
// Full schedule
// ---------------------------------------------------------------------------

export interface QuestionPhaseWindow {
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
	/** True if nothing may move, fade, or otherwise animate during this window. */
	motionless: boolean;
}

export interface QuestionTimingInput {
	question: string;
}

export interface QuestionTimingSchedule {
	totalFrames: number;
	/** Phase 1 — the question alone, still. Zero motion at frame 0. */
	question: QuestionPhaseWindow;
	/**
	 * Phase 2 — the archaic original arrives as the moving wall. Length is
	 * `WALL_FRAMES`, imported from `wall-timing.ts` — the exact same fixed
	 * window The Wall uses, not a value re-derived here.
	 */
	wall: QuestionPhaseWindow;
	/** Phase 3 — the plain answer resolves in stillness, held >= 2.5s. */
	answer: QuestionPhaseWindow;
}

/**
 * Computes every frame boundary of The Question from its props. The only
 * place in this composition where phase lengths are decided —
 * `Question.tsx` reads the result and never computes a frame boundary
 * itself.
 */
export function computeQuestionTiming(_input: QuestionTimingInput): QuestionTimingSchedule {
	const question: QuestionPhaseWindow = {
		startFrame: 0,
		endFrame: QUESTION_HOLD_FRAMES,
		motionless: true
	};

	const wall: QuestionPhaseWindow = {
		startFrame: question.endFrame,
		endFrame: question.endFrame + WALL_FRAMES,
		motionless: false
	};

	const answer: QuestionPhaseWindow = {
		startFrame: wall.endFrame,
		endFrame: wall.endFrame + ANSWER_FRAMES,
		motionless: true
	};

	return {
		totalFrames: answer.endFrame,
		question,
		wall,
		answer
	};
}
