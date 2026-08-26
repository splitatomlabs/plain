import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, INK, PAPER, type AuthorSlug } from '../render/theme.js';
import { fitFontSize } from '../render/fit.js';
import { ReadThroughCounter, COUNTER_FONT_STACK } from './Counter.js';
import { assertWallCardRenderable } from './wall-gate.js';
import {
	computeOpeningData,
	assertOpeningRenderable,
	countdownValueAtFrame,
	formatCountdownLabel,
	GRADE_LABEL_PREFIX,
	WALL_OPENINGS,
	type WallOpening
} from './wall-openings.js';
import {
	computeWallTiming,
	wallScrollOffsetAtFrame,
	WALL_LINE_HEIGHT_RATIO,
	FRAME_HEIGHT,
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
	/** Verbatim archaic text — must never be paraphrased or fabricated. */
	originalExcerpt: string;
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
	/**
	 * Which of the Wall's three OPENING treatments (T17) this render uses —
	 * `standard` (the packed wall exactly as it renders today), `countdown`
	 * ("190 -> 97", the original's word count counting down live in step
	 * with the scroll to the plain word count — see F15), or `grade`
	 * ("Grade 14", the original's computed reading grade as a bare
	 * measurement — original only). See `wall-openings.ts`. Defaults to
	 * `standard` so every existing caller and test is unaffected — this
	 * prop is purely additive.
	 */
	opening?: WallOpening;
	/**
	 * Which openings THIS card is eligible for — normally the precomputed
	 * `eligible_openings` field on the card's `content/social/premises/
	 * wall.json` pool entry (see `scripts/lib/premises.ts`'s
	 * `eligibleWallOpenings`). Defaults to permitting all three when
	 * omitted, so a direct render (Remotion Studio, or a caller that has
	 * already screened the card upstream) isn't blocked — `wall-openings.ts`'s
	 * `gateOpening`/`assertOpeningRenderable` is the REJECTION path this
	 * feeds when a real pool entry's list is narrower than `['standard',
	 * 'countdown', 'grade']`.
	 */
	eligibleOpenings?: WallOpening[];
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

	if (frame < timing.wall.endFrame) {
		// Rejects rather than renders an over-long card (either too small to
		// read, or whose composition busts the duration ceiling — F03) — see
		// `wall-gate.ts` (T06). `Root.tsx`'s `calculateMetadata` already runs
		// this same gate before a render starts; this call is the backstop
		// for any path that renders `Wall` directly.
		const layout = assertWallCardRenderable(props.originalExcerpt, {
			plainLines: props.plainLines,
			narrationTimings: props.narrationTimings
		});

		// T17 — the opening rotation. `standard` (the default) renders
		// nothing extra here at all: the wall is unchanged. The two numeric
		// openings compute their numeral from the real card (never
		// hardcoded — CONSTRAINT 6's "factually true") and gate themselves
		// against this card's `eligibleOpenings` before rendering anything —
		// see `wall-openings.ts`'s `assertOpeningRenderable`.
		const opening = props.opening ?? 'standard';
		let openingBadge: React.ReactElement | null = null;
		if (opening !== 'standard') {
			// The full plain passage, reconstructed the same way the schedule
			// (T18) will have it — `landingLine` is part of `plain_english`,
			// not a separate sentence, so word count must include it to match
			// `scripts/lib/premises.ts`'s `lengthDelta` (`wordCount(card.
			// plain_english)`).
			const plainText = [props.landingLine, ...props.plainLines].join(' ');
			const openingData = computeOpeningData(props.originalExcerpt, plainText);
			assertOpeningRenderable(
				{ eligible_openings: props.eligibleOpenings ?? WALL_OPENINGS },
				opening,
				openingData
			);
			if (opening === 'countdown') {
				// The cut is the LAST frame the wall phase renders
				// (`timing.wall.endFrame` itself is already the payoff phase —
				// see the `frame < timing.landingLine.endFrame` branch below),
				// so `countdownValueAtFrame` lands exactly on
				// `plainWordCount` there, not one frame late. Driven by scroll
				// progress (F15) — see `wall-openings.ts`'s doc comment.
				const value = countdownValueAtFrame(frame, timing.wall.endFrame - 1, openingData);
				openingBadge = <WallOpeningBadge value={formatCountdownLabel(value)} accent={accent} />;
			} else {
				// `grade`: ORIGINAL ONLY, bare measurement — never the plain
				// side's grade, never an adjective. `GRADE_LABEL_PREFIX` is a
				// hardcoded constant ("Grade"), never composed from card data
				// — see `FORBIDDEN_GRADE_VOCABULARY` in `wall-openings.ts`.
				openingBadge = (
					<WallOpeningBadge value={String(openingData.originalGrade)} accent={accent} sublabel={GRADE_LABEL_PREFIX} />
				);
			}
		}

		return (
			<>
				<WallPhase frame={frame} text={props.originalExcerpt} accent={accent} timing={timing} layout={layout} />
				{openingBadge}
			</>
		);
	}

	if (frame < timing.landingLine.endFrame) {
		return (
			<>
				<PayoffLine text={props.landingLine} />
				<ReadThroughCounter label={counter} />
			</>
		);
	}

	const restLine = timing.restLines.find((line) => frame >= line.startFrame && frame < line.endFrame);
	return (
		<>
			<PayoffLine text={restLine ? restLine.text : ''} />
			<ReadThroughCounter label={counter} />
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
 * The numeral is the SUBJECT of the `countdown` and `grade` openings, not a
 * badge pinned over the text — the index plan's own words are "the first
 * frame carries A NUMBER INSTEAD OF A WALL". This renders it that way:
 * dominant (`WALL_OPENING_VALUE_FONT_SIZE`, 280-360px), set directly over
 * the wall with NO backing plate, no rounded rectangle and no blur — it is
 * fine, and expected, for it to sit on top of illegible archaic text; what
 * it must never do is erase a soft-edged rectangle out of that text the way
 * an opaque card would.
 *
 * FRAMING TEXT under CONSTRAINT 6, not quoted content — set apart from
 * `WallPhase`'s quoted block by every signal that rule asks for, all at
 * once rather than relying on any single one:
 *
 *   - a different typeface — `COUNTER_FONT_STACK` (DM Sans, the UI face
 *     `Counter.tsx` already uses for the read-through label), never
 *     `SERIF_STACK`, which is reserved for the author's own words;
 *   - a different colour — the author's own `accent`, never the wall's
 *     `INK`, and (per `docs/BRANDING.md`) accents are only ever used this
 *     large specifically because they fail WCAG AA at body-text sizes;
 *   - roughly 6x the wall's own type size — unmistakably a different kind
 *     of thing on screen, not a bigger word in the same sentence;
 *   - no name, no "he/she wrote", no possessive — bare digits (and, for
 *     `grade`, the bare word "Grade") and nothing else, so it is never
 *     attributed to the author.
 *
 * Both openings anchor to the SAME region (the upper third, horizontally
 * centred) so the two numeric openings read as one family rather than two
 * different treatments.
 *
 * `value` and `sublabel` must already be the exact, computed, factual
 * strings to show (`"190"`, `"14"` + `"Grade"`) — this component does no
 * formatting or rounding of its own; see `wall-openings.ts`'s
 * `computeOpeningData`, `countdownValueAtFrame`, `formatCountdownLabel` and
 * `GRADE_LABEL_PREFIX` for where those come from.
 */
export const WALL_OPENING_VALUE_FONT_SIZE = 320;
export const WALL_OPENING_SUBLABEL_FONT_SIZE = 72;
/** Anchors the badge's content vertically within the frame's upper third. */
export const WALL_OPENING_REGION_HEIGHT = FRAME_HEIGHT / 3;

export function WallOpeningBadge({
	value,
	accent,
	sublabel
}: {
	value: string;
	accent: string;
	sublabel?: string;
}): React.ReactElement {
	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<div
				style={{
					position: 'absolute',
					top: 0,
					left: 0,
					right: 0,
					height: WALL_OPENING_REGION_HEIGHT,
					display: 'flex',
					flexDirection: 'column',
					alignItems: 'center',
					justifyContent: 'center'
				}}
			>
				{sublabel ? (
					<span
						style={{
							fontFamily: COUNTER_FONT_STACK,
							fontWeight: 700,
							fontSize: WALL_OPENING_SUBLABEL_FONT_SIZE,
							lineHeight: 1,
							color: accent,
							marginBottom: 8
						}}
					>
						{sublabel}
					</span>
				) : null}
				<span
					style={{
						fontFamily: COUNTER_FONT_STACK,
						fontWeight: 700,
						fontSize: WALL_OPENING_VALUE_FONT_SIZE,
						lineHeight: 1,
						color: accent
					}}
				>
					{value}
				</span>
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
