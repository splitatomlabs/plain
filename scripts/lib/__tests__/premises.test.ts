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
