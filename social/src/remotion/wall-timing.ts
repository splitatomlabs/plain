/**
 * Pure timing/geometry math for The Wall composition (see `Wall.tsx`).
 *
 * Nothing here touches React, Remotion's runtime, or the DOM — every export
 * is a plain function or constant so the whole schedule is unit-testable
 * without rendering a single frame. `Wall.tsx` is the only consumer that
 * turns these frame numbers into JSX, and it consumes `computeWallLayout`'s
 * numbers directly rather than recomputing its own — this module is the
 * single source of truth for both timing AND wall-phase geometry.
 */

import { estimateWrappedLineCount, fitFontSize } from '../render/fit.js';
import { padToMinimumDuration } from './duration-bounds.js';

// ---------------------------------------------------------------------------
// Frame rate and frame dimensions
// ---------------------------------------------------------------------------

/** Matches the `fps` the composition is registered at in `Root.tsx`. */
export const FPS = 30;

/** Matches the `width`/`height` the composition is registered at in `Root.tsx`. */
export const FRAME_WIDTH = 1080;
export const FRAME_HEIGHT = 1920;

// ---------------------------------------------------------------------------
// Phase 1 — the wall (silent, moving)
// ---------------------------------------------------------------------------

/**
 * Nominal karaoke sweep rate, in words per minute — deliberately past normal
 * reading speed (~200-250wpm). This is authoritative for the highlight's
 * on-screen speed; it is NOT used to derive the wall phase's length (see
 * `WALL_FRAMES` below) — 150+ words at 320wpm takes ~28s, far longer than
 * the 2-3s wall window, so the sweep simply does not finish before the cut.
 * That is the intended mechanic: the wall outruns the viewer.
 */
export const KARAOKE_WPM = 320;

/** Frames the karaoke highlight spends on each word, at `KARAOKE_WPM`. */
export const FRAMES_PER_WORD = (60 / KARAOKE_WPM) * FPS;

/** The wall phase must never be shorter than this. */
export const WALL_MIN_SECONDS = 2;
/** The wall phase must never be longer than this — "2-3 seconds, not 6". */
export const WALL_MAX_SECONDS = 3;

export const WALL_MIN_FRAMES = Math.round(WALL_MIN_SECONDS * FPS);
export const WALL_MAX_FRAMES = Math.round(WALL_MAX_SECONDS * FPS);

/**
 * The wall phase's fixed length, in frames. `KARAOKE_WPM` and "150+ words"
 * are incompatible as a derivation for this number (see `KARAOKE_WPM`'s
 * comment) so this is a fixed point inside the [2s, 3s] window instead of a
 * function of word count — 2.5s, the midpoint of the mandated range.
 */
export const WALL_SECONDS = 2.5;
export const WALL_FRAMES = Math.round(WALL_SECONDS * FPS);

/**
 * Scale at frame 0 of the wall phase. Strictly greater than `REST_SCALE` so
 * the push-in reads as already in progress the instant the video starts —
 * there is no zoomed-out "arrival" frame. Deliberately gentle: a wide
 * push-in range would crop more of the frame at the cut, which either clips
 * glyphs or forces a bigger `WALL_INSET_PX` (eating into the packed,
 * edge-to-edge wall). See `WALL_MAX_CROP_PX`.
 */
export const WALL_SCALE_AT_FRAME_ZERO = 1.02;
/** Scale at the last frame of the wall phase, i.e. the instant of the cut. */
export const WALL_SCALE_AT_CUT = 1.05;
/** Scale used for every payoff frame (phases 2 and 3) — no zoom, no motion. */
export const REST_SCALE = 1.0;

// ---------------------------------------------------------------------------
// Wall box geometry — edge to edge, no margins, no title card
// ---------------------------------------------------------------------------

/**
 * Inset applied on all four sides of the wall frame. Two jobs at once:
 *   1. Crop protection — at the maximum push-in scale (`WALL_SCALE_AT_CUT`),
 *      the frame crops `WALL_MAX_CROP_PX` off each edge. `WALL_INSET_PX`
 *      must exceed that so the crop only ever eats blank inset, never a
 *      glyph (see `computeWallLayout`'s `maxCropPx` and the regression test
 *      asserting `maxCropPx < insetPx`).
 *   2. It defines the box `fitFontSize` packs text into — small relative to
 *      the frame's 1080x1920, so "edge to edge" still reads as "no margins"
 *      at a glance.
 */
export const WALL_INSET_PX = 80;

/**
 * Crop budget at the wall's maximum scale. The 1920-tall dimension is the
 * binding one — cropping the same *fraction* of a larger dimension removes
 * more absolute pixels — so this is computed from `FRAME_HEIGHT`, not
 * `FRAME_WIDTH`.
 */
export const WALL_MAX_CROP_PX = (FRAME_HEIGHT * (1 - 1 / WALL_SCALE_AT_CUT)) / 2;

export const WALL_BOX_WIDTH = FRAME_WIDTH - 2 * WALL_INSET_PX;
export const WALL_BOX_HEIGHT = FRAME_HEIGHT - 2 * WALL_INSET_PX;

export const WALL_MIN_FONT = 16;
export const WALL_MAX_FONT = 96;
/** Tight, dense — "small-set archaic text", not comfortable reading. */
export const WALL_LINE_HEIGHT_RATIO = 1.25;

/**
 * The minimum fraction of `WALL_BOX_HEIGHT` the wall text must occupy for
 * the wall to read as "packed edge to edge" rather than a band with empty
 * margins above and below.
 */
export const WALL_MIN_FILL_RATIO = 0.9;

/**
 * Calibration factor for `computeWallLayout`'s font search — see the
 * comment inside that function for why this exists. Tuned against a real
 * rendered still of the 150-word fixture card (T05 review round 2); revisit
 * if the estimate in `fit.ts` changes or a real font is loaded for the wall.
 */
export const WALL_FONT_SEARCH_OVERSHOOT = 1.12;

// ---------------------------------------------------------------------------
// Payoff box geometry — phases 2 and 3, centred text on paper
// ---------------------------------------------------------------------------

export const PAYOFF_PADDING_X = 96;
export const PAYOFF_BOX_WIDTH = FRAME_WIDTH - PAYOFF_PADDING_X * 2;
export const PAYOFF_BOX_HEIGHT = 800;
export const PAYOFF_MIN_FONT = 40;
export const PAYOFF_MAX_FONT = 88;
export const PAYOFF_LINE_HEIGHT_RATIO = 1.4;

// ---------------------------------------------------------------------------
// Phase 2 — the landing line (silent, motionless)
// ---------------------------------------------------------------------------

/** The landing line is held, motionless and in silence, for a full 3s. */
export const LANDING_LINE_SECONDS = 3;
export const LANDING_LINE_FRAMES = Math.round(LANDING_LINE_SECONDS * FPS);

// ---------------------------------------------------------------------------
// Phase 3 — the rest of the plain passage (narrated, motionless per line)
// ---------------------------------------------------------------------------

/**
 * Fallback duration for a plain line when no narration timing is supplied.
 * Narration (T13) will normally drive this via `narrationTimings`.
 */
export const DEFAULT_LINE_SECONDS = 3.5;
export const DEFAULT_LINE_FRAMES = Math.round(DEFAULT_LINE_SECONDS * FPS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

/** Splits on whitespace and drops empty tokens — no punctuation stripping. */
export function splitWords(text: string): string[] {
	return text.split(/\s+/).filter((word) => word.length > 0);
}

// ---------------------------------------------------------------------------
// Wall phase geometry — the single source of truth `Wall.tsx` renders from
// ---------------------------------------------------------------------------

export interface WallLayout {
	fontSize: number;
	/** Line height in px (`fontSize * WALL_LINE_HEIGHT_RATIO`). */
	lineHeight: number;
	estimatedLines: number;
	estimatedTextHeight: number;
	/** `estimatedTextHeight / WALL_BOX_HEIGHT`. */
	fillRatio: number;
	insetPx: number;
	maxCropPx: number;
}

/**
 * Resolves the wall phase's exact font size and line geometry for
 * `originalExcerpt`, packed into `WALL_BOX_WIDTH`x`WALL_BOX_HEIGHT`.
 * `fitFontSize` already maximizes font size up to the available height, so
 * a generous `WALL_MAX_FONT` combined with a small `WALL_INSET_PX` box is
 * what makes this naturally fill the frame — no separate "make it big"
 * step. `Wall.tsx` must render with exactly these numbers, not recompute
 * its own.
 */
export function computeWallLayout(originalExcerpt: string): WallLayout {
	// `fitFontSize`'s character-width estimate is a text-only approximation
	// (there is no Remotion equivalent of `card.ts`'s real-DOM measure-and-
	// shrink loop to correct it against). Measured against real rendered
	// frames, this composition's actual glyphs run narrower than the
	// estimate assumes, so the picked font consistently underfills the box
	// by ~10%. `WALL_FONT_SEARCH_OVERSHOOT` inflates only the height budget
	// fed into the search — `fillRatio` below is still computed against the
	// true `WALL_BOX_HEIGHT`, so it stays a meaningful, testable number.
	const fit = fitFontSize(originalExcerpt, {
		maxWidth: WALL_BOX_WIDTH,
		maxHeight: WALL_BOX_HEIGHT * WALL_FONT_SEARCH_OVERSHOOT,
		minFont: WALL_MIN_FONT,
		maxFont: WALL_MAX_FONT,
		lineHeightRatio: WALL_LINE_HEIGHT_RATIO
	});

	const estimatedLines = estimateWrappedLineCount(originalExcerpt, fit.fontSize, WALL_BOX_WIDTH);
	const estimatedTextHeight = estimatedLines * fit.lineHeight;
	const fillRatio = estimatedTextHeight / WALL_BOX_HEIGHT;

	return {
		fontSize: fit.fontSize,
		lineHeight: fit.lineHeight,
		estimatedLines,
		estimatedTextHeight,
		fillRatio,
		insetPx: WALL_INSET_PX,
		maxCropPx: WALL_MAX_CROP_PX
	};
}

// ---------------------------------------------------------------------------
// Phase 1 timing — karaoke sweep
// ---------------------------------------------------------------------------

export interface KaraokeWordTiming {
	word: string;
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
}

/**
 * Every word's highlight window at the fixed `KARAOKE_WPM` rate, starting
 * at word 0. Independent of the wall phase's length — the rate is
 * authoritative, coverage is not: for any card at or above the Wall's
 * 150-word floor, most of these windows fall after `WALL_FRAMES` and are
 * simply never reached before the cut.
 */
export function computeKaraokeWordTimings(originalExcerpt: string): KaraokeWordTiming[] {
	const words = splitWords(originalExcerpt);
	return words.map((word, i) => ({
		word,
		startFrame: Math.round(i * FRAMES_PER_WORD),
		endFrame: Math.round((i + 1) * FRAMES_PER_WORD)
	}));
}

/**
 * The wall's push-in scale at a given frame within the wall phase. Linear —
 * per the house rule, no easing with overshoot anywhere — and deliberately
 * starts above `REST_SCALE` with non-zero velocity at frame 0, so the push-in
 * reads as already underway rather than starting when the video opens.
 */
export function wallScaleAtFrame(frame: number, wallFrames: number): number {
	if (wallFrames <= 0) {
		return WALL_SCALE_AT_FRAME_ZERO;
	}
	const progress = clamp(frame, 0, wallFrames) / wallFrames;
	return WALL_SCALE_AT_FRAME_ZERO + (WALL_SCALE_AT_CUT - WALL_SCALE_AT_FRAME_ZERO) * progress;
}

// ---------------------------------------------------------------------------
// Full schedule
// ---------------------------------------------------------------------------

export interface WallPhaseWindow {
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
	/** True if nothing may move, fade, or otherwise animate during this window. */
	motionless: boolean;
}

export interface NarrationLineTiming {
	startSeconds: number;
	endSeconds: number;
}

export interface WallTimingInput {
	originalExcerpt: string;
	/** The rest of the plain passage, in order, excluding `landingLine`. */
	plainLines: string[];
	/**
	 * Optional per-line narration timing (native provider data, see T13).
	 * When absent, each line falls back to `DEFAULT_LINE_FRAMES`.
	 */
	narrationTimings?: NarrationLineTiming[];
}

export interface WallRestLine extends WallPhaseWindow {
	index: number;
	text: string;
}

export interface WallTimingSchedule {
	totalFrames: number;
	wall: WallPhaseWindow & { wordCount: number };
	karaoke: KaraokeWordTiming[];
	landingLine: WallPhaseWindow;
	restLines: WallRestLine[];
}

/**
 * Computes every frame boundary of The Wall from its props. The only place
 * in this composition where phase lengths are decided — `Wall.tsx` reads the
 * result and never computes a frame boundary itself.
 */
export function computeWallTiming(input: WallTimingInput): WallTimingSchedule {
	const karaoke = computeKaraokeWordTimings(input.originalExcerpt);

	const wall: WallPhaseWindow & { wordCount: number } = {
		startFrame: 0,
		endFrame: WALL_FRAMES,
		motionless: false,
		wordCount: karaoke.length
	};

	const landingLine: WallPhaseWindow = {
		startFrame: wall.endFrame,
		endFrame: wall.endFrame + LANDING_LINE_FRAMES,
		motionless: true
	};

	let cursor = landingLine.endFrame;
	const restLines: WallRestLine[] = input.plainLines.map((text, index) => {
		const timing = input.narrationTimings?.[index];
		const frames = timing
			? Math.max(1, Math.round((timing.endSeconds - timing.startSeconds) * FPS))
			: DEFAULT_LINE_FRAMES;
		const startFrame = cursor;
		const endFrame = startFrame + frames;
		cursor = endFrame;
		return { index, text, startFrame, endFrame, motionless: true };
	});

	// The 15s MP4 floor (T18): a short card (few or no plain-passage lines,
	// or narration-driven lines that run quick) can land well under it —
	// e.g. no `plainLines` at all is just `WALL_FRAMES + LANDING_LINE_FRAMES`
	// (5.5s). Extend the LAST motionless payoff phase's hold — the last rest
	// line if there is one, else the landing line itself — never add a new
	// phase and never touch the moving wall phase. See `duration-bounds.ts`.
	const { totalFrames, padFrames } = padToMinimumDuration(cursor);
	if (padFrames > 0) {
		if (restLines.length > 0) {
			restLines[restLines.length - 1].endFrame += padFrames;
		} else {
			landingLine.endFrame += padFrames;
		}
	}

	return {
		totalFrames,
		wall,
		karaoke,
		landingLine,
		restLines
	};
}
