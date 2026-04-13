# Remove MainMenu

## Objective
Delete the redundant hamburger drawer; rely on header site-name and footer links for navigation.

## Decisions
- Delete `MainMenu.svelte` entirely — no replacement.
- `/debug` remains reachable via direct URL in dev; no UI entry point needed.
- Footer already renders About/Support on every page via `+layout.svelte`; Home is the header site-name link.
- Drop the `Main menu drawer` describe block from `navigation.spec.js`; keep the existing `Footer navigation links` block (already covers `/`, `/enchiridion`, `/meditations/book-01/1`).

## Files
- `web/src/lib/components/MainMenu.svelte` — delete
- `web/src/routes/+layout.svelte` — remove import (line 10) and `<MainMenu />` usage (line 60); consider whether `.header-actions` wrapper is still needed (theme toggle is the only remaining action)
- `web/tests/e2e/navigation.spec.js` — remove the `Main menu drawer` describe block (lines 30-69)

## Constraints
- Footer reachability on card views is the one concern. `navigation.spec.js` already asserts footer visibility on `/meditations/book-01/1`, so this is covered — but manually sanity-check on mobile viewport during verify.
- No other files import `MainMenu` (verified: only `+layout.svelte`).

## Tasks
- [x] T01: Remove `MainMenu` usage from layout — delete import on `web/src/routes/+layout.svelte:10` and `<MainMenu />` on line 60. Leave `.header-actions` wrapper in place (theme toggle still lives inside it). Accept: layout compiles, header renders site-name + theme toggle only.
- [x] T02: Delete `web/src/lib/components/MainMenu.svelte`. Accept: file gone; `grep -r MainMenu web/src` returns nothing.
- [x] T03: Remove `Main menu drawer` describe block from `web/tests/e2e/navigation.spec.js` (lines 30-69). Accept: file ends after `Footer navigation links` block; no references to `Open menu`, `Main menu`, or `dialog` remain in the file.
- [x] T04: Run unit suite — `npm test`. Accept: all 222 tests pass.
- [x] T05: Build and run e2e suite — `npm run build --prefix web && npm run test:e2e --prefix web`. Accept: all e2e tests pass, including the footer reachability assertions on card views.
- [x] T06: Manual mobile sanity check — `npx playwright screenshot --viewport-size="390,844" --full-page http://localhost:5173/meditations/book-01/1 /tmp/card-mobile.png`, Read the PNG, confirm the footer is scrollable into view on a card page. Accept: footer visible below card content on mobile viewport.

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
