# Content Generator

## Parent
`plans/Pb3e7a-content-pipeline-index.md`

## Depends on
- `plans/Pb3e7a-content-pipeline-01.md` — Validator provides shared types, constants, claude wrapper, and verification of generated output

## Objective
Build a TypeScript CLI pipeline that parses plain-text source books, chunks them by section (one idea = one card, never split), translates each chunk to plain English via the `claude` CLI, assigns tags, and outputs card JSON files matching the ARCHITECTURE.md content file structure — ready for `src/content/`.

## Decisions
- **TypeScript with tsx runner.** Consistent with the validator. `npx tsx scripts/generate.ts` runs the full pipeline.
- **Per-book config.** Each book has distinct structure — Meditations uses `THE FIRST BOOK` + Roman numeral sections, Enchiridion uses standalone Roman numeral headers, Seneca essays use `I. text` inline Roman numerals. Book configs in `scripts/lib/constants.ts` (from plan 01) declare the parsing strategy per book.
- **Three-phase pipeline.** (1) Parse & chunk → intermediate JSON. (2) Translate via `claude` CLI → adds `plain_english`. (3) Finalize → assign IDs, tags, reading time, source refs, write to `src/content/` structure. Phases are independently resumable — if translation fails partway, resume from last successful chunk.
- **Translation via `claude` CLI subagent.** Reuses the `scripts/lib/claude.ts` wrapper from plan 01. Each chunk is translated by calling `claude -p` with the translation prompt. Runs sequentially (one call at a time). No API key needed — uses the local Claude Code subscription. Can be swapped for `@anthropic-ai/sdk` later for CI/production.
- **Tagging via Claude CLI.** Combined with translation in a single call — prompt requests structured JSON response with both `plain_english` and `tags`. The `callClaudeJSON` wrapper handles response parsing.
- **One section = one card.** Each Roman-numeral-delimited section becomes exactly one card, regardless of length. No sentence-splitting. The source text's section markers are the natural idea boundaries. Only exception: sections under ~50 chars that are clearly fragments (e.g. a stray heading) are merged with the following section.
- **Resumable state file.** `output/generate-state.json` tracks which chunks have been translated. Allows resuming after interruption without re-running Claude CLI calls on already-completed chunks.
- **Validation as final step.** After generating all files for a book, run the validator from plan 01 (structural checks) to verify output.

## Files
- `scripts/lib/constants.ts` — Extended with book-specific parsing configs (header patterns, section patterns, chapter grouping rules)
- `scripts/lib/parser.ts` — Plain text parsing: strip Gutenberg headers/footers, detect book/chapter boundaries, split on section markers
- `scripts/lib/chunker.ts` — Minimal: strip Roman numeral prefixes, merge fragment sections (< 50 chars), clean whitespace. No sentence-splitting.
- `scripts/lib/translator.ts` — Translation orchestration: builds prompts, calls `claude` CLI via `scripts/lib/claude.ts`, parses structured JSON responses, manages resume state
- `scripts/lib/prompt.ts` — Generalized translation prompt template. Per-author voice guidance (Epictetus = direct/blunt, Marcus = reflective/personal, Seneca = warm/conversational). Replaces the Meditations-specific `plain_translation_prompt.txt`.
- `scripts/lib/assembler.ts` — Takes translated chunks and assembles final card JSON with IDs, source references, reading time estimation. Generates `_meta.json` per book. Writes to `src/content/{book_slug}/` directory structure.
- `scripts/generate.ts` — CLI entry point: `--book <slug>` (one book) or `--all` (all 5). `--phase parse|translate|assemble|all` to run specific phases. `--dry-run` to preview without Claude CLI calls.

## Constraints
- Source books are plain text in `source-books/`. Each has a different structure:
  - `meditations.txt` — `THE FIRST BOOK` headers, then `I.`, `II.` inline Roman numerals. 12 books × variable sections.
  - `enchiridion.txt` — Gutenberg preamble (intro, bibliography), then `I` through `LI` as centered standalone Roman numerals (no period, surrounded by whitespace). 53 sections, no chapter grouping — group into `sections-01-10`, `sections-11-20`, etc.
  - `on-the-shortness-of-life.txt` — No Gutenberg header. `I.` through `XX.` inline Roman numerals with text immediately following. Single chapter grouping: `sections-01-07`, `sections-08-14`, `sections-15-20`.
  - `on-the-happy-life.txt` — `I.` through `XXVIII.` inline. Group: `sections-01-10`, `sections-11-20`, `sections-21-28`.
  - `on-peace-of-mind.txt` — `I.` through `XVII.` inline. Some sections have speaker labels like `[_Serenus._]`, `[_Seneca._]` — strip these. Group: `sections-01-09`, `sections-10-17`.
- **One section = one card.** Never split a section into multiple chunks. The section markers in the source text represent natural idea boundaries.
- Card ID format: `{book_slug}-{chapter_num}-{card_num}`, zero-padded to 2 digits for chapter and 3 for card (e.g. `meditations-05-016`, `enchiridion-03-002`).
- Chapter slugs: Meditations uses `book-01` through `book-12`. Others use `sections-01-10` etc.
- `reading_time_seconds`: estimate at ~200 words/minute on `plain_english` text.
- `source_reference` format: `"{Book Title}, {Chapter/Section} {Number}"` — e.g. `"Meditations, Book 5, Section 16"`, `"The Enchiridion, Section 23"`, `"On the Shortness of Life, Section 8"`.
- Gutenberg headers/footers must be stripped before parsing (detect `*** START OF` / `*** END OF` markers, or known title lines).
- Translation phase requires `claude` CLI on PATH. Parse and assemble phases work offline.

## Tasks
- [ ] T01: Book parsing configs — Extend `scripts/lib/constants.ts` with per-book parsing config: `headerPattern` (regex for book/chapter boundaries), `sectionPattern` (regex for section markers), `chapterGrouping` (how sections map to chapter JSON files), `gutenbergStrip` (boolean), `speakerLabels` (boolean, for Peace of Mind). Include source file path per book.
- [ ] T02: Text parser — `scripts/lib/parser.ts` with `parseSourceText(text: string, config: BookConfig): ParsedBook`. Strips Gutenberg preamble/footer. Detects chapter boundaries (Meditations) or treats whole text as single chapter (Seneca essays). Splits at section markers. Returns `{ chapters: [{ slug, title, sections: [{ number, text }] }] }`. Handle all 5 book formats.
- [ ] T03: Chunker — `scripts/lib/chunker.ts` with `chunkSections(sections: Section[]): Chunk[]`. Minimal processing: strip leading Roman numeral prefixes from text, strip speaker labels (Peace of Mind), merge fragment sections (< 50 chars) with the following section, clean up whitespace/newlines. No sentence-splitting — each section becomes exactly one chunk.
- [ ] T04: Translation prompt — `scripts/lib/prompt.ts` with `buildTranslationPrompt(chunk: Chunk, bookConfig: BookConfig): string`. Generalize `plain_translation_prompt.txt` for all 5 books. Include author-specific voice guidance. Target FKGL 7–8 (updated from old grade 6 target). Request structured JSON response with `plain_english` and `tags` (array of 1–3 from the 12 valid tags). Include tag list with brief descriptions in prompt. Provide 2 worked examples per author voice. End prompt with explicit instruction: "Respond with only valid JSON matching this schema: `{ "plain_english": string, "tags": string[] }`".
- [ ] T05: Translator — `scripts/lib/translator.ts` with `translateChunks(chunks: Chunk[], config: BookConfig): AsyncGenerator<TranslatedChunk>`. Uses `callClaudeJSON` from `scripts/lib/claude.ts` (built in plan 01). Runs sequentially — one CLI call at a time. Writes progress to `output/generate-state.json` after each successful translation. Resumes from state file on restart (skips already-translated chunks). Validates that returned tags are from the valid set (re-prompts once if invalid tags returned). Prints progress: "Translating chunk 47/120: meditations-05-016...".
- [ ] T06: Card assembler — `scripts/lib/assembler.ts` with `assembleBook(translated: TranslatedChunk[], config: BookConfig): { meta: BookMeta, chapters: Map<string, Card[]> }`. Assigns card IDs (zero-padded), card_number, total_cards_in_chapter, source_reference, reading_time_seconds. Groups cards into chapter files per the book's grouping config. Generates `_meta.json` with correct card counts and chapter listing.
- [ ] T07: File writer — Add `writeContentFiles(meta: BookMeta, chapters: Map<string, Card[]>, outputDir: string)` to assembler. Writes `{outputDir}/{book_slug}/_meta.json` and `{outputDir}/{book_slug}/{chapter_slug}.json`. Formats JSON with 2-space indent. Creates directories as needed.
- [ ] T08: CLI entry point — `scripts/generate.ts` with args: `--book <slug>` or `--all`, `--phase parse|translate|assemble|all` (default `all`), `--dry-run`, `--output <dir>` (default `src/content`). Parse phase writes intermediate `output/parsed/{book_slug}.json`. Translate phase reads parsed, writes `output/translated/{book_slug}.json`. Assemble phase reads translated, writes final card JSON. Print progress per phase.
- [ ] T09: Validation integration — After assemble phase completes for a book, import and run the structural validator from plan 01 against the generated output. Print validation report. Fail the pipeline if any errors are found (warnings OK).
- [ ] T10: Test with Meditations — Run the full pipeline on `meditations.txt` with `--phase parse` only (no Claude CLI needed). Verify parsed sections match the Roman numeral markers in the source text. Compare section count per book against the existing `output/chunks/Meditations_book_1_original.json` (noting that old chunks used sentence-splitting, so new output will have fewer, larger chunks matching natural section boundaries). Document the comparison.

## Verify
```bash
# Parse only (no Claude CLI needed)
npx tsx scripts/generate.ts --book meditations --phase parse --dry-run

# Full pipeline for one book (requires claude CLI)
npx tsx scripts/generate.ts --book shortness-of-life

# Validate generated output
npx tsx scripts/validate.ts --content src/content/
```
