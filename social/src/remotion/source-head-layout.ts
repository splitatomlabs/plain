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

/**
 * Social pilot 02a R04 (2026-08-26): the maximum on-screen width the running
 * head / payoff label's text may occupy, in frame px — `SourceHead.tsx`
 * clamps to exactly this with a single-line `overflow: hidden` +
 * `textOverflow: 'ellipsis'` treatment (see that file for why: some real
 * Discourses `source_reference` values are ~135 chars, which would otherwise
 * wrap to 4 lines and spill outside `SOURCE_HEAD_BOUNDING_BOX`, directly over
 * the scrolling wall).
 *
 * `SOURCE_HEAD_BOUNDING_BOX.width` (900) minus `SOURCE_HEAD_SAFE_INSET_PX`
 * (the text's own existing left padding) — i.e. exactly the content width
 * already available to the text today (before this constant existed, the
 * text's effective right boundary was already the plate's own right edge,
 * which is what made a long `source_reference` wrap onto additional lines
 * rather than run off the frame). Deliberately NOT narrower than that: this
 * constant converts an existing implicit wrap boundary into an explicit
 * single-line clip boundary, it does not shrink it — shrinking it further
 * would risk clipping the plan's own worked example
 * ("MARCUS AURELIUS · MEDITATIONS, BOOK 2", 37 chars), which today already
 * uses close to the full available width on its one line. `overflow:
 * hidden` on the clipped span guarantees no painted pixel ever reaches the
 * plate's right edge (x = 900) let alone beyond it, regardless of font
 * metrics, so there is no need for an extra manual safety margin on top.
 */
export const SOURCE_HEAD_TEXT_MAX_WIDTH_PX = SOURCE_HEAD_BOUNDING_BOX.width - SOURCE_HEAD_SAFE_INSET_PX;

/**
 * Social pilot 02a R07 (2026-08-26): vertical breathing room added to the
 * clamped span's top/bottom, alongside R04's `overflow: hidden` (see that
 * constant's own doc comment for the horizontal clamp this pairs with).
 *
 * R04's clamp fixed a real horizontal overflow (a 135-char Discourses
 * running head spilling outside the 900px plate) but `overflow: hidden`
 * clips on BOTH axes, not just the one R04 was guarding. At
 * `SOURCE_HEAD_FONT_SIZE_PX` (32px) with `lineHeight: 1`, DM Sans' line box
 * is exactly 32px tall, but the font's own ascent+descent content area is
 * ~37px — taller than the line box it's centred in. For the all-caps
 * running head (`formatRunningHead` uppercases everything) this is
 * invisible, since capital letters have no descenders. But
 * `PAYOFF_LABEL_TEXT` ("In plain English") is lowercase and has both an
 * ascender-free top and descenders (the "p" and "g"), so at `lineHeight: 1`
 * those descenders were being flat-cut by R04's clip on every render, for
 * the entire payoff phase of Wall/Question/Objection.
 *
 * 8px top and bottom (16px total) rather than switching to a taller
 * `lineHeight` value: this is a fixed, measured allowance (verified against
 * real Chromium + the real embedded DM Sans font to give the ~37px content
 * area room inside a 48px padding box, comfortably covering the ~2.5px of
 * overflow on each edge) that changes nothing about how the text itself is
 * laid out or measured — same line height, same baseline, same glyph
 * metrics — it just gives the clip box enough room not to cut into them.
 * `SOURCE_HEAD_BOUNDING_BOX.height` (120px) has ample room left over for
 * this on top of `SOURCE_HEAD_FONT_SIZE_PX`, so it cannot push the span
 * outside that box or collide with `COUNTER_BOUNDING_BOX` (see
 * `SOURCE_HEAD_TOP_PX`'s own doc comment for why those two boxes are
 * disjoint by construction).
 */
export const SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX = 8;
