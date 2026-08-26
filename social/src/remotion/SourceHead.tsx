import React from 'react';

import type { AuthorSlug } from '../render/theme.js';
import { COUNTER_FONT_STACK } from './Counter.js';

/**
 * social pilot 02a T11 (2026-08-26) STUB — written ahead of T12's real
 * implementation, purely so `__tests__/source-head.test.ts`'s new TDD tests
 * type-check under `tsc --noEmit` (Vitest/esbuild lets an import of a
 * genuinely missing export through as `undefined` at runtime, but
 * `tsc --noEmit` correctly hard-errors on it — same reasoning
 * `wall-timing.ts`'s `WALL_FONT_SIZE` stub documented for T07).
 *
 * Deliberately inert: every export below either throws when called/rendered,
 * or is a real constant that nothing in this file's own rendering yet
 * consumes. T12 replaces the `throw` in `formatRunningHead` and `SourceHead`
 * with the real implementation; this file changes no observable behaviour
 * anywhere else (`SourceHead` is not imported by `Wall.tsx` yet — that wiring
 * is T12's own job, "Implement `SourceHead.tsx` and wire into `Wall.tsx`").
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
 * STUB (T11) — see this file's top-of-file doc comment. T12 replaces this
 * `throw` with the real derivation: strip any trailing ", Section N" clause
 * from `source_reference`, uppercase it alongside the author's display name,
 * and join with " · ".
 */
export function formatRunningHead(_card: RunningHeadCardMetadata): string {
	throw new Error(
		'formatRunningHead: not implemented yet — see plans/Pf39c2-social-pilot-02a.md T12 ("Implement SourceHead.tsx and wire into Wall.tsx").'
	);
}

/**
 * STUB (T11) — see this file's top-of-file doc comment. T12 replaces this
 * `throw` with the real fixed-position, zero-motion overlay.
 */
export function SourceHead(_props: SourceHeadProps): React.ReactElement {
	throw new Error(
		'SourceHead: not implemented yet — see plans/Pf39c2-social-pilot-02a.md T12 ("Implement SourceHead.tsx and wire into Wall.tsx").'
	);
}
