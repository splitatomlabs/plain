import React from 'react';
import { Composition } from 'remotion';

// F17 — registers the real Literata/DM Sans faces inside the Remotion
// bundle (a side-effect import: see that module's doc comment). Imported
// FIRST, before any composition module, so the `delayRender` it registers
// is in place before webpack finishes evaluating this file.
import './register-fonts.js';

import { computeWallTiming, FPS } from './wall-timing.js';
import { assertWallCardRenderable } from './wall-gate.js';
import { Wall, type WallProps } from './Wall.js';
import { computeQuestionTiming } from './question-timing.js';
import { assertQuestionRenderable } from './question-gate.js';
import { Question, type QuestionProps } from './Question.js';
import { computeObjectionTiming } from './objection-timing.js';
import { assertObjectionRenderable } from './objection-gate.js';
import { Objection, type ObjectionProps } from './Objection.js';
import { computeStillTiming } from './still-timing.js';
import { assertStillCardRenderable } from './still-gate.js';
import { Still, type StillProps } from './Still.js';

// 1080x1920 @ 30fps — the vertical story/reel frame every format in this
// workspace renders to (see `social/src/render/sizes.ts`).
const WIDTH = 1080;
const HEIGHT = 1920;

// Placeholder default props so the composition has something valid to show
// in Remotion Studio and a sane fallback duration before real card data is
// supplied. Every render call is expected to pass real `inputProps`.
const defaultWallProps: WallProps = {
	originalExcerpt: 'This is placeholder archaic text standing in for a real card excerpt.',
	landingLine: 'This is the landing line.',
	plainLines: ['This is the rest of the plain passage.'],
	author: 'marcus-aurelius'
};

const defaultQuestionProps: QuestionProps = {
	question: 'What is a master anyway?',
	answer: 'One person cannot really master another.',
	originalExcerpt: 'This is placeholder archaic text standing in for a real card excerpt.',
	author: 'epictetus'
};

const defaultObjectionProps: ObjectionProps = {
	objection: 'Placeholder objection standing in for a real card excerpt.',
	reply: 'This is a placeholder first sentence. This is a placeholder second sentence.',
	author: 'seneca'
};

// F19 — the read-through's fallback format. No `author` field: the Still
// never uses an accent colour (see `Still.tsx`'s own doc comment).
const defaultStillProps: StillProps = {
	text: 'This is placeholder plain English text standing in for a real card, held motionless as the whole post.'
};

export const RemotionRoot: React.FC = () => {
	return (
		<>
			{/* `any` is Remotion's escape hatch for the Schema generic on schema-less compositions — this project isn't using zod prop schemas. */}
			<Composition<any, WallProps>
				id="Wall"
				component={Wall}
				width={WIDTH}
				height={HEIGHT}
				fps={FPS}
				durationInFrames={computeWallTiming(defaultWallProps).totalFrames}
				defaultProps={defaultWallProps}
				calculateMetadata={({ props }) => {
					// Runs before any frame renders — a card that's either too
					// small to read (T06's legibility floor), whose composition
					// would exceed the MP4 duration ceiling (F03), or whose
					// `landingLine` runs over the whole-passage backstop (T02)
					// throws here, failing composition selection and the render
					// outright rather than producing an illegible frame, an
					// over-long duration, or a whole-passage payoff. See
					// `wall-gate.ts`.
					assertWallCardRenderable(props.originalExcerpt, {
						plainLines: props.plainLines,
						narrationTimings: props.narrationTimings,
						landingLine: props.landingLine
					});
					return {
						durationInFrames: computeWallTiming({
							originalExcerpt: props.originalExcerpt,
							plainLines: props.plainLines,
							narrationTimings: props.narrationTimings
						}).totalFrames
					};
				}}
			/>
			<Composition<any, QuestionProps>
				id="Question"
				component={Question}
				width={WIDTH}
				height={HEIGHT}
				fps={FPS}
				durationInFrames={computeQuestionTiming(defaultQuestionProps).totalFrames}
				defaultProps={defaultQuestionProps}
				calculateMetadata={({ props }) => {
					// Runs before any frame renders — a bad card (over-long
					// question, unfittable at the legibility floor, or an entry
					// that fails the pool's own validation flags) throws here,
					// failing composition selection and the render outright
					// rather than producing an unreadable or mistagged frame.
					// See `question-gate.ts`.
					assertQuestionRenderable({ question: props.question, answer: props.answer });
					assertWallCardRenderable(props.originalExcerpt);
					return {
						durationInFrames: computeQuestionTiming({
							question: props.question,
							narrationTimings: props.narrationTimings
						}).totalFrames
					};
				}}
			/>
			<Composition<any, ObjectionProps>
				id="Objection"
				component={Objection}
				width={WIDTH}
				height={HEIGHT}
				fps={FPS}
				durationInFrames={computeObjectionTiming().totalFrames}
				defaultProps={defaultObjectionProps}
				calculateMetadata={({ props }) => {
					// Runs before any frame renders — a pool-invalidated card, a
					// reply that cannot be cleanly capped at two sentences without
					// truncating mid-argument, or text that cannot be set legibly
					// throws here, failing composition selection and the render
					// outright. See `objection-gate.ts`.
					assertObjectionRenderable({
						objection: props.objection,
						reply: props.reply
					});
					return {
						durationInFrames: computeObjectionTiming({ narrationTimings: props.narrationTimings }).totalFrames
					};
				}}
			/>
			<Composition<any, StillProps>
				id="Still"
				component={Still}
				width={WIDTH}
				height={HEIGHT}
				fps={FPS}
				durationInFrames={computeStillTiming().totalFrames}
				defaultProps={defaultStillProps}
				calculateMetadata={({ props }) => {
					// Runs before any frame renders — a card whose plain_english
					// cannot be set legibly even as a full-screen still throws
					// here, failing composition selection and the render
					// outright rather than producing illegible text. See
					// `still-gate.ts` (F19).
					assertStillCardRenderable(props.text);
					return {
						durationInFrames: computeStillTiming().totalFrames
					};
				}}
			/>
		</>
	);
};
