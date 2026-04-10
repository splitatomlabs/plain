# Plan 04: Progress, Sharing & Analytics

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Depends on
- `plans/Pd4e7a-sveltekit-app-03.md` — needs card reading route, Card.svelte, navigation

## Objective
Implement localStorage progress tracking, returning-reader home page, milestone celebrations, completion page, sharing system (Web Share API, OG images, gift-a-book), and Vercel Analytics with custom events.

## Decisions
- Progress store is a Svelte writable store that syncs to/from localStorage on every write. SSR-safe: returns empty/default state during server render, hydrates from localStorage on mount.
- Card marked "read" on navigation to next card (not on page load) — prevents inflating progress from shared links.
- Milestone modal fires once per threshold per book (25/50/75/100%). Tracked in localStorage to prevent re-triggering.
- OG images via `@vercel/og` (uses Satori under the hood). Serverless function at `/api/og/[cardId]`. Returns PNG, cached with long `Cache-Control`.
- Vercel Analytics: install `@vercel/analytics`, inject at root layout. Custom events fired from progress store, not UI components. Respect `navigator.doNotTrack`.
- Gift-a-book: note encoded as base64 in URL query param. No database needed.

## Files
All paths relative to `web/`.
- `src/lib/stores/progress.js` — Writable Svelte store with localStorage sync
- `src/lib/components/ProgressRing.svelte` — Circular SVG progress indicator
- `src/lib/components/MilestoneModal.svelte` — Celebration interstitial dialog
- `src/lib/components/ShareButton.svelte` — Web Share API with clipboard fallback
- `src/lib/components/GiftBanner.svelte` — Gift note display for recipients
- `src/routes/completed/[book]/+page.svelte` — Completion celebration + share
- `src/routes/completed/[book]/+page.server.js` — Load book meta for completion page
- `src/routes/api/og/[cardId]/+server.js` — OG image generation endpoint
- `src/lib/analytics.js` — Analytics wrapper with doNotTrack check
- `src/routes/+page.svelte` — Updated home page with returning-reader layout
- `src/routes/+layout.svelte` — Updated to include analytics script

## Constraints
- Progress store must be SSR-safe — no `window` or `localStorage` access during server render
- Milestone modal traps focus while open, returns focus on close, uses `role="dialog"` + `aria-labelledby`
- Share button must work without Web Share API (clipboard fallback for desktop)
- OG images must render plain text legibly — Literata font, clean background, no clutter
- Analytics: skip all tracking if `navigator.doNotTrack === '1'` or during local dev
- No streaks, no guilt, no pressure — progress is encouraging, never punishing

## Tasks
- [ ] T01: Build progress store — Create `src/lib/stores/progress.js`. Writable store keyed to `plain-progress` in localStorage. Schema per ARCHITECTURE.md: `{ [bookSlug]: { cards_read: [], last_card, last_read_at, completed, completed_at } }`. Exports: `markCardRead(bookSlug, cardId)`, `getProgress(bookSlug)` → `{ cardsRead, totalCards, percentage, lastCard }`, `getAuthorProgress(authorSlug)` → `{ cardsRead, totalCards, percentage }`, `getLastReadBook()` → bookSlug or null, `isCompleted(bookSlug)`, `markCompleted(bookSlug)`. SSR-safe: use `browser` check from `$app/environment`. Initialize from localStorage on first client access. Sync back on every mutation.
- [ ] T02: Build favorites store — Extend progress.js or create alongside it. localStorage key `plain-favorites` (string array of card IDs). Exports: `toggleFavorite(cardId)`, `isFavorite(cardId)`, `getFavorites()`. Add heart/favorite button to Card.svelte — icon toggles filled/outline, `aria-label` announces state.
- [ ] T03: Wire progress to card navigation — In CardNav.svelte, when user navigates to next card: call `markCardRead(bookSlug, currentCardId)`. Do NOT mark on page load (prevents shared-link inflation). Update `last_card` and `last_read_at` timestamps. After marking, check if milestone threshold crossed (25/50/75/100%) — if so, trigger milestone event.
- [ ] T04: Build MilestoneModal component — `role="dialog"`, `aria-labelledby` heading, focus trap (tab cycles within modal), Escape to close, returns focus to trigger element. Content varies by milestone: 25% "Quarter of the way through [Book]", 50% "Halfway through [Book]", 75% "Almost there", 100% triggers redirect to `/completed/[book]`. Styled: warm, celebratory but calm — no confetti, no gamification excess. Track shown milestones in localStorage `plain-milestones` to prevent re-triggering. Animation respects `prefers-reduced-motion`.
- [ ] T05: Build ProgressRing component — SVG circle with stroke-dasharray for progress arc. Props: percentage, size, accent color (author-specific), label. Includes `role="img"` with `aria-label` ("Meditations: 47 of 120 cards read, 39%"). Used on returning-reader home page for per-author progress overview. Animated fill on mount (unless reduced motion). Three sizes: small (for book cards), medium (for home page author rings).
- [ ] T06: Update home page for returning readers — Detect progress via store. If any book has progress: show returning-reader layout per ARCHITECTURE.md. Top: three author progress rings side by side (Slave → Emperor → Senator order). Below: "Continue Reading" banner linking to last-read card. Then author sections with book-level progress bars and "Continue" / "Start" CTAs. If no progress: show existing new-visitor layout (Marcus first). Responsive: rings stack on mobile, row on desktop.
- [ ] T07: Build completion page — Create `/completed/[book]` route. Server load: fetch book meta, validate slug. Page: congratulatory heading ("You just read all of [Book Title]"), author attribution, book stats (total cards, estimated reading time). Share CTA with generated completion image. "What to read next" suggestion (another book by same author, or different author). Warm, celebratory but restrained tone.
- [ ] T08: Build ShareButton component — Checks `navigator.share` availability. If available: uses Web Share API with title, text (first ~100 chars of plain_english), and URL. If not: copies URL to clipboard with "Copied!" toast feedback. Props: shareData object (title, text, url). `aria-label="Share this card"`. Styled: minimal icon button, meets 44×44px touch target. Add to Card.svelte.
- [ ] T09: Build OG image endpoint — Create `src/routes/api/og/[cardId]/+server.js`. Parses cardId, loads card data via content utils. Uses `@vercel/og` (ImageResponse) to render: plain_english text (Literata-style), source reference, author name, "Plain" branding small in corner. Clean, warm background matching light theme. Returns PNG with `Cache-Control: public, max-age=31536000, immutable`. Also handle completion OG images: `/api/og/completed-[bookSlug]`. Update card page `<svelte:head>` to point `og:image` to this endpoint.
- [ ] T10: Build gift-a-book feature — On book landing page, add "Send this book to a friend" button. Generates URL: `/[book]?gift=true&note={base64note}`. Create `GiftBanner.svelte`: if URL has `gift=true`, show a warm banner at top of book page with decoded note text, book description, author bio, and "Start reading" CTA. Uses Web Share API or clipboard to share the gift URL. Note input: simple textarea in a small modal/popover, max 280 characters.
- [ ] T11: Implement analytics — Install `@vercel/analytics`. Create `src/lib/analytics.js`: `trackEvent(name, properties)` wrapper that checks `navigator.doNotTrack !== '1'` and `!dev` environment. Inject analytics script in root layout. Fire events per ANALYTICS.md from the progress store layer: `book_started` (first card read in a book), `engaged_session` (2nd card in first-ever session), `milestone_reached`, `book_completed`, `share_clicked`, `return_visit` (>24h since last visit), `tag_explored` (from TagPill clicks), `book_landing_viewed` (from book page load). Track `plain:first_session` and `plain:session_card_count` in localStorage for first-session funnel.
- [ ] T12: Integration test — Full reading flow: start from home → pick a book → read 3 cards → verify progress updates on home page → verify milestone modal at appropriate threshold → share a card → check OG meta tags. Test gift URL flow. Verify analytics events fire in browser console (dev mode). Test with `prefers-reduced-motion` enabled. Test at mobile and desktop widths.

## Verify
```bash
cd web && npm run build
cd web && npm run preview
cd web && npm run test:unit
```
