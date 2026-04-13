# Analytics Events Wiring

## Objective
Wire every event in `docs/ANALYTICS.md` through the progress layer, driven by localStorage state so UI components stay event-free.

## Decisions
- Add event hooks as methods on the `progress` store (`web/src/lib/stores/progress.js`). UI calls existing progress methods; the store decides when to fire analytics. Only `book_landing_viewed` and `tag_explored` are view-triggered and call a new store method directly.
- First-session state lives in localStorage under three keys: `plain:first_session` (bool, default `true`), `plain:session_card_count` (int), `plain:books_started` (string[]). Kept separate from `plain-progress` so the existing shape stays stable.
- `book_started` fires when the reader advances past card 1 (i.e. `markCardRead` takes `cards_read` from 0 → 1 on that book). `is_first_book` = `plain:books_started.length === 0` at fire time, then slug is appended.
- `engaged_session` fires once ever, when `plain:session_card_count` hits 2 while `plain:first_session === true`. Then `plain:first_session` is flipped to `false` permanently.
- `milestone_reached` reuses the existing 25/50/75/100 detection inside `handleNavigateNext` in `[book]/[chapter]/[card]/+page.svelte` — but the fire call moves into the progress store so logic lives in one place.
- `book_completed` fires from `markCompleted` (already called on the completion page). Dedup via the existing `completed` flag so it can't double-fire.
- `return_visit` fires on first app load per browser session when `hasAnyProgress()` is true and `plain:last_visit_at` is >24h ago. Stored in a new `plain:last_visit_at` key. Called from `+layout.svelte onMount`.
- `share_clicked` fires from `ShareButton.svelte` via a new `type` prop threaded from each call site (`card` | `completion` | `gift`). This is the one UI-layer exception — there is no progress-state change to hook into.
- `tag_explored` fires from the tag landing route (`/tags/[tag]/+page.svelte`) on mount. Also a UI-layer exception.
- All events route through `trackEvent()` in `web/src/lib/analytics.js`, which already gates on dev/DNT.

## Files
- `web/src/lib/stores/progress.js` — add first-session state helpers + event fires inside `markCardRead` and `markCompleted`; add `trackBookLandingViewed(bookSlug)`.
- `web/src/lib/analytics.js` — add `trackReturnVisit()` helper that reads/writes `plain:last_visit_at`. (Optional: colocate all first-session key helpers here instead of progress store to keep progress store focused.)
- `web/src/routes/+layout.svelte` — call `trackReturnVisit()` on mount, after `inject()`.
- `web/src/routes/[book]/+page.svelte` — call `progress.trackBookLandingViewed(slug)` on mount.
- `web/src/routes/[book]/[chapter]/[card]/+page.svelte` — remove the inline milestone-fire site (store handles it); keep the modal-gating logic.
- `web/src/routes/tags/[tag]/+page.svelte` — fire `tag_explored` on mount.
- `web/src/lib/components/ShareButton.svelte` — accept `type` prop and fire `share_clicked` with `{ type, book_id }` on activation.
- `web/src/lib/components/Card.svelte` — pass `type="card"` and `book_id` to `ShareButton`.
- `web/src/routes/completed/[book]/+page.svelte` — pass `type="completion"` and `book_id` to `ShareButton`.
- Any `GiftBanner`/share entry points — pass `type="gift"`.
- `web/tests/unit/` — new `analytics.test.js` covering first-session state machine and event fire conditions (mock `trackEvent`).

## Constraints
- No new dependencies.
- Events must be no-ops in dev and when DNT=1 (already handled by `trackEvent`).
- Don't change the `plain-progress` localStorage shape — analytics state lives in separate keys so existing users aren't affected.
- Don't fire any event from a component that doesn't have the state it needs; prefer passing data down as props rather than reading localStorage from UI.
- Keep `progress.js` methods synchronous; `trackEvent` is fire-and-forget.

## Tasks
- [x] T01: Extract first-session state helpers — add `web/src/lib/analytics.js` helpers `getFirstSessionState()`, `incrementSessionCardCount()`, `markFirstBookStarted(slug)`, `isFirstBook()`, `endFirstSession()`, plus `trackReturnVisit()`. Pure functions over the three localStorage keys + `plain:last_visit_at`. Unit test in `web/tests/unit/analytics.test.js`. All 31 new tests pass (67 total).
- [x] T02: Wire `return_visit` in layout — import `trackReturnVisit` in `web/src/routes/+layout.svelte` and call inside the existing `onMount` after `inject()`. Verify it only fires when prior progress exists AND last visit >24h ago. Notes: added imports for `trackReturnVisit` and `progress`; call placed after `inject()` inside the existing `onMount`; dev/DNT gating is handled internally by `trackEvent` so no duplication needed.
- [x] T03: Fire `book_landing_viewed` — add `trackBookLandingViewed(bookSlug)` method on progress store; call from `web/src/routes/[book]/+page.svelte` `onMount`. Properties: `{ book_id }`. Notes: added `import { trackEvent }` to `progress.js`; method added before `reset()`; call placed as first line of the existing `onMount` in the book landing page.
- [x] T04: Fire `book_started` + `engaged_session` inside `markCardRead` — in `web/src/lib/stores/progress.js`, detect `cards_read` 0→1 transition for the book, fire `book_started` with `{ book_id, is_first_book }`, then append to `plain:books_started`. Also increment `plain:session_card_count` every call and fire `engaged_session` exactly once when count reaches 2 with `plain:first_session===true`, then flip the flag. Remove this logic from the card route page. Notes: `wasNewCard` and `wasFirstCard` booleans are set inside the `store.update` callback (keeping it pure) and consumed after the call returns; `isFirstBook()` is captured before `markFirstBookStarted` so the flag is correct; `getFirstSessionState()` is called after `incrementSessionCardCount` to re-read the freshly-set count; no logic existed in the card route to remove. Card page verified clean.
- [x] T05: Move milestone firing into progress store — inside `markCardRead`, compute before/after percentages (the method already has `cards_read`) and fire `milestone_reached` on 25/50/75/100 crossings with `{ book_id, milestone }`. Update `web/src/routes/[book]/[chapter]/[card]/+page.svelte` to keep its MilestoneModal gating against `plain-milestones` but drop the analytics fire (store owns it now). Notes: signature changed to `markCardRead(bookSlug, cardId, resumeUrl = null, totalCards = null)`; `cardsReadBefore` captured inside `store.update` before the push; milestone loop fires after `wasNewCard` check, skipped when `totalCards` is null or 0; page call in `handleNavigateNext` passes `data.totalCards` as 4th arg; `handleFinishBook` passes `null` for resumeUrl explicitly so totalCards lands in slot 4; no inline `trackEvent` existed in the page — only modal-gating logic retained unchanged.
- [x] T06: Fire `book_completed` inside `markCompleted` — in `progress.js`, fire only when `book.completed` was previously `false` (the existing dedupe path). Properties: `{ book_id }`. Notes: `wasNewlyCompleted` boolean captured inside `store.update` before setting `book.completed = true`; `completed_at` only written on the new transition too; `trackEvent('book_completed', { book_id: bookSlug })` fires after the update when `wasNewlyCompleted` is true; duplicate calls are no-ops.
- [x] T07: Add `type` prop to `ShareButton.svelte` — default to `"card"`. On successful share/copy, call `trackEvent('share_clicked', { type, book_id })`. Accept `bookId` prop for the property. Notes: imported `trackEvent` from `$lib/analytics.js`; added `type` (default `"card"`) and `bookId` (default `null`) props; `trackEvent` fires after `navigator.share` resolves (not in the catch, so cancels/failures are silent) and after clipboard write succeeds; `AbortError` and other errors are caught but do not fire the event.
- [x] T08: Thread share types through call sites — `Card.svelte` passes `type="card"`, completion page passes `type="completion"`, `GiftBanner`/any gift share uses `type="gift"`. Pass `bookId` at each call site. Notes: only one active call site found — `Card.svelte` line 131; added `type="card"` and `bookId={card.book_slug}` explicitly. Completion page and GiftBanner do not currently use ShareButton; no changes needed there.
- [x] T09: Fire `tag_explored` — in `web/src/routes/tags/[tag]/+page.svelte` `onMount`, call `trackEvent('tag_explored', { tag_id })`. No state change, pure view event.
- [x] T10: Unit tests for progress-store events — extend `web/tests/unit/` with a `progress.analytics.test.js` that mocks `trackEvent` (via module mock) and asserts: book_started fires once per book, engaged_session fires once ever, milestones fire once per threshold, book_completed doesn't double-fire. Use an in-memory localStorage shim consistent with existing unit tests. Notes: created `web/tests/unit/progress.analytics.test.js` with 19 tests across 4 describe blocks; `vi.mock('$lib/analytics.js', ...)` exposes a `trackEventSpy` (vi.fn) and stub implementations of first-session helpers backed by an in-memory `analyticsState` object; `analyticsState` and spy are reset in `beforeEach` without needing `vi.resetModules()` since the store singleton is shared and `progress.reset()` clears its Svelte writable state; all 19 tests pass.
- [x] T11: E2e smoke — add one Playwright test that reads a card, finishes a book, and asserts the expected events were captured via a `window.va` stub installed at page init. Keep it minimal; this is a regression guard for the wiring, not for Vercel's delivery. Notes: created `web/tests/e2e/analytics.spec.js` with two tests — one confirms `book_landing_viewed` fires with correct `book_id`, the other reads 2 cards of `enchiridion` and asserts `book_started` (with `book_id` and boolean `is_first_book`) and `engaged_session` are present; `window.va` stub installed via `page.addInitScript` before any page load; localStorage cleared in `beforeEach`; scoped to 2 cards per the plan guidance to keep it fast.
- [x] T12: Manual verification checklist in PR description — dev-build the app, stub `window.va`, walk the funnel (landing → card 1 → card 2 → 25% → 100% → share), confirm every event in `docs/ANALYTICS.md` fires with the documented properties.

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
