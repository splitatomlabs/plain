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
// The legibility floor — MOVED here from `wall-gate.ts` in F18, because
// `fitWallFontSize`'s search (below) needs it as an actual bound, not just a
// value to check a fixed size against. Still re-exported from `wall-gate.ts`
// (unchanged import path for existing callers — `question-gate.ts`,
// `objection-gate.ts`, and every test that imports it from there).
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
 * composition's box width (920px).
 *
 * F18 (2026-08-26) re-measured this across the FULL font-size range
 * `fitWallFontSize` now searches (`WALL_FONT_FLOOR_PX`..`WALL_FONT_CAP_PX`,
 * roughly 39-92px), not just F16's single fixed 76px — a per-card fit
 * changes which sizes actually get used, so the calibration has to hold
 * across the whole range, not just at one point. Measured with real
 * Playwright `boundingClientRect` against real Literata:
 *   - `meditations-07-031` (150 words) and `discourses-59-004` (201 words)
 *     swept at every 5-10px step from 50px to 120px: measured
 *     `estimate/real` ratio ranges 1.037-1.147, no directional drift with
 *     font size (the error is noise across the range, not a trend a single
 *     constant needs to track) — the same range F16's own calibration
 *     found, so no re-tune from that alone.
 *   - Sweeping EVERY entry in the real Wall pool (896 cards) at its OWN
 *     `fitWallFontSize`-computed size (the size that actually ships)
 *     against a real render: F16's 1.14 still produces ZERO false
 *     positives (a card whose ESTIMATE clears the target/floor but whose
 *     REAL rendered block does not) across the full pool at F18's
 *     per-card-fit geometry too, with a real, if narrow, 15px margin over
 *     the travel floor on the single tightest passing card
 *     (`on-anger-02-087`). A stricter overshoot (1.20) was tried and
 *     rejected: it still produced zero false positives with a much larger
 *     230px worst-case margin, but did so by systematically
 *     UNDER-estimating real height for shorter cards near the cap — real
 *     measurement of `meditations-02-001` (117 words, the read-through's
 *     own first card) found the ESTIMATE at `WALL_FONT_CAP_PX` 345px SHORT
 *     of its REAL rendered height (3220px estimated vs. 3565px real),
 *     wrongly rejecting a card that genuinely renders fine — a real,
 *     measured FALSE NEGATIVE cost that fell hardest on exactly the
 *     shortest, most CAP-adjacent cards the read-through's own book slice
 *     is full of. Layout height from the SAME embedded font bytes in the
 *     SAME Chromium build is deterministic (word-wrap is a pure function of
 *     font metrics baked into the font file, not of GPU/OS antialiasing),
 *     so cross-environment drift on the 15px margin is not the same risk
 *     class as per-card estimate error — kept at F16's number.
 * `computeWallLayout`/`fitWallFontSize` divide the raw line-count estimate
 * by this factor so `blockHeight`/`screens` approximate what actually
 * renders.
 */
export const WALL_LINE_ESTIMATE_OVERSHOOT = 1.14;

/**
 * F18 (2026-08-26): the wall's archaic-text font size is no longer a single
 * FIXED constant (F16's `WALL_FONT_SIZE`, 76px) — F16's fixed size cost 76%
 * of the real Wall pool (219/896 renderable), because "never finishes
 * before the cut" needs a block over `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`
 * (`wall-gate.ts`, ~3170px at F16's rate/duration), and a fixed 76px font
 * only reaches that above ~130 words — every shorter card became
 * unrenderable outright, and the read-through (which needs 7+ CONSECUTIVE
 * renderable cards from a book's start) couldn't find a run of 7 anywhere
 * in the real corpus.
 *
 * The fix keeps the fixed SCROLL RATE and the never-finishes invariant
 * (`WALL_SCROLL_RATE_PX_PER_SEC`, `WALL_SECONDS`, unchanged) but stops
 * fixing the FONT SIZE and fits it PER CARD instead, aimed at a TRAVEL
 * TARGET (`WALL_TARGET_BLOCK_HEIGHT_PX`) rather than at filling exactly one
 * screen (T05/T06's original, already-abandoned objective) or at a single
 * shared size (F15/F16's, just abandoned here): short passages get LARGER
 * type (to reach the target height), long passages get SMALLER type (to
 * avoid wildly overshooting it) — supply returns because a short card is no
 * longer rejected just for being short, only for being SO short that even
 * `WALL_FONT_CAP_PX` can't reach the target without reading as large-print.
 *
 * This reuses `fit.ts`'s binary-search MACHINERY (the same kind of search
 * `fitFontSize` already runs for Question/Objection/PayoffLine), just aimed
 * at a different predicate — see `fitWallFontSize` below, which is where
 * the actual search lives (`computeWallLayout` is a thin wrapper over it).
 */

/**
 * The block height `fitWallFontSize` aims for. Chosen above `wall-gate.ts`'s
 * `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` (the real floor a scroll must clear to
 * survive `WALL_SECONDS` at `WALL_SCROLL_RATE_PX_PER_SEC` without finishing
 * before the cut — 3170px at F18's numbers) so `WALL_LINE_ESTIMATE_OVERSHOOT`'s
 * calibration error (measured, never exactly zero) cannot push an accepted
 * card's REAL rendered block under the real floor: 3400 - 3170 = 230px of
 * nominal margin.
 *
 * Real per-card margin varies (per-card word-length distribution is what the
 * naive char-width estimate is actually noisy against, not font size) — real
 * measurement of the entire pool put the WORST real margin at 15px
 * (`on-anger-02-087`), not the full 230px nominal figure, but still real and
 * positive: zero false positives across the whole 896-card pool (see
 * `WALL_LINE_ESTIMATE_OVERSHOOT`'s doc comment for why a STRICTER overshoot
 * that raised that margin was tried and rejected — it traded real supply for
 * a bigger safety number without fixing a real defect). Not derived from
 * `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` by a formula (there is no principled
 * ratio here, just "safely clear of it") — the nominal margin itself is the
 * design decision, recorded here rather than computed; the REAL margin is
 * measured, reported, and re-verified on every re-tune.
 */
export const WALL_TARGET_BLOCK_HEIGHT_PX = 3400;

/**
 * The smallest font size `fitWallFontSize` will ever choose. Reuses the
 * SAME 14px-CSS-on-a-390px-reference-phone legibility floor `wall-gate.ts`
 * exports as `WALL_MIN_LEGIBLE_FONT_PX` (pre-F15/F16 this was the Wall's own
 * fit-search floor too, before F15's fixed-size wall made it briefly
 * dead-for-the-Wall weight carried only by Question/Objection — F18 makes it
 * load-bearing for the Wall again): below this, type reads as a grey smear
 * rather than words, which is not the kind of illegibility this format
 * wants (speed and density, not squinting). Per the plan's own framing, this
 * "should rarely bind" — a real ~200-word card's fitted size sits well above
 * it (see `fitWallFontSize`'s doc comment for the measured range).
 */
export const WALL_FONT_FLOOR_PX = WALL_MIN_LEGIBLE_FONT_PX;

/**
 * The largest font size `fitWallFontSize` will ever choose — above this, a
 * card is REJECTED as too short to set without reading as large-print,
 * rather than stretched further (F15's whole complaint about its fixed 86px
 * was exactly this: a wall that reads as large-print loses the "wall"
 * identity the format is named for). 92px, chosen from real measurement
 * (Playwright `boundingClientRect`, real Literata, `WALL_BOX_WIDTH`) across
 * the whole real Wall pool (896 entries), at `WALL_LINE_ESTIMATE_OVERSHOOT`'s
 * final calibrated value:
 *   - only the shortest end of the pool ever reaches this cap at all — the
 *     fitted font size across every card that DOES pass ranges 65-91px, so
 *     92 is never actually the TYPICAL size, only the ceiling a handful of
 *     the shortest passing cards approach; the pool as a whole reads
 *     noticeably denser than F15's uniform, fixed 86px wall did.
 *   - the crossover — the shortest real word count whose block still clears
 *     `WALL_TARGET_BLOCK_HEIGHT_PX` within this cap — measures at 96 words
 *     (`discourses-47-002`, the shortest PASSING pool entry); the longest
 *     REJECTED entry is 117 words (`meditations-02-001` — word count alone
 *     doesn't fully predict wrapped height, longer average word length
 *     wraps to fewer lines per word). 175 of 896 pool entries (19.5%) are
 *     rejected on this axis — a real, reported cost, not the whole pool:
 *     "rejecting a narrow band of very short cards is expected and fine."
 */
export const WALL_FONT_CAP_PX = 92;

/**
 * social pilot 02a T07 (2026-08-26) STUB — written ahead of T08's real
 * implementation, purely so `wall-timing.test.ts`'s new TDD tests
 * type-check under `tsc --noEmit` (the task's own instructions permit a
 * minimal stub export for exactly this reason, "only if unavoidable" — it
 * is unavoidable here: this project's Vitest/esbuild transform lets an
 * import of a genuinely missing export through as `undefined` at runtime,
 * but `tsc --noEmit` still, correctly, treats it as a hard compile error).
 *
 * NOT wired into `fitWallFontSize`/`computeWallLayout` or
 * `WALL_SCROLL_RATE_PX_PER_SEC` below — doing so is T08's own job (delete
 * the per-card fit, fix the font size, derive the scroll rate from
 * `WALL_SCROLL_LINES_PER_SEC` below). Deliberately inert: this value is
 * unread by anything else in this module, so its mere presence changes no
 * existing behavior — every one of `wall-timing.test.ts`'s new T07 tests
 * that assert this constant is actually USED (a fixed font size across
 * every card; a derived scroll rate) still fails, correctly, against
 * today's per-card fit.
 */
export const WALL_FONT_SIZE = 44;

/**
 * social pilot 02a T07 (2026-08-26) STUB — see `WALL_FONT_SIZE`'s doc
 * comment immediately above for why this exists and why it is
 * deliberately NOT wired into `WALL_SCROLL_RATE_PX_PER_SEC` yet (T08's
 * job).
 */
export const WALL_SCROLL_LINES_PER_SEC = 4.5;

/**
 * The wall's scroll rate, in px/s, in the composition's 1080x1920 frame
 * space — LINEAR, identical on every card, and the single source of the
 * wall's motion now that the karaoke highlight is gone (F15).
 *
 * F16 (2026-08-26, user decision): dropped from F15's 720px/s to 500px/s —
 * denser type (see `WALL_FONT_SIZE`) at the same speed the reader could no
 * longer track at all; 500px/s keeps the wall clearly outrunning normal
 * reading pace (see the sanity check below) while giving `WALL_FONT_SIZE`'s
 * smaller blocks a fairer chance to still clear the travel floor.
 *
 * The travel floor itself — the minimum `blockHeight` a card's fitted
 * archaic text must clear so the scroll never finishes before the
 * `WALL_SECONDS` (2.5s) hard cut — is DERIVED from this rate, not the other
 * way around (F15's version derived a "safe rate ceiling" from an ASSUMED
 * worst-case block of 2 screens; F16 inverts this because the real pool's
 * blocks vary far more than a single "worst case" screen count usefully
 * describes — see `wall-gate.ts`'s `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`, which
 * is the actual floor every card is gated against):
 * `FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS` =
 * `1920 + 500 * 2.5` = `3170px`. Any card whose fitted `blockHeight` clears
 * that figure is, by construction, guaranteed not to finish scrolling
 * before the cut — see `wall-timing.test.ts`'s "the scroll does not finish
 * before the cut" guard, which asserts this against `computeWallLayout`'s
 * real numbers directly.
 *
 * Sanity check against reading pace, not just against the invariant: at
 * `WALL_FONT_SIZE`'s line height (95px) and the `meditations-07-031`
 * fixture's own real words-per-line (150 words / 34 lines ≈ 4.41), 500px/s
 * is ≈5.26 lines/s ≈ ≈23.2 words/s ≈ ≈1393wpm — roughly 5.6x normal reading
 * pace (~250wpm), well past the original T05 karaoke sweep's 320wpm.
 * Against `discourses-59-004` (201 words / 43 lines ≈ 4.67 words/line):
 * ≈24.6 words/s ≈ ≈1478wpm. Comfortably, unambiguously outrunning the
 * reader at 500px/s on real cards, not just on paper.
 */
export const WALL_SCROLL_RATE_PX_PER_SEC = 500;

/** `WALL_SCROLL_RATE_PX_PER_SEC` per frame at `FPS` — `500 / 30` ≈ 16.667px/frame (not a clean integer at F16's rate, unlike F15's 720/30 = 24). The frame-0-to-frame-1 velocity check in `wall-timing.test.ts` still asserts EXACT equality against this constant itself (not a rounded literal), so the non-integer value doesn't weaken that check. */
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
	/** `blockHeight / FRAME_HEIGHT` — descriptive/reporting only; the load-bearing check lives in `fits` below. */
	screens: number;
	/** Horizontal-only inset — see `WALL_INSET_PX`. */
	insetPx: number;
	/**
	 * True when a font size within `[WALL_FONT_FLOOR_PX, WALL_FONT_CAP_PX]`
	 * reaches `WALL_TARGET_BLOCK_HEIGHT_PX` — i.e. the card CAN be set as a
	 * scroll that survives the wall phase without reading as large-print.
	 * False means `fontSize` is `WALL_FONT_CAP_PX` (the largest allowed) and
	 * even that isn't enough — `wall-gate.ts`'s `gateWallCard` rejects on
	 * this, but `computeWallLayout`/`fitWallFontSize` still return the
	 * best-effort at-cap geometry (not `null`) so a rejection message can
	 * report a real, reportable font size and block height rather than
	 * nothing at all.
	 */
	fits: boolean;
}

/** `computeWallLayout`'s inner measurement at one candidate font size — how `estimateWrappedLineCount`'s raw estimate, corrected by `WALL_LINE_ESTIMATE_OVERSHOOT`, sets `originalExcerpt` at `fontSize` within `WALL_BOX_WIDTH`. */
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

function toWallLayout(
	fontSize: number,
	measured: { lineHeight: number; estimatedLines: number; blockHeight: number },
	fits: boolean
): WallLayout {
	return {
		fontSize,
		lineHeight: measured.lineHeight,
		estimatedLines: measured.estimatedLines,
		blockHeight: measured.blockHeight,
		screens: measured.blockHeight / FRAME_HEIGHT,
		insetPx: WALL_INSET_PX,
		fits
	};
}

/**
 * F18 (2026-08-26): resolves the wall phase's font size and block geometry
 * for `originalExcerpt` by BINARY-SEARCHING `[WALL_FONT_FLOOR_PX,
 * WALL_FONT_CAP_PX]` for the SMALLEST font size whose estimated block height
 * reaches `WALL_TARGET_BLOCK_HEIGHT_PX` — short passages land on a LARGER
 * font (more vertical space needed per word to reach the target), long
 * passages land on a SMALLER one (the same target reached with less type),
 * replacing F16's single fixed `WALL_FONT_SIZE`. This reuses `fit.ts`'s
 * binary-search MACHINERY (`fitFontSize`'s approach), aimed at a different
 * predicate — "does this size's block clear the TARGET height" is
 * monotonically non-decreasing in font size for the same reason
 * `fitFontSize`'s "does this size fit under a max height" is (bigger text
 * both wraps into more lines and has a taller line height), so binary search
 * is valid here too.
 *
 * Three shapes of result:
 *   1. Even `WALL_FONT_FLOOR_PX` already clears the target (a long
 *      excerpt) — use the floor itself (the smallest, densest allowed size)
 *      rather than searching smaller still, which would violate the floor.
 *   2. Even `WALL_FONT_CAP_PX` does NOT clear the target (a short excerpt)
 *      — `fits: false`; `wall-gate.ts` rejects this rather than stretching
 *      further into large-print territory (see `WALL_FONT_CAP_PX`'s doc
 *      comment). The at-cap geometry is still returned (not thrown here —
 *      only the caller, `wall-gate.ts`, decides what a non-fitting card
 *      means for rendering) so a rejection message can report real numbers.
 *   3. The normal case — a real crossover exists inside the range; binary
 *      search finds the smallest font size at or past it.
 *
 * The raw `fit.ts` word-wrap estimate is divided by
 * `WALL_LINE_ESTIMATE_OVERSHOOT` at every candidate size (see that
 * constant's doc comment) so `estimatedLines`/`blockHeight`/`screens`
 * approximate what the composition actually renders at whatever size is
 * chosen, not the naive estimate's overcount — this is what makes the
 * scroll-does-not-finish invariant (`wall-timing.test.ts`) true against the
 * REAL render, not just against an inflated number on paper.
 */
export function fitWallFontSize(originalExcerpt: string): WallLayout {
	const atFloor = measureWallBlockAtFontSize(originalExcerpt, WALL_FONT_FLOOR_PX);
	if (atFloor.blockHeight >= WALL_TARGET_BLOCK_HEIGHT_PX) {
		return toWallLayout(WALL_FONT_FLOOR_PX, atFloor, true);
	}

	const atCap = measureWallBlockAtFontSize(originalExcerpt, WALL_FONT_CAP_PX);
	if (atCap.blockHeight < WALL_TARGET_BLOCK_HEIGHT_PX) {
		return toWallLayout(WALL_FONT_CAP_PX, atCap, false);
	}

	// Standard "find the leftmost font size whose block clears the target"
	// binary search — `atFloor` (too small) and `atCap` (big enough) already
	// bracket a real crossover, so `lo`/`hi` converge to it.
	let lo = WALL_FONT_FLOOR_PX;
	let hi = WALL_FONT_CAP_PX;
	while (lo < hi) {
		const mid = Math.floor((lo + hi) / 2);
		const measured = measureWallBlockAtFontSize(originalExcerpt, mid);
		if (measured.blockHeight >= WALL_TARGET_BLOCK_HEIGHT_PX) {
			hi = mid;
		} else {
			lo = mid + 1;
		}
	}

	return toWallLayout(lo, measureWallBlockAtFontSize(originalExcerpt, lo), true);
}

/**
 * `Wall.tsx` (and everything that reads wall geometry) calls this, not
 * `fitWallFontSize` directly — kept as the stable name across F15/F16/F18's
 * three different implementations (one screen / fixed size / per-card fit)
 * so call sites never needed to change. `Wall.tsx` must render with exactly
 * these numbers, not recompute its own.
 */
export function computeWallLayout(originalExcerpt: string): WallLayout {
	return fitWallFontSize(originalExcerpt);
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
