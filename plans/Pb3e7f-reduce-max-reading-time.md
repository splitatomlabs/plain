# Reduce max card reading time from 90s to 60s

## Objective
Lower `MAX_READING_TIME_SECONDS` from 90 to 60 and rerun the full content pipeline for all 7 books, splitting 142 oversized cards into smaller ones.

## Decisions
- Full pipeline rerun for all books (not selective) — simplest approach, low cost (~$6-10)
- Change enforced at refine phase — Claude finds natural idea boundaries for splitting
- Bump `PIPELINE_VERSION` to auto-invalidate all cached intermediates
- Update refine prompt's word guidance from "50-300 words" to "50-200 words" to align with 60s target
- All 142 affected cards have 10+ sentences, so clean splits are guaranteed

## Files
- `scripts/lib/refine.ts` — lower `MAX_READING_TIME_SECONDS` to 60, update word guidance in prompt
- `scripts/lib/cache.ts` — bump `PIPELINE_VERSION` to 2
- `content/pipeline/*/` — regenerated intermediates (refine.json, translate.json)
- `content/output/*/` — regenerated card JSON
- `web/src/lib/utils/og.js` — pure function for dynamic OG font-size calculation
- `web/src/routes/api/og/[cardId]/+server.js` — import and use new font-size function
- `web/tests/unit/og.test.js` — unit tests for font-size calculation
- `web/tests/e2e/og-image.spec.js` — integration tests for OG endpoint responses
- `docs/CONTENT_STRATEGY.md` — document 60s max reading time target

## Constraints
- Reading time formula uses 200 wpm: 60s = 200 words max
- Existing card IDs will change (card counts per chapter shift) — no external references depend on these
- Pipeline requires `ANTHROPIC_API_KEY` env var
- Batch API calls take time to complete (~10-30 min per book)
- All existing tests must still pass after regeneration

## Tasks
- [x] T01: Update refine constants — Change `MAX_READING_TIME_SECONDS` from 90 to 60 in `scripts/lib/refine.ts`. Update the prompt word guidance from "roughly 50-300 words" to "roughly 50-200 words" to match the new ceiling.
- [x] T02: Bump pipeline version — Change `PIPELINE_VERSION` from 1 to 2 in `scripts/lib/cache.ts` to invalidate all cached intermediates.
- [~] T03: Run full pipeline — Run `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --all`. Verify all 7 books complete successfully. Check that no output card exceeds 60s reading time.
- [ ] T04: Validate output — Confirm total card count increased (was 1,308), spot-check split cards for coherence, verify no cards exceed 60s. Run `npm test` to confirm all tests pass.
- [x] T05: Dynamic OG font sizing — Extract font-size logic from `web/src/routes/api/og/[cardId]/+server.js` into a pure function (e.g. `web/src/lib/utils/og.js`). Replace the character-length thresholds with a calculation that finds the largest font size where the text fits the available area (1080×~410px, Georgia at ~0.52× avg char width, line height 1.4–1.45). Import and use in the OG endpoint.
- [x] T06: Unit test OG font sizing — Add `web/tests/unit/og.test.js` testing the pure font-size function: short text gets large font, long text gets small font, edge cases at boundary lengths, and result always stays within min/max bounds (20–36px).
- [x] T07: Integration test OG endpoint — Add `web/tests/e2e/og-image.spec.js` that requests `/api/og/{cardId}` for a short card and a long card. Assert: HTTP 200, content-type is `image/png`, body size > 1KB (valid image, not an error page), and correct cache headers.
- [x] T08: Update content strategy docs — Add explicit "60-second maximum reading time" guideline to `docs/CONTENT_STRATEGY.md`.
- [x] T09: Run e2e tests — Build the app (`npm run build --prefix web`) and run `npm run test:e2e --prefix web` to verify no regressions from changed card data.

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
