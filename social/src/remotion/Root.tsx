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
						landingLine: props.landingLine
					});
					return {
						durationInFrames: computeWallTiming({
							originalExcerpt: props.originalExcerpt,
							plainLines: props.plainLines
						}).totalFrames
					};
				}}
			/>
		</>
	);
};
