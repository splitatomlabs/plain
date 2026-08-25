/**
 * The Objection's tone/pool gate and two-sentence cap (T08).
 *
 * Three independent jobs live here:
 *
 *   1. The pool's own validation flags — only entries the premise pipeline
 *      already marked `rubric.verdict: "accept"` AND
 *      `rubric.classification: "viewer_position"` may reach a render (see
 *      `content/social/premises/objection.json`). The index plan is
 *      explicit that a line spoken by a character inside a dramatized
 *      scene ("dramatized_scene") or a live doctrinal back-and-forth
 *      ("doctrinal_dispute") is NOT a thought a viewer could plausibly
 *      have had of their own — only `viewer_position` entries are.
 *
 *   2. THE TWO-SENTENCE CAP AND THE REJECTION RULE — the heart of this
 *      gate. The reply is capped at its first two sentences, split with
 *      `splitPayoffLines` (the one canonical sentence splitter shared by
 *      all three formats — see `audio/timing.ts`). Rather than truncating
 *      an argument mid-thought, this REJECTS the card outright when:
 *        - the reply yields fewer than two complete sentences;
 *        - either of the first two sentences does not end at a real
 *          terminal punctuation boundary (never emit a partial sentence);
 *        - a third sentence exists AND opens with a discourse connective
 *          from `DISCOURSE_CONNECTIVES` — i.e. cutting after sentence two
 *          would leave the argument visibly hanging mid-thought.
 *
 *   3. Legibility — the objection (frame 0, set large in the author's
 *      accent) and each of the two capped reply lines (set at Wall/
 *      Question payoff size) must each clear a viewport-derived legibility
 *      floor, same method as `wall-gate.ts`/`question-gate.ts`.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only), mirroring
 * `wall-gate.ts` and `question-gate.ts` — both `Objection.tsx` and
 * `Root.tsx`'s `calculateMetadata` import from this module directly, and
 * both get bundled by Remotion's browser-side webpack build.
 * `surveyObjectionPool` below takes pool entries as a plain argument
 * (rather than reading `content/social/premises/objection.json` off disk
 * itself) specifically so this file never needs `node:fs` — see
 * `wall-pool.ts`'s comment on the `UnhandledSchemeError` that motivated
 * splitting THAT survey into its own fs-touching module. Passing entries
 * in avoids needing an equivalent split here.
 */

import { splitPayoffLines } from '../audio/timing.js';
import { fitFontSize, type FitResult } from '../render/fit.js';
import { WALL_MIN_LEGIBLE_FONT_PX } from './wall-gate.js';
import {
	computeObjectionLayout,
	FRAME_WIDTH,
	OBJECTION_MIN_FONT,
	type ObjectionLayout
} from './objection-timing.js';
import {
	PAYOFF_BOX_HEIGHT,
	PAYOFF_BOX_WIDTH,
	PAYOFF_LINE_HEIGHT_RATIO,
	PAYOFF_MAX_FONT,
	PAYOFF_MIN_FONT
} from './wall-timing.js';

// ---------------------------------------------------------------------------
// The legibility floor — frame 0 (the objection, in accent colour)
// ---------------------------------------------------------------------------

/** Same reference phone as `wall-gate.ts`'s `WALL_REFERENCE_VIEWPORT_WIDTH`. */
export const OBJECTION_REFERENCE_VIEWPORT_WIDTH = 390;

/**
 * The smallest CSS font size treated as a legible HEADLINE on a phone —
 * the same standard `question-gate.ts` sets for The Question's own opening
 * frame (28px), not the Wall's 14px body-text floor. Frame 0 here is the
 * same shape of moment: one short thought, alone, set as large display
 * type. It also happens to double as this format's justification for
 * using accent-coloured text at all — `docs/BRANDING.md` requires
 * accents to be set at >=18px (or >=14px bold) for legibility/WCAG
 * reasons, and this floor sits comfortably above that: `28 * (1080/390)`
 * ≈ 78px in the 1080-wide frame is far above the 18px-equivalent minimum.
 */
const OBJECTION_MIN_LEGIBLE_CSS_PX = 28;

/**
 * `OBJECTION_MIN_LEGIBLE_CSS_PX` converted into the composition's
 * 1080-wide frame space, rounded UP so the floor is never more permissive
 * than the CSS px it stands in for — same derivation as
 * `WALL_MIN_LEGIBLE_FONT_PX`/`QUESTION_MIN_LEGIBLE_FONT_PX`:
 * `28 * (1080 / 390)` ≈ 77.5 → 78.
 */
export const OBJECTION_MIN_LEGIBLE_FONT_PX = Math.ceil(
	OBJECTION_MIN_LEGIBLE_CSS_PX * (FRAME_WIDTH / OBJECTION_REFERENCE_VIEWPORT_WIDTH)
);

if (OBJECTION_MIN_FONT >= OBJECTION_MIN_LEGIBLE_FONT_PX) {
	throw new Error(
		`invariant violated: OBJECTION_MIN_FONT (${OBJECTION_MIN_FONT}) must stay below ` +
			`OBJECTION_MIN_LEGIBLE_FONT_PX (${OBJECTION_MIN_LEGIBLE_FONT_PX}) — otherwise a card that fails ` +
			'to fit at all would report a fontSize the gate mistakes for a legible fit.'
	);
}

// ---------------------------------------------------------------------------
// The legibility floor — the reply lines (body-weight payoff text)
// ---------------------------------------------------------------------------

/**
 * The reply lines render via `PayoffLine` — the exact same still, centred,
 * ink-coloured body text The Wall and The Question use for their payoffs
 * (see `Wall.tsx`). They are not display headlines the way frame 0 is, so
 * this reuses `wall-gate.ts`'s body-text floor directly rather than
 * inventing a second number for the same visual role.
 */
export const OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX = WALL_MIN_LEGIBLE_FONT_PX;

// ---------------------------------------------------------------------------
// The two-sentence cap — the conservative "leaves it hanging" heuristic
// ---------------------------------------------------------------------------

/**
 * Discourse connectives that, when they open the sentence immediately
 * AFTER the two-sentence cap, mark that following sentence as a
 * continuation of the argument rather than a fresh, self-contained
 * thought — i.e. cutting there would leave the reply hanging mid-argument.
 * This is a CONSERVATIVE HEURISTIC, not a semantic judgement: it can
 * neither prove a cut is safe (a sentence not on this list can still be a
 * continuation) nor prove one is unsafe (a sentence starting with one of
 * these words can occasionally stand alone) — it only catches the
 * mechanical, common case reliably enough to be worth rejecting on.
 */
export const DISCOURSE_CONNECTIVES = [
	'But',
	'So',
	'Therefore',
	'Yet',
	'However',
	'And',
	'Because',
	'For',
	'Still',
	'Instead',
	'Thus',
	'Hence',
	'Otherwise'
] as const;

const DISCOURSE_CONNECTIVES_LOWER = new Set(DISCOURSE_CONNECTIVES.map((word) => word.toLowerCase()));

/** The sentence's first word (letters/apostrophes only), or `''` if none. */
function firstWord(sentence: string): string {
	const match = sentence.trim().match(/^[A-Za-z']+/);
	return match ? match[0] : '';
}

function startsWithDiscourseConnective(sentence: string): boolean {
	return DISCOURSE_CONNECTIVES_LOWER.has(firstWord(sentence).toLowerCase());
}

/**
 * True when `sentence` ends at a real terminal punctuation boundary
 * (`.`/`!`/`?`, optionally followed by a closing quote or bracket) —
 * i.e. it is a COMPLETE sentence, never a fragment. `splitPayoffLines`
 * already only emits fragments as the final, unterminated leftover of a
 * text (see that function's own doc comment) — this is the check that
 * catches exactly that case when it would otherwise land inside the
 * two-sentence cap.
 */
function endsAtTerminalBoundary(sentence: string): boolean {
	return /[.!?]["'”’)\]]*$/.test(sentence.trim());
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface ObjectionGateInput {
	/** Verbatim objection — must never be paraphrased, fabricated, or attributed. */
	objection: string;
	/**
	 * Verbatim reply — used AS GIVEN, with no further slicing. This is
	 * NOT `reply.slice(replyStart)`: `content/social/premises/objection.json`'s
	 * `reply_start` is an offset into the SOURCE CARD's own `plain_english`
	 * text (see `scripts/lib/schedule.ts`'s `assembleObjectionReply`, the
	 * pipeline's canonical reassembly step), not into this entry's `reply`
	 * field — `reply` here is already that exact slice, trimmed. Applying
	 * `reply_start` a second time against `reply` itself silently produces
	 * an out-of-range (and usually empty) string, which is exactly the bug
	 * this gate must not reintroduce. Verified against the full 59-entry
	 * pool: `reply` is byte-identical to
	 * `card.plain_english.slice(reply_start).trim()` for every entry.
	 */
	reply: string;
	/**
	 * Pool rubric flags from `content/social/premises/objection.json`.
	 * Optional so the gate is still usable with a bare
	 * `{ objection, reply }` (e.g. ad hoc/manual testing); when present, a
	 * failing flag is rejected outright — the gate trusts the pipeline's
	 * own judgement here rather than re-deriving it from the text.
	 */
	verdict?: string;
	classification?: string;
}

export interface ObjectionReplyLineLayout {
	fontSize: number;
	lineHeight: number;
}

/**
 * Which check rejected the card (F06) — lets a caller surveying the pool
 * (`social/scripts/write-exclusions.ts`) tally/report WHY separately from
 * the human-readable `reason`, mirroring `wall-gate.ts`'s `failure` field:
 *  - `"pool_flags"` — `verdict`/`classification` rejected it.
 *  - `"sentence_cap"` — the two-sentence-cap rejection rules (too few
 *    complete sentences, a non-terminal boundary, or a hanging third
 *    sentence).
 *  - `"legibility"` — the objection frame or a reply line falls under its
 *    legibility floor once fitted.
 */
export type ObjectionGateAxis = 'pool_flags' | 'sentence_cap' | 'legibility';

export type ObjectionGateResult =
	| {
			ok: true;
			objectionLayout: ObjectionLayout;
			/** The two capped sentences, VERBATIM substrings of `reply`, in order. */
			replyLines: [string, string];
			replyLayouts: [ObjectionReplyLineLayout, ObjectionReplyLineLayout];
	  }
	| { ok: false; reason: string; axis: ObjectionGateAxis };

/**
 * Runs every check above against `input` and rejects the first one that
 * fails, in order: pool rubric flags, then the two-sentence cap's
 * rejection rules, then legibility (objection, then each reply line).
 * Never renders a card that fails any of them, and never trims a reply to
 * fit — a rejection is a rejection, to be excluded upstream
 * (`surveyObjectionPool`) or to fail a render outright
 * (`assertObjectionRenderable`).
 */
export function gateObjectionCard(input: ObjectionGateInput): ObjectionGateResult {
	if (input.verdict !== undefined && input.verdict !== 'accept') {
		return {
			ok: false,
			reason: `Objection card rejected: rubric verdict is "${input.verdict}", not "accept".`,
			axis: 'pool_flags'
		};
	}

	if (input.classification !== undefined && input.classification !== 'viewer_position') {
		return {
			ok: false,
			reason:
				`Objection card rejected: rubric classification is "${input.classification}", not ` +
				'"viewer_position" — a line spoken by a character in a staged scene, or a live doctrinal ' +
				'dispute, is not a position a viewer plausibly holds of their own.',
			axis: 'pool_flags'
		};
	}

	const sentences = splitPayoffLines(input.reply);

	if (sentences.length < 2) {
		return {
			ok: false,
			reason:
				`Objection card rejected: the reply yields only ${sentences.length} complete sentence(s), ` +
				'fewer than the two the format requires.',
			axis: 'sentence_cap'
		};
	}

	const [first, second] = sentences;

	if (!endsAtTerminalBoundary(first) || !endsAtTerminalBoundary(second)) {
		return {
			ok: false,
			reason:
				'Objection card rejected: one of the first two sentences does not end at a real terminal ' +
				'punctuation boundary — refusing to emit a partial sentence rather than truncating mid-argument.',
			axis: 'sentence_cap'
		};
	}

	const third = sentences[2];
	if (third && startsWithDiscourseConnective(third)) {
		return {
			ok: false,
			reason:
				`Objection card rejected: the third sentence opens with the discourse connective ` +
				`"${firstWord(third)}" — cutting after sentence two would leave the argument hanging mid-thought.`,
			axis: 'sentence_cap'
		};
	}

	const objectionLayout = computeObjectionLayout(input.objection);
	if (objectionLayout.fontSize < OBJECTION_MIN_LEGIBLE_FONT_PX) {
		return {
			ok: false,
			reason:
				`Objection card rejected: the objection fits frame 0 only at ${objectionLayout.fontSize}px, ` +
				`below the ${OBJECTION_MIN_LEGIBLE_FONT_PX}px legibility floor (the 1080-frame equivalent of ` +
				`${OBJECTION_MIN_LEGIBLE_CSS_PX}px on a ${OBJECTION_REFERENCE_VIEWPORT_WIDTH}px-wide reference phone).`,
			axis: 'legibility'
		};
	}

	const fits: [FitResult, FitResult] = [
		fitFontSize(first, {
			maxWidth: PAYOFF_BOX_WIDTH,
			maxHeight: PAYOFF_BOX_HEIGHT,
			minFont: PAYOFF_MIN_FONT,
			maxFont: PAYOFF_MAX_FONT,
			lineHeightRatio: PAYOFF_LINE_HEIGHT_RATIO
		}),
		fitFontSize(second, {
			maxWidth: PAYOFF_BOX_WIDTH,
			maxHeight: PAYOFF_BOX_HEIGHT,
			minFont: PAYOFF_MIN_FONT,
			maxFont: PAYOFF_MAX_FONT,
			lineHeightRatio: PAYOFF_LINE_HEIGHT_RATIO
		})
	];

	for (let i = 0; i < fits.length; i++) {
		if (fits[i].fontSize < OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX) {
			return {
				ok: false,
				reason:
					`Objection card rejected: reply sentence ${i + 1} fits only at ${fits[i].fontSize}px, below ` +
					`the ${OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX}px legibility floor.`,
				axis: 'legibility'
			};
		}
	}

	return {
		ok: true,
		objectionLayout,
		replyLines: [first, second],
		replyLayouts: [
			{ fontSize: fits[0].fontSize, lineHeight: fits[0].lineHeight },
			{ fontSize: fits[1].fontSize, lineHeight: fits[1].lineHeight }
		]
	};
}

/**
 * `gateObjectionCard`, but throws instead of returning a result — the
 * shape a render pipeline needs so a bad card fails the render outright
 * rather than producing an illegible frame or a mid-argument cut. Wired
 * into `Root.tsx`'s `calculateMetadata` and into `Objection.tsx` itself,
 * so both the composition-selection path and a direct render of the
 * component reject the same cards.
 */
export function assertObjectionRenderable(
	input: ObjectionGateInput
): Extract<ObjectionGateResult, { ok: true }> {
	const result = gateObjectionCard(input);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result;
}

// ---------------------------------------------------------------------------
// Pool ordering — LEAD WITH ON ANGER
// ---------------------------------------------------------------------------

/**
 * Stable-partitions `entries` so every `book_slug === 'on-anger'` entry
 * comes before every other entry, preserving each group's relative order
 * (a stable partition, not a resort by any other key). On Anger's
 * objections read as thoughts about the reader's own life ("I have a
 * right to be angry", "revenge feels good") rather than abstract
 * philosophical positions, which is exactly the "thought the viewer has
 * had" register this format needs — see the task's "LEAD WITH ON ANGER"
 * instruction. Exposed as its own named function (rather than a sort
 * comparator buried in a scheduling call) so the ordering rule is
 * independently testable.
 */
export function orderObjectionPool<T extends { book_slug: string }>(entries: readonly T[]): T[] {
	const onAnger: T[] = [];
	const rest: T[] = [];
	for (const entry of entries) {
		if (entry.book_slug === 'on-anger') {
			onAnger.push(entry);
		} else {
			rest.push(entry);
		}
	}
	return [...onAnger, ...rest];
}

// ---------------------------------------------------------------------------
// Surveying the pool
// ---------------------------------------------------------------------------

export interface ObjectionPoolSurveyEntry {
	card_id: string;
	book_slug: string;
	objection: string;
	reply: string;
	/**
	 * Present on every pool entry (an offset into the source card's
	 * `plain_english` — see `ObjectionGateInput.reply`'s doc comment) but
	 * NOT consumed by the gate itself; kept on this interface only so
	 * callers can pass the pool's entries through unmodified.
	 */
	reply_start: number;
	rubric: {
		verdict: string;
		classification: string;
	};
}

export interface ObjectionPoolSurveyResult {
	total: number;
	passed: number;
	rejected: number;
	/** Of `passed`, how many are `book_slug === 'on-anger'` (see `orderObjectionPool`). */
	onAngerPassed: number;
	rejectedIds: string[];
}

/**
 * Runs `gateObjectionCard` across every entry in
 * `content/social/premises/objection.json` (or any equivalent list of pool
 * entries), reporting how many pass the full gate — pool rubric flags, the
 * two-sentence cap's rejection rules, and legibility — and how many of
 * those are On Anger entries. Takes `entries` as a plain argument rather
 * than reading the pool file itself (see this module's top-of-file
 * comment on why): callers load the JSON and pass its `entries` array in.
 */
export function surveyObjectionPool(entries: readonly ObjectionPoolSurveyEntry[]): ObjectionPoolSurveyResult {
	let passed = 0;
	let onAngerPassed = 0;
	const rejectedIds: string[] = [];

	for (const entry of entries) {
		const result = gateObjectionCard({
			objection: entry.objection,
			reply: entry.reply,
			verdict: entry.rubric.verdict,
			classification: entry.rubric.classification
		});

		if (result.ok) {
			passed++;
			if (entry.book_slug === 'on-anger') {
				onAngerPassed++;
			}
		} else {
			rejectedIds.push(entry.card_id);
		}
	}

	return { total: entries.length, passed, rejected: rejectedIds.length, onAngerPassed, rejectedIds };
}
