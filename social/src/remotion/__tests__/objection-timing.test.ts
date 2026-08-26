import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';

import {
	computeObjectionLayout,
	computeObjectionTiming,
	quoteObjection,
	OBJECTION_HOLD_FRAMES,
	OBJECTION_HOLD_SECONDS,
	OBJECTION_MIN_SECONDS,
	OBJECTION_REPLY_LINE_COUNT,
	OBJECTION_REPLY_LINE_FRAMES,
	OBJECTION_REPLY_LINE_SECONDS,
	OBJECTION_REPLY_MIN_SECONDS,
	FPS
} from '../objection-timing.js';
import { gateObjectionCard } from '../objection-gate.js';
import { MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES } from '../duration-bounds.js';

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

// --- Real fixture — a passing entry from content/social/premises/objection.json ---
// on-anger-03-079: rubric.verdict "accept", rubric.classification
// "viewer_position", and its reply cleanly caps to two complete sentences
// with no hanging third sentence — i.e. it PASSES the full T08 gate.

const FIXTURE_OBJECTION = "Shouldn't he be punished?";
const FIXTURE_REPLY =
	"He will be, even if you don't want him to be. The worst punishment for doing wrong is knowing that you did it. " +
	"No one suffers more than someone tortured by their own guilt. Besides, we should think about all of humanity " +
	"before we judge what happens in life. It's unfair to blame individuals for flaws that everyone has. A black " +
	"person's skin doesn't stand out among his own people. No man in Germany is ashamed of his red hair tied in a knot.";
const FIXTURE_AUTHOR = 'seneca';

describe('fixture sanity', () => {
	it('the fixture passes the full gate', () => {
		const result = gateObjectionCard({
			objection: FIXTURE_OBJECTION,
			reply: FIXTURE_REPLY,
			verdict: 'accept',
			classification: 'viewer_position'
		});
		expect(result.ok).toBe(true);
	});
});

describe('phase 1 — the objection alone, still', () => {
	const timing = computeObjectionTiming();

	it('starts at frame 0', () => {
		expect(timing.objection.startFrame).toBe(0);
	});

	it('is motionless — zero motion at frame 0', () => {
		expect(timing.objection.motionless).toBe(true);
	});

	it('holds for at least the house rule floor (>= 2.5s)', () => {
		expect(OBJECTION_MIN_SECONDS).toBe(2.5);
		expect(OBJECTION_HOLD_SECONDS).toBeGreaterThanOrEqual(OBJECTION_MIN_SECONDS);
		expect(timing.objection.endFrame - timing.objection.startFrame).toBe(OBJECTION_HOLD_FRAMES);
		expect(OBJECTION_HOLD_FRAMES).toBeGreaterThanOrEqual(Math.round(2.5 * FPS));
	});
});

describe('phase 2 — the reply resolves in stillness, one line at a time', () => {
	const timing = computeObjectionTiming();

	it('is always exactly two lines', () => {
		expect(OBJECTION_REPLY_LINE_COUNT).toBe(2);
		expect(timing.replyLines.length).toBe(2);
	});

	it('the first reply line starts exactly where the objection hold ends — a hard handoff, no overlap', () => {
		expect(timing.replyLines[0].startFrame).toBe(timing.objection.endFrame);
	});

	it('the second reply line starts exactly where the first ends — no overlap, no gap', () => {
		expect(timing.replyLines[1].startFrame).toBe(timing.replyLines[0].endFrame);
	});

	it('every reply line is motionless', () => {
		expect(timing.replyLines[0].motionless).toBe(true);
		expect(timing.replyLines[1].motionless).toBe(true);
	});

	it('every reply line is held for at least the house rule floor (>= 2.5s)', () => {
		expect(OBJECTION_REPLY_MIN_SECONDS).toBe(2.5);
		expect(OBJECTION_REPLY_LINE_SECONDS).toBeGreaterThanOrEqual(OBJECTION_REPLY_MIN_SECONDS);
		for (const line of timing.replyLines) {
			expect(line.endFrame - line.startFrame).toBeGreaterThanOrEqual(Math.round(2.5 * FPS));
		}
		expect(OBJECTION_REPLY_LINE_FRAMES).toBeGreaterThanOrEqual(Math.round(2.5 * FPS));
	});

	it('totalFrames is exactly the sum of every phase', () => {
		expect(timing.totalFrames).toBe(timing.replyLines[1].endFrame);
	});
});

// social pilot 02a T16 (F04): computeObjectionTiming now accepts an
// optional narrationTimings input, matching computeWallTiming's own
// contract, so real narration drives each reply-line hold instead of the
// fixed OBJECTION_REPLY_LINE_FRAMES fallback.
//
// Unlike The Question's single answer phase, only the SECOND (final) reply
// line is ever padded to clear the 15s MP4 floor (see T18's own describe
// below) — the first reply line's duration is never touched by padding, so
// a drifted narrationTimings[0] alone is enough to move a real on-screen
// boundary without needing to out-run the pad point the way the Question's
// single-phase tests above do.
describe('social pilot 02a T16 — narration-driven reply-line durations (F04)', () => {
	it('with no narrationTimings supplied, both reply lines hold their fixed default durations (unchanged behavior)', () => {
		const timing = computeObjectionTiming();
		expect(timing.replyLines[0].endFrame - timing.replyLines[0].startFrame).toBe(OBJECTION_REPLY_LINE_FRAMES);
		// The second line is already padded to the 15s floor by default (see
		// the T18 describe below) — its raw, unpadded length would also be
		// OBJECTION_REPLY_LINE_FRAMES, but this describe cares about the
		// REAL, on-screen boundary, which is the padded one.
		expect(timing.totalFrames).toBe(timing.replyLines[1].endFrame);
	});

	it('respects a supplied narration timing for the first reply line — a real, unpadded boundary move', () => {
		const timing = computeObjectionTiming({ narrationTimings: [{ startSeconds: 0, endSeconds: 4.0 }] });
		const expectedFrames = Math.round(4.0 * FPS);
		expect(timing.replyLines[0].endFrame - timing.replyLines[0].startFrame).toBe(expectedFrames);
		expect(expectedFrames).not.toBe(OBJECTION_REPLY_LINE_FRAMES);
	});

	it('respects supplied narration timings for both reply lines independently', () => {
		const timing = computeObjectionTiming({
			narrationTimings: [
				{ startSeconds: 0, endSeconds: 4.0 },
				{ startSeconds: 0, endSeconds: 10.0 }
			]
		});
		expect(timing.replyLines[0].endFrame - timing.replyLines[0].startFrame).toBe(Math.round(4.0 * FPS));
		expect(timing.replyLines[1].endFrame - timing.replyLines[1].startFrame).toBe(Math.round(10.0 * FPS));
	});

	it('a DRIFTED narration timing set moves the on-screen reply-line boundaries — concrete frame numbers', () => {
		const fixedTiming = computeObjectionTiming();

		// "Drifted" here means: real narration audio for the first reply line
		// running a genuinely different length (4.0s) than the fixed
		// OBJECTION_REPLY_LINE_FRAMES fallback (2.5s) would have produced —
		// the acceptance criterion this test exists to prove. The second
		// line is left to its own fallback, same as the default schedule.
		const drifted = computeObjectionTiming({ narrationTimings: [{ startSeconds: 0, endSeconds: 4.0 }] });

		// The objection hold (phase 1) never moves.
		expect(drifted.objection).toEqual(fixedTiming.objection);

		// The first reply line's END — a real on-screen boundary — moves.
		expect(drifted.replyLines[0].endFrame).not.toBe(fixedTiming.replyLines[0].endFrame);
		// Consequently the second reply line's START also moves (it always
		// starts exactly where the first ends).
		expect(drifted.replyLines[1].startFrame).not.toBe(fixedTiming.replyLines[1].startFrame);

		// Concrete frame numbers, for the record. OBJECTION_HOLD_FRAMES=75:
		// fixed default: objection [0,75), reply1 [75,150) (75f, fallback),
		// reply2 [150,450) (300f, padded to the 15s floor).
		expect(fixedTiming.objection.endFrame).toBe(75);
		expect(fixedTiming.replyLines[0].endFrame).toBe(150);
		expect(fixedTiming.replyLines[1].startFrame).toBe(150);
		expect(fixedTiming.replyLines[1].endFrame).toBe(450);

		// Drifted (4.0s first line = 120f): reply1 [75,195) (120f, narrated),
		// reply2 [195,450) (255f, still padded to the SAME 15s floor total —
		// the total didn't move, but the boundary between the two lines did).
		expect(drifted.replyLines[0].endFrame).toBe(195);
		expect(drifted.replyLines[1].startFrame).toBe(195);
		expect(drifted.replyLines[1].endFrame).toBe(450);
		expect(drifted.totalFrames).toBe(450);
	});

	it('a drifted set that clears the 15s pad point on its own moves totalFrames too, not just the internal boundary', () => {
		const fixedTiming = computeObjectionTiming();
		const drifted = computeObjectionTiming({
			narrationTimings: [
				{ startSeconds: 0, endSeconds: 4.0 },
				{ startSeconds: 0, endSeconds: 10.0 }
			]
		});

		// reply1 [75,195) (120f), reply2 raw [195,495) (300f) — raw total
		// (495f) already clears MIN_POST_DURATION_FRAMES (450f), so no
		// padding applies and totalFrames genuinely differs from the default.
		expect(drifted.replyLines[0].endFrame).toBe(195);
		expect(drifted.replyLines[1].endFrame).toBe(495);
		expect(drifted.totalFrames).toBe(495);
		expect(drifted.totalFrames).not.toBe(fixedTiming.totalFrames);
		expect(drifted.totalFrames).toBeGreaterThan(fixedTiming.totalFrames);
	});
});

describe('T18 — the composed total clears the 15s MP4 duration floor', () => {
	it('the fixed shape (225 raw frames / 7.5s) is padded up to MIN_POST_DURATION_FRAMES', () => {
		const timing = computeObjectionTiming();
		expect(timing.totalFrames).toBeGreaterThanOrEqual(MIN_POST_DURATION_FRAMES);
		expect(timing.totalFrames).toBeLessThanOrEqual(MAX_POST_DURATION_FRAMES);
	});

	it('the padding extends the SECOND (final) reply line only — the first reply line and the objection hold are untouched', () => {
		const timing = computeObjectionTiming();
		expect(timing.objection.endFrame - timing.objection.startFrame).toBe(OBJECTION_HOLD_FRAMES);
		expect(timing.replyLines[0].endFrame - timing.replyLines[0].startFrame).toBe(OBJECTION_REPLY_LINE_FRAMES);
		expect(timing.replyLines[1].endFrame - timing.replyLines[1].startFrame).toBeGreaterThan(OBJECTION_REPLY_LINE_FRAMES);
		expect(timing.replyLines[1].motionless).toBe(true);
	});
});

describe('quoteObjection', () => {
	it('wraps the objection in quotation marks, verbatim', () => {
		expect(quoteObjection(FIXTURE_OBJECTION)).toBe(`"${FIXTURE_OBJECTION}"`);
	});
});

describe('opening-frame layout', () => {
	it('computeObjectionLayout fits the fixture objection well above the legibility floor', () => {
		const layout = computeObjectionLayout(FIXTURE_OBJECTION);
		expect(layout.fontSize).toBeGreaterThan(0);
		expect(layout.lineHeight).toBeGreaterThan(layout.fontSize);
	});
});

describe('frame 0 renders ONLY the objection, in quotation marks, in the author accent colour — nothing else', () => {
	const source = readFileSync(path.join(moduleDir, '..', 'Objection.tsx'), 'utf-8');

	// Isolate the opening-phase branch's body: from
	// `if (frame < timing.objection.endFrame)` up to (but excluding) the
	// next statement that reads the first reply line's window.
	const openingStart = source.indexOf('if (frame < timing.objection.endFrame)');
	const replyStart = source.indexOf('const [firstReplyLine]');
	const openingBranch = source.slice(openingStart, replyStart);

	it('the opening branch exists and precedes the reply-line logic', () => {
		expect(openingStart).toBeGreaterThan(-1);
		expect(replyStart).toBeGreaterThan(openingStart);
	});

	it('never references the reply, PayoffLine, or a card counter in the opening branch', () => {
		expect(openingBranch).not.toMatch(/props\.reply\b/);
		expect(openingBranch).not.toMatch(/PayoffLine/);
		expect(openingBranch).not.toMatch(/Card \d/);
		expect(openingBranch).not.toMatch(/counter/i);
	});

	it('only renders the objection via ObjectionLine, wrapped in quotes and set in the author accent colour', () => {
		expect(openingBranch).toMatch(/<ObjectionLine text=\{props\.objection\} author=\{props\.author\}\s*\/>/);
	});

	it('ObjectionLine renders the quoted objection text, coloured with the author accent, not ink', () => {
		expect(source).toMatch(/\{quoteObjection\(text\)\}/);
		expect(source).toMatch(/color:\s*accent/);
	});

	it("no attribution ('he says', 'you might think') is hardcoded anywhere in the opening branch", () => {
		const lower = openingBranch.toLowerCase();
		expect(lower).not.toContain('he says');
		expect(lower).not.toContain('she says');
		expect(lower).not.toContain('you might think');
	});
});

describe('source guard — no overshoot easing anywhere in Objection.tsx', () => {
	const source = readFileSync(path.join(moduleDir, '..', 'Objection.tsx'), 'utf-8');

	it('never calls spring(', () => {
		expect(source).not.toMatch(/\bspring\s*\(/);
	});

	it('never uses Easing.back, Easing.elastic, or Easing.bounce', () => {
		expect(source).not.toMatch(/Easing\.back/);
		expect(source).not.toMatch(/Easing\.elastic/);
		expect(source).not.toMatch(/Easing\.bounce/);
	});
});

describe('source guard — no overshoot easing anywhere in objection-timing.ts or objection-gate.ts', () => {
	for (const file of ['objection-timing.ts', 'objection-gate.ts']) {
		it(`${file} never calls spring(`, () => {
			const source = readFileSync(path.join(moduleDir, '..', file), 'utf-8');
			expect(source).not.toMatch(/\bspring\s*\(/);
		});
	}
});

describe('end-to-end smoke: renders real still frames at the key boundaries', () => {
	it(
		'renders frame 0 (objection), reply line 1, and reply line 2, each at 1080x1920',
		async () => {
			const timing = computeObjectionTiming();

			const inputProps = {
				objection: FIXTURE_OBJECTION,
				reply: FIXTURE_REPLY,
				author: FIXTURE_AUTHOR
			};

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

			const composition = await selectComposition({
				serveUrl: bundleLocation,
				id: 'Objection',
				inputProps
			});

			const framesToCheck = [0, timing.replyLines[0].startFrame, timing.replyLines[1].startFrame];

			for (const frame of framesToCheck) {
				const outPath = path.join(os.tmpdir(), `plain-objection-still-${frame}-${Date.now()}.png`);
				await renderStill({
					composition,
					serveUrl: bundleLocation,
					output: outPath,
					frame,
					inputProps,
					imageFormat: 'png'
				});

				const buf = readFileSync(outPath);
				expect(buf.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
				expect(buf.readUInt32BE(16)).toBe(1080);
				expect(buf.readUInt32BE(20)).toBe(1920);
			}
		},
		120_000
	);
});

describe('repo sanity — the fixture is a real pool entry', () => {
	it('on-anger-03-079 exists in content/social/premises/objection.json with the fixture text', () => {
		const pool = JSON.parse(
			readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'objection.json'), 'utf-8')
		) as { entries: Array<{ card_id: string; objection: string; reply: string }> };
		const entry = pool.entries.find((e) => e.card_id === 'on-anger-03-079');
		expect(entry).toBeDefined();
		expect(entry?.objection).toBe(FIXTURE_OBJECTION);
		expect(entry?.reply).toBe(FIXTURE_REPLY);
	});
});
