# Plan 05: Accessibility, Visual Regression & Deployment

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Depends on
- `plans/Pd4e7a-sveltekit-app-04.md` — needs complete app with all features and existing test suite

## Objective
Add cross-cutting test coverage that spans the full app (accessibility audit, visual regression baselines) and verify production deployment to Vercel. Unit tests and feature-specific E2E tests already exist from Plans 02–04.

## Decisions
- Accessibility: axe-core integration via `@axe-core/playwright` (already installed in Plan 02) for automated WCAG checks on every route
- Visual regression: Playwright screenshot comparisons for key pages at mobile + desktop, light + dark mode. Store baseline screenshots in `tests/visual/snapshots/`
- Deployment: verify `npm run build` produces valid Vercel output, test ISR behavior, confirm OG images generate

## Files
All paths relative to `web/`.
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
- [x] T01: Update Playwright config for visual regression — Update `playwright.config.js`: add snapshot paths for visual tests. Ensure visual test files in `tests/visual/` are picked up. Verify existing test infrastructure from Plan 02 still works.
- [x] T02: Accessibility tests — `tests/e2e/accessibility.spec.js`: run axe-core on key routes: `/`, `/meditations`, `/meditations/book-01/1`, `/tags`, `/tags/calm-your-mind`, `/completed/meditations`. Each must pass with zero violations. Test keyboard navigation: tab through all interactive elements on card page, verify visible focus indicators, verify milestone modal traps focus. Test screen reader attributes: `aria-live` on card container, `aria-expanded` on "Show original", `aria-label` on icon buttons, `role="progressbar"` on progress elements.
- [x] T03: Visual regression tests — `tests/visual/card-views.spec.js`: screenshot card page at mobile light, mobile dark, desktop light, desktop dark. Screenshot card with "Show original" expanded. `tests/visual/pages.spec.js`: screenshot home page (new visitor) at mobile + desktop, home page (returning reader, seeded localStorage) at mobile + desktop, book landing page, tag index, tag detail page. All screenshots compared against baselines. First run generates baselines; subsequent runs flag visual drift.
- [x] T04: Build and deployment verification — Run `npm run build` → verify clean output, no warnings, all prerender routes generated. Check `.vercel/output/` structure is valid. Verify ISR config present in card route output. Run `npm run preview` → navigate full flow. If Vercel CLI available: run `vercel build` to validate adapter output.
- [x] T05: Generate visual baselines and final check — Run full Playwright suite, accept initial screenshots as baselines. Run full Vitest suite. Fix any failing tests. Run all tests one final time to confirm green. Report: total test count, coverage areas, any known limitations.

## Verify
```bash
cd web && npm run test:unit
cd web && npm run build && npx playwright test
```
