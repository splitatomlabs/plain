import React from 'react';
import { AbsoluteFill } from 'remotion';

import { BORDER, SECONDARY, TAG_BACKGROUND, type AuthorSlug } from '../render/theme.js';
import { COUNTER_FONT_STACK } from './Counter.js';
import {
	SOURCE_HEAD_BOUNDING_BOX,
	SOURCE_HEAD_FONT_SIZE_PX,
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
 * content the same way `Counter.tsx`'s page number already is: DM Sans
 * (`COUNTER_FONT_STACK`, re-exported below as `SOURCE_HEAD_FONT_STACK`),
 * never `SERIF_STACK`; `SECONDARY` ink, never `INK` and never an author
 * `ACCENTS` colour (an accent here would read as branding, not a page
 * header — no progress bar, no watermark, no logo, no URL, same rationale
 * `Counter.tsx` documents at length).
 *
 * ZERO MOTION: this component takes no `frame` prop and calls no Remotion
 * timing primitive — it renders byte-identical JSX for the entire duration
 * either variant is mounted, matching `Counter.tsx`'s own discipline and the
 * house rule ("the running head is fixed and the payoff label is static —
 * neither introduces motion").
 */

/**
 * Re-exported alias of `Counter.tsx`'s `COUNTER_FONT_STACK` — the exact same
 * DM Sans stack, not a second literal that could drift from it. Both framing
 * elements (the page-number counter and this running head/payoff label) are
 * UI chrome, not the author's own quoted words, and must read as one family.
 */
export const SOURCE_HEAD_FONT_STACK = COUNTER_FONT_STACK;

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
 * layout, so it structurally cannot reflow anything else on screen — same
 * NO REFLOW discipline `Counter.tsx` documents at length.
 */
export function SourceHead({ variant }: SourceHeadProps): React.ReactElement {
	const text = variant.kind === 'running-head' ? formatRunningHead(variant.card) : PAYOFF_LABEL_TEXT;

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
			 * A single `borderBottom` hairline in `BORDER` reinforces the "strip
			 * laid over the page" read without adding any per-frame variation —
			 * still one static style object, zero motion. Both variants share
			 * this one `<div>`, so the treatment cannot diverge between the
			 * running head and the payoff label even by accident.
			 */}
			<div
				style={{
					position: 'absolute',
					top: SOURCE_HEAD_BOUNDING_BOX.top,
					left: SOURCE_HEAD_BOUNDING_BOX.left,
					width: SOURCE_HEAD_BOUNDING_BOX.width,
					height: SOURCE_HEAD_BOUNDING_BOX.height,
					backgroundColor: TAG_BACKGROUND,
					borderBottom: `1px solid ${BORDER}`,
					boxSizing: 'border-box',
					display: 'flex',
					alignItems: 'center'
				}}
			>
				{/*
				 * R04 (2026-08-26): clamped to a SINGLE LINE, never wrapped —
				 * `formatRunningHead` can return up to ~135 chars for a real
				 * Discourses card (Epictetus's chapter titles are full
				 * descriptive clauses, not numbers), which at this font size
				 * would otherwise wrap to 3-4 lines and spill outside
				 * `SOURCE_HEAD_BOUNDING_BOX`'s fixed 120px plate, directly over
				 * the scrolling wall — breaking both the opaque-plate contract
				 * (`pixel-proof.ts`'s box crop) and the house rule that this
				 * overlay is fixed and static (a multi-line reflow reads as
				 * "wrapping", not motion, but is just as much a layout
				 * violation the box exists to rule out).
				 *
				 * `overflow: hidden` + `whiteSpace: 'nowrap'` +
				 * `textOverflow: 'ellipsis'`, clamped to
				 * `SOURCE_HEAD_TEXT_MAX_WIDTH_PX`, rather than pre-truncating
				 * the STRING by character count: the real browser/Chromium
				 * text shaper that Remotion renders through measures the
				 * actual DM Sans glyph widths for us, so this is correct for
				 * every string this ever receives (short or long, today or
				 * after any future book's `source_reference` shape), not just
				 * the outliers profiled once and hard-coded. `minWidth: 0`
				 * overrides the flex item's default `min-width: auto`, which
				 * would otherwise let the span grow past its `maxWidth` and
				 * defeat the clamp — a well-known flexbox-plus-ellipsis
				 * gotcha, not a redundant style.
				 *
				 * Truncating with an ellipsis, rather than silently dropping
				 * the tail, keeps the text FACTUALLY TRUE per Constraint 6: a
				 * visible "…" signals "there is more, this is not the whole
				 * title" rather than presenting a shortened phrase as
				 * complete. And because `formatRunningHead` always puts the
				 * author name and book title FIRST and any long descriptive
				 * chapter clause LAST (see that function's own doc comment),
				 * a right-hand ellipsis on the whole string naturally cuts
				 * the least important part (the chapter clause) while always
				 * preserving the most important part (author, then book) —
				 * exactly the priority order this component's task called
				 * for, with no special-casing needed. For the plan's own
				 * worked example ("MARCUS AURELIUS · MEDITATIONS, BOOK 2", 37
				 * chars) this clamp reproduces the exact same content width the
				 * text already rendered inside today — see
				 * `SOURCE_HEAD_TEXT_MAX_WIDTH_PX`'s own doc comment for why it is
				 * deliberately not narrower than that — so that render is
				 * unaffected by this change.
				 *
				 * R07 (2026-08-26): `paddingTop`/`paddingBottom:
				 * SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` guard the OTHER axis
				 * `overflow: hidden` clips. At `lineHeight: 1`, DM Sans' line
				 * box (32px, exactly `SOURCE_HEAD_FONT_SIZE_PX`) is shorter
				 * than its own content area (~37px of ascent+descent), so
				 * without this padding the clip flat-cuts descenders — invisible
				 * on the all-caps running head (no descenders in capitals) but
				 * cutting the "p" and "g" off `PAYOFF_LABEL_TEXT` ("In plain
				 * English") on every payoff-phase frame. See
				 * `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`'s own doc comment for
				 * why 8/8 rather than a taller `lineHeight`, and why it cannot
				 * overflow `SOURCE_HEAD_BOUNDING_BOX` or collide with
				 * `COUNTER_BOUNDING_BOX`.
				 */}
				<span
					style={{
						display: 'block',
						minWidth: 0,
						maxWidth: SOURCE_HEAD_TEXT_MAX_WIDTH_PX,
						overflow: 'hidden',
						whiteSpace: 'nowrap',
						textOverflow: 'ellipsis',
						paddingLeft: SOURCE_HEAD_SAFE_INSET_PX,
						paddingTop: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX,
						paddingBottom: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX,
						fontFamily: SOURCE_HEAD_FONT_STACK,
						fontWeight: 500,
						fontSize: SOURCE_HEAD_FONT_SIZE_PX,
						lineHeight: 1,
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
