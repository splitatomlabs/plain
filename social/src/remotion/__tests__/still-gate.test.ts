import { describe, expect, it } from 'vitest';

import {
	gateStillCard,
	assertStillCardRenderable,
	STILL_MIN_LEGIBLE_FONT_PX
} from '../still-gate.js';
import { STILL_MIN_FONT, STILL_BOX_WIDTH, STILL_BOX_HEIGHT } from '../still-timing.js';
import { WALL_MIN_LEGIBLE_FONT_PX } from '../wall-timing.js';

describe('STILL_MIN_LEGIBLE_FONT_PX', () => {
	it('reuses the Wall body-text floor (39px) rather than inventing a fourth number', () => {
		expect(STILL_MIN_LEGIBLE_FONT_PX).toBe(WALL_MIN_LEGIBLE_FONT_PX);
		expect(STILL_MIN_LEGIBLE_FONT_PX).toBe(39);
	});

	it('sits strictly above STILL_MIN_FONT, so a total non-fit is also caught by the floor check', () => {
		expect(STILL_MIN_FONT).toBeLessThan(STILL_MIN_LEGIBLE_FONT_PX);
	});
});

describe('gateStillCard', () => {
	it('passes a short, real card (well within the box at a legible size)', () => {
		const result = gateStillCard(
			'Choose not to be harmed and you will not feel harmed. Do not feel harmed and you have not been.'
		);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.layout.fontSize).toBeGreaterThanOrEqual(STILL_MIN_LEGIBLE_FONT_PX);
			expect(result.layout.boxWidth).toBe(STILL_BOX_WIDTH);
			expect(result.layout.boxHeight).toBe(STILL_BOX_HEIGHT);
		}
	});

	it('passes a full 156-word real card-length passage (the longest in the Meditations book-02/03 pilot slice)', () => {
		const long =
			'When you rise in the morning, think of what a precious privilege it is to be alive, to breathe, to think, ' +
			'to enjoy, to love. Do not indulge grand schemes for your future conduct, but as opportunity offers, do good. ' +
			'Waste no more time arguing what a good person should be. Be one. Very little is needed to make a happy ' +
			'life; it is all within yourself, in your way of thinking. Confine yourself to the present. Understand well ' +
			'that only the present moment is what any person actually lives, or can lose. Everything else is either ' +
			'already past or not yet certain to come. Nothing happens to anybody that they cannot endure. Constantly ' +
			'regard the universe as one living being, having one substance and one soul. If you do this, you will not ' +
			'be so unsettled by the small troubles that arise from separation, and you will remember that we are all ' +
			'made for each other, like the feet, hands and eyelids, like the upper and lower rows of teeth.';
		const result = gateStillCard(long);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.layout.fontSize).toBeGreaterThanOrEqual(STILL_MIN_LEGIBLE_FONT_PX);
		}
	});

	it('rejects text that cannot be set legibly (far too long for the box even at the search floor)', () => {
		const tooLong = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
		const result = gateStillCard(tooLong);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.axis).toBe('legibility');
			expect(result.reason).toMatch(/legibility floor/);
		}
	});
});

describe('assertStillCardRenderable', () => {
	it('returns the layout for a renderable card', () => {
		const layout = assertStillCardRenderable('A short, real, renderable line of card text.');
		expect(layout.fontSize).toBeGreaterThanOrEqual(STILL_MIN_LEGIBLE_FONT_PX);
	});

	it('throws for a card that fails the legibility floor', () => {
		const tooLong = Array.from({ length: 600 }, (_, i) => `word${i}`).join(' ');
		expect(() => assertStillCardRenderable(tooLong)).toThrow(/legibility floor/);
	});
});
