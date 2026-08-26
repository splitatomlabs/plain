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

import { estimateWrappedLineCount } from '../render/fit.js';
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
// The legibility floor — MOVED here from `wall-gate.ts` in F18, when the Wall
// briefly ran its own per-card font-size search against it. social pilot 02a
// T08 deleted that search (the Wall's font size is fixed again, `WALL_FONT_SIZE`
// below, well above this floor) but left the constant defined here rather than
// moving it back — `question-gate.ts` and `objection-gate.ts` still run real
// per-card `fitFontSize` searches against it, so it stays load-bearing for
// them regardless of what the Wall does with its own size. Still re-exported
// from `wall-gate.ts` (unchanged import path for existing callers — those two
// gates, and every test that imports it from there).
// ---------------------------------------------------------------------------

/**
 * CSS width, in px, of the reference phone the legibility floor is set
 * against — an iPhone 12/13/14-class device (390 CSS px logical width).
 * This is the same class of screen the wall is watched on: a story/reel
 * viewed full-bleed on a phone, not a desktop preview.
 */
export const WALL_REFERENCE_VIEWPORT_WIDTH = 390;

/**
 * The smallest CSS font size treated as legible body text on a phone —
 * below this, small text reads as a grey smear rather than words, per the
 * house rule that illegibility must come from density, archaism and speed,
 * not from undersized type.
 */
const WALL_MIN_LEGIBLE_CSS_PX = 14;

/**
 * `WALL_MIN_LEGIBLE_CSS_PX` converted into the composition's 1080-wide
 * frame space, rounded UP so the floor is never more permissive than the
 * CSS px it stands in for. Derived from `WALL_MIN_LEGIBLE_CSS_PX`,
 * `FRAME_WIDTH` and `WALL_REFERENCE_VIEWPORT_WIDTH` rather than hardcoded,
 * so the ~39px figure cannot silently drift from its definition:
 * `14 * (1080 / 390)` ≈ 38.8 → 39.
 */
export const WALL_MIN_LEGIBLE_FONT_PX = Math.ceil(
	WALL_MIN_LEGIBLE_CSS_PX * (FRAME_WIDTH / WALL_REFERENCE_VIEWPORT_WIDTH)
);

// ---------------------------------------------------------------------------
// Phase 1 — the wall (silent, SCROLLING)
// ---------------------------------------------------------------------------
//
// social pilot 02 F15 (2026-08-26): the wall's motion was originally a
// 1.02->1.05 push-in zoom with a karaoke highlight racing across the text
// (see git history for that version). Reviewed on a phone, nothing actually
// TRAVELLED — the zoom is barely perceptible and the highlight only ever
// reaches a handful of words, so the wall read as a dense page sitting
// still. This is a rebuild, not a tune: the wall now SCROLLS, at a fixed
// rate, past faster than anyone can read, and the karaoke highlight is gone
// entirely (the scroll itself is the motion — see `WALL_FONT_SIZE` and
// `WALL_SCROLL_RATE_PX_PER_SEC` below for the replacement geometry/rate).

/** The wall phase must never be shorter than this. */
export const WALL_MIN_SECONDS = 2;
/** The wall phase must never be longer than this — "2-3 seconds, not 6". */
export const WALL_MAX_SECONDS = 3;

export const WALL_MIN_FRAMES = Math.round(WALL_MIN_SECONDS * FPS);
export const WALL_MAX_FRAMES = Math.round(WALL_MAX_SECONDS * FPS);

/**
 * The wall phase's fixed length, in frames — 2.5s, the midpoint of the
 * mandated [2s, 3s] window. Fixed rather than derived from word count so
 * every card's hard cut lands at the SAME instant regardless of how long its
 * excerpt is — see `WALL_SCROLL_RATE_PX_PER_SEC` for why that, combined with
 * a fixed scroll rate, is what guarantees the cut always lands mid-passage.
 */
export const WALL_SECONDS = 2.5;
export const WALL_FRAMES = Math.round(WALL_SECONDS * FPS);

// ---------------------------------------------------------------------------
// Wall box geometry — edge to edge, no margins, no title card
// ---------------------------------------------------------------------------

/**
 * Inset applied on the LEFT and RIGHT of the wall frame only (never top or
 * bottom — see `computeWallLayout`'s doc comment). Two jobs at once:
 *   1. Crop protection — text never wraps flush against the frame's own
 *      edge, so a sub-pixel wrapping estimate can never clip a glyph
 *      sideways. The scroll crops the TOP and BOTTOM of the block by
 *      design (that is what makes it a scroll — the block is taller than
 *      the frame) but must never clip LEFT or RIGHT.
 *   2. It defines the box width `computeWallLayout` wraps text into — small
 *      relative to the frame's 1080px width, so "edge to edge" still reads
 *      as "no margins" at a glance.
 */
export const WALL_INSET_PX = 80;

export const WALL_BOX_WIDTH = FRAME_WIDTH - 2 * WALL_INSET_PX;

/** Tight, dense — "small-set archaic text", not comfortable reading. */
export const WALL_LINE_HEIGHT_RATIO = 1.25;

/**
 * `estimateWrappedLineCount` (`fit.ts`) estimates line count from a naive
 * average-character-width heuristic (`CHAR_WIDTH_RATIO`, tuned for Georgia —
 * see that constant's own comment). Measured directly with Playwright
 * against the composition's REAL rendered text (social pilot 02 F17 fixed
 * the Remotion bundle's font registration — Literata Variable now actually
 * loads, see `register-fonts.ts` — so this is a true measurement of the
 * shipped face, not the Georgia fallback the pre-F17 build silently
 * rendered in), the naive estimate OVER-counts real wrapped lines at this
 * composition's box width (920px). Measured with real Playwright
 * `boundingClientRect` against real Literata across F16/F18's font-size
 * range (50-120px): `estimate/real` ratio 1.037-1.147, no directional drift
 * with font size — the error is noise across that range, not a trend a
 * single constant needs to track.
 *
 * `computeWallLayout` divides the raw line-count estimate by this factor so
 * `blockHeight`/`screens` approximate what actually renders at
 * `WALL_FONT_SIZE`.
 */
export const WALL_LINE_ESTIMATE_OVERSHOOT = 1.14;

/**
 * social pilot 02a T08 (2026-08-26): the wall's archaic-text font size is
 * FIXED again — one size for every card, no per-card search. F18's per-card
 * fit (aimed at a travel TARGET block height, since deleted along with
 * `WALL_TARGET_BLOCK_HEIGHT_PX`/`WALL_FONT_FLOOR_PX`/`WALL_FONT_CAP_PX`) cost
 * the format its own identity: block height scales with the SQUARE of font
 * size, so the only way for a ≤201-word single card to buy enough travel was
 * to blow the type up to 65-91px — "the wall reads as a large-print book,
 * not a wall" (measured from real frames, see the plan). 44px, chosen from
 * the plan's own measurement: ~39 chars/line, ~7.1 words/line at this
 * composition's box width — a real page of a real book, not large print.
 *
 * The fix that makes a small, fixed size viable again is NOT a bigger font —
 * it's a bigger BLOCK. `chapter-text.ts` (T05/T06) sources the wall's
 * scrolling text from the surrounding CHAPTER, not the single card, so the
 * block a card scrolls through is thousands of words long (2,196-3,305 for
 * Meditations Books 2-3) rather than 100-200. At 44px/4.5 lines-per-second
 * (`WALL_SCROLL_LINES_PER_SEC`), "never finishes before the cut" needs only
 * 412 words (see `WALL_SCROLL_RATE_PX_PER_SEC`'s doc comment for the
 * arithmetic) — a chapter block clears that by an order of magnitude, so the
 * constraint stops binding entirely. The never-finishes invariant is now
 * satisfied BY CONSTRUCTION (a long-enough source block, T06) rather than by
 * a gate rejecting cards whose own excerpt is too short — see
 * `wall-gate.ts`'s module doc comment for why the travel-floor rejection
 * axis is gone, not just relaxed.
 */
export const WALL_FONT_SIZE = 44;

/**
 * The wall's scroll rate, expressed as LINES PER SECOND rather than a bare
 * px/s figure — perceptually meaningful (how many lines of type pass in a
 * second) and decoupled from whatever font size is chosen, unlike F16/F18's
 * `WALL_SCROLL_RATE_PX_PER_SEC` = 500 (a number that only meant anything
 * relative to F16's now-gone 76px fixed size).
 *
 * 4.5 lines/s (social pilot 02a T08, user decision, 2026-08-26): at
 * `WALL_FONT_SIZE` (44px) that derives to ≈250px/s (`WALL_SCROLL_RATE_PX_PER_SEC`
 * below) ≈32 words/s ≈1,900wpm ≈7.5x normal reading pace (~250wpm) —
 * comfortably, unambiguously outrunning the reader without strobing. 500px/s
 * at 44px would be 500 / (44 * WALL_LINE_HEIGHT_RATIO) ≈ 9.1 lines/s, which
 * strobes (a line-height-tall jump nearly every other frame at 30fps reads
 * as flicker, not scroll).
 */
export const WALL_SCROLL_LINES_PER_SEC = 4.5;

/**
 * The wall's scroll rate, in px/s, in the composition's 1080x1920 frame
 * space — LINEAR, identical on every card, and the single source of the
 * wall's motion now that the karaoke highlight is gone (F15).
 *
 * social pilot 02a T08 (2026-08-26): DERIVED from `WALL_SCROLL_LINES_PER_SEC`
 * and `WALL_FONT_SIZE`'s own line height, not a bare px/s constant (F16/F18's
 * 500px/s only meant anything relative to a font size that no longer
 * exists): `WALL_SCROLL_LINES_PER_SEC * WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO`
 * = `4.5 * 44 * 1.25` = `247.5px/s`.
 *
 * The never-finishes invariant — the minimum `blockHeight` a source block
 * must clear so the scroll never finishes before the `WALL_SECONDS` (2.5s)
 * hard cut — is `FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS`
 * = `1920 + 247.5 * 2.5` ≈ `2538.75px`, which in words (at `WALL_FONT_SIZE`'s
 * own ~7.1 words/line and line height) needs ≈412 words. A single card
 * (100-200 words) cannot clear that alone — the chapter-sourced block
 * (`chapter-text.ts`, T05/T06) is what supplies the length now, not a bigger
 * font (see `WALL_FONT_SIZE`'s own doc comment). This is why the invariant is
 * no longer enforced as a `wall-gate.ts` rejection: it holds by construction
 * once the source block is chapter-length, not by rejecting short cards.
 */
export const WALL_SCROLL_RATE_PX_PER_SEC = WALL_SCROLL_LINES_PER_SEC * WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO;

/** `WALL_SCROLL_RATE_PX_PER_SEC` per frame at `FPS` — `247.5 / 30` = 8.25px/frame. The frame-0-to-frame-1 velocity check in `wall-timing.test.ts` still asserts EXACT equality against this constant itself (not a rounded literal), so a non-integer value at other rate/FPS combinations wouldn't weaken that check. */
export const WALL_SCROLL_PX_PER_FRAME = WALL_SCROLL_RATE_PX_PER_SEC / FPS;

/**
 * The wall block's vertical scroll offset (px, translated UPWARD, i.e. the
 * block's top moves above the frame's top edge as `frame` increases) at a
 * given frame within the wall phase. Linear — no easing, no ramp, per the
 * house rule — and, critically, ALREADY AT FULL VELOCITY from `frame` 0: the
 * "already in motion" quality T05 originally asked for is satisfied by
 * non-zero velocity at frame 0, not by starting partway through the text
 * (`offset(0)` is exactly `0` — the block's top is exactly at the frame's
 * top at the very first frame — but `offset(1) - offset(0)` is already the
 * full `WALL_SCROLL_PX_PER_FRAME`, not a fraction of it ramping up).
 */
export function wallScrollOffsetAtFrame(frame: number): number {
	return WALL_SCROLL_RATE_PX_PER_SEC * (Math.max(0, frame) / FPS);
}

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
 *
 * social pilot 02a T03 (2026-08-26): dropped from 3.5s to 3.0s. The
 * read-through's 30 Walls can carry up to 11 payoff lines each (per-card
 * word count, not a fixed cap — see `wall-gate.ts`'s
 * `WALL_MAX_DURATION_SECONDS` doc comment for why a line CAP was rejected in
 * favour of this pacing change), and at 3.5s/line eleven hard cuts of
 * centred text read as a slideshow (p50 26.5s, p75 30s, max 44s across the
 * read-through). 3.0s keeps p50 at ~23.5s while leaving 0.5s of margin over
 * the house rule's 2.5s motionless floor per payoff line — the rule "payoff
 * frame motionless >= 2.5s" is a floor this constant must clear, not a
 * target to sit on. This fallback only drives the MUSIC-ONLY case: once
 * T14's voices land, `narrationTimings` (not `DEFAULT_LINE_FRAMES`) sets
 * each line's real duration.
 */
export const DEFAULT_LINE_SECONDS = 3.0;
export const DEFAULT_LINE_FRAMES = Math.round(DEFAULT_LINE_SECONDS * FPS);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
	/** Total wrapped-text height, in px — deliberately allowed to (and, for most real cards, does) exceed `FRAME_HEIGHT`. That excess is what the scroll travels through. */
	blockHeight: number;
	/** `blockHeight / FRAME_HEIGHT` — descriptive/reporting only. */
	screens: number;
	/** Horizontal-only inset — see `WALL_INSET_PX`. */
	insetPx: number;
}

/**
 * Measures `originalExcerpt` at the fixed `WALL_FONT_SIZE` — how
 * `estimateWrappedLineCount`'s raw estimate, corrected by
 * `WALL_LINE_ESTIMATE_OVERSHOOT`, wraps within `WALL_BOX_WIDTH`.
 *
 * social pilot 02a T08 (2026-08-26): no longer a per-candidate-size helper
 * (F18's `fitWallFontSize` called this at several candidate sizes during a
 * binary search) — `computeWallLayout` below calls it exactly once, always
 * at `WALL_FONT_SIZE`, since the font size is fixed. Kept as its own
 * function anyway: it's the one place `estimateWrappedLineCount` and
 * `WALL_LINE_ESTIMATE_OVERSHOOT` combine, and `computeWallLayout` reads more
 * plainly with the arithmetic named.
 */
function measureWallBlockAtFontSize(
	originalExcerpt: string,
	fontSize: number
): { lineHeight: number; estimatedLines: number; blockHeight: number } {
	const lineHeight = fontSize * WALL_LINE_HEIGHT_RATIO;
	const rawEstimatedLines = estimateWrappedLineCount(originalExcerpt, fontSize, WALL_BOX_WIDTH);
	const estimatedLines = Math.round(rawEstimatedLines / WALL_LINE_ESTIMATE_OVERSHOOT);
	const blockHeight = estimatedLines * lineHeight;
	return { lineHeight, estimatedLines, blockHeight };
}

/**
 * Resolves the wall phase's block geometry for `originalExcerpt` at the
 * single, FIXED `WALL_FONT_SIZE` — every card renders at the same size, no
 * per-card search (social pilot 02a T08 deleted F18's `fitWallFontSize`
 * binary search along with the travel-target/floor/cap constants it aimed
 * at — see `WALL_FONT_SIZE`'s own doc comment for why a bigger, chapter-
 * sourced BLOCK replaces a bigger FONT as the fix for "never finishes before
 * the cut"). `Wall.tsx` (and everything else that reads wall geometry) calls
 * this, not a per-size helper directly — kept as the stable name across
 * F15/F16/F18/T08's different implementations (one screen / fixed size /
 * per-card fit / fixed size again) so call sites never needed to change.
 * `Wall.tsx` must render with exactly these numbers, not recompute its own.
 */
export function computeWallLayout(originalExcerpt: string): WallLayout {
	const measured = measureWallBlockAtFontSize(originalExcerpt, WALL_FONT_SIZE);
	return {
		fontSize: WALL_FONT_SIZE,
		lineHeight: measured.lineHeight,
		estimatedLines: measured.estimatedLines,
		blockHeight: measured.blockHeight,
		screens: measured.blockHeight / FRAME_HEIGHT,
		insetPx: WALL_INSET_PX
	};
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
	landingLine: WallPhaseWindow;
	restLines: WallRestLine[];
}

/**
 * Frame length of each rest line (phase 3), in order — narration-driven when
 * `narrationTimings[index]` is supplied, else `DEFAULT_LINE_FRAMES`. Split
 * out from `computeWallTiming` so `computeWallRawTotalFrames` (the gate's
 * pre-padding duration check — see `wall-gate.ts`) sums the exact same
 * per-line frame counts the real schedule uses, rather than a second,
 * potentially-drifting estimate.
 */
function restLineFrameCounts(plainLines: string[], narrationTimings?: NarrationLineTiming[]): number[] {
	return plainLines.map((_, index) => {
		const timing = narrationTimings?.[index];
		return timing ? Math.max(1, Math.round((timing.endSeconds - timing.startSeconds) * FPS)) : DEFAULT_LINE_FRAMES;
	});
}

/**
 * The composition's total frame count BEFORE `padToMinimumDuration` is
 * applied — i.e. `computeWallTiming`'s `cursor` at the point it would call
 * `padToMinimumDuration`. Exists so the Wall gate (`wall-gate.ts`) can check
 * a card against `MAX_POST_DURATION_FRAMES` itself, at survey time, without
 * going through `padToMinimumDuration` (which THROWS on an over-long
 * composition — exactly the outcome the gate exists to turn into a graceful
 * rejection instead of a render-time crash). `computeWallTiming` below calls
 * this same function rather than recomputing the sum, so the gate's number
 * and the real render's pre-padding number can never drift apart.
 */
export function computeWallRawTotalFrames(input: WallTimingInput): number {
	const wallEnd = WALL_FRAMES;
	const landingLineEnd = wallEnd + LANDING_LINE_FRAMES;
	const restFrames = restLineFrameCounts(input.plainLines, input.narrationTimings);
	return restFrames.reduce((cursor, frames) => cursor + frames, landingLineEnd);
}

/**
 * Computes every frame boundary of The Wall from its props. The only place
 * in this composition where phase lengths are decided — `Wall.tsx` reads the
 * result and never computes a frame boundary itself.
 */
export function computeWallTiming(input: WallTimingInput): WallTimingSchedule {
	const wall: WallPhaseWindow & { wordCount: number } = {
		startFrame: 0,
		endFrame: WALL_FRAMES,
		motionless: false,
		wordCount: splitWords(input.originalExcerpt).length
	};

	const landingLine: WallPhaseWindow = {
		startFrame: wall.endFrame,
		endFrame: wall.endFrame + LANDING_LINE_FRAMES,
		motionless: true
	};

	const restFrames = restLineFrameCounts(input.plainLines, input.narrationTimings);
	let cursor = landingLine.endFrame;
	const restLines: WallRestLine[] = input.plainLines.map((text, index) => {
		const startFrame = cursor;
		const endFrame = startFrame + restFrames[index];
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
		landingLine,
		restLines
	};
}
