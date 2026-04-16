# Improve standalone card readability via translation prompt

## Objective
Update the translation prompt and pipeline to produce self-contained cards that make sense without surrounding context, eliminating ~66 major readability issues (unexplained pronouns, dangling references, mid-story gaps, unattributed debate replies). Only re-translate the flagged cards, not all 1,631 chunks.

## Decisions
- Root cause: translator receives only the current chunk — no adjacent context. It can't fix dangling references it doesn't know about.
- Fix: pass the previous chunk's text as read-only context in the user message (not for translation, just for awareness). This lets the LLM resolve pronouns and add brief context where the original assumes continuity.
- Add a standalone readability rule to the system prompt: "Each card must make sense to a reader who hasn't seen the previous card. Replace pronouns with names on first use. Never open with dangling references like 'This is why...', 'He said...', or 'All of this...' without restating the subject."
- Word count concern: adding context clauses may push cards over 200 words. The refine phase already caps source chunks so most translations land well under 200 words — a 5-10 word contextual clause won't push them over. Do NOT instruct the LLM to compress to compensate; conflicting "add context" + "compress" instructions cause weird artifacts. If a rare card runs long, `MAX_READING_TIME_SECONDS` validation catches it and it can be fixed individually.
- Selective re-translation: instead of deleting all translate caches and re-running (~$5.50), make `runTranslate` chunk-aware so it diffs cached vs refined and only translates what's missing. To re-translate specific chunks, just delete them from `translate.json` — the pipeline notices they're missing and re-translates only those.
- Do NOT bump PIPELINE_VERSION — that would invalidate ALL caches across ALL phases.

## Architecture: chunk-level translate caching

**Current state:** `runTranslate` in `generate.ts` is all-or-nothing per book. If `loadTranslateCache(slug)` returns data, the entire book is skipped. If not, every chunk in the book goes to the batch API.

**New behavior:** `runTranslate` loads cache, then diffs against the refined chunks chapter-by-chapter using array index. For each chapter, if `cache[chapterKey][i]` exists, that chunk is already translated. Missing indices get sent to the batch API. After batch completes, new translations are inserted into the cached array at the correct positions and saved.

**Invalidation:** To force re-translation of specific chunks, delete their entries from `translate.json` (manually or via a script). The pipeline sees the gap and re-translates only those chunks. No special CLI flags needed.

## Files
- `scripts/lib/cache.ts` — add `mergeTranslateCache` helper that loads existing cache, merges new translations by index, and saves
- `scripts/lib/prompt.ts` — add standalone readability rule to system prompt; update `buildTranslationUser` to accept optional previous chunk text
- `scripts/lib/translator.ts` — pass previous chunk to `buildTranslationUser` in batch request construction
- `scripts/generate.ts` — rewrite `runTranslate` for chunk-level diffing; wire up previous-chunk context
- `scripts/lib/__tests__/prompt.test.ts` — update tests for new prompt content and user message format
- `scripts/lib/__tests__/cache.test.ts` — add tests for merge behavior
- `content/pipeline/*/translate.json` — only flagged chunks deleted and re-translated (bulk of cache preserved)
- `content/output/*/` — regenerated card JSON after rerun

## Constraints
- Do not change refine phase or refine cache
- Preserve 8th-grade reading level (FKGL 7-8)
- Merged cards must stay under ~200 words / 60s reading time
- Previous chunk context is read-only — the LLM translates only the current chunk
- Pipeline cost for this fix should be ~$0.20-0.30 (66 chunks, not 1,631)
- All existing tests must pass after changes
- Translate cache format remains backward-compatible — existing caches load fine; new code just handles partial hits

## Tasks

### Phase 1: Chunk-level caching infrastructure

- [x] T01: Make runTranslate chunk-aware — Rewrite `runTranslate` in `scripts/generate.ts` (lines 284-346) to diff at chunk granularity. For each book: (1) load translate cache via `loadTranslateCache`, (2) for each chapter, compare the cached `TranslatedChunk[]` array against the refined `Chunk[]` array by index — if `cached[chapterKey][i]` exists, skip it; otherwise add it to the batch, (3) build `BatchTranslateInput` entries containing only uncached chunks (skip chapters where all chunks are cached), (4) after batch, call `mergeTranslateCache` to insert new translations at the correct indices and save. Log: `"  {slug}: {cached}/{total} chunks cached, translating {uncached}"`.

- [x] T02: Add mergeTranslateCache to cache.ts — Add `export async function mergeTranslateCache(bookSlug: string, newTranslations: Map<string, TranslatedChunk[]>, cost?: PhaseCost): Promise<void>` to `scripts/lib/cache.ts`. Loads existing cache (if any), merges new chunks into each chapter's array by matching on array index (using `sectionNumber` + position to align), saves. If no existing cache, behaves like `saveTranslateCache`.

- [x] T03: Test cache merge — In `scripts/lib/__tests__/cache.test.ts`, add tests for `mergeTranslateCache`: (a) merging into empty cache creates new file, (b) merging new chunks into existing cache preserves old chunks and adds new ones, (c) chunks are sorted by sectionNumber after merge.

- [x] T04: Test chunk-level diffing — Extract the chunk-diff logic from `runTranslate` (T01) into a testable pure function (e.g., `diffChunksForTranslation(refined: Chunk[], cached: TranslatedChunk[]): { cached: TranslatedChunk[], uncached: { index: number, chunk: Chunk }[] }`). Test in `scripts/lib/__tests__/cache.test.ts` or a new test file: (a) all chunks cached — returns empty uncached list, (b) no cache — all chunks in uncached list, (c) cache with gaps (e.g., indices 0,1,3 cached but 2,4 missing) — only missing indices in uncached list, (d) cache shorter than refined (new chunks added in refine) — extra chunks in uncached list.

### Phase 2: Prompt improvements

- [x] T05: Update translation system prompt — In `scripts/lib/prompt.ts`, strengthen rule 9 (line 74): replace `"Each passage should make sense on its own to someone who hasn't read the surrounding text."` with: `"Each passage must be independently comprehensible. If it opens with a pronoun (he, she, they, it, this, that) or a transitional phrase (This is why, And so, But, Therefore) that depends on a prior passage, replace the pronoun with the person's name or role, or restate the premise briefly. If the passage is mid-narrative, add a brief contextual clause (5-10 words) to orient the reader."`.

- [x] T06: Pass previous chunk context — Update `buildTranslationUser` in `scripts/lib/prompt.ts` (line 113) to accept an optional `prevChunkText?: string` parameter. When provided, prepend `PREVIOUS PASSAGE (for context only — do NOT translate this):\n${prevChunkText}\n\n` before the `ORIGINAL:` block. Update `buildTranslationPrompt` to pass through accordingly.

- [x] T07: Wire previous chunk in translator — In `scripts/lib/translator.ts` `translateChunksBatch` (line 80-92), when building batch requests, pass the previous chunk's text to `buildTranslationUser`. For each chunk at `index` in `chunks[]`: if `index === 0`, pass no previous context; if `index > 0`, pass `chunks[index - 1].text`. Also update the retry logic (lines 188-190) to pass the same previous chunk context.

- [x] T08: Test prompt and translator wiring — In `scripts/lib/__tests__/prompt.test.ts`, add/update tests: (a) system prompt contains the strengthened standalone readability rule text, (b) `buildTranslationUser` with no previous chunk produces `ORIGINAL:\n{text}` (backward compatible), (c) `buildTranslationUser` with previous chunk includes the `PREVIOUS PASSAGE` block before `ORIGINAL:`, (d) previous chunk context block contains "do NOT translate". In `scripts/lib/__tests__/translator.test.ts` (or existing test file), verify that `translateChunksBatch` builds requests with previous chunk text: mock `buildTranslationUser` and assert that chunk at index 0 is called with no `prevChunkText`, chunk at index 1 is called with `chunks[0].text`, chunk at index 2 is called with `chunks[1].text`.

### Phase 3: Run and validate

- [x] T09: Delete flagged chunks from translate caches — Run the readability audit to identify the ~66 bad cards. For each, find the corresponding entry in `content/pipeline/{book}/translate.json` and delete it from the chapter's array. The pipeline will detect the missing chunks and re-translate only those.

- [ ] T10: Re-translate and assemble — Run `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --all`. Verify: (a) only ~66 chunks are sent to batch (not 1,631), (b) remaining chunks load from cache, (c) all books assemble successfully. Check cost is ~$0.20-0.30.

- [ ] T11: Validate output — Confirm no card exceeds 60s reading time. Run the mid-sentence validation. Spot-check 10-15 previously-flagged cards to verify pronouns are resolved and references are self-contained. Run `npm test`.

- [ ] T12: Run e2e tests — Build app and run full e2e suite. `npm run build --prefix web && npm run test:e2e --prefix web`.

- [ ] T13: Re-audit standalone readability — Run the same 7-book subagent review on the new output. Compare major issue counts. Target: <10 major issues total (down from ~66). If still >10, delete the remaining bad chunks from cache and repeat T10-T12 (cost per iteration: pennies for remaining chunks).

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
