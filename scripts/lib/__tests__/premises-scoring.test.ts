import { describe, it, expect } from "vitest";
import {
  parseWallRubricResponse,
  parseQuestionRubricResponse,
  parseObjectionRubricResponse,
  checkFaithfulness,
  withinWallOriginalLimit,
  withinWallLandingLineLimit,
  withinQuestionLimit,
  withinObjectionLimit,
  passesStoppingPower,
  WALL_SCORE_MIN,
  WALL_SCORE_MAX,
  OBJECTION_MAX_WORDS,
  WALL_ORIGINAL_MIN_WORDS,
  wordCount,
  buildWallRubricSystem,
  buildWallRubricUser,
  buildQuestionRubricSystem,
  buildQuestionRubricUser,
  buildObjectionRubricSystem,
  buildObjectionRubricUser,
} from "../premises-scoring.js";
import { loadCorpus } from "../premises.js";
import type { Card } from "../types.js";
import type { AuthorSlug } from "../constants.js";

const AUTHOR_SLUGS: AuthorSlug[] = ["epictetus", "marcus-aurelius", "seneca"];

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "meditations-05-016",
    book_slug: "meditations",
    chapter_slug: "book-05",
    card_number: 16,
    total_cards_in_chapter: 34,
    plain_english: "The quality of your thoughts shapes the quality of your life.",
    original_excerpt: "The happiness of your life depends upon the quality of your thoughts.",
    source_reference: "Meditations, Book 5, Section 16",
    author_slug: "marcus-aurelius",
    tags: ["calm-your-mind"],
    reading_time_seconds: 30,
    ...overrides,
  };
}

/** Build a string with exactly `n` words — helper for length-limit tests. */
function words(n: number, base = "word"): string {
  return Array.from({ length: n }, (_, i) => `${base}${i}`).join(" ");
}

// ---------------------------------------------------------------------------
// 1. Fenced-JSON parsing
// ---------------------------------------------------------------------------

const validWallJSON = JSON.stringify({
  impenetrability_score: 4,
  landing_line_score: 5,
  chosen_landing_line: "The quality of your thoughts shapes the quality of your life.",
});

const validQuestionJSON = JSON.stringify({
  verdict: "answers",
  standalone_intelligible: true,
  answer_has_substance: true,
  modern_premise: true,
  reason: "The following sentence directly resolves the question.",
});

const validObjectionJSON = JSON.stringify({
  verdict: "accept",
  classification: "viewer_position",
  reason: "A general reader could plausibly hold this objection themselves.",
});

describe("parseWallRubricResponse — fenced-JSON parsing", () => {
  it("accepts bare JSON", () => {
    const result = parseWallRubricResponse(validWallJSON);
    expect(result.chosen_landing_line).toBe("The quality of your thoughts shapes the quality of your life.");
  });

  it("accepts JSON wrapped in ```json fences", () => {
    const wrapped = "```json\n" + validWallJSON + "\n```";
    const result = parseWallRubricResponse(wrapped);
    expect(result.impenetrability_score).toBe(4);
  });

  it("accepts JSON with leading and trailing prose", () => {
    const wrapped = `Sure, here is my assessment:\n${validWallJSON}\nLet me know if you need anything else.`;
    const result = parseWallRubricResponse(wrapped);
    expect(result.landing_line_score).toBe(5);
  });

  it("rejects malformed JSON with a clear error", () => {
    expect(() => parseWallRubricResponse("{not valid json at all")).toThrow(/json/i);
  });
});

describe("parseQuestionRubricResponse — fenced-JSON parsing", () => {
  it("accepts bare JSON", () => {
    const result = parseQuestionRubricResponse(validQuestionJSON);
    expect(result.verdict).toBe("answers");
  });

  it("accepts JSON wrapped in ```json fences", () => {
    const wrapped = "```json\n" + validQuestionJSON + "\n```";
    const result = parseQuestionRubricResponse(wrapped);
    expect(result.verdict).toBe("answers");
  });

  it("accepts JSON with leading and trailing prose", () => {
    const wrapped = `My verdict:\n${validQuestionJSON}\nHope that helps!`;
    const result = parseQuestionRubricResponse(wrapped);
    expect(result.reason).toContain("resolves");
  });

  it("rejects malformed JSON with a clear error", () => {
    expect(() => parseQuestionRubricResponse("not json at all")).toThrow(/json/i);
  });
});

describe("parseObjectionRubricResponse — fenced-JSON parsing", () => {
  it("accepts bare JSON", () => {
    const result = parseObjectionRubricResponse(validObjectionJSON);
    expect(result.classification).toBe("viewer_position");
  });

  it("accepts JSON wrapped in ```json fences", () => {
    const wrapped = "```json\n" + validObjectionJSON + "\n```";
    const result = parseObjectionRubricResponse(wrapped);
    expect(result.verdict).toBe("accept");
  });

  it("accepts JSON with leading and trailing prose", () => {
    const wrapped = `Here's my classification:\n${validObjectionJSON}\nDone.`;
    const result = parseObjectionRubricResponse(wrapped);
    expect(result.classification).toBe("viewer_position");
  });

  it("rejects malformed JSON with a clear error", () => {
    expect(() => parseObjectionRubricResponse("{{{broken")).toThrow(/json/i);
  });
});

// ---------------------------------------------------------------------------
// 2. Rejection of text not traceable to the source card
//    THE CENTRAL CONSTRAINT: every word on screen must be traceable to
//    plain_english or original_excerpt. Enforced mechanically — no LLM
//    call inside checkFaithfulness itself.
// ---------------------------------------------------------------------------

describe("checkFaithfulness", () => {
  const card = makeCard({
    plain_english: "The quality of your thoughts shapes the quality of your life.",
    original_excerpt: "The happiness of your life depends upon the quality of your thoughts.",
  });

  it("accepts text that is a verbatim substring of plain_english", () => {
    const result = checkFaithfulness("The quality of your thoughts shapes the quality of your life.", card);
    expect(result.faithful).toBe(true);
  });

  it("accepts text that is a verbatim substring of original_excerpt", () => {
    const result = checkFaithfulness("The happiness of your life depends upon the quality of your thoughts.", card);
    expect(result.faithful).toBe(true);
  });

  it("accepts a verbatim partial-sentence substring of a source field", () => {
    const result = checkFaithfulness("the quality of your thoughts", card);
    // Note: substring matching is case-sensitive by design — mechanical
    // traceability means an EXACT match, not a case-insensitive one.
    // "the quality of your thoughts" (lowercase "the") is a literal
    // substring of plain_english's tail: "...shapes the quality of your
    // thoughts." — this assertion pins that exact-substring behavior.
    expect(result.faithful).toBe(true);
  });

  it("rejects paraphrased text", () => {
    const result = checkFaithfulness("Your thinking determines how good your life is.", card);
    expect(result.faithful).toBe(false);
  });

  it("rejects embellished text (source text plus invented additions)", () => {
    const result = checkFaithfulness(
      "The quality of your thoughts shapes the quality of your life, as every wise person has always known.",
      card,
    );
    expect(result.faithful).toBe(false);
  });

  it("rejects wholly invented text with no relation to either source field", () => {
    const result = checkFaithfulness("Marcus Aurelius wrote this while commanding troops on the frontier.", card);
    expect(result.faithful).toBe(false);
  });

  it("rejects near-miss text that is verbatim except for one changed word", () => {
    // Real text: "The quality of your thoughts shapes the quality of your life."
    // Near-miss: "life" -> "soul" — a single word substitution.
    const result = checkFaithfulness("The quality of your thoughts shapes the quality of your soul.", card);
    expect(result.faithful).toBe(false);
  });

  it("rejects text stitched together from two non-adjacent fragments of the same source field", () => {
    // "The quality of your thoughts" + "your life" are each real fragments,
    // but concatenating them is not an exact substring of plain_english.
    const result = checkFaithfulness("The quality of your thoughts is your life.", card);
    expect(result.faithful).toBe(false);
  });

  it("reports a reason when text is not faithful", () => {
    const result = checkFaithfulness("Invented text not found anywhere in the card.", card);
    expect(result.faithful).toBe(false);
    expect(result.reason).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3. Per-rubric output shapes
//    Three rubrics, three different shapes. Each parser must accept its own
//    shape and reject the other two formats' shapes (missing/extra fields,
//    wrong types, out-of-range scores).
// ---------------------------------------------------------------------------

describe("The Wall rubric shape", () => {
  it("accepts a valid Wall payload", () => {
    const result = parseWallRubricResponse(validWallJSON);
    expect(result).toMatchObject({
      impenetrability_score: expect.any(Number),
      landing_line_score: expect.any(Number),
      chosen_landing_line: expect.any(String),
    });
  });

  it("rejects a payload missing chosen_landing_line", () => {
    const bad = JSON.stringify({ impenetrability_score: 4, landing_line_score: 5 });
    // Message must name the missing field, not just "not implemented" —
    // pins the parser to a real, diagnosable validation error.
    expect(() => parseWallRubricResponse(bad)).toThrow(/chosen_landing_line/);
  });

  it("rejects a payload with a score as a string instead of a number", () => {
    const bad = JSON.stringify({
      impenetrability_score: "4",
      landing_line_score: 5,
      chosen_landing_line: "A line.",
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score/i);
  });

  it(`rejects a score below ${WALL_SCORE_MIN}`, () => {
    const bad = JSON.stringify({
      impenetrability_score: 0,
      landing_line_score: 5,
      chosen_landing_line: "A line.",
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score/i);
  });

  it(`rejects a score above ${WALL_SCORE_MAX}`, () => {
    const bad = JSON.stringify({
      impenetrability_score: 4,
      landing_line_score: 6,
      chosen_landing_line: "A line.",
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score/i);
  });

  it("rejects a Question-shaped payload (verdict/reason, no scores)", () => {
    expect(() => parseWallRubricResponse(validQuestionJSON)).toThrow(/score|chosen_landing_line/i);
  });

  it("rejects an Objection-shaped payload (verdict/classification/reason)", () => {
    expect(() => parseWallRubricResponse(validObjectionJSON)).toThrow(/score|chosen_landing_line/i);
  });
});

// ---------------------------------------------------------------------------
// T20: additive unknown fields are TOLERATED, not rejected.
//
// The real T11 run lost 107 of 1,003 Wall responses (10.7%) because the
// model returned every required field correctly, then volunteered an extra
// commentary field alongside them — a complete, valid scoring, thrown away
// for annotating itself. These four field names are drawn verbatim from the
// real drops logged in content/pipeline/social/premises.log.
// ---------------------------------------------------------------------------

describe("The Wall rubric tolerates additive unknown fields (T20)", () => {
  const validWallFields = {
    impenetrability_score: 4,
    landing_line_score: 5,
    chosen_landing_line: "The quality of your thoughts shapes the quality of your life.",
  };

  it.each([
    "impenetrability_score_check",
    "landing_line_score_note",
    "impenetrability_score_reason",
    "impenetrability_score_explanation",
  ])("parses successfully when the response also carries %s", (extraField) => {
    const raw = JSON.stringify({ ...validWallFields, [extraField]: "some model commentary" });
    const result = parseWallRubricResponse(raw);
    expect(result).toMatchObject(validWallFields);
    // The extra field must not leak into the returned result.
    expect(result).not.toHaveProperty(extraField);
  });

  it("parses successfully with multiple additive unknown fields at once", () => {
    // Real corpus example: wall_meditations-07-019_454 carried BOTH
    // impenetrability_reason and landing_line_reason simultaneously.
    const raw = JSON.stringify({
      ...validWallFields,
      impenetrability_reason: "dense clause-stacking",
      landing_line_reason: "stands alone cleanly",
    });
    const result = parseWallRubricResponse(raw);
    expect(result).toMatchObject(validWallFields);
  });

  it("still rejects a missing required field even when extra fields are present", () => {
    const bad = JSON.stringify({
      impenetrability_score: 4,
      landing_line_score: 5,
      impenetrability_score_reason: "some commentary",
      // chosen_landing_line omitted
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/chosen_landing_line/);
  });

  it("still rejects a wrong-typed known field even when extra fields are present", () => {
    const bad = JSON.stringify({
      impenetrability_score: "4",
      landing_line_score: 5,
      chosen_landing_line: "A line.",
      impenetrability_score_reason: "some commentary",
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score/i);
  });

  it("still rejects an out-of-range score even when extra fields are present", () => {
    const bad = JSON.stringify({
      impenetrability_score: 4,
      landing_line_score: 6,
      chosen_landing_line: "A line.",
      landing_line_score_note: "some commentary",
    });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score/i);
  });

  it("a Question-shaped payload is still rejected by the Wall parser even with an extra field added", () => {
    const bad = JSON.stringify({ verdict: "answers", reason: "resolves it", extra_commentary: "note" });
    expect(() => parseWallRubricResponse(bad)).toThrow(/score|chosen_landing_line/i);
  });
});

describe("The Question and Objection rubrics also tolerate additive unknown fields (T20)", () => {
  it("Question parser parses successfully with an extra commentary field", () => {
    const raw = JSON.stringify({
      verdict: "answers",
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: true,
      reason: "The following sentence directly resolves the question.",
      verdict_confidence: "high",
    });
    const result = parseQuestionRubricResponse(raw);
    expect(result).toMatchObject({ verdict: "answers" });
    expect(result).not.toHaveProperty("verdict_confidence");
  });

  it("Question parser still rejects an invalid verdict even with an extra field present", () => {
    const bad = JSON.stringify({ verdict: "maybe", reason: "Unclear.", verdict_confidence: "low" });
    expect(() => parseQuestionRubricResponse(bad)).toThrow(/verdict/i);
  });

  it("Objection parser parses successfully with an extra commentary field", () => {
    const raw = JSON.stringify({
      verdict: "accept",
      classification: "viewer_position",
      reason: "A general reader could plausibly hold this objection themselves.",
      classification_confidence: "high",
    });
    const result = parseObjectionRubricResponse(raw);
    expect(result).toMatchObject({ verdict: "accept", classification: "viewer_position" });
    expect(result).not.toHaveProperty("classification_confidence");
  });

  it("Objection parser still rejects an invalid classification even with an extra field present", () => {
    const bad = JSON.stringify({
      verdict: "accept",
      classification: "narrator_aside",
      reason: "Not a real classification.",
      classification_confidence: "low",
    });
    expect(() => parseObjectionRubricResponse(bad)).toThrow(/classification/i);
  });
});

describe("The Question rubric shape", () => {
  it("accepts a valid Question payload", () => {
    const result = parseQuestionRubricResponse(validQuestionJSON);
    expect(result).toMatchObject({
      verdict: expect.stringMatching(/^(answers|drifts)$/),
      reason: expect.any(String),
    });
  });

  it("rejects a payload missing reason", () => {
    const bad = JSON.stringify({
      verdict: "answers",
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: true,
    });
    expect(() => parseQuestionRubricResponse(bad)).toThrow(/reason/i);
  });

  it("rejects a payload with an invalid verdict value", () => {
    const bad = JSON.stringify({ verdict: "maybe", reason: "Unclear." });
    expect(() => parseQuestionRubricResponse(bad)).toThrow(/verdict/i);
  });

  it("rejects a Wall-shaped payload (scores + chosen_landing_line, no verdict)", () => {
    expect(() => parseQuestionRubricResponse(validWallJSON)).toThrow(/verdict/i);
  });

  it("rejects an Objection-shaped payload (has classification, which Question does not use)", () => {
    // validObjectionJSON's verdict is "accept", not a valid Question verdict
    // ("answers"/"drifts") — the real parser must reject on that basis.
    expect(() => parseQuestionRubricResponse(validObjectionJSON)).toThrow(/verdict/i);
  });

  it("rejects a payload missing a T22 stopping-power field (standalone_intelligible)", () => {
    const bad = JSON.stringify({
      verdict: "answers",
      answer_has_substance: true,
      modern_premise: true,
      reason: "n/a",
    });
    expect(() => parseQuestionRubricResponse(bad)).toThrow(/standalone_intelligible/i);
  });

  it("rejects a payload with a wrong-typed T22 stopping-power field", () => {
    const bad = JSON.stringify({
      verdict: "answers",
      standalone_intelligible: "yes", // string, not boolean
      answer_has_substance: true,
      modern_premise: true,
      reason: "n/a",
    });
    expect(() => parseQuestionRubricResponse(bad)).toThrow(/standalone_intelligible/i);
  });
});

// ---------------------------------------------------------------------------
// T22: STOPPING-POWER — a dimension independent of drift. The Question's
// drift check (verdict) alone lets a correctly-answered but unpostable pair
// through; these tests pin the two REAL week-1 slots that motivated this
// task, drawn from the actual corpus/committed pool rather than invented
// text, plus a real pair that should still pass everything.
// ---------------------------------------------------------------------------
describe("T22: stopping power — independent of drift", () => {
  const cards = loadCorpus();
  const cardById = (id: string): Card => {
    const card = cards.find((c) => c.id === id);
    if (!card) throw new Error(`fixture card ${id} not found in real corpus`);
    return card;
  };

  it("rejects the real 'Do you have reason?' pair (meditations-04-015) on BOTH standalone intelligibility and answer substance, even though drift passes", () => {
    const card = cardById("meditations-04-015");
    expect(card.plain_english).toContain("Do you have reason? Yes, I do.");

    // What a real rubric response for this pair plausibly looks like: the
    // answer DOES resolve the question (drift passes), but standalone
    // intelligibility and answer substance both fail.
    const parsed = {
      verdict: "answers" as const,
      standalone_intelligible: false,
      answer_has_substance: false,
      modern_premise: true,
      reason: "The answer resolves the question, but the question is meaningless with no context and the answer has no substance to check a prediction against.",
    };

    expect(parsed.verdict).toBe("answers"); // drift passes
    expect(passesStoppingPower(parsed)).toBe(false); // stopping power fails
  });

  it("rejects the real 'Can't serve in the army?' pair (peace-of-mind-04-002) on modern applicability, even though drift passes and the question/answer are otherwise fine", () => {
    const card = cardById("peace-of-mind-04-002");
    expect(card.plain_english).toContain("Can't serve in the army? Then run for office.");

    const parsed = {
      verdict: "answers" as const,
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: false,
      reason: "The answer directly and substantively resolves the question, but it presupposes an ancient civic structure no modern viewer is in.",
    };

    expect(parsed.verdict).toBe("answers"); // drift passes
    expect(passesStoppingPower(parsed)).toBe(false); // stopping power fails
  });

  it("still passes a strong real pair ('What is a master anyway?' -> 'One person can't really master another.', discourses-18-010)", () => {
    const card = cardById("discourses-18-010");
    expect(card.plain_english).toContain("What is a master anyway? One person can't really master another.");

    const parsed = {
      verdict: "answers" as const,
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: true,
      reason: "Standalone and intelligible, the answer makes a real claim, and the premise applies to any reader today.",
    };

    expect(parsed.verdict).toBe("answers");
    expect(passesStoppingPower(parsed)).toBe(true);
  });

  it("the two signals are independently readable: a pair failing ONLY stopping power is distinguishable from one failing ONLY drift", () => {
    const failsOnlyStoppingPower = {
      verdict: "answers" as const,
      standalone_intelligible: false,
      answer_has_substance: true,
      modern_premise: true,
      reason: "n/a",
    };
    const failsOnlyDrift = {
      verdict: "drifts" as const,
      standalone_intelligible: true,
      answer_has_substance: true,
      modern_premise: true,
      reason: "n/a",
    };

    expect(failsOnlyStoppingPower.verdict).toBe("answers");
    expect(passesStoppingPower(failsOnlyStoppingPower)).toBe(false);

    expect(failsOnlyDrift.verdict).toBe("drifts");
    expect(passesStoppingPower(failsOnlyDrift)).toBe(true);

    // Neither row's failure mode is indistinguishable from the other's —
    // each fails a DIFFERENT one of the two independent signals.
    expect(failsOnlyStoppingPower.verdict === "answers" && !passesStoppingPower(failsOnlyStoppingPower)).toBe(true);
    expect(failsOnlyDrift.verdict === "drifts" && passesStoppingPower(failsOnlyDrift)).toBe(true);
  });

  it("passesStoppingPower fails closed when a dimension is missing entirely (not just false)", () => {
    expect(passesStoppingPower({ standalone_intelligible: true, answer_has_substance: true })).toBe(false);
    expect(passesStoppingPower({})).toBe(false);
  });
});

describe("The Objection rubric shape", () => {
  it("accepts a valid Objection payload", () => {
    const result = parseObjectionRubricResponse(validObjectionJSON);
    expect(result).toMatchObject({
      verdict: expect.stringMatching(/^(accept|reject)$/),
      classification: expect.stringMatching(/^(viewer_position|dramatized_scene|doctrinal_dispute)$/),
      reason: expect.any(String),
    });
  });

  it("rejects a payload missing classification", () => {
    const bad = JSON.stringify({ verdict: "accept", reason: "Plausible objection." });
    expect(() => parseObjectionRubricResponse(bad)).toThrow(/classification/i);
  });

  it("rejects a payload with an invalid classification enum value", () => {
    const bad = JSON.stringify({
      verdict: "accept",
      classification: "narrator_aside",
      reason: "Not a real classification.",
    });
    expect(() => parseObjectionRubricResponse(bad)).toThrow(/classification/i);
  });

  it("rejects a payload with an invalid verdict value", () => {
    const bad = JSON.stringify({
      verdict: "maybe",
      classification: "viewer_position",
      reason: "Unclear.",
    });
    expect(() => parseObjectionRubricResponse(bad)).toThrow(/verdict/i);
  });

  it("rejects a Wall-shaped payload (scores + chosen_landing_line, no verdict/classification)", () => {
    expect(() => parseObjectionRubricResponse(validWallJSON)).toThrow(/verdict|classification/i);
  });

  it("rejects a Question-shaped payload (verdict/reason, missing classification)", () => {
    expect(() => parseObjectionRubricResponse(validQuestionJSON)).toThrow(/classification/i);
  });
});

// ---------------------------------------------------------------------------
// 4. Per-format length limits
//    On-screen text limits are PER FORMAT, not global. The Wall's original
//    side has a HIGH ceiling (150+ words is valid); The Wall's landing
//    line, The Question, and The Objection's quoted line are all
//    short-form and independently capped. No single global limit exists.
// ---------------------------------------------------------------------------

describe("The Wall's original-side length limit", () => {
  it(`accepts an original at the ${WALL_ORIGINAL_MIN_WORDS}-word floor`, () => {
    expect(withinWallOriginalLimit(WALL_ORIGINAL_MIN_WORDS)).toBe(true);
  });

  it("rejects an original below the floor", () => {
    expect(withinWallOriginalLimit(WALL_ORIGINAL_MIN_WORDS - 1)).toBe(false);
  });

  it("accepts a 150+ word original — deliberately no upper ceiling", () => {
    expect(withinWallOriginalLimit(150)).toBe(true);
    expect(withinWallOriginalLimit(400)).toBe(true);
  });
});

describe("The Wall's landing-line length limit", () => {
  it("accepts an 18-word landing line (the documented maximum)", () => {
    expect(withinWallLandingLineLimit(words(18))).toBe(true);
  });

  it("rejects a 19-word landing line", () => {
    expect(withinWallLandingLineLimit(words(19))).toBe(false);
  });

  it("rejects a 150-word 'landing line' — the Wall's own landing-line cap is short-form, unlike its original side", () => {
    expect(withinWallLandingLineLimit(words(150))).toBe(false);
  });
});

describe("The Question's length limit", () => {
  it("accepts a 14-word question (QUESTION_MAX_WORDS)", () => {
    expect(withinQuestionLimit(words(14))).toBe(true);
  });

  it("rejects a 15-word question", () => {
    expect(withinQuestionLimit(words(15))).toBe(false);
  });

  it("rejects a 150-word question — proving The Wall's high ceiling is not applied globally", () => {
    expect(withinQuestionLimit(words(150))).toBe(false);
  });
});

describe("The Objection's length limit", () => {
  it(`accepts a ${OBJECTION_MAX_WORDS}-word quoted line`, () => {
    expect(withinObjectionLimit(words(OBJECTION_MAX_WORDS))).toBe(true);
  });

  it(`rejects a ${OBJECTION_MAX_WORDS + 1}-word quoted line`, () => {
    expect(withinObjectionLimit(words(OBJECTION_MAX_WORDS + 1))).toBe(false);
  });
});

describe("length limits are per-format, not global", () => {
  it("a 150-word text passes The Wall's original limit but fails The Question's limit", () => {
    const text150 = words(150);
    expect(withinWallOriginalLimit(wordCount(text150))).toBe(true);
    expect(withinQuestionLimit(text150)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 5. Prompt builders (T07)
//    Each system prompt must be a pure function of authorSlug alone — static
//    and byte-identical across calls for the same author (so the Anthropic
//    prompt cache actually hits) — and must differ meaningfully across
//    authors. The Objection's system prompt carries the heaviest weight per
//    the plan, so it must contain real, discriminating examples of all
//    three classifications.
// ---------------------------------------------------------------------------

describe("buildWallRubricSystem", () => {
  it("is static and stable across calls for the same author", () => {
    expect(buildWallRubricSystem("seneca")).toBe(buildWallRubricSystem("seneca"));
  });

  it("differs across authors", () => {
    const prompts = new Set(AUTHOR_SLUGS.map((slug) => buildWallRubricSystem(slug)));
    expect(prompts.size).toBe(AUTHOR_SLUGS.length);
  });

  it("names both rubric scores and explains impenetrability is about visual texture, not idea difficulty", () => {
    const system = buildWallRubricSystem("marcus-aurelius");
    expect(system).toMatch(/impenetrability_score/);
    expect(system).toMatch(/landing_line_score/);
    expect(system).toMatch(/not about how hard the ideas/i);
  });
});

describe("buildWallRubricUser", () => {
  it("embeds the original excerpt and lists qualifying landing line candidates verbatim", () => {
    const card = makeCard();
    const user = buildWallRubricUser(card);
    expect(user).toContain(card.original_excerpt);
    expect(user).toContain("The quality of your thoughts shapes the quality of your life.");
  });

  it("throws when a card has no qualifying landing line candidates", () => {
    const card = makeCard({ plain_english: "But this, that." });
    expect(() => buildWallRubricUser(card)).toThrow(/landing line/i);
  });
});

describe("buildQuestionRubricSystem", () => {
  it("is static and stable across calls for the same author", () => {
    expect(buildQuestionRubricSystem("epictetus")).toBe(buildQuestionRubricSystem("epictetus"));
  });

  it("differs across authors", () => {
    const prompts = new Set(AUTHOR_SLUGS.map((slug) => buildQuestionRubricSystem(slug)));
    expect(prompts.size).toBe(AUTHOR_SLUGS.length);
  });

  it("scopes topic drift to resolution only, not the deterministic layers' concerns", () => {
    const system = buildQuestionRubricSystem("seneca");
    expect(system).toMatch(/topic drift/i);
    expect(system).toMatch(/already (been )?(passed|checked)/i);
  });

  // T22: the rubric now ALSO scores stopping power, independent of drift —
  // pin that the prompt names all three sub-dimensions and both required
  // JSON field names, not just the drift verdict.
  it("names all three T22 stopping-power dimensions and requires the extended JSON shape", () => {
    const system = buildQuestionRubricSystem("epictetus");
    expect(system).toMatch(/standalone/i);
    expect(system).toMatch(/substance/i);
    expect(system).toMatch(/modern/i);
    expect(system).toContain("standalone_intelligible");
    expect(system).toContain("answer_has_substance");
    expect(system).toContain("modern_premise");
  });

  it("uses the real motivating examples so the rubric calibrates against genuine failure cases", () => {
    const system = buildQuestionRubricSystem("marcus-aurelius");
    expect(system).toContain("Do you have reason?");
    expect(system).toContain("Can't serve in the army?");
    expect(system).toContain("What is a master anyway?");
  });
});

describe("buildQuestionRubricUser", () => {
  it("embeds the question and candidate answer verbatim", () => {
    const request = {
      card_id: "discourses-49-010",
      question: "Was your desire in any danger?",
      answer: "No, it wasn't.",
    };
    const user = buildQuestionRubricUser(request);
    expect(user).toContain(request.question);
    expect(user).toContain(request.answer);
  });
});

describe("buildObjectionRubricSystem", () => {
  it("is static and stable across calls for the same author", () => {
    expect(buildObjectionRubricSystem("seneca")).toBe(buildObjectionRubricSystem("seneca"));
  });

  it("differs across authors", () => {
    const prompts = new Set(AUTHOR_SLUGS.map((slug) => buildObjectionRubricSystem(slug)));
    expect(prompts.size).toBe(AUTHOR_SLUGS.length);
  });

  it("names all three classifications", () => {
    for (const slug of AUTHOR_SLUGS) {
      const system = buildObjectionRubricSystem(slug);
      expect(system).toContain("viewer_position");
      expect(system).toContain("dramatized_scene");
      expect(system).toContain("doctrinal_dispute");
    }
  });

  it("Seneca's prompt leads with On Anger and flags On the Happy Life's doctrinal disputes", () => {
    const system = buildObjectionRubricSystem("seneca");
    expect(system).toMatch(/On Anger/);
    expect(system).toMatch(/our opponent/);
  });

  it("carries a real corpus discriminating example for each author", () => {
    expect(buildObjectionRubricSystem("epictetus")).toContain(
      "But why did he bring me into the world under these conditions?",
    );
    expect(buildObjectionRubricSystem("marcus-aurelius")).toContain(
      "But the play isn't finished yet — only three acts are done!",
    );
    expect(buildObjectionRubricSystem("seneca")).toContain("But some angry people stay in control");
  });
});

describe("buildObjectionRubricUser", () => {
  it("embeds the quoted line and the full card text for context", () => {
    const card = makeCard();
    const quotedLine = "But some angry people stay in control,";
    const user = buildObjectionRubricUser(quotedLine, card);
    expect(user).toContain(quotedLine);
    expect(user).toContain(card.plain_english);
  });
});
