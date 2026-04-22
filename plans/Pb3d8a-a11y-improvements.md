# Accessibility Improvements

## Objective
Close four concrete a11y gaps (card flip state, home h1 hierarchy, milestone modal announcement, share-copied announcement) without regressing any existing functionality or e2e tests.

## Decisions

- **Scope is four gaps only.** Three items originally flagged turn out to be non-issues on verification:
  - aria-current polish: no navigation-with-active-page UI exists (header has a logo link; footer has About/Support). Skip.
  - Decorative SVG aria-hidden consistency: grepped all SVGs in templates — theme toggle, chevrons, share icons, tag icons all already carry `aria-hidden="true"`. No inconsistency to fix.
  - Dark-mode ProgressRing text contrast: `#E8E2D9` on `#1A1816` is ~14:1. Well above AA. Skip.
- **Card flip — expose state via `aria-pressed` on the flip button + `inert` on the non-visible face.** Two flip buttons exist (one per face). Making the non-visible face `inert` removes it from the a11y/tab tree so only one flip button is ever active; `aria-pressed={flipped}` conveys toggle state consistently to screen readers. Simpler than `aria-expanded` (no disclosure region) and more accurate than leaving both buttons reachable.
- **Home h1 for returning visitors — add a visually-hidden h1** inside `.returning-hero` using the existing `.visually-hidden` utility (see `app.css:176`), matching the pattern already used at `[book]/[chapter]/[card]/+page.svelte:153`. Keeps visual design intact; fixes 2.4.10.
- **Milestone modal — switch `role="dialog"` → `role="alertdialog"`** on both the `MilestoneModal` component and the inline tag-milestone modal in `tags/[tag]/+page.svelte`. `alertdialog` signals an interrupt-level announcement; combined with the existing focus-move into the dialog and `aria-labelledby`, SRs announce the heading on appearance. Lower-risk than introducing an aria-live region (no duplicate-announcement risk).
- **ShareButton copied state — add a visually-hidden `aria-live="polite"` span** inside the button that populates with "Link copied" when `copied` is true. Mirrors the existing `.share-confirm` pattern in `routes/completed/[book]/+page.svelte:86`. Keeps the existing `aria-label="Share this card"` intact so e2e selectors don't break.
- **Do NOT refactor the inline tag-milestone modal to use MilestoneModal component.** Messages differ (tag count vs. book percent), focus-trap and Tab handling differ, and consolidating risks regressing `tag-exploration.spec.js`. Just change the role on both.
- **Do NOT change CardSwipe's `role="presentation"`.** It remains an enhancement; CardNav + global arrow keys is the keyboard path (see memory `feedback_a11y_gesture_alternatives.md`).

## Files

- `web/src/lib/components/Card.svelte` — add `aria-pressed={flipped}` to both flip buttons (lines 99-105, 155-161); add `inert={flipped ? undefined : undefined}` logic to `.card-front`/`.card-back` wrappers so the non-visible face is inert.
- `web/src/routes/+page.svelte` — add `<h1 class="visually-hidden">` at top of `.returning-hero` section (around line 129).
- `web/src/lib/components/MilestoneModal.svelte` — change `role="dialog"` → `role="alertdialog"` (line 99).
- `web/src/routes/tags/[tag]/+page.svelte` — change `role="dialog"` → `role="alertdialog"` (line 213) in the inline tag milestone modal.
- `web/src/lib/components/ShareButton.svelte` — add visually-hidden `<span aria-live="polite">` inside the button; populate with "Link copied" when `copied` is true (adjacent to lines 42-55).
- `web/tests/e2e/accessibility.spec.js` — update milestone modal selector from `[role="dialog"]` → `[role="alertdialog"]` (lines 150, 155).

## Constraints

- **Do not touch:**
  - `web/src/lib/components/CardSwipe.svelte` — `role="presentation"` stays; swipe remains a visual enhancement.
  - `web/src/lib/components/CardNav.svelte` — global arrow-key listener and auto-focus on article are load-bearing; leave untouched.
  - `web/src/routes/completed/[book]/+page.svelte` — existing `.share-confirm` live region already correct; do not unify with the new card-page pattern.
  - The existing visible `<h1>` on `+page.svelte:165` (new-visitor hero) — must remain the h1 for new visitors and continue to satisfy `home-page.spec.js:11-12`.
  - `aria-label="Share this card"` on ShareButton — e2e selectors depend on it (`sharing.spec.js:6`, `accessibility.spec.js:39`).
  - `aria-label="Show original text"` and `aria-label="Show plain English"` on flip buttons — preserved to satisfy `accessibility.spec.js:83`.
  - `aria-modal="true"` and `aria-labelledby="milestone-heading"` on MilestoneModal — must continue to satisfy `accessibility.spec.js:155-156`.

- **Testing:** after each implementation task, run unit tests; after all changes, build and run full e2e suite (`npm run build --prefix web && npm run test:e2e --prefix web`). Per CLAUDE.md, web app changes require e2e verification before declaring done.

- **Svelte 5 conventions:** use `$state`, `$props` runes as existing components do. No new abstractions or wrapper components. No comments explaining what is obvious from the code.

## Tasks

- [x] T01: **Baseline — confirm current suite is green.** Run `npm test` and `npm run build --prefix web && npm run test:e2e --prefix web`. Capture pass counts so later comparisons are apples-to-apples. If anything fails pre-change, stop and surface before proceeding.

- [x] T02: **Card flip — expose state via `aria-pressed` + `inert`.** In `web/src/lib/components/Card.svelte`:
  - Add `aria-pressed={flipped}` to the front-face flip button (around line 99-105).
  - Add `aria-pressed={flipped}` to the back-face flip button (around line 155-161) — same binding; the visible-face button's `aria-pressed` reflects current flip state.
  - Add `inert={flipped ? true : undefined}` to `.card-front` wrapper (around line 87).
  - Add `inert={flipped ? undefined : true}` to `.card-back` wrapper (around line 143).
  - Preserve existing `aria-label` text on both buttons.
  - Acceptance: when `flipped=false`, `.card-back` is inert (not tab-reachable, not in SR tree) and front flip button has `aria-pressed="false"`; when `flipped=true`, `.card-front` is inert and back flip button has `aria-pressed="true"`. Manual test: tab through card, confirm only one flip button is reachable at a time.

- [x] T03: **Verify flip e2e still passes.** Run `npm run build --prefix web && npx playwright test accessibility.spec.js --prefix web`. The existing test (lines 78-84) asserts the flip button is visible and has `aria-label="Show original text"`. Our changes preserve both. Expected: pass with no edits. If axe flags a new violation (e.g. inert interaction), investigate before proceeding.

- [x] T04: **Home page — add visually-hidden h1 for returning visitors.** In `web/src/routes/+page.svelte`, inside the `.returning-hero` section (around line 129, directly after the `<section>` opening tag), add `<h1 class="visually-hidden">Plain — Ancient philosophy, in plain English</h1>`. Acceptance: axe no longer reports heading-order violation on `/` for returning visitors; `home-page.spec.js` still passes (new-visitor h1 test at line 11 uses `h1` locator — `.first()` is implicit in `locator('h1')`, but confirm test still finds "Three men" — if `page.locator('h1')` returns multiple on returning visitors, the test uses `toContainText` which may still pass since only one `h1` renders per branch).

- [x] T05: **Milestone modal — switch to `role="alertdialog"`.** In `web/src/lib/components/MilestoneModal.svelte` line 99, change `role="dialog"` → `role="alertdialog"`. Preserve `aria-modal="true"`, `aria-labelledby="milestone-heading"`, `tabindex="-1"`, and all focus-trap/Escape logic. Acceptance: modal still opens and closes identically; focus still moves into modal; Escape still closes.

- [x] T06: **Tag-milestone modal — switch to `role="alertdialog"`.** In `web/src/routes/tags/[tag]/+page.svelte` line 213, change `role="dialog"` → `role="alertdialog"`. Preserve `aria-labelledby="tag-milestone-heading"` and `aria-modal="true"`. Acceptance: no visible change; role attribute updated.

- [x] T07: **Update e2e milestone modal selector.** In `web/tests/e2e/accessibility.spec.js`, change `page.locator('[role="dialog"]')` (line 150) → `page.locator('[role="alertdialog"]')`. The subsequent `toHaveAttribute('aria-modal', 'true')` and `toHaveAttribute('aria-labelledby', 'milestone-heading')` assertions (lines 155-156) stay as-is. Run `npx playwright test accessibility.spec.js --prefix web` to confirm green.

- [ ] T08: **ShareButton — announce copied state via aria-live.** In `web/src/lib/components/ShareButton.svelte`:
  - Add a `<span class="share-copied-sr" aria-live="polite">{copied ? 'Link copied' : ''}</span>` inside the button, after the existing SVG/label conditionals (around line 55).
  - Add a CSS rule applying the `.visually-hidden` pattern (absolute positioning, 1×1px, clip-path) or add a class-level style block in the component. Prefer inline CSS in the component's `<style>` block rather than relying on the global utility (ShareButton is self-contained).
  - Do not change the existing `aria-label="Share this card"` or the `.share-label` span used for visual "Copied!" feedback on the mobile path — they stay.
  - Acceptance: screen reader reads "Link copied" when the clipboard fallback path succeeds; `sharing.spec.js` card-page test (line 6) still passes (aria-label unchanged); visual behavior unchanged.

- [ ] T09: **Full e2e run.** `npm run build --prefix web && npm run test:e2e --prefix web`. All 12 spec files must pass with same counts as baseline (T01) or higher if new assertions were added. Expected churn: only `accessibility.spec.js` behaviour changes from T07.

- [ ] T10: **Axe verification on returning-visitor home.** The existing `accessibility.spec.js` runs axe against `/` for a visitor with no localStorage (new visitor). Add a short additional test (either inline or in a new `accessibility-returning.spec.js`) that seeds progress in localStorage (mirroring `home-page.spec.js:41-51`), navigates to `/`, and runs axe — confirming the h1 fix and ensuring returning-visitor path is also clean. Keep under 20 lines. Acceptance: new test passes green.

## Verify

```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```

Expected:
- `npm test`: 186 pipeline + 36 web unit tests pass (unchanged; no pipeline or unit surface touched).
- e2e: all existing suites green; `accessibility.spec.js` milestone test now asserts `role="alertdialog"`; new returning-visitor axe test passes.
