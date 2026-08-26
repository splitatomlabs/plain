import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, INK, PAPER, type AuthorSlug } from '../render/theme.js';
import { fitFontSize } from '../render/fit.js';
import { ReadThroughCounter } from './Counter.js';
import { SourceHead } from './SourceHead.js';
import { assertWallCardRenderable } from './wall-gate.js';
import {
	computeWallTiming,
	wallScrollOffsetAtFrame,
	WALL_LINE_HEIGHT_RATIO,
	PAYOFF_BOX_WIDTH,
	PAYOFF_BOX_HEIGHT,
	PAYOFF_MIN_FONT,
	PAYOFF_MAX_FONT,
	PAYOFF_LINE_HEIGHT_RATIO,
	PAYOFF_PADDING_X,
	type NarrationLineTiming,
	type WallLayout,
	type WallTimingSchedule
} from './wall-timing.js';

// `extends Record<string, unknown>` is a structural-typing requirement of
// Remotion's `<Composition>` (which parameterizes over `Props extends
// Record<string, unknown>`), not part of the domain model.
export interface WallProps extends Record<string, unknown> {
	/**
	 * Verbatim archaic text — must never be paraphrased or fabricated. This
	 * card's OWN excerpt (used by the gate, and as the fallback wall-phase
	 * text below when `chapterBlock` is omitted) — not necessarily what
	 * phase 1 renders; see `chapterBlock`.
	 */
	originalExcerpt: string;
	/**
	 * The moving wall phase's actual scrolling text (social pilot 02a
	 * T05-T09) — verbatim text from this card's own excerpt PLUS the
	 * surrounding chapter's other cards, in document order, one full lap
	 * starting at this card (`social/src/render/chapter-text.ts`'s
	 * `buildChapterTextBlock`/`loadChapterTextBlock`). Because the block
	 * always starts with this card's own `original_excerpt`, frame 0 (offset
	 * 0, before any scroll) still shows this card's own first words at the
	 * top of the frame — the chapter-sourcing only extends what continues
	 * BELOW that as the scroll travels, it never changes what frame 0 opens
	 * on. Optional and falls back to `originalExcerpt` alone (the pre-T09
	 * behavior) so every caller that hasn't been updated to supply a
	 * chapter-sourced block yet (Remotion Studio's `defaultProps`, this
	 * file's own gate call, any test that only cares about a single card)
	 * keeps rendering exactly as before — `cli.ts` is the one real caller
	 * that supplies this from `loadChapterTextBlock`.
	 */
	chapterBlock?: string;
	/**
	 * The card's own `source_reference` field (e.g. `"Meditations, Book 2,
	 * Section 1"`), verbatim from `content/output/` — social pilot 02a
	 * T11/T12's framing layer. Combined with `author` (the card's own
	 * `author_slug`) to derive the running head via `SourceHead.tsx`'s
	 * `formatRunningHead` (never hardcoded). Optional and additive, same
	 * pattern as `chapterBlock`/`counter`: when omitted, no running head or
	 * payoff label renders at all, so every caller that hasn't been updated
	 * yet (Remotion Studio's `defaultProps`, existing tests) keeps rendering
	 * exactly as before — `cli.ts` is the one real caller that supplies this,
	 * from the same `loadOutputCard` call that already resolves `author`.
	 */
	sourceReference?: string;
	/** Verbatim plain sentence held in phase 2. */
	landingLine: string;
	/** The rest of the plain passage, verbatim and in order, excluding `landingLine`. */
	plainLines: string[];
	author: AuthorSlug;
	/**
	 * Optional per-line narration timing (native provider data — see T13).
	 * Falls back to a fixed duration per line when absent.
	 */
	narrationTimings?: NarrationLineTiming[];
	/**
	 * `"Card 5 of 48"` (`ScheduleSlot.read_through_counter` — see
	 * `scripts/lib/schedule.ts`), or `null`/omitted when this render isn't
	 * a read-through slot. Additive — see `Counter.tsx` for the overlay
	 * this renders as (T09). NEVER shown during the moving wall phase (the
	 * counter must not collide with the archaic wall it would otherwise sit
	 * on top of) — only once the composition reaches a still payoff frame
	 * (the landing line or a rest line).
	 */
	counter?: string | null;
}

// Exported (additively) so other compositions sharing this visual grammar —
// see `Question.tsx`'s archaic-wall phase — set type in the exact same
// typeface stack rather than duplicating the string.
export const SERIF_STACK = "'Literata Variable', 'Literata', Georgia, serif";

/**
 * The Wall — the flagship. Frame 0 is already a packed wall of archaic text,
 * silent, SCROLLING past at a fixed rate already at full velocity (see
 * `wallScrollOffsetAtFrame` in `wall-timing.ts`) — faster than anyone can
 * read, and the hard cut always lands mid-passage, never at the end (see
 * `WALL_SCROLL_RATE_PX_PER_SEC`'s doc comment for the arithmetic that
 * guarantees it). A hard cut (no transition of any kind) drops into a
 * motionless plain payoff: one still sentence held a full 3s, then the rest
 * of the passage one still line at a time.
 *
 * (F15, social pilot 02: this replaces an earlier version that used a
 * 1.02->1.05 push-in zoom plus a karaoke highlight — reviewed on a phone,
 * nothing actually travelled. The scroll is the whole motion now; there is
 * no separate highlight.)
 *
 * Every frame boundary lives in `wall-timing.ts` — this component only
 * turns those numbers into JSX. No overshoot easing anywhere (remotion's
 * spring function is forbidden here): linear only, per the house rule.
 */
export const Wall: React.FC<WallProps> = (props) => {
	const frame = useCurrentFrame();
	const timing = computeWallTiming({
		originalExcerpt: props.originalExcerpt,
		plainLines: props.plainLines,
		narrationTimings: props.narrationTimings
	});
	const accent = ACCENTS[props.author];
	// Optional overlay (T09) — a sibling layer on every STILL payoff phase
	// below, never a participant in any phase's own layout and never shown
	// during the moving wall phase (it must not collide with the archaic
	// wall). See `Counter.tsx`.
	const counter = props.counter ?? null;
	// social pilot 02a T09 — the moving wall phase scrolls through the
	// chapter-sourced block (see `WallProps.chapterBlock`'s doc comment),
	// not just this card's own excerpt. Falls back to `originalExcerpt`
	// alone when `chapterBlock` is omitted.
	const wallText = props.chapterBlock ?? props.originalExcerpt;
	// social pilot 02a T11/T12 — the framing layer. `null` (not rendered at
	// all) when the caller hasn't supplied `sourceReference`, matching
	// `counter`'s own optional contract above.
	const runningHead = props.sourceReference ? (
		<SourceHead variant={{ kind: 'running-head', card: { author_slug: props.author, source_reference: props.sourceReference } }} />
	) : null;
	const payoffLabel = props.sourceReference ? <SourceHead variant={{ kind: 'payoff' }} /> : null;

	if (frame < timing.wall.endFrame) {
		// Rejects rather than renders an over-long card (too small to read,
		// busts the duration ceiling — F03 — or whose `landingLine` runs over
		// the whole-passage backstop — T02) — see `wall-gate.ts` (T06/T02).
		// `Root.tsx`'s `calculateMetadata` already runs this same gate before a
		// render starts; this call is the backstop for any path that renders
		// `Wall` directly.
		const layout = assertWallCardRenderable(props.originalExcerpt, {
			plainLines: props.plainLines,
			narrationTimings: props.narrationTimings,
			landingLine: props.landingLine
		});

		return (
			<>
				<WallPhase frame={frame} text={wallText} accent={accent} timing={timing} layout={layout} />
				{runningHead}
			</>
		);
	}

	if (frame < timing.landingLine.endFrame) {
		return (
			<>
				<PayoffLine text={props.landingLine} />
				<ReadThroughCounter label={counter} />
				{payoffLabel}
			</>
		);
	}

	const restLine = timing.restLines.find((line) => frame >= line.startFrame && frame < line.endFrame);
	return (
		<>
			<PayoffLine text={restLine ? restLine.text : ''} />
			<ReadThroughCounter label={counter} />
			{payoffLabel}
		</>
	);
};

/**
 * Phase 1 — the wall itself. Set edge to edge with no left/right margins,
 * SCROLLING past at a fixed, linear rate already at full velocity at frame 0
 * (see `wallScrollOffsetAtFrame` in `wall-timing.ts`) — there is no
 * highlight of any kind (F15 dropped the karaoke sweep entirely: the scroll
 * itself is the motion, and a per-word tint would now just compete with it).
 *
 * Layout comes entirely from `computeWallLayout` — this function renders
 * exactly the font size and inset that module resolved; it never recomputes
 * its own fit, so the "block runs 2-3 screen-heights tall, no clipped
 * left/right glyphs" geometry tested in `wall-timing.test.ts` is the
 * geometry that actually ships.
 *
 * `text` is rendered as a SINGLE flowed paragraph rather than a per-word
 * span map — there is nothing left to tint per word now that the karaoke
 * highlight is gone, so the extra DOM structure would be pure overhead.
 *
 * `accent` and `timing` are accepted but unused by this function's own
 * rendering — kept in the signature (rather than removed) purely so
 * `Question.tsx`'s existing call site, which reuses this exact component for
 * its own archaic-wall phase, needs no change here. Retained as parameters,
 * not dropped, so a future caller that DOES need them (e.g. a per-format
 * accent treatment) has them already threaded through.
 *
 * Exported (additively) so `Question.tsx` reuses this exact JSX for its
 * archaic-wall phase rather than forking a second copy — see that file's
 * comment on `relativeFrame` for why the `frame` it passes in is relative
 * to that phase's own start, not the whole composition's frame 0.
 */
export function WallPhase({
	frame,
	text,
	layout
}: {
	frame: number;
	text: string;
	accent?: string;
	timing?: WallTimingSchedule;
	layout: WallLayout;
}): React.ReactElement {
	const offset = wallScrollOffsetAtFrame(frame);

	return (
		<AbsoluteFill
			style={{
				background: PAPER,
				overflow: 'hidden',
				boxSizing: 'border-box',
				// Horizontal inset only — never top/bottom, so the block's top
				// sits exactly at the frame's top at frame 0 (offset 0) and the
				// scroll crops top/bottom by design as `frame` advances. See
				// `WALL_INSET_PX`'s doc comment in `wall-timing.ts`.
				padding: `0 ${layout.insetPx}px`
			}}
		>
			<div
				style={{
					width: '100%',
					transform: `translateY(-${offset}px)`
				}}
			>
				<p
					style={{
						fontFamily: SERIF_STACK,
						fontWeight: 400,
						fontSize: layout.fontSize,
						lineHeight: WALL_LINE_HEIGHT_RATIO,
						color: INK,
						margin: 0,
						padding: 0
					}}
				>
					{text}
				</p>
			</div>
		</AbsoluteFill>
	);
}

/**
 * Phases 2 and 3 — one still line, centred, on paper, zero motion. Renders
 * identically on every frame it's shown, so there is no interpolation range
 * to accidentally animate.
 *
 * Exported (additively) so `Question.tsx` reuses this exact JSX for its own
 * still answer phase rather than forking a second copy.
 */
export function PayoffLine({ text }: { text: string }): React.ReactElement {
	const fit = fitFontSize(text, {
		maxWidth: PAYOFF_BOX_WIDTH,
		maxHeight: PAYOFF_BOX_HEIGHT,
		minFont: PAYOFF_MIN_FONT,
		maxFont: PAYOFF_MAX_FONT,
		lineHeightRatio: PAYOFF_LINE_HEIGHT_RATIO
	});

	return (
		<AbsoluteFill
			style={{
				background: PAPER,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: `0 ${PAYOFF_PADDING_X}px`
			}}
		>
			<p
				style={{
					fontFamily: SERIF_STACK,
					fontWeight: 400,
					fontSize: fit.fontSize,
					lineHeight: PAYOFF_LINE_HEIGHT_RATIO,
					color: INK,
					textAlign: 'center',
					margin: 0,
					padding: 0
				}}
			>
				{text}
			</p>
		</AbsoluteFill>
	);
}
