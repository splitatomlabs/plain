/**
 * social pilot 02a T13 — the framing layer, extended from Wall.tsx (T11/T12)
 * to Question.tsx, Objection.tsx and Still.tsx. See each composition's own
 * `sourceReference` doc comment for why each ends up with a DIFFERENT variant
 * contract:
 *
 *   - Question: two phases can carry framing, matching Wall's own
 *     head-then-label grammar — the RUNNING HEAD only while the moving
 *     archaic wall is genuinely on screen, the PAYOFF LABEL only once the
 *     answer resolves in stillness. The opening question-alone phase gets
 *     NEITHER (the question is neither the book's verbatim words nor the
 *     plain rewrite, so labeling it as either would not be factually true —
 *     Constraint 6).
 *   - Objection: NO archaic-wall phase exists at all, so a running head
 *     never renders in this format — there is no on-screen book text for it
 *     to truthfully name. Only the PAYOFF LABEL renders, only on the two
 *     still reply-line phases (the plain rewrite of the author's actual
 *     response). The opening objection-alone phase (the reader's own
 *     hypothetical thought) gets neither, for the same reason as Question's
 *     opening phase.
 *   - Still: the ENTIRE composition, from frame 0, already IS the plain
 *     rewrite (there is no earlier phase at all) — so the PAYOFF LABEL is
 *     correct for the whole duration. A running head never renders here
 *     either.
 *
 * Proven the same way `source-head.test.ts` proves Wall.tsx's own wiring:
 * real frames rendered through each format's real, production composition
 * (via `entry.tsx`/`Root.tsx`, never a test-only harness — unlike
 * `source-head.test.ts`, which predates T12's real `Wall.tsx` wiring and so
 * needed one), diffed with the shared `pixel-proof.ts` helpers. `SourceHead`
 * itself (fixed position, DM Sans, SECONDARY ink, zero motion, same slot for
 * both variants) is already exhaustively proven in `source-head.test.ts`;
 * this file only proves each of these three compositions calls it with the
 * right variant at the right frame, and never a wrong one.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';

import { computeQuestionTiming } from '../question-timing.js';
import { computeObjectionTiming } from '../objection-timing.js';
import { computeStillTiming } from '../still-timing.js';
import { resolveWallCardExcerpt, type WallPoolEntry } from '../wall-pool.js';
import { formatRunningHead } from '../SourceHead.js';
import { SOURCE_HEAD_BOUNDING_BOX } from '../source-head-layout.js';
import { renderFrameAsPng, assertIdenticalOutsideBoxes, assertBoxDiffers, assertBoxIdentical } from './pixel-proof.js';
import type { AuthorSlug } from '../../render/theme.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

let bundleDir: string;
let bundleLocation: string;

beforeAll(async () => {
	bundleDir = await mkdtemp(path.join(os.tmpdir(), 'plain-social-test-bundle-'));
	bundleLocation = await bundle({
		entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
		outDir: bundleDir,
		// Source imports use explicit `.js` extensions (NodeNext module
		// resolution), which point at the `.ts`/`.tsx` files webpack actually
		// needs to bundle — map that alias so webpack resolves them.
		webpackOverride: (config) => ({
			...config,
			resolve: {
				...config.resolve,
				extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
			}
		})
	});
}, 180_000);

afterAll(async () => {
	await rm(bundleDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Question — fixture reused verbatim from `question-timing.test.ts`
// (discourses-64-006, the pool's own passing entry).
// ---------------------------------------------------------------------------

const QUESTION_ENTRY: WallPoolEntry = { card_id: 'discourses-64-006', book_slug: 'discourses' };
const QUESTION_TEXT = 'You want me to trust you with my business?';
const QUESTION_ANSWER = "You're a man who has corrupted his own will.";
const QUESTION_AUTHOR: AuthorSlug = 'epictetus';
// The real card's own `source_reference` (content/output/discourses/
// against-or-to-those-who-readily-tell-their-own-affairs.json).
const QUESTION_SOURCE_REFERENCE = 'Discourses, Against or to Those Who Readily Tell Their Own Affairs';

describe('Question — the framing layer (social pilot 02a T13)', () => {
	const repoRoot = path.resolve(moduleDir, '..', '..', '..', '..');
	const outputDir = path.join(repoRoot, 'content', 'output');
	const originalExcerpt = resolveWallCardExcerpt(QUESTION_ENTRY, outputDir);
	const timing = computeQuestionTiming({ question: QUESTION_TEXT });

	function questionProps(withFraming: boolean): Record<string, unknown> {
		return {
			question: QUESTION_TEXT,
			answer: QUESTION_ANSWER,
			originalExcerpt,
			author: QUESTION_AUTHOR,
			...(withFraming ? { sourceReference: QUESTION_SOURCE_REFERENCE } : {})
		};
	}

	it(
		'renders NEITHER the running head nor the payoff label on the opening question-alone frame (frame 0) — the question is neither verbatim book text nor the plain rewrite',
		async () => {
			const without = await renderFrameAsPng(bundleLocation, 'Question', questionProps(false), 0);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Question', questionProps(true), 0);
			assertBoxIdentical(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'renders the RUNNING HEAD, with no reflow of the rest of the frame, once the archaic wall phase starts',
		async () => {
			const frame = timing.wall.startFrame;
			const without = await renderFrameAsPng(bundleLocation, 'Question', questionProps(false), frame);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Question', questionProps(true), frame);
			assertIdenticalOutsideBoxes(without.png, withFraming.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'renders the PAYOFF LABEL, with no reflow, once the plain answer resolves in stillness',
		async () => {
			const frame = timing.answer.startFrame;
			const without = await renderFrameAsPng(bundleLocation, 'Question', questionProps(false), frame);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Question', questionProps(true), frame);
			assertIdenticalOutsideBoxes(without.png, withFraming.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'the running head and the payoff label are genuinely different content in the same slot — proof this is the head->label grammar, not the same overlay twice',
		async () => {
			const runningHeadFrame = timing.wall.startFrame;
			const payoffFrame = timing.answer.startFrame;
			const runningHeadRender = await renderFrameAsPng(bundleLocation, 'Question', questionProps(true), runningHeadFrame);
			const payoffRender = await renderFrameAsPng(bundleLocation, 'Question', questionProps(true), payoffFrame);
			assertBoxDiffers(runningHeadRender.png, payoffRender.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it("formatRunningHead resolves this fixture's real card metadata to a real, non-empty running head (sanity, not a magic string)", () => {
		const head = formatRunningHead({ author_slug: QUESTION_AUTHOR, source_reference: QUESTION_SOURCE_REFERENCE });
		expect(head).toBe('EPICTETUS · DISCOURSES, AGAINST OR TO THOSE WHO READILY TELL THEIR OWN AFFAIRS');
	});
});

// ---------------------------------------------------------------------------
// Objection — fixture reused verbatim from `objection-timing.test.ts`
// (on-anger-03-079, the pool's own passing entry).
// ---------------------------------------------------------------------------

const OBJECTION_TEXT = "Shouldn't he be punished?";
const OBJECTION_REPLY =
	"He will be, even if you don't want him to be. The worst punishment for doing wrong is knowing that you did it. " +
	"No one suffers more than someone tortured by their own guilt. Besides, we should think about all of humanity " +
	"before we judge what happens in life. It's unfair to blame individuals for flaws that everyone has. A black " +
	"person's skin doesn't stand out among his own people. No man in Germany is ashamed of his red hair tied in a knot.";
const OBJECTION_AUTHOR: AuthorSlug = 'seneca';
// The real card's own `source_reference` (content/output/on-anger/book-3.json).
const OBJECTION_SOURCE_REFERENCE = 'On Anger, Book 3, Section 26';

describe('Objection — the framing layer (social pilot 02a T13)', () => {
	const timing = computeObjectionTiming();

	function objectionProps(withFraming: boolean): Record<string, unknown> {
		return {
			objection: OBJECTION_TEXT,
			reply: OBJECTION_REPLY,
			author: OBJECTION_AUTHOR,
			...(withFraming ? { sourceReference: OBJECTION_SOURCE_REFERENCE } : {})
		};
	}

	it(
		'renders NO framing at all on the opening objection-alone frame (frame 0) — a hypothetical reader thought, never attributed to the author',
		async () => {
			const without = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(false), 0);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(true), 0);
			assertBoxIdentical(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'renders the PAYOFF LABEL, with no reflow, on the first reply line',
		async () => {
			const frame = timing.replyLines[0].startFrame;
			const without = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(false), frame);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(true), frame);
			assertIdenticalOutsideBoxes(without.png, withFraming.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'renders the PAYOFF LABEL, with no reflow, on the second reply line too',
		async () => {
			const frame = timing.replyLines[1].startFrame;
			const without = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(false), frame);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Objection', objectionProps(true), frame);
			assertIdenticalOutsideBoxes(without.png, withFraming.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);
});

// ---------------------------------------------------------------------------
// Still — fixture reused verbatim from `still-timing.test.ts`
// (meditations-02-003, a real short read-through card).
// ---------------------------------------------------------------------------

const STILL_TEXT =
	'Just as you can imagine any conception you choose, so you can too. Adapt yourself to the things among which ' +
	'your lot has been cast, and love sincerely the people with whom fate has surrounded you.';
// The real card's own `source_reference` (content/output/meditations/book-02.json).
const STILL_SOURCE_REFERENCE = 'Meditations, Book 2, Section 3';

describe('Still — the framing layer (social pilot 02a T13)', () => {
	const timing = computeStillTiming();

	function stillProps(withFraming: boolean): Record<string, unknown> {
		return {
			text: STILL_TEXT,
			...(withFraming ? { sourceReference: STILL_SOURCE_REFERENCE } : {})
		};
	}

	it(
		'renders the PAYOFF LABEL, with no reflow, from frame 0 — the whole composition is already the plain rewrite',
		async () => {
			const without = await renderFrameAsPng(bundleLocation, 'Still', stillProps(false), 0);
			const withFraming = await renderFrameAsPng(bundleLocation, 'Still', stillProps(true), 0);
			assertIdenticalOutsideBoxes(without.png, withFraming.png, [SOURCE_HEAD_BOUNDING_BOX]);
			assertBoxDiffers(without.png, withFraming.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);

	it(
		'still renders the PAYOFF LABEL, identically, at a late frame — held for the whole duration, not just the opening',
		async () => {
			const lateFrame = timing.totalFrames - 1;
			const frame0 = await renderFrameAsPng(bundleLocation, 'Still', stillProps(true), 0);
			const lateRender = await renderFrameAsPng(bundleLocation, 'Still', stillProps(true), lateFrame);
			assertBoxIdentical(frame0.png, lateRender.png, SOURCE_HEAD_BOUNDING_BOX);
		},
		120_000
	);
});

// ---------------------------------------------------------------------------
// Source guard — Objection.tsx and Still.tsx never render the running-head
// variant at all (there is no on-screen book text in either format for it to
// truthfully name) — a structural claim, checked against the source rather
// than only implied by the render-level tests above.
// ---------------------------------------------------------------------------

describe('source guard — Objection.tsx and Still.tsx never use the running-head variant', () => {
	function stripComments(source: string): string {
		return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
	}

	it('Objection.tsx never constructs a running-head SourceHead variant', () => {
		const source = stripComments(readFileSync(path.join(moduleDir, '..', 'Objection.tsx'), 'utf-8'));
		expect(source).not.toMatch(/kind:\s*['"]running-head['"]/);
	});

	it('Still.tsx never constructs a running-head SourceHead variant', () => {
		const source = stripComments(readFileSync(path.join(moduleDir, '..', 'Still.tsx'), 'utf-8'));
		expect(source).not.toMatch(/kind:\s*['"]running-head['"]/);
	});
});
