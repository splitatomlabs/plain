/**
 * Plain's warm paper palette and per-author accent colors.
 *
 * Kept in sync with `docs/BRANDING.md`. Accents fail WCAG AA for normal
 * text — use only at >=18px, or >=14px bold.
 */
export const PAPER = '#FAF7F2';
export const INK = '#2C2520';
export const SECONDARY = '#736B62';

/** Card borders, dividers, separators — Light Mode "Border" row of the palette table. */
export const BORDER = '#E8E2D9';
/** Tag pill fills, subtle backgrounds — Light Mode "Tag background" row of the palette table. */
export const TAG_BACKGROUND = '#F0EDE8';

export const ACCENTS = {
	epictetus: '#B5704F',
	'marcus-aurelius': '#5B6E8A',
	seneca: '#6B7F5E'
} as const;

export type AuthorSlug = keyof typeof ACCENTS;
