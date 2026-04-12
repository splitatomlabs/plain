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
  description: string;
  source_url: string;
  chapter_slug_pattern: string;
  source_file: string;
  /** Regex matching chapter/book boundaries (e.g. Meditations, On Anger) */
  headerPattern?: RegExp;
  /** Regex matching ALL-CAPS discourse headings with em-dash (Discourses only) */
  headingPattern?: RegExp;
  /** Regex matching section markers (Roman numeral prefixes) */
  sectionPattern?: RegExp;
  /** How sections are split: 'inline' for Roman numerals at line start, 'centered' for indented standalone Roman numerals */
  sectionSplitMode?: "inline" | "centered";
  /** How sections map to chapter JSON files; omit for flat books where each section is its own chapter */
  chapterGrouping?: ChapterGrouping[];
  /** Whether to strip Gutenberg preamble/footer */
  gutenbergStrip: boolean;
  /** Whether source has speaker labels like [_Serenus._] to strip */
  speakerLabels: boolean;
  /** Whether the book has meaningful author-defined chapters (not editorial splits) */
  has_chapters?: boolean;
  /** Regex to strip trailing content (footnotes, publisher info) from the last section */
  trailingContentPattern?: RegExp;
  /** Regex to find the start of actual content (strips preamble before first match) */
  preamblePattern?: RegExp;
  /** Source reference format template: {title}, {chapter}, Section {n} */
  sourceRefTemplate: string;
}

export const BOOK_CONFIGS: BookConfig[] = [
  {
    slug: "enchiridion",
    title: "The Enchiridion",
    author_slug: "epictetus",
    description: "A former slave's handbook for living free — even when everything around you is out of your control.",
    source_url: "https://www.gutenberg.org/ebooks/45109",
    chapter_slug_pattern: "section-NN",
    source_file: "content/source/enchiridion.txt",
    sectionPattern: /^\s{10,}([IVXLCDMivxlcdm]+)\s*$/m,
    sectionSplitMode: "centered",

    gutenbergStrip: true,
    speakerLabels: false,
    trailingContentPattern: /\n\s*Footnotes\s*\n/,
    sourceRefTemplate: "The Enchiridion, Section {n}",
  },
  {
    slug: "meditations",
    title: "Meditations",
    author_slug: "marcus-aurelius",
    description: "A Roman emperor's private journal on self-discipline, duty, and finding peace in a chaotic world.",
    source_url: "https://www.gutenberg.org/ebooks/2680",
    chapter_slug_pattern: "book-NN",
    source_file: "content/source/meditations.txt",
    headerPattern: /^THE (FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH) BOOK$/m,
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sectionSplitMode: "inline",
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
  },
  {
    slug: "shortness-of-life",
    title: "On the Shortness of Life",
    author_slug: "seneca",
    description: "Seneca's most urgent essay — a wake-up call about how we waste our lives on things that don't matter.",
    source_url: "https://www.gutenberg.org/ebooks/64576",
    chapter_slug_pattern: "section-NN",
    source_file: "content/source/on-the-shortness-of-life.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sectionSplitMode: "inline",

    gutenbergStrip: false,
    speakerLabels: false,
    trailingContentPattern: /\n\s*\[\d+\]\s/,
    preamblePattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sourceRefTemplate: "On the Shortness of Life, Section {n}",
  },
  {
    slug: "happy-life",
    title: "On the Happy Life",
    author_slug: "seneca",
    description: "Seneca answers his critics — can you preach simplicity while living in luxury? His answer is more honest than you'd expect.",
    source_url: "https://www.gutenberg.org/ebooks/64576",
    chapter_slug_pattern: "section-NN",
    source_file: "content/source/on-the-happy-life.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sectionSplitMode: "inline",

    gutenbergStrip: false,
    speakerLabels: false,
    trailingContentPattern: /\n\s*\[\d+\]\s/,
    preamblePattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sourceRefTemplate: "On the Happy Life, Section {n}",
  },
  {
    slug: "peace-of-mind",
    title: "On Peace of Mind",
    author_slug: "seneca",
    description: "A letter to a restless friend — practical advice on finding calm without withdrawing from life.",
    source_url: "https://www.gutenberg.org/ebooks/64576",
    chapter_slug_pattern: "section-NN",
    source_file: "content/source/on-peace-of-mind.txt",
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sectionSplitMode: "inline",

    gutenbergStrip: false,
    speakerLabels: true,
    trailingContentPattern: /\n\s*\[\d+\]\s/,
    preamblePattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sourceRefTemplate: "On Peace of Mind, Section {n}",
  },
  {
    slug: "discourses",
    title: "Discourses",
    author_slug: "epictetus",
    description: "25 discourses from the four books of Epictetus's teachings, as recorded by his student Arrian. Practical lessons on what you can control, how to handle hardship, and what philosophy is actually for.",
    source_url: "https://www.gutenberg.org/ebooks/10661",
    chapter_slug_pattern: "discourse-slug",
    source_file: "content/source/discourses.txt",
    headingPattern: /^([A-Z][A-Z ,.':()]+)\.?—/m,
    gutenbergStrip: true,
    speakerLabels: false,
    preamblePattern: /^A SELECTION FROM THE DISCOURSES OF EPICTETUS\.\s*$/m,
    trailingContentPattern: /^THE ENCHEIRIDION, OR MANUAL\.\s*$/m,
    sourceRefTemplate: "Discourses, {chapter_title}, Section {n}",
  },
  {
    slug: "on-anger",
    title: "On Anger",
    author_slug: "seneca",
    description: "Seneca dissects anger from every angle — what causes it, why it's destructive, and how to prevent it. Full of concrete examples and psychological insight.",
    source_url: "https://www.gutenberg.org/ebooks/64576",
    chapter_slug_pattern: "book-NN",
    source_file: "content/source/on-anger.txt",
    headerPattern: /^Book ([IVX]+)\.$/m,
    sectionPattern: /^([IVXLCDMivxlcdm]+)\.\s/m,
    sectionSplitMode: "inline",
    chapterGrouping: [
      { slug: "book-1", title: "Book 1", range: [1, 1] },
      { slug: "book-2", title: "Book 2", range: [2, 2] },
      { slug: "book-3", title: "Book 3", range: [3, 3] },
    ],
    gutenbergStrip: false,
    speakerLabels: false,
    has_chapters: true,
    trailingContentPattern: /\n\s*\[\d+\]\s/,
    sourceRefTemplate: "On Anger, Book {chapter}, Section {n}",
  },
];

export const VALID_BOOK_SLUGS = BOOK_CONFIGS.map((b) => b.slug);
