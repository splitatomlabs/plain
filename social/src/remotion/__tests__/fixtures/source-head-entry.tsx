/**
 * Standalone, TEST-ONLY Remotion entry point for `../source-head.test.ts`'s
 * pixel-level proofs — see `source-head-harness.tsx`'s doc comment for why
 * a dedicated harness/entry pair exists rather than reusing
 * `../../entry.tsx`. Registers the real fonts exactly like production does
 * (`register-fonts.js`) so DM Sans/Literata actually render, not a fallback
 * system font.
 */
import React from 'react';
import { registerRoot, Composition } from 'remotion';

import '../../register-fonts.js';
import { SourceHeadHarness, type SourceHeadHarnessProps } from './source-head-harness.js';

const WIDTH = 1080;
const HEIGHT = 1920;
const FPS = 30;

// Long enough to sample frames well into the wall's scroll (see
// `source-head.test.ts`'s "fixed across wall frames" case) without
// depending on any particular card's own computed duration — this harness
// bypasses `computeWallTiming`/the wall gate entirely, so it needs its own
// generous, fixed duration.
const DURATION_IN_FRAMES = 300;

const defaultProps: SourceHeadHarnessProps = {
	wallText: 'Placeholder archaic text standing in for a real chapter block.',
	counter: null,
	sourceHead: null
};

const SourceHeadHarnessRoot: React.FC = () => (
	<Composition<any, SourceHeadHarnessProps>
		id="SourceHeadHarness"
		component={SourceHeadHarness}
		width={WIDTH}
		height={HEIGHT}
		fps={FPS}
		durationInFrames={DURATION_IN_FRAMES}
		defaultProps={defaultProps}
	/>
);

registerRoot(SourceHeadHarnessRoot);
