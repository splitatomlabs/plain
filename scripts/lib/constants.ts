export const VALID_TAGS = [
  { slug: "calm-your-mind", label: "Calm Your Mind", description: "Inner tranquility, managing anxiety, stillness of thought, mindfulness, composure under pressure" },
  { slug: "death-and-mortality", label: "Death & Mortality", description: "Acceptance of death, impermanence, memento mori, legacy, grief, the shortness of life" },
  { slug: "doing-the-right-thing", label: "Doing The Right Thing", description: "Virtue, justice, ethics, duty, integrity, moral courage, fairness to others" },
  { slug: "facing-hardship", label: "Facing Hardship", description: "Enduring fear, anger, pain, loss, and adversity with resilience and courage" },
  { slug: "freedom-and-control", label: "Freedom & Control", description: "Distinguishing what is up to us from what is not, letting go, acceptance, detachment from externals" },
  { slug: "human-nature", label: "Human Nature", description: "Understanding others, empathy, social bonds, forgiveness, tolerance, the nature of people" },
  { slug: "knowing-yourself", label: "Knowing Yourself", description: "Self-discipline, self-awareness, honesty with oneself, personal accountability, character development" },
  { slug: "what-matters-most", label: "What Matters Most", description: "Priorities, ambition, use of time, purpose, simplicity, what to pursue and what to ignore" },
] as const;

export const VALID_TAG_SLUGS = VALID_TAGS.map((t) => t.slug);

export type TagSlug = (typeof VALID_TAGS)[number]["slug"];

export const AUTHOR_META = [
  {
    slug: "epictetus",
    name: "Epictetus",
    title: "The Slave",
    sort_order: 1,
  },
  {
    slug: "marcus-aurelius",
    name: "Marcus Aurelius",
    title: "The Emperor",
    sort_order: 2,
  },
  {
    slug: "seneca",
    name: "Seneca",
    title: "The Senator",
    sort_order: 3,
  },
] as const;

export const VALID_AUTHOR_SLUGS = AUTHOR_META.map((a) => a.slug);

export type AuthorSlug = (typeof AUTHOR_META)[number]["slug"];

export interface ChapterGrouping {
  slug: string;
  title: string;
  /** Inclusive range of section numbers in this chapter group */
  range: [number, number];
}

export interface BookConfig {
  slug: string;
  title: string;
  author_slug: AuthorSlug;
  chapter_slug_pattern: string;
  source_file: string;
  /** Regex matching chapter/book boundaries (Meditations only) */
  headerPattern?: RegExp;
  /** Regex matching section markers (Roman numeral prefixes) */
  sectionPattern: RegExp;
  /** How sections map to chapter JSON files */
  chapterGrouping: ChapterGrouping[];
  /** Whether to strip Gutenberg preamble/footer */
  gutenbergStrip: boolean;
  /** Whether source has speaker labels like [_Serenus._] to strip */
  speakerLabels: boolean;
  /** Source reference format template: {title}, {chapter}, Section {n} */
  sourceRefTemplate: string;
  /** Whether chapters are from the original text (true) or synthetic file-splitting (false) */
  hasAuthorChapters: boolean;
}

export const BOOK_CONFIGS: BookConfig[] = [
  {
    slug: "enchiridion",
    title: "The Enchiridion",
    author_slug: "epictetus",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/enchiridion.txt",
    sectionPattern: /^\s{10,}([IVXLCDMivxlcdm]+)\s*$/m,
    chapterGrouping: [
      { slug: "sections-01-10", title: "Sections 1-10", range: [1, 10] },
      { slug: "sections-11-20", title: "Sections 11-20", range: [11, 20] },
      { slug: "sections-21-30", title: "Sections 21-30", range: [21, 30] },
      { slug: "sections-31-40", title: "Sections 31-40", range: [31, 40] },
      { slug: "sections-41-53", title: "Sections 41-53", range: [41, 53] },
    ],
    gutenbergStrip: true,
    speakerLabels: false,
    sourceRefTemplate: "The Enchiridion, Section {n}",
    hasAuthorChapters: false,
  },
  {
    slug: "meditations",
    title: "Meditations",
    author_slug: "marcus-aurelius",
    chapter_slug_pattern: "book-NN",
    source_file: "source-books/meditations.txt",
    headerPattern: /^THE (FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH) BOOK$/m,
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    chapterGrouping: [
      { slug: "book-01", title: "Book 1", range: [1, 1] },
      { slug: "book-02", title: "Book 2", range: [2, 2] },
      { slug: "book-03", title: "Book 3", range: [3, 3] },
      { slug: "book-04", title: "Book 4", range: [4, 4] },
      { slug: "book-05", title: "Book 5", range: [5, 5] },
      { slug: "book-06", title: "Book 6", range: [6, 6] },
      { slug: "book-07", title: "Book 7", range: [7, 7] },
      { slug: "book-08", title: "Book 8", range: [8, 8] },
      { slug: "book-09", title: "Book 9", range: [9, 9] },
      { slug: "book-10", title: "Book 10", range: [10, 10] },
      { slug: "book-11", title: "Book 11", range: [11, 11] },
      { slug: "book-12", title: "Book 12", range: [12, 12] },
    ],
    gutenbergStrip: true,
    speakerLabels: false,
    sourceRefTemplate: "Meditations, Book {chapter}, Section {n}",
    hasAuthorChapters: true,
  },
  {
    slug: "shortness-of-life",
    title: "On the Shortness of Life",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-the-shortness-of-life.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    chapterGrouping: [
      { slug: "sections-01-07", title: "Sections 1-7", range: [1, 7] },
      { slug: "sections-08-14", title: "Sections 8-14", range: [8, 14] },
      { slug: "sections-15-20", title: "Sections 15-20", range: [15, 20] },
    ],
    gutenbergStrip: false,
    speakerLabels: false,
    sourceRefTemplate: "On the Shortness of Life, Section {n}",
    hasAuthorChapters: false,
  },
  {
    slug: "happy-life",
    title: "On the Happy Life",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-the-happy-life.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    chapterGrouping: [
      { slug: "sections-01-10", title: "Sections 1-10", range: [1, 10] },
      { slug: "sections-11-20", title: "Sections 11-20", range: [11, 20] },
      { slug: "sections-21-28", title: "Sections 21-28", range: [21, 28] },
    ],
    gutenbergStrip: false,
    speakerLabels: false,
    sourceRefTemplate: "On the Happy Life, Section {n}",
    hasAuthorChapters: false,
  },
  {
    slug: "peace-of-mind",
    title: "On Peace of Mind",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-peace-of-mind.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    chapterGrouping: [
      { slug: "sections-01-09", title: "Sections 1-9", range: [1, 9] },
      { slug: "sections-10-17", title: "Sections 10-17", range: [10, 17] },
    ],
    gutenbergStrip: false,
    speakerLabels: true,
    sourceRefTemplate: "On Peace of Mind, Section {n}",
    hasAuthorChapters: false,
  },
];

export const VALID_BOOK_SLUGS = BOOK_CONFIGS.map((b) => b.slug);
