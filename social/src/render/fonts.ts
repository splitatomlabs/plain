/**
 * Shared loader for the two variable-font files this workspace ships
 * (Literata for display/body serif, DM Sans for UI/chrome) — reads each
 * woff2 off disk with `node:fs` and base64-inlines it into `@font-face` CSS,
 * so any renderer that consumes this CSS makes NO network request for
 * fonts at all (no CDN, no `localhost` asset fetch either).
 *
 * `card.ts` (the Playwright still renderer) was the original — and, before
 * social pilot 02 F17, ONLY — consumer: it hands the resulting CSS straight
 * to `buildCardHtml`'s `<style>` tag. F17 found that `social/src/remotion/`
 * (the Remotion video compositions) named the exact same font stacks
 * (`Wall.tsx`'s `SERIF_STACK`, `SourceHead.tsx`'s `SOURCE_HEAD_FONT_STACK`) but
 * never registered either face anywhere in the Remotion bundle, so every
 * MP4 silently fell back to Georgia (or, on a Linux render container with
 * no Georgia either, to a generic serif) while the JPEG feed image (via
 * `card.ts`) rendered in the real face — two different typefaces for the
 * same post. This module is the ONE loader both paths now share.
 *
 * Node-only (`node:fs`) — deliberately never imported by anything Remotion
 * bundles into its browser-side webpack build (`entry.tsx` -> `Root.tsx` ->
 * every composition), same discipline as `wall-gate.ts`'s doc comment on
 * why IT stays fs-free. The Remotion side instead consumes this loader's
 * OUTPUT, precomputed once and committed as literal source — see
 * `social/scripts/generate-remotion-font-css.ts` and
 * `social/src/remotion/fonts.generated.css`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/render` -> `social/src` -> `social`. */
const socialRoot = path.resolve(moduleDir, '..', '..');

export const LITERATA_WOFF2_RELATIVE_PATH = '@fontsource-variable/literata/files/literata-latin-wght-normal.woff2';
export const DM_SANS_WOFF2_RELATIVE_PATH = '@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2';

/** Reads a `node_modules`-relative file and returns its base64 encoding. */
export async function loadFontFileBase64(relativeToNodeModules: string): Promise<string> {
	const absolutePath = path.join(socialRoot, 'node_modules', relativeToNodeModules);
	const buf = await readFile(absolutePath);
	return buf.toString('base64');
}

/**
 * Builds `@font-face` CSS for both faces, each with its `src` inlined as a
 * base64 `data:` URL — no network request, no filesystem read, at whatever
 * time the returned CSS is later used. Both variable fonts register their
 * FULL weight axis (`100 900`) in one `@font-face` rule, matching how
 * `@fontsource-variable` itself ships them.
 */
export async function buildFontFaceCss(): Promise<string> {
	const [literataBase64, dmSansBase64] = await Promise.all([
		loadFontFileBase64(LITERATA_WOFF2_RELATIVE_PATH),
		loadFontFileBase64(DM_SANS_WOFF2_RELATIVE_PATH)
	]);

	return `
@font-face {
	font-family: 'Literata Variable';
	font-style: normal;
	font-weight: 100 900;
	src: url(data:font/woff2;base64,${literataBase64}) format('woff2');
}
@font-face {
	font-family: 'DM Sans Variable';
	font-style: normal;
	font-weight: 100 900;
	src: url(data:font/woff2;base64,${dmSansBase64}) format('woff2');
}
`;
}

let fontCssPromise: Promise<string> | null = null;

/**
 * `buildFontFaceCss`, cached in module scope — read from disk once per
 * process. `card.ts` calls this directly; `Root.tsx` (Remotion) never does
 * (see this module's doc comment) — see
 * `social/scripts/generate-remotion-font-css.ts` for the one-off Node
 * script that also calls this, at codegen time rather than render time.
 */
export function getFontCss(): Promise<string> {
	if (!fontCssPromise) {
		fontCssPromise = buildFontFaceCss();
	}
	return fontCssPromise;
}
