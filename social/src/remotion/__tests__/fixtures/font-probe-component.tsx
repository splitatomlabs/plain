/**
 * Shared component both F17 regression-test entry points render — see
 * `font-probe-entry.tsx` (imports `register-fonts.js`, matching production)
 * and `font-probe-broken-entry.tsx` (deliberately does NOT, reproducing the
 * exact pre-F17 regressed state) for why there are two entry points at all
 * rather than one composition with a prop toggle.
 *
 * Renders `SERIF_STACK`'s PRIMARY family alone (no fallback chain) — see
 * `font-probe-entry.tsx`'s doc comment for why not the full stack (a system
 * font literally named "Literata" on at least one developer machine this
 * was built on would otherwise satisfy the stack's legacy non-variable
 * fallback name even with registration completely broken).
 */
import React from 'react';
import { AbsoluteFill } from 'remotion';

import { SERIF_STACK } from '../../Wall.js';
import { PAPER, INK } from '../../../render/theme.js';

export const FONT_PROBE_SAMPLE_TEXT =
	'It is now time for the matter of the body to be resolved into the things out of which it was composed.';
export const FONT_PROBE_FONT_SIZE = 76;
export const FONT_PROBE_WIDTH = 1080;
export const FONT_PROBE_HEIGHT = 600;

/** `SERIF_STACK`'s first (and only intended) choice. */
export const PRIMARY_SERIF_FAMILY = SERIF_STACK.split(',')[0].trim().replace(/^['"]|['"]$/g, '');

export const FontProbe: React.FC = () => (
	<AbsoluteFill style={{ background: PAPER, padding: 40 }}>
		<p
			style={{
				fontFamily: `'${PRIMARY_SERIF_FAMILY}'`,
				fontWeight: 400,
				fontSize: FONT_PROBE_FONT_SIZE,
				lineHeight: 1.25,
				color: INK,
				margin: 0,
				padding: 0
			}}
		>
			{FONT_PROBE_SAMPLE_TEXT}
		</p>
	</AbsoluteFill>
);
