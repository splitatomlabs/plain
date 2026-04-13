# Home Page Refinements

## Objective
Polish home page visual details: ring layout at iPhone 17 width, theme link affordance, tag icon elegance, subtler milestone treatment, capped book grid, and a clearer clickability model for book cards.

## Decisions

### Refinement 6 — Book card clickability (card overlay link pattern)
Currently `.book-card` is a bordered, padded article containing a linked title and a "Continue / Start Reading" pill. That border + pill is exactly the visual vocabulary of the page's buttons (tag icons, continue-banner, theme-cta), so the card reads as button-shaped without acting like one.

**Direction: make the card a real link to the book TOC, with the CTA pill as a second, overlaid link for the fast-path action.**

Why not a single link:
- If the whole card goes to resume/start, the book TOC page at `/{book.slug}` becomes unreachable from home — that's where chapter lists, descriptions, and "read again" live.
- If we remove the inner CTA, we lose the one-tap resume behavior that returning users rely on.

Why not two nested anchors: invalid HTML and screen-reader ambiguity.

**Solution — standard "card as link with secondary action" pattern:**
- Card root is a non-interactive wrapper (`<article>` keeps semantics).
- A `.card-link` anchor inside the card targets `/{book.slug}` and is expanded via `::after { position: absolute; inset: 0 }` so the entire card surface is its hit area.
- The `.cta` anchor stays a real `<a>` for the resume/start URL, given `position: relative; z-index: 1` so clicks on it are NOT captured by the overlay.
- The title text and description are NOT separately wrapped in anchors — they're read through the card link via the overlay, eliminating the "two redundant links to the same place" problem.
- Focus order: card-link first (→ TOC), then CTA (→ resume). Both get `:focus-visible` rings.

Result: card clearly looks clickable (because it is — to the TOC), CTA remains a distinct affordance for the fast-path, and the button-shape is no longer a lie.

Completed books: card-link still points to `/{book.slug}`; CTA becomes "Read again" → chapter 1.

### Refinement 4 — Milestone treatment alternatives
Current treatment tints the border, background, icon stroke, and label with tier color (bronze/silver/gold/platinum). This is loud, introduces 4 colors outside the brand palette, and violates "Never make the brand louder than the content" and "Minimal chrome."

Brainstormed alternatives (pick one in T05):
1. **Thin underline beneath the label** in tier color, 1px, ~60% width. Everything else stays in brand neutrals.
2. **A single filled dot** above the count ("● Bronze" style), tier color, 6px.
3. **Tiny tier wordmark** replacing the "N read" line: small-caps "BRONZE · 12 read" in muted tertiary color (no tier hue at all — tier communicated by word, not color).
4. **Icon-stroke-only tint** — keep border/bg/label neutral; only the SVG icon takes the tier color. Subtle but still introduces non-brand hues.
5. **Corner notch** — a 4px filled triangle in the top-right corner, tier color.

**Recommendation baked into the plan: option 3 (wordmark, no color)** — strictly in-brand, legible, communicates progression without competing with content. Author accents are the only sanctioned non-neutral hues in the palette; tier colors don't belong there. If the user prefers visible color, fall back to option 1 (thin underline) as the quietest colored treatment.

## Files
- `web/src/routes/+page.svelte` — ring spacing at ≥402px, theme-cta underline
- `web/src/lib/components/TagIcon.svelte` — lighter stroke-width, redesigned milestone treatment
- `web/src/lib/components/AuthorSection.svelte` — cap book grid at 2 columns
- `web/src/lib/components/BookCard.svelte` — convert card to single `<a>`, CTA becomes styled span
- `web/tests/e2e/*.spec.ts` — update any selector that assumes title-link or CTA-link structure

## Constraints
- Follow `docs/BRANDING.md`: neutrals first, accent colors only for author sections, minimal chrome, no added motion.
- Must not regress keyboard focus / screen-reader semantics when flattening book card.
- Tag icon grid must still fit 3-up at iPhone 17 width (402pt) — don't inflate sizes when dropping the milestone background.
- No nested anchors in `BookCard.svelte`. The card-overlay-link and the CTA must be siblings, not parent/child.

## Tasks

- [x] T01: Fit author rings on one row at ≥402px
  - File: `web/src/routes/+page.svelte`
  - Reduce `.author-rings` gap to `var(--space-md)` on mobile; keep `space-xl` at ≥768px. Add `@media (min-width: 402px)` nudge or use `clamp()` on gap. Set `flex-wrap: nowrap` at ≥402px so rings never break to 2 rows. Verify with `npx playwright screenshot --viewport-size="402,874"` on a returning user state.
  - Acceptance: 3 rings render on a single row at 402px; still wrap gracefully below 390px if labels overflow.

- [x] T02: Underline "Or explore by theme"
  - File: `web/src/routes/+page.svelte`
  - Add `text-decoration: underline; text-underline-offset: 0.2em; text-decoration-color: var(--color-border);` to `.theme-cta`; darken decoration-color on hover. Applies to both `hasProgress` branches (selector is shared).
  - Acceptance: link is clearly underlined in light and dark mode; underline color deepens on hover.

- [x] T03: Lighten tag icon stroke weight
  - File: `web/src/lib/components/TagIcon.svelte`
  - Drop SVG `stroke-width` from `2.5` to `1.75`. Verify icons still read at mobile 3.6rem and desktop 4rem sizes. Take before/after screenshots at 402 and 1280.
  - Acceptance: icons feel lighter / more elegant while remaining legible.

- [x] T04: Remove loud milestone fill from tag icons
  - File: `web/src/lib/components/TagIcon.svelte`
  - Delete `MILESTONE_STYLES` and all inline `style={tier ? ... : ''}` bindings on border/bg/icon/label. Keep the `milestone` prop — it drives T05 instead.
  - Acceptance: a tag with a milestone renders with the same border/bg/icon/label colors as one without.
  - Notes: Removed `MILESTONE_STYLES` constant, `tier` derived variable, all `style={tier ? ...}` inline bindings on border/bg/icon/label, and the `has-milestone`-specific hover overrides. `milestone` prop retained; `class:has-milestone={milestone}` kept for T05 to hook into. Hover icon color now applies uniformly to all tags.

- [x] T05: Add subtle wordmark milestone indicator
  - File: `web/src/lib/components/TagIcon.svelte`
  - Replace the `{cardsRead} read` span with a milestone-aware line: when `milestone` is set, render `BRONZE · {cardsRead}` (or SILVER/GOLD/PLATINUM) in `var(--color-text-tertiary)`, small-caps-style (`text-transform: uppercase; letter-spacing: 0.05em;`), font-size `0.6875rem`. No tier color. `aria-label` still includes the tier name.
  - Acceptance: visited tags show a quiet wordmark; unvisited tags show nothing extra; screenshot at 402px confirms grid still 3-up.
  - Notes: Added `MILESTONE_TIERS` map `{10:'BRONZE',25:'SILVER',50:'GOLD',100:'PLATINUM'}` and derived `tierName` from the numeric milestone prop. Icon-count span now renders `TIER · {cardsRead}` when a tier is present, or just `{cardsRead}` otherwise (unvisited tags show nothing since `cardsRead` is 0). CSS updated: `color` changed to `--color-text-tertiary`, `opacity` removed, `text-transform: uppercase` and `letter-spacing: 0.05em` added. Desktop font-size nudged to `0.75rem` to keep wordmark from feeling too large. `aria-label` now includes tier name between label and card count.

- [x] T06: Cap book grid to 2 columns at desktop
  - File: `web/src/lib/components/AuthorSection.svelte`
  - Replace `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))` with `repeat(2, minmax(0, 1fr))` inside the `@media (min-width: 768px)` block. Optional max-width on `.author-books` (~56rem) so cards don't stretch absurdly wide on ultrawide screens.
  - Acceptance: at ≥1280px, each author section shows at most 2 book cards per row.

- [x] T07: Rework BookCard using the card-overlay-link pattern
  - File: `web/src/lib/components/BookCard.svelte`
  - Keep root as `<article class="book-card">` with `position: relative`. Drop the `<a class="title-link">` wrapper around the title text — title becomes plain `<h3>`. Add a new `<a class="card-link" href="/{book.slug}" aria-label="About {book.title}">` placed immediately inside the article; style it with `position: absolute; inset: 0;` (or use an `::after`) so the entire card is its click target, and give it a visible `:focus-visible` outline that traces the card border. Keep the CTA as a real `<a class="cta">` with `position: relative; z-index: 1` so it intercepts clicks over the card link. CTA `href` stays `resumeUrl` / `startUrl` / chapter 1 for "Read again". Card hover state: border-color shifts when hovering anywhere on the card (via `.book-card:hover`), CTA pill gets its own hover treatment.
  - Acceptance: clicking the card body navigates to `/{book.slug}`; clicking the CTA navigates to resume/start; both focusable by keyboard in a logical order; no nested anchors; screen reader reads title + description + "About {title}" link + CTA link as distinct targets.
  - Notes: Replaced `<a class="title-link">` wrapping `<h3>` with a plain `<h3 class="book-title">`. Added `<a class="card-link">` as first child of article, styled `position: absolute; inset: 0; z-index: 0` — hits the entire card. `.cta` and all content elements get `position: relative; z-index: 1` so they layer above the overlay. Collapsed the two CTA `{#if}` branches into `ctaHref`/`ctaLabel` derived variables. `.book-card:hover` shifts border-color; `.cta:hover` keeps its own pill treatment. Focus ring on `.card-link:focus-visible` traces the card border.

- [x] T08: Update e2e selectors for new BookCard structure
  - Files: `web/tests/e2e/*.spec.ts` (grep for `title-link`, `book-card a`, `Start Reading`, `Continue`, book-card selectors)
  - Tests that previously clicked the title link should now click `.card-link` (or the card surface). Tests that clicked the CTA stay valid but the selector may need tightening to `.book-card .cta` to avoid matching the overlay link. Run `npm run build --prefix web && npm run test:e2e --prefix web`.
  - Acceptance: full e2e suite passes.
  - Notes: Replaced three `.title-link` selectors in `home-page.spec.js` (lines 101, 106, 112) with `.book-title` to match the plain `<h3 class="book-title">` element. No other e2e files used `title-link`. All 158 e2e tests pass.

- [ ] T09: Visual QA on mobile + desktop
  - Start dev server, capture screenshots at `390,844`, `402,874`, and `1280,800` for both first-time and returning-user home states (seed progress via localStorage in the dev tools or a query param if the app supports one).
  - Acceptance: rings single-row at ≥402px, theme link underlined, book grid 2-up, tag icons elegant, milestone wordmark subtle, book cards clearly clickable as a whole.

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
