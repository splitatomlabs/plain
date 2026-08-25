import type { Card } from "./types.js";
import { AUTHOR_META, type AuthorSlug } from "./constants.js";
import {
  LANDING_LINE_MIN_WORDS,
  LANDING_LINE_MAX_WORDS,
  QUESTION_MAX_WORDS,
  wordCount,
  verbatim,
  findLandingLines,
  type QuestionDriftRequest,
} from "./premises.js";
import { extractJSON } from "./claude.js";
import { AUTHOR_VOICE } from "./prompt.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// T07: The three LLM rubrics and their response parsers. Scoring runs ONLY
// over cards that already survived the mechanical gates in `premises.ts`
// (T01/T02 for The Wall, T04's mechanical+layer(a)/(b) for The Question);
// nothing here re-litigates what those deterministic layers already
// settled. This module is pure parsing/prompt-construction/validation — no
// SDK calls, no network code (the one exception, added in T20, is a
// fire-and-forget `logger.debug` call when a parser ignores an additive
// unknown field — local file I/O only, same non-blocking pattern every
// other `logger` call site in this codebase already uses, never a network
// call and never something a caller needs to await). T08 owns batch
// submit/poll/stream/merge and calls the functions below.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Fenced-JSON parsing
//
// Each rubric parser accepts a raw LLM response — fenced in ```json, bare
// JSON, or JSON with leading/trailing prose — and returns a STRUCTURALLY
// VALIDATED result object for its own format only. Malformed JSON, or JSON
// missing a required field / using the wrong type for one / carrying an
// out-of-range score or invalid enum value (including a payload shaped
// like one of the OTHER two rubrics, which is missing this format's own
// required fields), is rejected with a clear, thrown error naming the
// offending field. `extractJSON` (./claude.js) does the fence-stripping/
// prose-stripping; this module only validates shape once JSON has been
// extracted. An ADDITIVE unrecognized field — one sitting alongside a
// complete, correctly-typed set of known fields, e.g. the model
// volunteering `impenetrability_score_reason` alongside a valid
// `impenetrability_score` — is NOT rejected (see `logIgnoredFields`'s own
// doc comment for the real-run defect this fixes); it is silently dropped
// from the returned result and logged at debug level.
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

// ---------------------------------------------------------------------------
// Shared validation helpers. Every message names the specific field that
// failed, so a real validation failure is diagnosable from the thrown
// error alone rather than reading as a generic "invalid shape".
// ---------------------------------------------------------------------------

function parseJSONResponse(raw: string): Record<string, unknown> {
  // extractJSON strips ```json fences / surrounding prose and throws a
  // message containing "JSON" itself if nothing parseable can be found.
  const jsonText = extractJSON(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(`Failed to parse JSON rubric response: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("Expected a JSON object in rubric response, got something else");
  }
  return parsed as Record<string, unknown>;
}

function requireNumber(obj: Record<string, unknown>, field: string, min: number, max: number): number {
  const value = obj[field];
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`${field} must be a number (a score between ${min} and ${max}), got ${JSON.stringify(value)}`);
  }
  if (value < min || value > max) {
    throw new Error(`${field} must be a score between ${min} and ${max}, got ${value}`);
  }
  return value;
}

function requireString(obj: Record<string, unknown>, field: string): string {
  const value = obj[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} is required and must be a non-empty string`);
  }
  return value;
}

function optionalString(obj: Record<string, unknown>, field: string): string | undefined {
  if (!(field in obj) || obj[field] === undefined) return undefined;
  const value = obj[field];
  if (typeof value !== "string") {
    throw new Error(`${field} must be a string when present, got ${JSON.stringify(value)}`);
  }
  return value;
}

function requireEnum<T extends string>(obj: Record<string, unknown>, field: string, allowed: readonly T[]): T {
  const value = obj[field];
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")} (got ${JSON.stringify(value)})`);
  }
  return value as T;
}

/**
 * T20 fix: the real T11 run lost 107 of 1,003 Wall responses (10.7%) to a
 * PRIOR version of this function, which THREW on any additive field the
 * model volunteered alongside a complete, correctly-typed set of known
 * fields (`impenetrability_score_check`, `landing_line_score_note`, etc. —
 * the model explaining itself in a field name of its own invention rather
 * than in `reason`). That is not a malformed or wrong-shape response — it
 * is a fully valid scoring the model chose to annotate — so it must not be
 * dropped. Additive unknown fields are now IGNORED (never merged into the
 * returned result — the return type only ever carries the known fields) and
 * logged at debug level so a systematic prompt drift stays visible instead
 * of silently costing pool entries the way this one did. Every known field
 * is still required to be present and correctly typed, and every existing
 * range/enum validation is unchanged — this function no longer contributes
 * to REJECTING a payload at all, cross-format discrimination is carried
 * entirely by the `require*`/`requireEnum` calls that already run first.
 */
function logIgnoredFields(obj: Record<string, unknown>, allowedFields: readonly string[], formatName: string): void {
  const extra = Object.keys(obj).filter((key) => !allowedFields.includes(key));
  if (extra.length > 0) {
    logger.debug(
      `premises-scoring: ${formatName} rubric response carried unexpected field(s), ignored: ${extra.join(", ")}`,
    );
  }
}

const WALL_RUBRIC_FIELDS = ["impenetrability_score", "landing_line_score", "chosen_landing_line", "reason"] as const;
const QUESTION_RUBRIC_FIELDS = ["verdict", "reason"] as const;
const OBJECTION_RUBRIC_FIELDS = ["verdict", "classification", "reason"] as const;

/**
 * Parse a raw LLM response into a validated `WallRubricResult`. Rejects
 * malformed JSON; rejects a payload missing a required field, using the
 * wrong type for a field, or carrying a score outside [`WALL_SCORE_MIN`,
 * `WALL_SCORE_MAX`]; rejects a payload shaped like `QuestionRubricResult` or
 * `ObjectionRubricResult` (both are missing `chosen_landing_line` and/or the
 * two scores, which is what actually gets rejected on — see
 * `logIgnoredFields`'s own doc comment for why an ADDITIVE unrecognized
 * field, e.g. a commentary field the model volunteered alongside a complete
 * valid response, is tolerated rather than rejected).
 */
export function parseWallRubricResponse(raw: string): WallRubricResult {
  const parsed = parseJSONResponse(raw);
  const impenetrability_score = requireNumber(parsed, "impenetrability_score", WALL_SCORE_MIN, WALL_SCORE_MAX);
  const landing_line_score = requireNumber(parsed, "landing_line_score", WALL_SCORE_MIN, WALL_SCORE_MAX);
  const chosen_landing_line = requireString(parsed, "chosen_landing_line");
  const reason = optionalString(parsed, "reason");
  logIgnoredFields(parsed, WALL_RUBRIC_FIELDS, "Wall");
  return reason !== undefined
    ? { impenetrability_score, landing_line_score, chosen_landing_line, reason }
    : { impenetrability_score, landing_line_score, chosen_landing_line };
}

/**
 * Parse a raw LLM response into a validated `QuestionRubricResult`. Same
 * contract as `parseWallRubricResponse`, applied to the Question's own
 * shape (`verdict` in `QUESTION_RUBRIC_VERDICTS` + `reason`). `verdict` is
 * checked before `reason` so a Wall- or Objection-shaped payload (which
 * lacks a valid Question `verdict`) always fails on the `verdict` field,
 * even when it happens to carry its own unrelated `reason`/`verdict`
 * value.
 */
export function parseQuestionRubricResponse(raw: string): QuestionRubricResult {
  const parsed = parseJSONResponse(raw);
  const verdict = requireEnum(parsed, "verdict", QUESTION_RUBRIC_VERDICTS);
  const reason = requireString(parsed, "reason");
  logIgnoredFields(parsed, QUESTION_RUBRIC_FIELDS, "Question");
  return { verdict, reason };
}

/**
 * Parse a raw LLM response into a validated `ObjectionRubricResult`. Same
 * contract again, applied to the Objection's own shape (`verdict` in
 * `OBJECTION_RUBRIC_VERDICTS`, `classification` in
 * `OBJECTION_CLASSIFICATIONS`, `reason`). `classification` is checked
 * BEFORE `verdict` so a Question-shaped payload (whose `verdict: "answers"`
 * is not a valid Objection verdict either, but which is missing
 * `classification` entirely) is rejected on the `classification` field —
 * the more specific, more diagnosable reason.
 */
export function parseObjectionRubricResponse(raw: string): ObjectionRubricResult {
  const parsed = parseJSONResponse(raw);
  const classification = requireEnum(parsed, "classification", OBJECTION_CLASSIFICATIONS);
  const verdict = requireEnum(parsed, "verdict", OBJECTION_RUBRIC_VERDICTS);
  const reason = requireString(parsed, "reason");
  logIgnoredFields(parsed, OBJECTION_RUBRIC_FIELDS, "Objection");
  return { verdict, classification, reason };
}

// ---------------------------------------------------------------------------
// Faithfulness — THE CENTRAL CONSTRAINT.
//
// "Every word on screen must be traceable to plain_english or
// original_excerpt. Enforce mechanically." This check is deliberately NOT
// an LLM call: it is a plain substring test against the two source fields
// of the card the on-screen text claims to come from. Paraphrase,
// embellishment, invention, and even a single changed word must all be
// rejected — a faithful string is an EXACT substring of one of the two
// source fields, nothing looser. Built directly on `verbatim` from
// ./premises.ts (T02's own "is this line lifted verbatim" check),
// evaluated against both source fields instead of just plain_english.
//
// Nominally a T09 concern, but implemented here because T06's tests
// already cover it and T08's batch orchestration needs it to validate
// every rubric response before accepting it — see the module-level report
// for this overlap.
// ---------------------------------------------------------------------------

export interface FaithfulnessCheckResult {
  faithful: boolean;
  reason?: string;
}

/**
 * Mechanically verify that `text` is traceable to `card` — an exact,
 * case-sensitive substring of either `card.plain_english` or
 * `card.original_excerpt`. Never calls an LLM. Rejects paraphrase,
 * embellishment (source text plus an invented tail), wholly invented text,
 * a near-miss single-word substitution, and text stitched together from
 * two non-adjacent real fragments of the same source field (none of those
 * are exact substrings, so a single `includes` check against each field is
 * sufficient — no fuzzy matching, by design).
 */
export function checkFaithfulness(
  text: string,
  card: Pick<Card, "plain_english" | "original_excerpt">,
): FaithfulnessCheckResult {
  if (verbatim(text, card.plain_english) || verbatim(text, card.original_excerpt)) {
    return { faithful: true };
  }
  return {
    faithful: false,
    reason: `"${text}" is not an exact substring of either plain_english or original_excerpt.`,
  };
}

// ---------------------------------------------------------------------------
// Per-format on-screen length limits.
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
 */
export function withinWallOriginalLimit(wordCountValue: number): boolean {
  return wordCountValue >= WALL_ORIGINAL_MIN_WORDS;
}

/**
 * True when `text` (a candidate Wall landing line) is within
 * [`LANDING_LINE_MIN_WORDS`, `LANDING_LINE_MAX_WORDS`] words (imported
 * from ./premises.ts — the same bounds T02's `findLandingLines` already
 * enforces mechanically). Re-exposed here so the scoring stage can
 * re-validate an LLM-chosen landing line against the same bound.
 */
export function withinWallLandingLineLimit(text: string): boolean {
  const count = wordCount(text);
  return count >= LANDING_LINE_MIN_WORDS && count <= LANDING_LINE_MAX_WORDS;
}

/**
 * True when `text` (a candidate Question) is at most `QUESTION_MAX_WORDS`
 * words (imported from ./premises.ts — the same bound T04's
 * `findQuestionCandidate` already enforces mechanically).
 */
export function withinQuestionLimit(text: string): boolean {
  return wordCount(text) <= QUESTION_MAX_WORDS;
}

/**
 * True when `text` (a candidate Objection quoted line) is at most
 * `OBJECTION_MAX_WORDS` words.
 */
export function withinObjectionLimit(text: string): boolean {
  return wordCount(text) <= OBJECTION_MAX_WORDS;
}

// ---------------------------------------------------------------------------
// Prompt construction.
//
// Every system prompt below is a pure function of `authorSlug` alone —
// never of a card, a book, or a batch index — so it is byte-identical
// across every request for that author and the Anthropic prompt cache
// actually hits (mirrors `buildTranslationSystem` in ./prompt.ts, except
// caching is keyed on AUTHOR only, not book+author, since none of these
// three judgements depend on which book a card came from). All prose is
// built from module-level constants so the cache key stays stable.
// ---------------------------------------------------------------------------

function authorDisplayName(authorSlug: AuthorSlug): string {
  return AUTHOR_META.find((a) => a.slug === authorSlug)?.name ?? authorSlug;
}

const VOICE_REMINDER = `This app's voice (docs/BRANDING.md) is direct, second person ("you," not "one"), warm but not soft, and never clickbait. You are not writing new copy here — you are judging or selecting EXISTING text — but keep that voice in mind: if a candidate reads as hedged, academic, or gimmicky rather than direct and warm, that is a legitimate reason to score it lower or reject it.`;

// ---------------------------------------------------------------------------
// The Wall
// ---------------------------------------------------------------------------

const WALL_RUBRIC_TASK = `You are scoring a card for "The Wall" — a social format with two phases. Phase 1 shows the ORIGINAL passage as a dense wall of text that visually outruns the viewer before they can finish reading it. Phase 2 hard-cuts to ONE plain-English sentence, alone on a quiet screen, with zero preceding context.

Every card you see has already passed a mechanical gate: the original excerpt is at least 80 words, and every line in the candidate list below is a real, complete sentence lifted verbatim from the plain English translation. Your job is scoring and selection, not gatekeeping — do not reject the card itself.

Score TWO things, each 1-5:

1. impenetrability_score — how impenetrable the ORIGINAL passage LOOKS, at a glance, before anyone reads a single word of it. This is about VISUAL TEXTURE AND DENSITY: sentence length, clause-stacking, archaic diction, quotation-mark clutter, the sheer shape of a wall of text. It is emphatically NOT about how hard the ideas underneath are — a short, plain-looking sentence about a profound idea scores LOW here; a long, syntactically tangled sentence about a simple idea scores HIGH. A 150+ word original is not a defect, it is the point: score it on how thick and forbidding it LOOKS, not on its length alone.

2. landing_line_score — how cleanly the chosen landing line reads once it is the ONLY thing on screen, immediately after the hard cut, with absolutely no preceding context. Ask: if a viewer has read nothing else at all — not the original, not an earlier card — does this one sentence land completely on its own? A line that leans on a pronoun, a demonstrative, an implied "so" or "but," or any thread from the wall of text before it scores LOW even if it reads fine in context. A sentence that is a fully self-contained thought needing nothing else to make sense scores HIGH.

Then choose exactly ONE line from the numbered CANDIDATE LANDING LINES list as chosen_landing_line, copied VERBATIM — character for character — from the list. Never paraphrase, trim, or add to it; if it is not an exact copy of one of the numbered candidates it will be rejected. If none of the candidates is fully clean, still pick the least-bad one and reflect that in landing_line_score.

${VOICE_REMINDER}

Respond with ONLY this JSON (no other text) — EXACTLY these four fields, in this shape, and no others. Put ALL of your reasoning inside "reason"; do not invent additional fields (for example, do not add a separate "impenetrability_score_reason" or "landing_line_score_note" — everything explanatory belongs in "reason" alone):
{
  "impenetrability_score": <integer 1-5>,
  "landing_line_score": <integer 1-5>,
  "chosen_landing_line": "<the exact text of the candidate you chose>",
  "reason": "<one sentence explaining your scores>"
}`;

/** Static per-author system prompt for The Wall rubric — cacheable across every Wall card by that author. */
export function buildWallRubricSystem(authorSlug: AuthorSlug): string {
  const voice = AUTHOR_VOICE[authorSlug] ?? "";
  return `${WALL_RUBRIC_TASK}

AUTHOR CONTEXT:
You are scoring passages from ${authorDisplayName(authorSlug)}. ${voice}`;
}

/**
 * Per-card user message for The Wall rubric. Lists every T02
 * `findLandingLines` candidate (not just the single deterministically
 * `selectLandingLine`-picked one) so the model can choose among several
 * already-verbatim options rather than being asked to invent new text.
 */
export function buildWallRubricUser(card: Card): string {
  const candidates = findLandingLines(card);
  if (candidates.length === 0) {
    throw new Error(`buildWallRubricUser: card ${card.id} has no qualifying landing line candidates`);
  }
  const list = candidates.map((line, i) => `${i + 1}. ${line}`).join("\n");
  return `ORIGINAL EXCERPT (phase 1 — the wall of text the viewer sees first):
${card.original_excerpt}

CANDIDATE LANDING LINES (verbatim sentences from the plain English translation — choose exactly one):
${list}

Respond with ONLY the JSON described above.`;
}

// ---------------------------------------------------------------------------
// The Question
// ---------------------------------------------------------------------------

const QUESTION_RUBRIC_TASK = `You are the final check for "The Question" — a format where a short second-person question appears alone on screen, the viewer silently predicts an answer, and the card's own next sentence then appears as the author's answer.

The question and candidate answer you see here have ALREADY passed deterministic checks: the question is short, unquoted, self-contained (no dangling pronoun or demonstrative), not a fragment, not exclamation-shaped, and not attributed to anyone else ("he asks," "you ask") — it reads as the author's own direct question to the reader. The candidate answer has ALREADY been checked to be a genuine declarative sentence: not another question (no Socratic chain), not an attribution leak, and not an empty pivot phrase ("Here's how it works.").

Your ONLY job is TOPIC DRIFT: does the candidate answer ACTUALLY ANSWER the question — resolving what it asked — or does it merely happen to be the next sentence chronologically, drifting onto a related but different point? Do NOT re-check anything described above as already settled: self-containedness, attribution, fragment-ness, and Socratic chaining are not your concern here. Judge resolution only.

${VOICE_REMINDER}

Respond with ONLY this JSON (no other text) — EXACTLY these two fields, in this shape, and no others. Put ALL of your reasoning inside "reason"; do not invent additional fields:
{
  "verdict": "answers" | "drifts",
  "reason": "<one sentence explaining your verdict>"
}`;

/** Static per-author system prompt for The Question rubric — cacheable across every Question card by that author. */
export function buildQuestionRubricSystem(authorSlug: AuthorSlug): string {
  const voice = AUTHOR_VOICE[authorSlug] ?? "";
  return `${QUESTION_RUBRIC_TASK}

AUTHOR CONTEXT:
You are judging questions from ${authorDisplayName(authorSlug)}. ${voice}`;
}

/** Per-entry user message for The Question rubric. Reuses T04's `QuestionDriftRequest` shape directly. */
export function buildQuestionRubricUser(request: QuestionDriftRequest): string {
  return `QUESTION (already on screen, alone, with no other context):
"${request.question}"

CANDIDATE ANSWER (the card's own next sentence):
"${request.answer}"

Respond with ONLY the JSON described above.`;
}

// ---------------------------------------------------------------------------
// The Objection — THE HEAVIEST rubric. No regex separates "a position the
// viewer might hold" from "a line spoken in a scene," so the system prompt
// carries real, discriminating corpus examples of all three outcomes per
// author, drawn from the actual candidate pool (quoted spans starting
// "But"/a question word, <=14 words, no proper nouns). Seneca's own corpus
// spans multiple books under one author_slug, so his prompt explicitly
// leads with On Anger's viewer-facing objections and calls out On the
// Happy Life's Epicurean doctrinal disputes as the reject case to be
// strict about, per the plan.
// ---------------------------------------------------------------------------

const OBJECTION_RUBRIC_TASK = `You are judging a candidate for "The Objection" — a format that shows ONE short quoted line, alone on screen, as an objection the VIEWER is meant to recognize as something THEY might think or say. The card has already passed a mechanical filter: it is a quoted span starting with "But" or a question word, at most 14 words, with no proper nouns.

Your job is a judgment call no regex can make. Classify the line as exactly one of:

(A) viewer_position — ACCEPT. A position a general reader could plausibly hold about their OWN life, raised as a rhetorical objection the author anticipates and then answers. It reads naturally as something the reader themselves might think or blurt out: no specific named character, no specific staged incident, no specific rival philosophical school attached. Often explicitly signaled by "you might say," "you say," or simply voiced as the natural next objection to what was just argued.

(B) dramatized_scene — REJECT. A line spoken by a character INSIDE a narrated scene: a specific person, in a specific staged incident, saying something to another specific person. Even when phrased in the second person or left unnamed, if the line only makes sense as dialogue inside a little story being told (a friend's grievance over gossip, a dying man's joke to his friends, a courtroom exchange), it is a scene, not a general viewer's own thought — reject it no matter how well-written.

(C) doctrinal_dispute — REJECT. An argument between philosophical schools or a named intellectual position (for example, a Stoic-vs-Epicurean debate about whether pleasure belongs in "the highest good"). A general reader does not walk around holding a rival school's technical objection as their own — reject it even when it is a clean, well-formed rhetorical question that looks identical in shape to a good viewer_position line.

When in doubt between (A) and (B)/(C), reject. The bar: would an ordinary reader, with no context and no philosophy background, immediately recognize this as something THEY might think about THEIR OWN life?

${VOICE_REMINDER}

Respond with ONLY this JSON (no other text) — EXACTLY these three fields, in this shape, and no others. Put ALL of your reasoning inside "reason"; do not invent additional fields:
{
  "verdict": "accept" | "reject",
  "classification": "viewer_position" | "dramatized_scene" | "doctrinal_dispute",
  "reason": "<one sentence explaining your classification>"
}`;

/**
 * Real, corpus-drawn discriminating examples per author. Chosen from the
 * actual ~50-candidate raw pool (measured spread: epictetus 23, seneca 35,
 * marcus-aurelius 3) so the model calibrates against genuine borderline
 * cases rather than invented ones.
 */
const OBJECTION_EXAMPLES: Record<AuthorSlug, string> = {
  epictetus: `EXAMPLES FROM EPICTETUS (Discourses / Enchiridion):

ACCEPT — viewer_position:
"But why did he bring me into the world under these conditions?" — a plausible complaint anyone could have about their own life circumstances. No name, no staged scene, just a universal objection to one's lot.

REJECT — dramatized_scene:
"But it's not fair," you say. "I told you my neighbor's secrets. Now you should tell me yours." — this is dialogue inside one specific staged dispute (a gossiping friend, a concrete tit-for-tat over secrets), not a general thought a viewer would recognize as their own.`,

  "marcus-aurelius": `EXAMPLES FROM MARCUS AURELIUS (Meditations):

ACCEPT — viewer_position:
"But the play isn't finished yet — only three acts are done!" — a universal objection to dying "too soon," recognizable to any reader facing their own mortality, with no named character or staged incident attached.

Marcus Aurelius rarely stages dialogue — most of his candidates read as private, reflective questions he is putting to himself. Treat those as viewer_position unless one clearly references a specific person or a specific incident.`,

  seneca: `EXAMPLES FROM SENECA (spans On Anger, On the Happy Life, and others):

LEAD WITH ON ANGER — its objections are about the reader's own temper and grievances, not doctrine. ACCEPT — viewer_position:
"But some angry people stay in control," you might say. — a plausible thing a reader defending their own anger would say about themselves.
"But this person has already hurt me," you say, "and I haven't hurt him yet." — a personal grievance any reader could recognize as their own, even though it names no one.

REJECT — dramatized_scene:
"Why are you upset?" he asked them. — dialogue spoken by one specific character (mid-execution-anecdote) to specific friends inside a narrated story, not a general viewer's own thought.

BE STRICT WITH ON THE HAPPY LIFE — it is full of Epicurean doctrinal disputes that look identical in shape to good viewer_position lines. REJECT — doctrinal_dispute:
"But pleasure combined with virtue can't give bad advice," our opponent says. — Seneca's Epicurean opponent making a technical claim about "the highest good." No ordinary reader holds this as their own objection; it is a debate between schools, not a life problem.
"But what's wrong with combining virtue and pleasure? Why can't we make the highest good from both honor and pleasure together?" — same doctrinal pattern: reject even though it is clean, well-formed, and grammatically identical in shape to a good viewer_position line.`,
};

/** Static per-author system prompt for The Objection rubric — cacheable across every Objection candidate by that author. */
export function buildObjectionRubricSystem(authorSlug: AuthorSlug): string {
  const examples = OBJECTION_EXAMPLES[authorSlug] ?? "";
  return `${OBJECTION_RUBRIC_TASK}

You are judging candidates from ${authorDisplayName(authorSlug)}.

${examples}`;
}

/** Per-candidate user message for The Objection rubric. */
export function buildObjectionRubricUser(quotedLine: string, card: Pick<Card, "plain_english">): string {
  return `QUOTED LINE (the only text that will ever appear on screen — at most 14 words):
"${quotedLine}"

FULL CARD TEXT (context only, to help you judge whether this is a general viewer position, a dramatized scene, or a doctrinal dispute — nothing beyond the quoted line above will ever appear on screen):
${card.plain_english}

Respond with ONLY the JSON described above.`;
}

// ---------------------------------------------------------------------------
// Re-exported for test/call-site convenience so consumers of this module
// don't also need to import directly from ./premises.ts for these two
// shared constants and the shared word-count helper.
// ---------------------------------------------------------------------------
export { LANDING_LINE_MAX_WORDS, QUESTION_MAX_WORDS, wordCount };
export type { AuthorSlug };
