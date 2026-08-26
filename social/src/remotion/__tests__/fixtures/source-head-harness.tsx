/**
 * Test-only harness (social pilot 02a T11) that mounts the same three
 * layers a real read-through Wall render eventually will (`Wall.tsx`'s
 * moving wall phase, the read-through counter, and the framing layer) as
 * plain siblings, so `../source-head.test.ts` can render actual frames and
 * diff pixels WITHOUT waiting on T12's `Wall.tsx` wiring. Deliberately kept
 * out of `../../entry.tsx`/`../../Root.tsx` — same reasoning
 * `font-probe-entry.tsx` documents for its own harness: a fourth,
 * production-facing composition has no reason to exist just to serve one
 * test file.
 *
 * Reuses `WallPhase` and `ReadThroughCounter` directly from the real
 * production modules (not reimplemented here) so the scrolling background
 * this harness renders is the SAME code path a real Wall render uses —
 * only `SourceHead` itself is under test.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { PAPER } from '../../../render/theme.js';
import { computeWallLayout } from '../../wall-timing.js';
import { WallPhase } from '../../Wall.js';
import { ReadThroughCounter } from '../../Counter.js';
import { SourceHead, type SourceHeadVariant } from '../../SourceHead.js';

export interface SourceHeadHarnessProps extends Record<string, unknown> {
	/** Verbatim archaic text for the scrolling background — same role as `WallProps.originalExcerpt`/`chapterBlock`. */
	wallText: string;
	/** `null` omits the counter entirely (mirrors `WallProps.counter`/`ReadThroughCounter`'s own `null` contract). */
	counter: string | null;
	/** `null` omits `SourceHead` entirely — a harness-only knob; `SourceHead` itself has no "off" state in production. */
	sourceHead: SourceHeadVariant | null;
}

export const SourceHeadHarness: React.FC<SourceHeadHarnessProps> = ({ wallText, counter, sourceHead }) => {
	const frame = useCurrentFrame();
	const layout = computeWallLayout(wallText);

	return (
		<AbsoluteFill style={{ background: PAPER }}>
			<WallPhase frame={frame} text={wallText} layout={layout} />
			<ReadThroughCounter label={counter} />
			{sourceHead ? <SourceHead variant={sourceHead} /> : null}
		</AbsoluteFill>
	);
};
