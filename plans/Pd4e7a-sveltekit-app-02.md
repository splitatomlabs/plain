# Plan 02: Content Layer & Static Pages

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Depends on
- `plans/Pd4e7a-sveltekit-app-01.md` — needs SvelteKit project, layout, design tokens

## Objective
Create the content JSON files, content loading utilities, tag system, and all static pages: home page (new visitor layout), book landing pages, and tag pages.

## Decisions
- All content is placeholder fixture data. The existing `output/chunks/` files use a different structure (flat chunker output, not section-aligned cards) and cannot be cleanly mapped to the ARCHITECTURE.md card data model. Real content will come from a future content pipeline that produces properly structured cards.
- Minimal fixture data: 2 chapters per book, 3 cards per chapter (30 total cards across 5 books). Enough to exercise all routing, navigation, cross-chapter transitions, tag filtering, and progress logic without generating excessive JSON.
- `src/lib/utils/content.js` loads JSON via static imports (Vite handles bundling). Functions are synchronous at build time, used in `+page.server.js` load functions.
- Home page shows new-visitor layout only in this plan (Marcus Aurelius first, per ARCHITECTURE.md). Returning-reader layout comes in Plan 04 when progress store exists.
- Tag pages load cards across all books — grouped by author in Slave → Emperor → Senator order.
- All pages are pre-rendered at build time (card pages with ISR come in Plan 03).

## Files
All paths relative to `web/`.
- `src/content/authors.json` — 3 authors per ARCHITECTURE.md data model
- `src/content/meditations/_meta.json` + 2 chapter files (3 cards each) — Fixture data
- `src/content/enchiridion/_meta.json` + 2 chapter files — Fixture data
- `src/content/shortness-of-life/_meta.json` + 2 chapter files — Fixture data
- `src/content/happy-life/_meta.json` + 2 chapter files — Fixture data
- `src/content/peace-of-mind/_meta.json` + 2 chapter files — Fixture data
- `src/lib/utils/content.js` — getAuthors, getBookMeta, getBooks, getBooksForAuthor, getCard, getChapterCards, getAdjacentCard, getCardsByTag, getAllCards
- `src/lib/utils/tags.js` — TAGS array, getTagBySlug, getTagsForBook helpers
- `src/routes/+page.svelte` — Home page: three-author layout (new visitor version)
- `src/routes/+page.server.js` — Load authors + all book metadata
- `src/lib/components/AuthorSection.svelte` — Author bio + book list for home page
- `src/lib/components/BookCard.svelte` — Book preview card (title, description, tag pills, CTA)
- `src/lib/components/TagPill.svelte` — Small tappable tag pill component
- `src/routes/[book]/+page.svelte` — Book landing page: description, chapter list, tag pills
- `src/routes/[book]/+page.server.js` — Load _meta.json, validate book slug
- `src/routes/tags/+page.svelte` — Tag index: all 12 tags with card counts
- `src/routes/tags/+page.server.js` — Load tags with card counts across all books
- `src/routes/tags/[tag]/+page.svelte` — Cards filtered by tag, grouped by author
- `src/routes/tags/[tag]/+page.server.js` — Load matching cards, group by author

## Constraints
- Book slugs must match: `meditations`, `enchiridion`, `shortness-of-life`, `happy-life`, `peace-of-mind`
- Card IDs follow `{book}-{chapter}-{number}` format (e.g., `meditations-01-001`)
- Tag slugs are the 12 fixed values from ARCHITECTURE.md — no dynamic tags
- Home page leads with Marcus Aurelius for new visitors (highest name recognition)
- Tag pages and all other multi-author views use Slave → Emperor → Senator order
- All pages must render correctly at 375px mobile and 1280px desktop

## Tasks
- [ ] T01: Create authors.json — Write `src/content/authors.json` with the 3 authors per ARCHITECTURE.md. Fields: slug, name, title, bio, sort_order. Verify JSON is valid.
- [ ] T02: Create fixture content files — Hand-write (not scripted) minimal fixture JSON for all 5 books. Each book gets: `_meta.json` per ARCHITECTURE.md model, 2 chapter files with 3 cards each. 30 total cards across 5 books. Cards follow the full data model (id, book_slug, chapter_slug, card_number, total_cards_in_chapter, plain_english, original_excerpt, source_reference, author_slug, tags, reading_time_seconds). Use short plausible Stoic-flavoured text, not lorem ipsum. Each card gets 1–3 tags from the 12 fixed tags. Enough to test routing, navigation, cross-chapter transitions, tag filtering, and progress logic.
- [ ] T03: Verify fixture content — Spot-check JSON: valid structure, IDs follow `{book}-{chapter}-{number}` format, _meta.json card counts match chapter files, tags are valid slugs.
- [ ] T04: Build content.js utilities — Create `src/lib/utils/content.js` with functions: `getAuthors()`, `getBookMeta(bookSlug)`, `getBooks()` (all books sorted by author sort_order), `getBooksForAuthor(authorSlug)`, `getCard(bookSlug, chapterSlug, cardNumber)`, `getChapterCards(bookSlug, chapterSlug)`, `getAdjacentCard(bookSlug, chapterSlug, cardNumber, direction)`, `getCardsByTag(tagSlug)`, `getAllCards()`. Uses dynamic imports to load JSON. Throws 404-appropriate errors for invalid slugs.
- [ ] T05: Build tags.js — Create `src/lib/utils/tags.js` with TAGS array (12 tags per ARCHITECTURE.md), `getTagBySlug(slug)`, `getTagsForBook(bookSlug)` (returns tags that appear in that book's _meta.json). Export TAGS for use in prerender config.
- [ ] T06: Build TagPill component — Create `src/lib/components/TagPill.svelte`. Renders a small pill with tag label, links to `/tags/{slug}`. Styled per BRANDING.md: tag-bg background, tertiary text color, 13px DM Sans, rounded corners, hover state. Meets 44×44px min touch target on mobile (via padding).
- [ ] T07: Build AuthorSection and BookCard components — `AuthorSection.svelte`: renders author name, title (e.g., "The Emperor"), bio text, and a list of BookCard components for that author's books. Uses author accent color for title. `BookCard.svelte`: renders book title, description (truncated to 2 lines), tag pills, and "Start Reading" CTA button. Responsive: stacks vertically on mobile, can sit side-by-side on desktop within an author section.
- [ ] T08: Build home page (new visitor layout) — Update `src/routes/+page.svelte` and create `+page.server.js`. Hero section with "Three men. Three completely different lives. The same philosophy." Below: three AuthorSection components — Marcus Aurelius first (highest recognition for new visitors), then Epictetus, then Seneca. Load all authors and books in server load function. Responsive: single column on mobile, wider layout on desktop. Semantic HTML: `<main>`, `<section>` per author, proper heading hierarchy.
- [ ] T09: Build book landing page — Create `src/routes/[book]/+page.svelte` and `+page.server.js`. Displays: book title, author name + title, description, tag pills, chapter list with card counts, "Start Reading" CTA. Server load validates book slug (404 if invalid). Responsive layout. Add book slugs to prerender entries in svelte.config.js.
- [ ] T10: Build tag pages — Create `src/routes/tags/+page.svelte` + `+page.server.js` (tag index: grid of all 12 tags with card counts per tag). Create `src/routes/tags/[tag]/+page.svelte` + `+page.server.js` (cards matching tag, grouped by author in Slave → Emperor → Senator order, each card showing plain_english preview + source reference + link to card page). Validate tag slug (404 if invalid). Add all tag routes to prerender entries.
- [ ] T11: Verify all static pages — Run `npm run build`, confirm all prerendered pages generate without errors. Run `npm run preview`, manually verify: home page layout at mobile + desktop, all 5 book landing pages load, tag index shows counts, at least one tag detail page shows cards grouped by author. Check semantic HTML in browser dev tools.

## Verify
```bash
cd web && npm run build
cd web && npm run preview
cd web && npm run test:unit
```
