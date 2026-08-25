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
