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

// Average character width as a fraction of font size — matches the Georgia
// serif estimate `calcOgFontSize` uses in `web/src/lib/utils/og.js`. Literata
// is a similar-proportioned serif, so the same ratio is a reasonable estimate
// for a starting point (card.ts corrects it with a real DOM measurement).
const CHAR_WIDTH_RATIO = 0.52;

/**
 * Estimates how many lines `text` wraps into at `fontSize` within
 * `maxWidth`, using the same word-wrap simulation as `calcOgFontSize` in
 * `web/src/lib/utils/og.js`. Exported (additively) so callers that need the
 * line count itself — not just whether it fits — don't have to duplicate
 * this simulation (see `wall-timing.ts`'s `computeWallLayout`).
 */
export function estimateWrappedLineCount(text: string, fontSize: number, maxWidth: number): number {
	const avgCharWidth = fontSize * CHAR_WIDTH_RATIO;

	const words = text.split(/\s+/);
	let lines = 1;
	let currentLineWidth = 0;

	for (const word of words) {
		const wordWidth = word.length * avgCharWidth;
		if (currentLineWidth > 0 && currentLineWidth + avgCharWidth + wordWidth > maxWidth) {
			lines++;
			currentLineWidth = wordWidth;
		} else {
			currentLineWidth += (currentLineWidth > 0 ? avgCharWidth : 0) + wordWidth;
		}
	}

	return lines;
}

/**
 * Estimates the wrapped-text height for `text` set at `fontSize`, using the
 * same word-wrap simulation as `calcOgFontSize` in `web/src/lib/utils/og.js`.
 */
function estimateHeight(text: string, fontSize: number, maxWidth: number, lineHeightRatio: number): number {
	const lineHeightPx = fontSize * lineHeightRatio;
	return estimateWrappedLineCount(text, fontSize, maxWidth) * lineHeightPx;
}

/**
 * Finds the largest font size in `[minFont, maxFont]` whose estimated
 * wrapped height fits `maxHeight`.
 *
 * `estimateHeight` is monotonically non-decreasing in `fontSize` (bigger
 * text both wraps into more lines, never fewer, and has a taller line
 * height), so "does this size fit" is a monotonic predicate over the search
 * range — true for small sizes, false for large ones, with a single
 * crossover point. That makes binary search valid here, unlike a general
 * layout problem where size and line count don't move together.
 */
export function fitFontSize(text: string, options: FitOptions): FitResult {
	const {
		maxWidth,
		maxHeight,
		minFont = 20,
		maxFont = 96,
		lineHeightRatio = 1.45
	} = options;

	const fits = (fontSize: number): boolean =>
		estimateHeight(text, fontSize, maxWidth, lineHeightRatio) <= maxHeight;

	let lo = minFont;
	let hi = maxFont;
	let best: number | null = null;

	while (lo <= hi) {
		const mid = Math.floor((lo + hi) / 2);
		if (fits(mid)) {
			best = mid;
			lo = mid + 1;
		} else {
			hi = mid - 1;
		}
	}

	if (best === null) {
		return { fontSize: minFont, lineHeight: minFont * lineHeightRatio, fits: false };
	}

	return { fontSize: best, lineHeight: best * lineHeightRatio, fits: true };
}
