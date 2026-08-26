import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, PAPER, type AuthorSlug } from '../render/theme.js';
import { ReadThroughCounter } from './Counter.js';
import { assertObjectionRenderable } from './objection-gate.js';
import {
	computeObjectionLayout,
	computeObjectionTiming,
	quoteObjection,
	OBJECTION_BOX_PADDING_X,
	OBJECTION_LINE_HEIGHT_RATIO,
	type ObjectionTimingSchedule,
	type NarrationLineTiming
} from './objection-timing.js';
import { SourceHead } from './SourceHead.js';
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
	/**
	 * The card's own `source_reference` field, verbatim from `content/output/`
	 * — social pilot 02a T13's extension of the framing layer (T11/T12) to
	 * this composition. Combined with `author` to derive the running head via
	 * `SourceHead.tsx`'s `formatRunningHead` (never hardcoded). Optional and
	 * additive, same pattern as `Wall.tsx`'s own `sourceReference`: when
	 * omitted, no payoff label renders at all.
	 *
	 * The Objection has NO archaic-wall phase at all (unlike Wall/Question,
	 * nothing in this format ever shows the book's own original text — see
	 * this file's own doc comment), so a RUNNING HEAD is never rendered here:
	 * there is no on-screen book text for it to truthfully name. Only the
	 * payoff-label variant is used, and only once the reply — the plain
	 * rewrite of the author's actual response — resolves in stillness. The
	 * opening objection-alone phase (the reader's own hypothetical thought,
	 * never attributed to the author) gets neither variant, for the same
	 * "not factually true" reason `Question.tsx`'s opening phase does.
	 */
	sourceReference?: string;
	/**
	 * Optional per-reply-line narration timing (native provider data — see
	 * T13). Falls back to a fixed duration per line when absent. social
	 * pilot 02a T16 (F04) — see `objection-timing.ts`'s
	 * `ObjectionTimingInput.narrationTimings` doc comment.
	 */
	narrationTimings?: NarrationLineTiming[];
	/**
	 * `"Card 5 of 48"` (`ScheduleSlot.read_through_counter` — see
	 * `scripts/lib/schedule.ts`), or `null`/omitted when this render isn't
	 * a read-through slot. Additive — see `Counter.tsx` for the overlay
	 * this renders as (T09). Never shown during the opening objection-alone
	 * frame (see that phase's own comment below) — only once the reply
	 * resolves.
	 */
	counter?: string | null;
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
	const timing: ObjectionTimingSchedule = computeObjectionTiming({ narrationTimings: props.narrationTimings });

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
	// Optional overlay (T09) — a sibling layer on every phase below, never a
	// participant in any phase's own layout. See `Counter.tsx`.
	const counter = props.counter ?? null;
	// social pilot 02a T13 — the framing layer, extended from Wall.tsx. Only
	// the payoff variant, and only on the reply phases — see the
	// `sourceReference` doc comment above for why no running head ever
	// renders in this format.
	const payoffLabel = props.sourceReference ? <SourceHead variant={{ kind: 'payoff' }} /> : null;

	if (frame < timing.objection.endFrame) {
		// No overlay of any kind here, deliberately — frame 0 is the
		// objection ALONE, still, centred, nothing else on screen (see this
		// component's doc comment above and
		// `__tests__/objection-timing.test.ts`'s "opening branch" guard). See
		// the reply-line branches below.
		return <ObjectionLine text={props.objection} author={props.author} />;
	}

	const [firstReplyLine] = timing.replyLines;
	if (frame < firstReplyLine.endFrame) {
		return (
			<>
				<PayoffLine text={gate.replyLines[0]} />
				<ReadThroughCounter label={counter} />
				{payoffLabel}
			</>
		);
	}

	return (
		<>
			<PayoffLine text={gate.replyLines[1]} />
			<ReadThroughCounter label={counter} />
			{payoffLabel}
		</>
	);
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
