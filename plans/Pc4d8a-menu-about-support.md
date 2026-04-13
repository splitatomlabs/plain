# Main Menu, Footer, About & Support Pages

## Objective
Add About and Support static pages, footer links on every page, a main menu drawer in the header, a book-landing "How this translation was made" link, and a gentle Ko-fi line on the completion screen.

## Decisions
- Store Ko-fi URL + Split Atom Labs URL as constants in `web/src/lib/config.js` (project uses `.js`, not `.ts`).
- Main menu = simple drawer/popover triggered by a hamburger button in `+layout.svelte`, sitting next to the theme toggle. Drawer slides in with ease-out only (per BRANDING.md motion rules). Closes on Esc, outside click, and route change.
- Menu contents: Home, About, Support. Mirrors footer link set.
- Footer: replace current single tagline with tagline + inline link row ("About · Support") using existing `--font-ui` / secondary-text tokens. No new colors.
- About/Support pages: plain static Svelte routes under `web/src/routes/about/+page.svelte` and `web/src/routes/support/+page.svelte`. Copy rendered as semantic HTML (h1/h2/p/ul), using same typography tokens as existing pages. Max width `--max-line-width`. No new components.
- Completion screen: append a single optional paragraph under the stats/next-book block with text "If Plain helped you finish this, you can support the project." linking "support the project" to Ko-fi. No analytics hook.
- Book landing: add a small muted link "How this translation was made" directly under `.book-description`, pointing to `/about`. Uses `--text-ui` and `--color-text-secondary`.
- Do NOT add a `donation_click` analytics event.

## Files
- `web/src/lib/config.js` — NEW. Exports `KOFI_URL`, `SPLIT_ATOM_LABS_URL`.
- `web/src/lib/components/MainMenu.svelte` — NEW. Hamburger button + drawer with Home/About/Support links.
- `web/src/routes/+layout.svelte` — mount `<MainMenu />` in header; update footer to include About/Support links.
- `web/src/routes/about/+page.svelte` — NEW static page with full ABOUT copy + `<svelte:head>` title/description.
- `web/src/routes/support/+page.svelte` — NEW static page with full SUPPORT copy; uses `KOFI_URL` for the Ko-fi button and links `/about`.
- `web/src/routes/[book]/+page.svelte` — add "How this translation was made" link under `.book-description`.
- `web/src/routes/completed/[book]/+page.svelte` — add single Ko-fi support line (uses `KOFI_URL`).
- `web/tests/e2e/navigation.spec.js` — NEW. Asserts footer links + menu open/navigate to /about and /support from home, book landing, and reading page.
- `web/tests/e2e/book-landing.spec.js` — update: expect "How this translation was made" link pointing to `/about`.

## Constraints
- Follow `docs/BRANDING.md`: typography-first, no decorative chrome, ease-out only, exit faster than enter, no text animation, no new colors outside the palette.
- Existing CSS variables only (`--color-*`, `--space-*`, `--font-*`, `--text-ui`, `--transition-fast`).
- No new dependencies.
- Menu drawer must be keyboard-accessible (focus trap while open, Esc closes, focus returns to trigger). Matches existing accessibility patterns (`skip-link`, aria labels on theme toggle).
- No tracking of support interactions — do not import `analytics.js` for the new links.
- Keep mobile layout clean at 390px width; drawer should overlay, not push content.
- After UI changes, rebuild web app and run e2e per CLAUDE.md instructions.

## Tasks
- [x] T01: Add `web/src/lib/config.js` exporting `KOFI_URL = 'https://ko-fi.com/splitatomlabs'` and `SPLIT_ATOM_LABS_URL = 'https://splitatomlabs.com'`. Acceptance: importable from `$lib/config.js`. DONE: created `web/src/lib/config.js`.
- [x] T02: Create `web/src/routes/about/+page.svelte` with full About copy as semantic HTML, `<svelte:head>` title "About — Plain" and description, same layout constraints as completion page (`max-width: var(--max-line-width)`, body font, h1/h2 sizing matching existing pages). Link Split Atom Labs using `SPLIT_ATOM_LABS_URL` constant. Acceptance: route loads, copy matches spec verbatim, typography matches branding.
- [x] T03: Create `web/src/routes/support/+page.svelte` with full Support copy. Primary "Donate on Ko-fi →" styled as the unified primary CTA used elsewhere (match existing button style from home/completion). Use `KOFI_URL` and `SPLIT_ATOM_LABS_URL`. Include `/about` link. Acceptance: route loads, copy matches spec verbatim, Ko-fi button visually consistent with primary CTA.
- [x] T04: Update `web/src/routes/+layout.svelte` footer: render tagline plus a small link row containing "About" and "Support" (separator · or gap). Use `--font-ui`, `--text-ui`, secondary text color. Acceptance: every route shows footer with both links; links navigate.
- [x] T05: Create `web/src/lib/components/MainMenu.svelte` — hamburger button (`aria-label="Open menu"`, `aria-expanded`, `aria-controls`) + drawer panel with Home/About/Support nav. Ease-out transition only, exit faster than enter, Esc/outside-click/route-change close, focus management, body scroll lock while open. Acceptance: component keyboard-accessible, matches branding motion rules.
- [ ] T06: Mount `<MainMenu />` in `+layout.svelte` header beside theme toggle. Acceptance: menu visible on every page; header layout unchanged at desktop and mobile widths.
- [ ] T07: Update `web/src/routes/[book]/+page.svelte` — add small muted link "How this translation was made" directly under `.book-description`, href `/about`. Style with `--font-ui`, `--text-ui`, `--color-text-secondary`, underline offset consistent with other inline links. Acceptance: link present on every book landing, visually subordinate to description.
- [ ] T08: Update `web/src/routes/completed/[book]/+page.svelte` — append a single `<p class="support-line">` containing "If Plain helped you finish this, you can [support the project]." with anchor using `KOFI_URL` (target=_blank, rel="noopener"). Place after `.next-book` / before `.home-link`. Muted secondary color, `--font-ui`. Acceptance: line renders once, no analytics call, no special emphasis.
- [ ] T09: Add `web/tests/e2e/navigation.spec.js` covering: footer About/Support links visible and navigate correctly from `/`, from a book landing, and from a reading route; main menu hamburger opens drawer, drawer shows Home/About/Support, Esc closes, each link navigates. Acceptance: tests pass against built app.
- [ ] T10: Update `web/tests/e2e/book-landing.spec.js` to assert the "How this translation was made" link is present and points to `/about`. Acceptance: existing assertions still pass; new assertion added.
- [ ] T11: Build web app and run full test suite: `npm test` then `npm run build --prefix web && npm run test:e2e --prefix web`. Fix any regressions (selector scoping, etc.). Acceptance: all suites green.

## Verify
```
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
