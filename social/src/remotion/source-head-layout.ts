/**
 * Pure geometry for the framing layer's running head / payoff label — see
 * `SourceHead.tsx`. Kept separate from the component, same pattern as
 * `counter-layout.ts` vs `Counter.tsx`: the numbers are testable without
 * rendering a frame, and `SourceHead.tsx` renders exactly what this module
 * resolves, never a recomputed value of its own.
 *
 * social pilot 02a T11 (2026-08-26): written ahead of T12's real component —
 * see that file's own doc comment for why these are real, final numbers
 * rather than placeholders (same "correct value, simply not yet wired into
 * on-screen behaviour" pattern T07 used for `wall-timing.ts`'s
 * `WALL_FONT_SIZE`).
 */

import { COUNTER_BOUNDING_BOX, COUNTER_SAFE_INSET_PX, type CounterBoundingBox } from './counter-layout.js';

/**
 * Same left inset as the read-through counter (`COUNTER_SAFE_INSET_PX`) —
 * both are top-left framing text. See `counter-layout.ts`'s doc comment for
 * why top-left, specifically, is the one corner none of TikTok/Reels/
 * Shorts' standard platform chrome (engagement rail, caption band, search
 * icon) reliably overlaps.
 */
export const SOURCE_HEAD_SAFE_INSET_PX = COUNTER_SAFE_INSET_PX;

/**
 * The running head/payoff label stacks directly BELOW the read-through
 * counter's own bounding box, rather than occupying a second corner —
 * trading the one platform-chrome-safe corner for an unsafe one (top-right,
 * bottom-*, per `counter-layout.ts`) would reintroduce exactly the risk
 * `COUNTER_SAFE_INSET_PX` exists to avoid. Stacking two short lines of
 * small type in one corner is ordinary masthead layout, not a squeeze.
 */
export const SOURCE_HEAD_GAP_BELOW_COUNTER_PX = 40;

/**
 * Derived from `COUNTER_BOUNDING_BOX`, not a second hand-picked number —
 * this is what makes the two framing elements disjoint BY CONSTRUCTION
 * (moving the counter's own box would move this too, keeping them apart)
 * rather than by two numbers that happen not to collide today.
 */
export const SOURCE_HEAD_TOP_PX = COUNTER_BOUNDING_BOX.top + COUNTER_BOUNDING_BOX.height + SOURCE_HEAD_GAP_BELOW_COUNTER_PX;

/**
 * Deliberately small — framing text, not display type, per Constraint 6.
 * A little larger than the counter's bare page-number (`COUNTER_FONT_SIZE_PX`,
 * 28px) because the running head carries more characters (an author name
 * plus a book/chapter reference) at a similar reading distance; still well
 * under any size this workspace treats as "display" text.
 */
export const SOURCE_HEAD_FONT_SIZE_PX = 32;

/**
 * A generous bounding box the running head/payoff label's rendered text can
 * never exceed — used by `__tests__/source-head.test.ts` (and the pixel-proof
 * helpers it shares with `__tests__/counter.test.ts`) to crop this region out
 * of an otherwise byte-identical no-reflow comparison. `left: 0` and a wide
 * `width` (900px) so even the longest real running head (an author's full
 * display name plus a book title and chapter reference, e.g. "MARCUS
 * AURELIUS · MEDITATIONS, BOOK 12") sits comfortably inside it at
 * `SOURCE_HEAD_FONT_SIZE_PX`. `top` is `SOURCE_HEAD_TOP_PX`, strictly below
 * `COUNTER_BOUNDING_BOX`'s own bottom edge, so this box and the counter's are
 * non-overlapping by construction — see `SOURCE_HEAD_TOP_PX`'s doc comment.
 */
export const SOURCE_HEAD_BOUNDING_BOX: CounterBoundingBox = {
	top: SOURCE_HEAD_TOP_PX,
	left: 0,
	width: 900,
	height: 120
};
