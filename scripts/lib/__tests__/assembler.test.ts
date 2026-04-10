import { describe, it, expect } from "vitest";
import { assembleBook, type ChapterChunks } from "../assembler.js";
import { BOOK_CONFIGS } from "../constants.js";
import type { TranslatedChunk } from "../translator.js";

function makeTranslated(overrides: Partial<TranslatedChunk> = {}): TranslatedChunk {
  return {
    sectionNumber: 1,
    originalText: "Original text of the passage about virtue and discipline.",
    plainEnglish: "Plain English text about virtue and discipline that is reasonably long.",
    tags: ["self-discipline"],
    ...overrides,
  };
}

describe("assembleBook", () => {
  const config = BOOK_CONFIGS.find((b) => b.slug === "meditations")!;

  it("generates correct card IDs with zero padding", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [
          makeTranslated({ sectionNumber: 1 }),
          makeTranslated({ sectionNumber: 2 }),
        ],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const cards = chapters.get("book-01")!;
    expect(cards[0].id).toBe("meditations-01-001");
    expect(cards[1].id).toBe("meditations-01-002");
  });

  it("sets correct card_number and total_cards_in_chapter", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-03",
        chapterTitle: "Book 3",
        bookNumber: 3,
        chunks: [
          makeTranslated({ sectionNumber: 1 }),
          makeTranslated({ sectionNumber: 2 }),
          makeTranslated({ sectionNumber: 3 }),
        ],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const cards = chapters.get("book-03")!;
    expect(cards[0].card_number).toBe(1);
    expect(cards[2].card_number).toBe(3);
    expect(cards[0].total_cards_in_chapter).toBe(3);
    expect(cards[2].total_cards_in_chapter).toBe(3);
  });

  it("generates correct source references for Meditations", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-05",
        chapterTitle: "Book 5",
        bookNumber: 5,
        chunks: [makeTranslated({ sectionNumber: 16 })],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-05")![0];
    expect(card.source_reference).toBe("Meditations, Book 5, Section 16");
  });

  it("generates correct source references for Seneca essays", () => {
    const senecaConfig = BOOK_CONFIGS.find((b) => b.slug === "shortness-of-life")!;
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "sections-01-07",
        chapterTitle: "Sections 1-7",
        chunks: [makeTranslated({ sectionNumber: 3 })],
      },
    ];

    const { chapters } = assembleBook(chunks, senecaConfig);
    const card = chapters.get("sections-01-07")![0];
    expect(card.source_reference).toBe("On the Shortness of Life, Section 3");
  });

  it("generates correct source references for Enchiridion", () => {
    const enchConfig = BOOK_CONFIGS.find((b) => b.slug === "enchiridion")!;
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "sections-01-10",
        chapterTitle: "Sections 1-10",
        chunks: [makeTranslated({ sectionNumber: 7 })],
      },
    ];

    const { chapters } = assembleBook(chunks, enchConfig);
    const card = chapters.get("sections-01-10")![0];
    expect(card.source_reference).toBe("The Enchiridion, Section 7");
  });

  it("sets author_slug and book_slug on all cards", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [makeTranslated()],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-01")![0];
    expect(card.author_slug).toBe("marcus-aurelius");
    expect(card.book_slug).toBe("meditations");
  });

  it("generates BookMeta with correct totals", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [makeTranslated(), makeTranslated({ sectionNumber: 2 })],
      },
      {
        chapterSlug: "book-02",
        chapterTitle: "Book 2",
        bookNumber: 2,
        chunks: [makeTranslated()],
      },
    ];

    const { meta } = assembleBook(chunks, config);
    expect(meta.total_cards).toBe(3);
    expect(meta.chapters).toHaveLength(2);
    expect(meta.chapters[0].card_count).toBe(2);
    expect(meta.chapters[1].card_count).toBe(1);
  });

  it("collects unique tags across all cards into meta", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [
          makeTranslated({ tags: ["self-discipline", "calm-your-mind"] }),
          makeTranslated({ sectionNumber: 2, tags: ["calm-your-mind", "facing-fear"] }),
        ],
      },
    ];

    const { meta } = assembleBook(chunks, config);
    expect(meta.tags).toContain("self-discipline");
    expect(meta.tags).toContain("calm-your-mind");
    expect(meta.tags).toContain("facing-fear");
    expect(new Set(meta.tags).size).toBe(meta.tags.length); // no duplicates
  });

  it("estimates reading time based on word count", () => {
    const longText = Array(100).fill("word").join(" "); // 100 words = 30 seconds
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [makeTranslated({ plainEnglish: longText })],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-01")![0];
    expect(card.reading_time_seconds).toBe(30); // 100 words / 200 wpm * 60s
  });

  it("reading time has a minimum of 5 seconds", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [makeTranslated({ plainEnglish: "Very short." })],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-01")![0];
    expect(card.reading_time_seconds).toBe(5);
  });

  it("sorts chunks by section number within chapter", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [
          makeTranslated({ sectionNumber: 3, plainEnglish: "Third section text that is long enough." }),
          makeTranslated({ sectionNumber: 1, plainEnglish: "First section text that is long enough." }),
          makeTranslated({ sectionNumber: 2, plainEnglish: "Second section text that is long enough." }),
        ],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const cards = chapters.get("book-01")!;
    expect(cards[0].card_number).toBe(1);
    expect(cards[0].plain_english).toContain("First");
    expect(cards[2].plain_english).toContain("Third");
  });

  it("collapses single newlines to spaces in text fields", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [
          makeTranslated({
            originalText: "Of my grandfather Verus I have learned to be gentle\nand meek, and to refrain from all anger\nand passion.",
            plainEnglish: "From my grandfather Verus I learned\nto be gentle and calm.",
          }),
        ],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-01")![0];
    expect(card.original_excerpt).not.toContain("\n");
    expect(card.original_excerpt).toContain("gentle and meek");
    expect(card.plain_english).not.toContain("\n");
    expect(card.plain_english).toContain("I learned to be");
  });

  it("preserves double newlines as paragraph breaks", () => {
    const chunks: ChapterChunks[] = [
      {
        chapterSlug: "book-01",
        chapterTitle: "Book 1",
        bookNumber: 1,
        chunks: [
          makeTranslated({
            originalText: "First paragraph about virtue.\n\nSecond paragraph about duty.",
            plainEnglish: "First part about being good.\n\nSecond part about responsibility.",
          }),
        ],
      },
    ];

    const { chapters } = assembleBook(chunks, config);
    const card = chapters.get("book-01")![0];
    expect(card.original_excerpt).toContain("\n\n");
    expect(card.plain_english).toContain("\n\n");
  });
});
