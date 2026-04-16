# Improve standalone card readability via translation prompt

## Objective
Update the translation prompt and user message to produce self-contained cards that make sense without surrounding context, eliminating 66 major readability issues (unexplained pronouns, dangling references, mid-story gaps, unattributed debate replies).

## Decisions
- Root cause: translator receives only the current chunk — no adjacent context. It can't fix dangling references it doesn't know about.
- Fix: pass the previous chunk's text as read-only context in the user message (not for translation, just for awareness). This lets the LLM resolve pronouns and add brief context where the original assumes continuity.
- Add a standalone readability rule to the system prompt: "Each card must make sense to a reader who hasn't seen the previous card. Replace pronouns with names on first use. Never open with dangling references like 'This is why...', 'He said...', or 'All of this...' without restating the subject."
- Word count concern: adding context clauses may push cards over 200 words. Mitigate by (a) adding an explicit instruction: "If adding context would exceed ~200 words, compress the rest of the translation to compensate — never sacrifice standalone clarity for brevity, but stay concise" and (b) the existing MAX_READING_TIME_SECONDS safety net in refine already caps source chunks at 200 words.
- Bump PIPELINE_VERSION to 3 — invalidates translate cache only (refine cache stays valid since refine didn't change).
- Actually: PIPELINE_VERSION invalidates ALL caches. Instead, delete only translate caches before rerun, leaving refine caches intact.
- Cost estimate: translate-only rerun ~$5.50 (same as last run)

## Files
- `scripts/lib/prompt.ts` — add standalone readability rule to system prompt; update `buildTranslationUser` to accept optional previous chunk text
- `scripts/lib/translator.ts` — pass previous chunk to `buildTranslationUser` in batch request construction
- `scripts/lib/__tests__/prompt.test.ts` — update tests for new prompt content and user message format
- `content/pipeline/*/translate.json` — delete before rerun (refine caches preserved)
- `content/output/*/` — regenerated card JSON after rerun

## Constraints
- Do not change refine phase or refine cache
- Preserve 8th-grade reading level (FKGL 7-8)
- Merged cards must stay under ~200 words / 60s reading time
- Previous chunk context is read-only — the LLM translates only the current chunk
- Pipeline cost should be ~$5-6 (translate only)
- All existing tests must pass after changes

## Tasks
- [ ] T01: Update translation system prompt — In `scripts/lib/prompt.ts`, add a new rule after rule 9: "If the passage opens with a pronoun (he, she, they, it, this, that) or a transitional phrase (This is why, And so, But, Therefore) that depends on a prior passage, replace the pronoun with the person's name or role, or restate the premise briefly. Each card must be independently comprehensible." Add guidance: "If a passage is mid-narrative (continuing a story from a prior passage), add a brief contextual clause (5-10 words) at the start to orient the reader. If adding context would push the translation over ~200 words, compress the rest to compensate."
- [ ] T02: Pass previous chunk context — Update `buildTranslationUser` in `scripts/lib/prompt.ts` to accept an optional `prevChunkText?: string` parameter. When provided, prepend `PREVIOUS PASSAGE (for context only — do NOT translate this):\n${prevChunkText}\n\n` before the `ORIGINAL:` block. Update `buildTranslationPrompt` accordingly.
- [ ] T03: Wire previous chunk in translator — In `scripts/lib/translator.ts` `translateChunksBatch`, when building batch requests, pass the previous chunk's text to `buildTranslationUser`. For the first chunk in a chapter, pass no previous context. For subsequent chunks, pass `chunks[index - 1].text`.
- [ ] T04: Update prompt tests — In `scripts/lib/__tests__/prompt.test.ts`, add tests: (a) system prompt contains standalone readability rule, (b) `buildTranslationUser` with no previous chunk produces same format as before, (c) `buildTranslationUser` with previous chunk includes the context block, (d) previous chunk context is labeled as "do NOT translate".
- [ ] T05: Delete translate caches — Remove `content/pipeline/*/translate.json` for all 7 books. Do NOT delete parse or refine caches.
- [ ] T06: Run translate + assemble — Run `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --all`. Verify refine loads from cache and only translate makes API calls. Verify all 7 books assemble successfully.
- [ ] T07: Validate output — Confirm no card exceeds 60s reading time. Run the mid-sentence validation. Spot-check 10-15 previously-flagged cards (from the readability audit) to verify pronouns are resolved and references are self-contained. Run `npm test`.
- [ ] T08: Run e2e tests — Build app and run full e2e suite. `npm run build --prefix web && npm run test:e2e --prefix web`.
- [ ] T09: Re-audit standalone readability — Run the same 7-book subagent review from the previous audit on the new output. Compare major issue counts. Target: <10 major issues total (down from 66).

## Verify
```bash
npm test
npm run build --prefix web
npm run test:e2e --prefix web
```
