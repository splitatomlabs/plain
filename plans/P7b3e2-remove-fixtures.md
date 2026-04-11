# Refresh Test Fixtures from Real Content

## Objective
Replace stale `content/fixtures/` (old schema, grouped chapter files) with a fresh `content-fixtures/` directory extracted from real pipeline output, keeping tests stable and schema-aligned.

## Decisions
- **New top-level `content-fixtures/` directory** replaces `content/fixtures/`. Sibling to `content/`, not nested inside it.
- **Minimal 4-book fixture set:** Meditations (2 chapters, navigation tests), Enchiridion (1 chapter, second author), Shortness of Life + Happy Life (1 chapter each, multi-book author tests). ~30 cards total.
- **Script generates fixtures from real content** — `scripts/extract-fixtures.ts` copies authors.json, extracts configured chapters per book with trimmed _meta.json. Re-runnable after any pipeline regeneration.
- **Tests remain data-agnostic where possible** — use `toBeGreaterThan(0)` for tag queries, derive boundary card numbers from data rather than hardcoding.
- **Remove `CONTENT_DIR` conditional** — Vite test alias always points to `content-fixtures/`, app alias always points to `content/`.
- **Playwright e2e** builds against real `content/` (production-like). Only unit tests use fixtures.

## Files
- `content/fixtures/` — delete
- `content-fixtures/` — new directory with extracted fixture data
- `scripts/extract-fixtures.ts` — new script to generate fixtures from real content
- `web/vite.config.js` — remove `CONTENT_DIR` conditional, test alias → `../content-fixtures`, app alias → `../content`
- `web/playwright.config.js` — remove `CONTENT_DIR=fixtures` from build command
- `web/tests/unit/content.test.js` — update card counts and chapter refs to match extracted fixtures
- `web/tests/unit/progress.test.js` — update totalCards to match fixture count
- `.gitignore` — no changes needed (content-fixtures is gittracked)

## Constraints
- Fixture card counts must remain stable across pipeline reruns (script always takes configured chapters)
- E2e tests build against real content — card URLs like `/meditations/book-01/3` must still work
- `content-fixtures/authors.json` must match `content/authors.json` exactly
- Only 4 books in fixtures — tests for `getBooks` assert 4 not 5, `getBooksForAuthor('seneca')` returns 2 not 3

## Tasks
- [x] T01: Create `scripts/extract-fixtures.ts` — reads real content, copies authors.json, extracts configured chapters per book (meditations: 2, enchiridion: 1, shortness-of-life: 1, happy-life: 1) with trimmed _meta.json. Writes to `content-fixtures/`. Acceptance: running it produces a valid fixture set.
- [x] T02: Run extraction script to generate `content-fixtures/` — verify output: 4 books, 5 chapters, ~30 cards total, valid JSON.
- [x] T03: Update `web/vite.config.js` — remove `CONTENT_DIR` conditional (lines 5-7), set app alias `$content: ../content`, set test alias `$content: ../content-fixtures`.
- [x] T04: Update `web/playwright.config.js` — remove `CONTENT_DIR=fixtures` from build command.
- [x] T05: Update `web/tests/unit/content.test.js` — update `getBooks` to assert 4, `getBooksForAuthor('seneca')` to assert 2, `getAllCards` count to match fixture total, `getChapterCards` count for meditations/book-01, `getAdjacentCard` boundary tests to use real last card numbers from fixtures. Remove `getBooksForAuthor('epictetus')` assertion or update count.
- [x] T06: Update `web/tests/unit/progress.test.js` — update `totalCards` to match fixture count.
- [x] T07: Delete `content/fixtures/` directory.
- [x] T08: Run `npm test` — all tests pass. Grep for remaining references to `content/fixtures` in active code (not plans/complete).

## Verify
```bash
npm test
```
