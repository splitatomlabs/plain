import { describe, expect, it } from 'vitest';

import {
	MAX_POST_DURATION_FRAMES,
	MAX_POST_DURATION_SECONDS,
	MIN_POST_DURATION_FRAMES,
	MIN_POST_DURATION_SECONDS,
	padToMinimumDuration
} from '../duration-bounds.js';
import { FPS } from '../wall-timing.js';
import { TARGET } from '../../render/encode.js';

describe('duration bounds mirror encode.ts TARGET (never imported — see module doc comment)', () => {
	it('MIN_POST_DURATION_SECONDS matches TARGET.minDurationSec', () => {
		expect(MIN_POST_DURATION_SECONDS).toBe(TARGET.minDurationSec);
	});

	it('MAX_POST_DURATION_SECONDS matches TARGET.maxDurationSec', () => {
		expect(MAX_POST_DURATION_SECONDS).toBe(TARGET.maxDurationSec);
	});

	it('MIN_POST_DURATION_FRAMES/MAX_POST_DURATION_FRAMES are derived at wall-timing.ts\'s own FPS', () => {
		expect(MIN_POST_DURATION_FRAMES).toBe(Math.round(MIN_POST_DURATION_SECONDS * FPS));
		expect(MAX_POST_DURATION_FRAMES).toBe(Math.round(MAX_POST_DURATION_SECONDS * FPS));
	});

	it('the floor is comfortably below the ceiling', () => {
		expect(MIN_POST_DURATION_FRAMES).toBeLessThan(MAX_POST_DURATION_FRAMES);
	});
});

describe('padToMinimumDuration', () => {
	it('pads a too-short composition up to exactly the floor', () => {
		const result = padToMinimumDuration(100);
		expect(result.totalFrames).toBe(MIN_POST_DURATION_FRAMES);
		expect(result.padFrames).toBe(MIN_POST_DURATION_FRAMES - 100);
		expect(result.padFrames).toBeGreaterThan(0);
	});

	it('does not pad a composition that already clears the floor', () => {
		const raw = MIN_POST_DURATION_FRAMES + 200;
		const result = padToMinimumDuration(raw);
		expect(result.totalFrames).toBe(raw);
		expect(result.padFrames).toBe(0);
	});

	it('does not pad a composition landing exactly on the floor', () => {
		const result = padToMinimumDuration(MIN_POST_DURATION_FRAMES);
		expect(result.totalFrames).toBe(MIN_POST_DURATION_FRAMES);
		expect(result.padFrames).toBe(0);
	});

	it('throws rather than shipping a composition already over the ceiling', () => {
		expect(() => padToMinimumDuration(MAX_POST_DURATION_FRAMES + 1)).toThrow(/ceiling/);
	});

	it('never returns a totalFrames outside [MIN, MAX]', () => {
		for (const raw of [0, 1, 200, MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES]) {
			const result = padToMinimumDuration(raw);
			expect(result.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
			expect(result.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
		}
	});
});
