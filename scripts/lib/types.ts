import type { TagSlug, AuthorSlug } from "./constants.js";

export interface Card {
  id: string;
  book_slug: string;
  chapter_slug: string;
  card_number: number;
  total_cards_in_chapter: number;
  plain_english: string;
  original_excerpt: string;
  source_reference: string;
  author_slug: AuthorSlug;
  tags: TagSlug[];
  reading_time_seconds: number;
}

export interface ChapterInfo {
  slug: string;
  title: string;
  card_count: number;
}

export interface BookMeta {
  slug: string;
  title: string;
  author_slug: AuthorSlug;
  description: string;
  tags: TagSlug[];
  chapters: ChapterInfo[];
  total_cards: number;
  total_reading_time_seconds: number;
  source_url: string;

}

export type Severity = "error" | "warn" | "info";

export interface ValidationMessage {
  severity: Severity;
  card_id?: string;
  book_slug?: string;
  field?: string;
  message: string;
}

export interface ValidationResult {
  messages: ValidationMessage[];
  books_checked: number;
  cards_checked: number;
}

export interface SemanticResult {
  card_id: string;
  messages: ValidationMessage[];
  cached: boolean;
}
