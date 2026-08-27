/**
 * Social pilot 02 F17 regression test: proves the Remotion bundle actually
 * renders `Wall.tsx`'s `SERIF_STACK` in the real Literata face, not
 * whatever the browser silently falls back to when nothing registers it.
 *
 * Two rejected earlier designs, kept here as a record so this isn't
 * re-attempted:
 *   1. Render `SERIF_STACK` and an explicit `Georgia, serif` render side by
 *      side and assert the pixels differ. Rejected: on any machine that
 *      happens to already have a system font literally named "Literata"
 *      installed (true of at least one developer machine this was built
 *      on), `SERIF_STACK`'s legacy non-variable `'Literata'` fallback name
 *      silently resolves from THAT unrelated system font even with this
 *      bundle's own registration completely disabled — a false pass that
 *      has nothing to do with whether the mechanism under test works.
 *   2. `document.fonts.check(...)` — the Font Loading API's own "is this
 *      font ready" query. Rejected after finding it reports `true`
 *      unconditionally in this project's Chromium build, even for a font
 *      family name that was never declared via any `@font-face` anywhere
 *      (verified directly: `document.fonts.size === 0` and `check()` still
 *      returned `true`) — not a reliable signal here.
 *
 * What this test actually does instead: renders the SAME sample text, at
 * the SAME size, in the SAME font-family name, from TWO DIFFERENT BUNDLES —
 * `fixtures/font-probe-entry.tsx` (imports `register-fonts.js`, exactly
 * like production `Root.tsx`) and `fixtures/font-probe-broken-entry.tsx`
 * (byte-identical except that one import is missing, reproducing the exact
 * pre-F17 regressed state). If registration genuinely works, the two
 * renders differ (real Literata vs. whatever the browser substitutes for
 * an unregistered name). If it silently regresses again — the missing
 * import is the ENTIRE reproduction of F17 — both bundles fall through to
 * the identical substitute and the renders come out pixel-identical, which
 * this test then fails on.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PNG } from 'pngjs';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

let bundleDir: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-test-bundle-'));
});

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});

async function bundleAndRenderStill(entryFileName: string, outSubDir: string): Promise<PNG> {
	const bundleLocation = await bundle({
		entryPoint: path.join(moduleDir, 'fixtures', entryFileName),
		outDir: path.join(bundleDir, outSubDir),
		// Source imports use explicit `.js` extensions (required by the
		// `NodeNext` module resolution in tsconfig.json), which point at the
		// `.ts`/`.tsx` files webpack actually needs to bundle — map that
		// alias so webpack resolves them. Mirrors every other `*.test.ts` in
		// this directory.
		webpackOverride: (config) => ({
			...config,
			resolve: {
				...config.resolve,
				extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
			}
		})
	});
	const composition = await selectComposition({ serveUrl: bundleLocation, id: 'FontProbe', inputProps: {} });
	const outPath = path.join(os.tmpdir(), `plain-font-probe-${outSubDir}-${Math.random().toString(36).slice(2)}.png`);
	await renderStill({
		composition,
		serveUrl: bundleLocation,
		output: outPath,
		frame: 0,
		inputProps: {},
		imageFormat: 'png'
	});
	return PNG.sync.read(readFileSync(outPath));
}

function countDifferingPixels(a: PNG, b: PNG): number {
	expect(a.width).toBe(b.width);
	expect(a.height).toBe(b.height);
	let differing = 0;
	for (let i = 0; i < a.data.length; i += 4) {
		if (
			a.data[i] !== b.data[i] ||
			a.data[i + 1] !== b.data[i + 1] ||
			a.data[i + 2] !== b.data[i + 2] ||
			a.data[i + 3] !== b.data[i + 3]
		) {
			differing++;
		}
	}
	return differing;
}

describe('F17 — the Remotion bundle actually registers and renders Literata', () => {
	it(
		'the real (register-fonts.js) build renders differently from the broken (no registration) build — ' +
			'identical output would mean the real face never loaded',
		async () => {
			const [real, broken] = await Promise.all([
				bundleAndRenderStill('font-probe-entry.tsx', 'real'),
				bundleAndRenderStill('font-probe-broken-entry.tsx', 'broken')
			]);

			const totalPixels = real.width * real.height;
			const differingPixels = countDifferingPixels(real, broken);

			// A different typeface reflows nearly the entire block of text
			// (different glyph widths shift every line break) — a real
			// regression (both bundles falling back to the same substitute)
			// would produce a difference of exactly 0 pixels, so requiring at
			// least 1% of the frame to differ is a generous margin against
			// that failure mode while still tolerant of any anti-aliasing
			// noise between renders.
			expect(differingPixels).toBeGreaterThan(totalPixels * 0.01);
		},
		120_000
	);
});
