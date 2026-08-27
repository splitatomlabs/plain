import type { Card } from "./types.js";
import { AUTHOR_META, type AuthorSlug } from "./constants.js";
import { LANDING_LINE_MIN_WORDS, LANDING_LINE_MAX_WORDS, wordCount, verbatim, findLandingLines } from "./premises.js";
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
 * The Question's rubric result. Carries TWO INDEPENDENT signals, per T22 —
 * neither one folds into the other:
 *
 * 1. `verdict` (T04 layer (c) — topic drift, UNCHANGED from before T22).
 *    Verifies that the candidate answer sentence ACTUALLY ANSWERS the
 *    question rather than merely following it chronologically.
 *
 * 2. STOPPING POWER (T22 — new). Drift asks "does the following sentence
 *    answer the question"; that check can pass cleanly on a pair that is
 *    still not worth posting, because the format's whole mechanic is a
 *    viewer SILENTLY PREDICTING an answer before checking it against the
 *    author's: `"Do you have reason?" -> "Yes, I do."` answers correctly
 *    (verdict: "answers") but is meaningless with no context on screen and
 *    has nothing to predict against; `"Can't serve in the army?" -> "Then
 *    run for office."` also answers correctly but presupposes an ancient
 *    situation no modern viewer is in. Stopping power scores three things
 *    the drift check does not, each its own boolean so a failure is
 *    diagnosable by WHICH dimension failed rather than a single opaque
 *    reject:
 *    - `standalone_intelligible` — does the QUESTION mean something with
 *      zero context on screen?
 *    - `answer_has_substance` — is there a real claim in the ANSWER to
 *      check a silent prediction against, or is it a bare "Yes"/"No"/
 *      restatement?
 *    - `modern_premise` — is the situation the question presupposes one a
 *      viewer TODAY is actually in?
 *
 * `passesStoppingPower` combines the three into a single pass/fail for
 * pool-filtering purposes (see ./schedule.ts's `loadWallPool`), but the
 * three raw booleans are kept on the parsed/scored result too, so a pair
 * that fails ONLY stopping power stays distinguishable from one that fails
 * ONLY drift — both signals are independently readable off the same row,
 * never merged into one.
 */
export type QuestionRubricVerdict = "answers" | "drifts";
export const QUESTION_RUBRIC_VERDICTS: readonly QuestionRubricVerdict[] = ["answers", "drifts"];

export interface QuestionRubricResult {
  verdict: QuestionRubricVerdict;
  standalone_intelligible: boolean;
  answer_has_substance: boolean;
  modern_premise: boolean;
  reason: string;
}

/**
 * True only when all three T22 stopping-power dimensions are explicitly
 * `true`. Deliberately strict equality (`=== true`), not mere truthiness:
 * a row whose field is `undefined` (missing entirely — e.g. a pre-T22 pool
 * file written before this dimension existed) must FAIL CLOSED rather than
 * be treated as passing by accident. Pure and synchronous — no LLM call —
 * because the three dimensions are already scored by the rubric; this
 * function only combines already-scored booleans, never judges text itself.
 */
export function passesStoppingPower(entry: {
  standalone_intelligible?: boolean;
  answer_has_substance?: boolean;
  modern_premise?: boolean;
}): boolean {
  return (
    entry.standalone_intelligible === true && entry.answer_has_substance === true && entry.modern_premise === true
  );
}

// Pf39c2-social-pilot-02a D01: The Objection's own rubric result
// (`ObjectionRubricVerdict`/`ObjectionClassification`/`ObjectionRubricResult`)
// was deleted outright along with the format — the channel is one Wall a
// day, drawn from the Wall pool, nothing else.

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

/**
 * Parse a raw LLM response into a validated `WallRubricResult`. Rejects
 * malformed JSON; rejects a payload missing a required field, using the
 * wrong type for a field, or carrying a score outside [`WALL_SCORE_MIN`,
 * `WALL_SCORE_MAX`] — see `logIgnoredFields`'s own doc comment for why an
 * ADDITIVE unrecognized field, e.g. a commentary field the model
 * volunteered alongside a complete valid response, is tolerated rather than
 * rejected.
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

// Pf39c2-social-pilot-02a D01: `parseQuestionRubricResponse` and
// `parseObjectionRubricResponse` (and the now-unused `requireEnum`/
// `requireBoolean` helpers they alone called) were deleted outright along
// with their formats — the channel is one Wall a day, drawn from the Wall
// pool, nothing else.

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
 * V01 (social pilot 02a) note: this used to match a live `wallGate` floor
 * (`wallGate` in ./premises.ts required `wordCount(original_excerpt) >= 80`)
 * on the theory that phase 1's scrolling wall needed a long original excerpt
 * to outrun the viewer. That theory died at T08/R02: phase 1 no longer
 * scrolls the card's own excerpt at all — it scrolls the surrounding
 * CHAPTER block (`social/src/render/chapter-text.ts`'s
 * `buildChapterTextBlock`), which repeats whole chapter laps until IT clears
 * the travel floor. V01 deleted the corresponding floor from `wallGate`
 * itself, so this constant and `withinWallOriginalLimit` below no longer
 * mirror any live gate — nothing in the pipeline calls either of them
 * outside their own unit tests. Left in place (not deleted) because
 * removing them is a separate, unscoped decision from V01's; there is
 * deliberately no upper bound either way — a 150+ word original is exactly
 * what makes phase 1 impenetrable, and is a valid, not an over-length, Wall
 * original.
 */
export const WALL_ORIGINAL_MIN_WORDS = 80;

// Pf39c2-social-pilot-02a D01: `OBJECTION_MAX_WORDS`/`withinObjectionLimit`
// and `withinQuestionLimit` were deleted outright along with their formats —
// the channel is one Wall a day, drawn from the Wall pool, nothing else.

/**
 * True when a Wall original of `wordCountValue` words clears
 * `WALL_ORIGINAL_MIN_WORDS`. No ceiling — see that constant's doc comment,
 * including the V01 note that this floor is no longer enforced anywhere in
 * the live pipeline.
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

Every card you see has already passed a mechanical gate: every line in the candidate list below is a real, complete sentence lifted verbatim from the plain English translation, standing alone with no preceding context. Your job is scoring and selection, not gatekeeping — do not reject the card itself.

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
// Re-exported for test/call-site convenience so consumers of this module
// don't also need to import directly from ./premises.ts for this shared
// constant and the shared word-count helper.
// ---------------------------------------------------------------------------
export { LANDING_LINE_MAX_WORDS, wordCount };
export type { AuthorSlug };
