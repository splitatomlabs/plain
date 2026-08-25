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
  WALL_SCORE_MIN,
  WALL_SCORE_MAX,
  OBJECTION_MAX_WORDS,
  WALL_ORIGINAL_MIN_WORDS,
  wordCount,
} from "../premises-scoring.js";
import type { Card } from "../types.js";

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

describe("The Question rubric shape", () => {
  it("accepts a valid Question payload", () => {
    const result = parseQuestionRubricResponse(validQuestionJSON);
    expect(result).toMatchObject({
      verdict: expect.stringMatching(/^(answers|drifts)$/),
      reason: expect.any(String),
    });
  });

  it("rejects a payload missing reason", () => {
    const bad = JSON.stringify({ verdict: "answers" });
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
