/**
 * The Question's legibility, answerability and tone gate.
 *
 * Three independent rejections live here:
 *
 *   1. Word count — `QUESTION_MAX_WORDS` (12). The index plan's supply
 *      analysis retired the old "12-word frame-zero rule" for The Wall
 *      (long archaic passages are now preferred material there), but is
 *      explicit that the rule "still applies to STILL formats" (see
 *      `plans/Pf39c2-social-pilot-index.md`, "The supply inversion"). The
 *      Question opens on a still frame — the question alone, motionless —
 *      so that rule binds here even though it no longer binds The Wall.
 *
 *   2. Legibility — the fitted opening-frame font size must clear
 *      `QUESTION_MIN_LEGIBLE_FONT_PX`. Derived with the exact same method
 *      as `wall-gate.ts`'s `WALL_MIN_LEGIBLE_FONT_PX` (a CSS px floor on a
 *      390px-wide reference phone, converted into the 1080-wide frame),
 *      but set far higher: the Wall packs 150+ words into one screen and
 *      still must clear only 14px-equivalent, while this format ever only
 *      shows one short (<=12-word) line at full size — it should read like
 *      a headline, not merely like legible body text. See
 *      `QUESTION_MIN_LEGIBLE_CSS_PX` below for the exact number.
 *
 *   3. The pool's own validation flags — a card the premise pipeline
 *      already flagged as not standing alone, not substantive, or not
 *      actually answering the question (`content/social/premises/
 *      question.json`'s `standalone_intelligible`, `answer_has_substance`,
 *      `drift_verdict`) must never reach a render just because its text
 *      happens to fit. This is the gate's only source of "is this a real
 *      answer" — it does not re-judge the question/answer pair itself.
 *
 * Also documents (and makes testable) the tonal house rule: **there is no
 * wrong answer**. This format must never read as testing the viewer — see
 * `FORBIDDEN_TESTING_VOCABULARY` below.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only), mirroring
 * `wall-gate.ts` — both `Question.tsx` and `Root.tsx`'s `calculateMetadata`
 * import from this module directly, and both get bundled by Remotion's
 * browser-side webpack build.
 */

import { computeQuestionLayout, FRAME_WIDTH, splitWords, type QuestionLayout } from './question-timing.js';

// ---------------------------------------------------------------------------
// The 12-word rule (still formats only — see module doc)
// ---------------------------------------------------------------------------

export const QUESTION_MAX_WORDS = 12;

// ---------------------------------------------------------------------------
// The legibility floor
// ---------------------------------------------------------------------------

/** Same reference phone as `wall-gate.ts`'s `WALL_REFERENCE_VIEWPORT_WIDTH`. */
export const QUESTION_REFERENCE_VIEWPORT_WIDTH = 390;

/**
 * The smallest CSS font size treated as a legible HEADLINE on a phone — not
 * merely legible body text (that is `wall-gate.ts`'s 14px). A single
 * <=12-word question, set at up to `QUESTION_MAX_FONT`, should read like a
 * short display line a viewer can take in at a glance, which is why this
 * floor sits more than double the Wall's.
 */
const QUESTION_MIN_LEGIBLE_CSS_PX = 28;

/**
 * `QUESTION_MIN_LEGIBLE_CSS_PX` converted into the composition's 1080-wide
 * frame space, rounded UP so the floor is never more permissive than the
 * CSS px it stands in for — same derivation as `WALL_MIN_LEGIBLE_FONT_PX`:
 * `28 * (1080 / 390)` ≈ 77.5 → 78.
 */
export const QUESTION_MIN_LEGIBLE_FONT_PX = Math.ceil(
	QUESTION_MIN_LEGIBLE_CSS_PX * (FRAME_WIDTH / QUESTION_REFERENCE_VIEWPORT_WIDTH)
);

// ---------------------------------------------------------------------------
// THE HOUSE RULE — this format must never read as testing the viewer
// ---------------------------------------------------------------------------

/**
 * THERE IS NO WRONG ANSWER. The Question must never read as a quiz, a
 * comprehension check, or a "gotcha" — no score, no timer or countdown, no
 * checkmark or cross, no "the answer is", nothing that frames the plain
 * answer as a correction of what the viewer thought. The archaic wall
 * moves and the plain answer sits in stillness; neither one grades the
 * viewer.
 *
 * This is the concrete, checkable form of that rule: `Question.tsx`'s
 * source is scanned for every one of these strings (case-insensitively) in
 * `question-timing.test.ts`'s source guard. Exported so the test imports
 * the same list this comment describes, rather than re-typing it.
 */
export const FORBIDDEN_TESTING_VOCABULARY = [
	'wrong answer',
	'right answer',
	'correct answer',
	'the answer is',
	'did you get it',
	'did you know',
	'your score',
	'score:',
	'countdown',
	'time is up',
	"time's up",
	'checkmark',
	'check mark',
	'✓',
	'✗',
	'❌',
	'⏱'
] as const;

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

export interface QuestionGateInput {
	question: string;
	answer: string;
	/**
	 * Pool validation flags from `content/social/premises/question.json`.
	 * All optional so the gate is still usable with a bare
	 * `{ question, answer }` (e.g. ad hoc/manual testing); when present,
	 * a failing flag is rejected outright — the gate trusts the pipeline's
	 * own judgement here rather than re-deriving it from the text.
	 */
	drift_verdict?: string;
	standalone_intelligible?: boolean;
	answer_has_substance?: boolean;
}

/**
 * Which check rejected the card (F06) — lets a caller surveying the pool
 * (`social/scripts/write-exclusions.ts`) tally/report WHY separately from
 * the human-readable `reason`, mirroring `wall-gate.ts`'s `failure` field:
 *  - `"pool_flags"` — `drift_verdict`/`standalone_intelligible`/
 *    `answer_has_substance` rejected it.
 *  - `"word_count"` — over `QUESTION_MAX_WORDS`.
 *  - `"legibility"` — under `QUESTION_MIN_LEGIBLE_FONT_PX` once fitted.
 */
export type QuestionGateAxis = 'pool_flags' | 'word_count' | 'legibility';

export type QuestionGateResult =
	| { ok: true; layout: QuestionLayout; wordCount: number }
	| { ok: false; reason: string; wordCount: number; axis: QuestionGateAxis };

/**
 * Runs every check above against `input` and rejects the first one that
 * fails, in order: pool validation flags, word count, then fitted
 * legibility. Never renders a card that fails any of them — a rejection is
 * a rejection, to be excluded upstream (schedule/pool survey) or to fail a
 * render outright (see `assertQuestionRenderable`).
 */
export function gateQuestionCard(input: QuestionGateInput): QuestionGateResult {
	const wordCount = splitWords(input.question).length;

	if (input.drift_verdict !== undefined && input.drift_verdict !== 'answers') {
		return {
			ok: false,
			reason: `Question card rejected: drift_verdict is "${input.drift_verdict}", not "answers" — the answer does not resolve the question.`,
			wordCount,
			axis: 'pool_flags'
		};
	}

	if (input.standalone_intelligible === false) {
		return {
			ok: false,
			reason: 'Question card rejected: the pool flagged the question as not standing alone without context.',
			wordCount,
			axis: 'pool_flags'
		};
	}

	if (input.answer_has_substance === false) {
		return {
			ok: false,
			reason: 'Question card rejected: the pool flagged the answer as lacking substance.',
			wordCount,
			axis: 'pool_flags'
		};
	}

	if (wordCount > QUESTION_MAX_WORDS) {
		return {
			ok: false,
			reason: `Question card rejected: the question is ${wordCount} words, over the ${QUESTION_MAX_WORDS}-word still-format floor.`,
			wordCount,
			axis: 'word_count'
		};
	}

	const layout = computeQuestionLayout(input.question);
	if (layout.fontSize < QUESTION_MIN_LEGIBLE_FONT_PX) {
		return {
			ok: false,
			reason:
				`Question card rejected: the question fits the opening frame only at ${layout.fontSize}px, ` +
				`below the ${QUESTION_MIN_LEGIBLE_FONT_PX}px legibility floor (the 1080-frame equivalent of ` +
				`${QUESTION_MIN_LEGIBLE_CSS_PX}px on a ${QUESTION_REFERENCE_VIEWPORT_WIDTH}px-wide reference phone).`,
			wordCount,
			axis: 'legibility'
		};
	}

	return { ok: true, layout, wordCount };
}

/**
 * `gateQuestionCard`, but throws instead of returning a result — the shape
 * a render pipeline needs so a bad card fails the render outright rather
 * than producing an unreadable or mistagged frame. Wired into `Root.tsx`'s
 * `calculateMetadata` and into `Question.tsx` itself, so both the
 * composition-selection path and a direct render of the component reject
 * the same cards.
 */
export function assertQuestionRenderable(input: QuestionGateInput): QuestionLayout {
	const result = gateQuestionCard(input);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.layout;
}
