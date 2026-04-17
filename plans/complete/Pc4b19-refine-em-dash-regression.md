# Fix refine validation regression for em-dash and quoted-verse endings

## Objective
Allow the refine phase to pass validation for source texts that legitimately end with em-dashes or before inline verse quotations, so `--all` pipeline runs succeed for on-anger and other books with similar patterns. Also clean up validation warnings: remove redundant ones, promote actionable ones to errors.

## Decisions
- Root cause: `validateRefineCoverage` mid-sentence check (`CHUNK_SENTENCE_END_RE`) treats em-dash (`—`) and hyphen-dash (`-`) endings as errors. On-anger's source text has sections that genuinely end with em-dashes before inline verse quotations (e.g., `tempers—` followed by a poetry line). The LLM preserves these faithfully during refine, but validation rejects them, triggering retries that produce worse results (dropped content).
- The mid-sentence check is valuable — it catches real split errors. Rather than allowlisting specific characters, we compare the refined chunk's ending against the original source chunk. If the source itself ends the same "suspicious" way, the refine faithfully preserved it — not an error.
- **Approach: compare-to-source.** For each post-refine chunk that fails `CHUNK_SENTENCE_END_RE`, check whether the corresponding pre-refine chunk's tail also fails the regex. If both fail, suppress the error (the source text genuinely ends that way). If only the refined version fails, keep the error (refine introduced a mid-sentence break).
- Remove the card-level `SENTENCE_END_RE` mid-sentence warning (line 302-313). It was added alongside the refine-level error in the same commit, but is redundant — the refine check catches the problem earlier, and the card-level warning doesn't trigger any action.
- Remove the FRE warning (line 180-187) — it measures the same concern as the FKGL check on a different scale. Two warnings for one concern is noise.
- Promote source_reference format warning (line 292-299) to error — it's a structured field the UI could rely on, the format check is deterministic, and a retry is cheap.
- Promote markdown-in-text warning (line 326-333) to error — markdown in plain_english or original_excerpt is always wrong (these render as plain text), and a retry will almost certainly fix it.
- Remaining warnings are intentionally non-blocking: unused tag (line 140-145) is informational about taxonomy coverage, FKGL outside 7-8 (line 171-178) is a soft readability target not worth retrying over.
- The "refine dropped content" error is a secondary failure: the retry loop re-runs refine for chapters that failed mid-sentence validation, and the retried LLM output sometimes drops text. Fixing the false-positive mid-sentence errors eliminates the unnecessary retries.
- After the fix, re-run the full pipeline for on-anger to confirm it passes.
- **Secondary root cause: `splitTextAtBoundary` misses valid split points.** The mechanical length-split (post-LLM safety net) uses `/[.?!]\s/g` to find sentence boundaries, which misses: (a) sentences ending inside quotes (`you." He`) because the quote mark sits between the period and the space, and (b) semicolons/colons (`; ` and `: `) which are valid boundaries already accepted by `CHUNK_SENTENCE_END_RE`. When no boundary is found, it falls to midpoint-word-boundary — guaranteed mid-sentence error. Fix: expand the regex to `/[.?!;:]['""\u201D)\]]*\s/g` and skip the split entirely when only the last-resort path is available.

## Files
- `scripts/lib/validate.ts` — modify mid-sentence check in `validateRefineCoverage` (line 554) to compare against pre-refine chunk ending before flagging; remove card-level mid-sentence warning (line 301-313); remove FRE warning (line 180-187); promote source_reference and markdown warnings to errors; add comments on intentionally non-blocking warnings
- `scripts/lib/__tests__/validate.test.ts` — update em-dash test (line 528) to expect no error when source also ends with em-dash; add test where refine introduces a mid-sentence break not present in source (still error); remove card-level mid-sentence tests; update tests for promoted warnings
- `scripts/lib/refine.ts` — expand `splitTextAtBoundary` sentence regex to handle quoted speech and semicolon/colon boundaries; skip length-split when no clean boundary exists
- `scripts/lib/__tests__/refine.test.ts` — add tests for expanded split boundaries and no-boundary fallback
- `content/pipeline/on-anger/` — regenerated refine and translate caches after fix
- `content/output/on-anger/` — regenerated card JSON

## Constraints
- Do not weaken the mid-sentence detection for actual mid-sentence splits (e.g., refine introducing a break not present in the source)
- Existing tests for genuine mid-sentence splits must still pass
- The comparison should be tolerant of minor whitespace/normalization differences between source and refined endings

## Tasks
- [x] T01: Modify refine mid-sentence check — In `validateRefineCoverage` (line 552-565), when a post-refine chunk fails `CHUNK_SENTENCE_END_RE`, find the corresponding pre-refine chunk (by sectionNumber) and check if its text also fails the regex. If both fail, suppress the error. If only the refined chunk fails, keep the error.
- [x] T02: Remove card-level mid-sentence warning — Delete the `SENTENCE_END_RE` check block (line 301-313) from `validateCardContent` and remove its associated tests.
- [x] T03: Remove FRE warning — Delete the FRE range check (line 180-187) from `validateReadability` and remove its associated tests.
- [x] T04: Promote source_reference warning to error — Change severity from "warn" to "error" at line 294 and update associated tests.
- [x] T05: Promote markdown-in-text warning to error — Change severity from "warn" to "error" at line 328 and update associated tests.
- [x] T06: Add comments on non-blocking warnings — Add inline comments to the unused-tag warning (line 140) and FKGL range warning (line 171) noting they are intentionally non-blocking.
- [x] T07: Update tests — In `scripts/lib/__tests__/validate.test.ts`: (a) update the em-dash refine test to pass matching pre-refine chunks that also end with em-dash → expect no error; (b) add a test where pre-refine ends with proper punctuation but post-refine ends mid-sentence → expect error; (c) verify existing mid-sentence tests still pass.
- [x] T08: Run tests — Run `npm test` to confirm all pipeline and web tests pass.
- [x] T09: Re-run on-anger full pipeline — Run `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book on-anger`. Verify refine passes without retries on book-2 and book-3, translate completes, and assemble succeeds.
- [x] ~~T09i: Add refine debug utility~~ (removed — diagnostics better suited to pipeline itself) — Create `scripts/debug-refine.ts` that mirrors the actual batch construction in `refineChunksBatch`. The tool operates at the level of batch request IDs (`refine_{bookSlug}_{chapterSlug}_{batchIndex}`). Usage: (1) `--list` — load parse caches, run chunker, show all batch IDs with their section ranges, word counts, and estimated reading times per section; (2) `--id <batchId>` — select a specific batch request to debug (e.g., `--id refine_on-anger_book-3_2`); (3) without `--dry-run`: send the selected batch to the real-time API, show the LLM's split/merge/keep decisions, apply them, run `splitOversizedChunk` on each result chunk showing boundary detection (paragraph → sentence → last-resort), then run `validateRefineCoverage` and print errors with full chunk text; (4) `--dry-run` — skip the API call, show pre-refine chunks, and simulate only the mechanical `splitOversizedChunk` pass to surface boundary-detection issues without spending API credits.
- [x] T09a: Fix `splitTextAtBoundary` sentence regex for quoted speech — Expand `/[.?!]\s/g` to `/[.?!;:]['""\u201D)\]]*\s/g` so it recognizes closing-quote endings (e.g., `you." He`) and semicolon/colon boundaries as valid split points. This fixes section 22 (quoted speech) and section 29 (semicolon-separated clauses) in on-anger book-3.
- [x] T09b: Skip length-split when no clean boundary exists — In `splitOversizedChunk`, if `splitTextAtBoundary` can only offer a midpoint-word-boundary split (no paragraph, sentence, or punctuation boundary found), keep the chunk as-is rather than producing a guaranteed mid-sentence error. A long card is better than a broken one.
- [x] T09c: Improve refine prompt split guidance — Update `buildBulkRefineSystem` to instruct the LLM to always split at sentence boundaries, never mid-sentence. Mention that each segment must end with sentence-ending punctuation (`.`, `?`, `!`, `;`, `:`, or a closing quote after one of these). This reduces how often the mechanical safety net triggers.
- [x] T09d: Add tests for expanded split boundaries and prompt — Test that `splitTextAtBoundary` splits at `." `, `; `, and `: ` boundaries. Test that oversized chunks with no clean boundary are kept intact.
- [x] T09f: Retry only failing batches, not entire chapters — In generate.ts, when `validateRefineCoverage` finds errors, extract the section numbers from the error messages, determine which batch(es) contain those sections, and retry only those batches via `refineChunksRealtime`. Splice the retried results back into the full chapter's refined chunks before re-validating. This reduces API calls (e.g., 1 batch instead of 5 for a 43-section chapter).
- [!] T09e: Re-run on-anger full pipeline — skipped: deferred until pipeline diagnostics are added
- [!] T10: Validate on-anger output — skipped: depends on T09e
- [!] T11: Run e2e tests — skipped: depends on T09e

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
