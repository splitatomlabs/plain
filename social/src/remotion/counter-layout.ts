/**
 * Pure geometry for the read-through counter overlay — see `Counter.tsx`.
 * Kept separate from the component, same pattern as `wall-timing.ts` vs
 * `Wall.tsx`, so the numbers are testable without rendering a frame.
 */

/**
 * Inset, in frame px (the 1080x1920 reference frame every composition in
 * this workspace renders to — see `wall-timing.ts`'s `FRAME_WIDTH` /
 * `FRAME_HEIGHT`), from BOTH the top and left edges of the frame.
 *
 * SAFE-AREA CORNER: top-left.
 *
 * Platform chrome (TikTok/Reels/Shorts) reliably covers two regions of a
 * 1080x1920 frame in the default feed view: a right-hand engagement rail
 * (like/comment/share/bookmark/sound, roughly the right ~140px) and a
 * bottom caption/username/music band (roughly the bottom ~300px). Top-left
 * is the one corner none of the three platforms' standard chrome overlaps
 * — unlike top-right, which TikTok's own search icon sometimes occupies.
 * Hence top-left, not any of the other three corners.
 *
 * social pilot 02a U02 (2026-08-27): phone-review feedback on The Wall asked
 * for the counter to move to CENTRED BELOW THE PAYOFF TEXT instead of this
 * corner — see `computeCounterBelowTextBox` below for that geometry, used by
 * `Wall.tsx`/`Question.tsx`/`Objection.tsx`'s shared `PayoffLine`. This
 * constant (and `COUNTER_BOUNDING_BOX` below) is NOT dead code even so: it
 * remains the ONLY placement `Still.tsx` uses. The Still's payoff text is not
 * a short held sentence like the other three formats' — it is the card's
 * ENTIRE `plain_english` passage, fitted into `STILL_BOX_HEIGHT` (1600px of
 * the 1920px frame — see `still-timing.ts`). Measured against the real
 * read-through corpus (`content/social/pilot-schedule-w01.json`'s two real
 * Still cards, Meditations book-02/03), that text alone already renders
 * 1512-1558px tall, centred — i.e. its own bottom edge already sits at
 * y=1746-1739, inside the very bottom platform-chrome band this constant's
 * own doc comment warns about. There is no y-coordinate below that text
 * that is both "below the text" and outside that unsafe band for every real
 * Still card, so U02 does not move Still's counter — it stays in this
 * corner, safely clear of both platform-chrome regions, unchanged.
 */
export const COUNTER_SAFE_INSET_PX = 64;

/**
 * Deliberately small — a page number, not display type. Well under the
 * ~78px legibility floor `Objection.tsx` uses for its large accent-coloured
 * headline text; the counter is meant to recede, not compete on screen.
 */
export const COUNTER_FONT_SIZE_PX = 28;

export interface CounterBoundingBox {
	top: number;
	left: number;
	width: number;
	height: number;
}

/**
 * A generous bounding box the counter's rendered text can never exceed,
 * anchored at the frame's own (0, 0) top-left corner — used by
 * `__tests__/counter.test.tsx` to crop the counter's own region out of an
 * otherwise byte-identical no-reflow pixel comparison. Generous on
 * purpose: it only needs to be big enough to contain the text, not tight
 * around it — a bigger box only makes the "everything outside the box is
 * pixel-identical" proof stricter, never weaker. At `COUNTER_FONT_SIZE_PX`
 * (28px) even a long "Card 999 of 9999" label sits well inside this.
 */
export const COUNTER_BOUNDING_BOX: CounterBoundingBox = {
	top: 0,
	left: 0,
	width: 480,
	height: 160
};

// ---------------------------------------------------------------------------
// social pilot 02a U02 (2026-08-27) — centred-below-text placement
// ---------------------------------------------------------------------------

/**
 * Gap, in frame px, between the payoff text's own rendered bottom edge and
 * the below-text counter's top edge (Wall/Question/Objection's still payoff
 * phases — see `computeCounterBelowTextBox`). `SOURCE_HEAD_GAP_BELOW_COUNTER_PX`
 * (`source-head-layout.ts`) uses the same value for the OLD corner-stacked
 * masthead layout Still still uses; reused here rather than a fresh
 * hand-picked number for the same "ordinary reading rhythm, not a squeeze"
 * reasoning — plenty of visual room between a line of body-sized quoted
 * text and a much smaller page-number underneath it.
 */
export const COUNTER_GAP_BELOW_TEXT_PX = 40;

/**
 * The below-text counter's own box width/height — deliberately identical to
 * `COUNTER_BOUNDING_BOX`'s (480x160), not a second hand-picked pair: the
 * counter's own rendered text (`COUNTER_FONT_SIZE_PX`, up to a "Card 999 of
 * 9999" label) is the same text in both placements, so the same generous
 * box that already comfortably contains it in the corner also comfortably
 * contains it here.
 */
export const COUNTER_BELOW_TEXT_BOX_WIDTH_PX = COUNTER_BOUNDING_BOX.width;
export const COUNTER_BELOW_TEXT_BOX_HEIGHT_PX = COUNTER_BOUNDING_BOX.height;

/**
 * The bottom platform-chrome band's own height, in frame px — the same
 * "~300px" `COUNTER_SAFE_INSET_PX`'s doc comment already cites for the
 * bottom caption/username/music band TikTok/Reels/Shorts reliably cover.
 * Named as its own constant (rather than a bare `300` inlined at the one
 * call site below) so the safety check below and any future caller both
 * read against the SAME cited number, not a copy that could silently drift
 * from the doc comment that justifies it.
 */
export const COUNTER_BOTTOM_UNSAFE_ZONE_PX = 300;

/**
 * Computes the below-text counter's own bounding box for a payoff text
 * block `blockHeight` px tall — the shared geometry `Wall.tsx`'s
 * `PayoffLine` (reused by Question/Objection's own payoff phases) actually
 * renders. Every payoff line in this workspace is a flex-centred block
 * inside the full `frameHeight`-tall frame (see `PayoffLine`), so its own
 * bottom edge sits at `frameHeight / 2 + blockHeight / 2` regardless of how
 * tall that particular card's fitted text happens to be — the counter's own
 * top is derived FROM that edge plus a fixed gap, not a guessed constant, so
 * a one-line landing sentence and the longest real rest line in the corpus
 * each get a counter positioned relative to THEIR OWN actual text.
 *
 * Horizontally centred on the frame's own midline (`frameWidth / 2`), not
 * the text's own (usually narrower) measured width — matching "horizontally
 * centred below the text block", not "centred under this line's own glyphs
 * specifically", which would jitter left/right between cards purely from
 * sentence-length differences.
 *
 * Takes `frameWidth`/`frameHeight` as parameters rather than importing
 * `wall-timing.ts`'s `FRAME_WIDTH`/`FRAME_HEIGHT` directly — `source-head-
 * layout.ts` already imports FROM this module (for `COUNTER_BOUNDING_BOX`),
 * and `wall-timing.ts` needs to import THIS function (to compute
 * `computePayoffCounterBox`, see that module) — an import the other way
 * would create a cycle between this module and `wall-timing.ts`.
 */
export function computeCounterBelowTextBox(blockHeight: number, frameWidth: number, frameHeight: number): CounterBoundingBox {
	return {
		top: frameHeight / 2 + blockHeight / 2 + COUNTER_GAP_BELOW_TEXT_PX,
		left: (frameWidth - COUNTER_BELOW_TEXT_BOX_WIDTH_PX) / 2,
		width: COUNTER_BELOW_TEXT_BOX_WIDTH_PX,
		height: COUNTER_BELOW_TEXT_BOX_HEIGHT_PX
	};
}
