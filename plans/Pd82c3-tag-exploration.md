# Tag Exploration — Swipeable Theme Cards

## Objective
Transform tag pages from static scrolling lists into a swipeable card stack experience — interleaving authors so the reader hears three perspectives on the same theme. Track tag reading progress separately from book progress, with milestones and home page badges. Make tags a casual, exploratory entry point that can lead readers to full books.

## Decisions

### Card stack experience
- **Reuse CardSwipe from Pb3e7a.** The same drag-to-dismiss physics, card flip for original text, shadow lift, and next-card scale-up. The tag page becomes a card reading view, not a list.
- **Author-interleaved ordering.** Cards are shuffled so the author changes every card when possible: Epictetus → Marcus Aurelius → Seneca → Epictetus → ... Cards from each author are in their natural book order within their "turn." If an author has no more cards, the remaining authors alternate.
- **Deterministic shuffle.** The interleaving is computed server-side so the order is stable across page loads (not random per visit). Seeded by tag slug so each tag has its own consistent sequence.
- **Full Card component, not previews.** Each card renders with the full Card component (front/back flip, author header, tags, source reference). The source reference (e.g., "Meditations, Book 3, Section 5") links to that book's landing page — a subtle nudge toward linear reading.
- **No effect on book progress.** Swiping through tag cards does NOT call `markCardRead` on the book progress store. Tag exploration is casual and separate.

### Tag progress tracking
- **Separate localStorage key: `plain-tag-progress`.** Structure: `{ "calm-your-mind": { cards_read: ["meditations-02-001", ...] }, ... }`. Tracks unique card IDs read per tag.
- **Card marked as "tag-read" on swipe dismiss.** When the user throws a card, the current card's ID is added to the tag's `cards_read` set. Deduped — reading the same card twice doesn't double-count.
- **Fixed count milestones: 10, 25, 50, 100.** Same MilestoneModal component, adapted for tag context. Messages like "You've read 25 cards on Calm Your Mind" rather than percentages. Achievable and consistent across tags regardless of total card count.
- **Tag progress is additive.** A card read during book reading that has the tag also counts toward tag progress (handled by checking the card's tags when marking it read in the book flow). This connects the two modes.

### Home page integration
- **"Browse by theme" section at the bottom** of the home page, after all author sections. Shows all 8 tags as pills or small cards. Each tag shows a progress badge if the user has read any cards in that tag (e.g., "12 read" or a small fill indicator).
- **Secondary CTA in the hero.** A subtle "Or explore by theme" link below the main hero text that anchor-scrolls to the tags section. Lower prominence than the author content — doesn't compete with the core flow.
- **Same treatment for both new and returning visitors.** Tags section appears in both states. For returning visitors, badges show their tag progress.

### Tag index page (`/tags`)
- **Keep the existing grid layout** but add progress badges to each tag card (same as home page). The tag index becomes a dashboard of theme exploration progress.

### Tag detail page (`/tags/[tag]`)
- **Completely replaced.** The scrolling list of card previews grouped by author becomes a single swipeable card stack. Header shows tag name + cards read count + total. CardSwipe stack below. Nav buttons for prev/next fallback.
- **Position indicator.** "12 / 213" on the card shows position within the tag's card sequence (not within a book).
- **Re-entry.** If the user has tag progress, they resume where they left off (tracked via the last card index in the sequence). A "Start from beginning" option is available.

## Files
- `web/src/lib/stores/tagProgress.js` — **new**: tag progress store (localStorage `plain-tag-progress`)
- `web/src/routes/tags/[tag]/+page.svelte` — **rewrite**: scrolling list → swipeable card stack
- `web/src/routes/tags/[tag]/+page.server.js` — update: compute author-interleaved card sequence
- `web/src/routes/tags/+page.svelte` — update: add progress badges to tag cards
- `web/src/routes/tags/+page.server.js` — minor: pass total card counts
- `web/src/routes/+page.svelte` — add "browse by theme" section + hero CTA
- `web/src/routes/+page.server.js` — load tag data with counts for home page
- `web/src/lib/components/Card.svelte` — update: add `linkSource` prop; when truthy, render `source_reference` as `<a href="/{book_slug}">` instead of `<span>`
- `web/src/lib/components/TagPill.svelte` — update: optional progress badge variant
- `web/src/routes/[book]/[chapter]/[card]/+page.svelte` — update: after `markCardRead`, also call `markTagCardRead` for the card's tags
- `web/tests/e2e/tag-exploration.spec.js` — **new**: Playwright tests for tag card stack, progress, milestones

## Constraints
- CardSwipe component exists (from Pb3e7a) with `onDismiss`, `onPromoteStart`, promote phase, and muted styling — no stubbing needed
- Use the `pushState()` + local card buffer pattern from Pc7a91 (seamless card stack) for client-side card navigation in the tag detail page
- Tag progress does NOT affect book progress (`plain-progress` store unchanged for tag reads)
- Book progress DOES feed tag progress (reading a card in a book adds it to relevant tag counts)
- Fixed milestones at 10, 25, 50, 100 — not percentages
- Author interleaving is deterministic (server-side, seeded by tag slug)
- No new npm dependencies
- Verify via Playwright screenshots at milestones
- Visual warmth matches BRANDING.md

## Tasks
- [x] T01: Tag progress store — Create `web/src/lib/stores/tagProgress.js`. localStorage key `plain-tag-progress`. Methods: `markTagCardRead(tagSlug, cardId)` (deduped add to set), `getTagProgress(tagSlug)` → `{ cardsRead: number, cards: string[] }`, `getTagResumeIndex(tagSlug)` → last position in sequence, `setTagResumeIndex(tagSlug, index)`, `hasAnyTagProgress()`. Reactive Svelte store with localStorage sync. Files: `web/src/lib/stores/tagProgress.js` (new)
- [x] T02: Unit tests for tag progress — Test markTagCardRead deduplication, getTagProgress counting, resume index persistence. Files: `web/tests/unit/tagProgress.test.js` (new)
- [x] T03: Author-interleaved card sequence — In `tags/[tag]/+page.server.js`, after loading cards by tag, compute an interleaved sequence: round-robin through authors (epictetus → marcus-aurelius → seneca), taking one card at a time from each author's pile (in natural book order). When an author runs out, continue with remaining authors. Return the flat sequence. Files: `web/src/routes/tags/[tag]/+page.server.js`
- [x] T04: Tag detail page — swipeable stack — Rewrite `tags/[tag]/+page.svelte`. Header: tag name + "12 / 213 read" progress. Below: CardSwipe component with current card (full Card) on top, next card (muted) underneath. Position shows index within the tag sequence. On dismiss: add card to tag progress via `markTagCardRead` for all of the card's tags, advance index. Use `pushState()` + local card buffer pattern from Pc7a91 for client-side card navigation (no `goto()` between cards). Source reference: add a `linkSource` prop to Card.svelte — when truthy (tag context only), render `source_reference` as an `<a>` linking to `/{book_slug}` instead of plain `<span>`. Resume from last position if returning. Files: `web/src/routes/tags/[tag]/+page.svelte`, `web/src/lib/components/Card.svelte`
- [x] T05: Tag milestones — After marking a tag card read, check if cards_read count crossed a milestone threshold (10, 25, 50, 100). If so and not previously shown, display MilestoneModal with tag-specific message (e.g., "You've explored 25 cards on Calm Your Mind"). Store shown milestones in `plain-tag-milestones` localStorage. Files: `tags/[tag]/+page.svelte`, `tagProgress.js`
- [x] T06: Screenshot check — tag detail — Start dev server. Capture screenshots of `/tags/calm-your-mind` at mobile (390×844) and desktop (1280×800), light + dark. Verify: card stack renders with current + muted next card, author interleaving visible (different author colors on consecutive cards), source reference is a link, progress count visible in header. Compare against BRANDING.md. Fix issues. Files: screenshots only
- [x] T07: Connect book progress to tag progress — In the card page's dismiss handler (`web/src/routes/[book]/[chapter]/[card]/+page.svelte`), after calling `markCardRead`, also call `tagProgress.markTagCardRead` for each tag on the active card. The card's tags are already available in the local card state. Do NOT modify `markCardRead`'s signature — keep the coupling at the call site, not inside the store. Files: `web/src/routes/[book]/[chapter]/[card]/+page.svelte`
- [x] T08: Tag progress badges — Update `TagPill.svelte` to accept an optional `progress` prop (number of cards read). When present, display a small badge or count next to the label. Styled subtly — secondary text, small font. Files: `web/src/lib/components/TagPill.svelte`
- [~] T09: Tag index page — progress badges — On `/tags` page, load tag progress from store on mount. Pass cards-read count to each tag card. Display badge on each tag showing progress. Files: `web/src/routes/tags/+page.svelte`
- [ ] T10: Home page — browse by theme section — Add a "Browse by theme" section after all author sections on the home page. Render all 8 tags as TagPills with progress badges. Section heading: "Browse by theme" in UI font. Anchor ID `#themes` for the hero link. Files: `web/src/routes/+page.svelte`
- [ ] T11: Home page — hero secondary CTA — Add "Or explore by theme" link below the hero subtitle (new visitors) and below the continue banner (returning readers). Links to `#themes` anchor. Styled as secondary text link — understated, not competing with main CTA. Files: `web/src/routes/+page.svelte`
- [ ] T12: Screenshot check — home page + tag index — Capture screenshots of home page (new visitor + returning reader states) and `/tags` index at mobile + desktop, light + dark. Verify: theme section visible at bottom, hero CTA present, progress badges render correctly, visual warmth matches BRANDING.md. Fix issues. Files: screenshots only
- [ ] T13: Update e2e tests — Add `web/tests/e2e/tag-exploration.spec.js`: (1) tag detail page renders card stack, (2) swipe dismisses card and advances, (3) author interleaving: first two cards have different `author_slug`, (4) source reference links to book page not card page, (5) tag index shows progress badge when localStorage has data, (6) home page has themes section with anchor link. Update existing tag tests if selectors changed. Files: `web/tests/e2e/tag-exploration.spec.js` (new), existing tag specs
- [ ] T14: Run tests + final screenshots — Run `npm test` (unit tests including new tagProgress tests). Run full Playwright suite. Final screenshot pass: tag detail page, tag index, home page — mobile + desktop, light + dark. Verify against BRANDING.md.

## Verify
```bash
npm test
npx playwright test --project desktop-chrome tests/e2e/ --prefix web
```
