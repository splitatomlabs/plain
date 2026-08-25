/**
 * Plain's warm paper palette and per-author accent colors.
 *
 * Kept in sync with `docs/BRANDING.md`. Accents fail WCAG AA for normal
 * text — use only at >=18px, or >=14px bold.
 */
export const PAPER = '#FAF7F2';
export const INK = '#2C2520';
export const SECONDARY = '#736B62';

export const ACCENTS = {
	epictetus: '#B5704F',
	'marcus-aurelius': '#5B6E8A',
	seneca: '#6B7F5E'
} as const;

export type AuthorSlug = keyof typeof ACCENTS;
