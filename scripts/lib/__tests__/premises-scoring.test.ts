import { describe, it, expect } from "vitest";
import {
  parseWallRubricResponse,
  checkFaithfulness,
  withinWallOriginalLimit,
  withinWallLandingLineLimit,
  passesStoppingPower,
  WALL_SCORE_MIN,
  WALL_SCORE_MAX,
  WALL_ORIGINAL_MIN_WORDS,
  buildWallRubricSystem,
  buildWallRubricUser,
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
// Pf39c2-social-pilot-02a D01: Question, Objection and Still were deleted
// outright — the channel is one Wall a day, drawn from the Wall pool,
// nothing else. This file used to also cover:
//   - parseQuestionRubricResponse / parseObjectionRubricResponse fenced-JSON
//     parsing
//   - "The Question rubric shape" / "The Objection rubric shape"
//   - The Question/Objection halves of the T20 additive-unknown-fields
//     coverage
//   - withinQuestionLimit / withinObjectionLimit / OBJECTION_MAX_WORDS
//   - buildQuestionRubricSystem/User, buildObjectionRubricSystem/User
// All of that is gone along with the formats it served. `passesStoppingPower`
// survives (see its own doc comment in ../premises-scoring.ts) because
// `wallAuthorWeights`'s author-balance correction still takes a Question pool
// as an input even though nothing produces one any more.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Fenced-JSON parsing
// ---------------------------------------------------------------------------

const validWallJSON = JSON.stringify({
  impenetrability_score: 4,
  landing_line_score: 5,
  chosen_landing_line: "The quality of your thoughts shapes the quality of your life.",
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
// 3. The Wall's rubric output shape
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
});

// ---------------------------------------------------------------------------
// T22: STOPPING-POWER — a dimension independent of drift. The Question's
// drift check (verdict) alone let a correctly-answered but unpostable pair
// through; these tests pin the two REAL week-1 slots that motivated this
// task, drawn from the actual corpus rather than invented text, plus a real
// pair that should still pass everything. `passesStoppingPower` survives
// The Question's own deletion (D01) — see its doc comment in
// ../premises-scoring.ts.
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

// ---------------------------------------------------------------------------
// 4. Per-format length limits
//    On-screen text limits are PER FORMAT, not global. The Wall's original
//    side has a HIGH ceiling (150+ words is valid); The Wall's landing
//    line is short-form and independently capped.
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

// ---------------------------------------------------------------------------
// 5. Prompt builder (T07)
//    The Wall's system prompt must be a pure function of authorSlug alone —
//    static and byte-identical across calls for the same author (so the
//    Anthropic prompt cache actually hits) — and must differ meaningfully
//    across authors.
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
