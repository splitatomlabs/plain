/**
 * Test-only harness (social pilot 02a T11) that mounts a real Wall render's
 * moving wall phase alongside the framing layer, as plain siblings, so
 * `../source-head.test.ts` can render actual frames and diff pixels WITHOUT
 * waiting on T12's `Wall.tsx` wiring. Deliberately kept out of
 * `../../entry.tsx`/`../../Root.tsx` — same reasoning `font-probe-entry.tsx`
 * documents for its own harness: a fourth, production-facing composition has
 * no reason to exist just to serve one test file.
 *
 * Reuses `WallPhase` directly from the real production module (not
 * reimplemented here) so the scrolling background this harness renders is
 * the SAME code path a real Wall render uses — only `SourceHead` itself is
 * under test.
 *
 * Pf39c2-social-pilot-02a D03 (2026-08-27): this harness used to also mount
 * `ReadThroughCounter` (the read-through counter), so `source-head.test.ts`
 * could prove the framing layer never collided with it. D02 hardcoded the
 * counter's only supplier to `null`; D03 deletes `Counter.tsx` itself, so
 * that third layer — and this harness's own `counter` prop — are gone too.
 */
import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

import { PAPER } from '../../../render/theme.js';
import { computeWallLayout } from '../../wall-timing.js';
import { WallPhase } from '../../Wall.js';
import { SourceHead, type SourceHeadVariant } from '../../SourceHead.js';

export interface SourceHeadHarnessProps extends Record<string, unknown> {
	/** Verbatim archaic text for the scrolling background — same role as `WallProps.originalExcerpt`/`chapterBlock`. */
	wallText: string;
	/** `null` omits `SourceHead` entirely — a harness-only knob; `SourceHead` itself has no "off" state in production. */
	sourceHead: SourceHeadVariant | null;
}

export const SourceHeadHarness: React.FC<SourceHeadHarnessProps> = ({ wallText, sourceHead }) => {
	const frame = useCurrentFrame();
	const layout = computeWallLayout(wallText);

	return (
		<AbsoluteFill style={{ background: PAPER }}>
			<WallPhase frame={frame} text={wallText} layout={layout} />
			{sourceHead ? <SourceHead variant={sourceHead} /> : null}
		</AbsoluteFill>
	);
};
