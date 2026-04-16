# Fix sentence-level split errors in card content

## Objective
Merge 3 card pairs where the pipeline incorrectly split text mid-sentence, producing two broken cards. Edit content/output/ JSON directly — no pipeline rerun.

## Decisions
- 3 pairs to merge: shortness-of-life 02-002/003, discourses 08-001/002, discourses 28-003/004
- For each merge: concatenate plain_english of both cards, keep first card's ID, remove second card, renumber subsequent cards in the chapter, update total_cards_in_chapter on all remaining cards
- Recalculate reading_time_seconds for merged card using `Math.max(Math.round((words / 200) * 60), 5)`
- Update _meta.json: chapter card_count, chapter reading_time_seconds, total_cards, total_reading_time_seconds
- Other readability issues (dangling pronouns, missing context) are pipeline-level fixes — out of scope

## Files
- `content/output/shortness-of-life/section-02.json` — merge cards 002+003, renumber
- `content/output/shortness-of-life/_meta.json` — update section-02 counts and book totals
- `content/output/discourses/of-providence.json` — merge cards 001+002, renumber
- `content/output/discourses/how-we-should-struggle-against-appearances.json` — merge cards 003+004, renumber
- `content/output/discourses/_meta.json` — update affected chapter counts and book totals

## Constraints
- Do not rerun the content pipeline
- Card IDs, tags, original_excerpt, source_reference, author_slug unchanged
- Merged card keeps first card's ID; second card removed entirely
- All card_number values must remain sequential (1, 2, 3...) after merge
- total_cards_in_chapter must match actual count on every card in the chapter
- _meta.json must be consistent with actual card data
- All existing tests must pass

## Tasks
- [ ] T01: Merge shortness-of-life 02-002/003 — Read section-02.json. Concatenate plain_english of card 002 and 003 (the first ends mid-sentence). Remove card 003. Renumber subsequent cards. Update total_cards_in_chapter on all cards. Recalculate reading_time_seconds for merged card. Update _meta.json section-02 card_count, reading_time_seconds, and book total_cards/total_reading_time_seconds.
- [ ] T02: Merge discourses 08-001/002 — Read of-providence.json. Card 001 ends mid-sentence, card 002 completes it. Concatenate plain_english. Remove card 002. Renumber subsequent cards. Update total_cards_in_chapter. Recalculate reading_time_seconds. Update _meta.json for of-providence chapter and book totals.
- [ ] T03: Merge discourses 28-003/004 — Read how-we-should-struggle-against-appearances.json. Card 003 ends mid-sentence, card 004 is a single fragment. Concatenate plain_english. Remove card 004. Renumber subsequent cards. Update total_cards_in_chapter. Recalculate reading_time_seconds. Update _meta.json for that chapter and book totals.
- [ ] T04: Validate — Run `npm test`. Run `npm run build --prefix web` and `npm run test:e2e --prefix web`. Spot-check the 3 merged cards in the dev server.

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
