import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import {
	computeStillLayout,
	computeStillTiming,
	STILL_BOX_WIDTH,
	STILL_BOX_HEIGHT,
	FPS
} from '../still-timing.js';
import { MIN_POST_DURATION_FRAMES, MIN_POST_DURATION_SECONDS, MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

// bundle() defaults to a fresh, never-cleaned-up
// os.tmpdir()/remotion-webpack-bundle-* directory. Bundle into an
// mkdtemp'd directory this file owns and removes in afterAll, so
// running this suite doesn't leak temp directories (social pilot 02 F07).
let bundleDir: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-test-bundle-'));
});

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});

// --- A real, short read-through card (social pilot 02 F19's own motivating
// example: meditations-02-003's original_excerpt is 58 words, under the
// Wall gate's travel floor) — used here as a realistic Still fixture. ---
const FIXTURE_TEXT =
	'Just as you can imagine any conception you choose, so you can too. Adapt yourself to the things among which ' +
	'your lot has been cast, and love sincerely the people with whom fate has surrounded you.';

describe('computeStillTiming', () => {
	it('has exactly one phase, covering the whole composition', () => {
		const timing = computeStillTiming();
		expect(timing.still.startFrame).toBe(0);
		expect(timing.still.endFrame).toBe(timing.totalFrames);
	});

	it('is always motionless', () => {
		expect(computeStillTiming().still.motionless).toBe(true);
	});

	it('is padded up to exactly the 15s MP4 duration floor — a still has no natural length of its own', () => {
		const timing = computeStillTiming();
		expect(timing.totalFrames).toBe(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames / FPS).toBe(MIN_POST_DURATION_SECONDS);
	});

	it('is always within the 15s-59s MP4 bound', () => {
		const timing = computeStillTiming();
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
	});

	it('takes no per-card input — every call returns the identical schedule', () => {
		expect(computeStillTiming()).toEqual(computeStillTiming());
	});
});

describe('computeStillLayout', () => {
	it('fits a real short card comfortably within the box', () => {
		const layout = computeStillLayout(FIXTURE_TEXT);
		expect(layout.fits).toBe(true);
		expect(layout.fontSize).toBeGreaterThan(0);
		expect(layout.boxWidth).toBe(STILL_BOX_WIDTH);
		expect(layout.boxHeight).toBe(STILL_BOX_HEIGHT);
		expect(layout.lineHeight).toBeGreaterThan(layout.fontSize);
	});
});

describe('source guard — Still.tsx renders the text verbatim and always carries the counter', () => {
	const source = readFileSync(path.join(moduleDir, '..', 'Still.tsx'), 'utf-8');

	it('renders {props.text} with no transformation, truncation, or interpolation', () => {
		expect(source).toMatch(/\{props\.text\}/);
	});

	it('unconditionally renders ReadThroughCounter (not gated behind any phase branch)', () => {
		expect(source).toMatch(/<ReadThroughCounter label=\{counter\}\s*\/>/);
	});

	it('never calls spring( or uses overshoot easing', () => {
		expect(source).not.toMatch(/\bspring\s*\(/);
		expect(source).not.toMatch(/Easing\.(back|elastic|bounce)/);
	});

	it('takes no useCurrentFrame — nothing in this format is driven by frame number', () => {
		expect(source).not.toMatch(/useCurrentFrame/);
	});

	it('never renders an author accent colour — always ink on paper', () => {
		expect(source).not.toMatch(/ACCENTS\[/);
		expect(source).toMatch(/color:\s*INK/);
	});
});

describe('source guard — no overshoot easing anywhere in still-timing.ts or still-gate.ts', () => {
	for (const file of ['still-timing.ts', 'still-gate.ts']) {
		it(`${file} never calls spring(`, () => {
			const source = readFileSync(path.join(moduleDir, '..', file), 'utf-8');
			expect(source).not.toMatch(/\bspring\s*\(/);
		});
	}
});

describe('end-to-end smoke: renders a real still frame at 1080x1920', () => {
	it(
		'renders frame 0 with the counter present, at the registered composition size',
		async () => {
			const timing = computeStillTiming();

			const inputProps = {
				text: FIXTURE_TEXT,
				counter: 'Card 3 of 48'
			};

			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				outDir: bundleDir,
				webpackOverride: (config) => ({
					...config,
					resolve: {
						...config.resolve,
						extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
					}
				})
			});

			const composition = await selectComposition({
				serveUrl: bundleLocation,
				id: 'Still',
				inputProps
			});

			expect(composition.durationInFrames).toBe(timing.totalFrames);

			const outPath = path.join(bundleDir, `still-smoke-${Date.now()}.png`);
			await renderStill({
				composition,
				serveUrl: bundleLocation,
				output: outPath,
				frame: 0,
				inputProps,
				imageFormat: 'png'
			});

			const buf = readFileSync(outPath);
			expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
			expect(buf.readUInt32BE(16)).toBe(1080);
			expect(buf.readUInt32BE(20)).toBe(1920);
		},
		120_000
	);

	it(
		'the LAST frame renders identically to frame 0 — motionless for the whole composition, not just the start',
		async () => {
			const timing = computeStillTiming();
			const inputProps = { text: FIXTURE_TEXT, counter: null };

			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				outDir: bundleDir,
				webpackOverride: (config) => ({
					...config,
					resolve: {
						...config.resolve,
						extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
					}
				})
			});

			const composition = await selectComposition({
				serveUrl: bundleLocation,
				id: 'Still',
				inputProps
			});

			const firstPath = path.join(bundleDir, `still-first-${Date.now()}.png`);
			const lastPath = path.join(bundleDir, `still-last-${Date.now()}.png`);

			await renderStill({ composition, serveUrl: bundleLocation, output: firstPath, frame: 0, inputProps, imageFormat: 'png' });
			await renderStill({
				composition,
				serveUrl: bundleLocation,
				output: lastPath,
				frame: timing.totalFrames - 1,
				inputProps,
				imageFormat: 'png'
			});

			expect(readFileSync(firstPath).equals(readFileSync(lastPath))).toBe(true);
		},
		120_000
	);
});
