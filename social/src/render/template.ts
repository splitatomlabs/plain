import type { AuthorSlug } from './theme.js';

export interface CardTemplateInput {
	text: string;
	author: AuthorSlug;
	width: number;
	height: number;
	fontSize?: number;
	label?: string;
}

/**
 * Pure function returning a self-contained HTML document string for the
 * Playwright renderer to screenshot. No network references (fonts, images,
 * etc. must be inlined or loaded from disk).
 *
 * Implemented in T04.
 */
export function buildCardHtml(input: CardTemplateInput): string {
	throw new Error('not implemented');
}
