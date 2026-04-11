# Modular config-driven parser

## Objective
Eliminate slug-specific branching in the parser by moving book-specific logic into BookConfig fields, and fix Enchiridion trailing publisher/footnote content.

## Decisions
- Add `sectionSplitMode: 'inline' | 'centered'` to BookConfig — replaces `if (config.slug === "enchiridion")` check
- Add optional `trailingContentPattern?: RegExp` — strips trailing footnotes/publisher info from last section; replaces hardcoded Seneca regex and fixes Enchiridion
- Add optional `preamblePattern?: RegExp` — replaces `stripSenecaPreamble` slug dispatch; Seneca books set this to their sectionPattern
- Meditations dispatch via `headerPattern` already works — no change needed
- Enchiridion trailing content: strip from `\nFootnotes\n` onward (catches `[N]` footnotes without space after `]` and publisher catalog)
- `parseMeditations` stays as-is — it's already config-driven via `headerPattern` + `chapterGrouping`

## Files
- `scripts/lib/constants.ts` — add `sectionSplitMode`, `trailingContentPattern`, `preamblePattern` to BookConfig; set values per book
- `scripts/lib/parser.ts` — replace slug checks with config field dispatch; remove `stripSenecaPreamble` function; generalize trailing content strip
- `scripts/lib/__tests__/parser.test.ts` — add test for Enchiridion section 51 not containing footnotes/publisher text; add test for section count stability

## Constraints
- Must not change parse output for any book except Enchiridion section 51 (which should shrink)
- Meditations parser path is unchanged
- All existing parser tests must continue to pass
- Pipeline intermediate files for happy-life, peace-of-mind, shortness-of-life are unaffected (source hash unchanged)

## Tasks
- [x] T01: Add config fields to BookConfig — add `sectionSplitMode`, `trailingContentPattern`, `preamblePattern` to interface and set values for all 5 books in `scripts/lib/constants.ts`
- [x] T02: Add Enchiridion parser tests — test that section 51 does not contain "Footnotes", "LIBERAL ARTS PRESS", or `[1]` footnote refs; test total section count is exactly 50 (not 51 — section 51 is the fragment with LI as Roman numeral but it's actually just Epictetus content); verify in `scripts/lib/__tests__/parser.test.ts`
- [x] T03: Refactor parseSourceText dispatch — replace `if (config.slug === "enchiridion")` and `stripSenecaPreamble` call with config field checks (`sectionSplitMode`, `preamblePattern`); in `scripts/lib/parser.ts`
- [x] T04: Generalize trailing content strip — use `config.trailingContentPattern` instead of hardcoded Seneca regex in `parseSingleEssay`; applies to both Enchiridion and Seneca books; in `scripts/lib/parser.ts`
- [x] T05: Remove dead code — delete `stripSenecaPreamble` function; in `scripts/lib/parser.ts`
- [x] T06: Run tests — `npm test` must pass (all 210 tests)
- [x] T07: Verify Enchiridion parse output — run parser on enchiridion source, confirm section 51 text ends with actual Epictetus content (not publisher info), confirm total sections is correct

## Verify
```bash
npm test
```
