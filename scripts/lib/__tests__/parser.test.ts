import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { BOOK_CONFIGS } from "../constants.js";
import { parseSourceText, romanToInt } from "../parser.js";

describe("romanToInt", () => {
  it("converts basic numerals", () => {
    expect(romanToInt("I")).toBe(1);
    expect(romanToInt("V")).toBe(5);
    expect(romanToInt("X")).toBe(10);
    expect(romanToInt("L")).toBe(50);
  });

  it("converts compound numerals", () => {
    expect(romanToInt("IV")).toBe(4);
    expect(romanToInt("IX")).toBe(9);
    expect(romanToInt("XIV")).toBe(14);
    expect(romanToInt("XXVIII")).toBe(28);
    expect(romanToInt("LI")).toBe(51);
  });

  it("handles lowercase", () => {
    expect(romanToInt("xvii")).toBe(17);
    expect(romanToInt("xlii")).toBe(42);
  });

  it("returns 0 for invalid input", () => {
    expect(romanToInt("")).toBe(0);
    expect(romanToInt("ABC")).toBe(0);
  });
});

describe("parseSourceText — Meditations", () => {
  const config = BOOK_CONFIGS.find((b) => b.slug === "meditations")!;
  const text = readFileSync(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  it("finds all 12 books", () => {
    expect(parsed.chapters).toHaveLength(12);
  });

  it("assigns correct chapter slugs", () => {
    expect(parsed.chapters[0].slug).toBe("book-01");
    expect(parsed.chapters[11].slug).toBe("book-12");
  });

  it("finds sections in Book 1", () => {
    const book1 = parsed.chapters[0];
    expect(book1.sections.length).toBeGreaterThanOrEqual(15);
    expect(book1.sections[0].number).toBe(1);
  });

  it("sections have non-empty text", () => {
    for (const ch of parsed.chapters) {
      for (const s of ch.sections) {
        expect(s.text.length).toBeGreaterThan(0);
      }
    }
  });

  it("does not include APPENDIX content", () => {
    const book12 = parsed.chapters[11];
    const allText = book12.sections.map((s) => s.text).join(" ");
    expect(allText).not.toContain("CORNELIUS FRONTO");
    expect(allText).not.toContain("APPENDIX");
  });

  it("section numbers are monotonically increasing within each book", () => {
    for (const ch of parsed.chapters) {
      for (let i = 1; i < ch.sections.length; i++) {
        expect(ch.sections[i].number).toBeGreaterThan(ch.sections[i - 1].number);
      }
    }
  });
});

describe("parseSourceText — Enchiridion", () => {
  const config = BOOK_CONFIGS.find((b) => b.slug === "enchiridion")!;
  const text = readFileSync(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  it("finds 5 chapter groups", () => {
    expect(parsed.chapters).toHaveLength(5);
  });

  it("first chapter has 10 sections", () => {
    expect(parsed.chapters[0].sections).toHaveLength(10);
  });

  it("first section starts with expected text", () => {
    expect(parsed.chapters[0].sections[0].text).toContain(
      "There are things which are within our power",
    );
  });

  it("skips Gutenberg preamble and introduction", () => {
    const allText = parsed.chapters
      .flatMap((ch) => ch.sections)
      .map((s) => s.text)
      .join(" ");
    expect(allText).not.toContain("Project Gutenberg");
    expect(allText).not.toContain("OSKAR PIEST");
  });

  it("total sections is at least 50", () => {
    const total = parsed.chapters.reduce((sum, ch) => sum + ch.sections.length, 0);
    expect(total).toBeGreaterThanOrEqual(50);
  });
});

describe("parseSourceText — Seneca essays", () => {
  const senecaBooks = BOOK_CONFIGS.filter((b) => b.author_slug === "seneca");

  for (const config of senecaBooks) {
    describe(config.slug, () => {
      const text = readFileSync(config.source_file, "utf-8");
      const parsed = parseSourceText(text, config);

      it("finds expected chapter groups", () => {
        expect(parsed.chapters.length).toBe(config.chapterGrouping.length);
      });

      it("first section starts at number 1", () => {
        expect(parsed.chapters[0].sections[0].number).toBe(1);
      });

      it("has non-empty sections", () => {
        for (const ch of parsed.chapters) {
          for (const s of ch.sections) {
            expect(s.text.trim().length).toBeGreaterThan(0);
          }
        }
      });
    });
  }

  it("Peace of Mind has speaker labels in raw sections", () => {
    const config = BOOK_CONFIGS.find((b) => b.slug === "peace-of-mind")!;
    const text = readFileSync(config.source_file, "utf-8");
    const parsed = parseSourceText(text, config);
    // Speaker labels are stripped by the parser for peace-of-mind
    const section1 = parsed.chapters[0].sections[0].text;
    expect(section1).not.toContain("[_Serenus._]");
  });
});
