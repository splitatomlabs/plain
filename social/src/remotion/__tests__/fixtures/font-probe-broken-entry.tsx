/**
 * The BROKEN side of F17's regression test — see `font-probe-entry.tsx`'s
 * doc comment for the full rationale. Byte-identical to that file except
 * for the one missing import: no `register-fonts.js`, reproducing the
 * exact pre-F17 state where nothing registered `@font-face` anywhere in
 * the Remotion bundle.
 */
import React from 'react';
import { registerRoot, Composition } from 'remotion';

import { FontProbe, FONT_PROBE_WIDTH, FONT_PROBE_HEIGHT } from './font-probe-component.js';

const FontProbeRoot: React.FC = () => (
	<Composition id="FontProbe" component={FontProbe} width={FONT_PROBE_WIDTH} height={FONT_PROBE_HEIGHT} fps={30} durationInFrames={1} />
);

registerRoot(FontProbeRoot);
