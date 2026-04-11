# Repo Cleanup & Documentation

## Objective
Reorganize top-level directories (docs, content hierarchy, source/pipeline/fixtures), update all references, and improve CLAUDE.md / README.md documentation.

## Decisions
- Markdown files (ANALYTICS.md, ARCHITECTURE.md, BRANDING.md, CONTENT_STRATEGY.md) move to `docs/`
- New `content/` folder structure: `content/output/` (was `content/`), `content/pipeline/` (was `content-pipeline/`), `content/fixtures/` (was `content-fixtures/`), `content/source/` (was `source-books/`)
- CLAUDE.md and README.md references to docs update to `docs/` prefix
- `--output` flag default in generate.ts changes from `"content"` to `"content/output"`
- CLAUDE.md gets local dev, mobile testing, and deploy sections
- README.md gets human-friendly pipeline, testing, and deploy documentation

## Files
- `ANALYTICS.md`, `ARCHITECTURE.md`, `BRANDING.md`, `CONTENT_STRATEGY.md` — move to `docs/`
- `CLAUDE.md` — update doc refs, add dev/deploy sections
- `README.md` — update doc refs, rewrite testing/pipeline/deploy sections
- `scripts/lib/constants.ts` — `source_file` paths: `source-books/` → `content/source/`
- `scripts/lib/cache.ts` — cache dir: `content-pipeline` → `content/pipeline`
- `scripts/extract-fixtures.ts` — dir constants: `content` → `content/output`, `content-fixtures` → `content/fixtures`
- `scripts/generate.ts` — default output: `"content"` → `"content/output"`
- `web/vite.config.js` — aliases: `../content` → `../content/output`, `../content-fixtures` → `../content/fixtures`
- `scripts/lib/__tests__/cache.test.ts` — all `content-pipeline` path refs → `content/pipeline`
- `scripts/lib/__tests__/refineBatch.test.ts` — `source-books/` → `content/source/`
- `scripts/lib/__tests__/translateBatch.test.ts` — `source-books/` → `content/source/`
- `scripts/lib/__tests__/refine.test.ts` — `source-books/` → `content/source/`
- `vercel.json` — verify `buildCommand` still works (uses `web/` prefix, no change needed)
- `.gitignore` — no changes needed (no directory-specific ignores for these)

## Constraints
- All tests must pass after each task group
- Git history for moved files should use `git mv` where possible
- The `content/` directory rename is the trickiest — must rename existing `content/` to `content-temp-output/`, create new `content/`, then move everything into place
- Completed plan files in `plans/complete/` have stale references — leave them as-is (they're historical)

## Tasks
- [x] T01: Move markdown files to docs/ — `git mv` ANALYTICS.md, ARCHITECTURE.md, BRANDING.md, CONTENT_STRATEGY.md into new `docs/` folder (done: all 4 files moved, git shows R renames)
- [x] T02: Reorganize content directories — rename `content/` → temp, create `content/`, move old content to `content/output/`, `content-pipeline/` → `content/pipeline/`, `content-fixtures/` → `content/fixtures/`, `source-books/` → `content/source/`; all via `git mv` (done: all moves show as R renames in git status)
- [x] T03: Update source code references — update paths in `scripts/lib/constants.ts` (5 source_file entries), `scripts/lib/cache.ts` (cache dir), `scripts/extract-fixtures.ts` (2 dir constants + log message), `scripts/generate.ts` (--output default), `web/vite.config.js` (2 aliases) (done: all 5 files updated; also updated the help text string in generate.ts and the comment in cache.ts)
- [x] T04: Update test references — update `scripts/lib/__tests__/cache.test.ts` (all content-pipeline refs), `refine.test.ts`, `refineBatch.test.ts`, `translateBatch.test.ts` (source-books refs) (done: 8 path.join() calls updated to content/pipeline, 3 source_file strings updated to content/source/)
- [x] T05: Run tests — `npm test` must pass with all path changes
- [x] T06: Update CLAUDE.md — update doc refs to `docs/` prefix; add "Local Development" section (npm run dev, --host for mobile); add "Deploy" section (Vercel auto-deploy from main, preview deploys on PRs); update Screenshots section to not use `cd` (done: all 4 changes applied)
- [x] T07: Update README.md — update Documentation section refs to `docs/`; add "Local Development" section with dev server and mobile testing via `--host`; add "Deploy" section explaining Vercel setup; update Content Pipeline section with new directory names; update Testing section with more detail on test structure and e2e (done: all 5 items implemented; added ANALYTICS.md to docs refs)
- [x] T08: Final verification — run `npm test`, verify no stale references with grep for old directory names in non-plan source files

## Verify
```bash
npm test
```
