# Cache versioning and timestamps

## Objective
Add a pipeline version constant and creation timestamp to intermediate cache files (refine.json, translate.json) so stale caches from older pipeline code are automatically invalidated.

## Decisions
- Single `PIPELINE_VERSION` integer in `scripts/lib/cache.ts` — co-located with the types it guards
- Start at `1`; bump manually when refine/translate logic changes materially
- Cache load rejects version mismatch the same way it rejects sourceHash mismatch
- Timestamp is ISO-8601 UTC string (`createdAt`), informational only (not used for invalidation)
- Existing cache files on disk lack these fields — treated as version `0` → automatic cache miss on next run

## Files
- `scripts/lib/cache.ts` — add `PIPELINE_VERSION`, `createdAt` to types and save/load logic
- `scripts/lib/__tests__/cache.test.ts` — tests for version mismatch rejection and timestamp presence

## Constraints
- No changes to generate.ts — save/load signatures stay the same
- No changes to chunker, refine, translator, or assembler
- `--fresh` flag already bypasses cache reads; version check is orthogonal

## Tasks
- [x] T01: Add PIPELINE_VERSION and update cache types — In `scripts/lib/cache.ts`: add `export const PIPELINE_VERSION = 1` near the top. Add `pipelineVersion: number` and `createdAt: string` fields to both `CachedRefine` and `CachedTranslate` interfaces.
- [x] T02: Update save functions to write new fields — In `saveRefineCache` and `saveTranslateCache`, include `pipelineVersion: PIPELINE_VERSION` and `createdAt: new Date().toISOString()` in the serialized data objects.
- [x] T03: Update load functions to check version — In `loadRefineCache` and `loadTranslateCache`, after the sourceHash check, add a version check: if `data.pipelineVersion !== PIPELINE_VERSION` (or field is missing), log a cache miss reason and return null.
- [x] T04: Add tests for version checking — New test file `scripts/lib/__tests__/cache.test.ts`. Test: (a) save then load with matching version returns data, (b) load with mismatched version returns null, (c) load with missing pipelineVersion field returns null, (d) saved files contain `createdAt` as valid ISO string, (e) saved files contain `pipelineVersion` matching the constant.

## Verify
```bash
npm test
```
