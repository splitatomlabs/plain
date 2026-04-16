# Fix major standalone readability issues in card content

## Objective
Fix 69 cards flagged as "major" standalone readability issues — directly editing content/output/ JSON files without rerunning the pipeline.

## Decisions
- Three fix types: (A) pronoun/reference rewrites — edit `plain_english` only, (B) dangling opener rewrites — add brief context clause, (C) sentence-split merges — combine two cards into one, renumber, update `_meta.json`
- Sentence-split merges (type C) affect 3 pairs: shortness-of-life 02-002/003, discourses 08-001/002, discourses 28-003/004. These require renumbering subsequent cards and updating `_meta.json`.
- All edits must preserve the original meaning and 8th-grade reading level target
- `reading_time_seconds` recalculated after every edit using `Math.max(Math.round((words / 200) * 60), 5)`
- `_meta.json` chapter `card_count`, `reading_time_seconds`, `total_cards`, and `total_reading_time_seconds` updated for any merged chapters
- Write a helper script (`scripts/fix-readability.ts`) to apply all fixes programmatically — reads each card, applies the edit, recalculates reading time, writes back

## Files
- `content/output/enchiridion/section-24.json` — fix 2 cards
- `content/output/enchiridion/section-29.json` — fix 1 card
- `content/output/discourses/of-the-things-which-are-in-our-power-and-not-in-our-power.json` — fix 1 card
- `content/output/discourses/of-progress-or-improvement.json` — fix 1 card
- `content/output/discourses/of-providence.json` — merge 2 cards
- `content/output/discourses/on-the-same.json` — fix 1 card
- `content/output/discourses/how-we-should-struggle-against-appearances.json` — merge 2 cards
- `content/output/discourses/_meta.json` — update counts for merged chapters
- `content/output/meditations/book-01.json` — fix 2 cards
- `content/output/meditations/book-02.json` — fix 2 cards
- `content/output/meditations/book-03.json` — fix 1 card
- `content/output/meditations/book-04.json` — fix 1 card
- `content/output/meditations/book-06.json` — fix 1 card
- `content/output/shortness-of-life/section-02.json` — merge 2 cards
- `content/output/shortness-of-life/section-06.json` — fix 1 card
- `content/output/shortness-of-life/section-07.json` — fix 1 card
- `content/output/shortness-of-life/_meta.json` — update counts for merged chapter
- `content/output/happy-life/section-05.json` — fix 1 card
- `content/output/happy-life/section-08.json` — fix 1 card
- `content/output/happy-life/section-10.json` — fix 1 card
- `content/output/happy-life/section-12.json` — fix 1 card
- `content/output/happy-life/section-14.json` — fix 1 card
- `content/output/happy-life/section-25.json` — fix 2 cards
- `content/output/happy-life/section-26.json` — fix 1 card
- `content/output/peace-of-mind/section-02.json` — fix 1 card
- `content/output/peace-of-mind/section-04.json` — fix 1 card
- `content/output/on-anger/book-1.json` — fix 16 cards
- `content/output/on-anger/book-2.json` — fix 9 cards
- `content/output/on-anger/book-3.json` — fix 13 cards
- `content/output/on-anger/_meta.json` — no merges, but reading times may change
- `scripts/fix-readability.ts` — one-shot fix script (deleted after use)

## Constraints
- Do not rerun the content pipeline
- Preserve original meaning and 8th-grade reading level
- Card IDs, tags, original_excerpt, source_reference, author_slug, book_slug, chapter_slug unchanged
- Merged cards: keep the first card's ID, remove second card, renumber subsequent cards, update total_cards_in_chapter on all cards in that chapter
- reading_time_seconds must be recalculated for every edited card
- _meta.json must be consistent with actual card data after changes
- All existing tests must pass

## Tasks
- [ ] T01: Build fix script scaffold — Create `scripts/fix-readability.ts` with helpers: `readChapter(bookSlug, chapterFile)`, `writeChapter(bookSlug, chapterFile, cards)`, `recalcReadingTime(text)`, `mergeCards(cards, keepIdx, removeIdx)`, `renumberCards(cards)`, `updateMeta(bookSlug)`. The `updateMeta` function reads all chapter files for a book, recalculates card_count, reading_time_seconds per chapter, and total_cards/total_reading_time_seconds.
- [ ] T02: Fix Enchiridion (3 cards) — In fix script, read each card's current plain_english and its neighbor for context. For enchiridion-24-002: add opening clause establishing the philosophical objection being answered. For enchiridion-24-003: same pattern — add context about what choice is being defended. For enchiridion-29-004: replace "all of this" with a brief restatement of the costs of philosophical life. Recalculate reading times. Run updateMeta.
- [ ] T03: Fix Discourses (7 cards, 2 merges) — For discourses-01-002: replace "So which faculty" with a self-contained opening. For discourses-04-003: replace "him" with "the person" or the subject's role. For discourses-08-001 + 08-002: merge into one card (combine plain_english, keep 08-001 ID, remove 08-002, renumber). For discourses-15-001: replace "all this" with the premise. For discourses-28-003 + 28-004: merge into one card (same approach). Run updateMeta.
- [ ] T04: Fix Meditations (7 cards) — For meditations-01-007: replace "From him" with "From Apollonius". For meditations-01-009: replace "He" with "My teacher Sextus". For meditations-02-013: replace "His service" with "The service of your inner spirit". For meditations-02-018: add "First, the soul becomes a wound on the world when it turns against nature. Second,..." or similar restatement. For meditations-03-026: add introductory sentence explaining the philosophical point. For meditations-04-010: replace "These things" with a restatement of what things. For meditations-06-051: complete the truncated thought or rewrite as self-contained reflection. Recalculate reading times. Run updateMeta.
- [ ] T05: Fix Shortness of Life (4 cards, 1 merge) — For shortness-of-life-02-002 + 02-003: merge into one card (02-002 ends mid-sentence, 02-003 continues). Renumber subsequent cards. For shortness-of-life-06-003: replace "he" with "Livius Drusus". For shortness-of-life-07-004: replace "He" with "The wise person" or "A philosopher". Recalculate reading times. Run updateMeta.
- [ ] T06: Fix Happy Life (8 cards) — For each card, read current text and prior card for context. happy-life-05-001: replace "Since I've started defining things more loosely" with a self-contained opener. happy-life-08-005: replace "This" with the actual subject. happy-life-10-001: identify the speaker ("The Epicurean opponent replies..."). happy-life-12-001: identify "he" and "they". happy-life-14-003: replace "this comparison" with a brief description of the comparison. happy-life-25-001: replace "this" and "these things" with specifics. happy-life-25-006: replace "That's why" with a brief premise. happy-life-26-004: rewrite opening to not start mid-sentence. Recalculate reading times. Run updateMeta.
- [ ] T07: Fix Peace of Mind (2 cards) — For peace-of-mind-02-002: replace "those harsh treatments I mentioned earlier" with a brief description. For peace-of-mind-04-001: add a sentence establishing what Athenodorus had argued (withdrawal from public life). Recalculate reading times. Run updateMeta.
- [ ] T08: Fix On Anger Book 1 (16 cards) — Read each flagged card and its predecessor. Apply minimal edits: replace unexplained pronouns with names/roles (wise man, the Cimbri and Teutones, Piso the Roman commander), add one-sentence story setups for mid-narrative cards, replace dangling "This is why" / "All of this" with brief restatements. For on-anger-01-012 (pure transition card): rewrite as a standalone observation about anger's complexity. Recalculate reading times. Run updateMeta.
- [ ] T09: Fix On Anger Book 2 (9 cards) — Same approach. Key fixes: on-anger-02-005 replace "this list" with context, on-anger-02-039 (one-sentence fragment) merge with 02-038 if feasible or expand into standalone thought, on-anger-02-058 add Alexander story setup, on-anger-02-091 add Pastor story setup. Recalculate reading times. Run updateMeta.
- [ ] T10: Fix On Anger Book 3 (13 cards) — Same approach. Major sequences: Cambyses/Praexaspes (03-046/047/048) — add story context to each card. Harpagus (03-050) — add setup. Torture sequence (03-060/061/062/063) — identify the tyrant and add context. Cyrus (03-067), Antigonus (03-071), mid-story (03-113) — add setups. Recalculate reading times. Run updateMeta.
- [ ] T11: Run tests and validate — Run `npm test` to verify all unit tests pass. Run `npm run build --prefix web` and `npm run test:e2e --prefix web` to verify no regressions. Spot-check 5-10 edited cards in the browser on the dev server. Delete `scripts/fix-readability.ts`.
- [ ] T12: Update content strategy docs — Add a note to `docs/CONTENT_STRATEGY.md` under Card Design about the standalone readability requirement and the types of issues to watch for in future pipeline runs.

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
