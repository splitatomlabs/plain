import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	OVERSHOOT_PATTERNS,
	PAYOFF_MIN_MOTIONLESS_SECONDS,
	assertRegistryCoversRootCompositions,
	checkAllFormats,
	checkNoOvershootEasing,
	checkPayoffMotionless,
	checkTtsWithinHouseRule,
	discoverRegisteredCompositionIds,
	stripComments
} from '../house-rules.js';
import { FPS, computeWallTiming } from '../../remotion/wall-timing.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const remotionDir = path.resolve(moduleDir, '..', '..', 'remotion');

// ---------------------------------------------------------------------------
// Rule 1 — no overshoot easing, ANYWHERE
// ---------------------------------------------------------------------------

describe('checkNoOvershootEasing', () => {
	it('rejects a composition using spring(', () => {
		const source = `
			import { spring, useCurrentFrame } from 'remotion';
			export const Bad = () => {
				const frame = useCurrentFrame();
				const scale = spring({ frame, fps: 30 });
				return null;
			};
		`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('spring('))).toBe(true);
		expect(result.violations.every((v) => v.rule === 1)).toBe(true);
	});

	it('rejects a composition using Easing.back', () => {
		const source = `
			import { Easing, interpolate } from 'remotion';
			const eased = interpolate(frame, [0, 30], [0, 1], { easing: Easing.back(1.5) });
		`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('Easing.back'))).toBe(true);
	});

	it('rejects a composition using Easing.elastic', () => {
		const source = `const eased = interpolate(frame, [0, 30], [0, 1], { easing: Easing.elastic(1) });`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('Easing.elastic'))).toBe(true);
	});

	it('rejects a composition using Easing.bounce', () => {
		const source = `const eased = interpolate(frame, [0, 30], [0, 1], { easing: Easing.bounce });`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('Easing.bounce'))).toBe(true);
	});

	it('rejects an overshooting cubic-bezier(0.34, 1.56, 0.64, 1)', () => {
		const source = `const style = { transition: 'transform 300ms cubic-bezier(0.34, 1.56, 0.64, 1)' };`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('cubic-bezier(0.34, 1.56, 0.64, 1)'))).toBe(true);
	});

	it('passes a plain ease-out cubic-bezier with control points inside [0, 1]', () => {
		const source = `const style = { transition: 'transform 300ms cubic-bezier(0.22, 0.61, 0.36, 1)' };`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it('passes a file with no forbidden pattern at all', () => {
		const source = `export const scale = (frame: number) => 1 + frame * 0.001;`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(true);
	});

	it('PASSES a file whose only occurrence of a forbidden pattern is inside a comment', () => {
		const source = `
			// This file must never call spring( or use Easing.back, Easing.elastic,
			// or Easing.bounce — see the house rule. cubic-bezier(0.34, 1.56, 0.64, 1)
			// is exactly the kind of curve that's forbidden.
			/**
			 * Also forbidden inside a block comment: spring(), Easing.bounce.
			 */
			export const scale = (frame: number) => 1 + frame * 0.001;
		`;
		const result = checkNoOvershootEasing(source, 'Synthetic.tsx');
		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
	});
});

describe('stripComments', () => {
	it('removes // line comments', () => {
		const stripped = stripComments('const a = 1; // spring(\nconst b = 2;');
		expect(stripped).not.toContain('spring(');
		expect(stripped).toContain('const a = 1;');
		expect(stripped).toContain('const b = 2;');
	});

	it('removes /* */ block comments, including multiline ones', () => {
		const stripped = stripComments('const a = 1;\n/* spring(\nEasing.back */\nconst b = 2;');
		expect(stripped).not.toContain('spring(');
		expect(stripped).not.toContain('Easing.back');
	});

	it('leaves forbidden patterns inside real code intact', () => {
		const stripped = stripComments("const s = spring({ frame, fps: 30 }); // not a comment issue");
		expect(stripped).toContain('spring(');
	});

	it('does not treat // inside a string as a comment starting early', () => {
		const stripped = stripComments('const url = "https://example.com"; // spring(');
		expect(stripped).toContain('https://example.com');
		expect(stripped).not.toContain('spring(');
	});
});

describe('OVERSHOOT_PATTERNS', () => {
	it('documents every named pattern with a non-empty description', () => {
		for (const pattern of OVERSHOOT_PATTERNS) {
			expect(pattern.name.length).toBeGreaterThan(0);
			expect(pattern.description.length).toBeGreaterThan(0);
		}
	});

	it('covers spring(, Easing.back, Easing.elastic, Easing.bounce, and cubic-bezier overshoot', () => {
		const names = OVERSHOOT_PATTERNS.map((p) => p.name).join(' | ');
		expect(names).toContain('spring(');
		expect(names).toContain('Easing.back');
		expect(names).toContain('Easing.elastic');
		expect(names).toContain('Easing.bounce');
		expect(names.toLowerCase()).toContain('cubic-bezier');
	});
});

// ---------------------------------------------------------------------------
// Rule 2 — the payoff frame has ZERO motion for >= 2.5s
// ---------------------------------------------------------------------------

describe('checkPayoffMotionless', () => {
	it('names the house rule floor as exactly 2.5 seconds', () => {
		expect(PAYOFF_MIN_MOTIONLESS_SECONDS).toBe(2.5);
	});

	it('rejects a motionless payoff phase held under 2.5s', () => {
		const timing = {
			payoff: {
				startFrame: 0,
				endFrame: Math.round(2 * FPS), // 2s — under the 2.5s floor
				motionless: true
			}
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('2.5s floor'))).toBe(true);
		expect(result.violations.every((v) => v.rule === 2)).toBe(true);
	});

	it('rejects a motionless payoff phase with motion driven over its frames', () => {
		const timing = {
			payoff: {
				startFrame: 0,
				endFrame: Math.round(3 * FPS), // long enough — the violation is motion, not duration
				motionless: true,
				motionSamples: [1.0, 1.01, 1.02, 1.05]
			}
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('motion is driven'))).toBe(true);
	});

	it('passes a motionless payoff phase held for exactly 2.5s with no motion samples', () => {
		const timing = {
			payoff: {
				startFrame: 0,
				endFrame: Math.round(2.5 * FPS),
				motionless: true
			}
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it('passes a motionless payoff phase whose motion samples are all identical (constant, not driven)', () => {
		const timing = {
			payoff: {
				startFrame: 0,
				endFrame: Math.round(3 * FPS),
				motionless: true,
				motionSamples: [1.0, 1.0, 1.0]
			}
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(true);
	});

	it('ignores non-motionless phases entirely, however short or however much they move', () => {
		const timing = {
			movingPhase: {
				startFrame: 0,
				endFrame: 10,
				motionless: false,
				motionSamples: [1.0, 1.5, 2.0]
			}
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(true);
	});

	it('walks nested arrays and tuples of phase windows, not just flat fields', () => {
		const timing = {
			restLines: [
				{ startFrame: 0, endFrame: Math.round(3 * FPS), motionless: true },
				{ startFrame: Math.round(3 * FPS), endFrame: Math.round(4 * FPS), motionless: true } // under 2.5s
			]
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(false);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0].detail).toContain('restLines[1]');
	});

	it('exempts a still opening hold BEFORE a moving phase from the 2.5s floor — it is not the payoff', () => {
		// Mirrors The Question's real shape: a short motionless opening hold
		// (1.5s, tied to its own acceptance criterion, not the house rule's
		// payoff floor), then a moving phase, then the true payoff.
		const timing = {
			opening: { startFrame: 0, endFrame: Math.round(1.5 * FPS), motionless: true },
			moving: { startFrame: Math.round(1.5 * FPS), endFrame: Math.round(4 * FPS), motionless: false },
			payoff: { startFrame: Math.round(4 * FPS), endFrame: Math.round(6.5 * FPS), motionless: true }
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(true);
	});

	it('still enforces the 2.5s floor on the phase AFTER the moving phase, even with a short exempt opening', () => {
		const timing = {
			opening: { startFrame: 0, endFrame: Math.round(1.5 * FPS), motionless: true },
			moving: { startFrame: Math.round(1.5 * FPS), endFrame: Math.round(4 * FPS), motionless: false },
			payoff: { startFrame: Math.round(4 * FPS), endFrame: Math.round(5 * FPS), motionless: true } // only 1s
		};
		const result = checkPayoffMotionless(timing, 'synthetic-timing');
		expect(result.passed).toBe(false);
		expect(result.violations).toHaveLength(1);
		expect(result.violations[0].detail).toContain('payoff');
	});

	it('fails loudly (does not silently pass) when the schedule contains no phase windows at all', () => {
		const result = checkPayoffMotionless({ totalFrames: 100 }, 'synthetic-timing');
		expect(result.passed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// social pilot 02a R06 (2026-08-26) — narration-driven regression coverage.
//
// `checkAllFormats`'s FORMATS registry (below) always calls each format's
// `compute*Timing` with NO `narrationTimings` — the fixed-duration fallback
// path, which by construction already meets `PAYOFF_MIN_MOTIONLESS_SECONDS`
// (every fallback constant IS 2.5s or more). That is why `checkAllFormats`
// never caught T16 (F04)'s regression: `objection-timing.ts`'s first reply
// line following real narration down to well under 2.5s with only a
// 1-frame floor. `checkPayoffMotionless` itself is general-purpose and DOES
// catch a too-short narration-driven hold the moment it's given one (proven
// below) — the gap was entirely in what `FORMATS`' fixtures exercise, not
// in the checker. These tests call the real `compute*Timing` functions with
// deliberately short `narrationTimings` directly, so a future regression in
// this class (a narration-driven hold with no floor) fails here even though
// `checkAllFormats` itself still would not catch it.
//
// The Wall shares the exact same underlying gap for its NON-FINAL rest
// lines (only the last rest line is protected by `padToMinimumDuration`,
// and only when the schedule's raw total is still under the 15s MP4 floor
// at that point) — confirmed with `checkPayoffMotionless` during R06's
// investigation, but deliberately NOT fixed or asserted against here: R06's
// scope is Objection (the reviewer's specific finding), and fixing Wall's
// non-final rest lines is a distinct, larger change (every rest line, not
// just the first, needs its own floor, mirroring what this task did for
// Objection's two reply lines) that belongs in its own task rather than
// folded in here unannounced.
describe('social pilot 02a R06 — narration-driven schedules are checked for the payoff-motionless floor, not just the fixed-duration fallback', () => {
	// Pf39c2-social-pilot-02a D01: this used to also cover The Objection and
	// The Question's own R06 regressions; both formats were deleted outright
	// (the channel is one Wall a day), so only the Wall's own known gap
	// remains here.
	it('The Wall: a short (0.2s) NON-FINAL narrated rest line fails checkPayoffMotionless today — a known, separately-scoped gap, not fixed by R06', () => {
		const timing = computeWallTiming({
			originalExcerpt:
				'Placeholder archaic excerpt text for this house-rule regression check only — needs to be ' +
				'long enough to wrap several lines and clear the never-finishes travel floor comfortably so ' +
				'the wall phase geometry here is representative of a real card excerpt in this pilot run.',
			plainLines: ['A very short first narrated line.', 'A normal second narrated line.'],
			narrationTimings: [
				{ startSeconds: 0, endSeconds: 0.2 }, // non-final, short — the unprotected case
				{ startSeconds: 0.2, endSeconds: 3.0 }
			]
		});
		const result = checkPayoffMotionless(timing, 'wall-timing.ts (known gap, not fixed by R06)');
		expect(result.passed).toBe(false);
		expect(result.violations.some((v) => v.detail.includes('restLines[0]'))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Rule 3 — TTS pitch and rate never below default (delegates to tts.ts)
// ---------------------------------------------------------------------------

describe('checkTtsWithinHouseRule', () => {
	it('rejects a below-default pitch', () => {
		const result = checkTtsWithinHouseRule({ pitch: 0.9 });
		expect(result.passed).toBe(false);
		expect(result.violations[0].rule).toBe(3);
	});

	it('rejects a below-default rate', () => {
		const result = checkTtsWithinHouseRule({ rate: 0.85 });
		expect(result.passed).toBe(false);
		expect(result.violations[0].rule).toBe(3);
	});

	it('passes default settings (undefined)', () => {
		const result = checkTtsWithinHouseRule(undefined);
		expect(result.passed).toBe(true);
		expect(result.violations).toEqual([]);
	});

	it('passes settings exactly at default (1.0)', () => {
		const result = checkTtsWithinHouseRule({ pitch: 1, rate: 1 });
		expect(result.passed).toBe(true);
	});

	it('passes settings above default', () => {
		const result = checkTtsWithinHouseRule({ pitch: 1.1, rate: 1.2 });
		expect(result.passed).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// checkAllFormats — the centralised, cross-format run
// ---------------------------------------------------------------------------

describe('checkAllFormats', () => {
	it('PASSES rules 1 and 2 for the one real format today (the Wall)', () => {
		const result = checkAllFormats();
		expect(result.violations).toEqual([]);
		expect(result.passed).toBe(true);
	});

	// Pf39c2-social-pilot-02a D01: Root.tsx used to also register Question,
	// Objection and Still; all three were deleted outright (the channel is
	// one Wall a day), so only the Wall composition remains.
	it('covers every composition Root.tsx registers — Wall', () => {
		const rootSource = readFileSync(path.join(remotionDir, 'Root.tsx'), 'utf-8');
		expect(rootSource).toContain('id="Wall"');
		expect(rootSource).not.toContain('id="Question"');
		expect(rootSource).not.toContain('id="Objection"');
		expect(rootSource).not.toContain('id="Still"');

		// checkAllFormats() completing at all (not throwing) is itself proof
		// its internal registry covers this one format — see the next test
		// for the "a new composition with no entry" failure mode.
		expect(() => checkAllFormats()).not.toThrow();
	});

	it('scans every .ts/.tsx file that actually exists in social/src/remotion today', () => {
		const files = readdirSync(remotionDir, { withFileTypes: true })
			.filter((entry) => entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')))
			.map((entry) => entry.name);
		// Sanity: the discovery this test re-implements independently finds
		// at least the known composition and timing files — if this list
		// ever shrinks unexpectedly, checkAllFormats's own file scan would
		// silently cover less too. Question.tsx/Objection.tsx/Still.tsx and
		// their timing modules were deleted outright (D01) and must NEVER
		// reappear here.
		expect(files).toEqual(expect.arrayContaining(['Wall.tsx', 'Root.tsx']));
		expect(files).toEqual(expect.arrayContaining(['wall-timing.ts']));
		expect(files).not.toEqual(
			expect.arrayContaining(['Question.tsx', 'Objection.tsx', 'Still.tsx'])
		);
	});

	it('fails loudly (throws) if a composition is registered in Root.tsx with no matching FORMATS entry', () => {
		// Reproduces the exact shape checkAllFormats's internal registry
		// cross-check guards against: a Root.tsx that registers a FOURTH
		// composition this module's FORMATS registry has never heard of.
		const syntheticRootSource = `
			<Composition<any, WallProps>
				id="Wall"
				component={Wall}
			/>
			<Composition<any, QuestionProps>
				id="Question"
				component={Question}
			/>
			<Composition<any, ObjectionProps>
				id="Objection"
				component={Objection}
			/>
			<Composition<any, NewFormatProps>
				id="BrandNewFormat"
				component={BrandNewFormat}
			/>
		`;
		expect(() =>
			assertRegistryCoversRootCompositions(syntheticRootSource, ['Wall', 'Question', 'Objection'])
		).toThrow(/BrandNewFormat/);
	});

	it('does not throw when the registry exactly matches Root.tsx registrations', () => {
		const syntheticRootSource = `
			<Composition<any, WallProps>
				id="Wall"
				component={Wall}
			/>
		`;
		expect(() => assertRegistryCoversRootCompositions(syntheticRootSource, ['Wall'])).not.toThrow();
	});
});

describe('discoverRegisteredCompositionIds', () => {
	it('finds every id, even across a generic-typed <Composition<any, Props> tag with a > before the attributes', () => {
		const source = `
			<Composition<any, WallProps>
				id="Wall"
				component={Wall}
			/>
			<Composition<any, QuestionProps>
				id="Question"
				component={Question}
			/>
		`;
		expect(discoverRegisteredCompositionIds(source)).toEqual(['Wall', 'Question']);
	});

	it('ignores a Composition mention inside a comment', () => {
		const source = `
			// <Composition id="ShouldNotCount" />
			<Composition id="RealOne" component={Real} />
		`;
		expect(discoverRegisteredCompositionIds(source)).toEqual(['RealOne']);
	});
});
