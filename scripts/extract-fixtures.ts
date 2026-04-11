import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../", import.meta.url).pathname;
const CONTENT_DIR = join(ROOT, "content/output");
const FIXTURES_DIR = join(ROOT, "content/fixtures");

const BOOK_CHAPTER_COUNTS: Record<string, number> = {
  meditations: 2,
  enchiridion: 1,
  "shortness-of-life": 1,
  "happy-life": 1,
};

interface ChapterMeta {
  slug: string;
  title: string;
  card_count: number;
}

interface BookMeta {
  slug: string;
  title: string;
  author_slug: string;
  description: string;
  tags: string[];
  chapters: ChapterMeta[];
  total_cards: number;
  source_url: string;
}

async function extractFixtures() {
  // Clear and recreate output dir
  await rm(FIXTURES_DIR, { recursive: true, force: true });
  await mkdir(FIXTURES_DIR, { recursive: true });

  // Copy authors.json
  await copyFile(join(CONTENT_DIR, "authors.json"), join(FIXTURES_DIR, "authors.json"));
  console.log("Copied authors.json");

  // Extract each book
  for (const [bookSlug, chapterCount] of Object.entries(BOOK_CHAPTER_COUNTS)) {
    const bookSrc = join(CONTENT_DIR, bookSlug);
    const bookDst = join(FIXTURES_DIR, bookSlug);
    await mkdir(bookDst, { recursive: true });

    // Read and trim _meta.json
    const metaRaw = await readFile(join(bookSrc, "_meta.json"), "utf-8");
    const meta: BookMeta = JSON.parse(metaRaw);

    const trimmedChapters = meta.chapters.slice(0, chapterCount);
    const totalCards = trimmedChapters.reduce((sum, ch) => sum + ch.card_count, 0);

    const trimmedMeta: BookMeta = {
      ...meta,
      chapters: trimmedChapters,
      total_cards: totalCards,
    };

    await writeFile(join(bookDst, "_meta.json"), JSON.stringify(trimmedMeta, null, 2) + "\n");
    console.log(`Wrote ${bookSlug}/_meta.json (${trimmedChapters.length} chapter(s), ${totalCards} cards)`);

    // Copy chapter files
    for (const chapter of trimmedChapters) {
      const src = join(bookSrc, `${chapter.slug}.json`);
      const dst = join(bookDst, `${chapter.slug}.json`);
      await copyFile(src, dst);
      console.log(`  Copied ${bookSlug}/${chapter.slug}.json`);
    }
  }

  console.log("\nDone. Fixtures written to content/fixtures/");
}

extractFixtures().catch((err) => {
  console.error(err);
  process.exit(1);
});
