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
- **Content lives at root `content/` directory** (not inside `web/`). This is the canonical data layer shared by all apps, tests, and scripts. The SvelteKit app accesses it via a Vite alias (`$content` → `../../content`). This means the same JSON files serve as both fixture data for tests and production data for the web app. Future apps or tools can import from `content/` without depending on the web app.
- `src/lib/utils/content.js` loads JSON via the `$content` alias (Vite resolves to `content/` at project root). Functions are synchronous at build time, used in `+page.server.js` load functions.
- Home page shows new-visitor layout only in this plan (Marcus Aurelius first, per ARCHITECTURE.md). Returning-reader layout comes in Plan 04 when progress store exists.
- Tag pages load cards across all books — grouped by author in Slave → Emperor → Senator order.
- All pages are pre-rendered at build time (card pages with ISR come in Plan 03).

## Files
Content JSON files live at the repo root `content/` directory. All other paths are relative to `web/`.

**Root-level content (`content/`)**
- `content/authors.json` — 3 authors per ARCHITECTURE.md data model
- `content/meditations/_meta.json` + 2 chapter files (3 cards each) — Fixture data
- `content/enchiridion/_meta.json` + 2 chapter files — Fixture data
- `content/shortness-of-life/_meta.json` + 2 chapter files — Fixture data
- `content/happy-life/_meta.json` + 2 chapter files — Fixture data
- `content/peace-of-mind/_meta.json` + 2 chapter files — Fixture data

**Web app (`web/`)**
- `web/vite.config.js` — Add `$content` alias pointing to `../../content`
- `src/lib/utils/content.js` — getAuthors, getBookMeta, getBooks, getBooksForAuthor, getCard, getChapterCards, getAdjacentCard, getCardsByTag, getAllCards (imports via `$content` alias)
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
- `playwright.config.js` — Playwright config with webServer, viewport projects
- `tests/unit/content.test.js` — Unit tests for content utilities
- `tests/unit/tags.test.js` — Unit tests for tag helpers
- `tests/e2e/home-page.spec.js` — E2E home page (new visitor layout)

## Constraints
- Content JSON lives in root `content/` directory — the web app must never duplicate or copy these files into `web/`
- Book slugs must match: `meditations`, `enchiridion`, `shortness-of-life`, `happy-life`, `peace-of-mind`
- Card IDs follow `{book}-{chapter}-{number}` format (e.g., `meditations-01-001`)
- Tag slugs are the 12 fixed values from ARCHITECTURE.md — no dynamic tags
- Home page leads with Marcus Aurelius for new visitors (highest name recognition)
- Tag pages and all other multi-author views use Slave → Emperor → Senator order
- All pages must render correctly at 375px mobile and 1280px desktop

## Tasks
- [x] T01: Create authors.json — Write `content/authors.json` (repo root) with the 3 authors per ARCHITECTURE.md. Fields: slug, name, title, bio, sort_order. Verify JSON is valid.
- [x] T02: Create fixture content files — Hand-write (not scripted) minimal fixture JSON for all 5 books under `content/`. Each book gets: `_meta.json` per ARCHITECTURE.md model, 2 chapter files with 3 cards each. 30 total cards across 5 books. Cards follow the full data model (id, book_slug, chapter_slug, card_number, total_cards_in_chapter, plain_english, original_excerpt, source_reference, author_slug, tags, reading_time_seconds). Use short plausible Stoic-flavoured text, not lorem ipsum. Each card gets 1–3 tags from the 12 fixed tags. Enough to test routing, navigation, cross-chapter transitions, tag filtering, and progress logic.
- [x] T03: Verify fixture content — Spot-check JSON: valid structure, IDs follow `{book}-{chapter}-{number}` format, _meta.json card counts match chapter files, tags are valid slugs.
- [x] T04: Configure `$content` Vite alias — Add a `resolve.alias` entry in `web/vite.config.js` mapping `$content` to the root `content/` directory. Verify the alias resolves correctly in both dev and build modes.
- [x] T05: Build content.js utilities — Create `src/lib/utils/content.js` with functions: `getAuthors()`, `getBookMeta(bookSlug)`, `getBooks()` (all books sorted by author sort_order), `getBooksForAuthor(authorSlug)`, `getCard(bookSlug, chapterSlug, cardNumber)`, `getChapterCards(bookSlug, chapterSlug)`, `getAdjacentCard(bookSlug, chapterSlug, cardNumber, direction)`, `getCardsByTag(tagSlug)`, `getAllCards()`. Imports JSON via the `$content` alias. Throws 404-appropriate errors for invalid slugs.
- [x] T06: Build tags.js — Create `src/lib/utils/tags.js` with TAGS array (12 tags per ARCHITECTURE.md), `getTagBySlug(slug)`, `getTagsForBook(bookSlug)` (returns tags that appear in that book's _meta.json). Export TAGS for use in prerender config.
- [x] T07: Install test dependencies and configure Vitest — Add Vitest to devDependencies. Configure in `vite.config.js` or `vitest.config.js`. Add `test:unit` script to `package.json`. Install Playwright and `@axe-core/playwright` as devDependencies. Create `playwright.config.js`: `webServer` config to auto-start preview server, projects for `desktop-chrome` and `mobile-chrome` (375×812 viewport), `testDir` set to `tests/`. Ensure `npx playwright test` script works. This sets up the full test infrastructure for this plan and all subsequent plans.
- [x] T08: Unit tests for content utilities — `tests/unit/content.test.js`: test `getAuthors()` returns 3 authors in correct order, `getBookMeta('meditations')` returns valid metadata, `getBookMeta('nonexistent')` throws, `getCard('meditations', 'book-01', 1)` returns correct card shape, `getAdjacentCard` handles chapter boundaries and book start/end, `getCardsByTag` returns cards grouped correctly, `getAllCards()` returns all cards. Tests import from `content/` directly (no Vite alias needed — use relative paths or a test alias).
- [x] T09: Unit tests for tags — `tests/unit/tags.test.js`: test TAGS has 12 entries, each has slug and label, `getTagBySlug` returns correct tag, `getTagBySlug('nonexistent')` returns undefined, `getTagsForBook` returns subset matching book's _meta.json tags.
- [x] T10: Build TagPill component — Create `src/lib/components/TagPill.svelte`. Renders a small pill with tag label, links to `/tags/{slug}`. Styled per BRANDING.md: tag-bg background, tertiary text color, 13px DM Sans, rounded corners, hover state. Meets 44×44px min touch target on mobile (via padding).
- [x] T11: Build AuthorSection and BookCard components — `AuthorSection.svelte`: renders author name, title (e.g., "The Emperor"), bio text, and a list of BookCard components for that author's books. Uses author accent color for title. `BookCard.svelte`: renders book title, description (truncated to 2 lines), tag pills, and "Start Reading" CTA button. Responsive: stacks vertically on mobile, can sit side-by-side on desktop within an author section.
- [x] T12: Build home page (new visitor layout) — Update `src/routes/+page.svelte` and create `+page.server.js`. Hero section with "Three men. Three completely different lives. The same philosophy." Below: three AuthorSection components — Marcus Aurelius first (highest recognition for new visitors), then Epictetus, then Seneca. Load all authors and books in server load function. Responsive: single column on mobile, wider layout on desktop. Semantic HTML: `<main>`, `<section>` per author, proper heading hierarchy.
- [x] T13: Build book landing page — Create `src/routes/[book]/+page.svelte` and `+page.server.js`. Displays: book title, author name + title, description, tag pills, chapter list with card counts, "Start Reading" CTA. Server load validates book slug (404 if invalid). Responsive layout. Add book slugs to prerender entries in svelte.config.js.
- [x] T14: Build tag pages — Create `src/routes/tags/+page.svelte` + `+page.server.js` (tag index: grid of all 12 tags with card counts per tag). Create `src/routes/tags/[tag]/+page.svelte` + `+page.server.js` (cards matching tag, grouped by author in Slave → Emperor → Senator order, each card showing plain_english preview + source reference + link to card page). Validate tag slug (404 if invalid). Add all tag routes to prerender entries.
- [x] T15: E2E home page tests (new visitor) — `tests/e2e/home-page.spec.js`: fresh visit (clear localStorage) → verify new-visitor layout with Marcus Aurelius first, three author sections visible, "Start Reading" CTAs work. Test at both mobile and desktop viewports.
- [~] T16: Verify all static pages — Run `npm run build`, confirm all prerendered pages generate without errors. Run `npm run preview`, run full unit test suite (`npm run test:unit`) and Playwright E2E tests (`npx playwright test`). Fix any failures before completing this plan.

## Verify
```bash
cd web && npm run test:unit
cd web && npm run build && npx playwright test
```
