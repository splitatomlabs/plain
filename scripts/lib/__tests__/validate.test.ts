import { describe, it, expect } from "vitest";
import {
  validateCardSchema,
  validateCardTags,
  validateTagCoverage,
  validateReadability,
  validateBookMeta,
  validateCardContent,
  validateCardSequence,
  validateSectionCoverage,
  validateRefineCoverage,
} from "../validate.js";
import type { Card, BookMeta } from "../types.js";
import type { Section } from "../parser.js";
import type { Chunk } from "../chunker.js";

function makeCard(overrides: Partial<Card> = {}): Card {
  return {
    id: "meditations-05-016",
    book_slug: "meditations",
    chapter_slug: "book-05",
    card_number: 16,
    total_cards_in_chapter: 34,
    plain_english:
      "The quality of your thoughts shapes the quality of your life. If you constantly think about what is wrong, you will feel miserable. But if you train yourself to notice what is working, what is true, and what is good, your mind becomes a place you actually want to live in.",
    original_excerpt:
      "The happiness of your life depends upon the quality of your thoughts: therefore, guard accordingly.",
    source_reference: "Meditations, Book 5, Section 16",
    author_slug: "marcus-aurelius",
    tags: ["calm-your-mind", "knowing-yourself"],
    reading_time_seconds: 30,
    ...overrides,
  };
}

describe("validateCardSchema", () => {
  it("passes for a valid card", () => {
    const msgs = validateCardSchema(makeCard());
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("errors on non-object input", () => {
    const msgs = validateCardSchema("not an object");
    expect(msgs[0].severity).toBe("error");
  });

  it("errors on missing required fields", () => {
    const msgs = validateCardSchema({ id: "test" });
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors.length).toBeGreaterThan(5);
  });

  it("errors on invalid id format", () => {
    const msgs = validateCardSchema(makeCard({ id: "bad-id" }));
    const idErrors = msgs.filter((m) => m.field === "id");
    expect(idErrors.length).toBeGreaterThan(0);
  });

  it("errors on negative reading_time_seconds", () => {
    const msgs = validateCardSchema(makeCard({ reading_time_seconds: -5 }));
    const errors = msgs.filter((m) => m.field === "reading_time_seconds");
    expect(errors).toHaveLength(1);
  });

  it("errors on empty tags array", () => {
    const msgs = validateCardSchema(makeCard({ tags: [] as any }));
    const errors = msgs.filter((m) => m.field === "tags");
    expect(errors).toHaveLength(1);
  });

  it("errors on more than 3 tags", () => {
    const msgs = validateCardSchema(
      makeCard({ tags: ["calm-your-mind", "facing-hardship", "knowing-yourself", "human-nature"] as any }),
    );
    const errors = msgs.filter((m) => m.field === "tags");
    expect(errors).toHaveLength(1);
  });

  it("accepts valid card IDs with hyphens in book slug", () => {
    const msgs = validateCardSchema(
      makeCard({ id: "shortness-of-life-01-003", book_slug: "shortness-of-life" }),
    );
    const idErrors = msgs.filter((m) => m.field === "id" && m.severity === "error");
    expect(idErrors).toHaveLength(0);
  });
});

describe("validateCardTags", () => {
  it("passes for valid tags", () => {
    const msgs = validateCardTags(makeCard({ tags: ["calm-your-mind", "facing-hardship"] }));
    expect(msgs).toHaveLength(0);
  });

  it("errors on invalid tag", () => {
    const msgs = validateCardTags(makeCard({ tags: ["not-a-real-tag"] as any }));
    expect(msgs).toHaveLength(1);
    expect(msgs[0].severity).toBe("error");
  });
});

describe("validateTagCoverage", () => {
  it("warns when a tag has zero cards", () => {
    const cards = [makeCard({ tags: ["calm-your-mind"] })];
    const msgs = validateTagCoverage(cards);
    const warns = msgs.filter((m) => m.severity === "warn");
    // 7 of 8 tags have zero cards
    expect(warns).toHaveLength(7);
  });
});

describe("validateReadability", () => {
  it("skips very short text", () => {
    const msgs = validateReadability(makeCard({ plain_english: "Short." }));
    expect(msgs).toHaveLength(0);
  });

  it("errors on extremely difficult text", () => {
    const hardText =
      "The epistemological ramifications of ontological presuppositions " +
      "necessitate a comprehensive reevaluation of our hermeneutical " +
      "frameworks, particularly when juxtaposed against the phenomenological " +
      "manifestations of transcendental subjectivity in contemporary " +
      "philosophical discourse regarding metaphysical foundations.";
    const msgs = validateReadability(makeCard({ plain_english: hardText }));
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors.length).toBeGreaterThanOrEqual(1);
  });
});

describe("validateBookMeta", () => {
  it("passes when meta matches chapter files", () => {
    const meta: BookMeta = {
      slug: "meditations",
      title: "Meditations",
      author_slug: "marcus-aurelius",
      description: "A book",
      tags: ["calm-your-mind"],
      chapters: [{ slug: "book-01", title: "Book 1", card_count: 2 }],
      total_cards: 2,
      source_url: "https://example.com",
    };
    const chapterFiles = new Map([["book-01", [makeCard(), makeCard({ id: "meditations-01-002", card_number: 2 })]]]);
    const msgs = validateBookMeta(meta, chapterFiles);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors when chapter is in meta but missing file", () => {
    const meta: BookMeta = {
      slug: "meditations",
      title: "Meditations",
      author_slug: "marcus-aurelius",
      description: "",
      tags: [],
      chapters: [{ slug: "book-01", title: "Book 1", card_count: 5 }],
      total_cards: 5,
      source_url: "",
    };
    const msgs = validateBookMeta(meta, new Map());
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors.some((e) => e.message.includes("no corresponding JSON file"))).toBe(true);
  });

  it("errors when card count mismatches", () => {
    const meta: BookMeta = {
      slug: "meditations",
      title: "Meditations",
      author_slug: "marcus-aurelius",
      description: "",
      tags: [],
      chapters: [{ slug: "book-01", title: "Book 1", card_count: 10 }],
      total_cards: 10,
      source_url: "",
    };
    const chapterFiles = new Map([["book-01", [makeCard()]]]);
    const msgs = validateBookMeta(meta, chapterFiles);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors.some((e) => e.message.includes("meta says 10 cards but file has 1"))).toBe(true);
  });

  it("errors on invalid author_slug", () => {
    const meta: BookMeta = {
      slug: "test",
      title: "Test",
      author_slug: "plato" as any,
      description: "",
      tags: [],
      chapters: [],
      total_cards: 0,
      source_url: "",
    };
    const msgs = validateBookMeta(meta, new Map());
    expect(msgs.some((m) => m.message.includes("Invalid author_slug"))).toBe(true);
  });
});

describe("validateCardContent", () => {
  it("passes for valid card content", () => {
    const msgs = validateCardContent(makeCard());
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("errors on empty plain_english", () => {
    const msgs = validateCardContent(makeCard({ plain_english: "" }));
    expect(msgs.some((m) => m.field === "plain_english" && m.severity === "error")).toBe(true);
  });

  it("errors on too-short plain_english", () => {
    const msgs = validateCardContent(makeCard({ plain_english: "Too short." }));
    expect(msgs.some((m) => m.field === "plain_english")).toBe(true);
  });

  it("errors on HTML in text fields", () => {
    const msgs = validateCardContent(
      makeCard({ plain_english: "This has <b>bold</b> text and is long enough to pass the length check easily." }),
    );
    expect(msgs.some((m) => m.message.includes("HTML"))).toBe(true);
  });

  it("errors on markdown in text fields", () => {
    const msgs = validateCardContent(
      makeCard({ plain_english: "This has **bold** text and is long enough to pass the minimum length check easily." }),
    );
    expect(msgs.some((m) => m.severity === "error" && m.message.includes("Markdown"))).toBe(true);
  });

  it("errors on empty original_excerpt", () => {
    const msgs = validateCardContent(makeCard({ original_excerpt: "" }));
    expect(msgs.some((m) => m.field === "original_excerpt")).toBe(true);
  });

});

describe("validateCardSequence", () => {
  it("passes for sequential cards", () => {
    const cards = [
      makeCard({ card_number: 1 }),
      makeCard({ card_number: 2 }),
      makeCard({ card_number: 3 }),
    ];
    const msgs = validateCardSequence(cards, "book-01");
    expect(msgs).toHaveLength(0);
  });

  it("errors on non-sequential cards", () => {
    const cards = [
      makeCard({ card_number: 1 }),
      makeCard({ card_number: 3 }), // gap
    ];
    const msgs = validateCardSequence(cards, "book-01");
    expect(msgs.length).toBeGreaterThan(0);
    expect(msgs[0].severity).toBe("error");
  });
});

describe("validateSectionCoverage", () => {
  const makeSections = (...texts: string[]): Section[] =>
    texts.map((text, i) => ({ number: i + 1, text }));

  const makeChunks = (...texts: string[]): Chunk[] =>
    texts.map((text, i) => ({ sectionNumber: i + 1, text }));

  it("passes when all sections map to chunks", () => {
    const sections = makeSections(
      "I. The happiness of your life depends upon the quality of your thoughts.",
      "II. You have power over your mind, not outside events. Realize this and find strength.",
    );
    const chunks = makeChunks(
      "The happiness of your life depends upon the quality of your thoughts.",
      "You have power over your mind, not outside events. Realize this and find strength.",
    );
    const msgs = validateSectionCoverage(sections, chunks);
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("errors when a section is missing from chunks", () => {
    const sections = makeSections(
      "I. The happiness of your life depends upon the quality of your thoughts.",
      "II. You have power over your mind, not outside events. Realize this and find strength.",
      "III. Everything we hear is an opinion, not a fact. Everything we see is perspective.",
    );
    // Only two chunks — section 3's text is missing
    const chunks = makeChunks(
      "The happiness of your life depends upon the quality of your thoughts.",
      "You have power over your mind, not outside events. Realize this and find strength.",
    );
    const msgs = validateSectionCoverage(sections, chunks);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Section 3");
  });

  it("passes when a fragment is merged into another chunk", () => {
    const sections = makeSections(
      "I. Short.",
      "II. This is a longer section that has enough text to stand on its own as a proper card.",
    );
    // Chunker merges section 1 into section 2
    const chunks: Chunk[] = [
      {
        sectionNumber: 1,
        text: "Short.\n\nThis is a longer section that has enough text to stand on its own as a proper card.",
      },
    ];
    const msgs = validateSectionCoverage(sections, chunks);
    // Section 1 is too short for reliable matching (<10 chars signature), so it's skipped.
    // Section 2's text is present in the merged chunk.
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors).toHaveLength(0);
  });

  it("errors on gap in parsed section numbers", () => {
    const sections: Section[] = [
      { number: 1, text: "I. The happiness of your life depends upon the quality of your thoughts." },
      { number: 3, text: "III. Everything we hear is an opinion, not a fact. Everything we see is perspective." },
    ];
    const chunks: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
      { sectionNumber: 3, text: "Everything we hear is an opinion, not a fact. Everything we see is perspective." },
    ];
    const msgs = validateSectionCoverage(sections, chunks);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors.some((e) => e.message.includes("Gap in parsed section numbers"))).toBe(true);
  });

  it("errors when no sections are parsed", () => {
    const msgs = validateSectionCoverage([], []);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toContain("No sections parsed");
  });

  it("handles speaker labels and page numbers in source text", () => {
    const sections: Section[] = [
      { number: 1, text: "I. [_Serenus._] When I examine {289} myself, some vices appear on the surface clearly." },
    ];
    const chunks: Chunk[] = [
      { sectionNumber: 1, text: "When I examine myself, some vices appear on the surface clearly." },
    ];
    const msgs = validateSectionCoverage(sections, chunks);
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });
});

describe("validateRefineCoverage", () => {
  it("passes when refine keeps all chunks unchanged", () => {
    const chunks: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
      { sectionNumber: 2, text: "You have power over your mind, not outside events. Realize this and find strength." },
    ];
    const msgs = validateRefineCoverage(chunks, chunks);
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("passes when a chunk is split and all text preserved", () => {
    const pre: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts. You have power over your mind, not outside events." },
    ];
    const post: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
      { sectionNumber: 1, text: "You have power over your mind, not outside events." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("errors when a split drops the ending of the original text", () => {
    const pre: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts. You have power over your mind, not outside events." },
    ];
    // Split only kept the first half
    const post: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("closing text not found");
  });

  it("passes when two chunks are merged", () => {
    const pre: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
      { sectionNumber: 2, text: "You have power over your mind, not outside events. Realize this and find strength." },
    ];
    const post: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts.\n\nYou have power over your mind, not outside events. Realize this and find strength." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.filter((m) => m.severity === "error")).toHaveLength(0);
  });

  it("errors when a chunk is completely dropped", () => {
    const pre: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
      { sectionNumber: 2, text: "Everything we hear is an opinion, not a fact. Everything we see is perspective." },
    ];
    // Only section 1 survived
    const post: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    const errors = msgs.filter((m) => m.severity === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain("Section 2");
  });

  it("errors when refine produces zero chunks", () => {
    const pre: Chunk[] = [
      { sectionNumber: 1, text: "The happiness of your life depends upon the quality of your thoughts." },
    ];
    const msgs = validateRefineCoverage(pre, []);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].message).toContain("zero chunks");
  });

  it("returns no errors for empty input", () => {
    const msgs = validateRefineCoverage([], []);
    expect(msgs).toHaveLength(0);
  });

  it("errors when a post-refine chunk ends mid-sentence", () => {
    const pre = [{ sectionNumber: 1, text: "Some wear away their lives in that voluntary slavery, the unrequited service of great men." }];
    const post = [
      { sectionNumber: 1, text: "Some wear away their lives in that voluntary slavery, the" },
      { sectionNumber: 1, text: "unrequited service of great men." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.severity === "error" && m.message.includes("mid-sentence"))).toBe(true);
  });

  it("does not error when chunks end with punctuation", () => {
    const pre = [{ sectionNumber: 1, text: "First sentence. Second sentence." }];
    const post = [
      { sectionNumber: 1, text: "First sentence." },
      { sectionNumber: 1, text: "Second sentence." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.message.includes("mid-sentence"))).toBe(false);
  });

  it("does not error when chunk ends with ellipsis", () => {
    const pre = [{ sectionNumber: 1, text: "And so life goes on... But we must act now." }];
    const post = [
      { sectionNumber: 1, text: "And so life goes on..." },
      { sectionNumber: 1, text: "But we must act now." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.message.includes("mid-sentence"))).toBe(false);
  });

  it("does not error on short chunks under 30 chars", () => {
    const pre = [{ sectionNumber: 1, text: "Short text here and more" }];
    const post = [
      { sectionNumber: 1, text: "Short text here and more" },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.message.includes("mid-sentence"))).toBe(false);
  });

  it("errors when refine introduces em-dash ending not in source", () => {
    const longChunk = "They spend their whole lives preparing to live, never realizing\u2014";
    const pre = [{ sectionNumber: 1, text: longChunk + " that life passes them by." }];
    const post = [
      { sectionNumber: 1, text: longChunk },
      { sectionNumber: 1, text: "that life passes them by." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.severity === "error" && m.message.includes("mid-sentence"))).toBe(true);
  });

  it("does not error when source also ends with em-dash", () => {
    const emDashText = "Some people let their tempers control everything they do\u2014";
    const pre = [{ sectionNumber: 1, text: emDashText }];
    const post = [{ sectionNumber: 1, text: emDashText }];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.message.includes("mid-sentence"))).toBe(false);
  });

  it("does not error when chunk ends with colon-emdash before verse quotation", () => {
    const pre = [{ sectionNumber: 1, text: "He fought to the death, shouting the Homeric verse:\u2014\n\n\"Carry me off, or I will carry thee!\"\n\nHow great was his madness!" }];
    const post = [
      { sectionNumber: 1, text: "He fought to the death, shouting the Homeric verse:\u2014" },
      { sectionNumber: 1, text: "\"Carry me off, or I will carry thee!\"\n\nHow great was his madness!" },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.message.includes("mid-sentence"))).toBe(false);
  });

  it("errors when refine introduces mid-sentence break not in source", () => {
    const pre = [{ sectionNumber: 1, text: "The wise man knows that virtue is the only good. He acts accordingly." }];
    const post = [
      { sectionNumber: 1, text: "The wise man knows that virtue is the only" },
      { sectionNumber: 1, text: "good. He acts accordingly." },
    ];
    const msgs = validateRefineCoverage(pre, post);
    expect(msgs.some((m) => m.severity === "error" && m.message.includes("mid-sentence"))).toBe(true);
  });
});
