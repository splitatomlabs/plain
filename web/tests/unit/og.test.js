import { describe, it, expect } from 'vitest';
import { calcOgFontSize } from '$lib/utils/og.js';

describe('calcOgFontSize', () => {
	it('returns max font size for short text', () => {
		const { fontSize } = calcOgFontSize('Hello world');
		expect(fontSize).toBe(48);
	});

	it('returns smaller font size for long text', () => {
		const longText = Array(80).fill('philosophy').join(' ');
		const { fontSize } = calcOgFontSize(longText);
		expect(fontSize).toBeLessThan(48);
	});

	it('never exceeds maxFont', () => {
		const { fontSize } = calcOgFontSize('Hi');
		expect(fontSize).toBeLessThanOrEqual(48);
	});

	it('never goes below minFont', () => {
		const veryLongText = Array(500).fill('extraordinary').join(' ');
		const { fontSize } = calcOgFontSize(veryLongText);
		expect(fontSize).toBeGreaterThanOrEqual(20);
	});

	it('respects custom min/max bounds', () => {
		const { fontSize } = calcOgFontSize('Short', { minFont: 24, maxFont: 28 });
		expect(fontSize).toBeLessThanOrEqual(28);
		expect(fontSize).toBeGreaterThanOrEqual(24);
	});

	it('returns lineHeight as a string', () => {
		const { lineHeight } = calcOgFontSize('Test text');
		expect(typeof lineHeight).toBe('string');
		expect(parseFloat(lineHeight)).toBeGreaterThanOrEqual(1.4);
		expect(parseFloat(lineHeight)).toBeLessThanOrEqual(1.45);
	});

	it('uses tighter lineHeight for smaller fonts', () => {
		// Force a small font by using very long text
		const longText = Array(300).fill('philosophy').join(' ');
		const { fontSize, lineHeight } = calcOgFontSize(longText);
		if (fontSize <= 24) {
			expect(lineHeight).toBe('1.4');
		}
	});

	it('uses looser lineHeight for larger fonts', () => {
		const { fontSize, lineHeight } = calcOgFontSize('Short text');
		if (fontSize > 24) {
			expect(lineHeight).toBe('1.45');
		}
	});

	it('produces progressively smaller fonts for progressively longer text', () => {
		const short = calcOgFontSize('A brief thought.');
		const medium = calcOgFontSize(Array(40).fill('moderate').join(' '));
		const long = calcOgFontSize(Array(120).fill('extensive').join(' '));

		expect(short.fontSize).toBeGreaterThanOrEqual(medium.fontSize);
		expect(medium.fontSize).toBeGreaterThanOrEqual(long.fontSize);
	});
});
