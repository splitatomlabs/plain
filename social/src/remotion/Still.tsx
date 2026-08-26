import React from 'react';
import { AbsoluteFill } from 'remotion';

import { INK, PAPER } from '../render/theme.js';
import { ReadThroughCounter } from './Counter.js';
import { SourceHead } from './SourceHead.js';
import { assertStillCardRenderable } from './still-gate.js';
import { STILL_BOX_PADDING_X, STILL_LINE_HEIGHT_RATIO } from './still-timing.js';
import { SERIF_STACK } from './Wall.js';

// `extends Record<string, unknown>` is a structural-typing requirement of
// Remotion's `<Composition>` (which parameterizes over `Props extends
// Record<string, unknown>`), not part of the domain model.
export interface StillProps extends Record<string, unknown> {
	/**
	 * Verbatim `plain_english` — must never be paraphrased, fabricated, or
	 * trimmed. The whole point of this format is that it's the card's own
	 * words, unedited, held motionless — see this module's doc comment.
	 */
	text: string;
	/**
	 * `"Card 5 of 48"` (`ScheduleSlot.read_through_counter` — see
	 * `scripts/lib/schedule.ts`), or `null`/omitted when this render isn't a
	 * read-through slot. The Still is ONLY ever reached from the
	 * read-through's own fallback cascade (`resolveReadThrough`), so in
	 * practice this is never omitted for a real scheduled render — kept
	 * optional (rather than required) purely for parity with the other three
	 * compositions' own `counter` prop, and so a direct Remotion Studio
	 * preview needs no counter to render. See `Counter.tsx`.
	 */
	counter?: string | null;
	/**
	 * The card's own `source_reference` field, verbatim from `content/output/`
	 * — social pilot 02a T13's extension of the framing layer (T11/T12) to
	 * this composition. Optional and additive, same pattern as `Wall.tsx`'s
	 * own `sourceReference`: when omitted, no payoff label renders at all.
	 *
	 * The Still has no archaic phase at all — the whole composition, from
	 * frame 0, IS the plain rewrite (see this file's own doc comment: "the
	 * whole frame is the card's `plain_english`, VERBATIM"). So this is the
	 * one composition where the payoff label is correct for the ENTIRE
	 * duration, not just a later phase — there is no earlier phase where it
	 * would be untrue. A running head never renders here, for the same
	 * reason: there is no on-screen book text for it to name.
	 */
	sourceReference?: string;
}

/**
 * The Still — social pilot 02 F19. The read-through's FALLBACK format: a
 * card that cannot render as Wall, Question or Objection renders as this
 * instead, so "Card N of 48" stays literally true and nothing is ever
 * skipped. The whole frame is the card's `plain_english`, VERBATIM, set on
 * warm paper, motionless, for the ENTIRE post, over the music bed — no wall
 * phase, no reveal, no second phase of any kind.
 *
 * This is the plain side of the house rule at its purest: zero motion for
 * the whole composition is not a compromise here, it's the format's whole
 * identity. The index plan already wanted exactly one still running
 * deliberately as a pattern interrupt ("with motion everywhere, a still
 * 1080x1350 image is the pattern interrupt") — this format is that asset,
 * reused for the read-through's structural gap rather than invented fresh.
 *
 * Every frame boundary and the fitted font size both live in
 * `still-timing.ts` — this component only turns those numbers into JSX. No
 * overshoot easing anywhere (moot here: nothing in this format moves at
 * all, so there is no easing curve of any kind to forbid).
 *
 * No accent colour anywhere — unlike The Objection's opening quote (set in
 * the author's `ACCENTS` colour), the Still is body-weight reading text,
 * always `INK` on `PAPER`, same as every Wall/Question/Objection payoff
 * line. This is deliberate: the Still must read as the SAME channel as
 * every moving format around it (same paper, same face, same type colour),
 * not as a fourth, differently-branded thing.
 */
export const Still: React.FC<StillProps> = (props) => {
	// Rejects rather than renders a card whose plain_english cannot be set
	// legibly even as a full-screen still — see `still-gate.ts`. `Root.tsx`'s
	// `calculateMetadata` already runs this same gate before a render
	// starts; this call is the backstop for any path that renders `Still`
	// directly.
	const layout = assertStillCardRenderable(props.text);
	// Optional overlay (T09) — a sibling layer, never a participant in this
	// format's own layout. See `Counter.tsx`.
	const counter = props.counter ?? null;
	// social pilot 02a T13 — the framing layer, extended from Wall.tsx. Only
	// the payoff variant, for the whole duration — see the `sourceReference`
	// doc comment above for why no running head ever renders in this format.
	const payoffLabel = props.sourceReference ? <SourceHead variant={{ kind: 'payoff' }} /> : null;

	return (
		<>
			<AbsoluteFill
				style={{
					background: PAPER,
					display: 'flex',
					alignItems: 'center',
					justifyContent: 'center',
					padding: `0 ${STILL_BOX_PADDING_X}px`
				}}
			>
				<p
					style={{
						fontFamily: SERIF_STACK,
						fontWeight: 400,
						fontSize: layout.fontSize,
						lineHeight: STILL_LINE_HEIGHT_RATIO,
						color: INK,
						textAlign: 'center',
						margin: 0,
						padding: 0
					}}
				>
					{props.text}
				</p>
			</AbsoluteFill>
			<ReadThroughCounter label={counter} />
			{payoffLabel}
		</>
	);
};
