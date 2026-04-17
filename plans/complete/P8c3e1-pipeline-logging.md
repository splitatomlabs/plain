# Pipeline Logging & Single-Book Mode

## Objective
Add structured pipeline logging to a per-book file in `content/pipeline/`, a `--verbose` CLI flag to echo logs to stderr, and remove the `--all` flag so books run one at a time.

## Decisions
- Log file per book: `content/pipeline/{bookSlug}/pipeline.log` — overwritten each run, human-readable, timestamped lines
- Logger module: `scripts/lib/logger.ts` — single `PipelineLogger` class, created per-run, accepts `verbose` flag
- Log levels: `info`, `warn`, `error`, `decision` — `decision` is a distinct level for LLM split/keep/merge choices
- Verbose mode: `--verbose` flag prints all log lines to stderr in real time (file always written)
- Remove `--all`: CLI requires `--book <slug>` for every run; update help text, validation, and orchestration
- Existing `console.error` / `process.stderr.write` calls replaced with logger calls where they carry diagnostic value; cost report stays on stderr unconditionally

## Files
- `scripts/lib/logger.ts` — new: PipelineLogger class
- `scripts/generate.ts` — add `--verbose`, remove `--all`, wire logger through phases
- `scripts/lib/refine.ts` — log split/keep/merge decisions, batch fallback, deferred merges, oversized splits
- `scripts/lib/translator.ts` — log validation warnings, retry attempts, tag normalization
- `scripts/lib/claude.ts` — log batch create/poll/complete, real-time retries, rate-limit waits
- `scripts/lib/validate.ts` — log each validation error with context
- `scripts/lib/cache.ts` — log cache hit/miss/invalidation per phase
- `CLAUDE.md` — update Content Pipeline section
- `README.md` — update Content Pipeline section

## Constraints
- Logger must not change any pipeline behavior — purely additive
- No new dependencies; use Node built-ins only (fs, path)
- Log file must be valid UTF-8 plain text, not JSON — optimized for Claude reading
- All existing tests must continue to pass unchanged

## Tasks
- [x] T01: Create PipelineLogger module — `scripts/lib/logger.ts`. Class with `init(bookSlug, verbose)`, `info()`, `warn()`, `error()`, `decision()` methods. Each line: `[HH:MM:SS] [LEVEL] message`. `init` opens/truncates log file at `content/pipeline/{bookSlug}/pipeline.log`. `close()` flushes. When verbose=true, also write to stderr. Export singleton instance. Include unit test in `scripts/lib/__tests__/logger.test.ts` covering file write, verbose stderr, and level formatting.
- [x] T02: Remove `--all` flag, add `--verbose` — `scripts/generate.ts` lines 31-69. Remove `all` from parseArgs options. Remove `args.all` branch in validation (line 61-64) and config selection (line 436-438). Add `verbose: { type: "boolean", default: false }`. Update help text. Wire `PipelineLogger.init(config.slug, args.verbose)` at top of `main()`. Call `logger.close()` before exit.
- [x] T03: Instrument cache layer — `scripts/lib/cache.ts`. Import logger. Log on cache load (hit with version match, miss with reason — file not found vs version mismatch), cache save, and diff results (N cached / M uncached chunks).
- [x] T04: Instrument parse phase — `scripts/generate.ts` `runParse()`. Log: source file loaded (size), sections parsed (count), chunks created (count), validation pass/fail with details, cache save.
- [x] T05: Instrument refine phase — `scripts/lib/refine.ts` and `scripts/generate.ts` `runRefine()`. Log with `decision` level each chunk's refine decision (section number, action, segment count for splits). Log batch submission (chunk count, batch ID), batch completion, fallback to realtime. Log deferred merge_next across batches. Log oversized chunk splits (section number, reading time). In `generate.ts`, log retry attempts (which sections failed, retry number, batch indices).
- [x] T06: Instrument translate phase — `scripts/lib/translator.ts` and `scripts/generate.ts` `runTranslate()`. Log cache diff results (cached vs uncached counts). Log batch submission and completion. Log failed chunk IDs and retry attempts. Log meaning-check warnings (section, which flags failed). Log tag normalization (original → filtered).
- [x] T07: Instrument batch API — `scripts/lib/claude.ts`. Log batch creation (request count). Log each poll iteration (status, counts). Log batch completion or error. Log real-time API calls and retries. Log rate-limit waits.
- [x] T08: Instrument validation — `scripts/lib/validate.ts`. Log each validation error/warning with section number and failure reason (parse content artifacts, coverage gaps, sentence-ending issues).
- [x] T09: Update documentation — `CLAUDE.md` and `README.md`. Remove `--all` references. Add `--verbose` flag. Document log file location. Update CLI examples. Note that `content/pipeline/{bookSlug}/pipeline.log` is the diagnostic file to read when troubleshooting.
- [x] T10: Run full test suite — `npm test`. Verify all 222 tests pass. Fix any breakage from `--all` removal or logger integration.

## Verify
```bash
npm test
```
