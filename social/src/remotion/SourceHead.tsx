import React from 'react';
import { AbsoluteFill } from 'remotion';

import { BORDER, INK, SECONDARY, TAG_BACKGROUND, type AuthorSlug } from '../render/theme.js';
import {
	SOURCE_HEAD_BOUNDING_BOX,
	SOURCE_HEAD_FONT_SIZE_PX,
	SOURCE_HEAD_LINE_HEIGHT_RATIO,
	SOURCE_HEAD_MAX_LINES,
	SOURCE_HEAD_PAYOFF_FONT_SIZE_PX,
	SOURCE_HEAD_SAFE_INSET_PX,
	SOURCE_HEAD_TEXT_MAX_WIDTH_PX,
	SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX
} from './source-head-layout.js';

/**
 * social pilot 02a T12 — the framing layer. Running head while the wall
 * scrolls ("MARCUS AURELIUS · MEDITATIONS, BOOK 2", derived from the card,
 * never hardcoded), payoff label ("In plain English") in the exact same slot
 * once the composition reaches the still plain-English payoff. See
 * `plans/Pf39c2-social-pilot-02a.md` T11/T12.
 *
 * FRAMING TEXT under Constraint 6 (see the index plan) — the running head
 * names the book, and the payoff label ("In plain English") names the
 * transformation; neither is ever attributed to the author, and neither is
 * ever narrated (`Framing text is NEVER narrated` — the voice only ever
 * speaks the author's plain rewrite). Set apart from `Wall.tsx`'s quoted
 * content: DM Sans (`SOURCE_HEAD_FONT_STACK`), never `SERIF_STACK`;
 * `SECONDARY` ink, never `INK` and never an author `ACCENTS` colour (an
 * accent here would read as branding, not a page header — no progress bar,
 * no watermark, no logo, no URL).
 *
 * ZERO MOTION: this component takes no `frame` prop and calls no Remotion
 * timing primitive — it renders byte-identical JSX for the entire duration
 * either variant is mounted, matching the house rule ("the running head is
 * fixed and the payoff label is static — neither introduces motion").
 *
 * U03 (2026-08-27): the two variants no longer share one font size. The
 * payoff label reads at `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px); the running
 * head stays at `SOURCE_HEAD_FONT_SIZE_PX` (previously 32px, raised to 36px
 * by V05 below). See `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX`'s own doc comment
 * (`source-head-layout.ts`) for why they diverge and why 38, specifically.
 *
 * D03 (2026-08-27): before this task, this stack was a re-exported alias of
 * `Counter.tsx`'s `COUNTER_FONT_STACK` (the read-through counter, deleted
 * along with the read-through it labeled — see D02/D03). This module is now
 * the one place the DM Sans stack literal lives for the whole `remotion/`
 * workspace.
 *
 * Pf39c2-social-pilot-02a V05 (2026-08-27): direct phone-review feedback —
 * "The box overlay for the wall format is still not visually distinct
 * enough from the background... also the font size... should be increased
 * and it should wrap onto two lines if necessary, currently it truncates."
 * Three changes, all below: the plate's fill (`TAG_BACKGROUND`, U01) now
 * also gets a full hairline `border` (all four sides, not just U01's
 * `borderBottom`) plus an INSET `boxShadow`; the running head's own font
 * size rises to 36px (`SOURCE_HEAD_FONT_SIZE_PX`); and the single-line
 * `whiteSpace: nowrap` + ellipsis clamp is replaced with a genuine 2-line
 * wrap (`WebkitLineClamp`, `SOURCE_HEAD_MAX_LINES`), ellipsising only past
 * the second line. See the plate `<div>` and text `<span>` below for why
 * each specific value was chosen, and `SOURCE_HEAD_BOUNDING_BOX`'s own doc
 * comment (`source-head-layout.ts`) for the box-height change this required.
 */

/**
 * DM Sans — the UI face per `docs/BRANDING.md` — never `Wall.tsx`'s
 * `SERIF_STACK`: this is chrome (a running head / payoff label), not
 * display type.
 */
export const SOURCE_HEAD_FONT_STACK = "'DM Sans Variable', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

/**
 * Pf39c2-social-pilot-02a V05 (2026-08-27): converts a `theme.ts` hex token
 * into an `rgba(...)` string at a given alpha — used below to derive the
 * plate's shadow colour FROM `INK` rather than hand-writing a second hex
 * literal. `docs/BRANDING.md`/this workspace's own colour-token discipline
 * (see this file's doc comment: "never an author `ACCENTS` colour... a
 * shadow should be a low-alpha neutral, not a new palette entry") is
 * satisfied by deriving from an existing token, not by picking a fresh hex
 * value that would need its own justification and could drift from `INK` if
 * either were ever tuned independently. `INK` (not `SECONDARY` or `BORDER`)
 * because a shadow reads as depth/weight, which wants the palette's darkest,
 * most neutral tone — the same ink used for the wall's own quoted text —
 * not the already-faint `SECONDARY`/`BORDER` tones this component's TEXT and
 * hairline already use (stacking a low-alpha shadow on top of an
 * already-low-contrast tone would wash out to nearly nothing).
 */
function hexToRgba(hex: string, alpha: number): string {
	const value = hex.replace('#', '');
	const r = parseInt(value.slice(0, 2), 16);
	const g = parseInt(value.slice(2, 4), 16);
	const b = parseInt(value.slice(4, 6), 16);
	return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Pf39c2-social-pilot-02a V05 (2026-08-27): the plate's shadow colour —
 * `INK` (see `hexToRgba`'s own doc comment for why that token) at a LOW
 * alpha (0.35), applied only as an INSET `boxShadow` (see the plate `<div>`
 * below), never a `color` — this never touches rendered TEXT, so it does not
 * contradict this file's "`SECONDARY` ink, never `INK`" rule for the running
 * head/payoff text itself (`renderableSource` guards in
 * `__tests__/source-head.test.ts` check for `color: ink`, a text-colour
 * usage, not this shadow usage).
 */
export const SOURCE_HEAD_SHADOW_COLOR = hexToRgba(INK, 0.35);

/**
 * The payoff variant's fixed text — always exactly this, in every render,
 * for every card. A hardcoded constant, never composed from card data: it
 * names the PRODUCT's transformation ("this is the plain rewrite"), not
 * anything about the author or the passage, so it must never vary with
 * either.
 */
export const PAYOFF_LABEL_TEXT = 'In plain English';

/**
 * The subset of a real `content/output/<book>/<chapter>.json` card's own
 * fields the running head is derived from — see any card in that directory
 * for the real shape (`author_slug`, `source_reference`, e.g.
 * `"Meditations, Book 7, Section 1"`). `formatRunningHead` below consumes
 * exactly these two fields and nothing else; it never receives or needs the
 * card's `plain_english`/`original_excerpt`.
 */
export interface RunningHeadCardMetadata {
	author_slug: AuthorSlug;
	/** Verbatim card field — never reformatted upstream before reaching this component. */
	source_reference: string;
}

/**
 * Which of the framing layer's two states a given `SourceHead` render is —
 * `running-head` while the wall scrolls (derived FROM the card, e.g.
 * `"MARCUS AURELIUS · MEDITATIONS, BOOK 2"`), `payoff` once the composition
 * reaches the still plain-English payoff (always `PAYOFF_LABEL_TEXT`,
 * `"In plain English"`). Both variants render in the exact same on-screen
 * position — same slot, different text — which is the whole visual grammar:
 * book page -> not a book page.
 */
export type SourceHeadVariant = { kind: 'running-head'; card: RunningHeadCardMetadata } | { kind: 'payoff' };

export interface SourceHeadProps {
	variant: SourceHeadVariant;
}

/**
 * Derives the running head from real card metadata — never hardcoded, never
 * attributed to the author (it names the book, not "Marcus Aurelius wrote").
 * `author_slug` (e.g. `"marcus-aurelius"`) becomes `"MARCUS AURELIUS"`
 * (hyphens to spaces, uppercased); `source_reference` (e.g. `"Meditations,
 * Book 2, Section 1"`) drops its trailing `", Section N"` clause, since the
 * section number is too fine-grained for a running head (a book page header
 * names the book/chapter, not the paragraph) — leaving `"MEDITATIONS, BOOK
 * 2"`. The two halves join with " · ", matching the plan's own worked
 * example verbatim: `"MARCUS AURELIUS · MEDITATIONS, BOOK 2"`.
 */
export function formatRunningHead(card: RunningHeadCardMetadata): string {
	const authorName = card.author_slug.split('-').join(' ').toUpperCase();
	const bookReference = card.source_reference.replace(/,\s*Section\s+\d+\s*$/i, '').toUpperCase();
	return `${authorName} · ${bookReference}`;
}

/**
 * The framing layer's fixed-position, zero-motion overlay — same slot for
 * both variants (`SOURCE_HEAD_BOUNDING_BOX`), so the visual grammar is one
 * continuous element that simply changes text: book page -> not a book page.
 * Rendered as a sibling `AbsoluteFill`, never a child of either payload
 * layout, so it structurally cannot reflow anything else on screen.
 */
export function SourceHead({ variant }: SourceHeadProps): React.ReactElement {
	const text = variant.kind === 'running-head' ? formatRunningHead(variant.card) : PAYOFF_LABEL_TEXT;
	// social pilot 02a U03 (2026-08-27): the payoff label reads at
	// `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px), the running head stays at
	// `SOURCE_HEAD_FONT_SIZE_PX` (V05: raised from 32px to 36px) — see that
	// constant's own doc comment for why the two variants deliberately
	// diverge despite sharing one slot.
	const fontSize = variant.kind === 'payoff' ? SOURCE_HEAD_PAYOFF_FONT_SIZE_PX : SOURCE_HEAD_FONT_SIZE_PX;

	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			{/*
			 * A solid backing PLATE spanning the entire, generous
			 * `SOURCE_HEAD_BOUNDING_BOX` — not a transparent overlay sized to
			 * the text. The running head sits directly on top of the Wall's own
			 * actively SCROLLING text (the only moving content in the whole
			 * channel), so every pixel inside this box must be deterministic
			 * (the same fill colour every frame) rather than letting the
			 * archaic text behind show through at the box's margins — a
			 * masthead band, not a floating label. `pixel-proof.ts`'s tests
			 * crop exactly this box, so it must be fully opaque and fully fill
			 * it, not just the text's own tighter bounds.
			 *
			 * social pilot 02a U01 (2026-08-27): filled with `TAG_BACKGROUND`
			 * (`#F0EDE8`), not `PAPER` (`#FAF7F2`) — phone-review feedback was
			 * that an identical-to-the-page plate reads as text floating on the
			 * same surface as the passage below rather than as a distinct
			 * overlay. `TAG_BACKGROUND`/`BORDER` are the exact two
			 * `docs/BRANDING.md` tokens defined for this "subtle background +
			 * hairline divider" role — never an `ACCENTS` colour, which would
			 * read as branding rather than a page header (same rationale this
			 * file's own doc comment already gives for `SECONDARY` over `INK`).
			 * Both variants share this one `<div>`, so the treatment cannot
			 * diverge between the running head and the payoff label even by
			 * accident.
			 *
			 * Pf39c2-social-pilot-02a V05 (2026-08-27): U01's plate (tint + a
			 * single `borderBottom`) was direct phone-review feedback that still
			 * wasn't enough — "still not visually distinct enough from the
			 * background, maybe a subtle outline or a drop shadow would fix
			 * this." Two additions, both still one static style object (zero
			 * motion, unchanged every frame):
			 *
			 *   1. `border` (all four sides, in `BORDER`) replaces U01's
			 *      `borderBottom` — a full hairline outline reads as a distinct
			 *      rectangle laid over the page at every edge, not just a
			 *      divider along the bottom.
			 *   2. An INSET `boxShadow` (`SOURCE_HEAD_SHADOW_COLOR`, `INK` at
			 *      0.35 alpha) — deliberately `inset`, NOT a normal outward drop
			 *      shadow, and this is a hard constraint, not a style preference:
			 *      `pixel-proof.ts`'s tests crop EXACTLY `SOURCE_HEAD_BOUNDING_BOX`
			 *      and assert every pixel INSIDE it is byte-identical across
			 *      frames/renders, while the Wall's own scrolling text runs
			 *      immediately OUTSIDE that same box. A normal outward shadow
			 *      paints translucent pixels BEYOND the box's own edges — exactly
			 *      the pixels the scrolling wall occupies — which would make
			 *      those pixels blend with whatever archaic text happens to be
			 *      scrolling past at that instant, breaking the "every pixel
			 *      outside the box is unaffected by this overlay's presence"
			 *      no-reflow proof (`assertIdenticalOutsideBoxes`) the first time
			 *      two renders sampled a different scroll offset. `inset` confines
			 *      every shadow pixel to the INSIDE of the plate's own already-
			 *      opaque `backgroundColor`, so the composited result stays fully
			 *      opaque and identical every frame — depth without sacrificing
			 *      determinism. Visually verified (a static HTML mockup at this
			 *      composition's real scale, real tokens, a real two-line wrapped
			 *      Discourses head over sample archaic text) that an inset shadow
			 *      hugging the plate's inside-bottom edge, combined with the full
			 *      hairline border, reads as a raised masthead band distinct from
			 *      the page — not merely a flat tinted rectangle. `0 -6px 10px
			 *      -8px`: a small downward offset and blur so the visible band
			 *      sits right at the plate's own inside-bottom edge (bordering
			 *      the scrolling wall — the one edge where "is this laid over the
			 *      page" matters most), not smeared uniformly across the plate.
			 */}
			<div
				style={{
					position: 'absolute',
					top: SOURCE_HEAD_BOUNDING_BOX.top,
					left: SOURCE_HEAD_BOUNDING_BOX.left,
					width: SOURCE_HEAD_BOUNDING_BOX.width,
					height: SOURCE_HEAD_BOUNDING_BOX.height,
					backgroundColor: TAG_BACKGROUND,
					border: `1px solid ${BORDER}`,
					boxShadow: `inset 0 -6px 10px -8px ${SOURCE_HEAD_SHADOW_COLOR}`,
					boxSizing: 'border-box',
					display: 'flex',
					alignItems: 'center'
				}}
			>
				{/*
				 * Social pilot 02a R04 (2026-08-26): `overflow: hidden` +
				 * `maxWidth: SOURCE_HEAD_TEXT_MAX_WIDTH_PX` originally paired with a
				 * single-line `whiteSpace: 'nowrap'` + `textOverflow: 'ellipsis'`
				 * clamp — `formatRunningHead` can return up to ~135 chars for a real
				 * Discourses card (Epictetus's chapter titles are full descriptive
				 * clauses, not numbers), which at this font size would otherwise wrap
				 * to 3-4 lines and spill outside `SOURCE_HEAD_BOUNDING_BOX`'s then-
				 * fixed 120px plate, directly over the scrolling wall. `minWidth: 0`
				 * overrides the flex item's default `min-width: auto`, which would
				 * otherwise let the span grow past its `maxWidth` and defeat the
				 * clamp — a well-known flexbox-plus-ellipsis gotcha, not a redundant
				 * style.
				 *
				 * Pf39c2-social-pilot-02a V05 (2026-08-27): direct phone-review
				 * feedback — "it should wrap onto two lines if necessary, currently
				 * it truncates" — replaces R04's SINGLE-LINE clamp with a genuine
				 * 2-line wrap: `whiteSpace: 'nowrap'` is gone (text wraps normally,
				 * within `maxWidth`, same as before); `display: '-webkit-box'` +
				 * `WebkitBoxOrient: 'vertical'` + `WebkitLineClamp:
				 * SOURCE_HEAD_MAX_LINES` (2) is the standard "line clamp" idiom —
				 * Chromium (which Remotion renders through) wraps the text as far as
				 * it naturally needs, up to 2 lines, and only ellipsises past that
				 * point, rather than R04's single-line clamp ellipsising after only a
				 * few dozen characters. `overflow: hidden` still guarantees no
				 * painted pixel escapes `maxWidth` horizontally or the box vertically,
				 * regardless of font metrics — unchanged from R04, just now clipping
				 * after 2 lines instead of after 1.
				 *
				 * Truncating with an ellipsis, rather than silently dropping the
				 * tail, keeps the text FACTUALLY TRUE per Constraint 6: a visible "…"
				 * signals "there is more, this is not the whole title" rather than
				 * presenting a shortened phrase as complete. And because
				 * `formatRunningHead` always puts the author name and book title
				 * FIRST and any long descriptive chapter clause LAST (see that
				 * function's own doc comment), an ellipsis on the whole (now
				 * two-line) block naturally cuts the least important part (the tail
				 * of the chapter clause) while always preserving the most important
				 * part (author, then book) — exactly the priority order this
				 * component's task called for, with no special-casing needed. For
				 * the plan's own worked example ("MARCUS AURELIUS · MEDITATIONS,
				 * BOOK 2", 37 chars) this still renders on one line, unaffected by
				 * this change — see `SOURCE_HEAD_TEXT_MAX_WIDTH_PX`'s own doc comment.
				 *
				 * R07 (2026-08-26): `paddingTop`/`paddingBottom:
				 * SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` guard the OTHER axis
				 * `overflow: hidden` clips — the OUTER top/bottom edge of the
				 * (possibly two-line) block, not the seam between lines (which
				 * `SOURCE_HEAD_LINE_HEIGHT_RATIO` governs). At `lineHeight: 1`, DM
				 * Sans' line box is exactly `fontSize` tall, but the font's own
				 * content area (ascent+descent) runs taller than that, so without
				 * this padding the clip flat-cuts descenders — invisible on the
				 * all-caps running head (no descenders in capitals) but cutting the
				 * "p" and "g" off `PAYOFF_LABEL_TEXT` ("In plain English") on every
				 * payoff-phase frame. See `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`'s
				 * own doc comment for why 8/8, and for the V05 re-measurement at the
				 * new two-line/`SOURCE_HEAD_LINE_HEIGHT_RATIO` shape.
				 *
				 * U03 (2026-08-27): `fontSize` is variant-dependent — the payoff
				 * label reads at `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px), the
				 * running head at `SOURCE_HEAD_FONT_SIZE_PX` (V05: raised to 36px).
				 * The shared 8px padding clears both sizes' descenders/outer edges —
				 * see each constant's own doc comment for the numbers.
				 */}
				<span
					style={{
						display: '-webkit-box',
						WebkitBoxOrient: 'vertical',
						WebkitLineClamp: SOURCE_HEAD_MAX_LINES,
						minWidth: 0,
						maxWidth: SOURCE_HEAD_TEXT_MAX_WIDTH_PX,
						overflow: 'hidden',
						textOverflow: 'ellipsis',
						paddingLeft: SOURCE_HEAD_SAFE_INSET_PX,
						paddingTop: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX,
						paddingBottom: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX,
						fontFamily: SOURCE_HEAD_FONT_STACK,
						fontWeight: 500,
						fontSize,
						lineHeight: SOURCE_HEAD_LINE_HEIGHT_RATIO,
						letterSpacing: '0.02em',
						color: SECONDARY,
						margin: 0
					}}
				>
					{text}
				</span>
			</div>
		</AbsoluteFill>
	);
}
