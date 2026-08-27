/**
 * Pure geometry for the framing layer's running head / payoff label — see
 * `SourceHead.tsx`. Kept separate from the component, same pattern as
 * `wall-timing.ts` vs `Wall.tsx`: the numbers are testable without
 * rendering a frame, and `SourceHead.tsx` renders exactly what this module
 * resolves, never a recomputed value of its own.
 *
 * social pilot 02a T11 (2026-08-26): written ahead of T12's real component —
 * see that file's own doc comment for why these are real, final numbers
 * rather than placeholders (same "correct value, simply not yet wired into
 * on-screen behaviour" pattern T07 used for `wall-timing.ts`'s
 * `WALL_FONT_SIZE`).
 *
 * Pf39c2-social-pilot-02a D03 (2026-08-27): this module used to derive its
 * top-left placement from the read-through counter's own bounding box
 * (`counter-layout.ts`'s `COUNTER_BOUNDING_BOX`/`COUNTER_SAFE_INSET_PX`),
 * stacking the running head/payoff plate directly BELOW the counter so the
 * two never collided. D02 deleted the read-through (the counter's only
 * supplier — `RenderPlan.counter` is hardcoded `null` now); D03 deletes the
 * counter machinery itself (`Counter.tsx`, `counter-layout.ts`). With
 * nothing left to stack below, this module now defines its own top-left
 * anchor directly, rather than deriving one from a module that no longer
 * exists.
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
 * D03 (2026-08-27): this reasoning used to live on `counter-layout.ts`'s
 * `COUNTER_SAFE_INSET_PX`, the read-through counter's own inset — carried
 * across here verbatim now that the counter (and that module) are gone, so
 * this module is the one place the "why top-left" justification survives.
 * 64px is unchanged from that constant's own value: the running head has
 * always used this same inset (`SOURCE_HEAD_SAFE_INSET_PX` was previously
 * an alias of `COUNTER_SAFE_INSET_PX`; it is now its own constant with the
 * same number, not a derived one).
 */
export const SOURCE_HEAD_SAFE_INSET_PX = 64;

/**
 * The running head/payoff plate's own top edge, in frame px.
 *
 * D03 (2026-08-27): before this task, the plate stacked directly BELOW the
 * read-through counter's bounding box (`SOURCE_HEAD_TOP_PX =
 * COUNTER_BOUNDING_BOX.top + COUNTER_BOUNDING_BOX.height +
 * SOURCE_HEAD_GAP_BELOW_COUNTER_PX`), landing at 64 + 160 + 40 = 264px —
 * pushed well down the frame to clear a counter that, since D02 deleted the
 * read-through, never actually rendered there any more (`RenderPlan.counter`
 * has been hardcoded `null` since D02; D03 deletes the counter component
 * itself). That derivation is gone along with the counter it was staying
 * clear of.
 *
 * The plate now anchors directly in the SAFE-AREA CORNER on its own terms:
 * `SOURCE_HEAD_SAFE_INSET_PX` from the top, the same inset already used from
 * the left — an ordinary top-left masthead position, not a value borrowed
 * from (or offset against) any other overlay's geometry, because there is no
 * other overlay left in this corner to stay clear of.
 */
export const SOURCE_HEAD_TOP_PX = SOURCE_HEAD_SAFE_INSET_PX;

/**
 * Deliberately small — framing text, not display type, per Constraint 6.
 * Well under any size this workspace treats as "display" text.
 */
export const SOURCE_HEAD_FONT_SIZE_PX = 32;

/**
 * Social pilot 02a U03 (2026-08-27): the PAYOFF LABEL's own font size —
 * deliberately DIFFERENT from `SOURCE_HEAD_FONT_SIZE_PX`, even though both
 * render through the exact same slot/plate/span in `SourceHead.tsx`. Before
 * this task the two variants shared one size (32px); user feedback asked
 * whether "In plain English" specifically should read larger, and 38px is
 * the answer, scoped to that variant only:
 *
 * - The payoff label sits ALONE on a quiet, motionless frame with one large
 *   payoff sentence (T10's whole point is that the payoff sentence is the
 *   largest thing on screen, 81-88px) — at 32px "In plain English" read as
 *   incidental, an afterthought rather than the product's own name for what
 *   the viewer is looking at.
 * - The running head does NOT get the same increase and stays at
 *   `SOURCE_HEAD_FONT_SIZE_PX` (32px): it sits over a dense, actively
 *   scrolling wall of archaic text and carries far more characters (author
 *   name plus book/chapter reference, up to 135 real chars per R04) — making
 *   it bigger would crowd an already-busy frame and worsen the exact overflow
 *   risk R04's clamp exists to guard against, for no benefit (there is no
 *   payoff sentence competing for attention on that frame).
 * - 38px, not larger: it stays clearly SUBORDINATE to the payoff sentence's
 *   81-88px (T10's invariant — the payoff must remain the largest thing on
 *   screen). The user's own brief was explicit that past ~40px the label
 *   starts competing with the sentence rather than merely gaining presence.
 *
 * Re-verified at this size (not assumed): R04's horizontal clamp
 * (`SOURCE_HEAD_TEXT_MAX_WIDTH_PX`) still holds with enormous margin —
 * `PAYOFF_LABEL_TEXT` ("In plain English") measures ~274px wide at 38px,
 * against an 836px budget — and R07's vertical padding
 * (`SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`, still 8px, unchanged and NOT
 * grown for this variant) still clears the payoff text's descenders at 38px:
 * measured `scrollHeight === clientHeight` (54px === 54px) with the real
 * embedded DM Sans font, the same real-Chromium technique
 * `__tests__/source-head.test.ts` already uses for the 32px case. (The
 * minimum padding that clears the clip at 38px measures at 6px, so 8px keeps
 * the same margin of safety the 32px case has, not a coincidence — both
 * font sizes happen to need less than 8px of clearance.) The label content
 * box (38 + 2*8 = 54px) also stays comfortably inside `SOURCE_HEAD_BOUNDING_BOX`'s
 * fixed 120px plate height, so neither this box nor its position needs to
 * change.
 */
export const SOURCE_HEAD_PAYOFF_FONT_SIZE_PX = 38;

export interface SourceHeadBoundingBox {
	top: number;
	left: number;
	width: number;
	height: number;
}

/**
 * A generous bounding box the running head/payoff label's rendered text can
 * never exceed — used by `__tests__/source-head.test.ts` (and the pixel-proof
 * helpers it uses, `./pixel-proof.ts`) to crop this region out of an
 * otherwise byte-identical no-reflow comparison. `left: 0` and a wide
 * `width` (900px) so even the longest real running head (an author's full
 * display name plus a book title and chapter reference, e.g. "MARCUS
 * AURELIUS · MEDITATIONS, BOOK 12") sits comfortably inside it at
 * `SOURCE_HEAD_FONT_SIZE_PX`. `top` is `SOURCE_HEAD_TOP_PX` — see that
 * constant's own doc comment for this task's geometry change.
 */
export const SOURCE_HEAD_BOUNDING_BOX: SourceHeadBoundingBox = {
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
 * outside that box.
 *
 * Social pilot 02a U03 (2026-08-27): this padding is SHARED across both
 * variants' spans and was NOT grown when the payoff label moved to its own,
 * larger `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px, up from the 32px it used
 * to share with the running head) — re-measured at 38px rather than assumed,
 * since a larger font makes the content-area math above font-size-dependent.
 * The minimum padding that clears the payoff text's descenders at 38px
 * measures 6px; 8px still clears with margin, same as it did at 32px, so no
 * change was needed here. See `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX`'s own doc
 * comment for the full re-verification (horizontal clamp included).
 */
export const SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX = 8;
