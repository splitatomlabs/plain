/**
 * A standalone, TEST-ONLY Remotion entry point (F17's regression test —
 * see `../font-face.test.ts`) — deliberately separate from
 * `../../entry.tsx`/`../../Root.tsx` rather than adding a fourth,
 * production-facing composition there.
 *
 * The REAL side of the comparison: imports `register-fonts.js`, exactly
 * like `../../Root.tsx` does, so this bundle registers the real Literata
 * face before `FontProbe` (`font-probe-component.js`) ever renders. Compared
 * against `font-probe-broken-entry.tsx`, which renders the IDENTICAL
 * component but omits that one import — reproducing the exact pre-F17
 * regressed state (nothing registers `@font-face` anywhere in the bundle).
 *
 * Earlier drafts of this test instead compared a single build's rendered
 * glyphs against an explicit `Georgia, serif` render, and separately tried
 * `document.fonts.check()` — both rejected; see `../font-face.test.ts`'s
 * doc comment for the full account of why (a system font literally named
 * "Literata" on at least one developer machine masked the first approach's
 * negative control, and `document.fonts.check()` was found to report `true`
 * unconditionally in this Chromium build, even for a font name that has
 * never been declared anywhere). Diffing REAL against BROKEN — two
 * variants of this exact mechanism, not against an assumed fallback font —
 * has no such blind spot.
 */
import React from 'react';
import { registerRoot, Composition } from 'remotion';

import '../../register-fonts.js';
import { FontProbe, FONT_PROBE_WIDTH, FONT_PROBE_HEIGHT } from './font-probe-component.js';

const FontProbeRoot: React.FC = () => (
	<Composition id="FontProbe" component={FontProbe} width={FONT_PROBE_WIDTH} height={FONT_PROBE_HEIGHT} fps={30} durationInFrames={1} />
);

registerRoot(FontProbeRoot);
