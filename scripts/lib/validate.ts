import {
  VALID_TAG_SLUGS,
  VALID_AUTHOR_SLUGS,
  VALID_BOOK_SLUGS,
  type TagSlug,
} from "./constants.js";
import type { Section } from "./parser.js";
import type { Chunk } from "./chunker.js";
import type {
  Card,
  BookMeta,
  ValidationMessage,
} from "./types.js";
import { logger } from "./logger.js";

// @ts-expect-error — text-readability has no type declarations
import rs from "text-readability";

// ---------------------------------------------------------------------------
// T04: Schema validation
// ---------------------------------------------------------------------------

const CARD_ID_RE = /^[a-z][a-z0-9-]+-\d{2}-\d{3}$/;

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateCardSchema(card: unknown): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];
  const id = isObject(card) ? String((card as Record<string, unknown>).id ?? "unknown") : "unknown";

  if (!isObject(card)) {
    msgs.push({ severity: "error", card_id: id, message: "Card is not an object" });
    return msgs;
  }

  const c = card as Record<string, unknown>;

  const requiredStrings = [
    "id",
    "book_slug",
    "chapter_slug",
    "plain_english",
    "original_excerpt",
    "source_reference",
    "author_slug",
  ];
  for (const field of requiredStrings) {
    if (typeof c[field] !== "string" || (c[field] as string).length === 0) {
      msgs.push({
        severity: "error",
        card_id: id,
        field,
        message: `Missing or invalid string field "${field}"`,
      });
    }
  }

  if (typeof c.card_number !== "number" || !Number.isInteger(c.card_number) || c.card_number < 1) {
    msgs.push({
      severity: "error",
      card_id: id,
      field: "card_number",
      message: "card_number must be a positive integer",
    });
  }

  if (
    typeof c.total_cards_in_chapter !== "number" ||
    !Number.isInteger(c.total_cards_in_chapter) ||
    c.total_cards_in_chapter < 1
  ) {
    msgs.push({
      severity: "error",
      card_id: id,
      field: "total_cards_in_chapter",
      message: "total_cards_in_chapter must be a positive integer",
    });
  }

  if (typeof c.reading_time_seconds !== "number" || c.reading_time_seconds <= 0) {
    msgs.push({
      severity: "error",
      card_id: id,
      field: "reading_time_seconds",
      message: "reading_time_seconds must be a positive number",
    });
  }

  if (!Array.isArray(c.tags) || c.tags.length === 0 || c.tags.length > 3) {
    msgs.push({
      severity: "error",
      card_id: id,
      field: "tags",
      message: "tags must be a non-empty array of 1-3 items",
    });
  }

  if (typeof c.id === "string" && !CARD_ID_RE.test(c.id)) {
    msgs.push({
      severity: "error",
      card_id: id,
      field: "id",
      message: `Card id "${c.id}" does not match pattern {book_slug}-{chapter}-{card} (e.g. meditations-05-016)`,
    });
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T05: Tag validation
// ---------------------------------------------------------------------------

export function validateCardTags(card: Card): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];
  for (const tag of card.tags) {
    if (!VALID_TAG_SLUGS.includes(tag as TagSlug)) {
      msgs.push({
        severity: "error",
        card_id: card.id,
        field: "tags",
        message: `Invalid tag "${tag}". Must be one of: ${VALID_TAG_SLUGS.join(", ")}`,
      });
    }
  }
  return msgs;
}

export function validateTagCoverage(cards: Card[]): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];
  const tagCounts = new Map<string, number>();
  for (const slug of VALID_TAG_SLUGS) tagCounts.set(slug, 0);
  for (const card of cards) {
    for (const tag of card.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  for (const [slug, count] of tagCounts) {
    // Intentionally non-blocking: informational about taxonomy coverage gaps
    if (count === 0) {
      msgs.push({
        severity: "warn",
        field: "tags",
        message: `Tag "${slug}" has zero cards across the entire content set`,
      });
    }
  }
  return msgs;
}

// ---------------------------------------------------------------------------
// T06: Readability validation
// ---------------------------------------------------------------------------

export function validateReadability(card: Card): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];
  const text = card.plain_english;

  if (text.length < 50) return msgs; // too short for reliable metrics

  const fkgl: number = rs.fleschKincaidGrade(text);

  if (fkgl > 12) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "plain_english",
      message: `FKGL ${fkgl.toFixed(1)} exceeds maximum of 12 — text is too difficult`,
    });
  // Intentionally non-blocking: soft readability target, not worth retrying over
  } else if (fkgl < 7 || fkgl > 8) {
    msgs.push({
      severity: "warn",
      card_id: card.id,
      field: "plain_english",
      message: `FKGL ${fkgl.toFixed(1)} outside target range 7-8`,
    });
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T07: Cross-reference validation
// ---------------------------------------------------------------------------

export function validateBookMeta(
  meta: BookMeta,
  chapterFiles: Map<string, Card[]>,
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (!VALID_AUTHOR_SLUGS.includes(meta.author_slug)) {
    msgs.push({
      severity: "error",
      book_slug: meta.slug,
      field: "author_slug",
      message: `Invalid author_slug "${meta.author_slug}"`,
    });
  }

  let totalFromChapters = 0;

  for (const chapter of meta.chapters) {
    const cards = chapterFiles.get(chapter.slug);
    if (!cards) {
      msgs.push({
        severity: "error",
        book_slug: meta.slug,
        field: "chapters",
        message: `Chapter "${chapter.slug}" listed in _meta.json but no corresponding JSON file found`,
      });
      continue;
    }

    if (cards.length !== chapter.card_count) {
      msgs.push({
        severity: "error",
        book_slug: meta.slug,
        field: "card_count",
        message: `Chapter "${chapter.slug}" meta says ${chapter.card_count} cards but file has ${cards.length}`,
      });
    }
    totalFromChapters += cards.length;
  }

  // Check for chapter files not listed in meta
  for (const [slug] of chapterFiles) {
    if (!meta.chapters.some((ch) => ch.slug === slug)) {
      msgs.push({
        severity: "error",
        book_slug: meta.slug,
        field: "chapters",
        message: `Chapter file "${slug}" exists but is not listed in _meta.json`,
      });
    }
  }

  if (meta.total_cards !== totalFromChapters) {
    msgs.push({
      severity: "error",
      book_slug: meta.slug,
      field: "total_cards",
      message: `total_cards is ${meta.total_cards} but sum of chapter cards is ${totalFromChapters}`,
    });
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T08: Content quality checks
// ---------------------------------------------------------------------------

const HTML_RE = /<\/?[a-z][\s\S]*?>/i;
const MD_HEADING_RE = /^#{1,6}\s/m;
const MD_BOLD_RE = /\*\*[^*]+\*\*/;
const MD_LINK_RE = /\[[^\]]+\]\([^)]+\)/;

export function validateCardContent(card: Card): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (!card.plain_english || card.plain_english.length < 20) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "plain_english",
      message: `plain_english is empty or too short (${card.plain_english?.length ?? 0} chars, min 20)`,
    });
  }

  if (!card.original_excerpt || card.original_excerpt.length === 0) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "original_excerpt",
      message: "original_excerpt is empty",
    });
  }

  // Check source_reference format
  // Expected: "Meditations, Book 5, Section 16" or "The Enchiridion, Section 23"
  // or titled chapters like "Discourses, About Cynicism"
  if (
    card.source_reference &&
    !/^.+, .+/.test(card.source_reference)
  ) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "source_reference",
      message: `source_reference "${card.source_reference}" does not match expected format (e.g. "Meditations, Book 5, Section 16" or "Discourses, About Cynicism")`,
    });
  }

  // No HTML in text fields
  for (const field of ["plain_english", "original_excerpt"] as const) {
    const text = card[field];
    if (text && HTML_RE.test(text)) {
      msgs.push({
        severity: "error",
        card_id: card.id,
        field,
        message: `${field} contains HTML markup`,
      });
    }
    if (text && (MD_HEADING_RE.test(text) || MD_BOLD_RE.test(text) || MD_LINK_RE.test(text))) {
      msgs.push({
        severity: "error",
        card_id: card.id,
        field,
        message: `${field} appears to contain Markdown formatting`,
      });
    }
  }

  return msgs;
}

export function validateCardSequence(
  cards: Card[],
  chapterSlug: string,
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];
  const sorted = [...cards].sort((a, b) => a.card_number - b.card_number);

  for (let i = 0; i < sorted.length; i++) {
    const expected = i + 1;
    if (sorted[i].card_number !== expected) {
      msgs.push({
        severity: "error",
        card_id: sorted[i].id,
        book_slug: sorted[i].book_slug,
        field: "card_number",
        message: `Card number ${sorted[i].card_number} in chapter "${chapterSlug}" — expected ${expected} (non-sequential)`,
      });
    }
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T09a: Parse content validation — catch source artifacts before refine
// ---------------------------------------------------------------------------

/** Patterns that indicate source artifacts leaked into parsed section text. */
const SOURCE_ARTIFACT_PATTERNS: { pattern: RegExp; label: string }[] = [
  { pattern: /^THE\s+(THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH)\s+BOOK\s+OF\s+THE\s+DIALOGUES/m, label: "dialogue header" },
  { pattern: /^OF\s+[A-Z][A-Z ]+\.$/m, label: "dialogue title line" },
  { pattern: /^\[\d+\]\s+\w/m, label: "footnote block" },
];

/**
 * Validate that parsed sections don't contain source artifacts like
 * inter-book preamble, footnote blocks, or dialogue headers.
 * Runs after parsing, before refine (which costs API calls).
 */
export function validateParseContent(
  sections: Section[],
  chapterSlug: string,
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  for (const section of sections) {
    for (const { pattern, label } of SOURCE_ARTIFACT_PATTERNS) {
      if (pattern.test(section.text)) {
        const msg = `${chapterSlug} section ${section.number} contains ${label} — source text not cleanly separated`;
        logger.error(`validate: parse content — ${msg}`);
        msgs.push({
          severity: "error",
          field: "parse",
          message: msg,
        });
      }
    }
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T09: Section coverage — parsed sections → chunks roundtrip
// ---------------------------------------------------------------------------

/**
 * Normalize text the same way the chunker does so we can compare
 * parser output against chunker output.
 */
function normalizeForComparison(text: string): string {
  return text
    .replace(/^[IVXLCDMivxlcdm]+\.\s*/, "")   // strip Roman prefix
    .replace(/\[_[A-Za-z]+\._\]\s*/g, "")       // strip speaker labels
    .replace(/\[\d+\]/g, "")                     // strip footnote references [4]
    .replace(/\{[\d]+\}/g, "")                   // strip page numbers
    .replace(/[\u2018\u2019]/g, "'")             // normalize smart quotes
    .replace(/[\u201C\u201D]/g, '"')             // normalize smart double quotes
    .replace(/\s+/g, " ")                        // collapse all whitespace
    .trim()
    .toLowerCase();
}

/**
 * Extract a stable text signature (first N words) for matching.
 */
function textSignature(text: string, wordCount = 6): string {
  const words = normalizeForComparison(text).split(" ");
  return words.slice(0, wordCount).join(" ");
}

/**
 * Extract the last N words as a tail signature for matching.
 */
function tailSignature(text: string, wordCount = 6): string {
  const words = normalizeForComparison(text).split(" ");
  return words.slice(-wordCount).join(" ");
}

/**
 * Verify that every parsed section is accounted for in the chunker output.
 *
 * Checks:
 * 1. Parsed section numbers are contiguous (no gaps from 1..N or minNum..maxNum)
 * 2. Every parsed section's text appears in some chunk (catches dropped content)
 */
export function validateSectionCoverage(
  parsedSections: Section[],
  chunks: Chunk[],
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (parsedSections.length === 0) {
    msgs.push({
      severity: "error",
      field: "sections",
      message: "No sections parsed from source text",
    });
    return msgs;
  }

  // 1. Check parsed section numbers are contiguous
  const parsedNums = parsedSections.map((s) => s.number).sort((a, b) => a - b);
  const minNum = parsedNums[0];
  for (let i = 0; i < parsedNums.length; i++) {
    const expected = minNum + i;
    if (parsedNums[i] !== expected) {
      const msg = `Gap in parsed section numbers: expected ${expected}, found ${parsedNums[i]}`;
      logger.error(`validate: section coverage — ${msg}`);
      msgs.push({
        severity: "error",
        field: "sections",
        message: msg,
      });
      break; // one error is enough to flag the issue
    }
  }

  // 2. Every parsed section's text must appear in some chunk
  const chunkTexts = chunks.map((c) => normalizeForComparison(c.text));

  for (const section of parsedSections) {
    const sig = textSignature(section.text);
    if (sig.length < 10) continue; // too short to match reliably

    const found = chunkTexts.some((ct) => ct.includes(sig));
    if (!found) {
      const msg = `Section ${section.number} text not found in any chunk (starts with: "${sig.slice(0, 50)}")`;
      logger.error(`validate: section coverage — ${msg}`);
      msgs.push({
        severity: "error",
        field: "sections",
        message: msg,
      });
    }
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T10: Refine coverage — pre-refine chunks → post-refine chunks
// ---------------------------------------------------------------------------

/**
 * Verify that refining did not silently drop content.
 *
 * For every pre-refine chunk, checks that both its opening and closing text
 * appear somewhere in the post-refine output. This catches:
 * - Splits where the AI omitted part of the original text
 * - Merges that accidentally lost a chunk
 * - Bugs in cross-batch merge handling
 */
export function validateRefineCoverage(
  preRefine: Chunk[],
  postRefine: Chunk[],
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (preRefine.length === 0) return msgs;

  if (postRefine.length === 0) {
    msgs.push({
      severity: "error",
      field: "refine",
      message: "Refine produced zero chunks from non-empty input",
    });
    return msgs;
  }

  // Concatenate all post-refine text for substring searching
  const postText = postRefine.map((c) => normalizeForComparison(c.text)).join(" ");

  for (const chunk of preRefine) {
    const head = textSignature(chunk.text);
    const tail = tailSignature(chunk.text);

    if (head.length < 10) continue;

    const headFound = postText.includes(head);
    const tailFound = tail.length >= 10 ? postText.includes(tail) : true;

    if (!headFound) {
      const msg = `Section ${chunk.sectionNumber} opening text not found after refine (starts with: "${head.slice(0, 50)}")`;
      logger.error(`validate: refine coverage — ${msg}`);
      msgs.push({
        severity: "error",
        card_id: `section-${chunk.sectionNumber}`,
        field: "refine",
        message: msg,
      });
    } else if (!tailFound) {
      const msg = `Section ${chunk.sectionNumber} closing text not found after refine (ends with: "...${tail.slice(-50)}")`;
      logger.error(`validate: refine coverage — ${msg}`);
      msgs.push({
        severity: "error",
        card_id: `section-${chunk.sectionNumber}`,
        field: "refine",
        message: msg,
      });
    }
  }

  // Check that each post-refine chunk ends with sentence-ending punctuation
  // (catches mid-sentence splits before expensive translation).
  // If the corresponding pre-refine chunk also fails the regex, the source text
  // genuinely ends that way (e.g., em-dash before inline verse) — not an error.
  // Em-dashes (\u2014) are allowed because they appear naturally in source texts
  // before inline verse quotations (e.g., "tempers—" or "verse:—"). Actual
  // mid-sentence splits end with plain words, not em-dashes.
  const CHUNK_SENTENCE_END_RE = /[.?!;:'""\u201D)\]\u2014]$/;
  const preBySection = new Map<number, Chunk[]>();
  for (const c of preRefine) {
    const list = preBySection.get(c.sectionNumber) ?? [];
    list.push(c);
    preBySection.set(c.sectionNumber, list);
  }

  for (const chunk of postRefine) {
    const trimmed = chunk.text.trim();
    if (trimmed.length >= 30 && !CHUNK_SENTENCE_END_RE.test(trimmed)) {
      // Check if the pre-refine source also ends the same way
      const preChunks = preBySection.get(chunk.sectionNumber) ?? [];
      const sourceAlsoFails = preChunks.some((pc) => {
        const preTrimmed = pc.text.trim();
        return preTrimmed.length >= 30 && !CHUNK_SENTENCE_END_RE.test(preTrimmed);
      });
      if (!sourceAlsoFails) {
        const msg = `Section ${chunk.sectionNumber} chunk ends mid-sentence after refine (ends with: "...${trimmed.slice(-50)}")`;
        logger.error(`validate: refine coverage — ${msg}`);
        msgs.push({
          severity: "error",
          card_id: `section-${chunk.sectionNumber}`,
          field: "refine",
          message: msg,
        });
      }
    }
  }

  return msgs;
}
