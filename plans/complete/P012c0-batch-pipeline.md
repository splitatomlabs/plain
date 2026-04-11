# Cloud Pipeline with Anthropic Batch API

## Objective
Move the translate step of the content pipeline to the Anthropic Batch API for 50% cost savings and cloud-parallel execution, and add book-level concurrency to the real-time refine step.

## Decisions
- **Refine stays real-time** — merge_prev/merge_next logic requires sequential chunk processing within a chapter; batching would break this. Refine is cheap (~140 calls, ~$0.07 at Sonnet).
- **Translate uses Batch API** — all chunks are independent after refine; submit as one batch, poll for completion, correlate results by `custom_id`. 50% discount → ~$0.12 vs $0.24 for translate.
- **Book-level parallelism for refine** — 5 books process concurrently via `Promise.all`, chapters stay sequential within each book. Simple, big speedup.
- **`custom_id` format** — `{bookSlug}:{chapterSlug}:{chunkIndex}` for result correlation.
- **Gated by env var** — `PLAIN_USE_BATCH=1` enables batch translate; default remains real-time for quick single-book runs.

## Files
- `scripts/lib/claude.ts` — add `createBatch()`, `pollBatch()`, `getBatchResults()` using `@anthropic-ai/sdk`
- `scripts/lib/translator.ts` — add `translateChunksBatch()` that builds batch requests and returns `TranslatedChunk[]`
- `scripts/generate.ts` — book-level `Promise.all`, wire batch translate path
- `scripts/lib/constants.ts` — no changes expected

## Constraints
- Batch API max 10,000 requests per batch — all 5 books combined is ~300 cards, well within limits
- Batch results available within 24h (typically much faster) — pipeline must poll with backoff
- Must still produce identical output format (same Card JSON, same _meta.json)
- `@anthropic-ai/sdk` already installed as a dependency
- Keep real-time translate path working for quick single-book dev runs

## Tasks
- [x] T01: Book-level parallelism in generate.ts — Refactor `main()` to run `processBook()` for all selected books via `Promise.all` instead of sequential `for` loop. Gate behind `--parallel` flag (default off so `--book` single runs are unaffected). Acceptance: `--all --parallel` processes 5 books concurrently, output identical to sequential.
- [x] T02: Batch API client in claude.ts — Add three functions: `createMessageBatch(requests)` that calls `client.messages.batches.create()`, `pollBatchUntilDone(batchId)` that polls with exponential backoff (5s → 60s, max 24h), and `streamBatchResults(batchId)` that iterates `client.messages.batches.results()`. Use the existing `getClient()` helper. Acceptance: unit test with mocked SDK client verifies create/poll/results flow.
- [x] T03: Batch translate function in translator.ts — Add `translateChunksBatch(allChunks, configs)` that: (a) builds batch request array with `custom_id` = `{bookSlug}:{chapterSlug}:{index}`, system prompt per book, user prompt per chunk; (b) calls `createMessageBatch`; (c) polls via `pollBatchUntilDone`; (d) streams results and correlates by `custom_id`; (e) returns `Map<string, TranslatedChunk[]>` keyed by `bookSlug:chapterSlug`. Tag validation and meaning-check logic reused from existing `translateChunks`. Acceptance: works end-to-end for one book with `PLAIN_USE_BATCH=1`.
- [x] T04: Wire batch path into generate.ts — When `PLAIN_USE_BATCH=1`: after all books are parsed+refined, collect all chunks across all books, call `translateChunksBatch()` once, then distribute results back to each book's assemble step. Keep the existing per-chunk translate as the default path. Acceptance: `PLAIN_USE_BATCH=1 npx tsx scripts/generate.ts --book enchiridion` produces correct output.
- [x] T05: Batch cost reporting — Accumulate token usage from batch results (`response.usage` on each result message). Print batch-specific cost report: total requests, succeeded/failed counts, input/output/cache tokens, estimated cost (at 50% Sonnet rates). Acceptance: cost report prints after batch completion.
- [x] T06: Error handling and retries — Handle batch-level failures: if a request in the batch fails (errored result type), log it and optionally retry those chunks via real-time API as fallback. Handle expired batches (exceeded 24h). Acceptance: pipeline doesn't crash on partial batch failure.
- [x] T07: Full pipeline test — Ran `PLAIN_USE_BATCH=1 --book enchiridion --limit 10`. Batch `msgbatch_01KPGmSZKrBjdF14b1DrpTod`: 11/11 succeeded, 0 failed. Cost: $0.049 (50% discount). 11 cards, valid tags, correct JSON. Batch took ~25min (low-tier plan latency).

## Verify
```bash
npm test
```
