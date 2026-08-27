/**
 * social pilot 02a T11 — the framing layer's test contract, written ahead
 * of T12's real `SourceHead.tsx`. See that file's own doc comment (and
 * `source-head-layout.ts`) for the numbers this suite asserts against.
 *
 * Claims, matching the T11 task description:
 *
 *   1. The running head is FIXED — pixel-identical at every wall frame
 *      while the block scrolls beneath it. Proven by rendering actual
 *      frames through `fixtures/source-head-harness.tsx` and diffing PNGs
 *      (never by inspecting props/styles) — see "fixed across wall frames"
 *      below.
 *   2. The payoff label sits in the SAME POSITION as the running head —
 *      same slot, different text. Proven the same way: two renders that
 *      differ only in `variant`, diffed.
 *   3. Neither reflows anything else on screen — reuses `./pixel-proof.ts`,
 *      the shared no-reflow proof machinery.
 *   4. Both variants render in DM Sans + `SECONDARY`, never `SERIF_STACK`
 *      and never an `ACCENTS` colour — a source-guard block asserted
 *      against the real exported constants, not hand-copied literals.
 *
 * Pf39c2-social-pilot-02a D03 (2026-08-27): this suite used to also prove
 * the framing layer never collided with the read-through counter
 * (`Counter.tsx`/`counter-layout.ts`, deleted this task along with the
 * read-through it labeled — see D02/D03). That describe block is gone; the
 * "neither reflows" claim above now stands on its own.
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
import { renderToStaticMarkup } from 'react-dom/server';

import {
	formatRunningHead,
	PAYOFF_LABEL_TEXT,
	SourceHead,
	SOURCE_HEAD_FONT_STACK,
	type RunningHeadCardMetadata,
	type SourceHeadVariant
} from '../SourceHead.js';
import {
	SOURCE_HEAD_BOUNDING_BOX,
	SOURCE_HEAD_FONT_SIZE_PX,
	SOURCE_HEAD_LINE_HEIGHT_RATIO,
	SOURCE_HEAD_MAX_LINES,
	SOURCE_HEAD_PAYOFF_FONT_SIZE_PX,
	SOURCE_HEAD_SAFE_INSET_PX,
	SOURCE_HEAD_TEXT_MAX_WIDTH_PX,
	SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX
} from '../source-head-layout.js';
import { SERIF_STACK } from '../Wall.js';
import { FRAME_WIDTH, PAYOFF_MIN_FONT } from '../wall-timing.js';
import { ACCENTS, type AuthorSlug } from '../../render/theme.js';
import { getFontCss } from '../../render/fonts.js';
import {
	renderFrameAsPng,
	assertIdenticalOutsideBoxes,
	assertBoxDiffers,
	assertBoxIdentical,
	type PixelBox
} from './pixel-proof.js';
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
// Source-level: reads as a page header, not display type or branding —
// asserted against the real exported constants rather than hand-copied
// literals.
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

	it('SOURCE_HEAD_FONT_STACK never equals SERIF_STACK', () => {
		expect(SOURCE_HEAD_FONT_STACK).not.toBe(SERIF_STACK);
	});

	it('imports no URL/href/link — no clickable or printed URL (no watermark)', () => {
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

	it('takes no frame prop on SourceHeadProps — it cannot vary its own output across frames', () => {
		expect(renderableSource).not.toMatch(/frame\s*:/);
	});

	it('PAYOFF_LABEL_TEXT is never attributed to the author — no possessive, no "he/she said"', () => {
		expect(PAYOFF_LABEL_TEXT.toLowerCase()).not.toMatch(/\bhe\b|\bshe\b|\bsaid\b|'s\b/);
	});

	// Pf39c2-social-pilot-02a V08 (2026-08-27): the plate is now full-bleed
	// (SOURCE_HEAD_BOUNDING_BOX spans FRAME_WIDTH), so V05's all-four-sides
	// `border` shorthand is gone — a left/right hairline on an edge-to-edge
	// element has no "outside" pixel to separate it from, so it would read
	// as a stray line at the frame's own edge, not a plate outline. Only
	// `borderTop`/`borderBottom` remain, which still divide the plate from
	// real neighbouring content (bare frame above, the scrolling wall below).
	it('the plate\'s border is top/bottom only, never the all-sides shorthand or a left/right side — a vertical hairline on a full-bleed element is not a visible outline', () => {
		expect(renderableSource).toMatch(/bordertop:/);
		expect(renderableSource).toMatch(/borderbottom:/);
		expect(renderableSource).not.toMatch(/borderleft:/);
		expect(renderableSource).not.toMatch(/borderright:/);
		expect(renderableSource).not.toMatch(/[^-a-z]border:\s*`/);
	});

	it('the plate\'s boxShadow stays inset — the bottom edge still borders the actively scrolling, non-deterministic wall, so an outward shadow there would still break the no-reflow proof', () => {
		expect(renderableSource).toMatch(/boxshadow:\s*`inset/);
	});
});

// ---------------------------------------------------------------------------
// End-to-end: fixed position, same slot for both variants — proven by
// rendering real frames, per the T11 task's explicit instruction ("not by
// inspecting props").
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

// Pf39c2-social-pilot-02a D03 (2026-08-27): this describe block used to also
// prove the framing layer never collided with the read-through counter
// (`ReadThroughCounter`/`COUNTER_BOUNDING_BOX`) — U02's below-payoff-text
// placement, and before that the shared top-left corner both overlays used
// to occupy. D02 hardcoded the counter's only supplier
// (`RenderPlan.counter`) to `null`; D03 deletes `Counter.tsx`/
// `counter-layout.ts` outright, so there is no second overlay left to prove
// non-collision against. The one claim that survives — the source head
// alone doesn't reflow anything else on screen — is still worth proving
// directly, so it remains below, renamed.
describe('the running head does not reflow anything else on screen', () => {
	it(
		'source head alone draws only inside its own box, and does not reflow the scrolling wall behind it',
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
});

// ---------------------------------------------------------------------------
// Pf39c2-social-pilot-02a V08 (2026-08-27): before this task
// `SOURCE_HEAD_BOUNDING_BOX.width` was 900 on the 1080px frame, leaving a
// bare 180px strip down the frame's right edge at the plate's own vertical
// band — the wall's own scrolling text showed through it there, stranding
// orphaned fragments beside the plate rather than under it (see a real
// render of `wall-2026-09-03`, frame 0). This describe block proves the fix
// two ways: a geometry-level claim (the box really does span the whole
// frame now, and the text's own clamp did NOT silently grow alongside it),
// and a pixel-level regression guard (the specific strip that used to be
// bare frame is now part of the plate's own deterministic fill, using the
// OLD literal 900px boundary rather than the current constant, so this
// guard would still catch a future narrowing even if someone edited both
// this test and the constant together).
// ---------------------------------------------------------------------------

describe('V08 — the framing plate spans the full frame width, not a partial strip', () => {
	it('SOURCE_HEAD_BOUNDING_BOX starts at the frame\'s left edge and its right edge lands exactly at FRAME_WIDTH — a true edge-to-edge band, not a box with a bare margin on either side', () => {
		expect(SOURCE_HEAD_BOUNDING_BOX.left).toBe(0);
		expect(SOURCE_HEAD_BOUNDING_BOX.width).toBe(FRAME_WIDTH);
		expect(SOURCE_HEAD_BOUNDING_BOX.left + SOURCE_HEAD_BOUNDING_BOX.width).toBe(FRAME_WIDTH);
	});

	it('SOURCE_HEAD_TEXT_MAX_WIDTH_PX stays at its own pre-V08 absolute value (836) — the plate\'s FILL grew, but the TEXT\'s own wrap clamp must not, or V05\'s two-line wrap behaviour silently regresses', () => {
		expect(SOURCE_HEAD_TEXT_MAX_WIDTH_PX).toBe(836);
		// Explicitly NOT derived from the (now much wider) box — if it were,
		// this would be 1080 - 64 = 1016, not 836.
		expect(SOURCE_HEAD_TEXT_MAX_WIDTH_PX).not.toBe(SOURCE_HEAD_BOUNDING_BOX.width - SOURCE_HEAD_SAFE_INSET_PX);
	});

	it(
		'the strip that used to be bare frame (x in [900, 1080) at the plate\'s own vertical band) now renders pixel-identical across two different wall-scroll frames — it is inside the opaque plate now, not bare frame showing scrolling text through',
		async () => {
			const props = harnessProps({ sourceHead: RUNNING_HEAD_VARIANT });
			const frame0 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 0);
			const frame90 = await renderFrameAsPng(bundleLocation, 'SourceHeadHarness', props, 90);

			// Deliberately literal 900/180, NOT derived from
			// SOURCE_HEAD_BOUNDING_BOX — this is a regression guard for the
			// OLD box's own right-hand strip, so it must stay meaningful even
			// against a future edit that changes the constant again.
			const formerBareStrip: PixelBox = {
				top: SOURCE_HEAD_BOUNDING_BOX.top,
				left: 900,
				width: 180,
				height: SOURCE_HEAD_BOUNDING_BOX.height
			};
			assertBoxIdentical(frame0.png, frame90.png, formerBareStrip);
		},
		120_000
	);
});

// ---------------------------------------------------------------------------
// R04 (2026-08-26): the running head must stay inside SOURCE_HEAD_BOUNDING_BOX
// for EVERY card in the corpus, not just the short Meditations/Seneca-shaped
// `source_reference` values T11/T12 were written against. Epictetus's
// Discourses use full descriptive chapter titles (up to 135 chars) that, at
// SOURCE_HEAD_FONT_SIZE_PX, would wrap to 3-4 lines and spill outside the
// fixed plate — directly over the scrolling wall — before `SourceHead.tsx`'s
// clamp existed. Two proofs, at two different levels:
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
//
// Pf39c2-social-pilot-02a V05 (2026-08-27): the sweep below now also mirrors
// the real component's 2-line wrap (`display: '-webkit-box'` +
// `WebkitLineClamp: SOURCE_HEAD_MAX_LINES`), not R04's original single-line
// `whiteSpace: nowrap` shape. With genuine wrapping, a browser can never lay
// a line out wider than its own `max-width` — horizontal overflow is
// impossible by construction, not merely clamped — so the sweep's live
// assertion moves from "the rendered right edge never passes the plate's
// right edge" (R04, meaningful only because `nowrap` could otherwise render
// arbitrarily wide) to "the clamped span's own rendered box — both axes —
// never exceeds the plate", which is the axis genuinely at risk now that
// text can span two lines: a browser bug, a CSS typo, or a future edit that
// silently dropped `WebkitLineClamp` would show up here as a taller-than-
// expected box, exactly the regression this task fixes.
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
	//
	// V11 (Pf39c2-social-pilot-02a review fix, 2026-08-27): keyed by the
	// formatted head string but VALUED by a real card, not just a `Set` of
	// strings — this sweep now renders the ACTUAL `SourceHead` component
	// (below), which needs a real `RunningHeadCardMetadata` per distinct head
	// to render from, not just its already-formatted text.
	function collectCorpusRunningHeadCards(): Map<string, RunningHeadCardMetadata> {
		const cards = new Map<string, RunningHeadCardMetadata>();
		for (const bookSlug of readdirSync(outputDirForCorpus)) {
			const bookDir = path.join(outputDirForCorpus, bookSlug);
			if (!statSync(bookDir).isDirectory()) continue;
			for (const chapterFile of readdirSync(bookDir)) {
				if (!chapterFile.endsWith('.json') || chapterFile === '_meta.json') continue;
				const chapterCards = JSON.parse(readFileSync(path.join(bookDir, chapterFile), 'utf-8')) as Array<{
					author_slug: AuthorSlug;
					source_reference: string;
				}>;
				for (const card of chapterCards) {
					const head = formatRunningHead(card);
					if (!cards.has(head)) {
						cards.set(head, { author_slug: card.author_slug, source_reference: card.source_reference });
					}
				}
			}
		}
		return cards;
	}

	let browser: Browser;

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser.close();
	});

	it(
		'every distinct running head string in the corpus renders its clamped span fully inside the plate, on both axes, and at least one wraps to exactly 2 lines',
		async () => {
			const cardsByHead = collectCorpusRunningHeadCards();
			const heads = Array.from(cardsByHead.keys());
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
				// V11 (Pf39c2-social-pilot-02a review fix): renders the REAL
				// `SourceHead` component (`renderToStaticMarkup`) for every
				// distinct corpus head, wrapped in its own `data-probe-index`
				// container so each can be measured independently in a single
				// page load — NOT a hand-copied second span with the same style
				// literals typed out again in this test file. A hand-copied mirror
				// only stays faithful to `SourceHead.tsx` for as long as whoever
				// edits one remembers to edit the other; rendering the real
				// component means a future change to that file's own span (e.g.
				// reverting the 2-line wrap back to `nowrap`+ellipsis) shows up
				// here automatically, with no risk of the two drifting apart.
				// `AbsoluteFill`'s `position: absolute` sizes against the nearest
				// POSITIONED ancestor (or the viewport, if there is none) — the
				// wrapping `<div data-probe-index>` here is deliberately left
				// `position: static` (the default), so each of the 83 renders
				// still sizes itself against the full 1080x1920 viewport, exactly
				// as `SourceHead` does when it's the only thing mounted — the
				// heads happen to visually overlap on screen, but each span's own
				// `getBoundingClientRect()`/`clientHeight` is computed independent
				// of that, which is all this sweep measures.
				const markup = heads
					.map((head, i) => {
						const card = cardsByHead.get(head)!;
						const rendered = renderToStaticMarkup(
							SourceHead({ variant: { kind: 'running-head', card } })
						);
						return `<div data-probe-index="${i}">${rendered}</div>`;
					})
					.join('');
				await page.setContent(`<style>${fontCss}</style>${markup}`);

				const rects = await page.evaluate((count: number) => {
					const results: Array<{ right: number; bottom: number; clientHeight: number }> = [];
					for (let i = 0; i < count; i++) {
						const container = document.querySelector(`[data-probe-index="${i}"]`) as HTMLElement;
						const span = container.querySelector('span') as HTMLSpanElement;
						const rect = span.getBoundingClientRect();
						results.push({ right: rect.right, bottom: rect.bottom, clientHeight: span.clientHeight });
					}
					return results;
				}, heads.length);

				const plateRightEdge = SOURCE_HEAD_BOUNDING_BOX.left + SOURCE_HEAD_BOUNDING_BOX.width;
				const plateBottomEdge = SOURCE_HEAD_BOUNDING_BOX.top + SOURCE_HEAD_BOUNDING_BOX.height;
				const offenders: Array<{ head: string; right: number; bottom: number }> = [];
				heads.forEach((head, i) => {
					const rect = rects[i];
					if (!rect || rect.right > plateRightEdge || rect.bottom > plateBottomEdge) {
						offenders.push({ head, right: rect?.right ?? NaN, bottom: rect?.bottom ?? NaN });
					}
				});

				expect(offenders).toEqual([]);

				// V11 (Pf39c2-social-pilot-02a review fix): the box-geometry
				// assertion above ("fits inside the plate") is satisfiable by
				// EITHER a genuine 2-line wrap OR a reverted single-line
				// `nowrap`+ellipsis clamp — a one-line span is comfortably under
				// the plate's own height either way, so it cannot tell the two
				// apart. Assert the rendered LINE COUNT directly (rounded
				// `clientHeight`, minus the fixed vertical padding the real
				// component always applies, divided by one line's own pixel
				// height) — proof that at least one REAL corpus head, drawn
				// through the actual component, genuinely wraps to 2 lines.
				const renderedLines = (clientHeight: number): number =>
					Math.round(
						(clientHeight - 2 * SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX) /
							(SOURCE_HEAD_FONT_SIZE_PX * SOURCE_HEAD_LINE_HEIGHT_RATIO)
					);
				expect(heads.some((_, i) => renderedLines(rects[i]!.clientHeight) === 2)).toBe(true);
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
			// (see that file and the corpus sweep above, including its V05
			// `WebkitLineClamp` shape and `SOURCE_HEAD_LINE_HEIGHT_RATIO`), with
			// the vertical padding parameterised so this helper can render both
			// the pre-R07 span (0px — the shape the bug shipped with) and the
			// real, current component's span (`SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`).
			// Font size is `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (U03) — this is
			// the payoff span, which no longer shares a size with the running
			// head. `PAYOFF_LABEL_TEXT` never wraps to a second line regardless
			// of `WebkitLineClamp`'s 2-line ceiling (it measures well under the
			// horizontal budget — see the U03 describe block below), so this
			// remains a genuine single-line measurement.
			await page.setContent(`
				<style>${fontCss}</style>
				<div style="position:absolute;top:${SOURCE_HEAD_BOUNDING_BOX.top}px;left:${SOURCE_HEAD_BOUNDING_BOX.left}px;width:${SOURCE_HEAD_BOUNDING_BOX.width}px;height:${SOURCE_HEAD_BOUNDING_BOX.height}px;display:flex;align-items:center;">
					<span id="probe" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${SOURCE_HEAD_MAX_LINES};min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${verticalPaddingPx}px;padding-bottom:${verticalPaddingPx}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_PAYOFF_FONT_SIZE_PX}px;line-height:${SOURCE_HEAD_LINE_HEIGHT_RATIO};letter-spacing:0.02em;margin:0;">${PAYOFF_LABEL_TEXT}</span>
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
// Pf39c2-social-pilot-02a V05 (2026-08-27): the describe block above proves
// the payoff span's vertical clip is still guarded now that
// `SOURCE_HEAD_LINE_HEIGHT_RATIO` replaced the flat `lineHeight: 1` R07/U03
// measured against — but the payoff label never wraps, so it only exercises
// ONE line. The running head is the variant that can genuinely reach 2 lines
// now, and R07's original diagnosis (clip at the box's own OUTER top/bottom
// edge) generalizes to "the outer edge of the wrapped block", not just "one
// line's descenders" — this describe block is the same witness/fix
// discipline, applied to a real, naturally two-line-wrapping corpus string at
// the running head's own font size.
//
// V11 (Pf39c2-social-pilot-02a review fix, 2026-08-27): code review found
// that NONE of the assertions in this file — not the corpus sweep's
// `rect.right`/`rect.bottom` box check, not the 135-char "draws something,
// inside the box" test, not this describe block's own scrollHeight-vs-
// clientHeight witness/fix pair — actually distinguishes a genuine 2-line
// wrap from a reverted single-line `nowrap`+ellipsis clamp (R04's original
// shape, and the exact regression V05 fixed per direct user feedback: "it
// should wrap onto two lines if necessary, currently it truncates"). All of
// them stay green either way, because a one-line span is well within every
// box/scrollHeight bound a two-line span would also satisfy. `measureRunningHeadSpan`
// below now also returns the rendered LINE COUNT itself, and the corpus sweep
// above asserts a real corpus head renders as 2 lines — verified (per this
// task's own acceptance) to go red against a `nowrap`+`textOverflow: 'ellipsis'`
// revert of `SourceHead.tsx`'s span, then restored.
// ---------------------------------------------------------------------------

describe('the running head\'s 2-line wrapped block stays inside the clamped span (real Chromium + real DM Sans)', () => {
	let browser: Browser;

	// A real corpus string (the same Discourses chapter title used elsewhere
	// in this file, truncated to the clause that happens to wrap to EXACTLY 2
	// lines at SOURCE_HEAD_FONT_SIZE_PX/SOURCE_HEAD_TEXT_MAX_WIDTH_PX — verified
	// by direct measurement, not assumed) — genuinely two lines of real
	// content, not `WebkitLineClamp` truncating a longer string down to 2.
	const NATURAL_TWO_LINE_HEAD = 'EPICTETUS · DISCOURSES, THAT WHEN WE CANNOT FULFIL THAT WHICH THE';

	beforeAll(async () => {
		browser = await chromium.launch({ headless: true });
	}, 60_000);

	afterAll(async () => {
		await browser.close();
	});

	async function measureRunningHeadSpan(verticalPaddingPx: number): Promise<{ scrollHeight: number; clientHeight: number }> {
		const fontCss = await getFontCss();
		const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
		try {
			await page.setContent(`
				<style>${fontCss}</style>
				<div style="position:absolute;top:${SOURCE_HEAD_BOUNDING_BOX.top}px;left:${SOURCE_HEAD_BOUNDING_BOX.left}px;width:${SOURCE_HEAD_BOUNDING_BOX.width}px;height:${SOURCE_HEAD_BOUNDING_BOX.height}px;display:flex;align-items:center;">
					<span id="probe" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${SOURCE_HEAD_MAX_LINES};min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${verticalPaddingPx}px;padding-bottom:${verticalPaddingPx}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_FONT_SIZE_PX}px;line-height:${SOURCE_HEAD_LINE_HEIGHT_RATIO};letter-spacing:0.02em;margin:0;">${NATURAL_TWO_LINE_HEAD}</span>
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

	// V11 (Pf39c2-social-pilot-02a review fix): renders the REAL `SourceHead`
	// component (`renderToStaticMarkup`), not a second hand-copied span with
	// the same style literals typed out again — see the corpus sweep above
	// for why that distinction matters (a hand-copied mirror only stays
	// faithful to `SourceHead.tsx` for as long as someone remembers to keep
	// both in sync; this reads the real, current styles directly). Returns
	// the rendered LINE COUNT (`clientHeight`, minus the fixed vertical
	// padding the real component always applies, divided by one line's own
	// pixel height) — the property that actually distinguishes a genuine
	// 2-line wrap from a reverted single-line `nowrap`+ellipsis clamp, which
	// `measureRunningHeadSpan`'s own scrollHeight-vs-clientHeight witness/fix
	// pair above does NOT (a one-line span never scrolls past its own
	// clientHeight either).
	async function measureRealRunningHeadLines(card: RunningHeadCardMetadata): Promise<number> {
		const fontCss = await getFontCss();
		const markup = renderToStaticMarkup(SourceHead({ variant: { kind: 'running-head', card } }));
		const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
		try {
			await page.setContent(`<style>${fontCss}</style>${markup}`);
			return await page.evaluate(
				({ fontSize, lineHeightRatio, verticalPaddingPx }) => {
					const span = document.querySelector('span') as HTMLSpanElement;
					return Math.round((span.clientHeight - 2 * verticalPaddingPx) / (fontSize * lineHeightRatio));
				},
				{
					fontSize: SOURCE_HEAD_FONT_SIZE_PX,
					lineHeightRatio: SOURCE_HEAD_LINE_HEIGHT_RATIO,
					verticalPaddingPx: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX
				}
			);
		} finally {
			await page.close();
		}
	}

	// A synthetic card whose OWN `formatRunningHead` output is exactly
	// `NATURAL_TWO_LINE_HEAD` above (asserted in the test below, not just
	// assumed) — needed because rendering the REAL `SourceHead` component
	// takes a card, not raw text; `formatRunningHead` derives the head from
	// `author_slug`/`source_reference` exactly as any real corpus card would.
	const TWO_LINE_DISCOURSES_CARD: RunningHeadCardMetadata = {
		author_slug: 'epictetus',
		source_reference: 'Discourses, That When We Cannot Fulfil That Which The, Section 1'
	};

	it(
		'witness: a genuinely two-line real running head, with zero vertical padding, has scrollHeight strictly greater than clientHeight — the outer-edge clip R07 diagnosed for one line, reproduced for two',
		async () => {
			const { scrollHeight, clientHeight } = await measureRunningHeadSpan(0);
			expect(scrollHeight).toBeGreaterThan(clientHeight);
		},
		60_000
	);

	it(
		'fix: the real component\'s own padding (SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX) never lets scrollHeight exceed clientHeight for that same two-line running head at SOURCE_HEAD_FONT_SIZE_PX / SOURCE_HEAD_LINE_HEIGHT_RATIO',
		async () => {
			const { scrollHeight, clientHeight } = await measureRunningHeadSpan(SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX);
			expect(scrollHeight).toBeLessThanOrEqual(clientHeight);
		},
		60_000
	);

	// V11 (Pf39c2-social-pilot-02a review fix): the witness/fix pair above
	// proves the OUTER-edge clip is guarded, but a reverted single-line
	// `nowrap`+ellipsis span (R04's original shape) ALSO keeps
	// `scrollHeight <= clientHeight` — it never wraps in the first place, so
	// there is nothing for that padding to guard against, and both
	// assertions above stay green regardless. Assert the rendered LINE
	// COUNT directly, through the REAL `SourceHead` component (not the
	// hand-copied `#probe` span `measureRunningHeadSpan` above uses) — the
	// one property, measured against the real component, that actually
	// distinguishes "wraps to 2 lines" (current code) from "truncates to 1"
	// (the R04 regression this whole task guards against).
	it(
		'renders TWO_LINE_DISCOURSES_CARD (whose formatted head is NATURAL_TWO_LINE_HEAD) as exactly 2 lines through the ACTUAL SourceHead component — the property a nowrap+ellipsis regression would break',
		async () => {
			expect(formatRunningHead(TWO_LINE_DISCOURSES_CARD)).toBe(NATURAL_TWO_LINE_HEAD);
			const lines = await measureRealRunningHeadLines(TWO_LINE_DISCOURSES_CARD);
			expect(lines).toBe(2);
		},
		60_000
	);

	it(
		'renders the plan\'s own short worked example (MARCUS_CARD, "MARCUS AURELIUS · MEDITATIONS, BOOK 2") as exactly 1 line through the ACTUAL SourceHead component — proof the line-count assertion above is not vacuously true because every head renders as 2',
		async () => {
			const lines = await measureRealRunningHeadLines(MARCUS_CARD);
			expect(lines).toBe(1);
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
	it('SOURCE_HEAD_PAYOFF_FONT_SIZE_PX is strictly larger than SOURCE_HEAD_FONT_SIZE_PX — V05 raised the running head too (32px -> 36px), but the payoff label stays larger still', () => {
		expect(SOURCE_HEAD_PAYOFF_FONT_SIZE_PX).toBeGreaterThan(SOURCE_HEAD_FONT_SIZE_PX);
		expect(SOURCE_HEAD_FONT_SIZE_PX).toBe(36);
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
							<span id="probe" style="display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:${SOURCE_HEAD_MAX_LINES};min-width:0;max-width:${SOURCE_HEAD_TEXT_MAX_WIDTH_PX}px;overflow:hidden;text-overflow:ellipsis;padding-left:${SOURCE_HEAD_SAFE_INSET_PX}px;padding-top:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;padding-bottom:${SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX}px;font-family:${SOURCE_HEAD_FONT_STACK};font-weight:500;font-size:${SOURCE_HEAD_PAYOFF_FONT_SIZE_PX}px;line-height:${SOURCE_HEAD_LINE_HEIGHT_RATIO};letter-spacing:0.02em;margin:0;">${PAYOFF_LABEL_TEXT}</span>
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
