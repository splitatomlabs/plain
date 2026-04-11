# Pipeline API Cleanup

## Objective
Simplify generate.ts to a single code path (batch API + parallel) with a `--phase` flag for running individual pipeline stages against persisted intermediates.

## Critique of Proposal

The user's thinking is sound overall. A few refinements worth noting:

1. **Full-pipeline default.** When `--phase` is omitted, the script should run all four phases end-to-end (the current `runBatchPipeline` path). This preserves the common case of "just generate everything."

2. **Source hash validation removed.** Source texts are static public domain classics — hash checks add complexity for a near-zero probability scenario. `pipelineVersion` in cache.ts handles the real invalidation case (pipeline logic changes). If someone edits a source file, they'd naturally re-run `--phase parse`.

3. **`--limit` flag.** This was useful during development but adds complexity. Removing it aligns with the "validated approach" stance. If needed again, a user can just edit the source or use `--book` to scope down.

4. **CLI mode (`callClaude` via subprocess).** This is a separate concern from generate.ts flags. The CLI fallback in `claude.ts` can stay for now — it doesn't affect the generate.ts API surface. Removing it would be a separate cleanup. However, `PLAIN_USE_API` should become the only supported mode in generate.ts (no more conditional env var check at the top of main).

5. **Cache module evolution.** The existing `refine.json` and `translate.json` naming is fine. Adding `parse.json` follows the same pattern. The `--fresh` flag removal works because `--phase parse` naturally re-parses and overwrites.

## Decisions
- Batch API is the only code path; remove `processBook()`, `parseAndRefine()`, sequential/parallel branching
- `--phase` accepts: `parse`, `refine`, `translate`, `assemble` (runs one phase only)
- No `--phase` flag = run all four phases end-to-end
- Remove flags: `--parse-only`, `--parallel`, `--fresh`, `--limit`
- Remove env var checks: `PLAIN_USE_BATCH` (always batch), `PLAIN_USE_API` (always API — error if no ANTHROPIC_API_KEY)
- Add `parse.json` intermediate to `content/pipeline/<book>/`
- Remove source hash from all intermediates and cache functions
- `--book` or `--all` required; omitting both is an error
- Keep `--output` flag unchanged
- Store API cost in refine.json and translate.json — snapshot `tokenUsage` before/after each phase, compute cost using Sonnet batch pricing, save as a `cost` field

## Files
- `scripts/generate.ts` — rewrite CLI args and main(), collapse to single pipeline
- `scripts/lib/cache.ts` — add saveParse/loadParse, remove sourceHash from all cache functions
- `scripts/lib/claude.ts` — remove `callClaude()` CLI path, make API-only; remove `PLAIN_USE_API` guard
- `scripts/lib/refine.ts` — remove `refineChunks()` (non-batch), keep `refineChunksBatch()` only
- `scripts/lib/translator.ts` — remove `translateChunks()` (non-batch), keep `translateChunksBatch()` only
- `scripts/lib/__tests__/` — update tests that reference removed functions/flags
- `CLAUDE.md` — update pipeline docs, add note about PIPELINE_VERSION in cache.ts
- `README.md` — update pipeline section (new flags, remove old examples)

## Constraints
- Existing `content/pipeline/*/refine.json` and `translate.json` must remain compatible
- All 84 pipeline tests must pass after changes
- Batch fallback (retry failed chunks via real-time API) stays in refine.ts and translator.ts

## Tasks
- [x] T01: Add parse cache, remove sourceHash, add cost field to cache.ts — add `saveParse()`, `loadParse()`, `parsePath()` functions following existing refine/translate pattern. Add `CachedParse` interface. Remove `sourceHash` field from all cached types (`CachedRefine`, `CachedTranslate`, `CachedParse`), remove `hashSourceFile()` export, and drop sourceHash parameters from all save/load functions. Keep `pipelineVersion` checks only. Add a `cost` field to `CachedRefine` and `CachedTranslate` with shape `{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens, estimatedCost }`. Add a `snapshotTokenUsage()` helper and a `computePhaseCost(before, after)` function that calculates the delta and estimated dollar cost (Sonnet batch pricing). Accept cost as an optional param on `saveRefineCache` and `saveTranslateCache`.
- [x] T02: Test parse cache — add tests in `scripts/lib/__tests__/` for save/load/invalidation of parse.json, matching existing cache test patterns. Update existing cache tests to remove sourceHash usage.
- [x] T03: Simplify claude.ts — remove `callClaude()` (CLI subprocess path), remove `PLAIN_USE_API` conditional routing in `callClaudeJSON()`, make API-only. Error early if `ANTHROPIC_API_KEY` is missing. Remove `PLAIN_USE_BATCH` references.
- [~] T04: Simplify refine.ts — remove `refineChunks()` and `refineChunksSingle()` (non-batch paths). Keep `refineChunksBatch()` as the sole entry point. Update exports.
- [ ] T05: Simplify translator.ts — remove `translateChunks()` (async generator, non-batch path). Keep `translateChunksBatch()` as the sole entry point. Update exports.
- [ ] T06: Rewrite generate.ts CLI and main — replace flags (`--parse-only`, `--parallel`, `--fresh`, `--limit`) with `--phase <parse|refine|translate|assemble>`. Remove `processBook()`, `parseAndRefine()`, sequential/parallel branching. Collapse `main()` to: determine configs → if `--phase`, run single phase; else run all four phases via `runBatchPipeline()` (simplified).
- [ ] T07: Implement per-phase runners in generate.ts — each phase loads its input intermediate (or errors if missing), runs the phase, saves its output intermediate. Parse phase: read source → parse → save parse.json. Refine: load parse.json → batch refine → save refine.json. Translate: load refine.json → batch translate → save translate.json. Assemble: load translate.json → assemble → write output.
- [ ] T08: Update tests — fix any tests referencing removed functions (`refineChunks`, `translateChunks`, `callClaude`, `processBook`, removed CLI flags). Ensure all 84+ tests pass.
- [ ] T09: Update docs — update CLAUDE.md pipeline section (new flags, removed flags, simplified env vars; add note that `PIPELINE_VERSION` in cache.ts must be bumped when pipeline logic changes to invalidate cached intermediates). Update README.md pipeline section with new examples.

## Verify
```bash
npm test
```
