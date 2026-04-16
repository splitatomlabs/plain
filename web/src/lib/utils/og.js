/**
 * Calculate the optimal font size for OG image text.
 *
 * Finds the largest font size (between min and max) where the text fits
 * within the available area, assuming Georgia serif at ~0.52x average
 * character width ratio.
 *
 * @param {string} text - The text to render
 * @param {object} [options]
 * @param {number} [options.maxWidth=1080] - Available width in pixels
 * @param {number} [options.maxHeight=410] - Available height in pixels
 * @param {number} [options.minFont=20] - Minimum font size in pixels
 * @param {number} [options.maxFont=36] - Maximum font size in pixels
 * @param {number} [options.charWidthRatio=0.52] - Average character width as fraction of font size
 * @returns {{ fontSize: number, lineHeight: string }}
 */
export function calcOgFontSize(text, options = {}) {
	const {
		maxWidth = 1080,
		maxHeight = 410,
		minFont = 20,
		maxFont = 36,
		charWidthRatio = 0.52
	} = options;

	for (let size = maxFont; size >= minFont; size--) {
		const avgCharWidth = size * charWidthRatio;
		const charsPerLine = Math.floor(maxWidth / avgCharWidth);
		const lineHeight = size <= 24 ? 1.4 : 1.45;
		const lineHeightPx = size * lineHeight;

		// Word-wrap estimation: split into words and simulate line breaks
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

		const totalHeight = lines * lineHeightPx;

		if (totalHeight <= maxHeight) {
			return { fontSize: size, lineHeight: String(lineHeight) };
		}
	}

	// Text doesn't fit even at minFont — return minimum
	return { fontSize: minFont, lineHeight: '1.4' };
}
