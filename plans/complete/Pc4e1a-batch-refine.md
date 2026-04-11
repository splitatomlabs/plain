# Batch Refine via Anthropic Batch API

## Objective
Submit all refine evaluations as a single Batch API request (like translate already does), eliminating sequential rate-limited calls and cutting refine cost by 50%.

## Decisions
- **First pass only via batch.** The initial bulk evaluation (~47 calls across all books) goes through the Batch API. Follow-up re-evaluations of split chunks use real-time API — these are rare and small.
- **One batch request per bulk evaluation.** Current refine groups ~10 chunks per API call using `buildBulkRefineUser`. In batch mode, each of these groups becomes one batch request (not one request per chunk). This keeps the response format identical — an array of decisions.
- **Custom ID format:** `refine_{bookSlug}_{chapterSlug}_{batchIndex}` — mirrors translate's `{book}_{chapter}_{index}` pattern.
- **Gate on `PLAIN_USE_BATCH=1`** — same env var as translate. When unset, refine uses current real-time path unchanged.
- **Refine cache still applies.** Batch refine results are saved to cache the same way real-time results are.

## Files
- `scripts/lib/refine.ts` — add `refineChunksBatch()` function, export new `BatchRefineInput` type
- `scripts/lib/__tests__/refine.test.ts` — add tests for batch refine path
- `scripts/lib/__tests__/refineBatch.test.ts` — dedicated batch refine test file (mirrors `translateBatch.test.ts`)
- `scripts/generate.ts` — wire batch refine into `runBatchPipeline`, replace sequential refine when `PLAIN_USE_BATCH=1`

## Constraints
- Refine responses are arrays (`BulkRefineResponse[]`), not single objects — batch result parsing must handle `extractJSON` on array output
- `applyDecisions()` and cross-batch merge logic (`deferredMergeChunk`) must work identically in both paths
- Iterative splits (a split chunk that itself needs splitting) are rare but must still work — use real-time API fallback for these
- Existing tests must continue to pass — the non-batch path is unchanged

## Tasks
- [x] T01: Add `refineChunksBatch()` to `refine.ts` — collects all chapter chunk batches across all books into `BatchRequest[]`, submits via `createMessageBatch`, polls, streams results, correlates by custom_id, calls `applyDecisions()` per chapter. Returns `Map<string, RefineResult>` keyed by `{bookSlug}_{chapterSlug}`. Failed requests fall back to real-time `refineChunks()` per chapter.
- [x] T02: Add `BatchRefineInput` type — `{ bookSlug: string; chapterSlug: string; chunks: Chunk[]; config: BookConfig }` — exported from `refine.ts`, consumed by `generate.ts`.
- [x] T03: Handle iterative re-evaluation — after first-pass batch results are applied, scan for oversized chunks (LENGTH-SPLIT). These are already handled by `splitOversizedChunk()` locally, no API needed. For chunks where a split produced new chunks that themselves need refine review, retry those specific chapters via real-time `refineChunks()`.
- [x] T04: Write tests in `scripts/lib/__tests__/refineBatch.test.ts` — mock `createMessageBatch`, `pollBatchUntilDone`, `streamBatchResults`. Test: successful batch with keep/split/merge decisions, failed request with real-time fallback, cross-batch merge handling, custom_id correlation, token usage accumulation.
- [x] T05: Wire into `generate.ts` `runBatchPipeline()` — when `PLAIN_USE_BATCH=1`, replace the sequential `runRefine()` calls with a single `refineChunksBatch()` call that processes all books at once. Cache results per book after completion.
- [x] T06: Run `npm test` — all existing + new tests pass. Manual smoke test with `--parse-only` to verify chunk counts match.

## Verify
```bash
npm test
```
