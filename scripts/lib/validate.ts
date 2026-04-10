import {
  VALID_TAG_SLUGS,
  VALID_AUTHOR_SLUGS,
  VALID_BOOK_SLUGS,
  type TagSlug,
} from "./constants.js";
import type {
  Card,
  BookMeta,
  ValidationMessage,
} from "./types.js";

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
  const fre: number = rs.fleschReadingEase(text);

  if (fkgl > 12) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "plain_english",
      message: `FKGL ${fkgl.toFixed(1)} exceeds maximum of 12 — text is too difficult`,
    });
  } else if (fkgl < 7 || fkgl > 8) {
    msgs.push({
      severity: "warn",
      card_id: card.id,
      field: "plain_english",
      message: `FKGL ${fkgl.toFixed(1)} outside target range 7-8`,
    });
  }

  if (fre < 65 || fre > 75) {
    msgs.push({
      severity: "warn",
      card_id: card.id,
      field: "plain_english",
      message: `Flesch Reading Ease ${fre.toFixed(1)} outside target range 65-75`,
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

  if (!card.plain_english || card.plain_english.length < 50) {
    msgs.push({
      severity: "error",
      card_id: card.id,
      field: "plain_english",
      message: `plain_english is empty or too short (${card.plain_english?.length ?? 0} chars, min 50)`,
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
  // Expected: "Meditations, Book 5, Section 16" or "The Enchiridion, Section 23" etc.
  if (card.source_reference && !/^.+,.+\d+/.test(card.source_reference)) {
    msgs.push({
      severity: "warn",
      card_id: card.id,
      field: "source_reference",
      message: `source_reference "${card.source_reference}" does not match expected format (e.g. "Meditations, Book 5, Section 16")`,
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
        severity: "warn",
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
