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
 * fixed-size travel floor (`WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`, since deleted)
 * — but a SINGLE fixed font size can only clear that floor above ~130
 * words, so it cost 76% of the real Wall pool (219/896 renderable) and
 * broke the read-through outright (no run of 7+ consecutive renderable
 * cards existed anywhere in the corpus). F18 (2026-08-26) tried fixing the
 * ROOT CAUSE by fitting each card's own font size to a travel TARGET
 * instead of one fixed size — supply came back, but at the cost of the
 * wall's own identity: block height scales with the SQUARE of font size, so
 * a short card could only buy enough travel by setting itself as large
 * print (65-91px), not a dense wall.
 *
 * social pilot 02a T08 (2026-08-26) DELETES the travel floor as a gate axis
 * entirely, rather than re-tuning it again — `layout.fits` (F18's own
 * result of that search) is gone along with the search itself
 * (`fitWallFontSize`, `WALL_TARGET_BLOCK_HEIGHT_PX`, `WALL_FONT_FLOOR_PX`,
 * `WALL_FONT_CAP_PX`), and `gateWallCard` below no longer rejects a card on
 * block height at all. The never-finishes invariant this floor existed to
 * enforce still holds — but now BY CONSTRUCTION: the wall's font size is
 * fixed again (`WALL_FONT_SIZE`, 44px, `wall-timing.ts`) and the block it
 * scrolls through is sourced from the surrounding CHAPTER, not the single
 * card (`chapter-text.ts`, T05/T06), comfortably clearing the ~412 words a
 * 44px/4.5-lines-per-second scroll needs to outrun its `WALL_SECONDS` hard
 * cut. A card is never too SHORT to set as a wall anymore, because the wall
 * was never really about that one card's own excerpt length in the first
 * place.
 *
 * T08's own measurement of "comfortably clearing" was Meditations-only
 * (thousands of words per chapter there) and didn't generalize — social
 * pilot 02a REVIEW R02 (2026-08-26) found 53 of 685 non-excluded real Wall
 * pool entries whose own chapter (Enchiridion's median chapter is 94 words)
 * fell short of the floor on a single lap. Rather than reintroducing this
 * axis as a rejection, `chapter-text.ts`'s `buildChapterTextBlock` now
 * repeats a too-short chapter's own lap — whole, verbatim, never
 * fabricated or padded — until IT clears the floor, so the never-finishes
 * invariant holds unconditionally, by construction, for every chapter
 * length in the real corpus, not just Meditations'. See that function's own
 * doc comment for the reasoning and the measured repeat counts.
 *
 * The legibility floor (`WALL_MIN_LEGIBLE_FONT_PX`, defined in
 * `wall-timing.ts`, re-exported here unchanged for every existing caller)
 * is unaffected by any of this — it's still `question-gate.ts`'s and
 * `objection-gate.ts`'s own floor for their real per-card `fitFontSize`
 * searches, which this plan does not touch.
 *
 * Nothing here re-derives or tunes `wall-timing.ts`'s layout numbers — see
 * `computeWallLayout` for the single source of truth on font size and block
 * geometry.
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
	WALL_REFERENCE_VIEWPORT_WIDTH,
	WALL_MIN_LEGIBLE_FONT_PX,
	type NarrationLineTiming,
	type WallLayout
} from './wall-timing.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from './duration-bounds.js';
import { selectLandingLine } from './landing-line.js';

// ---------------------------------------------------------------------------
// The legibility floor — defined in `wall-timing.ts`. Re-exported here,
// unchanged, for every caller that already imports it from this module
// (`question-gate.ts` imports its own independent floor; `objection-gate.ts`
// imports THIS one, via `OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX`) and every test
// that does the same.
// ---------------------------------------------------------------------------

export { WALL_REFERENCE_VIEWPORT_WIDTH, WALL_MIN_LEGIBLE_FONT_PX };

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
			/** Which ceiling/requirement rejected the card — lets callers (e.g. `surveyWallPool`) tally them separately. */
			failure: 'duration' | 'landingLine';
			totalFrames?: number;
			lineCount?: number;
	  };

/**
 * Runs `computeWallLayout` for `originalExcerpt` and rejects it when ANY of:
 *   1. `content.plainEnglish` is supplied and has no qualifying landing line
 *      (T02) — "no qualifying landing line -> not a Wall", so a card that
 *      would otherwise fall back to rendering its whole passage as the
 *      payoff is rejected instead;
 *   2. `content.landingLine` is supplied and runs over `WALL_LANDING_LINE_MAX_WORDS`
 *      (T02) — the render-time backstop against the same whole-passage
 *      payoff, independent of how the line was chosen;
 *   3. the composition's pre-padding duration (wall + landing line + every
 *      rest line from `content.plainLines`) exceeds `MAX_POST_DURATION_FRAMES`
 *      — the same ceiling `padToMinimumDuration` enforces, but caught here,
 *      at pool-survey time, instead of at render time (see `duration-bounds.ts`
 *      and F03);
 *   4. that same pre-padding duration exceeds `WALL_MAX_DURATION_FRAMES`
 *      (T03) — a Wall-specific ceiling stricter than #3's shared one, paired
 *      with `wall-timing.ts`'s `DEFAULT_LINE_SECONDS` pacing so a card with
 *      many payoff lines is rejected outright rather than truncated mid-passage.
 *
 * social pilot 02a T08 (2026-08-26): no longer rejects on block height at
 * all — see this module's own doc comment for why that axis is gone, not
 * merely relaxed. `computeWallLayout` is still called (its `layout` is what
 * an `ok: true` result carries), just never consulted to reject.
 *
 * Never renders a card whose scroll would finish early, never falls back to
 * the whole passage, and never trims to either duration ceiling — a
 * rejection is a rejection, to be excluded upstream (see `surveyWallPool`)
 * or to fail a render outright (see `assertWallCardRenderable`).
 */
export function gateWallCard(originalExcerpt: string, content: WallGateContentInput = {}): WallGateResult {
	const layout = computeWallLayout(originalExcerpt);

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
