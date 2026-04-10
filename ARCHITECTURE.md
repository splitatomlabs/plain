# Philosophy Cards — Architecture & Implementation Guide

## Project Overview

A free web app that presents classic Stoic philosophy books as bite-sized cards translated into plain English. Users read full books card by card, track their progress, and share individual cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier)
**No database.** No auth. All content is static JSON. Progress tracking uses localStorage.

For book selection, tag taxonomy, card writing guidelines, and content pipeline details, see `CONTENT_STRATEGY.md`.

---

## Data Models

### Author Model

Books are organized under three Stoic figures. This is a core UI concept, not just metadata.

```json
// src/content/authors.json
[
  {
    "slug": "epictetus",
    "name": "Epictetus",
    "title": "The Slave",
    "bio": "Born into slavery. Physically disabled. Eventually freed. He developed an entire philosophy with nothing but his own mind.",
    "sort_order": 1
  },
  {
    "slug": "marcus-aurelius",
    "name": "Marcus Aurelius",
    "title": "The Emperor",
    "bio": "Ruled the Roman Empire through plague, war, and betrayal. Wrote his reflections as a private journal never meant for anyone else to read.",
    "sort_order": 2
  },
  {
    "slug": "seneca",
    "name": "Seneca",
    "title": "The Senator",
    "bio": "One of the wealthiest men in Rome. Advisor to an emperor who eventually ordered his death. Spent his final years writing letters to help a friend think more clearly.",
    "sort_order": 3
  }
]
```

### Book Metadata Model (`_meta.json`)

```json
{
  "slug": "meditations",
  "title": "Meditations",
  "author_slug": "marcus-aurelius",
  "description": "A Roman emperor's private journal on self-discipline, duty, and finding peace in a chaotic world.",
  "tags": ["calm-your-mind", "self-discipline", "dealing-with-anger", "death-and-mortality", "doing-the-right-thing", "freedom-and-control", "what-really-matters", "leading-others", "human-nature", "facing-fear", "standing-alone"],
  "chapters": [
    { "slug": "book-01", "title": "Book 1", "card_count": 17 },
    { "slug": "book-02", "title": "Book 2", "card_count": 17 }
  ],
  "total_cards": 200,
  "source_url": "https://www.gutenberg.org/ebooks/2680"
}
```

### Card Data Model

```json
{
  "id": "meditations-05-016",
  "book_slug": "meditations",
  "chapter_slug": "book-05",
  "card_number": 16,
  "total_cards_in_chapter": 34,
  "plain_english": "The quality of your thoughts shapes the quality of your life...",
  "original_excerpt": "The happiness of your life depends upon the quality of your thoughts...",
  "source_reference": "Meditations, Book 5, Section 16",
  "author_slug": "marcus-aurelius",
  "tags": ["calm-your-mind", "self-discipline", "what-really-matters"],
  "reading_time_seconds": 30
}
```

### Tag Model

12 fixed tags defined in code. See `CONTENT_STRATEGY.md` for the full list and rationale.

```javascript
// src/lib/utils/tags.js
export const TAGS = [
  { slug: 'calm-your-mind', label: 'Calm Your Mind' },
  { slug: 'facing-fear', label: 'Facing Fear' },
  { slug: 'dealing-with-anger', label: 'Dealing With Anger' },
  { slug: 'death-and-mortality', label: 'Death & Mortality' },
  { slug: 'doing-the-right-thing', label: 'Doing The Right Thing' },
  { slug: 'self-discipline', label: 'Self-Discipline' },
  { slug: 'ambition-and-power', label: 'Ambition & Power' },
  { slug: 'leading-others', label: 'Leading Others' },
  { slug: 'freedom-and-control', label: 'Freedom & Control' },
  { slug: 'human-nature', label: 'Human Nature' },
  { slug: 'standing-alone', label: 'Standing Alone' },
  { slug: 'what-really-matters', label: 'What Really Matters' }
];
```

---

## Content File Structure

One JSON file per chapter/section. This keeps individual file reads small (typically 10–40KB) even though total card count will be 400+.

```
src/content/
├── authors.json
├── enchiridion/
│   ├── _meta.json
│   ├── sections-01-10.json
│   ├── sections-11-20.json
│   └── ...
├── meditations/
│   ├── _meta.json
│   ├── book-01.json
│   ├── book-02.json
│   └── ...                     # 12 chapter files
├── letters/
│   ├── _meta.json
│   ├── letters-01-05.json      # Grouped by letter selection
│   ├── letters-06-10.json
│   └── ...
└── shortness-of-life/
    ├── _meta.json
    ├── sections-01-07.json
    ├── sections-08-14.json
    └── sections-15-20.json
```

---

## Route Structure

```
/                              → Home: three-column author layout with books and progress
/[book]                        → Book landing page: chapter list, progress ring, description
/[book]/[chapter]/[card]       → Individual card view (the core reading experience)
/tags                          → Tag index (all 12 tags)
/tags/[tag]                    → Cross-book card feed filtered by tag, grouped by author
/completed/[book]              → Completion celebration page
```

### Rendering Strategy

**Pre-render at build time** (small number of stable pages):
- `/` (home)
- `/tags` and all 12 `/tags/[tag]` pages
- All 4 `/[book]` landing pages

**ISR for card pages** (hundreds of pages, avoids long builds):

`/[book]/[chapter]/[card]` routes use Incremental Static Regeneration via Vercel's adapter. First visit triggers a server render, result is cached at the edge globally. Subsequent visitors get cached static HTML.

```javascript
// src/routes/[book]/[chapter]/[card]/+page.server.js
import { getCard, getBookMeta, getAdjacentCard } from '$lib/utils/content.js';
import { error } from '@sveltejs/kit';

export const config = {
  isr: {
    expiration: 86400 // revalidate daily — content rarely changes
  }
};

export async function load({ params }) {
  const { book, chapter, card } = params;
  const meta = await getBookMeta(book);
  const cardData = await getCard(book, chapter, parseInt(card));

  if (!cardData) {
    throw error(404, 'Card not found');
  }

  return {
    card: cardData,
    book: meta,
    prevCard: await getAdjacentCard(book, chapter, parseInt(card), -1),
    nextCard: await getAdjacentCard(book, chapter, parseInt(card), 1)
  };
}
```

**Why not full static generation:** With 400+ card pages, build times grow linearly. ISR keeps builds fast (only structural pages are pre-rendered) while still serving cached static HTML to end users. Card content is loaded server-side from JSON files — the browser never downloads full chapter files.

---

## Progress Tracking (localStorage)

No auth. No backend. All state lives in the browser.

### localStorage Schema

```javascript
// Key: "stoic-cards-progress"
{
  "meditations": {
    "cards_read": ["meditations-01-001", "meditations-01-002", "meditations-05-016"],
    "last_card": "meditations-05-016",
    "last_read_at": "2026-04-10T09:30:00Z",
    "completed": false,
    "completed_at": null
  },
  "enchiridion": {
    "cards_read": [],
    "last_card": null,
    "last_read_at": null,
    "completed": false,
    "completed_at": null
  }
  // ... one entry per book
}

// Key: "stoic-cards-favorites"
["meditations-05-016", "letters-03-012", "enchiridion-01-008"]
```

### Progress Store (Svelte)

```javascript
// src/lib/stores/progress.js
// Writable Svelte store that syncs to/from localStorage.
// Exposes:
//   - markCardRead(bookSlug, cardId)
//   - getProgress(bookSlug) → { cardsRead, totalCards, percentage, lastCard }
//   - toggleFavorite(cardId)
//   - isFavorite(cardId)
//   - getLastReadBook() → bookSlug or null (for "continue reading" UX)
//   - isCompleted(bookSlug)
//   - markCompleted(bookSlug)
```

### Progress Logic

- A card is marked "read" when the user navigates to the next card (not on page load).
- Progress percentage = `cards_read.length / total_cards * 100` (total from `_meta.json`).
- "Continue where you left off" uses `last_card` to deep-link back to exact position.
- Milestone thresholds: 25%, 50%, 75%, 100%. Trigger a `MilestoneModal` at each.
- At 100%: redirect to `/completed/[book]`.

### Returning User Experience

1. If they have an in-progress book → show "Continue reading" prominently with book name, author, progress %, and a single tap to resume.
2. If no progress → show the three-author layout with book descriptions.
3. Never show a generic homepage if there's active reading state.

---

## Sharing System

Three mechanisms. See `CONTENT_STRATEGY.md` for messaging guidelines.

### 1. Single Card Share

Every card page has a share button. Uses the Web Share API where available (mobile), with clipboard fallback for desktop.

**Shared URL:** card permalink, e.g. `/meditations/book-05/16`

**Open Graph meta tags** (generated server-side per card via ISR):
```html
<meta property="og:title" content="Meditations, Book 5.16 — In Plain English" />
<meta property="og:description" content="[First ~150 chars of plain_english text]" />
<meta property="og:image" content="/api/og/meditations-05-016" />
<meta property="og:type" content="article" />
```

**OG image generation:** Use `@vercel/og` to generate card images on-demand via a serverless route at `/api/og/[cardId]`. Renders the plain English text on a clean background with source attribution. Cache aggressively. No logos or branding clutter.

**Landing experience for the recipient:**
- Card is fully readable immediately. No sign-up gate.
- Below the card: "This is card 47 of 120 from Meditations. Start from the beginning?" with a single CTA.

### 2. Completion Share

On the `/completed/[book]` page, offer a generated image:
- "I just read all of [Book Title] — in plain English"
- Generated via the same `@vercel/og` route.
- Suitable for LinkedIn, Twitter, Instagram Stories.
- Entirely opt-in.

### 3. Gift a Book

On each book landing page, "Send this book to a friend":
- Generates a link with an optional personal note encoded in the URL.
- URL format: `/[book]?gift=true&note=base64encodednote`
- Recipient sees: the note, the book description, the author bio, and "Start reading."
- No database needed.

---

## Card Reading UI

### Core Card View

The most important screen. Must feel calm, focused, and book-like.

- **Layout:** Single card centered. Plain English text is primary. Original excerpt below in smaller muted text (collapsible via a "Show original" toggle). Source reference at bottom.
- **Navigation:** Swipe left/right or tap screen edges for next/previous. Keyboard arrow keys on desktop. Clear "next" affordance on the right side.
- **Tags:** Small pills below the card text. Tappable — navigates to `/tags/[tag]`.
- **Progress:** Thin progress bar at top of screen or subtle "47 / 120" indicator. Not dominant.
- **Actions:** Share button, favorite (heart) button. Minimal chrome.
- **Author context:** Small author name + title ("Marcus Aurelius — The Emperor") at top of card. Reinforces the three-voices framing without being heavy.

### Typography

- High-quality serif or humanist font for card text (e.g., Lora, Literata, Source Serif Pro, or Newsreader from Google Fonts). Self-host via `@fontsource`.
- Body text: 18–20px on mobile.
- Line height: ~1.6. Max line width: ~65 characters.
- High contrast but not stark white — subtle warm or cream background.

### Color & Theme

- Default: warm, paper-like light theme. "Well-made book" not "tech app."
- Optional dark mode: feels like reading by lamplight, not a code editor.
- Each author gets a subtle accent color used for progress rings, chapter headings, and author labels. Keep it restrained — the text is the focus.

### Home Page Layout

Organized by the three authors, not as a flat book list:

```
[Hero: "Three men. Three completely different lives. The same philosophy."]

[The Slave — Epictetus]
  [bio]
  [The Enchiridion — progress ring — CTA]

[The Emperor — Marcus Aurelius]
  [bio]
  [Meditations — progress ring — CTA]

[The Senator — Seneca]
  [bio]
  [Letters to Lucilius — progress ring — CTA]
  [On the Shortness of Life — progress ring — CTA]
```

If a returning user has an in-progress book, overlay a "Continue reading" banner at the top that links directly to their last card.

---

## Project Setup

### SvelteKit Config

```javascript
// svelte.config.js
import adapter from '@sveltejs/adapter-vercel';

export default {
  kit: {
    adapter: adapter({
      runtime: 'nodejs22.x'
    }),
    prerender: {
      entries: [
        '/',
        '/tags',
        '/tags/calm-your-mind',
        '/tags/facing-fear',
        '/tags/dealing-with-anger',
        '/tags/death-and-mortality',
        '/tags/doing-the-right-thing',
        '/tags/self-discipline',
        '/tags/ambition-and-power',
        '/tags/leading-others',
        '/tags/freedom-and-control',
        '/tags/human-nature',
        '/tags/standing-alone',
        '/tags/what-really-matters',
        '/enchiridion',
        '/meditations',
        '/letters',
        '/shortness-of-life'
      ]
    }
  }
};
```

### Key Dependencies

- `@sveltejs/adapter-vercel` — Vercel deployment with ISR support
- `@fontsource/lora` (or chosen serif font) — Self-hosted reading font
- `@vercel/og` — OG image generation for sharing
- No UI framework. Custom CSS. Minimal.
- No database libraries. No auth libraries. Not yet.

### Folder Structure

```
src/
├── content/                    # All JSON content files (see Content File Structure above)
├── lib/
│   ├── stores/
│   │   └── progress.js         # Svelte store wrapping localStorage
│   ├── components/
│   │   ├── Card.svelte         # Core card reading component
│   │   ├── CardNav.svelte      # Swipe/tap navigation between cards
│   │   ├── ProgressRing.svelte # Circular progress indicator
│   │   ├── ProgressBar.svelte  # Thin bar for card reading view
│   │   ├── TagPill.svelte      # Small tappable tag
│   │   ├── MilestoneModal.svelte # Celebration interstitial
│   │   ├── ShareButton.svelte  # Web Share API with clipboard fallback
│   │   ├── BookCard.svelte     # Book preview card for home page
│   │   ├── AuthorSection.svelte # Author bio + books group for home page
│   │   └── GiftBanner.svelte   # Gift note display for recipients
│   └── utils/
│       ├── content.js          # Load and query card/book/author JSON
│       └── tags.js             # Tag definitions and helpers
├── routes/
│   ├── +page.svelte            # Home: three-author layout
│   ├── +page.server.js         # Load all book metadata + authors
│   ├── +layout.svelte          # Root layout (minimal nav, theme toggle)
│   ├── api/
│   │   └── og/
│   │       └── [cardId]/
│   │           └── +server.js  # OG image generation endpoint
│   ├── tags/
│   │   ├── +page.svelte        # Tag index
│   │   ├── +page.server.js     # Load all tags with card counts
│   │   └── [tag]/
│   │       ├── +page.svelte    # Cards by tag, grouped by author
│   │       └── +page.server.js # Load cards matching tag across all books
│   ├── completed/
│   │   └── [book]/
│   │       ├── +page.svelte    # Completion celebration + share
│   │       └── +page.server.js # Load book meta for completion page
│   └── [book]/
│       ├── +page.svelte        # Book landing page
│       ├── +page.server.js     # Load _meta.json
│       └── [chapter]/
│           └── [card]/
│               ├── +page.svelte        # Card reading view
│               └── +page.server.js     # Load chapter JSON, extract card, ISR config
└── static/
    └── fonts/                  # Self-hosted fonts if not using @fontsource
```

---

## Future Additions (Not for v1)

Out of scope for launch. Architecture decisions should not block these.

- **User auth + cross-device sync** → Add Supabase (free tier). The localStorage schema maps directly to a database table.
- **Search** → Client-side full-text search with a pre-built index (e.g., Fuse.js or Pagefind).
- **More books** → Adding a book means adding a `_meta.json` and chapter JSON files. No code changes needed.
- **AI-assisted content pipeline** → Use Claude API to help translate new books. Content pipeline tool, not user-facing.
- **PWA / offline support** → SvelteKit has service worker support. Add when daily usage patterns emerge.
- **Native iOS app** → Consider when strong daily return usage is proven on web.

---

## Design Principles

1. **The text is the product.** Every design decision should make the words easier and more pleasant to read. If a UI element doesn't serve the reading experience, remove it.
2. **Feel like a book, not an app.** Warm, calm, typographically rich. No dashboards, no metrics overload, no gamification beyond milestone celebrations.
3. **Three voices, one philosophy.** The slave/emperor/senator framing is the product's identity. Use it in the home page structure, tag exploration, and completion messaging.
4. **Sharing is giving.** Every share mechanism delivers immediate value to the recipient. No sign-up walls, no gates.
5. **Progress, not pressure.** Track progress to build momentum, not obligation. No streaks. No guilt. The Stoics would not approve of anxiety-driven engagement.
6. **Start simple, earn complexity.** localStorage before databases. JSON files before CMS. Free tier before paid infrastructure. Add complexity only when real user behavior demands it.
