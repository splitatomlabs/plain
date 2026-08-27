import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';

import { ReadThroughCounter } from '../Counter.js';
import { ACCENTS } from '../../render/theme.js';
import { computeWallTiming, computePayoffCounterBox } from '../wall-timing.js';
import { renderFrameAsPng, assertIdenticalOutsideBoxes, assertBoxDiffers, type PixelBox } from './pixel-proof.js';

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
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');

// --- Fixtures — mirror wall-timing.test.ts exactly, rather than inventing
// new cards, so a reviewer already familiar with that file recognizes these
// on sight.

interface Card {
	id: string;
	plain_english: string;
	original_excerpt: string;
	author_slug: 'epictetus' | 'marcus-aurelius' | 'seneca';
}

function loadWallFixtureCard(): Card {
	const chapter = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'output', 'meditations', 'book-07.json'), 'utf-8')
	) as Card[];
	const card = chapter.find((c) => c.id === 'meditations-07-031');
	if (!card) {
		throw new Error('Fixture card meditations-07-031 not found in content/output/meditations/book-07.json');
	}
	return card;
}

const WALL_CARD = loadWallFixtureCard();
const WALL_LANDING_LINE = 'Here is the truth, men of Athens.';
const WALL_PLAIN_LINES = WALL_CARD.plain_english
	.split(/(?<=[.?!])\s+(?=[A-Z'])/)
	.filter((line) => line.trim() !== WALL_LANDING_LINE);

const WALL_BASE_PROPS = {
	originalExcerpt: WALL_CARD.original_excerpt,
	landingLine: WALL_LANDING_LINE,
	plainLines: WALL_PLAIN_LINES,
	author: WALL_CARD.author_slug
};

const COUNTER_LABEL = 'Card 5 of 48';

// ---------------------------------------------------------------------------
// Unit-level: the component itself
// ---------------------------------------------------------------------------

describe('null label renders nothing', () => {
	it('returns null, not an empty overlay, when label is null', () => {
		// Called directly as a plain function — `ReadThroughCounter` is a
		// regular function component, so this needs no JSX/renderer to prove
		// what it returns for a null label.
		expect(ReadThroughCounter({ label: null })).toBe(null);
	});
});

// ---------------------------------------------------------------------------
// Source-level: reads as a page number, not branding
// ---------------------------------------------------------------------------

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

// Branding vocabulary the WHY comment must document (per the task spec) but
// that must never leak into the code that actually renders — same
// documented-but-never-renderable pattern `question-timing.test.ts` uses for
// `FORBIDDEN_TESTING_VOCABULARY`.
const FORBIDDEN_BRANDING_VOCABULARY = ['progress bar', 'watermark', 'logo', 'gradient'];

describe('source guard — reads as a page number, not branding', () => {
	const rawSource = readFileSync(path.join(moduleDir, '..', 'Counter.tsx'), 'utf-8');
	const renderableSource = stripComments(rawSource).toLowerCase();

	it('documents WHY it is plain text (the WCAG/watermark rationale) as a comment', () => {
		const rawLower = rawSource.toLowerCase();
		const documented = FORBIDDEN_BRANDING_VOCABULARY.some((phrase) => rawLower.includes(phrase));
		expect(documented).toBe(true);
	});

	for (const phrase of FORBIDDEN_BRANDING_VOCABULARY) {
		it(`never renders "${phrase}" outside a comment (no bar/fill/watermark/logo/gradient element)`, () => {
			expect(renderableSource).not.toContain(phrase);
		});
	}

	it('never imports or references ACCENTS in code — no author accent colour anywhere renderable', () => {
		// `ACCENTS` may (and does) appear in the doc comment explaining WHY
		// (contrasting it with `SECONDARY`) — checked against `renderableSource`
		// (comments stripped), not `rawSource`, same as the vocabulary loop above.
		expect(renderableSource).not.toMatch(/accents/);
	});

	for (const [author, hex] of Object.entries(ACCENTS)) {
		it(`never hardcodes the ${author} accent hex in code`, () => {
			expect(renderableSource).not.toContain(hex.toLowerCase());
		});
	}

	it('renders in SECONDARY, not INK — a page number recedes rather than competing on screen', () => {
		expect(renderableSource).toMatch(/color:\s*secondary/);
		expect(renderableSource).not.toMatch(/color:\s*ink\b/);
	});

	it('imports no URL/href/link — no clickable or printed URL', () => {
		expect(renderableSource).not.toMatch(/\bhref\b/);
		expect(renderableSource).not.toMatch(/\burl\(/);
	});

	it('calls no Remotion timing primitive — ZERO MOTION, structurally', () => {
		expect(renderableSource).not.toMatch(/usecurrentframe/);
		expect(renderableSource).not.toMatch(/interpolate\s*\(/);
		expect(renderableSource).not.toMatch(/\bspring\s*\(/);
		expect(renderableSource).not.toMatch(/transition/);
		expect(renderableSource).not.toMatch(/animation/);
	});

	it('takes no frame prop — it cannot vary its own output across frames', () => {
		expect(renderableSource).not.toMatch(/frame\s*:/);
	});
});

// ---------------------------------------------------------------------------
// End-to-end: renders as an overlay over all three formats without reflow
// ---------------------------------------------------------------------------

// social pilot 02a T11 (2026-08-26): `renderFrameAsPng`/`assertIdenticalOutsideBoxes`/
// `assertBoxDiffers` used to be defined locally here — factored out to
// `./pixel-proof.js` so `source-head.test.ts` can reuse the exact same
// no-reflow proof machinery rather than reimplementing a parallel copy (the
// "retarget `counter.test.ts`'s pixel-level proof" the T11 task called for).
//
// social pilot 02a U02 (2026-08-27) RETARGET: before U02 every case cropped
// the same fixed `COUNTER_BOUNDING_BOX` (a top-left corner). U02 moved the
// counter to render CENTRED BELOW that render's own payoff text instead — a
// box whose position depends on that specific text's fitted height, not a
// single constant. Each case below now supplies its own `counterBox`,
// computed via `computePayoffCounterBox` (the exact function `PayoffLine`
// itself calls — see `wall-timing.ts`), from the SAME text that render's
// payoff frame actually shows. The proof itself is unweakened: still "every
// pixel outside the counter's own box is byte-identical with/without it",
// just checked against the real box instead of one shared guess.
//
// Pf39c2-social-pilot-02a D01: Question and Objection were deleted outright
// (the channel is one Wall a day) — this used to also exercise their own
// compositions; only the Wall case remains.
describe('end-to-end: overlay composes over the Wall without reflow', () => {
	it(
		'the Wall renders pixel-identical outside the counter box at every sampled frame, ' +
			'with the counter visible in-box wherever it is expected to be, centred below that payoff text',
		async () => {
			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				outDir: bundleDir,
				// Source imports use explicit `.js` extensions (required by the
				// `NodeNext` module resolution in tsconfig.json), which point at
				// the `.ts`/`.tsx` files webpack actually needs to bundle — map
				// that alias so webpack resolves them.
				webpackOverride: (config) => ({
					...config,
					resolve: {
						...config.resolve,
						extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
					}
				})
			});

			const wallTiming = computeWallTiming(WALL_BASE_PROPS);

			const cases: Array<{
				id: string;
				baseProps: Record<string, unknown>;
				frames: Array<{ frame: number; counterBox: PixelBox | null; note: string }>;
			}> = [
				{
					id: 'Wall',
					baseProps: WALL_BASE_PROPS,
					// The Wall has no "alone" phase — frame 0 is already the moving
					// wall — but the counter must NEVER render over that moving
					// phase (it would collide with the wall's own first line — see
					// `Wall.tsx`'s `counter` doc comment). It only appears once the
					// composition reaches a still payoff frame: the landing line
					// (held for LANDING_LINE_SECONDS) or a rest line.
					frames: [
						{ frame: 0, counterBox: null, note: 'frame 0 — the moving wall' },
						{
							frame: wallTiming.wall.endFrame - 1,
							counterBox: null,
							note: 'the last frame of the moving wall, an instant before the cut'
						},
						{
							frame: wallTiming.landingLine.startFrame,
							counterBox: computePayoffCounterBox(WALL_LANDING_LINE),
							note: 'the landing-line payoff'
						}
					]
				}
			];

			for (const { id, baseProps, frames } of cases) {
				for (const { frame, counterBox } of frames) {
					const withoutCounter = await renderFrameAsPng(bundleLocation, id, baseProps, frame);
					const withCounter = await renderFrameAsPng(
						bundleLocation,
						id,
						{ ...baseProps, counter: COUNTER_LABEL },
						frame
					);

					expect(withCounter.png.width).toBe(1080);
					expect(withCounter.png.height).toBe(1920);

					if (counterBox) {
						// The structural no-reflow proof: every pixel OUTSIDE the
						// counter's own (per-case, text-derived) box is identical
						// with/without it — the payoff text itself never moves.
						assertIdenticalOutsideBoxes(withCounter.png, withoutCounter.png, [counterBox]);
						assertBoxDiffers(withCounter.png, withoutCounter.png, counterBox);
					} else {
						// Deliberately no counter on this frame (see above) — the
						// two renders must be FULLY identical, not just identical
						// outside some box.
						assertIdenticalOutsideBoxes(withCounter.png, withoutCounter.png, []);
					}
				}
			}
		},
		300_000
	);
});
