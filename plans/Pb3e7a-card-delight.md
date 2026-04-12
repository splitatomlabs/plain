# Card Reading Delight — Physical Card Stack

## Objective
Make card reading feel physical and native: drag a card with your finger and throw it forward to dismiss, see the next card waiting underneath, tap "Show original" to flip the card and read the original text on the back. Shadow lift, next-card scale-up, chapter-aware progress, chapter markers, and reading time hints round out the experience. Works on mobile (touch) and desktop (mouse). Keeps people reading.

## Decisions

### Drag-to-dismiss
- **Physical drag-to-dismiss, forward only.** The card follows your finger/pointer in real-time. Swipe in any direction advances to the next card — there is no swipe-to-go-back. Previous card is reached via the "Previous" button or ArrowLeft only.
- **Card stack: current on top, next underneath.** Both cards rendered simultaneously. Current card positioned on top. Next card sits below, partially visible and muted. As you drag the top card, the next card is revealed.
- **Seamless URL sync.** After the throw animation completes (~200ms), `goto()` updates the URL. SvelteKit re-renders with the same content already showing underneath — zero visible flash.
- **Velocity-based throw.** Track pointer velocity over last few frames. Fast flick dismisses even at short distance. Slow drag needs ~30% of screen width.
- **Rotation during drag.** Subtle rotation (max ±6°) based on horizontal offset, pivoting from bottom-center. Ease-out only.
- **Shadow lift during drag.** Card gains a soft `box-shadow` proportional to drag distance — like lifting it off the table. Returns to flat on snap-back. Max shadow: `0 8px 24px rgba(0,0,0,0.12)` (light mode), adjusted for dark mode.
- **Next card rises to meet you.** The muted card underneath starts at `scale(0.97)` and transitions to `scale(1.0)` as the top card moves away. Driven by drag distance, not time.
- **Desktop: grab cursor, no text selection during drag.** `cursor: grab` on card, `cursor: grabbing` while dragging. `user-select: none` during active drag only.

### Card flip for original text
- **Explicit flip affordance.** A "Show original ↻" button replaces the current `<details>` toggle. Same position, same 44px min touch target. Only this button triggers the flip — tapping elsewhere on the card does nothing (avoids accidental flips during reading).
- **CSS 3D flip.** `perspective` + `rotateY(180deg)` + `backface-visibility: hidden`. Two faces inside a single card container. Pure CSS.
- **Animated height on flip.** The card starts at front-face height. As it flips, the height smoothly animates to match the back face (original text is typically 10-25% longer). On flip back, it shrinks to front height. Height transition synchronized with the rotation.
- **Height measurement.** On mount, render both faces in the DOM (back face hidden via `backface-visibility`). Measure both heights. Set explicit height to front height. On flip, transition height to back height. Re-measure on resize.
- **Back face design.** Same card chrome (author header, source reference, position). Body shows `original_excerpt` in italic Literata at `--text-original` size. A "Show translation ↻" button to flip back.
- **Flipped cards can still be swiped.** While viewing the back, drag-to-dismiss still works. Next card appears front-face-up.

### Chapter-aware progress
- **`has_chapters` flag in book metadata.** Added to `BookConfig` in the pipeline and written to `_meta.json` during assembly. Only Meditations gets `true` — it has 12 real author-defined chapters ("Book 1"–"Book 12"). All other books have editorial section splits that aren't meaningful landmarks. Derived from `!!config.chapterGrouping` in the assembler.
- **Segmented progress bar (when `has_chapters: true`).** The thin bar at the top gets subtle tick marks at each chapter boundary. Chapter segments are proportional to their card counts. The fill advances through the current chapter's segment. Crossing a chapter boundary is a visible threshold — a small moment of progress.
- **Simple linear progress bar (when `has_chapters: false`).** Current behavior, unchanged. For books like Enchiridion (51 sections, most with 1 card), segmentation would be noise.
- **Chapter-contextualized card position (when `has_chapters: true`).** The card position shows "Book 3 · 7 / 17" — chapter name in the author's accent color, dot separator, then chapter-local progress in secondary text. Always visible on every card, so the reader always knows where they are even on a shared link or mid-session resume. The ChapterMarker above the card is a separate celebratory moment at chapter transitions only.
- **Global card position (when `has_chapters: false`).** Card position shows "47 / 97" as today. For shorter books this already feels achievable.

### Micro-delights
- **Chapter transition marker.** When the current card is the first card of a new chapter (and not the first chapter), and `has_chapters` is true, show a quiet "Book 3" label centered above the card. UI font, author accent color, fade-in.
- **No counter animation.** The position is printed on the card — animating it independently would break the physical metaphor. It updates naturally when the new card appears.
- **Reading time hint.** Display `reading_time_seconds` from card data as "~30s read" next to the card position. UI font, secondary text color. Subtle, never pushy — just sets expectations. Data already exists on every card.

### Shared
- **`prefers-reduced-motion` disables all physics.** Gestures still navigate/flip, but instantly. No drag-follow, rotation, fly-off, flip animation, or shadow lift.
- **No new dependencies.** Pure pointer events + CSS transforms.
- **Keyboard and button nav unchanged.** ArrowLeft/Right and Previous/Next buttons work as before.

## Files
- `scripts/lib/constants.ts` — add `has_chapters` to `BookConfig` interface, set `true` on Meditations.
- `scripts/lib/types.ts` — add `has_chapters: boolean` to `BookMeta` interface.
- `scripts/lib/assembler.ts` — read `has_chapters` from config (derived from `!!config.chapterGrouping`), write it to `_meta.json`.
- `web/src/lib/components/CardSwipe.svelte` — **new**: card stack + drag physics engine. Pointer tracking, velocity, throw/snap-back, shadow lift, next-card scale-up.
- `web/src/lib/components/Card.svelte` — refactor: front/back faces, CSS 3D flip, animated height, muted prop, flip affordance, reading time hint, chapter-aware position display.
- `web/src/lib/components/CardNav.svelte` — **reduce**: keep only prev/next button strip.
- `web/src/lib/components/ChapterMarker.svelte` — **new**: chapter transition label shown at chapter boundaries (has_chapters books only).
- `web/src/lib/components/ProgressBar.svelte` — add segmented mode: tick marks at chapter boundaries when `has_chapters` + chapter data provided.
- `web/src/routes/[book]/[chapter]/[card]/+page.svelte` — wire up CardSwipe, ChapterMarker, pass card + nextCard data, integrate milestone/progress logic, pass chapter info to ProgressBar.
- `web/src/app.css` — add `--transition-throw`, `--transition-flip` tokens.
- `web/tests/e2e/card-swipe.spec.js` — **new**: Playwright e2e tests for swipe, flip, chapter marker, progress bar.

## Constraints
- Ease-out only, no bounce/spring/overshoot (BRANDING.md)
- Animate the card container, never individual text (BRANDING.md: "Text never moves")
- `prefers-reduced-motion` disables all motion
- Touch targets ≥44×44px
- Must not break milestone modal flow
- Existing keyboard nav preserved
- No new npm dependencies
- Existing e2e and pipeline tests must still pass
- Pipeline change requires re-running `assemble` phase to regenerate `_meta.json` files
- **Visual verification via Playwright screenshots at each milestone task** — capture and review screenshots against BRANDING.md (typography, color, spacing, warmth) before proceeding

## Tasks
- [x] T01: Pipeline — has_chapters flag — Add `has_chapters?: boolean` to `BookConfig` in `scripts/lib/constants.ts` (set `true` on Meditations only). Add `has_chapters: boolean` to `BookMeta` in `scripts/lib/types.ts`. In `assembler.ts`, set `meta.has_chapters = !!config.chapterGrouping`. Run `npm test` to verify pipeline tests pass. Files: `scripts/lib/constants.ts`, `scripts/lib/types.ts`, `scripts/lib/assembler.ts`
- [x] T02: Regenerate _meta.json files — Run `npx tsx scripts/generate.ts --all --phase assemble` to regenerate all `_meta.json` files with the new `has_chapters` field. Verify Meditations `_meta.json` has `"has_chapters": true` and others have `"has_chapters": false`. Files: `content/output/*/_meta.json`, `web/src/content/*/_meta.json`
- [x] T03: Playwright test spec — Write `web/tests/e2e/card-swipe.spec.js` with tests: (1) card renders with `.card-front` visible, (2) next card visible below (`.card-muted`), (3) pointer drag past threshold navigates to next URL, (4) flip button toggles card and shows original text, (5) nav buttons work, (6) keyboard ArrowRight works, (7) chapter marker visible at chapter boundary (Meditations), (8) reading time hint visible, (9) segmented progress bar on Meditations, (10) simple progress bar on Enchiridion. Tests fail initially. Files: `web/tests/e2e/card-swipe.spec.js` (new)
- [x] T04: Update existing e2e tests — Update selectors in card-navigation.spec.js for new structure. Remove "swipe right to previous" test. Update "Show original" test to use flip button instead of `<details>`. Files: `web/tests/e2e/card-navigation.spec.js`
- [x] T05: Design tokens — Add `--transition-throw: 200ms ease-out` and `--transition-flip: 400ms ease-out` to `:root`. Set both to `0ms` under `prefers-reduced-motion`. Files: `web/src/app.css`
- [x] T06: Card front/back faces + flip — Refactor `Card.svelte`: replace `<details>` toggle with front/back face structure. Front: existing content + "Show original ↻" button + reading time hint. Back: author header + `original_excerpt` italic + source ref + "Show translation ↻" button. CSS 3D: `perspective: 1000px`, `transform-style: preserve-3d`, `backface-visibility: hidden`, back face `rotateY(180deg)`. Flip via `flipped` prop, transition `var(--transition-flip)`. Files: `web/src/lib/components/Card.svelte`
- [x] T07: Animated height on flip — Measure front and back face heights on mount. Set explicit `height` on `.card-inner` to front height. On flip, transition height to back height synced with rotation. Re-measure on `resize`. Files: `Card.svelte`
- [x] T08: Screenshot check — card flip — Start dev server, capture Playwright screenshots of card front and card flipped (back) at mobile (390×844) and desktop (1280×800) in both light and dark mode. Verify: typography matches BRANDING.md (Literata for text, DM Sans for UI), color palette correct, flip affordance button visible and meets 44px touch target, back face original text is italic with proper secondary color, spacing feels bookish not app-like. Read screenshots and fix any visual issues before proceeding. Files: screenshots only
- [x] T09: Chapter-aware card position — When `book.has_chapters` is true, show "Book 3 · 7 / 17" — chapter title in author accent color, dot separator, chapter-local card position. Requires passing the chapter title (from `book.chapters` array, matched by `card.chapter_slug`) to the Card component. When false, show "47 / 97" (global position, current behavior). Files: `Card.svelte`, `+page.svelte` (pass chapter title)
- [x] T10: Card muted state (implemented in T06) — Add `muted` prop. When muted: `opacity: 0.4`, `pointer-events: none` on interactive children, `aria-hidden="true"`, flip hidden. Files: `Card.svelte`
- [x] T11: Segmented ProgressBar — When `has_chapters` is true and `chapters` array provided, render tick marks at chapter boundaries. Each segment width is proportional to its `card_count / total_cards`. Tick marks use `--color-border` with slightly stronger opacity. When `has_chapters` is false, render simple linear bar (current behavior). Files: `web/src/lib/components/ProgressBar.svelte`
- [x] T12: ChapterMarker component — Create `ChapterMarker.svelte`. When `book.has_chapters` is true and `card.chapter_slug !== prevCard?.chapter_slug` and prevCard exists, renders the chapter title centered above the card. Author accent color, UI font, fade-in. When `has_chapters` is false, renders nothing. Files: `web/src/lib/components/ChapterMarker.svelte` (new)
- [x] T13: Screenshot check — progress + chapter — Capture screenshots of: (a) Meditations card page showing segmented progress bar with tick marks + ChapterMarker above card + chapter-local position on card, (b) Enchiridion card page showing simple linear progress bar + global position. Both at mobile + desktop, light + dark. Verify: tick marks are subtle not dominant, chapter marker uses correct author accent color, position text is readable, overall visual warmth matches BRANDING.md. Fix any issues. Files: screenshots only
- [x] T14: Strip CardNav to buttons only — Remove all pointer/touch/swipe handling from CardNav. Keep only the prev/next button strip. Files: `web/src/lib/components/CardNav.svelte`
- [x] T15: CardSwipe — drag tracking + shadow lift + next-card scale — Create `CardSwipe.svelte`. Stack container with top (current) and bottom (next, muted) layers. Pointer tracking: `pointerdown`/`pointermove`/`pointerup`. Transform: `translate(dx, dy) rotate(clamp(dx*0.04, -6, 6)deg)`. Shadow: `box-shadow` scales with drag distance (0 → max). Bottom card: `transform: scale(lerp(0.97, 1.0, dragProgress))`. Velocity buffer: last 4 positions + timestamps. `touch-action: none`, `cursor: grab/grabbing`, `user-select: none` during drag. Files: `web/src/lib/components/CardSwipe.svelte` (new)
- [x] T16: CardSwipe (implemented with T15) — throw + snap-back — On pointerup: velocity from last 2 events. If velocity > 0.5px/ms OR offset > 30% viewport → throw: animate off-screen via CSS transition `var(--transition-throw)`, fire `onDismiss` on `transitionend`. Else snap back (0,0,0°). Any direction = forward. No next card = always snap back. Files: `CardSwipe.svelte`
- [x] T17: Wire up page — Replace CardNav wrapping in `+page.svelte` with CardSwipe. Top slot: `Card` (active). Bottom slot: `Card` (muted, next card data). Above stack: `ChapterMarker`. Pass `has_chapters` and `chapters` to ProgressBar. Wire `onDismiss` → `handleNavigateNext()` → `goto()`. Reset flip on navigation. CardNav buttons below stack. Milestone modal unchanged. Files: `web/src/routes/[book]/[chapter]/[card]/+page.svelte`
- [x] T18: Screenshot check — full card stack — Capture screenshots of the complete card page with stack visible (current card + muted next card underneath). Mobile + desktop, light + dark. Verify: muted card is visible but clearly secondary, card stack layering looks correct, nav buttons positioned below stack, reading time hint visible, overall layout feels calm and bookish. Verify the card page on the first card of a book (should show "Beginning of..." boundary text) and a mid-book card. Fix any issues. Files: screenshots only
- [x] T19: Reduced motion + a11y — Gate all transforms/transitions on `prefers-reduced-motion`. Drag past threshold = instant `goto()`. Flip = instant toggle. No shadow, no scale, no rotation. `aria-live="polite"` on card. Flip button `aria-label`. Reading time has `aria-label`. Progress bar segments have appropriate aria attributes. Files: `CardSwipe.svelte`, `Card.svelte`, `ProgressBar.svelte`
- [x] T20: Dark mode (verified — no changes needed) + high contrast polish — Verify shadow lift colors in dark mode (softer shadow). Muted card opacity in dark/high-contrast. Chapter marker contrast. Progress bar tick marks visible in both themes. Capture final screenshots in dark mode + high contrast at mobile + desktop. Compare against BRANDING.md dark mode palette. Files: all changed components, `app.css`
- [x] T21: Run tests + final verification — Run `npm test` (pipeline + unit). Run Playwright card-swipe and card-navigation specs. Fix failures. Run full e2e suite. Final screenshot pass: capture one Meditations card and one Enchiridion card at mobile + desktop, light + dark — 8 screenshots total. Read each screenshot to verify the complete experience matches BRANDING.md guidelines.

## Verify
```bash
npm test
npx playwright test --project desktop-chrome tests/e2e/ --prefix web
```
