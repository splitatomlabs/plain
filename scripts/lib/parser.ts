import type { BookConfig } from "./constants.js";

export interface Section {
  number: number;
  text: string;
}

export interface ParsedChapter {
  slug: string;
  title: string;
  bookNumber?: number; // For Meditations: which book (1-12)
  sections: Section[];
}

export interface ParsedBook {
  slug: string;
  chapters: ParsedChapter[];
}

// ---------------------------------------------------------------------------
// Roman numeral conversion
// ---------------------------------------------------------------------------

const ROMAN_VALUES: Record<string, number> = {
  I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000,
};

export function romanToInt(roman: string): number {
  const upper = roman.toUpperCase().trim();
  let result = 0;
  for (let i = 0; i < upper.length; i++) {
    const current = ROMAN_VALUES[upper[i]];
    const next = ROMAN_VALUES[upper[i + 1]];
    if (current === undefined) return 0;
    if (next && current < next) {
      result -= current;
    } else {
      result += current;
    }
  }
  return result;
}

// ---------------------------------------------------------------------------
// Gutenberg stripping
// ---------------------------------------------------------------------------

function stripGutenberg(text: string): string {
  // Find START marker
  const startMatch = text.match(/\*\*\* START OF (?:THE )?PROJECT GUTENBERG/i);
  if (startMatch && startMatch.index !== undefined) {
    text = text.slice(startMatch.index + startMatch[0].length);
  }

  // Find END marker
  const endMatch = text.match(/\*\*\* END OF (?:THE )?PROJECT GUTENBERG/i);
  if (endMatch && endMatch.index !== undefined) {
    text = text.slice(0, endMatch.index);
  }

  return text.trim();
}

// ---------------------------------------------------------------------------
// Meditations-specific parser
// ---------------------------------------------------------------------------

const BOOK_ORDINALS: Record<string, number> = {
  FIRST: 1, SECOND: 2, THIRD: 3, FOURTH: 4, FIFTH: 5, SIXTH: 6,
  SEVENTH: 7, EIGHTH: 8, NINTH: 9, TENTH: 10, ELEVENTH: 11, TWELFTH: 12,
};

function parseMeditations(text: string, config: BookConfig): ParsedBook {
  const headerRe = config.headerPattern!;
  const sectionRe = config.sectionPattern;

  // Split into books by header
  const lines = text.split("\n");
  const bookBoundaries: { bookNum: number; startLine: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headerRe);
    if (match) {
      const ordinal = match[1].toUpperCase();
      bookBoundaries.push({ bookNum: BOOK_ORDINALS[ordinal], startLine: i });
    }
  }

  const chapters: ParsedChapter[] = [];

  for (let b = 0; b < bookBoundaries.length; b++) {
    const { bookNum, startLine } = bookBoundaries[b];
    const endLine = b + 1 < bookBoundaries.length
      ? bookBoundaries[b + 1].startLine
      : lines.length;

    let bookText = lines.slice(startLine + 1, endLine).join("\n");
    // Strip APPENDIX or similar trailing content
    const appendixMatch = bookText.match(/\n\s*APPENDIX\s*\n/);
    if (appendixMatch && appendixMatch.index !== undefined) {
      bookText = bookText.slice(0, appendixMatch.index);
    }
    const sections = splitSections(bookText, sectionRe);

    const group = config.chapterGrouping!.find(
      (g) => bookNum >= g.range[0] && bookNum <= g.range[1],
    );
    if (!group) continue;

    chapters.push({
      slug: group.slug,
      title: group.title,
      bookNumber: bookNum,
      sections,
    });
  }

  return { slug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Single-essay parser (Seneca and Enchiridion)
// ---------------------------------------------------------------------------

function parseSingleEssay(text: string, config: BookConfig): ParsedBook {
  let sections: Section[];

  if (config.slug === "enchiridion") {
    sections = splitEnchiridionSections(text);
  } else {
    sections = splitSections(text, config.sectionPattern);
  }

  // Strip speaker labels if needed
  if (config.speakerLabels) {
    for (const s of sections) {
      s.text = s.text.replace(/\[_[A-Za-z]+\._\]\s*/g, "").trim();
    }
  }

  // Each section becomes its own chapter
  const chapters: ParsedChapter[] = sections.map((s) => ({
    slug: `section-${String(s.number).padStart(2, "0")}`,
    title: `Section ${s.number}`,
    sections: [s],
  }));

  return { slug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Section splitting — inline Roman numerals (Meditations, Seneca essays)
// ---------------------------------------------------------------------------

/**
 * Normalize section markers that the standard regex would miss:
 * 1. Inline markers: "...desires. V. For not..." → split onto new line
 * 2. Missing period: "XXIII Consider" → "XXIII. Consider"
 */
function normalizeSectionMarkers(text: string): string {
  // Split inline section markers onto their own line.
  // Match sentence-ending punctuation + space + Roman numeral + period + space
  text = text.replace(
    /([.;?!]) ([IVXLCDM]{1,10})\. ([A-Z])/g,
    "$1\n$2. $3",
  );

  // Add missing period after bare Roman numeral at start of line.
  // Match: start-of-line Roman numeral + space + uppercase letter (no period)
  text = text.replace(
    /^([IVXLCDM]{1,10}) ([A-Z])/gm,
    "$1. $2",
  );

  return text;
}

function splitSections(text: string, sectionRe: RegExp): Section[] {
  const sections: Section[] = [];
  text = normalizeSectionMarkers(text);
  const lines = text.split("\n");

  // Find all section start positions
  const sectionStarts: { lineIndex: number; number: number }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(sectionRe);
    if (match) {
      const num = romanToInt(match[1]);
      if (num > 0) {
        sectionStarts.push({ lineIndex: i, number: num });
      }
    }
  }

  // Filter to monotonically increasing section numbers (handles appendix noise)
  const filtered: typeof sectionStarts = [];
  let lastNum = 0;
  for (const s of sectionStarts) {
    if (s.number > lastNum) {
      filtered.push(s);
      lastNum = s.number;
    }
  }

  for (let i = 0; i < filtered.length; i++) {
    const start = filtered[i];
    const endLine = i + 1 < filtered.length
      ? filtered[i + 1].lineIndex
      : lines.length;

    const sectionText = lines.slice(start.lineIndex, endLine).join("\n").trim();
    sections.push({ number: start.number, text: sectionText });
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Enchiridion-specific splitting — centered standalone Roman numerals
// ---------------------------------------------------------------------------

function splitEnchiridionSections(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split("\n");

  // Enchiridion uses centered Roman numerals on their own line
  const centeredRomanRe = /^\s{10,}([IVXLCDMivxlcdm]+)\s*$/;

  // Find the first centered Roman numeral "I" to skip the preamble
  let startIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(centeredRomanRe);
    if (match && romanToInt(match[1]) === 1) {
      startIdx = i;
      break;
    }
  }

  if (startIdx === -1) return sections;

  // Find all section starts from that point
  const sectionStarts: { lineIndex: number; number: number }[] = [];

  for (let i = startIdx; i < lines.length; i++) {
    const match = lines[i].match(centeredRomanRe);
    if (match) {
      const num = romanToInt(match[1]);
      if (num > 0) {
        sectionStarts.push({ lineIndex: i, number: num });
      }
    }
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const start = sectionStarts[i];
    const endLine = i + 1 < sectionStarts.length
      ? sectionStarts[i + 1].lineIndex
      : lines.length;

    // Skip the Roman numeral header line itself
    const sectionText = lines.slice(start.lineIndex + 1, endLine).join("\n").trim();
    if (sectionText.length > 0) {
      sections.push({ number: start.number, text: sectionText });
    }
  }

  return sections;
}

// ---------------------------------------------------------------------------
// Preamble stripping for Seneca essays
// ---------------------------------------------------------------------------

function stripSenecaPreamble(text: string, config: BookConfig): string {
  // Seneca essays start with a heading line (e.g. "PAULINUS.") then title,
  // then jump to "I." — find the first section marker
  const match = text.match(config.sectionPattern);
  if (match && match.index !== undefined) {
    return text.slice(match.index);
  }
  return text;
}

// ---------------------------------------------------------------------------
// Main parser entry point
// ---------------------------------------------------------------------------

export function parseSourceText(text: string, config: BookConfig): ParsedBook {
  // Strip Gutenberg header/footer if needed
  if (config.gutenbergStrip) {
    text = stripGutenberg(text);
  }

  // For Enchiridion: skip the introduction/bibliography preamble
  // The actual content starts at the first centered "I"
  if (config.slug === "enchiridion") {
    return parseSingleEssay(text, config);
  }

  // Meditations has book/chapter structure
  if (config.headerPattern) {
    return parseMeditations(text, config);
  }

  // Seneca essays: strip preamble, then parse as single essay
  text = stripSenecaPreamble(text, config);
  return parseSingleEssay(text, config);
}
