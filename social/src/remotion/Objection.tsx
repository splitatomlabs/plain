import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, PAPER, type AuthorSlug } from '../render/theme.js';
import { assertObjectionRenderable } from './objection-gate.js';
import {
	computeObjectionLayout,
	computeObjectionTiming,
	quoteObjection,
	OBJECTION_BOX_PADDING_X,
	OBJECTION_LINE_HEIGHT_RATIO,
	type ObjectionTimingSchedule
} from './objection-timing.js';
import { PayoffLine, SERIF_STACK } from './Wall.js';

// `extends Record<string, unknown>` is a structural-typing requirement of
// Remotion's `<Composition>` (which parameterizes over `Props extends
// Record<string, unknown>`), not part of the domain model.
export interface ObjectionProps extends Record<string, unknown> {
	/** Verbatim objection — must never be paraphrased, fabricated, or attributed. */
	objection: string;
	/**
	 * Verbatim reply, used as given — see `objection-gate.ts`'s
	 * `ObjectionGateInput.reply` doc comment for why this is NOT sliced by
	 * a `reply_start` offset here (that offset is into the source card's
	 * `plain_english`, not into this string).
	 */
	reply: string;
	author: AuthorSlug;
}

/**
 * The Objection. Frame 0 is the objection alone, in quotation marks, set
 * large in the author's accent colour — still, centred, nothing else on
 * screen. It must read as a thought the viewer has had, never as a quiz or
 * a strawman being set up: no "he says", no "you might think", no
 * attribution. Then the reply resolves in stillness, one line at a time —
 * exactly two lines, the two-sentence cap `objection-gate.ts` enforces.
 *
 * Accent-coloured text is otherwise reserved for >=18px (or >=14px bold)
 * per `docs/BRANDING.md`'s WCAG guidance; it's permitted here specifically
 * because frame 0 is large display type, fitted no smaller than
 * `OBJECTION_MIN_LEGIBLE_FONT_PX` (~78px in this 1080-wide frame, the
 * 1080-frame equivalent of a 28 CSS px floor) — far above that minimum.
 * See `objection-gate.ts` for the full derivation.
 *
 * Every frame boundary lives in `objection-timing.ts` — this component
 * only turns those numbers into JSX. No overshoot easing anywhere
 * (remotion's `spring` function is forbidden here, same as `Wall.tsx` and
 * `Question.tsx`): nothing in this format moves at all — the whole thing
 * is a sequence of still frames.
 */
export const Objection: React.FC<ObjectionProps> = (props) => {
	const frame = useCurrentFrame();
	const timing: ObjectionTimingSchedule = computeObjectionTiming();

	// Rejects rather than renders a pool-invalidated card, a reply that
	// cannot be cleanly capped at two sentences without truncating
	// mid-argument, or text that cannot be set legibly — see
	// `objection-gate.ts`. `Root.tsx`'s `calculateMetadata` already runs
	// this same gate before a render starts; this call is the backstop for
	// any path that renders `Objection` directly.
	const gate = assertObjectionRenderable({
		objection: props.objection,
		reply: props.reply
	});

	if (frame < timing.objection.endFrame) {
		return <ObjectionLine text={props.objection} author={props.author} />;
	}

	const [firstReplyLine] = timing.replyLines;
	if (frame < firstReplyLine.endFrame) {
		return <PayoffLine text={gate.replyLines[0]} />;
	}

	return <PayoffLine text={gate.replyLines[1]} />;
};

/**
 * Phase 1 — the objection alone, still, centred on paper, in the author's
 * accent colour. Zero motion: renders identically on every frame it's
 * shown, unlike The Wall, which is already mid-push-in at its own frame 0.
 *
 * Layout comes entirely from `computeObjectionLayout` — this function
 * renders exactly the font size that module resolved; it never recomputes
 * its own fit. `quoteObjection` is the same function the gate fits
 * against, so what's measured and what's drawn can never diverge.
 */
function ObjectionLine({ text, author }: { text: string; author: AuthorSlug }): React.ReactElement {
	const layout = computeObjectionLayout(text);
	const accent = ACCENTS[author];

	return (
		<AbsoluteFill
			style={{
				background: PAPER,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: `0 ${OBJECTION_BOX_PADDING_X}px`
			}}
		>
			<p
				style={{
					fontFamily: SERIF_STACK,
					fontWeight: 400,
					fontSize: layout.fontSize,
					lineHeight: OBJECTION_LINE_HEIGHT_RATIO,
					color: accent,
					textAlign: 'center',
					margin: 0,
					padding: 0
				}}
			>
				{quoteObjection(text)}
			</p>
		</AbsoluteFill>
	);
}
