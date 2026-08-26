/**
 * The Wall's three-way OPENING ROTATION (T17) — same pool, same reveal,
 * different first 2s. See the index plan's "Opening rotation for The Wall"
 * for the mechanic and its CONSTRAINT 6 RULING for why the numerals here
 * are framing text, not quoted content:
 *
 *   "Any text presented as the author's words must be VERBATIM from the
 *   card. Framing text is permitted if it is (a) visually distinct from
 *   quoted content, (b) factually true, and (c) not attributed to the
 *   author."
 *
 * The three openings:
 *   - `standard`  — the packed wall exactly as `Wall.tsx` renders it today.
 *     Unchanged.
 *   - `countdown` — "190 -> 97": the original's word count as a large
 *     numeral, counting down live in step with the wall's scroll (F15) and
 *     landing on the plain version's word count, so the first frame
 *     carries a number instead of a wall.
 *   - `grade`     — "Grade 14": the original's computed reading grade,
 *     shown as a BARE MEASUREMENT, never a claim about difficulty.
 *     ORIGINAL ONLY — the plain side is always 4-6, so showing it would be
 *     a comparison the plan does not sanction.
 *
 * Every numeral here is (a) rendered by `Wall.tsx` in `Counter.tsx`'s DM
 * Sans face, never `SERIF_STACK`, and never inside `WallPhase`'s quoted
 * block; (b) COMPUTED from the real card, never hardcoded; (c) unattributed
 * — no "Marcus wrote...", just a number.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only), mirroring
 * `wall-gate.ts` — `Wall.tsx` imports this module directly and it gets
 * bundled by Remotion's browser-side webpack build. `text-readability` is
 * plain ESM with no Node built-ins (see `social/node_modules/
 * text-readability/main.js`), so it bundles cleanly too.
 */

// @ts-expect-error — text-readability has no type declarations, same as
// `scripts/lib/premises.ts` and `scripts/lib/validate.ts` in the root
// content pipeline.
import rs from 'text-readability';

import { splitWords, wallScrollOffsetAtFrame } from './wall-timing.js';

export type WallOpening = 'standard' | 'countdown' | 'grade';

/** Every opening, in rotation order — the single source of truth `rotateOpening` cycles through. */
export const WALL_OPENINGS: readonly WallOpening[] = ['standard', 'countdown', 'grade'];

// ---------------------------------------------------------------------------
// Computed opening data — everything on screen must be COMPUTED, never
// hardcoded (CONSTRAINT 6's "factually true").
// ---------------------------------------------------------------------------

export interface OpeningData {
	originalWordCount: number;
	plainWordCount: number;
	/**
	 * The original excerpt's Flesch-Kincaid grade level, via the SAME
	 * `text-readability` call the content pipeline uses
	 * (`scripts/lib/validate.ts`'s `validateReadability`,
	 * `scripts/lib/premises.ts`'s `originalReadingGrade`) — kept identical
	 * so the number on screen matches the number the pipeline would report
	 * for this excerpt. `fleschKincaidGrade` already rounds to one decimal
	 * internally (`Math.legacyRound(flesch, 1)` in `text-readability`'s own
	 * source); this rounds that ONE FURTHER step to the nearest whole grade
	 * ("Grade 14", not "Grade 14.2") — the plan's own example ("Grade 14")
	 * is a bare integer, and a decimal reads as false precision for a
	 * numeral shown on screen for well under a second.
	 */
	originalGrade: number;
}

/**
 * Computes every number the two numeric openings can show, from the real
 * card text — never hardcoded. `plainText` is the full plain passage (the
 * card's `plain_english`, or an equivalent reconstruction such as
 * `[landingLine, ...plainLines].join(' ')` — see `Wall.tsx`), not just the
 * landing line, so `plainWordCount` matches the same
 * `wordCount(card.plain_english)` the root pipeline's `lengthDelta` uses.
 */
export function computeOpeningData(originalExcerpt: string, plainText: string): OpeningData {
	const pipelineGrade: number = rs.fleschKincaidGrade(originalExcerpt);
	return {
		originalWordCount: splitWords(originalExcerpt).length,
		plainWordCount: splitWords(plainText).length,
		originalGrade: Math.round(pipelineGrade)
	};
}

// ---------------------------------------------------------------------------
// Countdown numeral — tracks SCROLL PROGRESS, not a second clock
// ---------------------------------------------------------------------------
//
// social pilot 02 F15 (2026-08-26): the countdown numeral used to track how
// many words the karaoke highlight had swept. The karaoke highlight is gone
// — the wall's only motion now is the scroll (`wallScrollOffsetAtFrame` in
// `wall-timing.ts`) — so the numeral is re-derived from SCROLL PROGRESS
// instead: the same fraction-of-the-way-through-the-wall-phase signal that
// now drives what's on screen. It still starts at `originalWordCount` at
// frame 0 and lands exactly on `plainWordCount` at the cut (CONSTRAINT 6's
// "factually true" numerals, unchanged).

/**
 * The countdown numeral's value at `frame` within the wall phase —
 * "190 -> 97": `data.originalWordCount` at frame 0, landing exactly on
 * `data.plainWordCount` at `cutFrame` (the LAST frame the wall phase
 * renders — `Wall.tsx` passes `timing.wall.endFrame - 1`, since
 * `timing.wall.endFrame` itself is already the payoff phase).
 *
 * The interpolation parameter is scroll progress — `wallScrollOffsetAtFrame`
 * at `frame`, over its own value at `cutFrame` — NOT a raw word-count
 * subtraction and not a frame-count fraction: `wallScrollOffsetAtFrame` is
 * linear in `frame` (see that function's doc comment), so in practice this
 * reduces to the same thing as a frame fraction, but reading it from the
 * scroll function directly (rather than re-deriving an equivalent formula
 * here) is what keeps this numeral structurally unable to drift out of step
 * if the scroll's own rate function ever changes shape.
 *
 * Unlike the old karaoke-driven version, no baseline subtraction is needed:
 * `wallScrollOffsetAtFrame(0)` is exactly `0` (the scroll has covered zero
 * distance at frame 0 — see that function's "already at full velocity, but
 * zero distance so far" doc comment), so progress is already exactly `0` at
 * frame 0 without correcting for an off-by-one baseline.
 */
export function countdownValueAtFrame(
	frame: number,
	cutFrame: number,
	data: Pick<OpeningData, 'originalWordCount' | 'plainWordCount'>
): number {
	const offsetAtCut = wallScrollOffsetAtFrame(cutFrame);
	if (offsetAtCut <= 0) {
		// Degenerate — `cutFrame` is at or before frame 0, so the scroll
		// hasn't moved at all. Hold at the original count rather than
		// dividing by zero.
		return data.originalWordCount;
	}
	const offsetNow = wallScrollOffsetAtFrame(Math.min(frame, cutFrame));
	const progress = Math.min(1, Math.max(0, offsetNow / offsetAtCut));
	const value = data.originalWordCount - progress * (data.originalWordCount - data.plainWordCount);
	return Math.round(value);
}

// ---------------------------------------------------------------------------
// On-screen label formatting — the ONLY place these strings are built
// ---------------------------------------------------------------------------

/**
 * The countdown numeral's on-screen text. Deliberately just the number —
 * `Wall.tsx` renders this alone, at dominant size, directly over the wall
 * (no unit, no label, no sign concatenated onto it), so there is nowhere
 * for framing prose (let alone an attribution) to sneak in.
 */
export function formatCountdownLabel(value: number): string {
	return String(value);
}

/**
 * The grade opening's small sub-label, exactly as `Wall.tsx`'s
 * `WallOpeningBadge` renders it — a constant, never composed from card
 * data, so it can never drift into a claim about difficulty. Rendered much
 * smaller than (and above) the numeral itself: "Grade" is context, the
 * number is the subject.
 */
export const GRADE_LABEL_PREFIX = 'Grade';

/**
 * The grade opening's FULL on-screen text as a single string — "Grade 14",
 * never "Grade 14.2" and never "Grade 14 (hard)" or similar. `Wall.tsx`
 * itself renders "Grade" and the number as two separately-sized elements
 * (`GRADE_LABEL_PREFIX` as the small sub-label, the number at dominant
 * size) rather than this single string, but the concatenation is kept here
 * too as the canonical combined form other callers (logging, the CLI) can
 * reach for. Either way the bare-measurement guarantee is structural: the
 * only pieces that can ever appear are the literal word "Grade" and
 * `grade` — nothing else, which is what makes `FORBIDDEN_GRADE_VOCABULARY`
 * below trivially satisfied rather than merely asserted.
 */
export function formatGradeLabel(grade: number): string {
	return `${GRADE_LABEL_PREFIX} ${grade}`;
}

// ---------------------------------------------------------------------------
// The grade opening's bare-measurement vocabulary guard
// ---------------------------------------------------------------------------

/**
 * The grade opening is a BARE MEASUREMENT, never a claim about difficulty —
 * "no 'hard', no 'difficult', no 'most people can't read this', no
 * adjective at all. A number and the word 'Grade'." `wall-openings.test.ts`
 * asserts `formatGradeLabel`'s OUTPUT (across a range of real and synthetic
 * grades) never contains any of these strings (case-insensitively) — a
 * check on what actually reaches the screen, not a whole-file text scan
 * (which would also flag unrelated prose like this file's own "hardcoded"
 * or `Wall.tsx`'s "hard cut"). Exported so the test imports the same list
 * this comment describes.
 */
export const FORBIDDEN_GRADE_VOCABULARY = [
	'hard',
	'difficult',
	'difficulty',
	'tough',
	'tricky',
	"can't read",
	'cannot read',
	'challenging',
	'complex',
	'complicated',
	'dense',
	'impenetrable',
	'advanced'
] as const;

// ---------------------------------------------------------------------------
// Eligibility gate
// ---------------------------------------------------------------------------

/**
 * The minimal shape `gateOpening` needs from a `content/social/premises/
 * wall.json` entry (see `scripts/lib/premises.ts`'s `RankedWallEntry`) —
 * just enough that a real pool entry satisfies this structurally, without
 * this fs-free module importing anything from the root pipeline.
 */
export interface WallOpeningEligibilityEntry {
	card_id?: string;
	eligible_openings: readonly WallOpening[];
}

export type GateOpeningResult = { ok: true } | { ok: false; reason: string };

/**
 * Minimum `originalWordCount - plainWordCount` for the countdown numeral to
 * be worth showing — below this it barely moves between frame 0 and the
 * cut. Mirrors `WALL_COUNTDOWN_DELTA_MIN` in the content pipeline's
 * `scripts/lib/premises.ts` — the SAME threshold that already decided this
 * entry's precomputed `eligible_openings`, kept identical (not re-derived)
 * so this backstop check and the pool's own flag can never disagree.
 */
export const WALL_COUNTDOWN_DELTA_MIN = 30;

/**
 * Rejects an opening `entry` is not eligible for (per its precomputed
 * `eligible_openings`), and — when live word counts are supplied via
 * `data` — rejects `countdown` a second time if the plain version is not
 * materially shorter than the original. The second check is a BACKSTOP,
 * the same relationship `wall-gate.ts`'s `gateWallCard` has to the pool's
 * own gate: an entry's `eligible_openings` should already agree, but a
 * render must never trust upstream data blindly. Never renders a card+
 * opening pair either check rejects — a rejection is a rejection, to be
 * excluded upstream (the schedule) or to fail a render outright (see
 * `assertOpeningRenderable`).
 */
export function gateOpening(
	entry: WallOpeningEligibilityEntry,
	opening: WallOpening,
	data?: Pick<OpeningData, 'originalWordCount' | 'plainWordCount'>
): GateOpeningResult {
	if (!entry.eligible_openings.includes(opening)) {
		return {
			ok: false,
			reason:
				`"${opening}" opening rejected for ${entry.card_id ?? 'entry'}: not in its eligible_openings ` +
				`([${entry.eligible_openings.join(', ')}]).`
		};
	}

	if (opening === 'countdown' && data) {
		const delta = data.originalWordCount - data.plainWordCount;
		if (delta < WALL_COUNTDOWN_DELTA_MIN) {
			return {
				ok: false,
				reason:
					`countdown opening rejected for ${entry.card_id ?? 'entry'}: plain version is only ${delta} ` +
					`word(s) shorter than the original (minimum ${WALL_COUNTDOWN_DELTA_MIN}).`
			};
		}
	}

	return { ok: true };
}

/**
 * `gateOpening`, but throws instead of returning a result — the shape
 * `Wall.tsx` needs so an ineligible card+opening combination fails the
 * render outright rather than producing a numeral the plan doesn't
 * sanction.
 */
export function assertOpeningRenderable(
	entry: WallOpeningEligibilityEntry,
	opening: WallOpening,
	data?: Pick<OpeningData, 'originalWordCount' | 'plainWordCount'>
): void {
	const result = gateOpening(entry, opening, data);
	if (!result.ok) {
		throw new Error(result.reason);
	}
}

// ---------------------------------------------------------------------------
// Computing eligibility directly from a card (T18) — for cards with no
// pool entry to read `eligible_openings` off of
// ---------------------------------------------------------------------------

/**
 * Minimum original-text reading grade for the "Grade 14" opening to be
 * worth showing as a bare measurement. Mirrors `WALL_ORIGINAL_GRADE_MIN` in
 * the root content pipeline's `scripts/lib/premises.ts` — duplicated
 * (never imported) because `social/` is a self-contained npm project (see
 * T01) that does not depend on that package. Kept numerically identical by
 * convention, same as `WALL_COUNTDOWN_DELTA_MIN` above.
 */
export const WALL_ORIGINAL_GRADE_MIN = 12;

/**
 * Computes which openings a card is eligible for, straight from its own
 * text — the render-side mirror of `scripts/lib/premises.ts`'s
 * `eligibleWallOpenings(card)`. Needed because a card's precomputed
 * `eligible_openings` only exists on entries that went through the
 * premise pipeline's scored Wall pool (`content/social/premises/
 * wall.json`) — a READ-THROUGH card never does (`scripts/lib/schedule.ts`
 * deliberately excludes every read-through card from that pool, so its
 * own sequential cards can never collide with a weighted-slot draw), yet
 * T18's render CLI still needs to know which openings a read-through
 * Wall post may use.
 *
 * Every card is eligible for `standard`. `countdown` additionally
 * requires the plain version to be at least `WALL_COUNTDOWN_DELTA_MIN`
 * words shorter than the original; `grade` additionally requires the
 * original's UNROUNDED reading grade (not `computeOpeningData`'s rounded
 * `originalGrade`, which is display-only) to clear
 * `WALL_ORIGINAL_GRADE_MIN` — same two thresholds, same word-count method
 * (`splitWords`, matching `scripts/lib/premises.ts`'s `wordCount`), so a
 * card's eligibility can never silently diverge between the two packages.
 *
 * `plainText` should be the card's full `plain_english` (verbatim), not
 * just a landing line or a partial reconstruction — matches
 * `lengthDelta`'s own `wordCount(card.plain_english)` in the root
 * pipeline.
 */
export function computeEligibleOpenings(originalExcerpt: string, plainText: string): WallOpening[] {
	const openings: WallOpening[] = ['standard'];

	const delta = splitWords(originalExcerpt).length - splitWords(plainText).length;
	if (delta >= WALL_COUNTDOWN_DELTA_MIN) {
		openings.push('countdown');
	}

	const grade: number = rs.fleschKincaidGrade(originalExcerpt);
	if (grade >= WALL_ORIGINAL_GRADE_MIN) {
		openings.push('grade');
	}

	return openings;
}

// ---------------------------------------------------------------------------
// Deterministic rotation
// ---------------------------------------------------------------------------

/**
 * The deterministic three-way rotation across consecutive Wall posts, so a
 * daily format doesn't share an identical frame-0.0 two days running (see
 * the index plan's "Opening rotation for The Wall": "a daily format with an
 * identical frame 0.0 gets filtered by the feed"). `seed` is any integer
 * counter the caller controls (e.g. a schedule slot index or a day-of-
 * read-through count) — NEVER a call to the runtime's random-number
 * generator, so a render is reproducible from its inputs alone. Negative
 * and non-multiple-of-3 seeds both wrap
 * correctly (`((seed % n) + n) % n`, not a bare `%`, which returns a
 * negative remainder in JS for negative `seed`).
 */
export function rotateOpening(seed: number): WallOpening {
	const n = WALL_OPENINGS.length;
	const index = ((seed % n) + n) % n;
	return WALL_OPENINGS[index];
}
