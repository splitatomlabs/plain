import { describe, it, expect } from "vitest";
import {
  loadCorpus,
  wordCount,
  isSelfContainedOpening,
  SELF_CONTAINED_OPENING_REJECTS,
  firstSentence,
  sentences,
  hasQuotedSpeech,
  lengthDelta,
  byBook,
  mechanicalGates,
  findLandingLines,
  selectLandingLine,
  wallGate,
  verbatim,
  hasUnresolvedReference,
  classifyWallSubTypes,
  eligibleWallOpenings,
  originalReadingGrade,
  rankWall,
  WALL_THOU_MARKER_MIN,
  WALL_CASCADE_SEMICOLON_MIN,
  WALL_SCENE_QUOTE_MIN,
  WALL_COUNTDOWN_DELTA_MIN,
  WALL_ORIGINAL_GRADE_MIN,
  QUESTION_MAX_WORDS,
  QUESTION_SENTENCE_WINDOW,
  QUESTION_OPENING_REJECTS,
  findQuestionCandidate,
  questionCandidateAnswer,
  isExclamationShaped,
  hasAttributionLeak,
  hasMidThoughtOpener,
  isFragmentQuestion,
  passesLayerA,
  isSocraticChainAnswer,
  passesLayerB,
  questionGate,
  buildQuestionDriftRequests,
  hasColonAttributionLeadIn,
  isSecondPersonQuestion,
  hasThirdPartyReference,
  hasUnbalancedSingleQuote,
  hasUnbalancedQuotes,
  PIVOT_ANSWER_PHRASES,
  isPivotAnswer,
} from "../premises.js";
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

// ---------------------------------------------------------------------------
// wordCount
// ---------------------------------------------------------------------------

describe("wordCount", () => {
  it("counts whitespace-separated words", () => {
    expect(wordCount("one two three")).toBe(3);
  });

  it("collapses repeated whitespace", () => {
    expect(wordCount("one   two\tthree\nfour")).toBe(4);
  });

  it("trims leading and trailing whitespace", () => {
    expect(wordCount("  one two  ")).toBe(2);
  });

  it("returns 0 for empty string", () => {
    expect(wordCount("")).toBe(0);
  });

  it("returns 0 for whitespace-only string", () => {
    expect(wordCount("   ")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isSelfContainedOpening
// ---------------------------------------------------------------------------

describe("isSelfContainedOpening", () => {
  it("rejects each opener in SELF_CONTAINED_OPENING_REJECTS", () => {
    for (const opener of SELF_CONTAINED_OPENING_REJECTS) {
      expect(isSelfContainedOpening(`${opener} this reads like a continuation.`)).toBe(false);
    }
  });

  it("is case-insensitive", () => {
    expect(isSelfContainedOpening("but this reads like a continuation.")).toBe(false);
    expect(isSelfContainedOpening("BUT THIS READS LIKE A CONTINUATION.")).toBe(false);
  });

  it("matches at a word boundary, not a prefix", () => {
    // "Sotto" starts with "So" as a substring but is not the word "So"
    expect(isSelfContainedOpening("Sotto voce, he agreed.")).toBe(true);
    // "Itself" starts with "It" as a substring but is not the word "It"
    expect(isSelfContainedOpening("Itself is not the problem.")).toBe(true);
  });

  it("accepts self-contained openings", () => {
    expect(isSelfContainedOpening("Virtue is the only true good.")).toBe(true);
  });

  it("ignores leading whitespace", () => {
    expect(isSelfContainedOpening("   But it was too late.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// sentences / firstSentence
// ---------------------------------------------------------------------------

describe("sentences", () => {
  it("splits on sentence-ending punctuation", () => {
    expect(sentences("One. Two! Three?")).toEqual(["One.", "Two!", "Three?"]);
  });

  it("returns the whole trimmed text when there is no terminator", () => {
    expect(sentences("no terminator here")).toEqual(["no terminator here"]);
  });

  it("returns an empty array for empty text", () => {
    expect(sentences("")).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Quote-aware splitting (T02 defect fix). A naive split on `.!?` breaks
  // inside quoted speech and emits garbage: unbalanced quotes, and
  // orphaned leading `"` characters stolen from the previous sentence's
  // closing quote. These regression tests are drawn directly from real
  // corpus failures.
  // -------------------------------------------------------------------

  it("does not split on a terminator that is inside an unclosed quote", () => {
    // The whole quotation is one continuous span with no closing quote
    // until the very end — internal periods must not fragment it.
    const text =
      'Epictetus said, "We\'ll discuss this properly when we have time. But I\'ll tell you this much: anyone who tries to take on such a huge responsibility without God\'s calling is disgusting to God. They\'ll end up doing nothing but making a fool of themselves in public."';
    const result = sentences(text);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(text);
    expect((result[0].match(/"/g) ?? []).length % 2).toBe(0);
  });

  it("attaches a closing quote to the sentence it closes, not the next sentence", () => {
    const text = 'Call the people who do this for small rewards "little slaves." Call the people who do it for big rewards "great slaves" — because that\'s what they deserve to be called.';
    const result = sentences(text);
    expect(result[0]).toBe('Call the people who do this for small rewards "little slaves."');
    expect(result[1].startsWith('"')).toBe(false);
    for (const s of result) {
      expect((s.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });

  it("does not leave an orphaned leading quote when a quoted question ends a sentence", () => {
    const text =
      '"But why did he bring me into the world under these conditions?" If you don\'t like the conditions, leave.';
    const result = sentences(text);
    expect(result).toEqual([
      '"But why did he bring me into the world under these conditions?"',
      "If you don't like the conditions, leave.",
    ]);
  });

  it("attaches a mid-paragraph closing quote so the next sentence has no leading quote", () => {
    const text = 'Why do you want to squeeze the world? "But I want my children and wife with me."';
    const result = sentences(text);
    expect(result).toEqual([
      "Why do you want to squeeze the world?",
      '"But I want my children and wife with me."',
    ]);
    expect(result[1].startsWith(" \"")).toBe(false);
  });
});

describe("firstSentence", () => {
  it("returns just the first sentence", () => {
    expect(firstSentence("One thing. Another thing.")).toBe("One thing.");
  });

  it("returns the whole text when there is no terminator", () => {
    expect(firstSentence("no terminator here")).toBe("no terminator here");
  });
});

// ---------------------------------------------------------------------------
// hasQuotedSpeech
// ---------------------------------------------------------------------------

describe("hasQuotedSpeech", () => {
  it("is false with zero quote characters", () => {
    expect(hasQuotedSpeech("No quotes here.")).toBe(false);
  });

  it("is false with a single quote character", () => {
    expect(hasQuotedSpeech('Only one " here.')).toBe(false);
  });

  it("is true with two or more quote characters", () => {
    expect(hasQuotedSpeech('He said, "hello there."')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// lengthDelta
// ---------------------------------------------------------------------------

describe("lengthDelta", () => {
  it("subtracts plain word count from original word count", () => {
    const card = makeCard({
      original_excerpt: "one two three four five",
      plain_english: "one two",
    });
    expect(lengthDelta(card)).toBe(3);
  });

  it("can be negative when the plain version is longer", () => {
    const card = makeCard({
      original_excerpt: "one two",
      plain_english: "one two three four",
    });
    expect(lengthDelta(card)).toBe(-2);
  });
});

// ---------------------------------------------------------------------------
// byBook
// ---------------------------------------------------------------------------

describe("byBook", () => {
  it("filters cards to the given book slugs", () => {
    const cards = [
      makeCard({ id: "a", book_slug: "meditations" }),
      makeCard({ id: "b", book_slug: "enchiridion" }),
      makeCard({ id: "c", book_slug: "on-anger" }),
    ];
    const result = byBook(cards, ["meditations", "on-anger"]);
    expect(result.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("returns an empty array when no slugs match", () => {
    const cards = [makeCard({ id: "a", book_slug: "meditations" })];
    expect(byBook(cards, ["discourses"])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// mechanicalGates — corpus-level counts
// ---------------------------------------------------------------------------

describe("mechanicalGates against the real corpus", () => {
  const cards = loadCorpus();

  it("loads the full 1,615-card corpus", () => {
    expect(cards.length).toBe(1615);
  });

  const gates = mechanicalGates(cards);

  it("wallLength (original_excerpt >= 80 words) measures 1,326", () => {
    expect(gates.wallLength.count).toBe(1326);
  });

  it("still12Word (first sentence <=12 words + self-contained opener) measures 731", () => {
    // The plan's acceptance line states 674 for this gate; that figure was
    // not reproducible under any tried definition. The plan's own fallback
    // estimate for the "clean definition" was 740; this implementation
    // originally measured 739 — one off from that estimate.
    //
    // T02's defect fix made `sentences()` (shared with `firstSentence()`,
    // which this gate depends on) quote-aware: a terminator inside an
    // unclosed quote no longer splits the sentence, and a closing `"` right
    // after a terminator stays attached to the sentence it closes instead
    // of leaking into the next one. That correction changes `firstSentence`
    // for any card whose opening sentence contains quoted speech, which
    // moves this count from 739 to 731. This is an expected, measured
    // consequence of fixing a shared function, not a new estimate to hit.
    expect(gates.still12Word.count).toBe(731);
  });

  it("quotedSpeech (plain_english has >=2 double quotes) measures 308", () => {
    expect(gates.quotedSpeech.count).toBe(308);
  });

  it("lengthDelta30 (original minus plain word count >= 30) measures 318", () => {
    expect(gates.lengthDelta30.count).toBe(318);
  });
});

// ---------------------------------------------------------------------------
// T02: landing-line gate for The Wall
// ---------------------------------------------------------------------------

describe("hasUnresolvedReference", () => {
  it("rejects leading pronouns and demonstratives", () => {
    expect(hasUnresolvedReference("He was wrong about that.")).toBe(true);
    expect(hasUnresolvedReference("Those who suffer learn.")).toBe(true);
    expect(hasUnresolvedReference("Which is why virtue matters.")).toBe(true);
  });

  it("accepts sentences that open with a named subject", () => {
    expect(hasUnresolvedReference("Virtue is the only true good.")).toBe(false);
  });

  // -------------------------------------------------------------------
  // Defect 2 fix: a reference word anywhere in the sentence, not just the
  // leading word, must be checked.
  // -------------------------------------------------------------------

  it("rejects a pronoun sitting mid-sentence with no antecedent (real corpus failure)", () => {
    // on-anger-03-097: "it" has nothing to point back to once this line is
    // the only text on screen. "Husbands"/"wives" don't rescue it — they're
    // ordinary sentence-initial/lowercase nouns, not a plausible antecedent.
    expect(hasUnresolvedReference("Husbands and wives fight about it all night.")).toBe(true);
  });

  it("rejects a mid-sentence demonstrative used as a pronoun, not a determiner", () => {
    expect(hasUnresolvedReference("We should always give it time, because of that.")).toBe(true);
  });

  it("allows a pronoun with a plausible proper-noun antecedent earlier in the same line", () => {
    // "Marcus" is deliberately NOT the first word here — ordinary
    // sentence-initial capitalization isn't proper-noun evidence (see the
    // next test), so the antecedent has to appear later to count.
    expect(hasUnresolvedReference("Even Marcus feared shame, but he pressed on anyway.")).toBe(false);
  });

  it("does not credit ordinary sentence-initial capitalization as a proper-noun antecedent", () => {
    // "Kings" is only capitalized because it starts the sentence, not
    // because it's a proper noun — must not excuse "their".
    expect(hasUnresolvedReference("Kings go mad with greed and squander their fortune.")).toBe(true);
  });

  // -------------------------------------------------------------------
  // T02 round 2, rule 1: the demonstrative-determiner exception is gone.
  // "this"/"that"/"these"/"those" always point BACKWARD out of the frame,
  // even when immediately followed by the noun they modify — the noun
  // being on screen does not supply the referent for a determiner that's
  // picking out "that [particular] one" from something outside the line.
  // The only surviving exception is `that` used non-referentially as a
  // subordinating conjunction (see the next describe block).
  // -------------------------------------------------------------------

  it("rejects a demonstrative used as a determiner, even immediately before its noun", () => {
    // Previously allowed by the now-removed determiner exception.
    expect(hasUnresolvedReference("That man walked away in silence.")).toBe(true);
    expect(hasUnresolvedReference("Those people never learn from their own mistakes.")).toBe(true);
  });

  it("rejects mid-sentence 'this' the same way as other demonstratives", () => {
    // "This" was previously missing from LANDING_LINE_REFERENCE_REJECTS
    // entirely (only checked as a leading word, via
    // SELF_CONTAINED_OPENING_REJECTS) — a mid-sentence "this" was never
    // checked at all. That gap is what let every real example below pass.
    expect(hasUnresolvedReference("I trust this completely.")).toBe(true);
  });

  // -------------------------------------------------------------------
  // Real corpus leaks from the T02 round-2 audit: all six previously
  // passed under the old determiner exception (or, for "this", because it
  // was missing from REFERENCE_WORDS entirely) and must now be rejected.
  // -------------------------------------------------------------------

  it.each([
    ["discourses-47-002", "Socrates was the first to practice this."],
    ["discourses-57-006", "We look for these same marks on coins."],
    ["discourses-47-005", "Think through all of this first."],
    ["discourses-57-007", "I'll consider this person a citizen."],
    ["discourses-49-004", "First, you must clean up your mind and this way of life."],
    [
      "discourses-13-006",
      "The truth is, if we think Good comes from these external things, all this confusion follows.",
    ],
  ])("rejects the %s leak: %s", (_id, text) => {
    expect(hasUnresolvedReference(text)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T02 round 2, rule 1's narrow exception: `that` as a non-referential
// subordinating conjunction ("the truth is that...") or, per the corpus
// audit, ONLY that — not a relative-clause reading ("the man that spoke"),
// which a bare word-shape heuristic can't distinguish from a determiner
// leak ("Don't let that excellent part become enslaved.") and so was
// dropped in favor of "when in doubt, REJECT".
// ---------------------------------------------------------------------------

describe("hasUnresolvedReference — non-referential 'that'", () => {
  it("allows 'that' immediately after a verb from the curated list", () => {
    expect(hasUnresolvedReference("The truth is that virtue is enough.")).toBe(false);
    expect(hasUnresolvedReference("I know that you tried your best.")).toBe(false);
  });

  it("documents a known residual gap: a determiner 'that' after a listed verb still passes", () => {
    // "knows" is on the non-referential-verb list, but "that old saying"
    // is actually a determiner pointing at something off screen, not a
    // subordinating conjunction. A bare "word before 'that'" heuristic
    // can't tell these apart without real parsing — this test documents
    // the known, accepted residual limitation (see premises.ts for the
    // rationale), not an aspiration.
    expect(hasUnresolvedReference("Everyone knows that old saying.")).toBe(false);
  });

  it("rejects sentence-initial 'that' regardless of what follows", () => {
    expect(hasUnresolvedReference("That's not up to me either.")).toBe(true);
  });
});

describe("findLandingLines", () => {
  it("finds a clean final sentence", () => {
    const card = makeCard({
      plain_english:
        "This is a setup sentence that leads in. Virtue alone makes a life worth living.",
    });
    expect(findLandingLines(card)).toEqual(["Virtue alone makes a life worth living."]);
  });

  it("rejects sentences starting with But/This and other continuation openers", () => {
    const card = makeCard({
      plain_english: "But that is not the whole truth. This changes everything we thought.",
    });
    expect(findLandingLines(card)).toEqual([]);
  });

  it("rejects sentences outside the word-count bounds", () => {
    const card = makeCard({
      plain_english:
        "Stay calm. Virtue alone is the single measure by which every reasonable person should judge whether a life, however long or eventful, was actually worth living in the end.",
    });
    expect(findLandingLines(card)).toEqual([]);
  });

  it("rejects a question-only payoff", () => {
    const card = makeCard({
      plain_english: "What good is wealth if the soul is corrupt?",
    });
    expect(findLandingLines(card)).toEqual([]);
  });

  // -------------------------------------------------------------------
  // Defect 1 regression tests — four real corpus cards that previously
  // produced broken (unbalanced-quote or orphan-leading-quote) landing
  // lines. Every emitted sentence must now be well-formed: balanced
  // quotes, no leading stray `"`. Where the corrected sentence still
  // isn't landing-line material (too long, ends mid-quote, starts with
  // `"`), the assertion is that it's cleanly rejected instead of emitted
  // as garbage.
  // -------------------------------------------------------------------

  it("discourses-49-001: a multi-sentence quote is not split into broken fragments", () => {
    const card = makeCard({
      plain_english:
        'A student asked Epictetus about becoming a Cynic philosopher — what kind of person should a Cynic be and what the role really means. The student seemed drawn to that way of life. Epictetus said, "We\'ll discuss this properly when we have time. But I\'ll tell you this much: anyone who tries to take on such a huge responsibility without God\'s calling is disgusting to God. They\'ll end up doing nothing but making a fool of themselves in public."',
    });
    const lines = findLandingLines(card);
    for (const line of lines) {
      expect(line.startsWith('"')).toBe(false);
      expect((line.match(/"/g) ?? []).length % 2).toBe(0);
    }
    // The giant merged quotation is never a candidate: it's ~35 words,
    // well past LANDING_LINE_MAX_WORDS. The one remaining unquoted
    // sentence — "The student seemed drawn to that way of life." — no
    // longer qualifies either: under the T02-round-2 rule 1 fix, "that" as
    // a determiner ("that way of life") is rejected wherever it appears,
    // even immediately before the noun it modifies. Nothing in this card
    // qualifies as a landing line.
    expect(lines).toEqual([]);
  });

  it('discourses-53-002: "little slaves." no longer emits an unbalanced-quote fragment', () => {
    const card = makeCard({
      plain_english:
        'Call the people who do this for small rewards "little slaves." Call the people who do it for big rewards "great slaves" — because that\'s what they deserve to be called.',
    });
    // Both sentences now split cleanly with balanced quotes, but both are
    // still rejected: the first ends in a closing quote (not `.`/`!` after
    // trim), and both contain "who"/"they" with no in-line antecedent.
    expect(findLandingLines(card)).toEqual([]);
  });

  it('discourses-53-010: a quoted objection no longer starts with an orphan quote', () => {
    const card = makeCard({
      plain_english:
        'Why can\'t you get enough? Why aren\'t you satisfied? Why do you want to squeeze the world? "But I want my children and wife with me."',
    });
    const lines = findLandingLines(card);
    for (const line of lines) {
      expect(line.startsWith('"')).toBe(false);
    }
    // The quoted objection itself is well-formed but correctly excluded —
    // it starts with `"` (no on-screen attribution) and ends in a closing
    // quote, not a bare `.`/`!`.
    expect(lines.some((l) => l.startsWith('"But I want'))).toBe(false);
  });

  it("discourses-53-011: the sentence after a quoted question has no leading orphan quote", () => {
    const card = makeCard({
      plain_english:
        'Why won\'t you step aside for the one who is greater than you? "But why did he bring me into the world under these conditions?" If you don\'t like the conditions, leave.',
    });
    const lines = findLandingLines(card);
    expect(lines).toContain("If you don't like the conditions, leave.");
    for (const line of lines) {
      expect(line.startsWith('"')).toBe(false);
      expect((line.match(/"/g) ?? []).length % 2).toBe(0);
    }
  });
});

describe("selectLandingLine", () => {
  it("prefers the last qualifying sentence", () => {
    const card = makeCard({
      plain_english: "Fear controls the weak mind. Virtue alone sets a person truly free.",
    });
    expect(selectLandingLine(card)).toBe("Virtue alone sets a person truly free.");
  });

  it("returns null when nothing qualifies", () => {
    const card = makeCard({
      plain_english: "But this is only a fragment",
    });
    expect(selectLandingLine(card)).toBeNull();
  });
});

describe("verbatim", () => {
  it("is true when the line is an exact substring of the source", () => {
    expect(verbatim("Virtue alone is enough.", "Stay calm. Virtue alone is enough.")).toBe(true);
  });

  it("is false when the line is not present verbatim", () => {
    expect(verbatim("Virtue is enough alone.", "Stay calm. Virtue alone is enough.")).toBe(false);
  });
});

describe("wallGate against the real corpus", () => {
  const entries = wallGate(loadCorpus());

  it("emits only entries with a >=80-word original", () => {
    for (const entry of entries) {
      expect(entry.original_word_count).toBeGreaterThanOrEqual(80);
    }
  });

  it("emits only entries with a non-empty landing line", () => {
    for (const entry of entries) {
      expect(entry.landing_line.length).toBeGreaterThan(0);
    }
  });

  it("every landing line appears verbatim in its source card's plain_english", () => {
    const cardsById = new Map(loadCorpus().map((c) => [c.id, c]));
    for (const entry of entries) {
      const card = cardsById.get(entry.card_id);
      expect(card).toBeDefined();
      expect(verbatim(entry.landing_line, card!.plain_english)).toBe(true);
    }
  });

  it("survivor count is <= 1326 (the wallLength gate)", () => {
    expect(entries.length).toBeLessThanOrEqual(1326);
  });

  it("measures the exact survivor count", () => {
    // Measured figure, not predicted by the plan. T02's original
    // implementation measured 1,286, but it only tested syntactic shape
    // (word count, leading opener/reference word), never whether the line
    // actually stands alone. Two mechanical defects inflated that number:
    // (1) the sentence splitter broke inside quoted spans, emitting
    // fragments with unbalanced quotes or orphaned leading `"` characters
    // that were never checked for; (2) unresolved pronoun/demonstrative
    // references were only checked at the START of the line, so lines like
    // "Husbands and wives fight about it all night." passed with "it"
    // dangling mid-sentence. Fixing both — a quote-aware `sentences()`,
    // and `hasUnresolvedReference` checking the whole line, not just the
    // leading word — measured 1,138.
    //
    // A T02 round-2 audit found 230 of those 1,138 still carried an
    // unresolved reference, leaking through two remaining gaps:
    // (1) the demonstrative-as-determiner exception let "this person",
    // "these external things", "that way of life" etc. through even
    // though the noun being on screen doesn't supply what the
    // demonstrative is pointing at; "this" itself was also missing from
    // the reference-word list entirely, so a mid-sentence "this" was never
    // checked at all. (2) the third-person-pronoun antecedent lookback
    // accepted ANY earlier capitalized word regardless of number
    // agreement. Dropping the determiner exception (keeping only a narrow
    // "that"-as-subordinating-conjunction carve-out) and requiring number
    // agreement for personal-pronoun antecedents measures 1,003. If
    // pipeline content or the landing-line rules change, re-run and update
    // this assertion deliberately.
    expect(entries.length).toBe(1003);
  });

  // -------------------------------------------------------------------
  // Defect 1 regression, corpus-wide: no survivor's landing line may
  // contain an odd number of `"` characters (a broken, mid-quote
  // fragment), and none may begin with `"` or whitespace (an orphaned
  // leading quote, or unexpected leading/trailing whitespace).
  // -------------------------------------------------------------------

  it("no landing line has an unbalanced quote count, and none starts with a stray quote or whitespace", () => {
    for (const entry of entries) {
      const quoteCount = (entry.landing_line.match(/"/g) ?? []).length;
      expect(quoteCount % 2).toBe(0);
      expect(entry.landing_line).not.toMatch(/^\s/);
      expect(entry.landing_line.startsWith('"')).toBe(false);
    }
  });

  // -------------------------------------------------------------------
  // T02 round 2, rule 1 regression, corpus-wide: no surviving landing line
  // may contain a standalone this/these/those token — the demonstrative-
  // determiner exception that used to let these through is gone. ("that"
  // is checked separately in the next test, since it has a narrow
  // permitted non-referential use.)
  // -------------------------------------------------------------------

  it("no landing line contains a standalone this/these/those token", () => {
    for (const entry of entries) {
      expect(entry.landing_line).not.toMatch(/\b(this|these|those)\b/i);
    }
  });
});

// ---------------------------------------------------------------------------
// T03: visual-archaism ranking — classifyWallSubTypes
// ---------------------------------------------------------------------------

describe("classifyWallSubTypes", () => {
  it("does not match thou_wall with exactly one below-threshold archaic marker count", () => {
    // "thou", "hath" — 2 marker occurrences, one short of the threshold.
    const card = makeCard({ original_excerpt: "Thou hath spoken truly of the matter at hand." });
    const result = classifyWallSubTypes(card);
    expect(result.archaic_marker_count).toBe(2);
    expect(WALL_THOU_MARKER_MIN).toBe(3);
    expect(result.sub_types).not.toContain("thou_wall");
  });

  it("matches thou_wall at exactly the threshold count", () => {
    // "thou", "hath", "thy" — exactly 3 marker occurrences.
    const card = makeCard({ original_excerpt: "Thou hath spoken, and thy word is true." });
    const result = classifyWallSubTypes(card);
    expect(result.archaic_marker_count).toBe(3);
    expect(result.sub_types).toContain("thou_wall");
  });

  it("counts repeated occurrences of the same marker, not distinct markers", () => {
    // "thou" appears 3 times — no distinct markers beyond "thou" itself,
    // but the occurrence count still clears the threshold.
    const card = makeCard({ original_excerpt: "Thou art thou, and thou shalt remain thou." });
    const result = classifyWallSubTypes(card);
    expect(result.archaic_marker_count).toBeGreaterThanOrEqual(3);
    expect(result.sub_types).toContain("thou_wall");
  });

  it("does not match cascade with exactly one below-threshold semicolon count", () => {
    const card = makeCard({ original_excerpt: "One; two; three of these matters remain unresolved." });
    const result = classifyWallSubTypes(card);
    expect(result.semicolon_count).toBe(2);
    expect(WALL_CASCADE_SEMICOLON_MIN).toBe(3);
    expect(result.sub_types).not.toContain("cascade");
  });

  it("matches cascade at exactly the threshold count", () => {
    const card = makeCard({ original_excerpt: "One; two; three; four of these matters remain unresolved." });
    const result = classifyWallSubTypes(card);
    expect(result.semicolon_count).toBe(3);
    expect(result.sub_types).toContain("cascade");
  });

  it("does not match scene with exactly one below-threshold quote character", () => {
    const card = makeCard({ original_excerpt: 'He said, "hello there to everyone gathered.' });
    const result = classifyWallSubTypes(card);
    expect(result.quote_count).toBe(1);
    expect(WALL_SCENE_QUOTE_MIN).toBe(2);
    expect(result.sub_types).not.toContain("scene");
  });

  it("matches scene at exactly the threshold count", () => {
    const card = makeCard({ original_excerpt: 'He said, "hello there to everyone gathered."' });
    const result = classifyWallSubTypes(card);
    expect(result.quote_count).toBe(2);
    expect(result.sub_types).toContain("scene");
  });

  it("marks reserve true when no sub-type matches", () => {
    const card = makeCard({ original_excerpt: "This is an ordinary modern sentence with nothing unusual in it." });
    const result = classifyWallSubTypes(card);
    expect(result.sub_types).toEqual([]);
    expect(result.reserve).toBe(true);
  });

  it("marks reserve false and reports multiple sub-types when more than one matches (non-exclusive)", () => {
    const card = makeCard({
      original_excerpt: 'Thou hath spoken, and thy word is true; yet one; two; three remain: "so be it."',
    });
    const result = classifyWallSubTypes(card);
    expect(result.sub_types).toContain("thou_wall");
    expect(result.sub_types).toContain("cascade");
    expect(result.reserve).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T03: opening eligibility
// ---------------------------------------------------------------------------

describe("eligibleWallOpenings", () => {
  it("always includes standard", () => {
    const card = makeCard({ original_excerpt: "A short original excerpt.", plain_english: "A short plain line." });
    expect(eligibleWallOpenings(card)).toContain("standard");
  });

  it("excludes countdown when lengthDelta is one below the threshold", () => {
    const original = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    const plain = Array.from({ length: 1 }, (_, i) => `word${i}`).join(" ");
    const card = makeCard({ original_excerpt: original, plain_english: plain });
    expect(lengthDelta(card)).toBe(WALL_COUNTDOWN_DELTA_MIN - 1);
    expect(eligibleWallOpenings(card)).not.toContain("countdown");
  });

  it("includes countdown when lengthDelta is exactly at the threshold", () => {
    const original = Array.from({ length: 31 }, (_, i) => `word${i}`).join(" ");
    const plain = Array.from({ length: 1 }, (_, i) => `word${i}`).join(" ");
    const card = makeCard({ original_excerpt: original, plain_english: plain });
    expect(lengthDelta(card)).toBe(WALL_COUNTDOWN_DELTA_MIN);
    expect(eligibleWallOpenings(card)).toContain("countdown");
  });

  it("excludes grade when the original's reading grade is below the threshold", () => {
    const card = makeCard({ original_excerpt: "The cat sat. The dog ran. Sam ate cake." });
    expect(originalReadingGrade(card)).toBeLessThan(WALL_ORIGINAL_GRADE_MIN);
    expect(eligibleWallOpenings(card)).not.toContain("grade");
  });

  it("includes grade when the original's reading grade clears the threshold", () => {
    const card = makeCard({
      original_excerpt:
        "Notwithstanding the aforementioned circumstances, the substantiality of metaphysical apprehension necessitates an exceedingly convoluted philosophical elucidation typically eschewed by unsophisticated interlocutors.",
    });
    expect(originalReadingGrade(card)).toBeGreaterThanOrEqual(WALL_ORIGINAL_GRADE_MIN);
    expect(eligibleWallOpenings(card)).toContain("grade");
  });

  it("can qualify for both conditional openings at once", () => {
    const original =
      "Notwithstanding the aforementioned circumstances, the substantiality of metaphysical apprehension necessitates an exceedingly convoluted philosophical elucidation typically eschewed by unsophisticated interlocutors, whose brevity the plain rendering below entirely lacks, and whose ponderous, multiply-subordinated syntax further exemplifies the very obscurity under discussion.";
    const card = makeCard({ original_excerpt: original, plain_english: "Keep it simple." });
    expect(lengthDelta(card)).toBeGreaterThanOrEqual(WALL_COUNTDOWN_DELTA_MIN);
    expect(originalReadingGrade(card)).toBeGreaterThanOrEqual(WALL_ORIGINAL_GRADE_MIN);
    const openings = eligibleWallOpenings(card);
    expect(openings).toContain("countdown");
    expect(openings).toContain("grade");
    expect(openings).toContain("standard");
  });
});

// ---------------------------------------------------------------------------
// T03: corpus-level counts — classifyWallSubTypes and rankWall
// ---------------------------------------------------------------------------

describe("classifyWallSubTypes against the real corpus", () => {
  const cards = loadCorpus();
  const gated = cards.filter((c) => wordCount(c.original_excerpt) >= 80);

  it("gates to the 1,326-card wallLength set", () => {
    expect(gated.length).toBe(1326);
  });

  it("measures Thou Wall (>=3 archaic marker occurrences) at exactly 222", () => {
    const count = gated.filter((c) => classifyWallSubTypes(c).sub_types.includes("thou_wall")).length;
    expect(count).toBe(222);
  });

  it("measures Cascade (>=3 semicolons) at exactly 204", () => {
    const count = gated.filter((c) => classifyWallSubTypes(c).sub_types.includes("cascade")).length;
    expect(count).toBe(204);
  });

  it("measures Scene (>=2 double-quote characters) at exactly 137", () => {
    // The plan's own estimate for this sub-type was 176; that figure did
    // not reproduce under any quote-character definition tried (see the
    // in-file comment on classifyWallSubTypes). 137 is the measured count
    // for the definition actually implemented and is what's asserted here.
    const count = gated.filter((c) => classifyWallSubTypes(c).sub_types.includes("scene")).length;
    expect(count).toBe(137);
  });

  it("measures reserve (no sub-type matches) at 813, the complement of the 513-card union", () => {
    const results = gated.map((c) => classifyWallSubTypes(c));
    const unionCount = results.filter((r) => !r.reserve).length;
    const reserveCount = results.filter((r) => r.reserve).length;
    expect(unionCount).toBe(513);
    expect(reserveCount).toBe(813);
    expect(unionCount + reserveCount).toBe(gated.length);
  });
});

describe("rankWall against the real corpus", () => {
  const entries = rankWall(loadCorpus());

  it("ranks exactly the wallGate survivor set", () => {
    expect(entries.length).toBe(wallGate(loadCorpus()).length);
  });

  it("every entry carries a non-empty eligible_openings that always includes standard", () => {
    for (const entry of entries) {
      expect(entry.eligible_openings.length).toBeGreaterThan(0);
      expect(entry.eligible_openings).toContain("standard");
    }
  });

  it("every entry's reserve flag matches whether it has any sub-type", () => {
    for (const entry of entries) {
      expect(entry.reserve).toBe(entry.sub_types.length === 0);
    }
  });

  it("reports the ranked-pool sub-type and opening-eligibility counts (measured, informational)", () => {
    const thou = entries.filter((e) => e.sub_types.includes("thou_wall")).length;
    const cascade = entries.filter((e) => e.sub_types.includes("cascade")).length;
    const scene = entries.filter((e) => e.sub_types.includes("scene")).length;
    const reserve = entries.filter((e) => e.reserve).length;
    const countdown = entries.filter((e) => e.eligible_openings.includes("countdown")).length;
    const grade = entries.filter((e) => e.eligible_openings.includes("grade")).length;

    // These are measured, reported counts within the smaller 1,003-entry
    // ranked pool (T02 survivors) — necessarily <= the 1,326-card
    // classifier counts above, since not every length-gated card also has
    // a qualifying landing line.
    expect(thou).toBe(171);
    expect(cascade).toBe(174);
    expect(scene).toBe(96);
    expect(reserve).toBe(608);
    expect(countdown).toBe(248);
    expect(grade).toBe(631);
  });
});

// ---------------------------------------------------------------------------
// T04: The Question — mechanical gate helpers
// ---------------------------------------------------------------------------

describe("isExclamationShaped", () => {
  it("rejects a question ending in stacked ?! punctuation", () => {
    expect(isExclamationShaped("Isn't that wonderful?!")).toBe(true);
  });

  it("rejects a 'What a'/'What an' opener", () => {
    expect(isExclamationShaped("What a strange thing to say?")).toBe(true);
    expect(isExclamationShaped("What an odd way to live?")).toBe(true);
  });

  it("rejects a 'How <adjective>' rhetorical exclamation", () => {
    expect(isExclamationShaped("How wonderful is that?")).toBe(true);
  });

  it("accepts a genuine 'How <auxiliary>' question", () => {
    expect(isExclamationShaped("How do you know that?")).toBe(false);
  });

  it("accepts an ordinary question with a single trailing ?", () => {
    expect(isExclamationShaped("What should you do next?")).toBe(false);
  });
});

describe("hasAttributionLeak", () => {
  it("flags a pronoun subject directly before an attribution verb", () => {
    expect(hasAttributionLeak("He asks why virtue matters.")).toBe(true);
    expect(hasAttributionLeak("Someone says this is easy.")).toBe(true);
  });

  it("flags 'you ask' specifically", () => {
    expect(hasAttributionLeak("Then you ask what comes next.")).toBe(true);
  });

  it("does not flag ordinary 'you say'/'you should say' second-person address", () => {
    // Measured against the real corpus: treating bare "you" the same as
    // "he"/"someone" produced false positives on the author's own direct
    // address to the viewer — see discourses-44-003 in the corpus test
    // below.
    expect(hasAttributionLeak("What should you say when something painful happens")).toBe(false);
  });

  it("flags a genuine proper-noun subject before an attribution verb", () => {
    expect(hasAttributionLeak("But Epictetus said it plainly.")).toBe(true);
  });

  it("does not flag a sentence-initial wh-word before a speech verb", () => {
    // "Who says X" is a rhetorical device ("nobody would say X"), not a
    // report of what a third party said — measured against the real corpus
    // (happy-life-24-003).
    expect(hasAttributionLeak("Who says generosity is only for citizens who wear togas?")).toBe(false);
  });

  it("does not flag an ordinary sentence with no attribution verb", () => {
    expect(hasAttributionLeak("The quality of your thoughts shapes your life.")).toBe(false);
  });

  it("flags a first-person speech verb ('I ask') — meditations-04-022", () => {
    // Real corpus leak: the mechanical gate previously accepted this
    // question because ATTRIBUTION_PRONOUN_SUBJECTS only covered third-party
    // subjects (he/she/they/someone/people), never "I".
    expect(hasAttributionLeak("I ask back: how does the earth keep holding all the buried bodies forever?")).toBe(
      true,
    );
  });

  it("flags a speech-attribution lead-in before a colon even without adjacent I+verb", () => {
    expect(hasColonAttributionLeadIn("Epictetus asks something else: what should you do?")).toBe(true);
  });

  it("does not flag a colon with no speech attribution before it", () => {
    expect(hasColonAttributionLeadIn("For example: what should you do next?")).toBe(false);
  });

  it("does not flag an ordinary first-person statement with 'I' that isn't a speech verb", () => {
    expect(hasAttributionLeak("I know that virtue is the only true good.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T04: The Question — mechanical gate, measured corpus counts
// ---------------------------------------------------------------------------

describe("findQuestionCandidate against the real corpus", () => {
  const cards = loadCorpus();
  const candidates = cards.map((c) => findQuestionCandidate(c)).filter((c): c is NonNullable<typeof c> => c !== null);

  it("measures the mechanical gate at exactly 306", () => {
    // Measured stage-by-stage (all applied to the first QUESTION_SENTENCE_WINDOW
    // sentences of plain_english, as an existence check over the candidate
    // set rather than a single fixed candidate carried through each stage):
    //   question present                        458
    //   + <=14 words                             380
    //   + unquoted                               379
    //   + self-contained opening (T01)           319
    //   + not exclamation-shaped, no attribution  313
    //     leak (author's own voice)
    // The plan's target for this gate was 292. 313 was the first-pass measured
    // count, before a fix-pass audit surfaced four real leaks the deterministic
    // checks were missing (a first-person/colon-lead-in attribution gap in
    // `hasAttributionLeak`, cataphoric "pivot" non-answers, third-party/literary
    // reference questions, and unbalanced quote characters — see the
    // `hasAttributionLeak`/`hasThirdPartyReference`/`isPivotAnswer`/
    // `hasUnbalancedQuotes` tests above and below). `hasAttributionLeak`'s
    // first-person/colon fix is applied here too (it's part of the mechanical
    // gate's own "no attribution leak" check), dropping this stage from 313 to
    // **306**. 306 is what's measured and asserted here — not contorted to hit
    // any estimate, matching the policy T01/T03 documented for their own
    // unreproducible targets.
    expect(candidates.length).toBe(306);
  });

  it("every candidate question ends with '?', is within the word limit, and is unquoted", () => {
    for (const { question } of candidates) {
      expect(question.trim().endsWith("?")).toBe(true);
      expect(wordCount(question)).toBeLessThanOrEqual(QUESTION_MAX_WORDS);
      expect(question).not.toContain('"');
    }
  });

  it("every candidate index falls within the sentence window", () => {
    for (const { index } of candidates) {
      expect(index).toBeLessThan(QUESTION_SENTENCE_WINDOW);
    }
  });
});

describe("questionCandidateAnswer", () => {
  it("returns the sentence immediately following the question", () => {
    const card = makeCard({
      plain_english: "Is this the right path? It is not. Keep walking anyway.",
    });
    const candidate = findQuestionCandidate(card);
    expect(candidate).not.toBeNull();
    expect(questionCandidateAnswer(card, candidate!.index)).toBe("It is not.");
  });

  it("returns null when the question is the last sentence", () => {
    const card = makeCard({ plain_english: "A short line here. Is this the last one?" });
    const candidate = findQuestionCandidate(card);
    expect(candidate).not.toBeNull();
    expect(questionCandidateAnswer(card, candidate!.index)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// T04, layer (a): dangling references, mid-thought openers, fragments
// ---------------------------------------------------------------------------

describe("passesLayerA", () => {
  it("rejects a question with a dangling pronoun (no in-line antecedent)", () => {
    const question = "Why does he avoid it?";
    expect(hasUnresolvedReference(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });

  it.each(QUESTION_OPENING_REJECTS)("rejects a question opening with '%s'", (opener) => {
    const question = `${opener}, what should happen next?`;
    expect(hasMidThoughtOpener(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });

  it("rejects a fragment (no leading capital letter)", () => {
    const question = "did you really mean that?";
    expect(isFragmentQuestion(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });

  it("accepts a self-contained question with no dangling reference, opener, or fragment", () => {
    const question = "What should you do when things go wrong?";
    expect(passesLayerA(question)).toBe(true);
  });

  it("rejects a third-party/literary reference question — on-anger-02-092", () => {
    const question = "What did Priam do in the Iliad?";
    expect(hasThirdPartyReference(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });

  it("rejects a third-party/literary reference question — discourses-17-003", () => {
    const question = "How does Medea put it?";
    expect(hasThirdPartyReference(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });

  it("rejects a question with an unbalanced quote character", () => {
    const question = 'Why does love "always change?';
    expect(hasUnresolvedReference(question)).toBe(false);
    expect(hasUnbalancedQuotes(question)).toBe(true);
    expect(passesLayerA(question)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T04 fix pass: hasThirdPartyReference / isSecondPersonQuestion
// ---------------------------------------------------------------------------

describe("isSecondPersonQuestion", () => {
  it("is true for a question containing 'you'/'your'/'we'/'our'/'us'", () => {
    expect(isSecondPersonQuestion("What would you say to Epictetus?")).toBe(true);
    expect(isSecondPersonQuestion("Can we trust Marcus on this?")).toBe(true);
  });

  it("is false for a question with no second-person word", () => {
    expect(isSecondPersonQuestion("What did Priam do in the Iliad?")).toBe(false);
  });
});

describe("hasThirdPartyReference", () => {
  it("flags a question asked ABOUT a named third party — discourses-17-003", () => {
    expect(hasThirdPartyReference("How does Medea put it?")).toBe(true);
  });

  it("flags a question asked about a literary work — on-anger-02-092", () => {
    expect(hasThirdPartyReference("What did Priam do in the Iliad?")).toBe(true);
  });

  it("does not flag a second-person question that merely mentions a name — discourses-43-002", () => {
    // Real corpus counter-example: the viewer is still addressed directly
    // ("you"), so a proper noun elsewhere in the question doesn't break the
    // forced-self-prediction mechanic.
    expect(hasThirdPartyReference("Why did you want to be elected governor of the Cnossians?")).toBe(false);
  });

  it("does not flag a question with sentence-initial capitalization only", () => {
    expect(hasThirdPartyReference("Why does this keep happening?")).toBe(false);
  });

  it("does not flag a question mentioning God", () => {
    expect(hasThirdPartyReference("What does God have to do with any of this?")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T04, layer (b): Socratic-chain answers and attribution leaks
// ---------------------------------------------------------------------------

describe("passesLayerB", () => {
  it("rejects an answer that itself ends in '?' (the Socratic chain continuing)", () => {
    const answer = "Was your dislike of something?";
    expect(isSocraticChainAnswer(answer)).toBe(true);
    expect(passesLayerB(answer)).toBe(false);
  });

  it("rejects an answer with an attribution leak", () => {
    const answer = "He says it doesn't matter.";
    expect(hasAttributionLeak(answer)).toBe(true);
    expect(passesLayerB(answer)).toBe(false);
  });

  it("accepts a plain declarative answer", () => {
    const answer = "It was not, and never will be.";
    expect(passesLayerB(answer)).toBe(true);
  });

  it("rejects a cataphoric pivot answer — discourses-21-004", () => {
    const answer = "Think of it this way.";
    expect(isPivotAnswer(answer)).toBe(true);
    expect(passesLayerB(answer)).toBe(false);
  });

  it("rejects a pivot answer that resolves nothing — meditations-04-022", () => {
    const answer = "Here's how it works.";
    expect(isPivotAnswer(answer)).toBe(true);
    expect(passesLayerB(answer)).toBe(false);
  });

  it("rejects an answer with an unbalanced quote character — discourses-17-003", () => {
    const answer = "'I know the evil I'm about to do, but my anger is stronger than my better judgment.";
    expect(hasUnbalancedQuotes(answer)).toBe(true);
    expect(passesLayerB(answer)).toBe(false);
  });

  it("does not reject an answer that merely contains a pivot phrase mid-sentence", () => {
    const answer = "Consider this carefully before you decide what to do.";
    expect(isPivotAnswer(answer)).toBe(false);
    expect(passesLayerB(answer)).toBe(true);
  });

  it("does not reject an answer with ordinary contractions/possessives — discourses-17-007", () => {
    // Real corpus counter-example: contraction and possessive apostrophes
    // never open an unclosed quote span.
    const answer = "Don't think I'm saying that.";
    expect(hasUnbalancedQuotes(answer)).toBe(false);
    expect(passesLayerB(answer)).toBe(true);
  });

  it("rejects a known non-answer pair drawn from the real corpus (discourses-49-010)", () => {
    // plain_english: "...Was your desire in any danger? Was your dislike of
    // something? ..." — the "answer" is another question in the same
    // Socratic chain, not a resolution.
    const cards = loadCorpus();
    const card = cards.find((c) => c.id === "discourses-49-010");
    expect(card).toBeDefined();

    const candidate = findQuestionCandidate(card!);
    expect(candidate).not.toBeNull();
    expect(candidate!.question).toBe("Was your desire in any danger?");

    const answer = questionCandidateAnswer(card!, candidate!.index);
    expect(answer).toBe("Was your dislike of something?");
    expect(passesLayerB(answer!)).toBe(false);

    // And confirm the full gate agrees: this card does not survive.
    const survivorIds = questionGate(cards).map((e) => e.card_id);
    expect(survivorIds).not.toContain("discourses-49-010");
  });
});

// ---------------------------------------------------------------------------
// T04 fix pass: isPivotAnswer / hasUnbalancedQuotes / hasUnbalancedSingleQuote
// ---------------------------------------------------------------------------

describe("isPivotAnswer", () => {
  it.each(PIVOT_ANSWER_PHRASES)("flags '%s' as a whole-sentence answer, with trailing punctuation", (phrase) => {
    expect(isPivotAnswer(`${phrase}.`)).toBe(true);
    expect(isPivotAnswer(phrase)).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(isPivotAnswer("think of it this way.")).toBe(true);
  });

  it("does not flag a longer answer that merely contains a pivot phrase mid-sentence", () => {
    expect(isPivotAnswer("Consider this carefully before you decide what to do.")).toBe(false);
    expect(isPivotAnswer("Here's the thing about anger: it never helps.")).toBe(false);
  });

  it("does not flag an ordinary declarative answer", () => {
    expect(isPivotAnswer("It was not, and never will be.")).toBe(false);
  });
});

describe("hasUnbalancedSingleQuote", () => {
  it("flags an orphan opening quote never closed in the same text", () => {
    expect(hasUnbalancedSingleQuote("'I know the evil I'm about to do, but my anger is stronger.")).toBe(true);
  });

  it("does not flag a properly opened and closed quote", () => {
    expect(hasUnbalancedSingleQuote("'I love this,' he said.")).toBe(false);
  });

  it("does not flag ordinary contractions", () => {
    expect(hasUnbalancedSingleQuote("Don't think I'm saying that.")).toBe(false);
  });

  it("does not flag a possessive apostrophe — 'Epictetus' body'", () => {
    expect(hasUnbalancedSingleQuote("Epictetus' body was frail, but his will was not.")).toBe(false);
  });
});

describe("hasUnbalancedQuotes", () => {
  it("flags an odd count of double-quote characters", () => {
    expect(hasUnbalancedQuotes('She said, "this is enough.')).toBe(true);
  });

  it("flags an orphan opening single quote", () => {
    expect(hasUnbalancedQuotes("'I know the evil I'm about to do, but my anger is stronger.")).toBe(true);
  });

  it("does not flag balanced double quotes, contractions, or possessives", () => {
    expect(hasUnbalancedQuotes('She said, "this is enough."')).toBe(false);
    expect(hasUnbalancedQuotes("Don't think I'm saying that.")).toBe(false);
    expect(hasUnbalancedQuotes("Epictetus' body was frail, but his will was not.")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// T04: questionGate — full deterministic pipeline, measured corpus counts
// ---------------------------------------------------------------------------

describe("questionGate against the real corpus", () => {
  const cards = loadCorpus();
  const entries = questionGate(cards);

  it("measures the surviving pool at each stage: mechanical 306, after layer (a) 150, after layer (b) 89", () => {
    // Fix pass: `hasAttributionLeak` gained a first-person ("I ask")/
    // colon-lead-in check (mechanical + layer b), layer (a) gained
    // `hasThirdPartyReference` and `hasUnbalancedQuotes`, and layer (b) gained
    // `isPivotAnswer` and `hasUnbalancedQuotes`. Measured drop: mechanical
    // 313 -> 306, after layer (a) 162 -> 150, after layer (b) 100 -> 89. Not
    // tuned to hit a target — measured and asserted as-is.
    const mechanicalCount = cards.filter((c) => findQuestionCandidate(c) !== null).length;
    const afterACount = cards.filter((c) => {
      const candidate = findQuestionCandidate(c);
      return candidate !== null && passesLayerA(candidate.question);
    }).length;

    expect(mechanicalCount).toBe(306);
    expect(afterACount).toBe(150);
    expect(entries.length).toBe(89);
  });

  it("author mix of the 89 survivors: epictetus 50, marcus-aurelius 21, seneca 18", () => {
    const authorCounts: Record<string, number> = {};
    for (const entry of entries) {
      authorCounts[entry.author_slug] = (authorCounts[entry.author_slug] ?? 0) + 1;
    }
    expect(authorCounts).toEqual({ epictetus: 50, "marcus-aurelius": 21, seneca: 18 });
  });

  it("does not contain the four real leaks fixed by this pass", () => {
    const ids = entries.map((e) => e.card_id);
    expect(ids).not.toContain("meditations-04-022"); // "I ask back:" attribution leak
    expect(ids).not.toContain("discourses-21-004"); // "Think of it this way." pivot answer
    expect(ids).not.toContain("on-anger-02-092"); // "What did Priam do in the Iliad?"
    expect(ids).not.toContain("discourses-17-003"); // "How does Medea put it?" + unbalanced quote
  });

  it("every survivor's question and answer are verbatim substrings of plain_english", () => {
    const cardsById = new Map(cards.map((c) => [c.id, c]));
    for (const entry of entries) {
      const card = cardsById.get(entry.card_id)!;
      expect(card.plain_english).toContain(entry.question);
      expect(card.plain_english).toContain(entry.answer);
    }
  });

  it("no survivor's answer ends in '?', carries an attribution leak, is a pivot answer, or has unbalanced quotes", () => {
    for (const entry of entries) {
      expect(entry.answer.trim().endsWith("?")).toBe(false);
      expect(hasAttributionLeak(entry.answer)).toBe(false);
      expect(isPivotAnswer(entry.answer)).toBe(false);
      expect(hasUnbalancedQuotes(entry.answer)).toBe(false);
    }
  });

  it("no survivor's question has an unresolved reference, mid-thought opener, is a fragment, a third-party reference, or has unbalanced quotes", () => {
    for (const entry of entries) {
      expect(hasUnresolvedReference(entry.question)).toBe(false);
      expect(hasMidThoughtOpener(entry.question)).toBe(false);
      expect(isFragmentQuestion(entry.question)).toBe(false);
      expect(hasThirdPartyReference(entry.question)).toBe(false);
      expect(hasUnbalancedQuotes(entry.question)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// T04, layer (c) stub: buildQuestionDriftRequests
// ---------------------------------------------------------------------------

describe("buildQuestionDriftRequests", () => {
  it("shapes each survivor into a plain request object with no extra fields", () => {
    const entries = [
      { card_id: "meditations-05-016", book_slug: "meditations", author_slug: "marcus-aurelius" as const, question: "Is this the right path?", answer: "It is not." },
    ];
    const requests = buildQuestionDriftRequests(entries);
    expect(requests).toEqual([
      { card_id: "meditations-05-016", question: "Is this the right path?", answer: "It is not." },
    ]);
  });

  it("returns one request per survivor, in order", () => {
    const entries = questionGate(loadCorpus());
    const requests = buildQuestionDriftRequests(entries);
    expect(requests.length).toBe(entries.length);
    expect(requests.map((r) => r.card_id)).toEqual(entries.map((e) => e.card_id));
  });
});
