# Bulk Refine + Absolute --limit

## Objective
Restructure the refine step to evaluate chunks in batches of ~10 per API call, reducing ~140 calls to ~52 while keeping context focused for accuracy. Bake the reading-time cap into the AI prompt so oversized splits are handled by the model, not a local heuristic. Make `--limit N` a true absolute cap: first N chunks across the entire book, regardless of chapter boundaries.

## Decisions
- **Batches of ~10 sections per call** — Keeps context focused for accuracy while still cutting calls dramatically. Enchiridion (50 sections): 5 calls. Meditations Book 6 (51 sections): 6 calls. Seneca essays (17-28 sections): 2-3 calls each. Total: ~52 calls for all 5 books (down from ~140). Configurable via `REFINE_BATCH_SIZE` env var, default 10.
- **Reading-time cap moves into the prompt** — The model is told the max word count (~300 words ≈ 90s at 200wpm) and must split any section exceeding it. The local `splitOversizedChunk` fallback is kept as a safety net but should rarely trigger.
- **Response format: array of decisions** — `[{ section: 1, action: "keep" }, { section: 2, action: "split", segments: [...] }, ...]`. One JSON array per call.
- **Fallback on parse failure** — If the bulk response fails to parse, fall back to single-chunk evaluation for that chapter (existing logic).
- **Batch-compatible** — With only ~52 calls, these can be batched too (future enhancement, not this PR).
- **`--limit N` caps refine API calls** — `--limit 1` = one refine batch (~10 chunks), `--limit 3` = three batches (~30 chunks). Directly controls cost and time. Translate and assemble only process the chunks that made it through refine. Chunks beyond the limit are simply not processed.

## Files
- `scripts/generate.ts` — simplify `runParse()` limit logic: chunk all chapters, flatten, take first N, re-group by chapter, drop empties
- `scripts/lib/refine.ts` — rewrite `refineChunks()` to send batches of ~10; keep old single-chunk path as fallback; move `splitOversizedChunk` to safety-net role; update `buildRefineSystem` to include word-count cap
- `scripts/lib/__tests__/refine.test.ts` — update tests for bulk response format; add test for reading-time cap in prompt; add fallback-to-single test

## Constraints
- Refine output must remain identical shape: `RefineResult` with `chunks`, `splits`, `merges` counts
- Must handle edge case: chapters with 1 chunk (just ask keep/split, same as before)
- Max response size: a 10-section batch with all decisions is ~500B-1KB JSON — comfortably within 4096 output tokens
- Keep the existing `refineChunks` function signature so `generate.ts` needs no changes
- `MAX_READING_TIME_SECONDS` (90s) remains the cap; translated to ~300 words in the prompt

## Tasks
- [x] T01: Redefine --limit as refine API call cap — Remove all existing limit logic from `runParse()` in `generate.ts` (the per-chapter slicing and book-level cap loop). Instead, pass `limit` into `runRefine()` which will stop after N batched API calls. `runParse` always chunks everything fully. Update help text: `--limit <n>  Max refine API calls per book (each call processes ~10 chunks)`. Acceptance: `--limit 1` on Enchiridion refines ~10 chunks (one batch), translates and assembles only those.
- [x] T02: Update refine system prompt for bulk evaluation — Modify `buildRefineSystem()` to: (a) instruct the model to evaluate multiple sections at once and return a JSON array of decisions, (b) include the word-count cap rule (~300 words max per card; if a section exceeds this, action must be "split" with segments), (c) keep author context and action descriptions. Add `buildBulkRefineUser(chunks)` that formats a batch of chunks as numbered sections. Acceptance: prompt test verifies cap rule, array response format, and batch formatting.
- [x] T03: Implement batched refineChunks — Rewrite `refineChunks()` to: (a) split chunks into batches of `REFINE_BATCH_SIZE` (default 10, configurable via env var), (b) for each batch, build one prompt via `buildBulkRefineUser` and call `callClaudeJSON` once, (c) parse the response array, (d) apply keep/split/merge_next/merge_prev decisions in order within each batch, (e) handle cross-batch merge edges: if the last chunk in a batch says merge_next, defer it and merge with the first chunk of the next batch, (f) run `splitOversizedChunk` as safety net on any result chunk still over the cap. Acceptance: unit tests pass with mocked bulk responses.
- [x] T04: Add fallback to single-chunk evaluation — If a batched `callClaudeJSON` call fails (parse error, timeout, etc.), fall back to per-chunk evaluation for that batch only. Extract the old per-chunk logic into `refineChunksSingle()` as a private function. Log a warning when falling back. Acceptance: test verifies fallback triggers on parse failure and produces valid output.
- [x] T05: Update refine tests — Rewrite `refine.test.ts` to mock batched responses (JSON arrays). Add tests: batch keep-all, batch with splits, batch with merges, batch with oversized section (model splits it), safety-net split (model misses oversize, local cap catches it), fallback to single on error, single-chunk batch, cross-batch merge edge case. Acceptance: all tests pass.
- [x] T06: Integration test — `--limit 1` on Enchiridion: 1 API call, model split section 1 into 4 chunks, translated + assembled. Cost: $0.03. — Run `PLAIN_USE_API=1 npx tsx scripts/generate.ts --book enchiridion --limit 10 --output /tmp/test-bulk-refine` and verify: (a) only 1 refine API call made (not 10), (b) output card JSON is valid, (c) cost report shows fewer input tokens than before. Acceptance: output matches expected structure.

## Verify
```bash
npm test
```
