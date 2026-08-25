import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { ACCENTS, INK, PAPER, type AuthorSlug } from '../render/theme.js';
import { ReadThroughCounter } from './Counter.js';
import { assertQuestionRenderable } from './question-gate.js';
import {
	computeQuestionLayout,
	computeQuestionTiming,
	QUESTION_BOX_PADDING_X,
	QUESTION_LINE_HEIGHT_RATIO,
	type QuestionTimingSchedule
} from './question-timing.js';
import { assertWallCardRenderable } from './wall-gate.js';
import { computeWallLayout, computeWallTiming } from './wall-timing.js';
import { PayoffLine, SERIF_STACK, WallPhase } from './Wall.js';

// `extends Record<string, unknown>` is a structural-typing requirement of
// Remotion's `<Composition>` (which parameterizes over `Props extends
// Record<string, unknown>`), not part of the domain model.
export interface QuestionProps extends Record<string, unknown> {
	/** Verbatim second-person question — must never be paraphrased or fabricated. */
	question: string;
	/** Verbatim plain answer — must never be paraphrased or fabricated. */
	answer: string;
	/** Verbatim archaic original — must never be paraphrased or fabricated. */
	originalExcerpt: string;
	author: AuthorSlug;
	/**
	 * `"Card 5 of 48"` (`ScheduleSlot.read_through_counter` — see
	 * `scripts/lib/schedule.ts`), or `null`/omitted when this render isn't
	 * a read-through slot. Additive — see `Counter.tsx` for the overlay
	 * this renders as (T09). Never shown during the opening question-alone
	 * frame (see this component's own doc comment above) — only once the
	 * archaic wall arrives.
	 */
	counter?: string | null;
}

/**
 * The Question. Frame 0 is the question alone, still and readable — unlike
 * The Wall, this format OPENS in stillness, with nothing else on screen: no
 * label, no author name, no counter, no archaic text. Then the archaic
 * original arrives as the moving wall (identical visual grammar to The
 * Wall, reused via `WallPhase` — never a forked copy). Then it drops away
 * and the plain answer resolves in stillness, held motionless for at least
 * `ANSWER_SECONDS`.
 *
 * THE HOUSE RULE — THERE IS NO WRONG ANSWER. See `question-gate.ts`'s
 * `FORBIDDEN_TESTING_VOCABULARY` for the concrete vocabulary this
 * composition must never use: no score, no timer or countdown, no
 * checkmark or cross, no "the answer is". The plain answer is a landing,
 * never a correction.
 *
 * Every frame boundary lives in `question-timing.ts` — this component only
 * turns those numbers into JSX. No overshoot easing anywhere (remotion's
 * `spring` function is forbidden here, same as `Wall.tsx`): the archaic
 * side moves, the plain side does not.
 */
export const Question: React.FC<QuestionProps> = (props) => {
	const frame = useCurrentFrame();
	const timing: QuestionTimingSchedule = computeQuestionTiming({ question: props.question });
	const accent = ACCENTS[props.author];
	// Optional overlay (T09) — a sibling layer on every phase below, never a
	// participant in any phase's own layout. See `Counter.tsx`.
	const counter = props.counter ?? null;

	if (frame < timing.question.endFrame) {
		// Rejects rather than renders an over-long, illegible or
		// pool-invalidated question — see `question-gate.ts`. `Root.tsx`'s
		// `calculateMetadata` already runs this same gate before a render
		// starts; this call is the backstop for any path that renders
		// `Question` directly.
		assertQuestionRenderable({
			question: props.question,
			answer: props.answer
		});
		// No overlay of any kind here, deliberately — frame 0 is the question
		// ALONE, with nothing else on screen (see this component's doc
		// comment above and `__tests__/question-timing.test.ts`'s "frame 0
		// renders ONLY the question" guard). See the next two branches below.
		return <QuestionLine text={props.question} />;
	}

	if (frame < timing.wall.endFrame) {
		// The archaic original arrives as the moving wall. `computeWallTiming`
		// is called here purely to obtain a self-contained karaoke schedule
		// whose own clock starts at frame 0 — exactly what `WallPhase`
		// expects — so the `frame` passed to it must be relative to THIS
		// phase's own start (`timing.wall.startFrame`), not the whole
		// composition's frame 0 (which, unlike The Wall, is the question).
		assertWallCardRenderable(props.originalExcerpt);
		const wallTiming = computeWallTiming({ originalExcerpt: props.originalExcerpt, plainLines: [] });
		const layout = computeWallLayout(props.originalExcerpt);
		const relativeFrame = frame - timing.wall.startFrame;
		return (
			<>
				<WallPhase frame={relativeFrame} text={props.originalExcerpt} accent={accent} timing={wallTiming} layout={layout} />
				<ReadThroughCounter label={counter} />
			</>
		);
	}

	// The wall drops away and the plain answer resolves in stillness — the
	// exact same still, centred payoff line The Wall's landing phase uses.
	// Nothing marks it as "correct": it is simply where the passage lands.
	return (
		<>
			<PayoffLine text={props.answer} />
			<ReadThroughCounter label={counter} />
		</>
	);
};

/**
 * Phase 1 — the question alone, still, centred on paper. Zero motion: this
 * renders identically on every frame it's shown, unlike The Wall, which is
 * already mid-push-in at its own frame 0.
 *
 * Layout comes entirely from `computeQuestionLayout` — this function
 * renders exactly the font size that module resolved; it never recomputes
 * its own fit.
 */
function QuestionLine({ text }: { text: string }): React.ReactElement {
	const layout = computeQuestionLayout(text);

	return (
		<AbsoluteFill
			style={{
				background: PAPER,
				display: 'flex',
				alignItems: 'center',
				justifyContent: 'center',
				padding: `0 ${QUESTION_BOX_PADDING_X}px`
			}}
		>
			<p
				style={{
					fontFamily: SERIF_STACK,
					fontWeight: 400,
					fontSize: layout.fontSize,
					lineHeight: QUESTION_LINE_HEIGHT_RATIO,
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
