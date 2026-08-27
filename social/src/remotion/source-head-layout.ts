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
 *
 * Pf39c2-social-pilot-02a V08 (2026-08-27): `SOURCE_HEAD_BOUNDING_BOX.width`
 * used to be 900 on the 1080px frame (`FRAME_WIDTH`, imported below from
 * `wall-timing.ts`), leaving a bare 180px strip down the frame's right edge
 * at the plate's own vertical band. The plate's fill is the only thing that
 * makes this band deterministic across frames (see that box's own doc
 * comment) — the strip outside it was just frame, so the wall's own
 * actively scrolling text showed through there, stranding orphaned
 * fragments beside the plate rather than under it. Widened to full
 * `FRAME_WIDTH` so the plate is a true edge-to-edge masthead band with no
 * gap for anything to show through. See `SOURCE_HEAD_BOUNDING_BOX`'s own
 * doc comment for the full change, and `SOURCE_HEAD_TEXT_MAX_WIDTH_PX`'s for
 * why the TEXT's own clamp deliberately did NOT grow to match.
 */

import { FRAME_WIDTH } from './wall-timing.js';

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
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): raised from 32px to 36px —
 * direct phone-review feedback ("the font size of the element should be
 * increased"). 36, not the top of the 34-36px plausible window this task
 * was scoped to: it must stay clearly SMALLER than
 * `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px, U03's polarity fix — chrome
 * reads smaller than the transformation it announces), so 36 is the largest
 * value that keeps a real 2px gap to the payoff size rather than closing in
 * on it. Measured (not assumed) against the real embedded DM Sans, real
 * Chromium: at 36px a real corpus running head still fits the horizontal
 * budget on one line when short (`"MARCUS AURELIUS · MEDITATIONS, BOOK 2"`
 * measures ~812px of the 836px `SOURCE_HEAD_TEXT_MAX_WIDTH_PX` budget,
 * padding included) and wraps cleanly to two lines, ellipsised only past the
 * second, when long (Discourses' 135-char chapter titles — see
 * `SOURCE_HEAD_MAX_LINES`).
 */
export const SOURCE_HEAD_FONT_SIZE_PX = 36;

/**
 * Pf39c2-social-pilot-02a V05 (2026-08-27): the running head / payoff span's
 * `lineHeight`, as a ratio — replaces the flat `lineHeight: 1` R04/R07 used
 * when the running head was clamped to a single line. `lineHeight: 1` packed
 * DM Sans' own line box to exactly `fontSize`, which R07 found runs shorter
 * than the font's real ascent+descent content area (hence that task's
 * vertical padding fix). Now that the running head can wrap to TWO lines
 * (`SOURCE_HEAD_MAX_LINES`), a flat `1` would stack those two lines edge to
 * edge with zero breathing room between them — legible but visually cramped
 * for a two-line running head, and the wrapped block would additionally sit
 * right at the same tight vertical budget R07 had to pad around, twice over.
 * 1.15 was chosen and then measured (not assumed): with a real, naturally
 * two-line-wrapping corpus string ("EPICTETUS · DISCOURSES, THAT WHEN WE
 * CANNOT FULFIL THAT WHICH THE") at `SOURCE_HEAD_FONT_SIZE_PX` (36px), a
 * zero-padding probe's `scrollHeight` (85px) exceeds its `clientHeight`
 * (83px) — the same outer-edge ascent/descent clip R07 diagnosed, now
 * generalized from "one line's descenders" to "the wrapped block's own top
 * and bottom edge" — and `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` (8px,
 * unchanged) still clears it at this ratio (`scrollHeight` 99px ===
 * `clientHeight` 99px, no clip). See that constant's own doc comment for the
 * full witness/fix pair, mirrored in `__tests__/source-head.test.ts`.
 */
export const SOURCE_HEAD_LINE_HEIGHT_RATIO = 1.15;

/**
 * Pf39c2-social-pilot-02a V05 (2026-08-27): the running head / payoff span's
 * `WebkitLineClamp` value — the running head may wrap onto at most this many
 * lines before the browser's own line-clamp ellipsises the remainder, per
 * direct phone-review feedback ("it should wrap onto two lines if necessary,
 * currently it truncates"). Replaces R04's single-line `whiteSpace: nowrap` +
 * `textOverflow: ellipsis` clamp, which correctly guarded the plate from
 * overflow but did so by truncating Epictetus's ~135-char Discourses chapter
 * titles after only a few dozen characters — most of the title (everything
 * past the book name) was silently dropped even though a second line of
 * ROOM existed in the (now-grown) plate. 2, not more: the plate's own height
 * (`SOURCE_HEAD_BOUNDING_BOX`) is sized for exactly two lines' worth of
 * content at `SOURCE_HEAD_FONT_SIZE_PX`/`SOURCE_HEAD_LINE_HEIGHT_RATIO` plus
 * `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` — a third line would either force
 * the plate to grow again (crowding the frame further) or get clipped by the
 * box's own fixed height, which is exactly the failure mode this task fixes,
 * just moved from line 1 to line 3. The payoff label
 * (`PAYOFF_LABEL_TEXT`, 16 chars) never reaches this limit — it measures
 * ~340px wide at `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` against an 836px budget,
 * comfortably inside one line — so sharing this same clamp value across both
 * variants (one style object, per this file's own "cannot diverge even by
 * accident" invariant) never visibly affects the payoff variant.
 */
export const SOURCE_HEAD_MAX_LINES = 2;

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
 * measured `scrollHeight === clientHeight` (54px === 54px, at `lineHeight:
 * 1`) with the real embedded DM Sans font, the same real-Chromium technique
 * `__tests__/source-head.test.ts` already uses for the 32px case. (The
 * minimum padding that clears the clip at 38px measures at 6px, so 8px keeps
 * the same margin of safety the 32px case has, not a coincidence — both
 * font sizes happen to need less than 8px of clearance.) The label content
 * box (38 + 2*8 = 54px) also stays comfortably inside `SOURCE_HEAD_BOUNDING_BOX`'s
 * fixed 120px plate height, so neither this box nor its position needs to
 * change.
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): re-verified again after this task
 * raised the shared span's `lineHeight` from `1` to
 * `SOURCE_HEAD_LINE_HEIGHT_RATIO` (1.15, for the running head's two-line
 * wrap — see that constant's own doc comment) and grew
 * `SOURCE_HEAD_BOUNDING_BOX`'s height (120px -> 180px). A taller line height
 * only gives the payoff span MORE room, not less, so this was expected to
 * still clear, and measurement confirms it: `scrollHeight === clientHeight`
 * (60px === 60px) at `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px),
 * `SOURCE_HEAD_LINE_HEIGHT_RATIO` (1.15) and
 * `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` (8px). 60px is still comfortably
 * inside the grown 180px plate.
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
 * otherwise byte-identical no-reflow comparison. `left: 0` and `width:
 * FRAME_WIDTH` (V08, below) so even the longest real running head (an
 * author's full display name plus a book title and chapter reference, e.g.
 * "MARCUS AURELIUS · MEDITATIONS, BOOK 12") sits comfortably inside it at
 * `SOURCE_HEAD_FONT_SIZE_PX`. `top` is `SOURCE_HEAD_TOP_PX` — see that
 * constant's own doc comment for this task's geometry change.
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): `height` grown from 120px to
 * 180px — the running head can now wrap to `SOURCE_HEAD_MAX_LINES` (2) lines
 * at the new, larger `SOURCE_HEAD_FONT_SIZE_PX` (36px), which no longer fits
 * the old single-line-sized plate. Measured, not guessed: two lines at 36px
 * / `SOURCE_HEAD_LINE_HEIGHT_RATIO` (1.15) plus
 * `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` (8px top and bottom) is a 99px
 * content box (`2 * 36 * 1.15 + 2 * 8 = 98.8`, confirmed against the real
 * embedded DM Sans font — see `SOURCE_HEAD_LINE_HEIGHT_RATIO`'s own doc
 * comment for the exact measured figure, 99px). 180px keeps this task's
 * plate as generous, proportionally, as the original: the old 120px plate
 * held 48px of single-line content (32px font + 2*8px padding), a ~36px
 * margin on each side once centred by the plate's `alignItems: 'center'`;
 * 180px holds the new 99px two-line content with a ~40.5px margin on each
 * side — the same "comfortably inside, not tight" allowance, not shrunk to
 * fit. This also stays nowhere near colliding with the payoff SENTENCE
 * (phases 2/3's `PayoffLine`, T10's 81-88px display type): that text is
 * vertically CENTRED in the full 1920px frame within its own
 * `PAYOFF_BOX_HEIGHT` (800px) budget, i.e. it never renders above
 * `(1920 - 800) / 2 = 560px` from the top — this box's bottom edge, even at
 * 180px tall starting at `SOURCE_HEAD_TOP_PX` (64px), ends at 244px, leaving
 * a wide, unaffected gap.
 *
 * Pf39c2-social-pilot-02a V08 (2026-08-27): `width` widened from 900 to
 * `FRAME_WIDTH` (1080) — a real render (`wall-2026-09-03`) showed the
 * scrolling wall's archaic text bleeding through the 180px strip this box
 * used to leave bare down the frame's right edge, at the plate's own
 * vertical band ("e", "are" and other orphaned fragments stranded beside
 * the plate rather than under it). The plate's fill/border/shadow are the
 * only things that make this vertical band deterministic frame-to-frame
 * (see the `<div>` in `SourceHead.tsx`) — anything outside the box is bare
 * frame, and the wall renders directly beneath everything in this
 * composition (see `index.ts`'s layer order), so a box narrower than the
 * frame always left a gap for the wall to show through. Widening `left: 0,
 * width: FRAME_WIDTH` closes that gap completely; there is no longer any
 * "outside the box, inside the frame" pixel left at this vertical band for
 * anything else to occupy. This is a FILL change only — the running
 * head/payoff TEXT itself does not move or grow: `SOURCE_HEAD_SAFE_INSET_PX`
 * (the text's left inset) is unchanged, and `SOURCE_HEAD_TEXT_MAX_WIDTH_PX`
 * (the text's own clamp) is deliberately no longer derived from this box's
 * width — see that constant's own doc comment for why it stays fixed at its
 * previous absolute value rather than growing to ~1044px alongside the box.
 */
export const SOURCE_HEAD_BOUNDING_BOX: SourceHeadBoundingBox = {
	top: SOURCE_HEAD_TOP_PX,
	left: 0,
	width: FRAME_WIDTH,
	height: 180
};

/**
 * Social pilot 02a R04 (2026-08-26): the maximum on-screen width the running
 * head / payoff label's text may occupy per line, in frame px.
 *
 * `SOURCE_HEAD_BOUNDING_BOX.width` (900) minus `SOURCE_HEAD_SAFE_INSET_PX`
 * (the text's own existing left padding) — i.e. exactly the content width
 * already available to the text today (before this constant existed, the
 * text's effective right boundary was already the plate's own right edge,
 * which is what made a long `source_reference` wrap onto additional lines
 * rather than run off the frame). Deliberately NOT narrower than that: this
 * constant converts an existing implicit wrap boundary into an explicit
 * clip boundary, it does not shrink it — shrinking it further would risk
 * clipping the plan's own worked example ("MARCUS AURELIUS · MEDITATIONS,
 * BOOK 2", 37 chars), which today already uses close to the full available
 * width on its one line.
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): originally paired with R04's
 * single-line `whiteSpace: nowrap` + `textOverflow: 'ellipsis'` clamp — a
 * 135-char Discourses `source_reference` would otherwise wrap to 3-4 lines
 * and spill outside `SOURCE_HEAD_BOUNDING_BOX`. That single-line clamp is
 * gone (`SourceHead.tsx` now wraps up to `SOURCE_HEAD_MAX_LINES`, 2, via
 * `WebkitLineClamp`, per direct phone-review feedback that truncation lost
 * too much of the title) but this constant's role is unchanged: it is still
 * the per-line width `overflow: hidden` (now paired with `display:
 * '-webkit-box'`) never lets any painted pixel exceed, regardless of how
 * many lines wrap beneath it — a browser wrapping text with `max-width` set
 * cannot itself render a line wider than that budget, so this bound holds by
 * construction on every line, not just the first.
 *
 * Pf39c2-social-pilot-02a V08 (2026-08-27): this constant STOPS being derived
 * from `SOURCE_HEAD_BOUNDING_BOX.width` here, and is instead the literal
 * value that derivation produced before this task (900 - 64 = 836), typed
 * out directly. V08 widened `SOURCE_HEAD_BOUNDING_BOX.width` to `FRAME_WIDTH`
 * (1080, up from 900) so the plate's FILL spans the whole frame and no bare
 * strip is left for the scrolling wall to show through — but that's a
 * background-fill change, not licence to also widen the TEXT. Leaving this
 * constant derived from the box would have silently jumped it to `1080 - 64
 * = 1016`, undoing V05's whole point: the running head was deliberately
 * capped to wrap onto a second line rather than run wide on one, and R04's
 * own worked example ("MARCUS AURELIUS · MEDITATIONS, BOOK 2") was measured
 * against this exact 836px budget (see this constant's own R04 comment
 * above). A wider clamp lets more real corpus heads that used to wrap to two
 * lines fit back onto one, which is the same regression V05 fixed, just
 * reached from the opposite direction (widening the box instead of shrinking
 * the font). Kept at 836 — the plate is wider, the type is not.
 */
export const SOURCE_HEAD_TEXT_MAX_WIDTH_PX = 836;

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
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): re-derived once more, not
 * assumed, now that the running head wraps to `SOURCE_HEAD_MAX_LINES` (2)
 * lines at `SOURCE_HEAD_LINE_HEIGHT_RATIO` (1.15) instead of a single line at
 * `lineHeight: 1`. The clip this padding guards against is the OUTER edge of
 * the (now taller) clamped box — the top of the first line and the bottom of
 * the last — not the seam between lines, which the `lineHeight` ratio itself
 * governs. Witnessed with a real, naturally two-line-wrapping corpus string
 * ("EPICTETUS · DISCOURSES, THAT WHEN WE CANNOT FULFIL THAT WHICH THE") at
 * `SOURCE_HEAD_FONT_SIZE_PX` (36px): with zero padding, `scrollHeight` (85px)
 * exceeds `clientHeight` (83px) — the same outer-edge clip R07 found for one
 * line, reproduced for two — and with this constant's 8px, `scrollHeight`
 * (99px) no longer exceeds `clientHeight` (99px). 8px was not raised even
 * though the box grew, because the clip is still only ever at the two OUTER
 * edges regardless of line count: the unpadded clip measures only ~1px per
 * edge at `SOURCE_HEAD_LINE_HEIGHT_RATIO` (1.15, total 2px) — smaller than
 * R07's original single-line clip at `lineHeight: 1` (~2.5px per edge, total
 * 5px) — so 8px clears with MORE spare margin at this ratio than it did
 * before, not less. See `SOURCE_HEAD_LINE_HEIGHT_RATIO`'s own doc comment
 * for the same numbers, and
 * `__tests__/source-head.test.ts` for the witness/fix pair this reproduces.
 */
export const SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX = 8;
