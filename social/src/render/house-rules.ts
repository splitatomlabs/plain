/**
 * THE HOUSE RULE — asymmetric motion (see `plans/Pf39c2-social-pilot-index.md`):
 * "The archaic side moves. The plain side does not." It reduces to exactly
 * three CHECKABLE rules:
 *
 *   1. No easing with overshoot, ANYWHERE.
 *   2. The payoff frame has ZERO motion for >= 2.5s.
 *   3. TTS pitch and rate never below default — no "wise deep voice".
 *
 * This module is the SINGLE place all three are automated. The Wall's own
 * tests (`wall-timing.test.ts`) already carry ad-hoc, per-file versions of
 * rules 1 and 2 — those are left in place as a first line of defense, but
 * this module is the centralised, format-agnostic layer: `checkAllFormats`
 * is what a new composition cannot be added without going through (see its
 * doc comment for exactly how that's enforced).
 *
 * Pf39c2-social-pilot-02a D01: Question, Objection and Still were deleted
 * outright — the channel is one Wall a day. `FORMATS` below is Wall-only now.
 *
 * Rule 3 already has a single canonical guard —
 * `assertVoiceSettingsWithinHouseRule` in `../audio/tts.ts` — this module
 * never duplicates it, only wraps it in the same `{ passed, violations }`
 * report shape the other two rules use.
 */

import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertVoiceSettingsWithinHouseRule, type VoiceSettingsInput } from '../audio/tts.js';
import { FPS, computeWallTiming } from '../remotion/wall-timing.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/remotion` — every composition source file lives here. */
const REMOTION_SRC_DIR = path.resolve(moduleDir, '..', 'remotion');

// ---------------------------------------------------------------------------
// Shared report shape
// ---------------------------------------------------------------------------

export type HouseRuleNumber = 1 | 2 | 3;

export interface HouseRuleViolation {
	rule: HouseRuleNumber;
	/** The file (or, for rule 2/3, the logical source) the violation was found in. */
	file: string;
	detail: string;
}

export interface HouseRuleCheckResult {
	passed: boolean;
	violations: HouseRuleViolation[];
}

// ---------------------------------------------------------------------------
// Rule 1 — no easing with overshoot, ANYWHERE
// ---------------------------------------------------------------------------

/**
 * Strips `//` line comments, `/* *\/` block comments, and skips over
 * string/template-literal contents (so a comment delimiter or forbidden
 * pattern quoted inside a string is never treated as live code either) so a
 * file that DOCUMENTS the house rule — quoting `spring(` or `Easing.back`
 * in its own doc comments — never fails its own check. This is a small,
 * deliberately conservative state machine (no regex-literal handling; this
 * codebase's `.ts`/`.tsx` sources don't need it), not a full tokenizer.
 */
export function stripComments(source: string): string {
	let out = '';
	let i = 0;
	const n = source.length;
	let inLineComment = false;
	let inBlockComment = false;
	let inString: '"' | "'" | '`' | null = null;

	while (i < n) {
		const c = source[i];
		const next = source[i + 1];

		if (inLineComment) {
			if (c === '\n') {
				inLineComment = false;
				out += c;
			}
			i += 1;
			continue;
		}

		if (inBlockComment) {
			if (c === '*' && next === '/') {
				inBlockComment = false;
				i += 2;
				continue;
			}
			// A block comment still occupies lines — keep line numbers stable
			// for anyone reading a violation's detail against the original file.
			if (c === '\n') {
				out += c;
			}
			i += 1;
			continue;
		}

		if (inString) {
			out += c;
			if (c === '\\' && next !== undefined) {
				out += next;
				i += 2;
				continue;
			}
			if (c === inString) {
				inString = null;
			}
			i += 1;
			continue;
		}

		if (c === '/' && next === '/') {
			inLineComment = true;
			i += 2;
			continue;
		}
		if (c === '/' && next === '*') {
			inBlockComment = true;
			i += 2;
			continue;
		}
		if (c === '"' || c === "'" || c === '`') {
			inString = c;
			out += c;
			i += 1;
			continue;
		}

		out += c;
		i += 1;
	}

	return out;
}

interface OvershootPattern {
	name: string;
	description: string;
	/** Returns one human-readable detail per match found in already-comment-stripped source. */
	scan(strippedSource: string): string[];
}

function literalPattern(name: string, description: string, regex: RegExp): OvershootPattern {
	return {
		name,
		description,
		scan(strippedSource) {
			const flags = regex.flags.includes('g') ? regex.flags : `${regex.flags}g`;
			const matches = strippedSource.match(new RegExp(regex.source, flags)) ?? [];
			return matches.map((match) => `matched \`${match}\``);
		}
	};
}

/**
 * The forbidden motion vocabulary. Named, documented patterns — not a bare
 * list of strings — so a violation's `detail` can explain WHY the pattern
 * is forbidden, not just that it matched.
 */
export const OVERSHOOT_PATTERNS: OvershootPattern[] = [
	literalPattern(
		'spring(',
		"Remotion's spring() defaults to a physically-overshooting curve (it " +
			'settles past 1 before returning) — forbidden outright, tuned damping ' +
			'included, because the house rule bans the PRIMITIVE, not just its default config.',
		/\bspring\s*\(/
	),
	literalPattern(
		'Easing.back',
		"Remotion/CSS's back easing overshoots past its target before landing, by definition.",
		/\bEasing\.back\b/
	),
	literalPattern(
		'Easing.elastic',
		'Elastic easing oscillates past its target multiple times before settling — overshoot, repeated.',
		/\bEasing\.elastic\b/
	),
	literalPattern(
		'Easing.bounce',
		'Bounce easing overshoots its target and springs back on each bounce.',
		/\bEasing\.bounce\b/
	),
	{
		name: 'cubic-bezier(...) with an out-of-range control point',
		description:
			'A cubic-bezier(x1, y1, x2, y2) easing curve is a mathematical ' +
			'function from progress to output; when a Y control point (y1 or y2) ' +
			'falls outside [0, 1], the curve is guaranteed to produce an output ' +
			'value below 0 or above 1 at some point in [0, 1] progress — i.e. the ' +
			'animated value overshoots past its start or end value before landing. ' +
			'A Y control point outside [0, 1] is exactly what "overshoot" means ' +
			'numerically for a bezier easing curve, so this parses the four control ' +
			'points rather than string-matching the function name.',
		scan(strippedSource) {
			const details: string[] = [];
			const re = /cubic-bezier\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/g;
			let match: RegExpExecArray | null;
			while ((match = re.exec(strippedSource)) !== null) {
				const [full, x1, y1, x2, y2] = match;
				const outOfRange = [Number(y1), Number(y2)].filter((y) => y < 0 || y > 1);
				if (outOfRange.length > 0) {
					details.push(
						`overshooting \`${full}\` — Y control point ${outOfRange[0]} is outside [0, 1] (x1=${x1}, y1=${y1}, x2=${x2}, y2=${y2})`
					);
				}
			}
			return details;
		}
	}
];

/**
 * Rule 1. Strips comments (see `stripComments`) before scanning
 * `sourceText` for any pattern in `OVERSHOOT_PATTERNS`. `fileName` is
 * carried through only for reporting.
 */
export function checkNoOvershootEasing(sourceText: string, fileName: string): HouseRuleCheckResult {
	const stripped = stripComments(sourceText);
	const violations: HouseRuleViolation[] = [];

	for (const pattern of OVERSHOOT_PATTERNS) {
		for (const detail of pattern.scan(stripped)) {
			violations.push({
				rule: 1,
				file: fileName,
				detail: `${pattern.name} — ${detail} (${pattern.description})`
			});
		}
	}

	return { passed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Rule 2 — the payoff frame has ZERO motion for >= 2.5s
// ---------------------------------------------------------------------------

/** The house rule's own floor, named rather than inlined at every call site. */
export const PAYOFF_MIN_MOTIONLESS_SECONDS = 2.5;

/**
 * The shape every format's timing schedule already uses for a phase window
 * (`WallPhaseWindow`, `QuestionPhaseWindow`, `ObjectionPhaseWindow` are all
 * structurally this). `motionSamples`, if present, is a probe of whatever
 * per-frame value actually drives this window's visuals (e.g. a scale or
 * opacity function sampled across its frames) — absent means the window's
 * renderer takes no frame-dependent prop at all, which is true of every
 * real payoff phase today (`PayoffLine` in `Wall.tsx` takes no `frame`
 * argument whatsoever), so "absent" is treated as "no motion", not
 * "unknown".
 */
export interface PhaseWindowLike {
	startFrame: number;
	endFrame: number;
	motionless: boolean;
	motionSamples?: number[];
}

function isPhaseWindowLike(value: unknown): value is PhaseWindowLike {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.startFrame === 'number' &&
		typeof candidate.endFrame === 'number' &&
		typeof candidate.motionless === 'boolean'
	);
}

/**
 * Recursively walks an arbitrary timing schedule — any shape, since
 * `WallTimingSchedule`, `QuestionTimingSchedule` and `ObjectionTimingSchedule`
 * all nest their phase windows differently (a flat set of fields, an array,
 * a fixed tuple) — collecting every value that duck-types as a phase
 * window. This is what lets `checkPayoffMotionless` accept any format's
 * schedule without a per-format adapter.
 */
function collectPhaseWindows(
	value: unknown,
	pathLabel: string,
	out: Array<{ pathLabel: string; window: PhaseWindowLike }>
): void {
	if (isPhaseWindowLike(value)) {
		out.push({ pathLabel, window: value });
		return;
	}
	if (Array.isArray(value)) {
		value.forEach((item, index) => collectPhaseWindows(item, `${pathLabel}[${index}]`, out));
		return;
	}
	if (typeof value === 'object' && value !== null) {
		for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
			collectPhaseWindows(nested, pathLabel ? `${pathLabel}.${key}` : key, out);
		}
	}
}

/**
 * Rule 2. Walks `timing` (any format's schedule, or a synthetic fixture in
 * the same shape) for every phase window.
 *
 * Two checks, with different scope, because "motionless" and "the payoff
 * frame" are not the same thing in this codebase:
 *
 *   - NO MOTION applies to every window flagged `motionless: true`,
 *     wherever it falls in the schedule — a still window with motion
 *     recorded as driven over its frames (see `PhaseWindowLike
 *     .motionSamples`) is always a violation.
 *   - The >= `PAYOFF_MIN_MOTIONLESS_SECONDS` DURATION floor applies only to
 *     "the payoff frame" itself — the still window(s) that come after the
 *     schedule's last moving (`motionless: false`) phase, or every window
 *     when the schedule has no moving phase at all (The Objection never
 *     moves anything, ever — see `objection-timing.ts`'s file comment).
 *     This is what keeps The Question's opening hold — deliberately held
 *     for only `QUESTION_HOLD_SECONDS` (1.5s), tied to its OWN "legible and
 *     answerable within 1.5s" acceptance criterion, not the house rule's
 *     payoff floor — from being misidentified as a too-short payoff. Its
 *     `answer` phase, which comes after the moving wall, is what this rule
 *     actually measures against 2.5s. See `question-timing.ts`'s doc
 *     comments on `QUESTION_HOLD_SECONDS` and `ANSWER_MIN_SECONDS` for the
 *     source of this distinction.
 *
 * `label` is only for reporting — it names the schedule being checked
 * (e.g. `"wall-timing.ts"`), since a schedule has no filename of its own
 * the way rule 1's source text does.
 */
export function checkPayoffMotionless(timing: unknown, label = 'timing'): HouseRuleCheckResult {
	const windows: Array<{ pathLabel: string; window: PhaseWindowLike }> = [];
	collectPhaseWindows(timing, label, windows);

	const violations: HouseRuleViolation[] = [];

	if (windows.length === 0) {
		// A schedule with literally no phase windows at all almost certainly
		// means the shape changed underneath this checker — fail loudly
		// rather than silently reporting a clean pass on nothing.
		violations.push({
			rule: 2,
			file: label,
			detail: 'no phase windows (fields shaped like { startFrame, endFrame, motionless }) were found in this schedule'
		});
		return { passed: false, violations };
	}

	// Temporal order is what "after the last moving phase" means — the
	// nested shape each format nests its windows in (flat fields, arrays,
	// tuples) carries no ordering guarantee of its own.
	const sorted = [...windows].sort((a, b) => a.window.startFrame - b.window.startFrame);
	const lastMovingIndex = sorted.reduce(
		(lastIndex, entry, index) => (entry.window.motionless === false ? index : lastIndex),
		-1
	);

	sorted.forEach(({ pathLabel, window }, index) => {
		if (!window.motionless) {
			return;
		}

		if (window.motionSamples && new Set(window.motionSamples).size > 1) {
			violations.push({
				rule: 2,
				file: label,
				detail: `${pathLabel} is flagged motionless but motion is driven over its frames (samples: ${window.motionSamples.join(', ')})`
			});
		}

		const isPayoffWindow = index > lastMovingIndex;
		if (!isPayoffWindow) {
			return;
		}

		const seconds = (window.endFrame - window.startFrame) / FPS;
		if (seconds < PAYOFF_MIN_MOTIONLESS_SECONDS) {
			violations.push({
				rule: 2,
				file: label,
				detail: `${pathLabel} is a payoff phase (motionless, after the last moving phase) but only holds for ${seconds.toFixed(2)}s — below the ${PAYOFF_MIN_MOTIONLESS_SECONDS}s floor`
			});
		}
	});

	return { passed: violations.length === 0, violations };
}

// ---------------------------------------------------------------------------
// Rule 3 — TTS pitch and rate never below default
// ---------------------------------------------------------------------------

/**
 * Rule 3. Delegates to `assertVoiceSettingsWithinHouseRule` in
 * `../audio/tts.ts` — the single canonical guard both TTS providers already
 * call before synthesizing anything — and reshapes its throw-or-not-throw
 * contract into the same `{ passed, violations }` report the other two
 * rules return. Never reimplements the pitch/rate comparison itself.
 */
export function checkTtsWithinHouseRule(settings: VoiceSettingsInput | undefined): HouseRuleCheckResult {
	try {
		assertVoiceSettingsWithinHouseRule(settings);
		return { passed: true, violations: [] };
	} catch (error) {
		return {
			passed: false,
			violations: [
				{
					rule: 3,
					file: 'audio/tts.ts',
					detail: error instanceof Error ? error.message : String(error)
				}
			]
		};
	}
}

// ---------------------------------------------------------------------------
// checkAllFormats — rules 1 and 2, across every format
// ---------------------------------------------------------------------------

/**
 * Every format's payoff schedule, keyed by the SAME `id` string Root.tsx
 * registers its `<Composition id="...">` under. This registry can't be
 * discovered purely from disk the way rule 1's file scan is — each
 * `computeXTiming` has a different signature (Wall needs an excerpt and
 * lines, Question needs a question, Objection needs nothing) — so it's
 * hand-maintained. `assertRegistryCoversRootCompositions` below is what
 * stops that hand-maintenance from silently rotting: it cross-checks these
 * ids against Root.tsx's OWN registrations and THROWS the moment a
 * composition exists there with no matching entry here.
 */
interface FormatEntry {
	id: string;
	/** Name used only for reporting — the timing module this format's schedule comes from. */
	timingModuleFile: string;
	computeTiming(): unknown;
}

const FORMATS: FormatEntry[] = [
	{
		id: 'Wall',
		timingModuleFile: 'wall-timing.ts',
		computeTiming: () =>
			computeWallTiming({
				originalExcerpt:
					'This is placeholder archaic text standing in for a real card excerpt, ' +
					'used only so a representative schedule can be computed for the house-rule check.',
				plainLines: ['This is the rest of the plain passage.', 'And a second still line, for good measure.']
			})
	}
];

/**
 * Scans a block of Root.tsx source starting at each `<Composition` opening
 * for its `id="..."` attribute. Deliberately does not try to match the
 * whole JSX tag with a single regex bounded by `<...>` — `<Composition<any,
 * WallProps>` contains a `>` from its own generic argument list before the
 * attributes even start, which would break a naive "everything up to the
 * next >" match.
 */
export function discoverRegisteredCompositionIds(rootSource: string): string[] {
	const stripped = stripComments(rootSource);
	const starts = [...stripped.matchAll(/<Composition\b/g)].map((match) => match.index ?? 0);
	if (starts.length === 0) {
		throw new Error(
			'house-rules.ts: found no <Composition> registrations in Root.tsx — the discovery regex may be stale, or Root.tsx moved.'
		);
	}

	return starts.map((start, i) => {
		const end = i + 1 < starts.length ? starts[i + 1] : stripped.length;
		const block = stripped.slice(start, end);
		const match = block.match(/\bid="([^"]+)"/);
		if (!match) {
			throw new Error(
				`house-rules.ts: found a <Composition> registration in Root.tsx with no id="..." attribute (near character ${start}) — cannot identify this format.`
			);
		}
		return match[1];
	});
}

/**
 * Throws (never returns a quietly-passing report) the moment Root.tsx
 * registers a composition id with no matching entry in `FORMATS` — this is
 * how "a format added later with no entry here must make this fail loudly,
 * not pass silently" is achieved. A missing entry can't produce a report
 * with `passed: true` OR a `passed: false` that a caller might ignore; it
 * stops `checkAllFormats` from completing at all.
 */
export function assertRegistryCoversRootCompositions(rootSource: string, knownFormatIds: string[] = FORMATS.map((format) => format.id)): void {
	const registeredIds = discoverRegisteredCompositionIds(rootSource);
	const knownIds = new Set(knownFormatIds);
	const missing = registeredIds.filter((id) => !knownIds.has(id));

	if (missing.length > 0) {
		throw new Error(
			`checkAllFormats: Root.tsx registers ${JSON.stringify(missing)} with no matching entry in ` +
				"house-rules.ts's FORMATS registry — a new composition cannot be added without teaching " +
				'this checker its payoff schedule. Add an entry to FORMATS in social/src/render/house-rules.ts.'
		);
	}
}

function discoverRemotionSourceFiles(): string[] {
	return readdirSync(REMOTION_SRC_DIR, { withFileTypes: true })
		.filter((entry) => entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')))
		.map((entry) => entry.name)
		.sort();
}

/**
 * Runs rules 1 and 2 across every format. Rule 1 scans every `.ts`/`.tsx`
 * file directly inside `social/src/remotion` — discovered from disk with
 * `readdirSync`, not a hardcoded list, so a brand-new composition, gate, or
 * timing module file is scanned the instant it's added, with nothing to
 * remember to update. Rule 2 runs each format's `computeXTiming` (via the
 * `FORMATS` registry — see its doc comment for why this piece can't be
 * fully disk-discovered, and how it's still made to fail loudly when it
 * falls out of sync with Root.tsx).
 *
 * Rule 3 is intentionally NOT run here — it checks a runtime TTS call, not
 * a composition source file or a timing schedule, so it has no format to
 * iterate over. Call `checkTtsWithinHouseRule` directly at the TTS
 * call-site (both providers in `../audio/tts.ts` already do, via
 * `assertVoiceSettingsWithinHouseRule`).
 */
export function checkAllFormats(): HouseRuleCheckResult {
	const rootSource = readFileSync(path.join(REMOTION_SRC_DIR, 'Root.tsx'), 'utf-8');
	assertRegistryCoversRootCompositions(rootSource);

	const violations: HouseRuleViolation[] = [];

	for (const fileName of discoverRemotionSourceFiles()) {
		const source = readFileSync(path.join(REMOTION_SRC_DIR, fileName), 'utf-8');
		violations.push(...checkNoOvershootEasing(source, fileName).violations);
	}

	for (const format of FORMATS) {
		violations.push(...checkPayoffMotionless(format.computeTiming(), format.timingModuleFile).violations);
	}

	return { passed: violations.length === 0, violations };
}
