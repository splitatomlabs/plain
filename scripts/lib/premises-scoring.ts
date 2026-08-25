import type { Card } from "./types.js";
import type { AuthorSlug } from "./constants.js";
import { LANDING_LINE_MAX_WORDS, QUESTION_MAX_WORDS, wordCount } from "./premises.js";

// ---------------------------------------------------------------------------
// T06 (this task): STUBS ONLY. This module defines the shapes, constants,
// and function signatures the LLM scoring stage needs — three per-format
// rubric parsers (T07), a mechanical faithfulness check (T09), and
// per-format on-screen length validators (T07/T09). Every exported function
// below throws `new Error("not implemented")` so the tests in
// `__tests__/premises-scoring.test.ts` are RED until T07/T09 fill in real
// bodies. Call sites (T08's batch orchestration, T10's CLI) can be written
// against these signatures now without changing later.
//
// Nothing here calls the Anthropic SDK or the Batch API — this module is
// pure parsing/validation logic, gated code (`premises.ts`) stays separate
// from scoring code (this file), per the plan's file layout.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fenced-JSON parsing (T07)
//
// Each rubric parser accepts a raw LLM response — fenced in ```json,
// bare JSON, or JSON with leading/trailing prose — and returns a
// STRUCTURALLY VALIDATED result object for its own format only. Malformed
// JSON, or JSON that doesn't match the parser's own shape (including a
// shape that belongs to one of the OTHER two rubrics), must be rejected
// with a clear, thrown error. T07 implements these by reusing
// `extractJSON` from `./claude.js` (do not reimplement fence-stripping)
// followed by field-level shape/range validation.
// ---------------------------------------------------------------------------

/** Inclusive score range every Wall rubric score must fall within. */
export const WALL_SCORE_MIN = 1;
export const WALL_SCORE_MAX = 5;

/**
 * The Wall's rubric result. Judges how impenetrable the ORIGINAL looks
 * (`impenetrability_score`) and how clean the payoff line reads once
 * lifted out of the wall of text (`landing_line_score`), plus the actual
 * chosen landing line text (verbatim — see `checkFaithfulness`). Nothing
 * about a "verdict" here: every Wall candidate already survived the T02
 * mechanical gate, so the LLM's job is scoring and line selection, not
 * accept/reject.
 */
export interface WallRubricResult {
  impenetrability_score: number;
  landing_line_score: number;
  chosen_landing_line: string;
  reason?: string;
}

/**
 * The Question's rubric result (T04 layer (c) — topic drift). Verifies
 * that the candidate answer sentence ACTUALLY ANSWERS the question rather
 * than merely following it chronologically. A verdict, not a score: either
 * the answer resolves the question or it drifts off-topic.
 */
export type QuestionRubricVerdict = "answers" | "drifts";
export const QUESTION_RUBRIC_VERDICTS: readonly QuestionRubricVerdict[] = ["answers", "drifts"];

export interface QuestionRubricResult {
  verdict: QuestionRubricVerdict;
  reason: string;
}

/**
 * The Objection's rubric result — the heaviest of the three (per the plan:
 * "no regex separates 'a position the viewer might hold' from 'a line
 * spoken in a scene'"). `classification` names WHY: a genuine first-person
 * position the viewer could plausibly hold, a line spoken by a character
 * inside a dramatised scene (should be rejected), or a doctrinal dispute
 * between philosophical schools (also rejected — not something a general
 * viewer holds as their own objection).
 */
export type ObjectionRubricVerdict = "accept" | "reject";
export const OBJECTION_RUBRIC_VERDICTS: readonly ObjectionRubricVerdict[] = ["accept", "reject"];

export type ObjectionClassification = "viewer_position" | "dramatized_scene" | "doctrinal_dispute";
export const OBJECTION_CLASSIFICATIONS: readonly ObjectionClassification[] = [
  "viewer_position",
  "dramatized_scene",
  "doctrinal_dispute",
];

export interface ObjectionRubricResult {
  verdict: ObjectionRubricVerdict;
  classification: ObjectionClassification;
  reason: string;
}

/**
 * Parse a raw LLM response into a validated `WallRubricResult`. T07 must:
 *  - reuse `extractJSON` (./claude.js) to strip ```json fences / surrounding
 *    prose, exactly like `callClaudeJSON` does;
 *  - reject malformed JSON with a clear, thrown error;
 *  - reject any payload missing a required field, carrying an extra
 *    unrecognized field, using the wrong type for a field, or carrying a
 *    score outside [`WALL_SCORE_MIN`, `WALL_SCORE_MAX`];
 *  - reject a payload shaped like `QuestionRubricResult` or
 *    `ObjectionRubricResult` (e.g. carrying `verdict`/`classification`
 *    instead of the Wall's own score fields).
 *
 * STUB — not implemented. Throws unconditionally so T06's tests are red
 * until T07 fills this in.
 */
export function parseWallRubricResponse(_raw: string): WallRubricResult {
  throw new Error("not implemented");
}

/**
 * Parse a raw LLM response into a validated `QuestionRubricResult`. Same
 * contract as `parseWallRubricResponse` above, applied to the Question's
 * own shape (`verdict` in `QUESTION_RUBRIC_VERDICTS` + `reason`), rejecting
 * both malformed JSON and a Wall- or Objection-shaped payload.
 *
 * STUB — not implemented.
 */
export function parseQuestionRubricResponse(_raw: string): QuestionRubricResult {
  throw new Error("not implemented");
}

/**
 * Parse a raw LLM response into a validated `ObjectionRubricResult`. Same
 * contract again, applied to the Objection's own shape (`verdict` in
 * `OBJECTION_RUBRIC_VERDICTS`, `classification` in
 * `OBJECTION_CLASSIFICATIONS`, `reason`), rejecting both malformed JSON and
 * a Wall- or Question-shaped payload.
 *
 * STUB — not implemented.
 */
export function parseObjectionRubricResponse(_raw: string): ObjectionRubricResult {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Faithfulness (T09) — THE CENTRAL CONSTRAINT.
//
// "Every word on screen must be traceable to plain_english or
// original_excerpt. Enforce mechanically." This check is deliberately NOT
// an LLM call: it is a plain substring test against the two source fields
// of the card the on-screen text claims to come from. Paraphrase,
// embellishment, invention, and even a single changed word must all be
// rejected — a faithful string is an EXACT substring of one of the two
// source fields, nothing looser.
// ---------------------------------------------------------------------------

export interface FaithfulnessCheckResult {
  faithful: boolean;
  reason?: string;
}

/**
 * Mechanically verify that `text` is traceable to `card` — an exact
 * substring of either `card.plain_english` or `card.original_excerpt`.
 * Must never call an LLM. T09 implements this (likely on top of
 * `verbatim` from `./premises.ts`, checked against both fields).
 *
 * STUB — not implemented. Throws unconditionally so T06's tests are red
 * until T09 fills this in.
 */
export function checkFaithfulness(
  _text: string,
  _card: Pick<Card, "plain_english" | "original_excerpt">,
): FaithfulnessCheckResult {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Per-format on-screen length limits (T07/T09).
//
// "On-screen text limits are PER FORMAT, not global — The Wall
// deliberately shows 150+ words." Each format gets its own limit function;
// there is deliberately no single shared "is this text short enough?"
// helper, because what counts as "too long" is a different question for
// each format (The Wall's original side has a high ceiling; its landing
// line, The Question's question, and The Objection's quoted line are all
// short-form and independently capped).
// ---------------------------------------------------------------------------

/**
 * Floor (not ceiling) for The Wall's original-excerpt side, matching the
 * T01/T02 mechanical gate (`wallGate` in ./premises.ts requires
 * `wordCount(original_excerpt) >= 80`). There is deliberately no upper
 * bound here — a 150+ word original is exactly what makes phase 1
 * impenetrable, and is a valid, not an over-length, Wall original.
 */
export const WALL_ORIGINAL_MIN_WORDS = 80;

/**
 * The Objection's on-screen quoted line ceiling. Numerically equal to
 * `QUESTION_MAX_WORDS` (both 14) but a DISTINCT constant on purpose: the
 * two formats' limits are independent facts about independent on-screen
 * elements, not one shared global rule that happens to be reused. Changing
 * one must never silently change the other.
 */
export const OBJECTION_MAX_WORDS = 14;

/**
 * True when a Wall original of `wordCountValue` words clears the format's
 * floor. No ceiling — see `WALL_ORIGINAL_MIN_WORDS` above.
 *
 * STUB — not implemented. Throws unconditionally.
 */
export function withinWallOriginalLimit(_wordCountValue: number): boolean {
  throw new Error("not implemented");
}

/**
 * True when `text` (a candidate Wall landing line) is within
 * [`LANDING_LINE_MIN_WORDS`, `LANDING_LINE_MAX_WORDS`] words (imported
 * from ./premises.ts — the same bounds T02's `findLandingLines` already
 * enforces mechanically). Re-exposed here so the scoring stage can
 * re-validate an LLM-chosen landing line against the same bound.
 *
 * STUB — not implemented. Throws unconditionally.
 */
export function withinWallLandingLineLimit(_text: string): boolean {
  throw new Error("not implemented");
}

/**
 * True when `text` (a candidate Question) is at most `QUESTION_MAX_WORDS`
 * words (imported from ./premises.ts — the same bound T04's
 * `findQuestionCandidate` already enforces mechanically).
 *
 * STUB — not implemented. Throws unconditionally.
 */
export function withinQuestionLimit(_text: string): boolean {
  throw new Error("not implemented");
}

/**
 * True when `text` (a candidate Objection quoted line) is at most
 * `OBJECTION_MAX_WORDS` words.
 *
 * STUB — not implemented. Throws unconditionally.
 */
export function withinObjectionLimit(_text: string): boolean {
  throw new Error("not implemented");
}

// ---------------------------------------------------------------------------
// Re-exported for test/call-site convenience so consumers of this module
// don't also need to import directly from ./premises.ts for these two
// shared constants and the shared word-count helper.
// ---------------------------------------------------------------------------
export { LANDING_LINE_MAX_WORDS, QUESTION_MAX_WORDS, wordCount };
export type { AuthorSlug };
