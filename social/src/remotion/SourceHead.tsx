import React from 'react';
import { AbsoluteFill } from 'remotion';

import { PAPER, SECONDARY, type AuthorSlug } from '../render/theme.js';
import { COUNTER_FONT_STACK } from './Counter.js';
import { SOURCE_HEAD_BOUNDING_BOX, SOURCE_HEAD_FONT_SIZE_PX, SOURCE_HEAD_SAFE_INSET_PX } from './source-head-layout.js';

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
			 * (the same PAPER colour every frame) rather than letting the
			 * archaic text behind show through at the box's margins — a
			 * masthead band, not a floating label. `pixel-proof.ts`'s tests
			 * crop exactly this box, so it must be fully opaque and fully fill
			 * it, not just the text's own tighter bounds.
			 */}
			<div
				style={{
					position: 'absolute',
					top: SOURCE_HEAD_BOUNDING_BOX.top,
					left: SOURCE_HEAD_BOUNDING_BOX.left,
					width: SOURCE_HEAD_BOUNDING_BOX.width,
					height: SOURCE_HEAD_BOUNDING_BOX.height,
					backgroundColor: PAPER,
					display: 'flex',
					alignItems: 'center'
				}}
			>
				<span
					style={{
						paddingLeft: SOURCE_HEAD_SAFE_INSET_PX,
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
