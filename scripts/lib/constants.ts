export const VALID_TAGS = [
  { slug: "calm-your-mind", label: "Calm Your Mind" },
  { slug: "facing-fear", label: "Facing Fear" },
  { slug: "dealing-with-anger", label: "Dealing With Anger" },
  { slug: "death-and-mortality", label: "Death & Mortality" },
  { slug: "doing-the-right-thing", label: "Doing The Right Thing" },
  { slug: "self-discipline", label: "Self-Discipline" },
  { slug: "ambition-and-power", label: "Ambition & Power" },
  { slug: "leading-others", label: "Leading Others" },
  { slug: "freedom-and-control", label: "Freedom & Control" },
  { slug: "human-nature", label: "Human Nature" },
  { slug: "standing-alone", label: "Standing Alone" },
  { slug: "what-really-matters", label: "What Really Matters" },
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

export interface BookConfig {
  slug: string;
  title: string;
  author_slug: AuthorSlug;
  chapter_slug_pattern: string;
  source_file: string;
}

export const BOOK_CONFIGS: BookConfig[] = [
  {
    slug: "enchiridion",
    title: "The Enchiridion",
    author_slug: "epictetus",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/enchiridion.txt",
  },
  {
    slug: "meditations",
    title: "Meditations",
    author_slug: "marcus-aurelius",
    chapter_slug_pattern: "book-NN",
    source_file: "source-books/meditations.txt",
  },
  {
    slug: "shortness-of-life",
    title: "On the Shortness of Life",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-the-shortness-of-life.txt",
  },
  {
    slug: "happy-life",
    title: "On the Happy Life",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-the-happy-life.txt",
  },
  {
    slug: "peace-of-mind",
    title: "On Peace of Mind",
    author_slug: "seneca",
    chapter_slug_pattern: "sections-NN-NN",
    source_file: "source-books/on-peace-of-mind.txt",
  },
];

export const VALID_BOOK_SLUGS = BOOK_CONFIGS.map((b) => b.slug);
