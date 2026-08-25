import React from 'react';
import { AbsoluteFill } from 'remotion';

import { SECONDARY } from '../render/theme.js';
import { COUNTER_FONT_SIZE_PX, COUNTER_SAFE_INSET_PX } from './counter-layout.js';

/**
 * DM Sans — the UI face per `docs/BRANDING.md` — never `Wall.tsx`'s
 * `SERIF_STACK`: the counter is chrome (a page number), not display type.
 */
export const COUNTER_FONT_STACK = "'DM Sans Variable', 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif";

export interface ReadThroughCounterProps {
	/**
	 * `"Card 5 of 48"`, verbatim from `scripts/lib/schedule.ts`'s
	 * `ScheduleSlot.read_through_counter` — this component only consumes
	 * that string, it never computes or reformats it. `null` when the slot
	 * is not a read-through: renders nothing at all, not an empty overlay.
	 */
	label: string | null;
}

/**
 * A "Card 1 of 72" page-number overlay any of the three formats can carry
 * — see the `counter` prop on `Wall.tsx`, `Question.tsx` and
 * `Objection.tsx`. This is deliberately NOT a format of its own, and
 * deliberately NOT styled as progress: the index plan's cross-cutting
 * constraint is "no logo, URL or watermark inside any video frame" —
 * TikTok's own watermark-content rule warns that violations "may also lead
 * to deleted content or disabled accounts". An animated, filled or
 * accent-coloured progress bar reads as brand furniture — exactly that
 * territory — so this renders PLAIN TEXT only:
 *
 *   - `SECONDARY` grey (`#736B62`), never an author `ACCENTS` colour and
 *     never any other brand accent — a page number is neutral, not a
 *     brand mark. `SECONDARY` over `INK` is a deliberate choice, not a
 *     coin flip: at this small a size (28px, well under the 78px+ display
 *     type the other formats use for their large text) full-ink text would
 *     read as competing on-screen copy rather than ambient UI chrome —
 *     `SECONDARY` is what lets it recede. (`SECONDARY` fails WCAG AA for
 *     body text per `docs/BRANDING.md`'s contrast table, same as the
 *     author `ACCENTS`, but a passive page number that the viewer is never
 *     required to read is exactly the case that constraint doesn't govern.)
 *   - no bar, no fill, no track, no icon, no logo, no URL
 *   - no animation of any kind — see ZERO MOTION below
 *
 * ZERO MOTION: this component takes no `frame` prop and calls no Remotion
 * timing primitive (`interpolate`, `spring`, `useCurrentFrame`) — it
 * renders byte-identical JSX on every frame it's mounted on, including
 * every payoff frame, where the house rule requires >=2.5s of true
 * stillness. A counter that faded in or out would violate that rule; this
 * one structurally can't, because it carries no per-frame state to animate.
 *
 * NO REFLOW: an `AbsoluteFill` (`position: absolute; inset: 0`) rendered as
 * a SIBLING of each format's own content — never a child inside it, and
 * never sharing a flex/flow container with it (see `Wall.tsx`,
 * `Question.tsx`, `Objection.tsx`). It participates in no flow layout, so
 * it structurally cannot shift anything else on screen; see
 * `__tests__/counter.test.tsx` for the pixel-level proof.
 */
export function ReadThroughCounter({ label }: ReadThroughCounterProps): React.ReactElement | null {
	if (label === null) {
		return null;
	}

	return (
		<AbsoluteFill style={{ pointerEvents: 'none' }}>
			<span
				style={{
					position: 'absolute',
					top: COUNTER_SAFE_INSET_PX,
					left: COUNTER_SAFE_INSET_PX,
					fontFamily: COUNTER_FONT_STACK,
					fontWeight: 500,
					fontSize: COUNTER_FONT_SIZE_PX,
					lineHeight: 1,
					color: SECONDARY,
					margin: 0,
					padding: 0
				}}
			>
				{label}
			</span>
		</AbsoluteFill>
	);
}
