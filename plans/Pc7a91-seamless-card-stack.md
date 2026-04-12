# Seamless Card Stack Transition

## Objective
Make card-to-card swiping feel like a physical card stack: after the top card flies off, the next card smoothly rises from underneath to become the active card — no flash, no reset, no re-render.

## Decisions

### Why the current approach breaks
SvelteKit's `goto()` re-runs the page load function and re-renders the component tree. The muted "next card" DOM node is destroyed and a brand-new "active card" DOM node appears at `(0,0)`. Even though they show the same content, the user sees the next card snap into place rather than smoothly promote.

### Client-side card management with shallow URL updates
- **Swipe navigation is managed entirely client-side.** The page maintains its own card buffer (`activeCard`, `nextCard`, `prevCard`) using the content utility functions already available in the client bundle (`getCard`, `getAdjacentCard`, `getBookMeta`).
- **`pushState()` from `$app/navigation` updates the URL without re-running load.** SvelteKit's shallow routing updates `$page.url` and adds a history entry, but does not invoke `+page.server.js`. The card data is already client-side.
- **Button/keyboard navigation also uses the client-side path.** CardNav calls into the same card-advance logic instead of `goto()`.
- **`goto()` is reserved for cross-page navigation only** — "Finish book" → completed page, milestone modal → completed page, browser back/forward (handled by SvelteKit automatically via popstate).

### CardSwipe animation lifecycle
Three phases after the user releases a throw:
1. **Throw** (200ms) — top card flies off-screen via CSS transition. Next card stays muted underneath.
2. **Promote** (200ms) — thrown card hidden. Next card transitions from `scale(0.97) opacity(0.4)` → `scale(1.0) opacity(1.0)`. The muted card *becomes* the active card visually.
3. **Settle** — promotion done. Fire `onDismiss`. Page shifts its card buffer, pushes URL, renders new next card as muted underneath. No visible change — the promoted card already shows the right content.

### Deep links and shared URLs
- **Direct URL visits** (deep links, social shares, pasted URLs): SvelteKit `+page.server.js` loads data normally. Page initialises local state from `data`. No change to this path.
- **OG meta tags**: Server-rendered by `+page.server.js`, always correct for the requested URL. Social crawlers always make a fresh server request.
- **`<svelte:head>`**: Must reference local card state (not `data`) so the document title stays current during client-side navigation.
- **Share button**: Already reads from the Card component's `card` prop, which will point to the local active card. No change needed.
- **Resume URL in progress store**: Already uses `cardUrl(nextCard)`. Will reference local card state.

### Browser back/forward
When the user presses back, SvelteKit intercepts `popstate` and re-runs the load function (because the URL was pushed via SvelteKit's `pushState`, not raw `history.pushState`). The page receives new `data` and resets local state to match. This is a full re-render — acceptable for back/forward since the user expects a page-like transition.

## Files
- `web/src/lib/components/CardSwipe.svelte` — add promote phase, fire `onDismiss` after promote completes, control muted styling internally.
- `web/src/routes/[book]/[chapter]/[card]/+page.svelte` — local card buffer, `pushState` instead of `goto`, sync from `data` on popstate, update `<svelte:head>` to use local state.
- `web/src/lib/components/CardNav.svelte` — accept `onNavigatePrev` callback, stop using `goto()` for card navigation.
- `web/src/lib/components/Card.svelte` — no changes (muted prop already exists).
- `web/src/lib/components/ChapterMarker.svelte` — no changes (reads from props).
- `web/src/lib/components/ProgressBar.svelte` — no changes (reads from props).
- `web/tests/e2e/card-navigation.spec.js` — update for new navigation behavior.
- `web/tests/e2e/card-swipe.spec.js` — update for promote animation.
- `web/tests/e2e/progress.spec.js` — verify progress tracking with client-side nav.

## Constraints
- No new npm dependencies
- Deep links to any card must render correctly on first visit
- Shared URLs must produce correct OG previews
- Resume URLs stored in localStorage must still work
- Browser back/forward must navigate between cards
- Milestone modals must still trigger at correct thresholds
- `prefers-reduced-motion` disables all animation — promote is instant
- Existing e2e tests must pass (with selector/timing updates)
- Card page ISR caching unchanged — `+page.server.js` still handles server loads

## Tasks
- [ ] T01: CardSwipe promote phase — Add `promoting` state. After throw `transitionend` on `.card-swipe-current`: set `promoting = true`, hide thrown card (`display: none`). Add `.promoting` class to `.card-swipe-next`, which transitions from muted scale/opacity to active via CSS: `.card-swipe-next.promoting { transform: scale(1); opacity: 1; transition: var(--transition-promote); }`. Listen for `transitionend` on `.card-swipe-next` (distinct element from throw) → set `promoting = false`, fire `onDismiss`. Add `--transition-promote: 200ms ease-out` (0ms under reduced-motion). Fire `onPromoteStart()` callback (no args) when promote begins so the page can un-mute the next Card's content. Block new swipes while `promoting` is true (ignore pointer events / set a `busy` guard). Files: `CardSwipe.svelte`, `app.css`
- [ ] T02: Page local card state — Replace direct `data.*` references with local `$state` variables: `activeCard`, `nextCard`, `prevCard`, `cardIndex`. Initialise from `data` on mount. Add `$effect` watching `data.card.id` to reset local state when SvelteKit provides new data (popstate, initial load). Import `getAdjacentCard`, `getBookMeta`, `getCard` from `$lib/utils/content.js` for client-side card lookups. Files: `+page.svelte`
- [ ] T03: Client-side card advance — Create `advanceCard()` function in the page: shift buffer (active=next, compute new next/prev via `getAdjacentCard`, recalculate `cardIndex`), call `pushState(cardUrl(newActive), {})` from `$app/navigation`, update document title. Sequencing with milestones: `handleNavigateNext()` marks progress and checks milestones *before* returning. If a milestone triggers, it sets `showMilestone = true` and returns `true` (defer). `handleDismiss` checks the return: if deferred, stop (don't advance yet); when `closeMilestone()` fires, it calls `advanceCard()` directly (progress is already marked, so no double-tracking). If not deferred, `handleDismiss` calls `advanceCard()` immediately. The `pushState` second arg is `{}` — popstate triggers a full SvelteKit load, not state restoration. Files: `+page.svelte`
- [ ] T04: Update `<svelte:head>` — Change all `data.card.*` references in `<svelte:head>` to use local `activeCard` state. Title, description, OG tags, Twitter cards, OG image URL. Files: `+page.svelte`
- [ ] T05: CardNav client-side navigation — Add `onNavigatePrev` prop. Replace `goto(cardUrl(prevCard))` with `onNavigatePrev?.()`. Replace `goto(cardUrl(nextCard))` with the existing `onNavigateNext` flow (which now calls `advanceCard`). The page passes `advancePrev` as `onNavigatePrev` (mirror of `advanceCard` but in reverse: active=prev, compute new prev/next, pushState, track progress). Keyboard ArrowLeft/Right uses the same callbacks. Files: `CardNav.svelte`, `+page.svelte`
- [ ] T06: ChapterMarker + boundary text — Update "Beginning of..." boundary and ChapterMarker to use local `activeCard`/`prevCard` state instead of `data.*`. Ensure chapter marker shows/hides correctly during client-side navigation. Files: `+page.svelte`
- [ ] T07: Progress + milestone integration — Verify `handleNavigateNext()` uses local card state for progress tracking. Verify milestone thresholds fire correctly with local `cardIndex`/`totalCards`. Test: swipe through several cards, reload page, confirm progress persisted and resume URL is correct. Files: `+page.svelte`
- [ ] T08: Last card + finish book — When `nextCard` is null (last card in book), the "Finish book" button and completion message should appear. Ensure `advanceCard` is a no-op when no next card exists. Add a `canSwipe` prop to CardSwipe (default `true`); when `false`, the throw threshold is never reached — any drag resets to center (snap-back). The page sets `canSwipe={nextCard !== null}`. Files: `+page.svelte`, `CardSwipe.svelte`
- [ ] T09: Deep link verification — Write/update e2e tests: (1) direct visit to mid-book card shows correct content, position, chapter marker. (2) Direct visit to first card shows "Beginning of..." boundary. (3) Direct visit to last card shows "Finish book". (4) OG meta tags match the visited card. (5) Share button URL matches visited card. Files: `card-navigation.spec.js`
- [ ] T10: Browser back/forward verification — Write e2e test: navigate forward 3 cards via swipe/button, press browser back twice, verify URL and card content match. Verify that back navigation does a full render (acceptable), not a promote animation. Files: `card-swipe.spec.js`
- [ ] T11: Update e2e tests — Fix selectors/timing in existing tests for the new navigation flow. The main breaking change: swipe-driven navigation now has a ~200ms promote animation before the URL updates, so all swipe tests need `waitForURL` or equivalent after swipe instead of expecting immediate navigation. Update `progress.spec.js` timing — progress is marked post-promote, not pre-goto. Add test for `prefers-reduced-motion`: promote is instant, URL updates without visible animation delay. Add test for rapid consecutive swipes: second swipe during promote phase is ignored (busy guard). Update visual snapshots. Run full suite. Files: all test files in `web/tests/e2e/`, `web/tests/visual/`
- [ ] T12: Screenshot check — Capture mobile + desktop screenshots of: (a) card throw → promote → settle sequence (verify smooth transition). (b) Deep link to mid-book card. (c) Card after browser back. Verify against BRANDING.md. Files: screenshots only

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
