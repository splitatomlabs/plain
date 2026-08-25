/**
 * Auto-fit a font size to a bounding box by binary-searching between
 * `minFont` and `maxFont`, mirroring the linear scan in
 * `web/src/lib/utils/og.js` (see `calcOgFontSize`).
 */
export interface FitOptions {
	maxWidth: number;
	maxHeight: number;
	minFont?: number;
	maxFont?: number;
	fontFamily?: string;
	lineHeightRatio?: number;
}

export interface FitResult {
	fontSize: number;
	lineHeight: number;
	fits: boolean;
}

/**
 * Implemented in T04. `fits` must be `false` when even `minFont` overflows
 * the box — callers must not treat an oversized-at-minFont result as a
 * silent success.
 */
export function fitFontSize(text: string, options: FitOptions): FitResult {
	throw new Error('not implemented');
}
