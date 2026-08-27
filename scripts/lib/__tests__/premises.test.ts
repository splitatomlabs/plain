import { describe, it, expect } from "vitest";
import {
  loadCorpus,
  wordCount,
  isSelfContainedOpening,
  SELF_CONTAINED_OPENING_REJECTS,
  firstSentence,
  sentences,
  byBook,
  findLandingLines,
  selectLandingLine,
  wallGate,
  verbatim,
  hasUnresolvedReference,
  classifyWallSubTypes,
  originalReadingGrade,
  rankWall,
  WALL_THOU_MARKER_MIN,
  WALL_CASCADE_SEMICOLON_MIN,
  WALL_SCENE_QUOTE_MIN,
  authorMix,
  combinedAuthorMix,
  wallAuthorWeights,
  selectWallBalanced,
  createSeededRng,
  BALANCED_AUTHOR_SHARE,
  DEFAULT_QUESTION_FRACTION,
  type QuestionEntry,
  type ObjectionEntry,
} from "../premises.js";
import type { Card } from "../types.js";
import type { AuthorSlug } from "../constants.js";

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

/**
 * Pf39c2-social-pilot-02a D01: Question and Objection were deleted outright
 * (`questionGate`/`objectionGate` no longer exist) — but `wallAuthorWeights`
 * below still takes a Question pool (and, with a `readThrough` context, an
 * Objection pool) as an input to its author-balance correction, and that
 * correction only ever reads per-author COUNTS off these pools
 * (`authorMix`), never any entry's text or the pools' order. These synthetic
 * builders reproduce the exact author-count distributions the real,
 * now-deleted gates measured against this same corpus at the time these
 * tests were written — Question 50/21/18 (epictetus/marcus-aurelius/seneca,
 * 89 total — see the T05 section's own doc comment in ../premises.ts) and
 * Objection 24/32/3 (epictetus/seneca/marcus-aurelius, 59 total — the
 * "Objection ~59" figure named in ../premises-batch.ts) — verified by
 * reproducing every pinned decimal assertion below byte-for-byte before
 * this rewrite landed.
 */
function makeQuestionPool(counts: Record<AuthorSlug, number>): QuestionEntry[] {
  const entries: QuestionEntry[] = [];
  let i = 0;
  for (const [author, n] of Object.entries(counts) as [AuthorSlug, number][]) {
    for (let k = 0; k < n; k++) {
      entries.push({ card_id: `synthetic-question-${author}-${i++}`, book_slug: "synthetic", author_slug: author, question: "q", answer: "a" });
    }
  }
  return entries;
}

function makeObjectionPool(counts: Record<AuthorSlug, number>): ObjectionEntry[] {
  const entries: ObjectionEntry[] = [];
  let i = 0;
  for (const [author, n] of Object.entries(counts) as [AuthorSlug, number][]) {
    for (let k = 0; k < n; k++) {
      entries.push({
        card_id: `synthetic-objection-${author}-${i++}`,
        book_slug: "synthetic",
        author_slug: author,
        objection: "o",
        reply: "r",
        reply_start: 0,
      });
    }
  }
  return entries;
}

const REAL_QUESTION_POOL_SPLIT: Record<AuthorSlug, number> = { epictetus: 50, "marcus-aurelius": 21, seneca: 18 };
const REAL_OBJECTION_POOL_SPLIT: Record<AuthorSlug, number> = { epictetus: 24, seneca: 32, "marcus-aurelius": 3 };

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

// Pf39c2-social-pilot-02a D01: `hasQuotedSpeech`/`lengthDelta` were deleted
// outright along with `mechanicalGates` (see below) — the channel is one
// Wall a day, drawn from the Wall pool, nothing else, and nothing else
// called either function once `mechanicalGates` went with it.

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

// Pf39c2-social-pilot-02a D01: `mechanicalGates` (corpus-level population
// counts for the Still gate and the Objection precursor) was deleted
// outright along with those formats.

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

describe("wallGate", () => {
  // T08/R02 moved the scrolling wall of text off the card's own
  // original_excerpt and onto the surrounding CHAPTER block
  // (social/src/render/chapter-text.ts's buildChapterTextBlock), which
  // repeats whole chapter laps until the block clears the travel floor —
  // see that module's doc comment. A short original_excerpt therefore
  // outruns the viewer exactly as well as a long one; only the landing
  // line (phase 2) still depends on the card itself. This card's
  // original_excerpt is 9 words, nowhere near the old 80-word floor, but
  // it must still survive because its plain_english has a qualifying
  // landing line.
  it("survives with a short original_excerpt when it has a qualifying landing line", () => {
    const card = makeCard({
      original_excerpt: "A short passage of only nine words total.",
      plain_english: "Virtue alone is enough to live a good life.",
    });
    expect(wordCount(card.original_excerpt)).toBeLessThan(80);
    const entries = wallGate([card]);
    expect(entries).toHaveLength(1);
    expect(entries[0].landing_line).toBe("Virtue alone is enough to live a good life.");
    expect(entries[0].original_word_count).toBe(wordCount(card.original_excerpt));
  });

  it("still rejects a card with no qualifying landing line, regardless of original_excerpt length", () => {
    const card = makeCard({
      original_excerpt: "A short passage of only nine words total.",
      plain_english: "But this is only a fragment",
    });
    expect(wallGate([card])).toHaveLength(0);
  });
});

describe("wallGate against the real corpus", () => {
  const entries = wallGate(loadCorpus());

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
    // agreement for personal-pronoun antecedents measured 1,003, but that
    // figure was still gated on an >=80-word original_excerpt floor that
    // died at T08/R02 (see `wallGate`'s doc comment): phase 1 no longer
    // scrolls the card's own excerpt, so a short excerpt outruns the viewer
    // exactly as well as a long one. V01 deleted that floor; the gate now
    // measures 1,161 — exactly the corpus-wide count of cards with a
    // qualifying landing line, since a non-null `selectLandingLine` is the
    // only remaining condition. If pipeline content or the landing-line
    // rules change, re-run and update this assertion deliberately.
    expect(entries.length).toBe(1161);
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
// T03: corpus-level counts — classifyWallSubTypes and rankWall
// ---------------------------------------------------------------------------

describe("classifyWallSubTypes against the real corpus", () => {
  // V01 (social pilot 02a) removed `wallGate`'s >=80-word original_excerpt
  // floor (see that function's doc comment for why: T08/R02 moved the
  // scrolling wall of text off the card's own excerpt and onto the
  // surrounding chapter block, so excerpt length no longer needs to outrun
  // anything). `classifyWallSubTypes` never depended on that floor either —
  // it has always run over any card's `original_excerpt` regardless of
  // length — so this suite now measures it against the full corpus rather
  // than the dead `>=80-word` filter (formerly 1,326 cards; the filter and
  // its counts moved to this doc comment).
  const cards = loadCorpus();

  it("runs over the full 1,615-card corpus", () => {
    expect(cards.length).toBe(1615);
  });

  it("measures Thou Wall (>=3 archaic marker occurrences) at exactly 301", () => {
    const count = cards.filter((c) => classifyWallSubTypes(c).sub_types.includes("thou_wall")).length;
    expect(count).toBe(301);
  });

  it("measures Cascade (>=3 semicolons) at exactly 217", () => {
    const count = cards.filter((c) => classifyWallSubTypes(c).sub_types.includes("cascade")).length;
    expect(count).toBe(217);
  });

  it("measures Scene (>=2 double-quote characters) at exactly 144", () => {
    // The plan's own estimate for this sub-type was 176; that figure did
    // not reproduce under any quote-character definition tried (see the
    // in-file comment on classifyWallSubTypes). 144 is the measured count
    // for the definition actually implemented and is what's asserted here.
    const count = cards.filter((c) => classifyWallSubTypes(c).sub_types.includes("scene")).length;
    expect(count).toBe(144);
  });

  it("measures reserve (no sub-type matches) at 1010, the complement of the 605-card union", () => {
    const results = cards.map((c) => classifyWallSubTypes(c));
    const unionCount = results.filter((r) => !r.reserve).length;
    const reserveCount = results.filter((r) => r.reserve).length;
    expect(unionCount).toBe(605);
    expect(reserveCount).toBe(1010);
    expect(unionCount + reserveCount).toBe(cards.length);
  });
});

describe("rankWall against the real corpus", () => {
  const entries = rankWall(loadCorpus());

  it("ranks exactly the wallGate survivor set", () => {
    expect(entries.length).toBe(wallGate(loadCorpus()).length);
  });

  it("every entry carries a numeric original_grade (plain measured data, not tied to any opening mechanic)", () => {
    for (const entry of entries) {
      expect(typeof entry.original_grade).toBe("number");
    }
  });

  it("every entry's reserve flag matches whether it has any sub-type", () => {
    for (const entry of entries) {
      expect(entry.reserve).toBe(entry.sub_types.length === 0);
    }
  });

  // T17 (social pilot 02a) retired the Wall's opening rotation entirely —
  // no ranked entry carries an `eligible_openings` field any more.
  it("no entry carries an eligible_openings field — the opening rotation was retired outright (T17)", () => {
    for (const entry of entries) {
      expect(Object.prototype.hasOwnProperty.call(entry, "eligible_openings")).toBe(false);
    }
  });

  it("reports the ranked-pool sub-type counts (measured, informational)", () => {
    const thou = entries.filter((e) => e.sub_types.includes("thou_wall")).length;
    const cascade = entries.filter((e) => e.sub_types.includes("cascade")).length;
    const scene = entries.filter((e) => e.sub_types.includes("scene")).length;
    const reserve = entries.filter((e) => e.reserve).length;

    // These are measured, reported counts within the smaller 1,161-entry
    // ranked pool (wallGate survivors, post-V01) — necessarily <= the
    // full-corpus classifier counts above, since not every card has a
    // qualifying landing line.
    expect(thou).toBe(220);
    expect(cascade).toBe(185);
    expect(scene).toBe(98);
    expect(reserve).toBe(711);
  });
});

// Pf39c2-social-pilot-02a D01: The Question was deleted outright (the
// channel is one Wall a day, drawn from the Wall pool, nothing else) —
// `isExclamationShaped`, `hasAttributionLeak`, `findQuestionCandidate`,
// `questionCandidateAnswer`, `passesLayerA`, `isSecondPersonQuestion`,
// `hasThirdPartyReference`, `passesLayerB`, `isPivotAnswer`,
// `hasUnbalancedSingleQuote`, `hasUnbalancedQuotes`, `questionGate` and
// `buildQuestionDriftRequests` all went with it.

// ---------------------------------------------------------------------------
// T05: authorMix / combinedAuthorMix / wallAuthorWeights / selectWallBalanced
// ---------------------------------------------------------------------------

describe("authorMix", () => {
  it("counts and shares a synthetic collection", () => {
    const entries = [
      { author_slug: "epictetus" as const },
      { author_slug: "epictetus" as const },
      { author_slug: "seneca" as const },
      { author_slug: "marcus-aurelius" as const },
    ];
    const mix = authorMix(entries);
    expect(mix).toEqual({
      epictetus: { count: 2, share: 0.5 },
      "marcus-aurelius": { count: 1, share: 0.25 },
      seneca: { count: 1, share: 0.25 },
    });
  });

  it("returns a zero entry for an author with no matching entries, not undefined", () => {
    const entries = [{ author_slug: "seneca" as const }];
    const mix = authorMix(entries);
    expect(mix.epictetus).toEqual({ count: 0, share: 0 });
    expect(mix["marcus-aurelius"]).toEqual({ count: 0, share: 0 });
  });

  it("returns share 0 (not NaN) for every author on an empty collection", () => {
    const mix = authorMix([]);
    expect(mix.epictetus.share).toBe(0);
    expect(mix["marcus-aurelius"].share).toBe(0);
    expect(mix.seneca.share).toBe(0);
  });

  // Pf39c2-social-pilot-02a D01: this used to also measure the real
  // Question pool's own author mix (`questionGate(loadCorpus())`) — The
  // Question was deleted outright, so that real measurement is gone with
  // it. See `wallAuthorWeights`'s own tests below for where that same
  // 50/21/18 distribution survives, as a synthetic stand-in
  // (`makeQuestionPool`).
});

describe("combinedAuthorMix", () => {
  it("flattens multiple pools before computing the mix", () => {
    const poolA = [{ author_slug: "epictetus" as const }, { author_slug: "epictetus" as const }];
    const poolB = [{ author_slug: "seneca" as const }, { author_slug: "marcus-aurelius" as const }];
    const mix = combinedAuthorMix(poolA, poolB);
    expect(mix.epictetus.count).toBe(2);
    expect(mix.seneca.count).toBe(1);
    expect(mix["marcus-aurelius"].count).toBe(1);
    expect(mix.epictetus.share).toBeCloseTo(0.5, 5);
  });

  it("is equivalent to authorMix over the flattened pools", () => {
    const cards = loadCorpus();
    const questionPool = makeQuestionPool(REAL_QUESTION_POOL_SPLIT);
    const wallPool = rankWall(cards);
    expect(combinedAuthorMix(questionPool, wallPool)).toEqual(authorMix([...questionPool, ...wallPool]));
  });
});

describe("wallAuthorWeights", () => {
  const cards = loadCorpus();
  const questionPool = makeQuestionPool(REAL_QUESTION_POOL_SPLIT);
  const wallPool = rankWall(cards);
  const weights = wallAuthorWeights(questionPool, wallPool);

  it("pushes weight away from epictetus and toward marcus-aurelius and seneca", () => {
    // Question pool shares: epictetus 56%, marcus-aurelius 24%, seneca 20%.
    // Wall should correct in the opposite direction: epictetus's Wall weight
    // should land well below an even 1/3, while marcus-aurelius's and
    // seneca's should land above it.
    expect(weights.epictetus).toBeLessThan(BALANCED_AUTHOR_SHARE.epictetus);
    expect(weights["marcus-aurelius"]).toBeGreaterThan(BALANCED_AUTHOR_SHARE["marcus-aurelius"]);
    expect(weights.seneca).toBeGreaterThan(BALANCED_AUTHOR_SHARE.seneca);
  });

  it("measures the exact solved weights at the default 50/50 question/wall fraction", () => {
    // Solved algebraically: w[a] = (1/3 - 0.5 * q[a]) / 0.5, per the in-file
    // derivation, then renormalized (the un-clamped solution already sums to
    // 1 here since no author's Question share exceeds the 2/3 ceiling that
    // would force clamping).
    expect(weights.epictetus).toBeCloseTo(0.10486891385767785, 6);
    expect(weights["marcus-aurelius"]).toBeCloseTo(0.43071161048689144, 6);
    expect(weights.seneca).toBeCloseTo(0.4644194756554308, 6);
  });

  it("weights always sum to 1", () => {
    const total = weights.epictetus + weights["marcus-aurelius"] + weights.seneca;
    expect(total).toBeCloseTo(1, 8);
  });

  it("assigns zero weight to an author absent from the Wall pool, regardless of the algebra", () => {
    const syntheticQuestionPool = [
      { card_id: "a", book_slug: "discourses", author_slug: "epictetus" as const, question: "q", answer: "a" },
    ];
    const syntheticWallPool = [
      {
        card_id: "b",
        book_slug: "meditations",
        author_slug: "marcus-aurelius" as const,
        original_word_count: 100,
        landing_line: "line",
        sub_types: [],
        reserve: true,
        archaic_marker_count: 0,
        semicolon_count: 0,
        quote_count: 0,
        original_grade: 5,
      },
    ];
    const w = wallAuthorWeights(syntheticQuestionPool, syntheticWallPool);
    expect(w.seneca).toBe(0);
  });

  it("accepts an explicit questionFraction overriding DEFAULT_QUESTION_FRACTION", () => {
    const wOverride = wallAuthorWeights(questionPool, wallPool, 0.25);
    expect(DEFAULT_QUESTION_FRACTION).toBe(0.5);
    expect(wOverride).not.toEqual(weights);
    const total = wOverride.epictetus + wOverride["marcus-aurelius"] + wOverride.seneca;
    expect(total).toBeCloseTo(1, 8);
  });

  it("with no readThrough argument, is byte-identical to the pre-T17 function (backward compatibility)", () => {
    // Same call as the "measures the exact solved weights" test above —
    // pins that adding the optional 4th `readThrough` parameter changed
    // nothing about the function's behavior when a caller doesn't pass it.
    expect(weights.epictetus).toBeCloseTo(0.10486891385767785, 6);
    expect(weights["marcus-aurelius"]).toBeCloseTo(0.43071161048689144, 6);
    expect(weights.seneca).toBeCloseTo(0.4644194756554308, 6);
  });
});

// ---------------------------------------------------------------------------
// T17: wallAuthorWeights(..., readThrough) — the read-through's fixed author
// contribution. The pilot's default read-through (Meditations, T16) fixes
// marcus-aurelius at 7 of every 14 slots (50%) regardless of what Wall does,
// so treating the free slots as the whole week (T05's original algebra)
// double-counts marcus-aurelius. These tests exercise the read-through-aware
// path directly; schedule.test.ts exercises it end to end through
// `generateWeek`.
// ---------------------------------------------------------------------------

describe("wallAuthorWeights with a readThrough context (T17)", () => {
  const cards = loadCorpus();
  const questionPool = makeQuestionPool(REAL_QUESTION_POOL_SPLIT);
  const wallPool = rankWall(cards);
  const objectionPool = makeObjectionPool(REAL_OBJECTION_POOL_SPLIT);

  it("solves marcus-aurelius's own Wall weight to (near) 0 when marcus-aurelius is the fixed read-through author at a 50% floor", () => {
    // 7/14 = 0.5 already exceeds the 1/3 balanced target, so the "combined
    // == 1/3" equation has no non-negative solution for marcus-aurelius —
    // this is the REACHABLE FLOOR case documented on wallAuthorWeights.
    const weights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 0.5,
      objectionPool,
    });
    expect(weights["marcus-aurelius"]).toBe(0);
    expect(weights.epictetus).toBeGreaterThan(0);
    expect(weights.seneca).toBeGreaterThan(0);
    const total = weights.epictetus + weights["marcus-aurelius"] + weights.seneca;
    expect(total).toBeCloseTo(1, 8);
  });

  it("no weight is negative or NaN even when the read-through author is pinned at a share far above what any target could reach", () => {
    for (const slotShare of [0.5, 0.75, 0.9, 0.999, 1]) {
      const weights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
        author: "marcus-aurelius",
        slotShare,
        objectionPool,
      });
      for (const author of ["epictetus", "marcus-aurelius", "seneca"] as const) {
        expect(Number.isNaN(weights[author])).toBe(false);
        expect(weights[author]).toBeGreaterThanOrEqual(0);
        expect(weights[author]).toBeLessThanOrEqual(1);
      }
      const total = weights.epictetus + weights["marcus-aurelius"] + weights.seneca;
      expect(total).toBeCloseTo(1, 6);
    }
  });

  it("at slotShare 1 (no free slots at all), degrades to an even split rather than dividing by zero", () => {
    const weights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 1,
      objectionPool,
    });
    expect(weights.epictetus).toBeCloseTo(1 / 3, 8);
    expect(weights["marcus-aurelius"]).toBeCloseTo(1 / 3, 8);
    expect(weights.seneca).toBeCloseTo(1 / 3, 8);
  });

  it("pushes weight toward epictetus and seneca, away from marcus-aurelius, when marcus-aurelius already holds the read-through floor", () => {
    const weights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 0.5,
      objectionPool,
    });
    expect(weights["marcus-aurelius"]).toBeLessThan(BALANCED_AUTHOR_SHARE["marcus-aurelius"]);
    expect(weights.epictetus).toBeGreaterThan(BALANCED_AUTHOR_SHARE.epictetus);
    expect(weights.seneca).toBeGreaterThan(BALANCED_AUTHOR_SHARE.seneca);
  });

  it("measures the exact solved weights at the pilot's default 7/14 read-through share against the real corpus", () => {
    const weights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 0.5,
      objectionPool,
    });
    expect(weights.epictetus).toBeCloseTo(0.4230308186071691, 6);
    expect(weights["marcus-aurelius"]).toBe(0);
    expect(weights.seneca).toBeCloseTo(0.5769691813928309, 6);
  });

  it("accepts an explicit freeSlotFormatShare overriding the DEFAULT_FREE_SLOT_FORMAT_SHARE default", () => {
    const defaultShareWeights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 0.5,
      objectionPool,
    });
    const wallOnlyWeights = wallAuthorWeights(questionPool, wallPool, DEFAULT_QUESTION_FRACTION, {
      author: "marcus-aurelius",
      slotShare: 0.5,
      objectionPool,
      freeSlotFormatShare: { wall: 1, question: 0, objection: 0 },
    });
    expect(wallOnlyWeights).not.toEqual(defaultShareWeights);
    const total = wallOnlyWeights.epictetus + wallOnlyWeights["marcus-aurelius"] + wallOnlyWeights.seneca;
    expect(total).toBeCloseTo(1, 8);
  });
});

describe("createSeededRng", () => {
  it("is deterministic: the same seed produces the same sequence", () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
  });

  it("different seeds produce different sequences", () => {
    const a = createSeededRng(1);
    const b = createSeededRng(2);
    expect(a()).not.toBe(b());
  });

  it("always yields values in [0, 1)", () => {
    const rng = createSeededRng(7);
    for (let i = 0; i < 100; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("selectWallBalanced", () => {
  const cards = loadCorpus();
  const wallPool = rankWall(cards);
  const questionPool = makeQuestionPool(REAL_QUESTION_POOL_SPLIT);
  const weights = wallAuthorWeights(questionPool, wallPool);

  it("is deterministic: the same seed and weights return a byte-identical selection", () => {
    const a = selectWallBalanced(wallPool, weights, 20, createSeededRng(42));
    const b = selectWallBalanced(wallPool, weights, 20, createSeededRng(42));
    expect(a.map((e) => e.card_id)).toEqual(b.map((e) => e.card_id));
  });

  it("different seeds produce different selections", () => {
    const a = selectWallBalanced(wallPool, weights, 20, createSeededRng(1));
    const b = selectWallBalanced(wallPool, weights, 20, createSeededRng(2));
    expect(a.map((e) => e.card_id)).not.toEqual(b.map((e) => e.card_id));
  });

  it("every returned entry comes from the input pool, with no duplicates", () => {
    const poolIds = new Set(wallPool.map((e) => e.card_id));
    const selected = selectWallBalanced(wallPool, weights, 50, createSeededRng(5));
    expect(selected.length).toBe(50);
    const selectedIds = selected.map((e) => e.card_id);
    expect(new Set(selectedIds).size).toBe(selectedIds.length);
    for (const id of selectedIds) expect(poolIds.has(id)).toBe(true);
  });

  it("caps the selection at the pool size when n exceeds it", () => {
    const tinyPool = wallPool.slice(0, 3);
    const selected = selectWallBalanced(tinyPool, weights, 10, createSeededRng(3));
    expect(selected.length).toBe(3);
  });

  it("over a large draw, honours the weighting directionally (more seneca/marcus-aurelius, less epictetus than an even split)", () => {
    const selected = selectWallBalanced(wallPool, weights, 300, createSeededRng(11));
    const mix = authorMix(selected);
    expect(mix.epictetus.share).toBeLessThan(1 / 3);
    expect(mix["marcus-aurelius"].share).toBeGreaterThan(1 / 3);
    expect(mix.seneca.share).toBeGreaterThan(1 / 3);
  });
});

describe("combined weekly selection proves the point of T05", () => {
  // A realistic 7 Question + 7 Wall week. The Question sample is drawn with
  // weights matching its OWN natural (uncorrected) mix — T05 does not
  // rebalance The Question itself, only The Wall — while the Wall sample
  // uses wallAuthorWeights's correction. Both draws reuse the same
  // deterministic selectWallBalanced/createSeededRng mechanism.
  //
  // Pf39c2-social-pilot-02a D01: `questionPool` is a synthetic stand-in for
  // the real (now-deleted) `questionGate(cards)` output — see
  // `makeQuestionPool`'s own doc comment. `selectWallBalanced` never reads
  // an entry's own text or the pool's order, only each entry's
  // `author_slug` and the pool's per-author counts, so every pinned
  // count/share below is unchanged from what the real gate produced.
  const cards = loadCorpus();
  const questionPool = makeQuestionPool(REAL_QUESTION_POOL_SPLIT);
  const wallPool = rankWall(cards);
  const wallWeights = wallAuthorWeights(questionPool, wallPool);
  const questionMix = authorMix(questionPool);
  const naturalQuestionWeights: Record<AuthorSlug, number> = {
    epictetus: questionMix.epictetus.share,
    "marcus-aurelius": questionMix["marcus-aurelius"].share,
    seneca: questionMix.seneca.share,
  };

  const questionSample = selectWallBalanced(questionPool, naturalQuestionWeights, 7, createSeededRng(42));
  const wallSample = selectWallBalanced(wallPool, wallWeights, 7, createSeededRng(42));
  const combined = combinedAuthorMix(questionSample, wallSample);

  it("measures a combined epictetus share materially lower than the Question pool's 56%", () => {
    expect(questionMix.epictetus.share).toBeCloseTo(50 / 89, 5); // 0.562 — the pool's own skew, unchanged
    expect(combined.epictetus.count).toBe(3);
    expect(combined.epictetus.share).toBeCloseTo(3 / 14, 5); // 0.214 — materially lower than 0.562
    expect(combined.epictetus.share).toBeLessThan(0.3);
  });

  it("reports the full combined mix for this seed: epictetus 3, marcus-aurelius 5, seneca 6 (of 14)", () => {
    expect(combined).toEqual({
      epictetus: { count: 3, share: 3 / 14 },
      "marcus-aurelius": { count: 5, share: 5 / 14 },
      seneca: { count: 6, share: 6 / 14 },
    });
  });
});


// Pf39c2-social-pilot-02a D01: The Objection was deleted outright (the
// channel is one Wall a day, drawn from the Wall pool, nothing else) —
// `startsWithObjectionOpener`, `hasObjectionProperNoun` and `objectionGate`
// all went with it.
