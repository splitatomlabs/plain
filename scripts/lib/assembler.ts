import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { BookConfig, TagSlug } from "./constants.js";
import type { Card, BookMeta, ChapterInfo } from "./types.js";
import type { TranslatedChunk } from "./translator.js";

/**
 * Normalize newlines: collapse single newlines to spaces (Gutenberg line wraps),
 * preserve double newlines as paragraph breaks.
 */
function normalizeNewlines(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n\n+/g, "\x00") // protect paragraph breaks
    .replace(/\n/g, " ")        // collapse single newlines
    .replace(/\x00/g, "\n\n")   // restore paragraph breaks
    .replace(/ {2,}/g, " ")     // collapse double spaces
    .trim();
}

function estimateReadingTime(text: string): number {
  const words = text.split(/\s+/).filter((w) => w.length > 0).length;
  return Math.max(Math.round((words / 200) * 60), 5);
}

/**
 * Zero-pad a number to a given width.
 */
function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Build a source reference string from the template.
 */
function buildSourceRef(
  template: string,
  sectionNumber: number,
  bookNumber?: number,
): string {
  let ref = template.replace("{n}", String(sectionNumber));
  if (bookNumber !== undefined) {
    ref = ref.replace("{chapter}", String(bookNumber));
  }
  return ref;
}

/**
 * Chunks pre-grouped by chapter, in the order they appear in the book.
 */
export interface ChapterChunks {
  chapterSlug: string;
  chapterTitle: string;
  bookNumber?: number; // For Meditations: which book (1-12)
  chunks: TranslatedChunk[];
}

/**
 * Assemble translated chunks (pre-grouped by chapter) into final Card JSON
 * plus the BookMeta.
 */
export function assembleBook(
  chapterChunks: ChapterChunks[],
  config: BookConfig,
): { meta: BookMeta; chapters: Map<string, Card[]> } {
  const chapters = new Map<string, Card[]>();
  const chapterInfos: ChapterInfo[] = [];
  const allTags = new Set<TagSlug>();

  for (const { chapterSlug, chapterTitle, bookNumber, chunks } of chapterChunks) {
    if (chunks.length === 0) continue;

    // Sort by section number within chapter
    const sorted = [...chunks].sort((a, b) => a.sectionNumber - b.sectionNumber);

    // Determine chapter number from slug (first number in the slug)
    const chapterMatch = chapterSlug.match(/(\d+)/);
    const chapterNum = chapterMatch ? parseInt(chapterMatch[1], 10) : 1;

    const cards: Card[] = sorted.map((chunk, idx) => {
      const cardNumber = idx + 1;
      for (const tag of chunk.tags) allTags.add(tag);

      return {
        id: `${config.slug}-${pad(chapterNum, 2)}-${pad(cardNumber, 3)}`,
        book_slug: config.slug,
        chapter_slug: chapterSlug,
        card_number: cardNumber,
        total_cards_in_chapter: sorted.length,
        plain_english: normalizeNewlines(chunk.plainEnglish),
        original_excerpt: normalizeNewlines(chunk.originalText),
        source_reference: buildSourceRef(
          config.sourceRefTemplate,
          chunk.sectionNumber,
          bookNumber,
        ),
        author_slug: config.author_slug,
        tags: chunk.tags,
        reading_time_seconds: estimateReadingTime(chunk.plainEnglish),
      };
    });

    chapters.set(chapterSlug, cards);
    chapterInfos.push({
      slug: chapterSlug,
      title: chapterTitle,
      card_count: cards.length,
    });
  }

  const totalCards = chapterInfos.reduce((sum, ch) => sum + ch.card_count, 0);

  const meta: BookMeta = {
    slug: config.slug,
    title: config.title,
    author_slug: config.author_slug,
    description: config.description,
    tags: [...allTags],
    chapters: chapterInfos,
    total_cards: totalCards,
    source_url: config.source_url,

  };

  return { meta, chapters };
}

/**
 * Write assembled book content to the filesystem.
 */
export async function writeContentFiles(
  meta: BookMeta,
  chapters: Map<string, Card[]>,
  outputDir: string,
): Promise<void> {
  const bookDir = path.join(outputDir, meta.slug);
  await mkdir(bookDir, { recursive: true });

  // Write _meta.json
  await writeFile(
    path.join(bookDir, "_meta.json"),
    JSON.stringify(meta, null, 2) + "\n",
  );

  // Write chapter files
  for (const [chapterSlug, cards] of chapters) {
    await writeFile(
      path.join(bookDir, `${chapterSlug}.json`),
      JSON.stringify(cards, null, 2) + "\n",
    );
  }

  console.log(
    `Wrote ${meta.slug}: ${chapters.size} chapter files, ${meta.total_cards} cards`,
  );
}
