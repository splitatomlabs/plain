# Fix refine validation regression for em-dash and quoted-verse endings

## Objective
Allow the refine phase to pass validation for source texts that legitimately end with em-dashes or before inline verse quotations, so `--all` pipeline runs succeed for on-anger and other books with similar patterns.

## Decisions
- Root cause: `validateRefineCoverage` mid-sentence check (`CHUNK_SENTENCE_END_RE`) treats em-dash (`—`) and hyphen-dash (`-`) endings as errors. On-anger's source text has sections that genuinely end with em-dashes before inline verse quotations (e.g., `tempers—` followed by a poetry line). The LLM preserves these faithfully during refine, but validation rejects them, triggering retries that produce worse results (dropped content).
- The mid-sentence check is valuable — it catches real split errors. The fix should allowlist em-dash endings, not remove the check entirely.
- Add `—` (em-dash) and `—"` patterns to the sentence-end regex in both the refine validation and the card-level validation.
- The "refine dropped content" error is a secondary failure: the retry loop re-runs refine for chapters that failed mid-sentence validation, and the retried LLM output sometimes drops text. Fixing the false-positive mid-sentence errors eliminates the unnecessary retries.
- After the fix, re-run the full pipeline for on-anger to confirm it passes.

## Files
- `scripts/lib/validate.ts` — add em-dash to `CHUNK_SENTENCE_END_RE` (line 554) and `SENTENCE_END_RE` (line 302)
- `scripts/lib/__tests__/validate.test.ts` — update em-dash test (line 528) to expect no error, add test for em-dash as valid sentence ending in card validation
- `content/pipeline/on-anger/` — regenerated refine and translate caches after fix
- `content/output/on-anger/` — regenerated card JSON

## Constraints
- Do not weaken the mid-sentence detection for actual mid-sentence splits (e.g., text ending with a regular word)
- Existing tests for genuine mid-sentence splits must still pass
- The em-dash test at line 528 currently expects an error — it needs to be split into two tests: em-dash at end of a sentence (valid) vs em-dash mid-clause (still invalid if we can distinguish, otherwise accept all em-dash endings)

## Tasks
- [ ] T01: Add em-dash to sentence-end regexes — In `scripts/lib/validate.ts`, add `\u2014` (em-dash) to both `SENTENCE_END_RE` (line 302) and `CHUNK_SENTENCE_END_RE` (line 554). Also add plain dash `—` and `—"` patterns.
- [ ] T02: Update em-dash tests — In `scripts/lib/__tests__/validate.test.ts`, change the test at line 528 ("errors when chunk ends with em-dash") to expect no error. Add a new card-level test confirming em-dash endings don't trigger mid-sentence warnings. Verify existing mid-sentence tests still pass.
- [ ] T03: Run tests — Run `npm test` to confirm all pipeline and web tests pass.
- [ ] T04: Re-run on-anger full pipeline — Run `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book on-anger`. Verify refine passes without retries on book-2 and book-3, translate completes, and assemble succeeds.
- [ ] T05: Validate on-anger output — Check no cards exceed 60s reading time. Run standalone readability audit on on-anger. Run `npm test`.
- [ ] T06: Run e2e tests — `npm run build --prefix web && npm run test:e2e --prefix web`.

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
