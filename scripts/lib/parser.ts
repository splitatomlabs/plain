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
// Single-essay parser (flat section structure)
// ---------------------------------------------------------------------------

function parseSingleEssay(text: string, config: BookConfig): ParsedBook {
  let sections: Section[];

  if (config.sectionSplitMode === "centered") {
    sections = splitCenteredSections(text);
  } else {
    sections = splitSections(text, config.sectionPattern);
  }

  // Strip trailing content (footnotes, publisher info) from the last section
  if (config.trailingContentPattern && sections.length > 0) {
    const last = sections[sections.length - 1];
    const match = last.text.match(config.trailingContentPattern);
    if (match && match.index !== undefined) {
      last.text = last.text.slice(0, match.index).trim();
    }
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
// Centered section splitting — standalone indented Roman numerals
// ---------------------------------------------------------------------------

function splitCenteredSections(text: string): Section[] {
  const sections: Section[] = [];
  const lines = text.split("\n");

  // Centered Roman numerals on their own line, optionally followed by footnote refs like [2]
  const centeredRomanRe = /^\s{10,}([IVXLCDMivxlcdm]+)\s*(?:\[\d+\])?\s*$/;

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
// Heading-based parser (Discourses)
// ---------------------------------------------------------------------------

/**
 * Convert an ALL-CAPS heading to Title Case.
 * e.g. "OF THE THINGS WHICH ARE IN OUR POWER" → "Of the Things Which Are in Our Power"
 */
function toTitleCase(heading: string): string {
  const minorWords = new Set([
    "a", "an", "the", "and", "but", "or", "nor", "for", "yet", "so",
    "in", "on", "at", "to", "by", "of", "up", "as", "is", "it",
    "from", "into", "with", "not",
  ]);

  return heading
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (i === 0 || !minorWords.has(word)) {
        return word.charAt(0).toUpperCase() + word.slice(1);
      }
      return word;
    })
    .join(" ");
}

/**
 * Convert a title to a kebab-case slug.
 * e.g. "Of the Things Which Are in Our Power" → "of-the-things-which-are-in-our-power"
 */
function toSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function parseDiscourses(text: string, config: BookConfig): ParsedBook {
  const headingRe = config.headingPattern!;
  // ALL-CAPS continuation line that precedes a heading line (multi-line headings)
  const continuationRe = /^[A-Z][A-Z ,.':()]+$/;
  const lines = text.split("\n");

  // Find all heading positions, merging multi-line headings
  const headings: { startLine: number; endLine: number; title: string }[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingRe);
    if (match) {
      let fullTitle = match[1].replace(/\.$/, "").trim();
      let startLine = i;

      // Check if preceding non-blank lines are ALL-CAPS continuations
      let j = i - 1;
      while (j >= 0 && continuationRe.test(lines[j].trim()) && lines[j].trim().length > 0) {
        fullTitle = lines[j].trim() + " " + fullTitle;
        startLine = j;
        j--;
      }

      headings.push({ startLine, endLine: i, title: toTitleCase(fullTitle) });
    }
  }

  const chapters: ParsedChapter[] = [];

  for (let i = 0; i < headings.length; i++) {
    const { startLine, endLine: headingEndLine, title } = headings[i];
    const nextStart = i + 1 < headings.length
      ? headings[i + 1].startLine
      : lines.length;

    // The heading line includes the title + em-dash + start of text
    const headingLine = lines[headingEndLine];
    const dashIdx = headingLine.indexOf("—");
    const firstPart = dashIdx >= 0 ? headingLine.slice(dashIdx + 1) : "";

    // Combine first part with remaining lines
    const bodyLines = [firstPart, ...lines.slice(headingEndLine + 1, nextStart)];
    const bodyText = bodyLines.join("\n").trim();

    if (bodyText.length === 0) continue;

    const slug = toSlug(title);

    chapters.push({
      slug,
      title,
      sections: [{ number: 1, text: bodyText }],
    });
  }

  return { slug: config.slug, chapters };
}

// ---------------------------------------------------------------------------
// Main parser entry point
// ---------------------------------------------------------------------------

export function parseSourceText(text: string, config: BookConfig): ParsedBook {
  // Strip Gutenberg header/footer if needed
  if (config.gutenbergStrip) {
    text = stripGutenberg(text);
  }

  // Meditations has book/chapter structure
  if (config.headerPattern) {
    return parseMeditations(text, config);
  }

  // Strip preamble if configured
  if (config.preamblePattern) {
    const match = text.match(config.preamblePattern);
    if (match && match.index !== undefined) {
      text = text.slice(match.index);
    }
  }

  // Strip trailing content if configured (before parsing, for heading-based books)
  if (config.headingPattern && config.trailingContentPattern) {
    const trailMatch = text.match(config.trailingContentPattern);
    if (trailMatch && trailMatch.index !== undefined) {
      text = text.slice(0, trailMatch.index).trim();
    }
  }

  // Discourses use heading-based splitting
  if (config.headingPattern) {
    return parseDiscourses(text, config);
  }

  return parseSingleEssay(text, config);
}
