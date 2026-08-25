import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AuthorSlug } from './theme.js';

/**
 * Display names for the three-Stoic narrative hook (see `docs/BRANDING.md`).
 * Used anywhere a character needs a human-facing label distinct from the
 * author slug or the author's historical name.
 */
export const CHARACTER_NAMES: Record<AuthorSlug, string> = {
	epictetus: 'The Slave',
	'marcus-aurelius': 'The Emperor',
	seneca: 'The Senator'
};

/**
 * True until the placeholder SVGs in `social/assets/characters/` are
 * replaced with real generated portraits. Flip to `false` once all three
 * are replaced and their provenance is recorded in that directory's
 * README.md. See that README for the full asset contract.
 */
export const PORTRAITS_ARE_PLACEHOLDER = true;

/**
 * Absolute path to an author's portrait SVG, resolved relative to this
 * module's location on disk (not `process.cwd()`), so callers get a stable
 * path regardless of where the process was launched from.
 */
export function characterPortraitPath(author: AuthorSlug): string {
	return fileURLToPath(new URL(`../../assets/characters/${author}.svg`, import.meta.url));
}

const dataUriCache = new Map<AuthorSlug, string>();

/**
 * An author's portrait as a self-contained `data:image/svg+xml;base64,...`
 * URI. Downstream renderers (templates, Remotion compositions) must use
 * this instead of referencing the SVG file by path or over the network, so
 * rendered output never depends on the filesystem or network at render
 * time. Result is cached in module scope — the underlying file does not
 * change during a process's lifetime.
 */
export function characterPortraitDataUri(author: AuthorSlug): string {
	const cached = dataUriCache.get(author);
	if (cached) return cached;

	const bytes = readFileSync(characterPortraitPath(author));
	const dataUri = `data:image/svg+xml;base64,${bytes.toString('base64')}`;
	dataUriCache.set(author, dataUri);
	return dataUri;
}
