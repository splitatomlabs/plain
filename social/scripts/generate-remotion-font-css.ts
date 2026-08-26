/**
 * Social pilot 02 F17: writes `social/src/remotion/fonts.generated.css` —
 * the same `@font-face` CSS `social/src/render/fonts.ts`'s `getFontCss()`
 * builds for `card.ts` (the Playwright still renderer), but captured as a
 * literal, committed source file instead of read from disk at render time.
 *
 * Why a committed file rather than a runtime read: `social/src/remotion/`
 * is bundled by Remotion's browser-side webpack build (`entry.tsx` ->
 * `Root.tsx` -> every composition) and executed inside a headless Chromium
 * tab, not a Node process — `node:fs` cannot run there. Precomputing the
 * CSS once in Node (this script) and committing the result as a plain
 * `.css` file lets `Root.tsx` `import` it as an ordinary, network-free,
 * fs-free module — webpack's default `.css` rule (`style-loader` +
 * `css-loader`, already part of `@remotion/bundler`'s shared config, no
 * `webpackOverride` needed) injects it into `<head>` as a `<style>` tag the
 * moment the bundle's JS evaluates, before any composition mounts.
 *
 * Re-run this whenever `@fontsource-variable/literata` or
 * `@fontsource-variable/dm-sans` is upgraded (the woff2 bytes would
 * change): `npx tsx social/scripts/generate-remotion-font-css.ts`
 *
 * Deliberately NOT run automatically on every `npm test`/render — the woff2
 * source files are pinned dependency versions that don't change between
 * runs, so committing the generated output (like the placeholder character
 * SVGs, T02) is cheaper and more auditable than regenerating on every
 * invocation.
 */

import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildFontFaceCss } from '../src/render/fonts.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(moduleDir, '..', 'src', 'remotion', 'fonts.generated.css');

async function main(): Promise<void> {
	const fontFaceCss = await buildFontFaceCss();
	const header =
		'/* AUTO-GENERATED — do not hand-edit.\n' +
		' * Run `npx tsx social/scripts/generate-remotion-font-css.ts` to regenerate\n' +
		' * (social pilot 02 F17 — see that script for why this is committed rather\n' +
		' * than read from disk at render time). Source: @fontsource-variable/literata\n' +
		' * and @fontsource-variable/dm-sans woff2 files, base64-inlined. */\n';
	await writeFile(outPath, header + fontFaceCss, 'utf-8');
	console.log(`Wrote ${outPath} (${(header.length + fontFaceCss.length).toLocaleString()} bytes)`);
}

main().catch((e) => {
	console.error('generate-remotion-font-css failed:', e);
	process.exit(1);
});
