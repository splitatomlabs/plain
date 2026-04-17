# Refine retry cleanup & max_tokens bump

## Objective
Increase refine max_tokens to 8096, remove callClaudeJSON retry logic, and simplify refine batch fallback to a single real-time attempt per failed chunk.

## Decisions
- max_tokens 4096 → 8096 for refine batch requests only (realtime uses smaller ~10-chunk batches, 4096 is sufficient)
- Remove callClaudeJSON retry — parse once, throw on failure
- Refine batch failures: log warning, then single real-time attempt per failed chapter (no retry on that either — just fatal)
- Translate retry path: single rt attempt is correct, but must throw on failure (currently swallows the error and silently drops the chunk)

## Files
- `scripts/lib/claude.ts` — remove retry in callClaudeJSON
- `scripts/lib/refine.ts` — pass max_tokens: 8096 in batch requests; ensure realtime fallback is single-attempt
- `scripts/lib/__tests__/claude.test.ts` — update/remove retry tests for callClaudeJSON
- `scripts/lib/translator.ts` — make realtime retry throw on failure instead of silently dropping chunk
- `scripts/lib/__tests__/refineBatch.test.ts` — verify fallback test still passes

## Constraints
- Translate phase uses callClaudeJSON for its single real-time retry — removing callClaudeJSON retry means translate also gets one shot (matches table: translate batch fails → rt fails = Fatal)
- Keep existing logger.warn calls for batch → realtime fallback

## Tasks
- [x] T01: Remove callClaudeJSON retry — `scripts/lib/claude.ts` L299-333: parse once, throw ClaudeCliError on failure. Update tests in `scripts/lib/__tests__/claude.test.ts` (remove "retries on invalid JSON then succeeds" test, update "throws after retry" test).
- [x] T02: Bump max_tokens for refine batch — `scripts/lib/refine.ts` L485-489: add `max_tokens: 8096` to batch request objects. Realtime path stays at default 4096.
- [x] T03: Simplify refine realtime fallback — `scripts/lib/refine.ts` L380-394: on callClaudeJSON failure, log error and throw (fatal) instead of silently keeping chunks as-is. The batch fallback at L584-591 already logs a warning before calling refineChunksRealtime, which is correct.
- [x] T04: Make translate realtime retry fatal — `scripts/lib/translator.ts` L217-223: re-throw error instead of swallowing it. Currently logs but silently drops the chunk, producing a book with gaps.
- [x] T05: Run tests — `npm test` must pass. Update any broken assertions.

## Verify
```bash
npm test
```
