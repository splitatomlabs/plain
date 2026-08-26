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
	type QuestionTimingSchedule,
	type NarrationLineTiming
} from './question-timing.js';
import { SourceHead } from './SourceHead.js';
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
	/**
	 * The archaic wall phase's actual scrolling text (social pilot 02a T09 for
	 * `Wall.tsx`; REVIEW R03 threads the same field into this composition,
	 * which T09 missed — this phase reuses `Wall.tsx`'s `WallPhase` component
	 * but, until R03, was still passing it `originalExcerpt` alone, a single
	 * card's ~100-200 words against the ~412-word travel floor the fixed
	 * 44px/4.5-lines-per-second scroll needs to outrun its hard cut — every
	 * one of the 48 non-excluded question-pool cards under-filled the frame
	 * as a result). Same contract as `WallProps.chapterBlock`: this card's
	 * own excerpt plus the surrounding chapter's other cards, one full lap
	 * starting at this card, already clearing the travel floor
	 * (`render/chapter-text.ts`'s `buildChapterTextBlock`/
	 * `loadChapterTextBlock`, R02) and already shifted by T18's mid-chapter
	 * entry offset. Optional and falls back to `originalExcerpt` alone (the
	 * pre-R03 behavior) so every caller that hasn't been updated yet
	 * (Remotion Studio's `defaultProps`, existing tests) keeps rendering
	 * exactly as before — `cli.ts` is the one real caller that supplies this,
	 * mirroring its own `wall` branch.
	 */
	chapterBlock?: string;
	/**
	 * The card's own `source_reference` field, verbatim from `content/output/`
	 * — social pilot 02a T13's extension of the framing layer (T11/T12) to
	 * this composition. Combined with `author` to derive the running head via
	 * `SourceHead.tsx`'s `formatRunningHead` (never hardcoded). Optional and
	 * additive, same pattern as `Wall.tsx`'s own `sourceReference`: when
	 * omitted, no running head or payoff label renders at all, so every
	 * caller that hasn't been updated yet (Remotion Studio's `defaultProps`,
	 * existing tests) keeps rendering exactly as before — `cli.ts` is the one
	 * real caller that supplies this.
	 *
	 * Gated to exactly the two phases where it is FACTUALLY TRUE (Constraint
	 * 6): the running head only while the moving wall phase shows this book's
	 * actual archaic text, the payoff label only once the answer resolves as
	 * the plain rewrite. The opening question-alone phase gets NEITHER — the
	 * question is neither a verbatim quote of the book nor the plain rewrite
	 * itself, so labeling it as either would not be true. See `Question`'s
	 * own render logic below.
	 */
	sourceReference?: string;
	author: AuthorSlug;
	/**
	 * Optional per-line narration timing for the answer phase (native
	 * provider data — see T13). Falls back to a fixed duration when absent.
	 * social pilot 02a T16 (F04) — see `question-timing.ts`'s
	 * `QuestionTimingInput.narrationTimings` doc comment.
	 */
	narrationTimings?: NarrationLineTiming[];
	/**
	 * `"Card 5 of 48"` (`ScheduleSlot.read_through_counter` — see
	 * `scripts/lib/schedule.ts`), or `null`/omitted when this render isn't
	 * a read-through slot. Additive — see `Counter.tsx` for the overlay
	 * this renders as (T09). Never shown during the opening question-alone
	 * frame, and NEVER shown while the archaic wall is moving either (it
	 * must not collide with it) — only once the plain answer resolves in
	 * stillness.
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
	const timing: QuestionTimingSchedule = computeQuestionTiming({
		question: props.question,
		narrationTimings: props.narrationTimings
	});
	const accent = ACCENTS[props.author];
	// Optional overlay (T09) — a sibling layer on every phase below, never a
	// participant in any phase's own layout. See `Counter.tsx`.
	const counter = props.counter ?? null;
	// social pilot 02a T13 — the framing layer, extended from Wall.tsx. `null`
	// (not rendered at all) when the caller hasn't supplied `sourceReference`,
	// matching `counter`'s own optional contract above.
	const runningHead = props.sourceReference ? (
		<SourceHead variant={{ kind: 'running-head', card: { author_slug: props.author, source_reference: props.sourceReference } }} />
	) : null;
	const payoffLabel = props.sourceReference ? <SourceHead variant={{ kind: 'payoff' }} /> : null;

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
		// social pilot 02a REVIEW R03 — mirrors `Wall.tsx`'s own
		// `chapterBlock ?? originalExcerpt` fallback exactly: the moving wall
		// phase scrolls through the chapter-sourced block (already cleared of
		// the travel floor and already shifted by T18's mid-chapter entry
		// offset — see `chapterBlock`'s own doc comment above), not just this
		// card's own excerpt, so the scroll no longer runs out of text before
		// the hard cut lands.
		const wallText = props.chapterBlock ?? props.originalExcerpt;
		// No counter here, deliberately — the moving archaic wall is not a
		// still payoff frame, and the counter must never collide with it
		// (see this component's `counter` doc comment above). It resumes on
		// the answer payoff below.
		return (
			<>
				<WallPhase frame={relativeFrame} text={wallText} accent={accent} timing={wallTiming} layout={layout} />
				{runningHead}
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
			{payoffLabel}
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
