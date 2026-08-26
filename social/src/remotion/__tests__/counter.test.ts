import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { PNG } from 'pngjs';

import { ReadThroughCounter } from '../Counter.js';
import { COUNTER_BOUNDING_BOX, type CounterBoundingBox } from '../counter-layout.js';
import { ACCENTS } from '../../render/theme.js';
import { computeWallTiming } from '../wall-timing.js';
import { computeQuestionTiming } from '../question-timing.js';
import { computeObjectionTiming } from '../objection-timing.js';
import { resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';

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
const outputDir = path.join(repoRoot, 'content', 'output');

// --- Fixtures — mirror wall-timing.test.ts / question-timing.test.ts /
// objection-timing.test.ts exactly, rather than inventing new cards, so a
// reviewer already familiar with those files recognizes these on sight.

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

// F16 (2026-08-26): swapped from discourses-18-010, whose 152-word archaic
// excerpt no longer clears `wall-gate.ts`'s new travel floor at the
// smaller 76px/500px-s geometry — see `question-timing.test.ts`'s matching
// fixture comment for the numbers.
const QUESTION_ENTRY: WallPoolEntry = {
	card_id: 'discourses-64-006',
	book_slug: 'discourses'
};

const QUESTION_BASE_PROPS = {
	question: 'You want me to trust you with my business?',
	answer: "You're a man who has corrupted his own will.",
	originalExcerpt: resolveWallCardExcerpt(QUESTION_ENTRY, outputDir),
	author: 'epictetus'
};

const OBJECTION_BASE_PROPS = {
	objection: "Shouldn't he be punished?",
	reply:
		"He will be, even if you don't want him to be. The worst punishment for doing wrong is knowing that you did it. " +
		"No one suffers more than someone tortured by their own guilt. Besides, we should think about all of humanity " +
		"before we judge what happens in life. It's unfair to blame individuals for flaws that everyone has. A black " +
		"person's skin doesn't stand out among his own people. No man in Germany is ashamed of his red hair tied in a knot.",
	author: 'seneca'
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

interface DecodedFrame {
	png: PNG;
}

async function renderFrameAsPng(
	bundleLocation: string,
	id: string,
	inputProps: Record<string, unknown>,
	frame: number
): Promise<DecodedFrame> {
	const composition = await selectComposition({ serveUrl: bundleLocation, id, inputProps });
	const outPath = path.join(
		os.tmpdir(),
		`plain-counter-${id}-${frame}-${Math.random().toString(36).slice(2)}.png`
	);
	await renderStill({
		composition,
		serveUrl: bundleLocation,
		output: outPath,
		frame,
		inputProps,
		imageFormat: 'png'
	});
	return { png: PNG.sync.read(readFileSync(outPath)) };
}

function isInsideBox(x: number, y: number, box: CounterBoundingBox): boolean {
	return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
}

/**
 * The structural no-reflow proof: every pixel OUTSIDE the counter's own
 * bounding box must be byte-identical between the with-counter and
 * without-counter renders of the same frame. This is the acceptance
 * criterion made mechanical — if the counter reflowed anything, some pixel
 * belonging to the format's own content (which sits entirely outside this
 * small top-left box) would move or change, and this fails.
 */
function assertIdenticalOutsideCounterBox(withCounter: PNG, withoutCounter: PNG, box: CounterBoundingBox): void {
	expect(withCounter.width).toBe(withoutCounter.width);
	expect(withCounter.height).toBe(withoutCounter.height);

	const { width, height } = withCounter;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (isInsideBox(x, y, box)) continue;
			const idx = (width * y + x) << 2;
			for (let channel = 0; channel < 4; channel++) {
				const a = withCounter.data[idx + channel];
				const b = withoutCounter.data[idx + channel];
				if (a !== b) {
					throw new Error(
						`Pixel outside the counter's bounding box changed at (${x}, ${y}) channel ${channel}: ` +
							`${a} (with counter) vs ${b} (without counter). The overlay reflowed the composition.`
					);
				}
			}
		}
	}
}

/** Proof the counter actually drew something — the inverse of the box test above. */
function assertBoxDiffers(withCounter: PNG, withoutCounter: PNG, box: CounterBoundingBox): void {
	const { width, height } = withCounter;
	for (let y = box.top; y < Math.min(box.top + box.height, height); y++) {
		for (let x = box.left; x < Math.min(box.left + box.width, width); x++) {
			const idx = (width * y + x) << 2;
			for (let channel = 0; channel < 4; channel++) {
				if (withCounter.data[idx + channel] !== withoutCounter.data[idx + channel]) {
					return;
				}
			}
		}
	}
	throw new Error('Expected the counter to draw something inside its own bounding box, but found no difference.');
}

describe('end-to-end: overlay composes over all three formats without reflow', () => {
	it(
		'Wall, Question and Objection each render pixel-identical outside the counter box at every sampled frame, ' +
			'with the counter visible in-box wherever it is expected to be',
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
			const questionTiming = computeQuestionTiming({ question: QUESTION_BASE_PROPS.question });
			const objectionTiming = computeObjectionTiming();

			const cases: Array<{
				id: string;
				baseProps: Record<string, unknown>;
				frames: Array<{ frame: number; expectCounter: boolean; note: string }>;
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
						{ frame: 0, expectCounter: false, note: 'frame 0 — the moving wall' },
						{
							frame: wallTiming.wall.endFrame - 1,
							expectCounter: false,
							note: 'the last frame of the moving wall, an instant before the cut'
						},
						{ frame: wallTiming.landingLine.startFrame, expectCounter: true, note: 'the landing-line payoff' }
					]
				},
				{
					id: 'Question',
					baseProps: QUESTION_BASE_PROPS,
					// Frame 0 is the question ALONE, with nothing else on screen —
					// see `Question.tsx`'s doc comment and
					// `question-timing.test.ts`'s "frame 0 renders ONLY the
					// question" guard, which this test must not contradict (no
					// existing test may change). The moving archaic-wall phase that
					// follows must ALSO never show the counter — same collision
					// this format shares with The Wall's own moving phase — so it
					// only resumes on the still answer payoff.
					frames: [
						{ frame: 0, expectCounter: false, note: 'frame 0 — the question alone' },
						{
							frame: questionTiming.wall.startFrame,
							expectCounter: false,
							note: 'the moving archaic wall'
						},
						{
							frame: questionTiming.answer.startFrame,
							expectCounter: true,
							note: 'the answer payoff'
						}
					]
				},
				{
					id: 'Objection',
					baseProps: OBJECTION_BASE_PROPS,
					// Frame 0 is the objection ALONE, with nothing else on screen —
					// see `Objection.tsx`'s doc comment and
					// `objection-timing.test.ts`'s "opening branch" guard, which
					// this test must not contradict either. The overlay starts
					// once the reply resolves.
					frames: [
						{ frame: 0, expectCounter: false, note: 'frame 0 — the objection alone' },
						{
							frame: objectionTiming.replyLines[1].startFrame,
							expectCounter: true,
							note: 'the second (final) reply-line payoff'
						}
					]
				}
			];

			for (const { id, baseProps, frames } of cases) {
				for (const { frame, expectCounter } of frames) {
					const withoutCounter = await renderFrameAsPng(bundleLocation, id, baseProps, frame);
					const withCounter = await renderFrameAsPng(
						bundleLocation,
						id,
						{ ...baseProps, counter: COUNTER_LABEL },
						frame
					);

					expect(withCounter.png.width).toBe(1080);
					expect(withCounter.png.height).toBe(1920);

					// The structural no-reflow proof holds regardless of whether
					// this particular frame is expected to show the counter.
					assertIdenticalOutsideCounterBox(withCounter.png, withoutCounter.png, COUNTER_BOUNDING_BOX);

					if (expectCounter) {
						assertBoxDiffers(withCounter.png, withoutCounter.png, COUNTER_BOUNDING_BOX);
					} else {
						// Deliberately no counter on this frame (see above) — the
						// counter box itself must ALSO be identical, i.e. the two
						// renders are fully identical, not just identical outside it.
						assertIdenticalOutsideCounterBox(withCounter.png, withoutCounter.png, {
							top: 0,
							left: 0,
							width: 0,
							height: 0
						});
					}
				}
			}
		},
		300_000
	);
});
