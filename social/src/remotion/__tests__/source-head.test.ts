/**
 * social pilot 02a T11 — the framing layer's test contract, written ahead
 * of T12's real `SourceHead.tsx`. See that file's own doc comment (and
 * `source-head-layout.ts`) for the numbers this suite asserts against.
 *
 * Four claims, matching the T11 task description verbatim:
 *
 *   1. The running head is FIXED — pixel-identical at every wall frame
 *      while the block scrolls beneath it. Proven by rendering actual
 *      frames through `fixtures/source-head-harness.tsx` and diffing PNGs
 *      (never by inspecting props/styles) — see "fixed across wall frames"
 *      below.
 *   2. The payoff label sits in the SAME POSITION as the running head —
 *      same slot, different text. Proven the same way: two renders that
 *      differ only in `variant`, diffed.
 *   3. Neither collides with nor reflows the read-through counter — reuses
 *      `./pixel-proof.ts`, the machinery factored out of `counter.test.ts`
 *      for exactly this ("retarget `counter.test.ts`'s pixel-level proof").
 *   4. Both variants render in DM Sans + `SECONDARY`, never `SERIF_STACK`
 *      and never an `ACCENTS` colour — a source-guard block mirroring
 *      `counter.test.ts`'s own, asserted against the real exported
 *      constants, not hand-copied literals.
 *
 * Acceptance (T11): every render-level assertion below fails against
 * `SourceHead.tsx`'s current throwing stub. T12 replaces that stub; this
 * file does not change.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';

import {
	formatRunningHead,
	PAYOFF_LABEL_TEXT,
	SOURCE_HEAD_FONT_STACK,
	type RunningHeadCardMetadata,
	type SourceHeadVariant
} from '../SourceHead.js';
import { SOURCE_HEAD_BOUNDING_BOX } from '../source-head-layout.js';
import { COUNTER_BOUNDING_BOX } from '../counter-layout.js';
import { COUNTER_FONT_STACK } from '../Counter.js';
import { SERIF_STACK } from '../Wall.js';
import { ACCENTS, type AuthorSlug } from '../../render/theme.js';
import { renderFrameAsPng, assertIdenticalOutsideBoxes, assertBoxDiffers, assertBoxIdentical } from './pixel-proof.js';
import type { SourceHeadHarnessProps } from './fixtures/source-head-harness.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
const outputDir = path.join(repoRoot, 'content', 'output');

// ---------------------------------------------------------------------------
// Fixtures — three real cards spanning every `source_reference` shape the
// corpus actually uses (see `scripts/lib/validate.ts`'s own comment:
// `"Meditations, Book 5, Section 16"` vs `"Discourses, About Cynicism"`),
// plus a third, section-only shape (`"On the Shortness of Life, Section 1"`)
// neither of those two examples covers — so `formatRunningHead` is proven
// against the corpus's real variety, not one hand-picked shape.
// ---------------------------------------------------------------------------

function loadCard(bookSlug: string, chapterFile: string): RunningHeadCardMetadata & { id: string } {
	const chapter = JSON.parse(readFileSync(path.join(outputDir, bookSlug, chapterFile), 'utf-8')) as Array<{
		id: string;
		author_slug: AuthorSlug;
		source_reference: string;
	}>;
	const card = chapter[0];
	if (!card) {
		throw new Error(`Fixture chapter ${bookSlug}/${chapterFile} is empty`);
	}
	return { id: card.id, author_slug: card.author_slug, source_reference: card.source_reference };
}

// "Meditations, Book 2, Section 1" — three comma-separated parts (title,
// chapter, section). This is the plan's OWN worked example: T12's
// acceptance is literally the string "MARCUS AURELIUS · MEDITATIONS, BOOK 2".
const MARCUS_CARD = loadCard('meditations', 'book-02.json');

// "The Enchiridion, Section 1" — two parts, no separate chapter/book number.
const EPICTETUS_CARD = loadCard('enchiridion', 'section-01.json');

// "On the Shortness of Life, Section 1" — two parts, a multi-word title.
const SENECA_CARD = loadCard('shortness-of-life', 'section-01.json');

// ---------------------------------------------------------------------------
// Unit-level: `formatRunningHead` is a pure derivation from real card
// fields, never a hardcoded string.
// ---------------------------------------------------------------------------

describe('formatRunningHead — derived from card metadata, never hardcoded', () => {
	it('matches the plan\'s own worked example verbatim for a real Marcus Aurelius card', () => {
		expect(formatRunningHead(MARCUS_CARD)).toBe('MARCUS AURELIUS · MEDITATIONS, BOOK 2');
	});

	it('drops the trailing ", Section N" clause but keeps the book/chapter part', () => {
		expect(formatRunningHead(MARCUS_CARD)).not.toMatch(/SECTION/);
	});

	it('handles a source_reference with no separate chapter number (just title + section)', () => {
		expect(formatRunningHead(EPICTETUS_CARD)).toBe('EPICTETUS · THE ENCHIRIDION');
	});

	it('handles a multi-word book title', () => {
		expect(formatRunningHead(SENECA_CARD)).toBe('SENECA · ON THE SHORTNESS OF LIFE');
	});

	it('two different cards produce two different heads — proof this is derived, not a constant', () => {
		const marcus = formatRunningHead(MARCUS_CARD);
		const epictetus = formatRunningHead(EPICTETUS_CARD);
		const seneca = formatRunningHead(SENECA_CARD);
		expect(new Set([marcus, epictetus, seneca]).size).toBe(3);
	});

	it('never mentions "Plain" (the product) — the running head names the BOOK, never the app (no watermark)', () => {
		expect(formatRunningHead(MARCUS_CARD).toLowerCase()).not.toContain('plain');
	});
});

// ---------------------------------------------------------------------------
// Source-level: reads as a page header, not display type or branding — same
// pattern as `counter.test.ts`'s own source-guard block, asserted against
// the real exported constants rather than hand-copied literals.
// ---------------------------------------------------------------------------

function stripComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('source guard — DM Sans + secondary ink, never SERIF_STACK, never an accent', () => {
	const rawSource = readFileSync(path.join(moduleDir, '..', 'SourceHead.tsx'), 'utf-8');
	const renderableSource = stripComments(rawSource).toLowerCase();

	it('never imports or references SERIF_STACK — reserved for the author\'s own quoted words', () => {
		expect(renderableSource).not.toMatch(/serif_stack/);
	});

	it('never imports or references ACCENTS in code — no author accent colour anywhere renderable', () => {
		expect(renderableSource).not.toMatch(/accents/);
	});

	for (const [author, hex] of Object.entries(ACCENTS)) {
		it(`never hardcodes the ${author} accent hex in code`, () => {
			expect(renderableSource).not.toContain(hex.toLowerCase());
		});
	}

	it('renders in SECONDARY, not INK — framing text recedes rather than competing with the payoff', () => {
		expect(renderableSource).toMatch(/color:\s*secondary/);
		expect(renderableSource).not.toMatch(/color:\s*ink\b/);
	});

	it('uses the DM Sans stack (SOURCE_HEAD_FONT_STACK), not a second hand-copied literal', () => {
		expect(renderableSource).toMatch(/fontfamily:\s*source_head_font_stack/);
	});

	it('SOURCE_HEAD_FONT_STACK is byte-identical to COUNTER_FONT_STACK — one DM Sans family, not two literals that could drift', () => {
		expect(SOURCE_HEAD_FONT_STACK).toBe(COUNTER_FONT_STACK);
	});

	it('SOURCE_HEAD_FONT_STACK never equals SERIF_STACK', () => {
		expect(SOURCE_HEAD_FONT_STACK).not.toBe(SERIF_STACK);
	});

	it('imports no URL/href/link — no clickable or printed URL (no watermark)', () => {
		expect(renderableSource).not.toMatch(/\bhref\b/);
		expect(renderableSource).not.toMatch(/\burl\(/);
	});

	it('calls no Remotion timing primitive — ZERO MOTION, structurally, same discipline as Counter.tsx', () => {
		expect(renderableSource).not.toMatch(/usecurrentframe/);
		expect(renderableSource).not.toMatch(/interpolate\s*\(/);
		expect(renderableSource).not.toMatch(/\bspring\s*\(/);
		expect(renderableSource).not.toMatch(/transition/);
		expect(renderableSource).not.toMatch(/animation/);
	});

	it('takes no frame prop on SourceHeadProps — it cannot vary its own output across frames', () => {
		expect(renderableSource).not.toMatch(/frame\s*:/);
	});

	it('PAYOFF_LABEL_TEXT is never attributed to the author — no possessive, no "he/she said"', () => {
		expect(PAYOFF_LABEL_TEXT.toLowerCase()).not.toMatch(/\bhe\b|\bshe\b|\bsaid\b|'s\b/);
	});
});

// ---------------------------------------------------------------------------
// End-to-end: fixed position, same slot for both variants, and no collision
// with the read-through counter — proven by rendering real frames, per the
// T11 task's explicit instruction ("not by inspecting props").
// ---------------------------------------------------------------------------

let bundleDir: string;
let bundleLocation: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-test-bundle-'));
	bundleLocation = await bundle({
		entryPoint: path.join(moduleDir, 'fixtures', 'source-head-entry.tsx'),
		outDir: bundleDir,
		webpackOverride: (config) => ({
			...config,
			resolve: {
				...config.resolve,
				extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
			}
		})
	});
}, 120_000);

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});

// A long-ish excerpt (real archaic text, not lorem ipsum) so the scrolling
// wall behind the running head genuinely travels several hundred px between
// the two sampled frames below. Every card in the chapter, concatenated
// once — same "chapter block" idea `render/chapter-text.ts` builds for the
// real Wall, just assembled locally so this harness has no dependency on
// that module's own file-reading logic.
function loadChapterOriginalExcerpts(bookSlug: string, chapterFile: string): string {
	const chapter = JSON.parse(
		readFileSync(path.join(outputDir, bookSlug, chapterFile), 'utf-8')
	) as Array<{ original_excerpt: string }>;
	return Array(6).fill(chapter.map((c) => c.original_excerpt).join(' ')).join(' ');
}

const HARNESS_WALL_TEXT = loadChapterOriginalExcerpts('meditations', 'book-02.json');

const RUNNING_HEAD_VARIANT: SourceHeadVariant = { kind: 'running-head', card: MARCUS_CARD };
const PAYOFF_VARIANT: SourceHeadVariant = { kind: 'payoff' };

function harnessProps(overrides: Partial<SourceHeadHarnessProps>): SourceHeadHarnessProps {
	return {
		wallText: HARNESS_WALL_TEXT,
		counter: null,
		sourceHead: null,
		...overrides
	};
}

describe('running head is fixed at every wall frame', () => {
	it(
		'renders pixel-identical inside the source-head box at frame 0 and a later mid-scroll frame, while the wall text outside every framing box genuinely moves',
		async () => {
			const props = harnessProps({ sourceHead: RUNNING_HEAD_VARIANT });
			const frame0 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 0);
			const frame90 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 90);

			expect(frame0.png.width).toBe(1080);
			expect(frame0.png.height).toBe(1920);

			// The running head's own box must be byte-identical across frames —
			// the fixed, non-scrolling claim, made mechanical.
			assertBoxIdentical(frame0.png, frame90.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'the wall text actually moved between those two frames (the fixed-head proof above is not trivially true because nothing moved)',
		async () => {
			const props = harnessProps({ sourceHead: RUNNING_HEAD_VARIANT });
			const frame0 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 0);
			const frame90 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 90);

			expect(() => assertIdenticalOutsideBoxes(frame0.png, frame90.png, [SOURCE_HEAD_BOUNDING_BOX])).toThrow();
		},
		120_000
	);
});

describe('payoff label sits in the same position as the running head', () => {
	it(
		'the running-head and payoff variants render pixel-identical OUTSIDE the source-head box, and differ INSIDE it — same slot, different text',
		async () => {
			const runningHeadProps = harnessProps({ sourceHead: RUNNING_HEAD_VARIANT });
			const payoffProps = harnessProps({ sourceHead: PAYOFF_VARIANT });

			const withRunningHead = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', runningHeadProps, 0);
			const withPayoff = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', payoffProps, 0);

			assertIdenticalOutsideBoxes(withRunningHead.png, withPayoff.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(withRunningHead.png, withPayoff.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);
});

describe('neither the running head nor the payoff label collides with or reflows the read-through counter', () => {
	const COUNTER_LABEL = 'Card 5 of 48';

	it(
		'source head alone draws only inside its own box, and does not reflow anything the counter would occupy',
		async () => {
			const withoutEither = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', harnessProps({}), 0);
			const withHeadOnly = await renderFrameAsPng(
				bundleLocation,
				'SourceHeadHarness',
				harnessProps({ sourceHead: RUNNING_HEAD_VARIANT }),
				0
			);

			assertIdenticalOutsideBoxes(withoutEither.png, withHeadOnly.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(withoutEither.png, withHeadOnly.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'counter and source head together: each draws only inside its own box, neither reflows the other, both still visible',
		async () => {
			const neither = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', harnessProps({}), 0);
			const counterOnly = await renderFrameAsPng(
				bundleLocation,
				'SourceHeadHarness',
				harnessProps({ counter: COUNTER_LABEL }),
				0
			);
			const both = await renderFrameAsPng(
				bundleLocation,
				'SourceHeadHarness',
				harnessProps({ counter: COUNTER_LABEL, sourceHead: RUNNING_HEAD_VARIANT }),
				0
			);

			// Adding the source head to a counter-only render changes nothing
			// outside the source head's own box — in particular, nothing INSIDE
			// the counter's box (COUNTER_BOUNDING_BOX sits entirely outside
			// SOURCE_HEAD_BOUNDING_BOX, so this one check already covers both).
			assertIdenticalOutsideBoxes(counterOnly.png, both.png, [SOURCE_HEAD_BOUNDING_BOX]);
			// And, checked directly rather than only implied: the counter box's
			// own pixels are byte-identical whether or not the source head is
			// also present. (Fixed 2026-08-26, T12: the original line here was
			// `assertIdenticalOutsideBoxes(counterOnly.png, both.png,
			// [COUNTER_BOUNDING_BOX])`, which asserts the opposite of what this
			// comment says and of what T12's own acceptance requires — it
			// demands every pixel OUTSIDE the counter's box be identical between
			// `counterOnly` and `both`, but `both` legitimately differs from
			// `counterOnly` inside SOURCE_HEAD_BOUNDING_BOX (that's the whole
			// point of adding the source head) and SOURCE_HEAD_BOUNDING_BOX sits
			// entirely outside COUNTER_BOUNDING_BOX — so that assertion could
			// never pass for any real SourceHead implementation, and directly
			// contradicts `assertBoxDiffers(neither.png, both.png,
			// SOURCE_HEAD_BOUNDING_BOX)` four lines below in this same test.
			// `assertBoxIdentical`, scoped to just the counter's own box, is what
			// the comment actually describes.)
			assertBoxIdentical(counterOnly.png, both.png, COUNTER_BOUNDING_BOX);

			// Both overlays are genuinely present and visible in the combined render.
			assertBoxDiffers(neither.png, both.png, COUNTER_BOUNDING_BOX);
			assertBoxDiffers(neither.png, both.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it('the two boxes are non-overlapping by construction (geometry alone, no render needed)', () => {
		const headTop = SOURCE_HEAD_BOUNDING_BOX.top;
		const counterBottom = COUNTER_BOUNDING_BOX.top + COUNTER_BOUNDING_BOX.height;
		expect(headTop).toBeGreaterThanOrEqual(counterBottom);
	});
});
