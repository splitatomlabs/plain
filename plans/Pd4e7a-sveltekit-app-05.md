# Plan 05: Testing & Deployment

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Depends on
- `plans/Pd4e7a-sveltekit-app-04.md` — needs complete app with all features

## Objective
Add comprehensive test coverage (unit, E2E, visual regression, accessibility) and verify production deployment to Vercel.

## Decisions
- Vitest for unit tests: progress store logic, content utilities, tag helpers
- Playwright for E2E: card navigation flows, progress persistence, theme toggle, sharing
- Playwright visual regression: screenshot comparisons for key pages at mobile + desktop, light + dark mode. Store baseline screenshots in `tests/visual/snapshots/`
- Accessibility: axe-core integration via `@axe-core/playwright` for automated WCAG checks on every route
- Deployment: verify `npm run build` produces valid Vercel output, test ISR behavior, confirm OG images generate

## Files
All paths relative to `web/`.
- `tests/unit/progress.test.js` — Unit tests for progress store
- `tests/unit/content.test.js` — Unit tests for content utilities
- `tests/unit/tags.test.js` — Unit tests for tag helpers
- `tests/e2e/card-navigation.spec.js` — E2E card reading flow
- `tests/e2e/progress.spec.js` — E2E progress tracking persistence
- `tests/e2e/home-page.spec.js` — E2E home page states (new visitor, returning reader)
- `tests/e2e/sharing.spec.js` — E2E share and gift flows
- `tests/e2e/theme.spec.js` — E2E theme toggle and persistence
- `tests/e2e/accessibility.spec.js` — Automated WCAG checks on all routes
- `tests/visual/card-views.spec.js` — Visual regression for card pages
- `tests/visual/pages.spec.js` — Visual regression for home, book, tag pages

## Constraints
- Visual regression tests need stable baselines — run against built preview server, not dev server
- Axe checks must pass with zero violations on every testable route
- Tests must not depend on network — all content is local JSON
- Playwright tests run against both mobile (375×812) and desktop (1280×720) viewports
- CI-friendly: all tests runnable via `npm run test:unit` and `npx playwright test`

## Tasks
- [ ] T01: Install test dependencies — Add `@axe-core/playwright` to devDependencies. Update `playwright.config.js`: add `webServer` config to auto-start preview server, define projects for `desktop-chrome`, `mobile-chrome` (375×812 viewport), optionally `desktop-firefox`. Set `testDir` to `tests/`. Set snapshot paths for visual tests. Ensure `npm run test:unit` and `npx playwright test` scripts work.
- [ ] T02: Unit tests for content utilities — `tests/unit/content.test.js`: test `getAuthors()` returns 3 authors in correct order, `getBookMeta('meditations')` returns valid metadata, `getBookMeta('nonexistent')` throws, `getCard('meditations', 'book-01', 1)` returns correct card shape, `getAdjacentCard` handles chapter boundaries and book start/end, `getCardsByTag` returns cards grouped correctly, `getAllCards()` returns all cards.
- [ ] T03: Unit tests for tags — `tests/unit/tags.test.js`: test TAGS has 12 entries, each has slug and label, `getTagBySlug` returns correct tag, `getTagBySlug('nonexistent')` returns undefined, `getTagsForBook` returns subset matching book's _meta.json tags.
- [ ] T04: Unit tests for progress store — `tests/unit/progress.test.js`: mock localStorage. Test `markCardRead` adds card to cards_read and updates last_card/last_read_at, `getProgress` calculates correct percentage, `getAuthorProgress` aggregates across books, `toggleFavorite` adds/removes, `isFavorite` reflects state, `isCompleted` returns false until all cards read, `markCompleted` sets completed flag and timestamp, `getLastReadBook` returns most recently read book. Test SSR safety: import in Node environment without error.
- [ ] T05: E2E card navigation tests — `tests/e2e/card-navigation.spec.js`: navigate to `/meditations/book-01/1`, verify card text visible, click next → card 2 loads, keyboard ArrowRight → card 3, keyboard ArrowLeft → back to card 2, "Show original" toggle expands/collapses, tag pills are clickable links, progress bar updates. Test on both mobile and desktop viewports. Test chapter boundary navigation.
- [ ] T06: E2E progress tracking tests — `tests/e2e/progress.spec.js`: start reading a book, navigate through 3 cards, go to home page → verify "Continue Reading" banner appears with correct card position, reload page → verify progress persists from localStorage, navigate to book landing → verify progress bar shows. Test milestone modal appears at correct threshold (may need to seed localStorage to test 25% threshold efficiently).
- [ ] T07: E2E home page tests — `tests/e2e/home-page.spec.js`: fresh visit (clear localStorage) → verify new-visitor layout with Marcus Aurelius first, three author sections visible, "Start Reading" CTAs work. Seed localStorage with progress → reload → verify returning-reader layout with progress rings, "Continue Reading" banner, correct author order (Slave → Emperor → Senator).
- [ ] T08: E2E sharing and theme tests — `tests/e2e/sharing.spec.js`: on card page, verify share button exists, click it (clipboard fallback since Playwright doesn't support Web Share API), verify URL is copied. Test gift URL: navigate to `/meditations?gift=true&note={base64}`, verify gift banner displays with decoded note. `tests/e2e/theme.spec.js`: verify default theme matches system preference, click toggle → verify theme changes, reload → verify theme persists.
- [ ] T09: Accessibility tests — `tests/e2e/accessibility.spec.js`: run axe-core on key routes: `/`, `/meditations`, `/meditations/book-01/1`, `/tags`, `/tags/calm-your-mind`, `/completed/meditations`. Each must pass with zero violations. Test keyboard navigation: tab through all interactive elements on card page, verify visible focus indicators, verify milestone modal traps focus. Test screen reader attributes: `aria-live` on card container, `aria-expanded` on "Show original", `aria-label` on icon buttons, `role="progressbar"` on progress elements.
- [ ] T10: Visual regression tests — `tests/visual/card-views.spec.js`: screenshot card page at mobile light, mobile dark, desktop light, desktop dark. Screenshot card with "Show original" expanded. `tests/visual/pages.spec.js`: screenshot home page (new visitor) at mobile + desktop, home page (returning reader, seeded localStorage) at mobile + desktop, book landing page, tag index, tag detail page. All screenshots compared against baselines. First run generates baselines; subsequent runs flag visual drift.
- [ ] T11: Build and deployment verification — Run `npm run build` → verify clean output, no warnings, all prerender routes generated. Check `.vercel/output/` structure is valid. Verify ISR config present in card route output. Run `npm run preview` → navigate full flow. If Vercel CLI available: run `vercel build` to validate adapter output. Document deployment steps in a brief `DEPLOY.md` or update README: link Vercel project, `vercel deploy` for preview, `vercel deploy --prod` for production.
- [ ] T12: Generate visual baselines and final check — Run full Playwright suite, accept initial screenshots as baselines. Run full Vitest suite. Fix any failing tests. Run all tests one final time to confirm green. Report: total test count, coverage areas, any known limitations.

## Verify
```bash
cd web && npm run test:unit
cd web && npx playwright test
cd web && npm run build
```
