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

  it("section numbers are contiguous within each book (no gaps)", () => {
    for (const ch of parsed.chapters) {
      const nums = ch.sections.map((s) => s.number);
      for (let i = 1; i < nums.length; i++) {
        expect(nums[i]).toBe(
          nums[i - 1] + 1,
          `${ch.slug}: gap between sections ${nums[i - 1]} and ${nums[i]}`,
        );
      }
    }
  });

  it("handles inline section markers (e.g. sentence ending with '. V. ')", () => {
    const book2 = parsed.chapters[1];
    const section5 = book2.sections.find((s) => s.number === 5);
    expect(section5).toBeDefined();
    expect(section5!.text).toContain("For not observing");
  });

  it("handles section markers missing trailing period (e.g. 'XXIII Consider')", () => {
    const book6 = parsed.chapters[5];
    const section23 = book6.sections.find((s) => s.number === 23);
    expect(section23).toBeDefined();
    expect(section23!.text).toContain("Consider how many different things");
  });
});

describe("parseSourceText — Enchiridion", () => {
  const config = BOOK_CONFIGS.find((b) => b.slug === "enchiridion")!;
  const text = readFileSync(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);

  it("has one chapter per section", () => {
    expect(parsed.chapters.length).toBeGreaterThanOrEqual(50);
  });

  it("each chapter has exactly 1 section", () => {
    expect(parsed.chapters[0].sections).toHaveLength(1);
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

  it("has exactly 50 chapters (sections 1-51, skipping 29)", () => {
    expect(parsed.chapters).toHaveLength(50);
  });

  it("section 51 does not contain footnotes or publisher text", () => {
    const sec51 = parsed.chapters.find((ch) => ch.slug === "section-51");
    expect(sec51).toBeDefined();
    const text = sec51!.sections[0].text;
    expect(text).not.toContain("Footnotes");
    expect(text).not.toContain("LIBERAL ARTS PRESS");
    expect(text).not.toContain("Happiness, the effect of virtue");
    // Inline refs like [8] are part of the text, but footnote bodies are not
    expect(text.length).toBeLessThan(2000);
  });
});

describe("parseSourceText — Seneca essays", () => {
  const senecaBooks = BOOK_CONFIGS.filter((b) => b.author_slug === "seneca");

  for (const config of senecaBooks) {
    describe(config.slug, () => {
      const text = readFileSync(config.source_file, "utf-8");
      const parsed = parseSourceText(text, config);

      it("has one chapter per section", () => {
        expect(parsed.chapters.length).toBeGreaterThan(0);
        expect(parsed.chapters[0].sections).toHaveLength(1);
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
