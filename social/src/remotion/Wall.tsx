import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, INK, PAPER, type AuthorSlug } from '../render/theme.js';
import { fitFontSize } from '../render/fit.js';
import { ReadThroughCounter } from './Counter.js';
import { assertWallCardRenderable } from './wall-gate.js';
import {
	computeWallTiming,
	splitWords,
	wallScaleAtFrame,
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
	 * this renders as (T09).
	 */
	counter?: string | null;
}

// Exported (additively) so other compositions sharing this visual grammar —
// see `Question.tsx`'s archaic-wall phase — set type in the exact same
// typeface stack rather than duplicating the string.
export const SERIF_STACK = "'Literata Variable', 'Literata', Georgia, serif";

/**
 * The Wall — the flagship. Frame 0 is already a packed, mid-push-in wall of
 * archaic text, silent, with a karaoke highlight racing past reading speed.
 * A hard cut (no transition of any kind) drops into a motionless plain
 * payoff: one still sentence held a full 3s, then the rest of the passage
 * one still line at a time.
 *
 * Every frame boundary lives in `wall-timing.ts` — this component only
 * turns those numbers into JSX. No overshoot easing anywhere (remotion's
 * spring function is forbidden here): linear or ease-out only, per the
 * house rule.
 */
export const Wall: React.FC<WallProps> = (props) => {
	const frame = useCurrentFrame();
	const timing = computeWallTiming({
		originalExcerpt: props.originalExcerpt,
		plainLines: props.plainLines,
		narrationTimings: props.narrationTimings
	});
	const accent = ACCENTS[props.author];
	// Optional overlay (T09) — a sibling layer on every phase below, never a
	// participant in any phase's own layout. See `Counter.tsx`.
	const counter = props.counter ?? null;

	if (frame < timing.wall.endFrame) {
		// Rejects rather than renders an over-long card at an illegible size —
		// see `wall-gate.ts` (T06). `Root.tsx`'s `calculateMetadata` already
		// runs this same gate before a render starts; this call is the
		// backstop for any path that renders `Wall` directly.
		const layout = assertWallCardRenderable(props.originalExcerpt);
		return (
			<>
				<WallPhase frame={frame} text={props.originalExcerpt} accent={accent} timing={timing} layout={layout} />
				<ReadThroughCounter label={counter} />
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
 * Phase 1 — the wall itself. Set edge to edge with no margins, already
 * mid-push-in at frame 0, karaoke sweep tinting swept words in the author's
 * accent behind ink text that never changes colour.
 *
 * Layout comes entirely from `computeWallLayout` — this function renders
 * exactly the font size, line height and inset that module resolved; it
 * never recomputes its own fit, so the "packed edge to edge, no clipped
 * glyphs" geometry tested in `wall-timing.test.ts` is the geometry that
 * actually ships.
 *
 * Exported (additively) so `Question.tsx` reuses this exact JSX for its
 * archaic-wall phase rather than forking a second copy — see that file's
 * comment on `relativeFrame` for why the `frame` it passes in is relative
 * to that phase's own start, not the whole composition's frame 0.
 */
export function WallPhase({
	frame,
	text,
	accent,
	timing,
	layout
}: {
	frame: number;
	text: string;
	accent: string;
	timing: WallTimingSchedule;
	layout: WallLayout;
}): React.ReactElement {
	const words = splitWords(text);
	const scale = wallScaleAtFrame(frame, timing.wall.endFrame);

	return (
		<AbsoluteFill
			style={{
				background: PAPER,
				overflow: 'hidden',
				boxSizing: 'border-box',
				padding: layout.insetPx,
				display: 'flex',
				alignItems: 'center'
			}}
		>
			<div
				style={{
					width: '100%',
					transform: `scale(${scale})`,
					transformOrigin: '50% 50%'
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
					{words.map((word, i) => {
						const w = timing.karaoke[i];
						const active = w ? frame >= w.startFrame && frame < w.endFrame : false;
						const swept = w ? frame >= w.startFrame : false;
						// Quiet but clearly the author's accent, never a neutral grey:
						// a stronger fill on the current word, a visible (not faint)
						// trailing tint on words the sweep has already passed.
						const background = active ? `${accent}CC` : swept ? `${accent}66` : 'transparent';
						return (
							<span key={i} style={{ background, color: INK }}>
								{word}
								{i < words.length - 1 ? ' ' : ''}
							</span>
						);
					})}
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
