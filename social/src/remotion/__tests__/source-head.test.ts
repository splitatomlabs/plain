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
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { chromium, type Browser } from 'playwright';

import {
	formatRunningHead,
	PAYOFF_LABEL_TEXT,
	SOURCE_HEAD_FONT_STACK,
	type RunningHeadCardMetadata,
	type SourceHeadVariant
} from '../SourceHead.js';
import {
	SOURCE_HEAD_BOUNDING_BOX,
	SOURCE_HEAD_FONT_SIZE_PX,
	SOURCE_HEAD_PAYOFF_FONT_SIZE_PX,
	SOURCE_HEAD_SAFE_INSET_PX,
	SOURCE_HEAD_TEXT_MAX_WIDTH_PX,
	SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX
} from '../source-head-layout.js';
import { COUNTER_BOUNDING_BOX } from '../counter-layout.js';
import { COUNTER_FONT_STACK } from '../Counter.js';
import { SERIF_STACK } from '../Wall.js';
import { PAYOFF_MIN_FONT } from '../wall-timing.js';
import { ACCENTS, type AuthorSlug } from '../../render/theme.js';
import { getFontCss } from '../../render/fonts.js';
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

// social pilot 02a R04 (2026-08-26): the single longest real
// `formatRunningHead` output in the whole corpus (135 chars, verified by
// scanning every chapter file in `content/output/` — see the sweep further
// below) — Epictetus's Discourses use full descriptive chapter titles
// rather than book/section numbers, so this is a genuine, not
// worst-case-imagined, card. Renders to:
// "EPICTETUS · DISCOURSES, THAT WHEN WE CANNOT FULFIL THAT WHICH THE
// CHARACTER OF A MAN PROMISES, WE ASSUME THE CHARACTER OF A PHILOSOPHER"
const LONGEST_DISCOURSES_CARD = loadCard(
	'discourses',
	'that-when-we-cannot-fulfil-that-which-the-character-of-a-man-promises-we-assume-the-character-of-a-philosopher.json'
);

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

// ---------------------------------------------------------------------------
// R04 (2026-08-26): the running head must stay inside SOURCE_HEAD_BOUNDING_BOX
// for EVERY card in the corpus, not just the short Meditations/Seneca-shaped
// `source_reference` values T11/T12 were written against. Epictetus's
// Discourses use full descriptive chapter titles (up to 135 chars) that, at
// SOURCE_HEAD_FONT_SIZE_PX, would wrap to 3-4 lines and spill outside the
// fixed 120px plate — directly over the scrolling wall — before
// `SourceHead.tsx`'s single-line clamp existed. Two proofs, at two different
// levels:
//
//   1. A real Remotion pixel-render, through the SAME harness/pixel-proof
//      machinery every other end-to-end test above uses, against the single
//      longest real `source_reference` in the corpus — literal "rendered
//      ink stays inside the bounding box" proof for the worst real case.
//   2. A fast, real-Chromium-DOM-measurement sweep (via Playwright directly,
//      the same technique `render/card.ts` already uses for its own
//      overflow check) across EVERY distinct real running head string
//      `formatRunningHead` actually produces from `content/output/` — 83
//      distinct book/chapter-level heads as of this writing (fewer than the
//      690+ distinct author+source_reference pairs, since the section-level
//      detail is dropped). A full Remotion video-frame render per string
//      would be needlessly slow for a test suite (~400ms each); this sweep
//      gets the same real-font, real-layout-engine confidence in a couple of
//      seconds by measuring the clamped span's own
//      `getBoundingClientRect()` directly, reusing the exact geometry
//      constants (`SOURCE_HEAD_TEXT_MAX_WIDTH_PX`, `SOURCE_HEAD_FONT_SIZE_PX`,
//      `SOURCE_HEAD_SAFE_INSET_PX`, `SOURCE_HEAD_FONT_STACK`) and font CSS
//      (`getFontCss`, the same base64-embedded DM Sans `card.ts` and the
//      Remotion bundle both already render from) the real component uses.
// ---------------------------------------------------------------------------

describe('the running head clamp stays inside the bounding box for the longest real card', () => {
	it(
		'the longest real Discourses running head (135 chars) draws only inside SOURCE_HEAD_BOUNDING_BOX, never outside it',
		async () => {
			const longHeadVariant: SourceHeadVariant = { kind: 'running-head', card: LONGEST_DISCOURSES_CARD };
			const withoutHead = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', harnessProps({}), 0);
			const withLongHead = await renderFrameAsPng(
				bundleLocation,
				'SourceHeadHarness',
				harnessProps({ sourceHead: longHeadVariant }),
				0
			);

			// The 135-char head does draw something (it isn't silently dropped)...
			assertBoxDiffers(withoutHead.png, withLongHead.png, SOURCE_HEAD_BOUNDING_BOX);
			// ...and every pixel it draws is INSIDE the box — if the un-clamped
			// 4-line wrap this test guards against were still happening, this
			// assertion would fail because the wall text below/around the box
			// would be painted over.
			assertIdenticalOutsideBoxes(withoutHead.png, withLongHead.png, [SOURCE_HEAD_BOUNDING_BOX]);
		},
		120_000
	);

	// Regression guard for the plan's own worked example (37 chars, well
	// under the clamp — `SOURCE_HEAD_TEXT_MAX_WIDTH_PX` is deliberately sized
	// to reproduce the exact content width this text already had, see that
	// constant's own doc comment): NOT re-tested here, because it already is
	// — verbatim, unmodified by R04 — by "source head alone draws only
	// inside its own box" in the collision describe block above, which uses
	// this exact same `RUNNING_HEAD_VARIANT`/`MARCUS_CARD`. A second render
	// of the identical case here would only duplicate that proof, not add to
	// it.
});

describe('the running head clamp holds for every distinct card in the corpus (real Chromium + real DM Sans)', () => {
	const repoRootForCorpus = path.resolve(moduleDir, '..', '..', '..', '..');
	const outputDirForCorpus = path.join(repoRootForCorpus, 'content', 'output');

	// Every distinct (author_slug, source_reference) pair across every book's
	// every chapter file — not just the three hand-picked fixtures above, and
	// not just Discourses, so a future book with its own long-title shape is
	// covered by the same sweep without anyone remembering to add a new case.
	function collectCorpusRunningHeads(): string[] {
		const heads = new Set<string>();
		for (const bookSlug of readdirSync(outputDirForCorpus)) {
			const bookDir = path.join(outputDirForCorpus, bookSlug);
			if (!statSync(bookDir).isDirectory()) continue;
			for (const chapterFile of readdirSync(bookDir)) {
				if (!chapterFile.endsWith('.json') || chapterFile === '_meta.json') continue;
				const cards = JSON.parse(readFileSync(path.join(bookDir, chapterFile), 'utf-8')) as Array<{
					author_slug: AuthorSlug;
					source_reference: string;
				}>;
				for (const card of cards) {
					heads.add(formatRunningHead(card));
				}
			}
		}
		return Array.from(heads);
	}

	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser.close();
	});

	it(
		'every distinct running head string in the corpus renders with its clamped span ending at or before the plate\'s right edge',
		async () => {
			const heads = collectCorpusRunningHeads();
			// Sanity on the sweep itself — if this ever collapses to a handful of
			// strings, the sweep below would be trivially true for the wrong
			// reason (e.g. a loader bug silently reading zero cards). Distinct
			// STRINGS, not distinct cards: `formatRunningHead` drops the
			// section-level detail, so many of the corpus's 1600+ cards (and
			// 690+ distinct author+source_reference pairs) collapse onto the
			// same book/chapter-level head — 83, as of this writing, across all
			// seven books.
			expect(heads.length).toBeGreaterThan(50);
			expect(heads.some((h) => h.length > 110)).toBe(true);

			const fontCss = await getFontCss();
			const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
			try {
				// Mirrors SourceHead.tsx's own plate + span structure and inline
				// styles exactly (see that file), so this is a faithful measurement
				// of the real component's geometry, not an approximation of it.
				await page.setContent(`
					<style>${fontCss}</style>
					<div style="position:absolute;top:${SOURCE_HEAD_BOUNDING_BOX.top}px;left:${SOURCE_HEAD_BOUNDING_BOX.left}px;width:${SOURCE_HEAD_BOUNDING_BOX.width}px;height:${SOURCE_HEAD_BOUNDING_BOX.height}px;display:flex;align-items:center;">
						<span id="probe" style="display:block;min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;padding-bottom:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_FONT_SIZE_PX}px;line-height:1;letter-spacing:0.02em;margin:0;"></span>
					</div>
				`);

				const rightEdges = await page.evaluate((allHeads: string[]) => {
					const probe = document.getElementById('probe') as HTMLSpanElement;
					return allHeads.map((text) => {
						probe.textContent = text;
						return probe.getBoundingClientRect().right;
					});
				}, heads);

				const plateRightEdge = SOURCE_HEAD_BOUNDING_BOX.left + SOURCE_HEAD_BOUNDING_BOX.width;
				const offenders: Array<{ head: string; right: number }> = [];
				heads.forEach((head, i) => {
					const right = rightEdges[i];
					if (right === undefined || right > plateRightEdge) {
						offenders.push({ head, right: right ?? NaN });
					}
				});

				expect(offenders).toEqual([]);
			} finally {
				await page.close();
			}
		},
		120_000
	);
});

// ---------------------------------------------------------------------------
// R07 (2026-08-26): the corpus sweep above proves the HORIZONTAL clamp
// (`getBoundingClientRect().right`) never spills past the plate's right
// edge — but `overflow: hidden` clips on both axes, and nothing above
// measures the VERTICAL one. At the payoff label's own font size with
// `lineHeight: 1`, DM Sans' line box is shorter than its own glyph content
// area (ascent+descent), so the clip flat-cut the descenders ("p", "g") of
// `PAYOFF_LABEL_TEXT` ("In plain English") on every payoff-phase frame of
// Wall/Question/Objection — invisible on the ALL-CAPS running head
// (`formatRunningHead` uppercases everything, so it has no descenders),
// which is exactly why the sweep above stayed green through R04.
//
// U03 (2026-08-27): the payoff label's font size changed from
// `SOURCE_HEAD_FONT_SIZE_PX` (32px, shared with the running head) to its own
// `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px) — this probe now measures at THAT
// size, not the running head's, since it's the payoff span this describe
// block is about. Re-verifying at the new size (not assuming R07's fix still
// holds) is the whole point of this task's vertical-clearance check.
//
// Same real-Chromium-DOM-measurement technique as the horizontal sweep
// (`getBoundingClientRect()` there, `scrollHeight`/`clientHeight` here —
// both real-layout-engine measurements of the exact clamped span, not an
// approximation), but reused as a witness pair rather than a scan: first
// proves the probe itself can DETECT the clip (mirroring the pre-R07 span,
// with zero vertical padding, and showing its `scrollHeight` genuinely
// exceeds its `clientHeight` for the real payoff text) — the same
// discipline the "wall text actually moved" test above uses to prove a
// pixel-identical result isn't trivially true — then proves the real,
// current component's own span (with `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`)
// no longer does.
// ---------------------------------------------------------------------------

describe('the payoff label\'s vertical ink extent stays inside the clamped span (real Chromium + real DM Sans)', () => {
	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser.close();
	});

	async function measurePayoffSpan(verticalPaddingPx: number): Promise<{ scrollHeight: number; clientHeight: number }> {
		const fontCss = await getFontCss();
		const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
		try {
			// Same plate + span structure and inline styles as SourceHead.tsx
			// (see that file and the corpus sweep above), with the vertical
			// padding parameterised so this helper can render both the
			// pre-R07 span (0px — the shape the bug shipped with) and the
			// real, current component's span (`SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`).
			// Font size is `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (U03) — this is
			// the payoff span, which no longer shares a size with the running
			// head.
			await page.setContent(`
				<style>${fontCss}</style>
				<div style="position:absolute;top:${SOURCE_HEAD_BOUNDING_BOX.top}px;left:${SOURCE_HEAD_BOUNDING_BOX.left}px;width:${SOURCE_HEAD_BOUNDING_BOX.width}px;height:${SOURCE_HEAD_BOUNDING_BOX.height}px;display:flex;align-items:center;">
					<span id="probe" style="display:block;min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${verticalPaddingPx}px;padding-bottom:${verticalPaddingPx}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_PAYOFF_FONT_SIZE_PX}px;line-height:1;letter-spacing:0.02em;margin:0;">${PAYOFF_LABEL_TEXT}</span>
				</div>
			`);

			return await page.evaluate(() => {
				const probe = document.getElementById('probe') as HTMLSpanElement;
				return { scrollHeight: probe.scrollHeight, clientHeight: probe.clientHeight };
			});
		} finally {
			await page.close();
		}
	}

	it(
		'witness: the probe itself detects the clip — a span with zero vertical padding (the pre-R07 shape) has scrollHeight strictly greater than clientHeight for the real payoff text at SOURCE_HEAD_PAYOFF_FONT_SIZE_PX, proving descenders were being cut at this size too, not that the probe is vacuously blind to the bug',
		async () => {
			const { scrollHeight, clientHeight } = await measurePayoffSpan(0);
			expect(scrollHeight).toBeGreaterThan(clientHeight);
		},
		60_000
	);

	it(
		'fix: the real component\'s own span (SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX) never lets scrollHeight exceed clientHeight for the payoff text at SOURCE_HEAD_PAYOFF_FONT_SIZE_PX (38px) — no vertical clip, descenders included, re-verified at the new U03 size rather than assumed',
		async () => {
			const { scrollHeight, clientHeight } = await measurePayoffSpan(SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX);
			expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
		},
		60_000
	);
});

// ---------------------------------------------------------------------------
// U03 (2026-08-27): raises the payoff label from SOURCE_HEAD_FONT_SIZE_PX
// (32px, previously shared with the running head) to its own
// SOURCE_HEAD_PAYOFF_FONT_SIZE_PX (38px) — user feedback asked whether "In
// plain English" should read larger; the answer was yes, modestly, and only
// for the payoff label. Three claims:
//
//   1. The two constants really do differ (the split happened, this isn't
//      still one shared number under two names).
//   2. The payoff label stays clearly SUBORDINATE to the payoff sentence
//      (T10's PAYOFF_MIN_FONT/PAYOFF_MAX_FONT, 52-88px) — the whole reason
//      T10 exists is to guarantee the payoff sentence is the largest thing
//      on screen, and this task must not erode that.
//   3. R04's horizontal clamp still holds for the payoff label specifically
//      at its new, larger size — re-measured here (real Chromium + real DM
//      Sans, same technique as the running-head corpus sweep above), not
//      assumed just because "In plain English" is short.
// ---------------------------------------------------------------------------

describe('U03 — the payoff label reads larger than the running head, but stays subordinate to the payoff sentence', () => {
	it('SOURCE_HEAD_PAYOFF_FONT_SIZE_PX is strictly larger than SOURCE_HEAD_FONT_SIZE_PX — the running head is unchanged, only the payoff label grew', () => {
		expect(SOURCE_HEAD_PAYOFF_FONT_SIZE_PX).toBeGreaterThan(SOURCE_HEAD_FONT_SIZE_PX);
		expect(SOURCE_HEAD_FONT_SIZE_PX).toBe(32);
		expect(SOURCE_HEAD_PAYOFF_FONT_SIZE_PX).toBe(38);
	});

	it('the payoff label stays well under the payoff sentence\'s own minimum font size (PAYOFF_MIN_FONT) — T10\'s "payoff sentence is the largest thing on screen" invariant holds at the new size', () => {
		expect(SOURCE_HEAD_PAYOFF_FONT_SIZE_PX).toBeLessThan(PAYOFF_MIN_FONT);
	});

	it(
		'R04\'s horizontal clamp still holds for the payoff label at SOURCE_HEAD_PAYOFF_FONT_SIZE_PX (real Chromium + real DM Sans) — the clamped span\'s right edge stays at or before the plate\'s right edge',
		async () => {
			const fontCss = await getFontCss();
			const browser = await chromium.launch({ headless: true });
			try {
				const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
				try {
					await page.setContent(`
						<style>${fontCss}</style>
						<div style="position:absolute;top:${SOURCE_HEAD_BOUNDING_BOX.top}px;left:${SOURCE_HEAD_BOUNDING_BOX.left}px;width:${SOURCE_HEAD_BOUNDING_BOX.width}px;height:${SOURCE_HEAD_BOUNDING_BOX.height}px;display:flex;align-items:center;">
							<span id="probe" style="display:block;min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;padding-bottom:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_PAYOFF_FONT_SIZE_PX}px;line-height:1;letter-spacing:0.02em;margin:0;">${PAYOFF_LABEL_TEXT}</span>
						</div>
					`);

					const right = await page.evaluate(() => {
						const probe = document.getElementById('probe') as HTMLSpanElement;
						return probe.getBoundingClientRect().right;
					});

					const plateRightEdge = SOURCE_HEAD_BOUNDING_BOX.left + SOURCE_HEAD_BOUNDING_BOX.width;
					expect(right).toBeLessThanOrEqual(plateRightEdge);
				} finally {
					await page.close();
				}
			} finally {
				await browser.close();
			}
		},
		60_000
	);
});
