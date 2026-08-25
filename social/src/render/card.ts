import type { AuthorSlug } from './theme.js';
import type { SizeName } from './sizes.js';

export interface RenderCardRequest {
	text: string;
	author: AuthorSlug;
	size: SizeName;
	outPath: string;
	label?: string;
}

export interface RenderCardResult {
	path: string;
	width: number;
	height: number;
	format: 'png' | 'jpeg';
	fontSize: number;
	bytes: number;
}

/**
 * Renders a card to `req.outPath` using Playwright, auto-fitting the font
 * size via `fitFontSize` (see `fit.ts`).
 *
 * Implemented in T04.
 */
export async function renderCard(req: RenderCardRequest): Promise<RenderCardResult> {
	throw new Error('not implemented');
}
