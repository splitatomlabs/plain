/**
 * The Wall's legibility gate (T06).
 *
 * `wall-timing.ts`'s `computeWallLayout` auto-fits archaic text into the
 * wall box, up to `WALL_MAX_FONT`, down to `WALL_MIN_FONT` — but a fit that
 * bottoms out at a small size is still "a fit". The house rule is that the
 * wall must be ILLEGIBLE because of density, archaism and the racing
 * highlight, never because the type itself has shrunk below what a phone
 * screen can actually resolve. This module is the other side of that rule:
 * it observes the layout T05 already computed and REJECTS any card whose
 * fitted size falls under the legibility floor, rather than shrinking
 * further or rendering anyway.
 *
 * Nothing here re-derives or tunes the T05 layout numbers — see
 * `computeWallLayout` for the single source of truth on font fitting.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only): both
 * `Wall.tsx` and `Root.tsx`'s `calculateMetadata` import from this module
 * directly, and both get bundled by Remotion's browser-side webpack build.
 * Surveying the real card pool off disk lives in `wall-pool.ts` instead.
 */

import { computeWallLayout, splitWords, FRAME_WIDTH, WALL_MIN_FONT, type WallLayout } from './wall-timing.js';

// ---------------------------------------------------------------------------
// The legibility floor
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
 * house rule that illegibility must come from density and archaism, not
 * from undersized type.
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

// `WALL_MIN_FONT` (16) is `fitFontSize`'s absolute fallback — what it
// returns when nothing in `[WALL_MIN_FONT, WALL_MAX_FONT]` fits at all. As
// long as that fallback sits below the legibility floor (it does: 16 < 39),
// "does not fit at all" and "fits, but too small" are the same observable
// failure — both surface as `layout.fontSize < WALL_MIN_LEGIBLE_FONT_PX` —
// so `gateWallCard` needs only one check. This assertion makes that
// assumption fail loudly instead of silently if either constant ever moves.
if (WALL_MIN_FONT >= WALL_MIN_LEGIBLE_FONT_PX) {
	throw new Error(
		`invariant violated: WALL_MIN_FONT (${WALL_MIN_FONT}) must stay below WALL_MIN_LEGIBLE_FONT_PX ` +
			`(${WALL_MIN_LEGIBLE_FONT_PX}) — otherwise a card that fails to fit at all would report a ` +
			`fontSize the gate mistakes for a legible fit.`
	);
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export type WallGateResult =
	| { ok: true; layout: WallLayout }
	| { ok: false; reason: string; fontSize: number; wordCount: number };

/**
 * Runs `computeWallLayout` for `originalExcerpt` and rejects it when the
 * fitted font size falls below `WALL_MIN_LEGIBLE_FONT_PX` (which, per the
 * invariant above, also covers the "did not fit at all" case). Never
 * shrinks below the floor and never renders anyway — a rejection is a
 * rejection, to be excluded upstream (see `surveyWallPool`) or to fail a
 * render outright (see `assertWallCardRenderable`).
 */
export function gateWallCard(originalExcerpt: string): WallGateResult {
	const layout = computeWallLayout(originalExcerpt);
	const wordCount = splitWords(originalExcerpt).length;

	if (layout.fontSize < WALL_MIN_LEGIBLE_FONT_PX) {
		return {
			ok: false,
			reason:
				`Wall card rejected: ${wordCount} words fit the wall box only at ${layout.fontSize}px, ` +
				`below the ${WALL_MIN_LEGIBLE_FONT_PX}px legibility floor (the 1080-frame equivalent of ` +
				`${WALL_MIN_LEGIBLE_CSS_PX}px on a ${WALL_REFERENCE_VIEWPORT_WIDTH}px-wide reference phone).`,
			fontSize: layout.fontSize,
			wordCount
		};
	}

	return { ok: true, layout };
}

/**
 * `gateWallCard`, but throws instead of returning a result — the shape a
 * render pipeline needs so an over-long card fails the render outright
 * rather than producing an illegible frame. Wired into `Root.tsx`'s
 * `calculateMetadata` (which Remotion runs before any frame is rendered)
 * and into `Wall.tsx` itself, so both the composition-selection path and a
 * direct render of the component reject the same cards.
 */
export function assertWallCardRenderable(originalExcerpt: string): WallLayout {
	const result = gateWallCard(originalExcerpt);
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
