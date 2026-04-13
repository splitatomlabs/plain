# Completion share + local debug page

## Objective
Wire up the existing `/api/og/completed-{slug}` endpoint with a Web Share button on the completion page, and add a dev-only debug page (linked from the main menu) for resetting localStorage, jumping into completion screens, and priming state to test milestone modals.

## Decisions
- **Share entry point:** add a "Share" button on `completed/[book]/+page.svelte` next to the existing support line. Use `navigator.share` with `navigator.clipboard.writeText` fallback — same pattern as the gift share in `web/src/routes/[book]/+page.svelte:76-99`.
- **OG meta tags:** add `og:image`, `og:title`, `og:description`, `twitter:*` to the completion page `<svelte:head>`, pointing at `/api/og/completed-{slug}`. Mirror the structure used in `[book]/[chapter]/[card]/+page.svelte:128-142`.
- **Share URL:** the canonical share URL is the book landing page (`/{slug}`), not the completion page itself — completion pages are personal achievements, but the link a friend opens should be the book.
- **Debug page visibility:** gate on `import { dev } from '$app/environment'`. The route file always exists, but the page returns 404 when `!dev`, and the MainMenu link is only rendered when `dev` is true. This keeps it out of the prod bundle's user-facing surface without conditional builds.
- **Milestone-prime mechanism:** debug "jump to milestone" works by writing into the existing `plain-progress` localStorage so the book sits at `(threshold - 1)` cards read for the chosen milestone, then deep-linking to that next card. Reading one more card triggers the modal naturally — no new code paths in the milestone logic itself.
- **No new tests required for the debug page** (dev-only, manual testing tool). E2e tests for the share button on completion are in scope.

## Files
- `web/src/routes/api/og/[cardId]/+server.js` — no change; already supports `completed-{slug}` (lines 19-90).
- `web/src/routes/completed/[book]/+page.svelte` — add OG meta tags, add share button + handler.
- `web/src/lib/stores/progress.js` — expose a `_debugSetCardsRead(bookSlug, count)` helper (underscore-prefixed to mark internal/dev-only) that writes a synthetic `cards_read` array. No analytics events fired.
- `web/src/lib/components/MainMenu.svelte` — conditionally render a "Debug" link when `dev` is true.
- `web/src/routes/debug/+page.svelte` — new dev-only page: reset button, list of books with "view completion" + per-milestone "prime + jump" buttons.
- `web/src/routes/debug/+page.js` — load function: imports `dev` from `$app/environment`, throws 404 when not dev; otherwise returns book list via `getBooks()`.
- `web/tests/e2e/sharing.spec.js` — add coverage for the completion share button (presence + click handler triggers `navigator.share` mock or clipboard fallback).

## Constraints
- Dev-only debug surface must not ship reachable code paths to production users. The `+page.js` 404 guard is the source of truth; the MainMenu link is purely cosmetic.
- The `_debugSetCardsRead` helper must NOT fire analytics events (no `book_started`, no `milestone_reached`) — manual milestone testing depends on the modal logic firing fresh on the next real card read.
- Share button must degrade gracefully when `navigator.share` is unavailable (clipboard copy + visual confirmation).
- Do not regress the existing card-page OG image flow (`/api/og/{cardId}` for non-completion).
- After UI changes, build and run e2e per CLAUDE.md.

## Tasks
- [x] T01: Add OG + Twitter meta tags to `web/src/routes/completed/[book]/+page.svelte` `<svelte:head>` pointing at `/api/og/completed-{data.book.slug}`. Acceptance: viewing page source shows `og:image`, `og:title`, `og:description`, `twitter:card`, `twitter:image`.
- [x] T02: Add Share button + `shareCompletion()` handler to `web/src/routes/completed/[book]/+page.svelte`. Title: `I just finished {book.title} — In Plain English`. URL: `${origin}/{book.slug}`. Use `navigator.share` with clipboard fallback. Track `share_clicked` with `{ type: 'completion', book_id }`. Acceptance: button visible above support line; click triggers share or copies link.
- [x] T03: Add `_debugSetCardsRead(bookSlug, count)` to `web/src/lib/stores/progress.js`. Synthesizes `cards_read` as `[...Array(count)].map((_,i) => 'debug-' + i)`, sets `last_read_at`, does NOT fire analytics, does NOT touch milestone storage. Acceptance: callable from the debug page, persists to localStorage.
- [x] T04: Create `web/src/routes/debug/+page.js` with load function that throws `error(404)` unless `dev === true`, otherwise returns `{ books: getBooks() }`.
- [x] T05: Create `web/src/routes/debug/+page.svelte`. Sections: (a) "Reset all progress" button → `progress.reset()` + clears `plain-milestones` from localStorage; (b) per-book row with "View completion screen" link to `/completed/{slug}` and four buttons "Prime 25% / 50% / 75% / 100%" that call `_debugSetCardsRead` with `Math.floor(total * threshold / 100) - 1` then navigate to the first card URL (so reading one more triggers the modal). Also a "Clear milestone history" button per book that removes that book's entry from `plain-milestones`. Acceptance: page renders only in `npm run dev`, all actions work end-to-end manually.
- [x] T06: Add conditional Debug link to `web/src/lib/components/MainMenu.svelte` drawer nav, gated on `import { dev } from '$app/environment'`. Acceptance: link appears in dev menu, absent in prod build.
- [x] T07: Add e2e test in `web/tests/e2e/sharing.spec.js` for the completion-page share button: navigate to a completion URL, assert button is visible, mock `navigator.share` (or stub clipboard), click, assert handler was invoked with expected URL/title.
- [x] T08: Verify pipeline + web unit tests pass: `npm test`. Build + run e2e: `npm run build --prefix web && npm run test:e2e --prefix web`. Manual smoke: dev server, check `/debug` exists in dev, check Debug link in MainMenu, prime a milestone, read one card, confirm modal fires, navigate to a completion page, click share, confirm OG image renders at `/api/og/completed-{slug}`.

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
