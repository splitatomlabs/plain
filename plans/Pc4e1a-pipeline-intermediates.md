# Move pipeline intermediates to version control

## Objective
Replace gitignored `.pipeline-cache/` with tracked `pipeline/` directory using per-book subdirectories, preserving all existing cached data.

## Decisions
- Directory structure: `pipeline/<book-slug>/refine.json`, `pipeline/<book-slug>/translate.json`
- Module rename: `cache.ts` stays as-is (naming still accurate — it caches intermediate results)
- Existing small cache files for enchiridion/meditations are test artifacts with dummy data — discard them, keep only real pipeline outputs (happy-life, peace-of-mind, shortness-of-life)
- The `--fresh` flag behavior is unchanged: skip reads, always write
- Source hash validation stays — still useful to detect when source text changed and a re-run is needed

## Files
- `scripts/lib/cache.ts` — update `CACHE_DIR`, path helpers, doc comment
- `scripts/lib/__tests__/cache.test.ts` — update directory name references in comments
- `.gitignore` — remove `.pipeline-cache/` entry
- `pipeline/` — new tracked directory with migrated data

## Constraints
- Must not lose existing real cache data (happy-life, peace-of-mind, shortness-of-life files)
- Meditations cache was generated in this session but with a stale source hash (parser changed since) — regenerate via pipeline run after migration
- Tests use `process.chdir()` to redirect cache writes to temp dirs — this pattern still works with the new path

## Tasks
- [ ] T01: Migrate existing cache files — copy `.pipeline-cache/{book}-refine.json` to `pipeline/{book}/refine.json` (and translate), skip test artifact files (enchiridion, meditations with tiny sizes). Verify file integrity after copy.
- [ ] T02: Update `scripts/lib/cache.ts` — change `CACHE_DIR` to `path.resolve("pipeline")`, update `refinePath`/`translatePath` to use `pipeline/{bookSlug}/refine.json` structure, update doc comment
- [ ] T03: Update `scripts/lib/__tests__/cache.test.ts` — update comment references from `.pipeline-cache` to `pipeline`
- [ ] T04: Update `.gitignore` — remove `.pipeline-cache/` line
- [ ] T05: Remove old `.pipeline-cache/` directory
- [ ] T06: Run tests — `npm test` must pass (174 + 36 tests)
- [ ] T07: Run `--book shortness-of-life` (cached) to verify reads work from new path, then `--book enchiridion --fresh` to verify writes work

## Verify
```bash
npm test
```
