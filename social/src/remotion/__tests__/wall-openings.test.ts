import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

import { mkdtemp, rm } from 'node:fs/promises';

import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
// @ts-expect-error — text-readability has no type declarations, same as
// `scripts/lib/premises.ts`/`scripts/lib/validate.ts` in the root pipeline.
import rs from 'text-readability';

import {
	computeOpeningData,
	countdownValueAtFrame,
	formatGradeLabel,
	formatCountdownLabel,
	gateOpening,
	assertOpeningRenderable,
	rotateOpening,
	WALL_OPENINGS,
	WALL_COUNTDOWN_DELTA_MIN,
	FORBIDDEN_GRADE_VOCABULARY,
	type WallOpening,
	type WallOpeningEligibilityEntry
} from '../wall-openings.js';
import { computeWallTiming, wallScrollOffsetAtFrame, splitWords } from '../wall-timing.js';

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

// --- Real fixture card — mirrors wall-timing.test.ts / counter.test.ts
// exactly, rather than inventing a new one. meditations-07-031 is 150
// words and, per content/social/premises/wall.json, eligible for all three
// openings ("standard", "countdown", "grade").

interface Card {
	id: string;
	plain_english: string;
	original_excerpt: string;
	author_slug: 'epictetus' | 'marcus-aurelius' | 'seneca';
}

function loadFixtureCard(): Card {
	const chapter = JSON.parse(
		readFileSync(path.join(outputDir, 'meditations', 'book-07.json'), 'utf-8')
	) as Card[];
	const card = chapter.find((c) => c.id === 'meditations-07-031');
	if (!card) {
		throw new Error('Fixture card meditations-07-031 not found in content/output/meditations/book-07.json');
	}
	return card;
}

const FIXTURE_CARD = loadFixtureCard();
const FIXTURE_LANDING_LINE = 'Here is the truth, men of Athens.';
const FIXTURE_PLAIN_LINES = FIXTURE_CARD.plain_english
	.split(/(?<=[.?!])\s+(?=[A-Z'])/)
	.filter((line) => line.trim() !== FIXTURE_LANDING_LINE);

// --- The real Wall pool, loaded straight from content/social/premises -----

interface WallPoolEntry {
	card_id: string;
	book_slug: string;
	eligible_openings: WallOpening[];
	[key: string]: unknown;
}

function loadWallPool(): WallPoolEntry[] {
	const data = JSON.parse(
		readFileSync(path.join(repoRoot, 'content', 'social', 'premises', 'wall.json'), 'utf-8')
	) as { entries: WallPoolEntry[] };
	return data.entries;
}

const POOL = loadWallPool();

describe('computeOpeningData', () => {
	const plainText = [FIXTURE_LANDING_LINE, ...FIXTURE_PLAIN_LINES].join(' ');
	const data = computeOpeningData(FIXTURE_CARD.original_excerpt, plainText);

	it('computes originalWordCount from the real excerpt, not a hardcoded number', () => {
		expect(data.originalWordCount).toBe(splitWords(FIXTURE_CARD.original_excerpt).length);
		expect(data.originalWordCount).toBe(150);
	});

	it('computes plainWordCount from the plain text handed in, not from the original', () => {
		expect(data.plainWordCount).toBe(splitWords(plainText).length);
		expect(data.plainWordCount).not.toBe(data.originalWordCount);
	});

	it("equals the pipeline's own readability method for this excerpt (rounded once further)", () => {
		const pipelineGrade: number = rs.fleschKincaidGrade(FIXTURE_CARD.original_excerpt);
		expect(data.originalGrade).toBe(Math.round(pipelineGrade));
		// Matches the precomputed value already shipped in
		// content/social/premises/wall.json for this exact card, so the
		// on-screen numeral and the pool's own figure can never disagree.
		const poolEntry = POOL.find((e) => e.card_id === 'meditations-07-031');
		expect(poolEntry).toBeDefined();
		expect(Math.round(poolEntry!.original_grade as number)).toBe(data.originalGrade);
	});

	it('the on-screen grade is a bare whole number — the pipeline value carries a decimal, this does not', () => {
		const pipelineGrade: number = rs.fleschKincaidGrade(FIXTURE_CARD.original_excerpt);
		expect(Number.isInteger(data.originalGrade)).toBe(true);
		expect(Number.isInteger(pipelineGrade)).toBe(false);
	});

	it('ORIGINAL ONLY — never computes or exposes a grade for the plain text', () => {
		// The plain side's grade is structurally absent, not merely unused:
		// `OpeningData` carries exactly these three keys, and none of them
		// is derived from `rs.fleschKincaidGrade(plainText)`.
		expect(Object.keys(data).sort()).toEqual(['originalGrade', 'originalWordCount', 'plainWordCount']);

		// The plain text is always grade 4-6 per the index plan ("the plain
		// side is always 4-6") — confirm the number actually computed and
		// shown is the ORIGINAL's, not this much lower plain-side figure.
		const plainGrade: number = rs.fleschKincaidGrade(plainText);
		expect(data.originalGrade).not.toBe(Math.round(plainGrade));
		expect(data.originalGrade).toBeGreaterThan(plainGrade);
	});
});

describe('countdownValueAtFrame — driven by scroll progress (F15)', () => {
	const timing = computeWallTiming({
		originalExcerpt: FIXTURE_CARD.original_excerpt,
		plainLines: FIXTURE_PLAIN_LINES
	});
	const cutFrame = timing.wall.endFrame - 1;
	const plainText = [FIXTURE_LANDING_LINE, ...FIXTURE_PLAIN_LINES].join(' ');
	const data = computeOpeningData(FIXTURE_CARD.original_excerpt, plainText);

	it('the underlying scroll offset is non-decreasing in frame (the scroll never reverses)', () => {
		let prev = 0;
		for (let f = 0; f <= cutFrame; f += 3) {
			const offset = wallScrollOffsetAtFrame(f);
			expect(offset).toBeGreaterThanOrEqual(prev);
			prev = offset;
		}
	});

	it('at frame 0, the countdown equals the original word count exactly', () => {
		expect(countdownValueAtFrame(0, cutFrame, data)).toBe(data.originalWordCount);
	});

	it('at the cut (the last wall frame), the countdown equals the plain word count exactly', () => {
		expect(countdownValueAtFrame(cutFrame, cutFrame, data)).toBe(data.plainWordCount);
	});

	it('is monotonically non-increasing across the wall phase (counts down, never up)', () => {
		let prev = Infinity;
		for (let f = 0; f <= cutFrame; f += 3) {
			const value = countdownValueAtFrame(f, cutFrame, data);
			expect(value).toBeLessThanOrEqual(prev);
			prev = value;
		}
	});

	it('tracks wallScrollOffsetAtFrame directly — not a copy of the same math', () => {
		// An independently-computed midpoint frame, using the exact same
		// shared function this module exports, must reproduce
		// `countdownValueAtFrame`'s own progress fraction.
		const midFrame = Math.floor(cutFrame / 2);
		const offsetAtCut = wallScrollOffsetAtFrame(cutFrame);
		const offsetAtMid = wallScrollOffsetAtFrame(midFrame);
		const expectedProgress = offsetAtMid / offsetAtCut;
		const expectedValue = Math.round(
			data.originalWordCount - expectedProgress * (data.originalWordCount - data.plainWordCount)
		);
		expect(countdownValueAtFrame(midFrame, cutFrame, data)).toBe(expectedValue);
	});
});

describe('gateOpening / assertOpeningRenderable — eligibility', () => {
	it('rejects an opening a real pool entry is NOT eligible for', () => {
		const entry = POOL.find((e) => e.card_id === 'discourses-63-004');
		expect(entry).toBeDefined();
		expect(entry!.eligible_openings).toEqual(['standard']);

		const countdownResult = gateOpening(entry as WallOpeningEligibilityEntry, 'countdown');
		expect(countdownResult.ok).toBe(false);

		const gradeResult = gateOpening(entry as WallOpeningEligibilityEntry, 'grade');
		expect(gradeResult.ok).toBe(false);

		expect(() => assertOpeningRenderable(entry as WallOpeningEligibilityEntry, 'countdown')).toThrow();
		expect(() => assertOpeningRenderable(entry as WallOpeningEligibilityEntry, 'grade')).toThrow();
	});

	it('accepts an opening the entry IS eligible for', () => {
		const entry = POOL.find((e) => e.card_id === 'discourses-63-004');
		const result = gateOpening(entry as WallOpeningEligibilityEntry, 'standard');
		expect(result.ok).toBe(true);
		expect(() => assertOpeningRenderable(entry as WallOpeningEligibilityEntry, 'standard')).not.toThrow();
	});

	it('the backstop rejects countdown when the plain version is not materially shorter, even if eligible_openings says yes', () => {
		const entry: WallOpeningEligibilityEntry = {
			card_id: 'synthetic-not-shorter',
			eligible_openings: ['standard', 'countdown']
		};
		const result = gateOpening(entry, 'countdown', { originalWordCount: 100, plainWordCount: 90 });
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.reason).toMatch(/shorter/);
		}
	});

	it('the backstop accepts countdown right at the documented threshold', () => {
		const entry: WallOpeningEligibilityEntry = {
			card_id: 'synthetic-at-threshold',
			eligible_openings: ['standard', 'countdown']
		};
		const result = gateOpening(entry, 'countdown', {
			originalWordCount: 100,
			plainWordCount: 100 - WALL_COUNTDOWN_DELTA_MIN
		});
		expect(result.ok).toBe(true);
	});
});

describe('rotateOpening — deterministic three-way rotation', () => {
	it('WALL_OPENINGS lists exactly the three openings the rotation cycles through', () => {
		expect(WALL_OPENINGS).toEqual(['standard', 'countdown', 'grade']);
	});

	it('cycles through all three openings in order', () => {
		expect(rotateOpening(0)).toBe('standard');
		expect(rotateOpening(1)).toBe('countdown');
		expect(rotateOpening(2)).toBe('grade');
		expect(rotateOpening(3)).toBe('standard');
	});

	it('is deterministic — the same seed always returns the same opening', () => {
		for (let seed = 0; seed < 20; seed++) {
			expect(rotateOpening(seed)).toBe(rotateOpening(seed));
		}
	});

	it('never calls Math.random anywhere in its own module', () => {
		const source = readFileSync(path.join(moduleDir, '..', 'wall-openings.ts'), 'utf-8');
		expect(source).not.toMatch(/Math\.random/);
	});

	it('wraps correctly for negative seeds too', () => {
		expect(rotateOpening(-1)).toBe(rotateOpening(2));
		expect(rotateOpening(-3)).toBe(rotateOpening(0));
	});
});

describe('vocabulary guard — the grade opening is a bare measurement, never a difficulty claim', () => {
	// Tests what actually REACHES THE SCREEN — `formatGradeLabel`'s output —
	// rather than scanning whole source files, which would also flag
	// unrelated prose no viewer ever sees (e.g. `Wall.tsx`'s own "hard cut"
	// comment, or this module's "hardcoded"). `Wall.tsx` calls ONLY this
	// function to build the grade label (see the Wall.tsx source excerpt
	// asserted below), so this is the complete set of on-screen outcomes.
	const realGrades = [1, 5, 8, 12, 14, 16, 20, 25];

	for (const grade of realGrades) {
		it(`"Grade ${grade}" contains none of the forbidden vocabulary`, () => {
			const label = formatGradeLabel(grade);
			for (const word of FORBIDDEN_GRADE_VOCABULARY) {
				expect(label.toLowerCase()).not.toContain(word.toLowerCase());
			}
		});
	}

	it('is exactly "Grade <number>" — no suffix, no parenthetical, no adjective can be appended', () => {
		expect(formatGradeLabel(14)).toBe('Grade 14');
		expect(formatGradeLabel(14)).toMatch(/^Grade \d+$/);
	});

	it('the countdown label is a bare number — same structural guarantee', () => {
		expect(formatCountdownLabel(97)).toBe('97');
		expect(formatCountdownLabel(97)).toMatch(/^\d+$/);
	});

	it('Wall.tsx renders "Grade" as GRADE_LABEL_PREFIX, a hardcoded constant, never a hand-rolled template', () => {
		const wallSource = readFileSync(path.join(moduleDir, '..', 'Wall.tsx'), 'utf-8');
		expect(wallSource).toMatch(/GRADE_LABEL_PREFIX/);
		// No inline `Grade ${` (or similar concatenation) anywhere in the
		// file — `GRADE_LABEL_PREFIX` (imported from `wall-openings.ts`) is
		// the only source of that word, and the numeral is passed to
		// `WallOpeningBadge` separately as `value`, never concatenated onto
		// it — see that component's own doc comment for why the two are
		// rendered as visually distinct pieces (a small sub-label, a
		// dominant numeral) rather than one string.
		expect(wallSource).not.toMatch(/`Grade \$\{/);
		expect(wallSource).not.toMatch(/'Grade '\s*\+/);
	});
});

describe('eligibility counts across the real pool', () => {
	it('reports how many entries are eligible for each opening', () => {
		const counts: Record<WallOpening, number> = { standard: 0, countdown: 0, grade: 0 };
		for (const entry of POOL) {
			for (const opening of entry.eligible_openings) {
				counts[opening]++;
			}
		}
		// Every entry is always eligible for `standard`.
		expect(counts.standard).toBe(POOL.length);
		// `countdown`/`grade` are conditional — strictly fewer than the pool.
		expect(counts.countdown).toBeGreaterThan(0);
		expect(counts.countdown).toBeLessThan(POOL.length);
		expect(counts.grade).toBeGreaterThan(0);
		expect(counts.grade).toBeLessThan(POOL.length);
		// eslint-disable-next-line no-console
		console.log(
			`Wall pool (${POOL.length} entries) opening eligibility — standard: ${counts.standard}, ` +
				`countdown: ${counts.countdown}, grade: ${counts.grade}`
		);
	});
});

describe('source guard — no overshoot easing anywhere in the opening badge', () => {
	const wallSource = readFileSync(path.join(moduleDir, '..', 'Wall.tsx'), 'utf-8');

	it('never calls spring( for the opening badge (already asserted for the whole file, kept here for locality)', () => {
		expect(wallSource).not.toMatch(/\bspring\s*\(/);
	});
});

describe('end-to-end smoke: all three openings render from one real eligible card', () => {
	it(
		'renders frame 0 of each opening at 1080x1920, using an entry eligible for all three',
		async () => {
			const poolEntry = POOL.find((e) => e.card_id === 'meditations-07-031');
			expect(poolEntry).toBeDefined();
			expect(poolEntry!.eligible_openings.sort()).toEqual(['countdown', 'grade', 'standard']);

			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				outDir: path.join(bundleDir, 'eligible'),
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

			const openings: WallOpening[] = ['standard', 'countdown', 'grade'];
			for (const opening of openings) {
				const inputProps = {
					originalExcerpt: FIXTURE_CARD.original_excerpt,
					landingLine: FIXTURE_LANDING_LINE,
					plainLines: FIXTURE_PLAIN_LINES,
					author: FIXTURE_CARD.author_slug,
					opening,
					eligibleOpenings: poolEntry!.eligible_openings
				};

				const composition = await selectComposition({
					serveUrl: bundleLocation,
					id: 'Wall',
					inputProps
				});

				const outPath = path.join(os.tmpdir(), `plain-wall-opening-${opening}-${Date.now()}.png`);
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
			}
		},
		180_000
	);

	it(
		'rejects an opening the entry is not eligible for BEFORE producing any frame',
		async () => {
			const ineligibleEntry = POOL.find((e) => e.card_id === 'discourses-63-004');
			expect(ineligibleEntry).toBeDefined();
			expect(ineligibleEntry!.eligible_openings).toEqual(['standard']);

			const bundleLocation = await bundle({
				entryPoint: path.join(moduleDir, '..', 'entry.tsx'),
				outDir: path.join(bundleDir, 'rejected'),
				webpackOverride: (config) => ({
					...config,
					resolve: {
						...config.resolve,
						extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
					}
				})
			});

			const inputProps = {
				originalExcerpt: FIXTURE_CARD.original_excerpt,
				landingLine: FIXTURE_LANDING_LINE,
				plainLines: FIXTURE_PLAIN_LINES,
				author: FIXTURE_CARD.author_slug,
				opening: 'countdown' as WallOpening,
				eligibleOpenings: ineligibleEntry!.eligible_openings
			};

			const composition = await selectComposition({
				serveUrl: bundleLocation,
				id: 'Wall',
				inputProps
			});

			const outPath = path.join(os.tmpdir(), `plain-wall-opening-rejected-${Date.now()}.png`);
			await expect(
				renderStill({
					composition,
					serveUrl: bundleLocation,
					output: outPath,
					frame: 0,
					inputProps,
					imageFormat: 'png'
				})
			).rejects.toThrow();
		},
		120_000
	);
});
