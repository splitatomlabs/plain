# Plan 03: Card Reading Experience

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Depends on
- `plans/Pd4e7a-sveltekit-app-02.md` — needs content utilities, JSON files, TagPill component

## Objective
Build the core reading experience: card component, swipe/tap/keyboard navigation, the `/[book]/[chapter]/[card]` route with ISR, progress bar, "Show original" toggle, and responsive card layout.

## Decisions
- Card navigation uses touch events (swipe) on mobile, click zones on tablet/desktop, keyboard arrows everywhere. No external gesture library — use native `touchstart`/`touchend` with a swipe threshold (~50px).
- ISR via Vercel adapter: `expiration: 86400` (daily revalidation). Cards are server-rendered on first visit, cached at edge thereafter.
- "Show original" uses native `<details>`/`<summary>` for accessibility (built-in `aria-expanded`). Styled to match design.
- Card-to-card transitions respect `prefers-reduced-motion`. When motion allowed: subtle horizontal slide (150ms ease-out). When reduced: instant swap.
- Progress bar is a thin line at top of viewport showing position within the book (not chapter).
- Page pre-fetches adjacent cards via SvelteKit `data-sveltekit-preload-data` for instant navigation feel.

## Files
All paths relative to `web/`.
- `src/lib/components/Card.svelte` — Core card reading component
- `src/lib/components/CardNav.svelte` — Swipe/tap/keyboard navigation wrapper
- `src/lib/components/ProgressBar.svelte` — Thin top-of-screen progress bar
- `src/routes/[book]/[chapter]/[card]/+page.svelte` — Card reading view
- `src/routes/[book]/[chapter]/[card]/+page.server.js` — Load card data, ISR config
- `tests/e2e/card-navigation.spec.js` — E2E card reading flow
- `tests/e2e/theme.spec.js` — E2E theme toggle and persistence

## Constraints
- Card text is the hero — minimal chrome around it. See BRANDING.md "the text is the product"
- Touch targets ≥44×44px for prev/next tap zones and all buttons
- `aria-live="polite"` on card container so screen readers announce new card content
- Swipe only triggers navigation, never scroll — horizontal swipe on the card area only
- Max line width ~65 characters on card text, centered
- Card page must work as a standalone landing page (for shared links) — full context without prior navigation

## Tasks
- [x] T01: Create Card.svelte component — Renders: author context at top (name + title, e.g., "Marcus Aurelius — The Emperor", small text in DM Sans with author accent color), plain_english text as primary content (Literata, 18-20px), `<details>`/`<summary>` "Show original" toggle with original_excerpt in smaller muted italic, source_reference at bottom (secondary text), tag pills row using TagPill component, card position indicator ("47 / 120" in secondary text). Props: card data object, book metadata. `<article>` semantic wrapper. Centered layout, max-width 65ch for text.
- [x] T02: Create CardNav.svelte component — Wraps Card.svelte. Handles three input methods: (1) Touch — detect horizontal swipe via touchstart/touchend, threshold 50px, navigate on swipe left (next) / right (prev). (2) Click zones — invisible left/right 20% tap targets on desktop/tablet with subtle hover cursor hints. (3) Keyboard — ArrowLeft/ArrowRight listeners (attached to window, cleaned up on destroy). Navigates via `goto()` to adjacent card URLs. Includes prev/next link elements for accessibility and SEO. Shows subtle next-card affordance (small chevron) on right side. Respects `prefers-reduced-motion` for transition animations.
- [x] T03: Create ProgressBar.svelte — Thin bar (3px) at top of viewport, fixed position. Shows reading position within the entire book: `current_card_index / total_cards`. Uses author accent color. Includes `role="progressbar"` with `aria-valuenow`, `aria-valuemin="0"`, `aria-valuemax`, and `aria-label` (e.g., "Reading progress: 47 of 120 cards"). Smooth width transition (unless reduced motion).
- [x] T04: Build card page route — Create `src/routes/[book]/[chapter]/[card]/+page.server.js`: validates params, calls getCard() and getBookMeta(), calls getAdjacentCard() for prev/next, throws 404 if card not found. ISR config: `{ isr: { expiration: 86400 } }`. Returns card, book meta, prevCard, nextCard. Create `+page.svelte`: renders ProgressBar + CardNav wrapping Card. Sets page title and meta description from card data.
- [~] T05: Add OG meta tags to card pages — In card `+page.svelte`, use `<svelte:head>` to set: `og:title` ("Meditations, Book 5.16 — In Plain English"), `og:description` (first ~150 chars of plain_english), `og:type` ("article"), `og:url`, `twitter:card` ("summary_large_image"). OG image URL placeholder for now (implemented in Plan 04). Ensures shared card links show rich previews.
- [ ] T06: Style card reading view — Apply full BRANDING.md card reading styles. Light mode: card on #FFFFFF surface with #E8E2D9 border, #FAF7F2 page background. Dark mode: card on #252220 surface with #33302B border, #1A1816 background. Typography: Literata 18-20px / 400 / 1.6 line-height for plain text, 14px italic muted for original excerpt, DM Sans 13-14px for UI elements. Responsive: full-width card on mobile (with padding), max-width centered card on desktop. Tag pills wrap naturally. Ensure the view feels calm and book-like per brand principles.
- [ ] T07: Handle edge cases — First card of book: no previous link, show "Beginning of [Book Title]" indicator. Last card of chapter: next links to first card of next chapter (seamless cross-chapter reading). Last card of book: next triggers completion flow (placeholder — just shows "You've finished!" text for now, fully built in Plan 04). Invalid card numbers: 404 page. Ensure getAdjacentCard handles all chapter/book boundary transitions.
- [ ] T08: Add prefetching and navigation UX — Add `data-sveltekit-preload-data="hover"` to prev/next navigation links for instant feel. On card transition: manage focus to new card content for screen reader announcement (move focus to the `<article>` or use `aria-live`). Ensure browser back/forward works correctly with card navigation. Test: navigate through several cards, use browser back button, verify correct card loads.
- [ ] T09: E2E card navigation tests — `tests/e2e/card-navigation.spec.js`: navigate to `/meditations/book-01/1`, verify card text visible, click next → card 2 loads, keyboard ArrowRight → card 3, keyboard ArrowLeft → back to card 2, "Show original" toggle expands/collapses, tag pills are clickable links, progress bar updates. Test on both mobile and desktop viewports. Test chapter boundary navigation.
- [ ] T10: E2E theme tests — `tests/e2e/theme.spec.js`: verify default theme matches system preference, click toggle → verify theme changes, reload → verify theme persists. Verify card page renders correctly in both light and dark mode.
- [ ] T11: Verify card experience — Run unit tests (`npm run test:unit`), build, and run full Playwright suite including new card navigation and theme E2E tests. Fix any failures before completing this plan.

## Verify
```bash
cd web && npm run test:unit
cd web && npm run build && npx playwright test
```
