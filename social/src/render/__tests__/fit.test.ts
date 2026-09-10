/**
 * Unit tests for `fit.ts`'s `fitFontSize` — the shrink-to-fit search the
 * Wall's own timing and gate both depend on (`remotion/wall-timing.ts`,
 * `remotion/wall-gate.ts`).
 *
 * These two cases are what survives `renderer.test.ts`, which was deleted
 * along with `render/card.ts` and `render/template.ts`: every other test in
 * that file exercised the Playwright card renderer that produced the unused
 * 1080x1350 Instagram feed still. The upload cover replacing it is a Remotion
 * `renderStill` of the composition's own payoff frame, covered end to end by
 * `__tests__/cli.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { fitFontSize } from '../fit.js';

const SHORT_TEXT = 'The obstacle is the way.';

const LONG_SENTENCE =
	'When the archaic wall of moving text finally gives way to stillness, the plain sentence should land like a held breath.';
const LONG_TEXT = Array.from({ length: 10 }, () => LONG_SENTENCE).join(' ');

describe('long text shrinks rather than overflows', () => {
	const box = { maxWidth: 900, maxHeight: 1400, minFont: 24, maxFont: 96 };

	it('fitFontSize picks a strictly smaller size for a long passage than a short line', () => {
		const shortResult = fitFontSize(SHORT_TEXT, box);
		const longResult = fitFontSize(LONG_TEXT, box);

		expect(longResult.fontSize).toBeLessThan(shortResult.fontSize);
	});

	it('never returns a size below minFont, and reports fits:false rather than overflowing', () => {
		const impossibleText = Array.from({ length: 2000 }, (_, i) => `unbreakable-word-${i}`).join(' ');
		const result = fitFontSize(impossibleText, {
			maxWidth: 100,
			maxHeight: 100,
			minFont: 24,
			maxFont: 96
		});

		expect(result.fontSize).toBeGreaterThanOrEqual(24);
		expect(result.fits).toBe(false);
	});
});
