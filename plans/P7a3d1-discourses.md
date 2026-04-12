# Add Discourses of Epictetus

## Objective
Add "Discourses" by Epictetus to the content pipeline — a selection of 25 discourses from Project Gutenberg #10661 (George Long translation), excluding the biographical note and the Enchiridion appendix.

## Decisions
- Slug: `discourses`, title: "Discourses"
- Source: Gutenberg #10661 plain text, stripped to Discourses section only (no biographical note, no Enchiridion)
- Each discourse becomes its own chapter — chapter slugs use discourse titles converted to kebab-case (e.g., `of-contentment`, `of-providence`)
- New parser mode needed: discourses use ALL-CAPS headings with em-dash separators, not Roman numeral sections. Each discourse is one continuous text block.
- The refine phase will split long discourses into multiple cards as it does for other books
- Description notes this is a selection: "25 discourses from the four books of Epictetus's teachings, as recorded by his student Arrian. Practical lessons on what you can control, how to handle hardship, and what philosophy is actually for."
- `trailingContentPattern` strips the Enchiridion section at the end

## Files
- `content/source/discourses.txt` — new source file (downloaded from Gutenberg)
- `scripts/lib/constants.ts` — new `BookConfig` entry for discourses
- `scripts/lib/parser.ts` — new discourse-style parser (heading-based section splitting)
- `scripts/lib/__tests__/parser.test.ts` — tests for discourse parsing
- `web/svelte.config.js` — add `/discourses` to prerender entries
- `content/output/discourses/` — generated output (from pipeline run)

## Constraints
- Parser must handle ALL-CAPS headings followed by em-dash (—) as section boundaries
- Must strip biographical note preamble and Enchiridion appendix
- No changes to existing books' pipeline or output
- Chapter titles should be title-cased versions of the discourse headings (not ALL CAPS)
- Existing tests must pass; new parser tests for the heading-based splitting
- Source reference template: "Discourses, {chapter_title}, Section {n}" (where {n} is the chunk number within a discourse after refine splitting)

## Tasks
- [x] T01: Download source text — Fetch `pg10661.txt` from Gutenberg, save as `content/source/discourses.txt`. Manually verify: file starts with Gutenberg header, contains all 25 discourses, ends with Enchiridion section.
- [x] T02: Add BookConfig — Add new entry to `BOOK_CONFIGS` in `scripts/lib/constants.ts`. Slug `discourses`, author `epictetus`, `gutenbergStrip: true`. Add a new `headingPattern` field (regex matching ALL-CAPS discourse titles with em-dash). Set `trailingContentPattern` to match the Enchiridion heading. Set `preamblePattern` to skip the biographical note and table of contents. Add `AUTHOR_CONTEXT` entry for Epictetus discourses in `scripts/lib/refine.ts`.
- [x] T03: Discourse parser — Add heading-based section splitting to `scripts/lib/parser.ts`. When `headingPattern` is set on a BookConfig, use it to split text into sections by ALL-CAPS headings. Each heading becomes a chapter. Title-case the heading for the chapter title. Generate kebab-case slugs from the title. Each section's text is everything between one heading and the next. Files: `scripts/lib/parser.ts`, `scripts/lib/constants.ts` (update `BookConfig` type if needed)
- [x] T04: Parser tests — Add tests for the discourse heading parser: correct number of chapters found, heading title conversion, preamble/Enchiridion stripping, text boundaries between discourses. Files: `scripts/lib/__tests__/parser.test.ts`
- [x] T05: Run parse phase — `npx tsx scripts/generate.ts --book discourses --phase parse`. Verify `content/pipeline/discourses/parse.json` has 25 chapters, each with one section containing the discourse text. Spot-check a few chapters for correct boundaries.
- [x] T06: Run full pipeline — `ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book discourses`. Verify output in `content/output/discourses/`: `_meta.json` + chapter JSON files. Check card count is in the 150-300 range. Spot-check plain English quality.
- [x] T07: Add prerender entry — Add `/discourses` to the `entries` array in `web/svelte.config.js`.
- [x] T08: Verify in dev server — Run `npm run dev --prefix web`, navigate to `/discourses`. Verify book landing page renders correctly, cards are readable, navigation works between cards and chapters. Take screenshots.
- [x] T09: Run tests — Run `npm test` to verify all pipeline and web tests pass.

## Verify
```bash
npm test
npm run dev --prefix web
# Navigate to /discourses and verify rendering
```
