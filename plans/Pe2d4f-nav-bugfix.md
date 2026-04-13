# Fix home/main-menu navigation bugs

## Objective
Reproduce and fix two reported navigation failures: (1) tapping the current-page link in the main menu leaves the drawer open, and (2) the home page intermittently becomes unresponsive — clicks update the URL but the view does not refresh.

## Context
- `web/src/lib/components/MainMenu.svelte` lives in the layout and is never destroyed; it imperatively mutates `document.body.style.overflow` and sets the `inert` attribute on a list of layout selectors (`main#main-content`, `.site-footer`, header items) via `document.querySelector`.
- Prior attempted fixes (adding `onclick={closeMenu}` on nav links, relaxing the path-change `$effect` to fire on any route change) did not resolve the reports — user sees weird behavior in both Safari and Chrome.
- `web/src/routes/+page.svelte` derives `hasProgress`, `authorProgressData`, `bookProgress`, `suggestedBook` inside a `$effect` that has **no reactive dependencies** (it only reads `progress.*` stores and `data.*` through `untrack`-initialised values). On same-component re-navigation (back to `/` via client-side nav) the effect does not re-run, so the page state goes stale.

## Likely root causes
1. **Same-route link click leaves `body.overflow` / `inert` attributes stuck.** If `closeMenu` runs in the click handler but the Svelte effect that clears `inert`/`overflow` schedules as a microtask, and the browser/SvelteKit then does same-route nav (URL rewrite only, no remount), the effect may not observe the transition the way we expect — especially when the `{#if open}` block is torn down during the same click. Net result: `main#main-content` keeps `inert`, so subsequent clicks on the page body do nothing.
2. **Out-of-band DOM mutation via `querySelector`.** `setBackgroundInert` reaches into the DOM directly instead of letting Svelte own the attribute. Any rerun order issue, error, or element-missing case leaves inert stuck with no way to recover.
3. **`+page.svelte` state goes stale on client-side re-entry to `/`.** The single `$effect` has no reactive read of `page.url`, so when a user navigates away and back, the derived UI state (`lastReadBook`, `bookProgress`, rings) reflects the previous visit.

## Decisions
- **Write failing Playwright e2e tests first** reproducing both symptoms; run them in Chromium and WebKit.
- **Replace imperative `inert`/`overflow` management with declarative Svelte bindings.** Bind `inert={open}` on `<main>` (and any other siblings that should be non-interactive) via a layout-level store, or move the drawer into a `<dialog>` element. Simplest option: expose `menuOpen` from a tiny store, set `inert` and `aria-hidden` on `<main>`/`<footer>` via `{#if}`-driven attributes in `+layout.svelte`, and toggle a `body.menu-open` class via a `$effect` that has a guaranteed cleanup.
- **Fix `+page.svelte` staleness** by making the derivation reactive to `page.url.pathname` (so re-entry re-runs) and/or by moving the derivation into `$derived` expressions backed by a reactive `progressVersion` counter bumped when localStorage writes happen.
- **Do not rely on `<a onclick={closeMenu}>` as the sole close path** — keep it as one layer, but make the state model robust so any missed close still self-heals on the next route match.

## Files
- `web/tests/e2e/navigation.spec.js` — add failing cases (or create `web/tests/e2e/menu-inert.spec.js`).
- `web/src/lib/components/MainMenu.svelte` — remove `setBackgroundInert` and body-overflow mutation; expose `open` state via a store OR via callback prop into layout.
- `web/src/lib/stores/menuState.js` *(new, optional)* — small store holding `menuOpen` for layout consumption.
- `web/src/routes/+layout.svelte` — bind `inert` / `aria-hidden` declaratively on `<main>` and `<footer>`; toggle a body class via reactive `$effect` with proper cleanup.
- `web/src/routes/+page.svelte` — make the progress derivation react to `page.url.pathname` so same-component re-entry refreshes; consider splitting into `$derived`.
- `web/src/lib/stores/progress.js` — (read-only check) confirm a reactive signal exists we can depend on; if not, add a version counter.

## Constraints
- Playwright tests must run in both `chromium` and `webkit` projects (check existing `playwright.config`).
- Keep accessibility semantics intact: drawer is still `role="dialog" aria-modal="true"`, focus trap still works, Escape still closes, background is still non-interactive while open.
- No new runtime dependencies.
- Follow CLAUDE.md: build web app before running e2e (`npm run build --prefix web` then `npm run test:e2e --prefix web`).

## Tasks
- [x] T01: Reproduce symptom 1 in a failing Playwright test — on `/`, open menu, click "Home" link, assert: drawer hidden, `main#main-content` has no `inert` attr, `body` has no inline `overflow` style, a button inside `<main>` is clickable. Add to `web/tests/e2e/navigation.spec.js` under a new `describe('Main menu self-healing')`. Added `'clicking current-page Home link closes drawer and restores interactivity'` test; expected to fail against current code because same-route nav may not trigger the path-change `$effect`, leaving `inert` stuck.
- [x] T02: Reproduce symptom 2 in a failing Playwright test — from `/`, navigate to `/enchiridion` via a card link, then back via `page.goBack()` AND separately via the menu Home link; assert the home page's "Continue Reading" / author rings update (or at least that a visible button on `/` responds to click, and `main` is not inert). Added `describe('Home page stale state on client-side re-entry')` block with two tests: `'home page is interactive after browser back navigation from /enchiridion'` and `'home page is interactive after navigating back via the menu Home link'`. Both seed localStorage with enchiridion progress and the `plain_has_progress` cookie, then assert `.author-rings` is visible and `main#main-content` is not inert after client-side re-entry. Tests expected to fail on current code because the `$effect` in `+page.svelte` has no reactive dependency on `page.url.pathname`.
- [x] T03: Added `desktop-webkit` project to `web/playwright.config.js` so e2e suite runs on chromium and webkit.
- [x] T04: Ran new tests. T01 test FAILS as expected (`main#main-content button` not found because `main` is inert after same-route Home click). T02's two tests PASS against current code — the assertions (main not inert + author-rings visible) don't catch the staleness symptom; they act as weaker regression tests. Proceeding with fixes anyway per plan.; confirm they FAIL against current `main` (document the failure output inline in the plan as a comment on the task).
- [x] T05: Refactor `MainMenu.svelte` — deleted `setBackgroundInert`, `INERT_SELECTORS`, body-overflow mutation, and `onDestroy` cleanup. Created `web/src/lib/stores/menuState.js` (plain `writable(false)`). Component now sets `menuOpen.set(open)` in a `$effect`. Focus management, Escape, and tab trap unchanged.
- [x] T06: Updated `+layout.svelte` — imports `menuOpen` store; `<main>`, `<footer>`, and skip link now have `inert={$menuOpen || undefined}` reactive bindings; `$effect` toggles `body.menu-open` class with explicit cleanup return.
- [x] T07: Added `body.menu-open { overflow: hidden; }` to `web/src/app.css`.
- [ ] T08: Fix `+page.svelte` staleness — inside the existing `$effect`, read `page.url.pathname` so the effect re-runs on client-side re-entry; OR replace state with `$derived` expressions keyed off a reactive progress version. Verify: navigating `/` → `/enchiridion` → back to `/` shows up-to-date Continue Reading banner and author rings.
- [ ] T09: Re-run the e2e suite from T01-T03; confirm all now pass. Also run the existing navigation.spec.js cases to check for regression.
- [ ] T10: Manual smoke in Chrome and Safari (desktop + mobile viewport via devtools) — open menu, tap current-page link; navigate across a few pages; check back/forward; verify the page is always interactive. Record anything unexpected as a new task.
- [ ] T11: Update `web/tests/e2e/navigation.spec.js` with any additional regression tests uncovered during T10.

## Verify
```bash
npm run build --prefix web
npm run test:e2e --prefix web -- navigation.spec.js
npm test
```
