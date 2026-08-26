/**
 * The Wall's renderability gate.
 *
 * social pilot 02 F16 (2026-08-26) rewrote this module's whole objective.
 * T05/T06 originally auto-fit archaic text into the wall box up to some
 * `WALL_MAX_FONT`, down to some `WALL_MIN_FONT`, and rejected a card whose
 * fitted size bottomed out too small to read — the risk was a card too LONG
 * to fit ONE screen legibly. F15 replaced the auto-fit with a single FIXED
 * `WALL_FONT_SIZE` and turned the wall into a SCROLL, which inverted that
 * risk entirely: since every card renders at the exact same size, no card
 * can ever fail to fit legibly. The risk F16 identified instead was a card
 * too SHORT to keep scrolling for the whole `WALL_SECONDS` wall phase,
 * whose block would finish travelling — its bottom edge reaching the
 * frame's bottom edge — BEFORE the hard cut, breaking the format's "you
 * never even reach the end" invariant. F16 gated that axis with a single
 * fixed-size travel floor (`WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`, below) — but a
 * SINGLE fixed font size can only clear that floor above ~130 words, so it
 * cost 76% of the real Wall pool (219/896 renderable) and broke the
 * read-through outright (no run of 7+ consecutive renderable cards existed
 * anywhere in the corpus).
 *
 * F18 (2026-08-26) keeps the travel floor as the axis (still derived from
 * the same scroll geometry, still named `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`
 * below) but fixes the ROOT CAUSE: `computeWallLayout` (`wall-timing.ts`) no
 * longer uses one fixed font size — it fits each card's own size to a
 * TRAVEL TARGET (`WALL_TARGET_BLOCK_HEIGHT_PX`, comfortably above the
 * travel floor) via `fitWallFontSize`'s binary search, clamped to
 * `[WALL_FONT_FLOOR_PX, WALL_FONT_CAP_PX]`. `gateWallCard` below now checks
 * `layout.fits` — false only when even `WALL_FONT_CAP_PX` (the largest
 * allowed, "any bigger reads as large-print" size) can't reach the target,
 * i.e. the card is too short to set at all without abandoning the wall's
 * dense-set identity. A card that DOES fit is, by the target's own margin
 * over the travel floor, structurally guaranteed to clear
 * `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` too — see `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`'s
 * doc comment for why that check is kept as a belt-and-braces module-load
 * invariant rather than dropped.
 *
 * The legibility floor (`WALL_MIN_LEGIBLE_FONT_PX`, moved to and now defined
 * in `wall-timing.ts` — re-exported here unchanged for every existing
 * caller) does double duty since F18: it's still `question-gate.ts`'s and
 * `objection-gate.ts`'s own floor for their real per-card `fitFontSize`
 * searches, AND it's now `fitWallFontSize`'s own `WALL_FONT_FLOOR_PX` too —
 * restoring (for a different mechanical reason) the role it played
 * pre-F15/F16, before a fixed wall size made it briefly dead weight for the
 * Wall specifically.
 *
 * Nothing here re-derives or tunes `wall-timing.ts`'s layout numbers — see
 * `computeWallLayout`/`fitWallFontSize` for the single source of truth on
 * font size and block geometry.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only): both
 * `Wall.tsx` and `Root.tsx`'s `calculateMetadata` import from this module
 * directly, and both get bundled by Remotion's browser-side webpack build.
 * Surveying the real card pool off disk lives in `wall-pool.ts` instead.
 */

import {
	computeWallLayout,
	computeWallRawTotalFrames,
	splitWords,
	FPS,
	FRAME_HEIGHT,
	WALL_SECONDS,
	WALL_SCROLL_RATE_PX_PER_SEC,
	WALL_TARGET_BLOCK_HEIGHT_PX,
	WALL_FONT_CAP_PX,
	WALL_REFERENCE_VIEWPORT_WIDTH,
	WALL_MIN_LEGIBLE_FONT_PX,
	type NarrationLineTiming,
	type WallLayout
} from './wall-timing.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from './duration-bounds.js';
import { selectLandingLine } from './landing-line.js';

// ---------------------------------------------------------------------------
// The legibility floor — MOVED to `wall-timing.ts` in F18 (it's now also
// `fitWallFontSize`'s own `WALL_FONT_FLOOR_PX` — see this module's doc
// comment). Re-exported here, unchanged, for every caller that already
// imports it from this module (`question-gate.ts` imports its own
// independent floor; `objection-gate.ts` imports THIS one, via
// `OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX`) and every test that does the same.
// ---------------------------------------------------------------------------

export { WALL_REFERENCE_VIEWPORT_WIDTH, WALL_MIN_LEGIBLE_FONT_PX };

// ---------------------------------------------------------------------------
// The travel floor — the axis that actually governs The Wall (F16, kept by F18)
// ---------------------------------------------------------------------------

/**
 * The minimum `WallLayout.blockHeight` (px) a card's fitted archaic text
 * must exceed for the scroll to survive the full `WALL_SECONDS` wall phase
 * without finishing before the hard cut. Derived directly from the same
 * geometry `wall-timing.ts`'s `wallScrollOffsetAtFrame` uses, not
 * hardcoded: at the LAST wall frame the scroll has travelled
 * `WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS` px, and the block's bottom
 * edge must still sit below the frame's bottom edge — i.e.
 * `blockHeight - (WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS) > FRAME_HEIGHT`,
 * which rearranges to `blockHeight > FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC
 * * WALL_SECONDS` — exactly this constant. At F16/F18's numbers
 * (`FRAME_HEIGHT` 1920, `WALL_SCROLL_RATE_PX_PER_SEC` 500, `WALL_SECONDS`
 * 2.5): `1920 + 500 * 2.5` = `3170`.
 *
 * F18 no longer checks this directly in `gateWallCard` (which now checks
 * `layout.fits`, driven by `WALL_TARGET_BLOCK_HEIGHT_PX` instead — see this
 * module's doc comment) — kept, exported, and asserted as a module-load
 * invariant below purely as a belt-and-braces cross-check: a card
 * `fitWallFontSize` accepts is only SUPPOSED to clear this by construction
 * (the target sits safely above it), and this constant is what lets that
 * assumption be verified rather than merely assumed.
 */
export const WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX = FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS;

if (WALL_TARGET_BLOCK_HEIGHT_PX <= WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX) {
	throw new Error(
		`invariant violated: WALL_TARGET_BLOCK_HEIGHT_PX (${WALL_TARGET_BLOCK_HEIGHT_PX}) must stay above ` +
			`WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX (${WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX}) — otherwise a card ` +
			'`fitWallFontSize` accepts as reaching the target could still finish scrolling before the cut.'
	);
}

// ---------------------------------------------------------------------------
// The landing-line requirement (social pilot 02a T02)
// ---------------------------------------------------------------------------

/**
 * Defense-in-depth backstop against the whole-passage payoff defect T02
 * fixes: "never fall back to the whole passage... a word-count backstop in
 * the composition so a whole-passage payoff can never render again." The
 * primary fix is upstream — `scripts/lib/schedule.ts`'s `tryReadThroughContent`
 * no longer falls back to `card.plain_english` when `selectLandingLine`
 * finds no qualifying sentence — but this constant lets the gate itself
 * refuse to render ANY `landingLine` long enough to look like a passage
 * rather than a payoff sentence, independent of how upstream chose it.
 *
 * Deliberately NOT `landing-line.ts`'s own `LANDING_LINE_MAX_WORDS` (18) —
 * that is the mechanical SELECTION bound (how a landing line is chosen);
 * this is a much looser RENDER-TIME backstop (how long a chosen line is
 * allowed to be before something has clearly gone wrong upstream), kept
 * generously above it so it never rejects a real, correctly-selected
 * landing line.
 */
export const WALL_LANDING_LINE_MAX_WORDS = 30;

// ---------------------------------------------------------------------------
// The Wall-specific duration ceiling (social pilot 02a T03)
// ---------------------------------------------------------------------------

/**
 * A Wall-specific duration ceiling, well under `duration-bounds.ts`'s shared
 * `MAX_POST_DURATION_SECONDS` (59s) — the plan's "shorten the payoff by
 * pacing, not by rejecting cards" decision. A per-card line CAP was measured
 * and rejected: capping payoff lines at 6 keeps the read-through's Walls
 * shortest but costs 11 of its 30 Walls (19/29 Wall/Still); no cap at all
 * keeps all 30 but produces up to 11 hard cuts over ~38-44s, which reads as
 * a slideshow. Pairing `DEFAULT_LINE_SECONDS`'s drop (3.5s -> 3.0s) with
 * THIS ceiling instead rejects a card only when it is genuinely too long at
 * that pacing (measured: zero of the read-through's 30 real Walls cross it),
 * rather than truncating a card's payoff mid-passage to force it under a
 * line count.
 *
 * 40s, not `MAX_POST_DURATION_FRAMES`'s 59s: chosen so the read-through's
 * measured max (real cards, `DEFAULT_LINE_SECONDS` at 3.0s) sits under it
 * with margin, while a card whose payoff runs long enough to approach the
 * shared 59s ceiling anyway is caught here FIRST, at a threshold specific to
 * what actually reads well for this format, rather than only at the point
 * every format's encode profile refuses to ship at all.
 *
 * Reuses the existing `'duration'` `WallGateResult.failure` variant (see
 * `gateWallCard` below) rather than adding a new one — this is the same
 * KIND of rejection (composition runs too long) as the shared 59s ceiling,
 * just checked against a Wall-specific, stricter threshold; the reason
 * string is what distinguishes which ceiling actually rejected a card.
 *
 * Caveat carried forward from the plan: this fallback pacing lever (and
 * this ceiling) governs the MUSIC-ONLY case. Once T14's voices land, real
 * line durations come from `narrationTimings`, not `DEFAULT_LINE_FRAMES` —
 * at that point this ceiling may start rejecting cards it does not reject
 * today, which is expected, not a regression to re-tune around blindly.
 */
export const WALL_MAX_DURATION_SECONDS = 40;
export const WALL_MAX_DURATION_FRAMES = Math.round(WALL_MAX_DURATION_SECONDS * FPS);

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

/**
 * Everything besides `originalExcerpt` the gate needs to also check the
 * `MAX_POST_DURATION_FRAMES` ceiling and the landing-line requirement (T02)
 * — all optional so every existing single-argument call site (Question's
 * reuse of the wall's archaic-text phase, which has no `plainLines` of its
 * own; the legibility-only tests below) keeps working exactly as before: an
 * omitted `plainLines` computes a duration of just the fixed wall +
 * landing-line phases (well under the ceiling on its own), so the duration
 * check is a no-op rather than a false rejection for those callers, and
 * omitting both `plainEnglish` and `landingLine` skips the landing-line
 * check entirely.
 */
export interface WallGateContentInput {
	/** The rest of the plain passage, in order, excluding the landing line — see `WallTimingInput.plainLines`. */
	plainLines?: string[];
	/** Optional per-line narration timing — see `WallTimingInput.narrationTimings`. */
	narrationTimings?: NarrationLineTiming[];
	/**
	 * The card's raw `plain_english` (T02). When supplied, the gate requires
	 * `selectLandingLine` (`./landing-line.js`) to find a qualifying sentence
	 * — "no qualifying landing line -> not a Wall" (the plan's decision),
	 * enforced here as well as in `scripts/lib/schedule.ts`'s
	 * `tryReadThroughContent`.
	 */
	plainEnglish?: string;
	/**
	 * The landing line the composition would actually render (T02) — checked
	 * against `WALL_LANDING_LINE_MAX_WORDS` as a backstop so a whole passage
	 * fed into this prop by a regression can never render as a payoff.
	 */
	landingLine?: string;
}

export type WallGateResult =
	| { ok: true; layout: WallLayout }
	| {
			ok: false;
			reason: string;
			/** Which floor/ceiling/requirement rejected the card — lets callers (e.g. `surveyWallPool`) tally them separately. */
			failure: 'travel' | 'duration' | 'landingLine';
			blockHeight?: number;
			wordCount?: number;
			totalFrames?: number;
			lineCount?: number;
	  };

/**
 * Runs `computeWallLayout` for `originalExcerpt` and rejects it when ANY of:
 *   1. `layout.fits` is false — even `WALL_FONT_CAP_PX` (the largest font
 *      `fitWallFontSize` will use before a card would read as large-print)
 *      cannot reach `WALL_TARGET_BLOCK_HEIGHT_PX`, so the card cannot be set
 *      as a scroll that both survives the wall phase without finishing
 *      before the cut AND keeps the wall's dense-set identity (F16 found
 *      this axis; F18 re-derived it around a per-card fit instead of one
 *      fixed size — see `wall-timing.ts`'s `fitWallFontSize`);
 *   2. `content.plainEnglish` is supplied and has no qualifying landing line
 *      (T02) — "no qualifying landing line -> not a Wall", so a card that
 *      would otherwise fall back to rendering its whole passage as the
 *      payoff is rejected instead;
 *   3. `content.landingLine` is supplied and runs over `WALL_LANDING_LINE_MAX_WORDS`
 *      (T02) — the render-time backstop against the same whole-passage
 *      payoff, independent of how the line was chosen;
 *   4. the composition's pre-padding duration (wall + landing line + every
 *      rest line from `content.plainLines`) exceeds `MAX_POST_DURATION_FRAMES`
 *      — the same ceiling `padToMinimumDuration` enforces, but caught here,
 *      at pool-survey time, instead of at render time (see `duration-bounds.ts`
 *      and F03);
 *   5. that same pre-padding duration exceeds `WALL_MAX_DURATION_FRAMES`
 *      (T03) — a Wall-specific ceiling stricter than #4's shared one, paired
 *      with `wall-timing.ts`'s `DEFAULT_LINE_SECONDS` pacing so a card with
 *      many payoff lines is rejected outright rather than truncated mid-passage.
 * Never renders a card whose scroll would finish early, never falls back to
 * the whole passage, and never trims to either duration ceiling — a
 * rejection is a rejection, to be excluded upstream (see `surveyWallPool`)
 * or to fail a render outright (see `assertWallCardRenderable`).
 */
export function gateWallCard(originalExcerpt: string, content: WallGateContentInput = {}): WallGateResult {
	const layout = computeWallLayout(originalExcerpt);
	const wordCount = splitWords(originalExcerpt).length;

	if (!layout.fits) {
		return {
			ok: false,
			failure: 'travel',
			reason:
				`Wall card rejected: ${wordCount} words reach only ${Math.round(layout.blockHeight)}px even at the ` +
				`${WALL_FONT_CAP_PX}px font cap, short of the ${WALL_TARGET_BLOCK_HEIGHT_PX}px target block height ` +
				`(the minimum with enough margin over the ${WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX}px travel floor for the ` +
				`scroll to survive ${WALL_SECONDS}s at ${WALL_SCROLL_RATE_PX_PER_SEC}px/s without finishing before ` +
				`the cut) — setting it any larger would read as large-print rather than a dense wall.`,
			blockHeight: layout.blockHeight,
			wordCount
		};
	}

	if (content.plainEnglish !== undefined && selectLandingLine(content.plainEnglish) === null) {
		return {
			ok: false,
			failure: 'landingLine',
			reason:
				'Wall card rejected: plain_english has no qualifying landing line — selectLandingLine ' +
				'(landing-line.ts) found no self-contained sentence within the mechanical bounds, so this card ' +
				'cannot pay off as a Wall. No whole-passage fallback: route it to Still instead.'
		};
	}

	if (content.landingLine !== undefined) {
		const landingLineWordCount = splitWords(content.landingLine).length;
		if (landingLineWordCount > WALL_LANDING_LINE_MAX_WORDS) {
			return {
				ok: false,
				failure: 'landingLine',
				reason:
					`Wall card rejected: the landing line is ${landingLineWordCount} words, over the ` +
					`${WALL_LANDING_LINE_MAX_WORDS}-word backstop — a landing line this long reads as a whole ` +
					'passage, not a one-sentence payoff, and must never reach the composition.'
			};
		}
	}

	const plainLines = content.plainLines ?? [];
	const totalFrames = computeWallRawTotalFrames({
		originalExcerpt,
		plainLines,
		narrationTimings: content.narrationTimings
	});

	if (totalFrames > MAX_POST_DURATION_FRAMES) {
		return {
			ok: false,
			failure: 'duration',
			reason:
				`Wall card rejected: composition computes to ${totalFrames} frames ` +
				`(${(totalFrames / FPS).toFixed(1)}s) across ${plainLines.length} plain-passage ` +
				`line${plainLines.length === 1 ? '' : 's'}, over the ${MAX_POST_DURATION_FRAMES}-frame ` +
				`(${MAX_POST_DURATION_SECONDS}s) ceiling.`,
			totalFrames,
			lineCount: plainLines.length
		};
	}

	// social pilot 02a T03: a second, Wall-specific ceiling — stricter than
	// the shared 59s bound above, and checked second so a card already
	// caught by the shared ceiling reports against that ceiling's own
	// number rather than this one. See `WALL_MAX_DURATION_SECONDS`'s doc
	// comment for why pacing (`DEFAULT_LINE_SECONDS`), not a line cap, is
	// paired with this ceiling — never truncated mid-passage, only rejected.
	if (totalFrames > WALL_MAX_DURATION_FRAMES) {
		return {
			ok: false,
			failure: 'duration',
			reason:
				`Wall card rejected: composition computes to ${totalFrames} frames ` +
				`(${(totalFrames / FPS).toFixed(1)}s) across ${plainLines.length} plain-passage ` +
				`line${plainLines.length === 1 ? '' : 's'}, over the ${WALL_MAX_DURATION_FRAMES}-frame ` +
				`(${WALL_MAX_DURATION_SECONDS}s) Wall-specific ceiling (the shared ` +
				`${MAX_POST_DURATION_SECONDS}s post ceiling is not the binding one here).`,
			totalFrames,
			lineCount: plainLines.length
		};
	}

	return { ok: true, layout };
}

/**
 * `gateWallCard`, but throws instead of returning a result — the shape a
 * render pipeline needs so an un-renderable card fails the render outright
 * rather than producing a bad frame. Wired into `Root.tsx`'s
 * `calculateMetadata` (which Remotion runs before any frame is rendered)
 * and into `Wall.tsx` itself, so both the composition-selection path and a
 * direct render of the component reject the same cards.
 */
export function assertWallCardRenderable(originalExcerpt: string, content: WallGateContentInput = {}): WallLayout {
	const result = gateWallCard(originalExcerpt, content);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.layout;
}

// Surveying the real pool (`resolveWallCardExcerpt`, `surveyWallPool`) lives
// in `wall-pool.ts`, not here — that helper reads `content/output/` off disk
// with `node:fs`, which cannot be bundled into Remotion's browser-side
// webpack build. Keeping this module fs-free is what lets `Wall.tsx` and
// `Root.tsx` import it directly.
