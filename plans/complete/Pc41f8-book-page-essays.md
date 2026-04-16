# Book Landing Page — Improved for All Books

## Objective
Redesign the book landing page for both book types: remove the meaningless section list for essay-style books and add per-chapter progress, scope line, and better CTA placement for chapter-style books (Meditations).

## Decisions

### Essay-style books (Enchiridion, Shortness of Life, Happy Life, Peace of Mind)
- **Remove the section list.** "Section 1 — 1 card, Section 2 — 1 card, ... Section 51 — 1 card" is noise. Removed entirely when `has_chapters` is false (flag from Pb3e7a plan; until that runs, derive from `book.slug !== 'meditations'`).
- **Move CTA up immediately after the description.** "Start Reading" (or "Continue" for returning readers) is the first thing after the book header.
- **Show scope: card count + estimated reading time.** "69 cards · ~20 min read" below the description gives a sense of commitment.
- **Preview the opening card.** First card's `plain_english` text as a teaser below the CTA — muted card preview, tappable, links to the first card.
- **Progress bar moves up for returning readers.** Progress bar and "Continue" button prominently after the header, before the preview.

### Chapter-style books (Meditations)
- **Chapters are NOT hyperlinks.** They remain a visual reference showing structure and progress — not a navigation tool. Reading is linear; the CTA handles navigation. Avoids overwriting the reader's `resume_url` if they tap a different chapter.
- **Per-chapter progress on each row.** Show a subtle fill bar and "15 / 27" on each chapter row. Completed chapters get a muted checkmark. Turns the chapter list into a progress dashboard.
- **Scope line.** "514 cards · ~2 hr 45 min read" below the description. Even more important for a big book — sets expectations.
- **Move CTA above the chapter list.** "Start Reading" / "Continue" + progress bar appear right after the header. The chapter list is reference material below, not a gate.

### Shared
- **Total reading time added to `_meta.json`.** Sum `reading_time_seconds` during assembly. Avoids calculating at render time.
- **Visual verification via Playwright screenshots at each milestone.**

## Files
- `scripts/lib/types.ts` — add `total_reading_time_seconds: number` to `BookMeta`
- `scripts/lib/assembler.ts` — sum `reading_time_seconds` across all cards, write to meta
- `content/output/*/_meta.json` — regenerated with new field
- `web/src/routes/[book]/+page.svelte` — conditional layout: essay-style vs chapter-style, CTA placement, scope line, chapter progress
- `web/src/routes/[book]/+page.server.js` — load first card data for essay books
- `web/src/lib/stores/progress.js` — add `getChapterProgress(bookSlug, chapterSlug, chapterCardCount)` helper
- `web/tests/e2e/` — update existing tests, add new tests for both layouts

## Constraints
- Must work before and after the card delight plan (Pb3e7a) runs — use `book.slug !== 'meditations'` as fallback if `has_chapters` doesn't exist yet
- Chapters are NOT interactive/clickable — purely visual progress display
- Visual warmth matches BRANDING.md — typography, colors, spacing
- CTA must be visible above the fold on mobile (390×844) for both new and returning readers
- No new npm dependencies
- Existing e2e tests must pass
- Verify via Playwright screenshots at each milestone

## Tasks
- [x] T01: Pipeline — total_reading_time_seconds — Add `total_reading_time_seconds: number` to `BookMeta` in `scripts/lib/types.ts`. In `assembler.ts`, sum `reading_time_seconds` across all cards in all chapters and write to meta. Run `npm test` to verify pipeline tests pass. Files: `scripts/lib/types.ts`, `scripts/lib/assembler.ts`
- [x] T02: Regenerate _meta.json — Run `npx tsx scripts/generate.ts --all --phase assemble`. Verify each `_meta.json` has `total_reading_time_seconds`. Files: `content/output/*/_meta.json`
- [x] T03: Chapter progress helper — Add `getChapterProgress(bookSlug, chapterSlug, chapterCardCount)` to the progress store. Returns `{ cardsRead, total, percentage, completed }` for a specific chapter by filtering `cards_read` array for IDs matching the chapter slug pattern. Files: `web/src/lib/stores/progress.js`
- [x] T04: Load first card on book page — In `+page.server.js`, when the book is not chapter-based, load the first card via `getCard(book, firstChapterSlug, 1)` and return it as `previewCard`. Files: `web/src/routes/[book]/+page.server.js`
- [x] T05: Shared layout changes — In `+page.svelte`, for both book types: (a) add scope line below description: "{total_cards} cards · ~{minutes} min read" in UI font, secondary color, (b) move CTA row (Start Reading / Continue + progress bar) immediately after the header + scope line, above the chapter list or preview card. Files: `web/src/routes/[book]/+page.svelte`
- [x] T06: Essay-style layout — In `+page.svelte`, when the book has no real chapters: (a) remove the section list entirely, (b) below the CTA, render a preview of the first card — `plain_english` text in a muted card container (reduced opacity, border, Literata font), tappable as a link to the first card. Files: `web/src/routes/[book]/+page.svelte`
- [x] T07: Screenshot check — essay books — Capture Playwright screenshots of `/shortness-of-life` and `/enchiridion` at mobile (390×844) and desktop (1280×800), light + dark mode. Verify: CTA visible above the fold, no section list, scope line readable, preview card looks warm and bookish, overall layout matches BRANDING.md. Fix any visual issues. Files: screenshots only
- [x] T08: Chapter-style progress display — In `+page.svelte`, when the book has chapters: on each chapter row, show per-chapter progress. Use `getChapterProgress` from the store. Display a subtle fill bar behind the row (author accent color at low opacity) and "15 / 27" text replacing the static "27 cards" count. Completed chapters show a muted checkmark before the title. Chapter rows remain non-interactive `<li>` elements, not links. Files: `web/src/routes/[book]/+page.svelte`
- [x] T09: Screenshot check — chapter book — Capture Playwright screenshots of `/meditations` at mobile (390×844) and desktop (1280×800), light + dark mode. Verify: CTA above the chapter list, scope line visible, chapter progress bars render correctly (test with and without localStorage progress), completed chapter checkmark visible, chapter rows are NOT clickable. Compare against BRANDING.md. Fix any issues. Files: screenshots only
- [x] T10: Returning reader flow — Verify both book types: (a) essay book with progress shows "Continue" + progress bar above preview card, (b) chapter book with progress shows "Continue" + progress bar above chapter list, with per-chapter fill bars. Capture screenshots for both states. Files: `+page.svelte`, screenshots
- [x] T11: Update e2e tests — Update existing tests for new selectors/layout. Add tests: (a) Meditations has `.chapter-list` with progress indicators, (b) Shortness of Life has no `.chapter-list` and has `.book-scope` and `.book-preview`, (c) both book types show `.book-scope` with card count and reading time, (d) CTA is present before the chapter list on Meditations. Files: `web/tests/e2e/` relevant specs
- [x] T12: Run tests + final screenshots — Run `npm test` and full Playwright e2e suite. Final screenshot pass: Meditations + Shortness of Life at mobile + desktop, light + dark — 8 screenshots. Read each to verify visual quality against BRANDING.md.

## Verify
```bash
npm test
npx playwright test --project desktop-chrome tests/e2e/ --prefix web
```
