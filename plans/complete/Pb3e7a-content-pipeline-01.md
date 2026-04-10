# Content Validator

## Parent
`plans/Pb3e7a-content-pipeline-index.md`

## Objective
Build a TypeScript CLI that validates card JSON files and `_meta.json` against the ARCHITECTURE.md data model, readability targets, tag taxonomy, cross-file consistency, and semantic quality (single-idea coherence, standalone readability, meaning preservation) — producing a structured pass/warn/fail report.

## Decisions
- **TypeScript with tsx runner.** No compile step needed; `npx tsx scripts/validate.ts` works immediately. Portable into SvelteKit `src/lib/` later.
- **Single entry point.** `scripts/validate.ts` accepts a content directory path (default `src/content/`) and validates everything it finds. Also accepts individual chapter JSON files for spot-checking during generation.
- **Validation logic in a reusable module.** Core checks live in `scripts/lib/validate.ts` (structural) and `scripts/lib/validate-semantic.ts` (AI-powered). The generator (plan 02) can import them programmatically.
- **Readability via `text-readability` npm package.** Pure JS, no native deps — provides Flesch-Kincaid Grade Level and Flesch Reading Ease.
- **Semantic validation via `claude` CLI subagent.** Instead of the Anthropic SDK, AI-powered checks shell out to `claude -p "<prompt>"` via `child_process.execFile`. This runs through the local Claude Code subscription — no API key needed, more cost-efficient for local testing. A shared `scripts/lib/claude.ts` module wraps the CLI call with JSON parsing, retry on malformed output, and `maxBuffer` set to 1MB. Can be swapped for `@anthropic-ai/sdk` later for CI/production.
- **Defensive JSON parsing.** `claude -p` returns plain text — responses may include preamble, markdown fencing, or commentary around the JSON. The claude wrapper strips common wrappers (```json fences, leading/trailing prose) before parsing. If JSON extraction fails after one retry with a "respond with only JSON" follow-up, the card is flagged as `warn: semantic check failed to parse`.
- **Severity levels.** `error` = must fix (missing fields, invalid tags, broken references, meaning divergence). `warn` = should review (readability outside target, multi-idea card, depends on adjacent context). `info` = suggestion (split recommendation with proposed boundary, adjacent card that could resolve a dependency). Reports exit code 1 on any errors, 0 on warnings-only or clean.
- **Tag and author constants as shared module.** `scripts/lib/constants.ts` holds the 12 tags, 3 authors, and 5 book configs — single source of truth for both validator and generator.
- **Semantic results cached.** Semantic validation results written to `output/validation-cache/{card-id}.json` keyed by a hash of the card's `plain_english` + `original_excerpt`. Avoids re-running Claude CLI calls on unchanged cards.
- **Sequential execution for semantic checks.** Claude CLI calls run one at a time (no parallelism) to avoid overwhelming the local Claude Code session. Progress printed per card.

## Files
- `scripts/lib/constants.ts` — Tag slugs, author slugs/metadata, book configs (slug, author, chapter structure pattern, source file)
- `scripts/lib/types.ts` — TypeScript interfaces for Card, BookMeta, ChapterMeta, ValidationResult, ValidationMessage, SemanticResult
- `scripts/lib/claude.ts` — Wrapper around `claude -p`: execFile call, maxBuffer 1MB, JSON extraction from plain text response (strip markdown fences, preamble), retry once on parse failure, typed return
- `scripts/lib/validate.ts` — Structural validation functions (schema, readability, tags, cross-refs, content quality)
- `scripts/lib/validate-semantic.ts` — AI-powered semantic validation (single-idea, standalone coherence, meaning preservation) using `scripts/lib/claude.ts`
- `scripts/validate.ts` — CLI entry point: glob content dir, run checks, print report
- `package.json` — New; declares `tsx`, `text-readability`, `glob` deps and validation script
- `tsconfig.json` — Minimal config targeting Node + ESM

## Constraints
- FKGL target 7–8, FRE target 65–75 (per CLAUDE.md). Cards outside this range produce warnings, not errors — philosophical content sometimes requires longer sentences.
- Only the 12 fixed tags from CONTENT_STRATEGY.md are valid. Any other tag is an error.
- Card IDs must match pattern `{book_slug}-{chapter_num}-{card_num}` (zero-padded, e.g. `meditations-05-016`).
- `_meta.json` chapter `card_count` must match the number of cards in the corresponding chapter JSON file.
- Structural validation runs fully offline. Semantic validation requires `claude` CLI on PATH.
- Semantic checks assess meaning preservation against CONTENT_STRATEGY.md card writing guidelines: preserve original meaning precisely, preserve emotional tone, don't over-explain, each card should stand alone.

## Tasks
- [x] T01: Project setup — Create `package.json` with `tsx`, `text-readability`, `glob` deps; `tsconfig.json` targeting ESNext/NodeNext. Add `"validate": "tsx scripts/validate.ts"` script. DONE: Created both files; deps not installed yet.
- [x] T02: Shared constants and types — `scripts/lib/constants.ts` with VALID_TAGS (12 slugs + labels), AUTHOR_META (3 authors with slug/name/title), BOOK_CONFIGS (5 books with slug, author_slug, chapter_slug_pattern, source_file). `scripts/lib/types.ts` with Card, BookMeta, ChapterInfo, ValidationResult, ValidationMessage (with severity: error/warn/info), SemanticResult interfaces matching ARCHITECTURE.md models exactly.
- [x] T03: Claude CLI wrapper — `scripts/lib/claude.ts` exporting `callClaude(prompt: string): Promise<string>` and `callClaudeJSON<T>(prompt: string, schema: string): Promise<T>`. Uses `child_process.execFile('claude', ['-p', prompt])` with `maxBuffer: 1024 * 1024`. The JSON variant extracts JSON from the response by: (1) trying `JSON.parse` on the full output, (2) stripping ```json fences and retrying, (3) extracting content between first `{` and last `}`, (4) on failure, retrying the call once with "Respond with only valid JSON, no other text." appended to prompt. Throws typed error on final failure.
- [x] T04: Schema validation — In `scripts/lib/validate.ts`, implement `validateCardSchema(card: unknown): ValidationMessage[]` checking all required fields exist, correct types, id format matches `{book_slug}-{chapter}-{card}` pattern, `reading_time_seconds` is positive number, `tags` is non-empty array of 1-3 items.
- [x] T05: Tag validation — Implement `validateCardTags(card: Card): ValidationMessage[]` checking each tag is in VALID_TAGS. Also `validateTagCoverage(cards: Card[]): ValidationMessage[]` that warns if any tag has zero cards across the entire content set.
- [x] T06: Readability validation — Implement `validateReadability(card: Card): ValidationMessage[]` computing FKGL and FRE on `plain_english` field. Error if FKGL > 12 (definitely too hard). Warn if FKGL outside 7–8 or FRE outside 65–75. Skip cards with very short text (< 50 chars) where readability metrics are unreliable.
- [x] T07: Cross-reference validation — Implement `validateBookMeta(meta: BookMeta, chapterFiles: Map<string, Card[]>): ValidationMessage[]` checking: each chapter in meta has a corresponding JSON file, card_count matches actual count, total_cards matches sum, author_slug is valid, all chapter slugs are valid.
- [x] T08: Content quality checks — Implement `validateCardContent(card: Card): ValidationMessage[]` checking: `plain_english` is not empty and >= 50 chars, `original_excerpt` is not empty, `source_reference` matches expected format (e.g. "Meditations, Book 5, Section 16"), no HTML or markdown in text fields, `card_number` is sequential within chapter.
- [x] T09: Semantic validation — single-idea check — In `scripts/lib/validate-semantic.ts`, implement `validateSingleIdea(card: Card): Promise<SemanticResult>`. Calls `callClaudeJSON` asking: "Does this card contain a single coherent idea, or does it contain multiple distinct ideas that should be separate cards?" Expected response shape: `{ single_idea: boolean, suggestion?: string }`. If multiple ideas detected, return a `warn` with the suggestion (proposed split point). Cache results to `output/validation-cache/` keyed by hash of card content.
- [x] T10: Semantic validation — standalone coherence — Implement `validateStandalone(card: Card, prevCard: Card | null, nextCard: Card | null): Promise<SemanticResult>`. Calls `callClaudeJSON` asking: "Does this card make sense on its own to a reader with no surrounding context? Or does it depend on an adjacent card to be understood?" Provides adjacent cards as context. Expected response shape: `{ standalone: boolean, resolution?: string }`. Return `warn` with specific recommendation if not standalone (e.g. "merge with previous card" or "add brief context phrase").
- [x] T11: Semantic validation — meaning preservation — Implement `validateMeaningPreservation(card: Card): Promise<SemanticResult>`. Calls `callClaudeJSON` with both `original_excerpt` and `plain_english`, asking it to assess per CONTENT_STRATEGY.md guidelines: (a) Does the translation preserve the original meaning precisely? (b) Does it preserve the emotional tone? (c) Are any ideas added or removed? (d) Does it over-explain or patronize? Expected response shape: `{ faithful: boolean, tone_preserved: boolean, ideas_changed: boolean, over_explains: boolean, notes?: string }`. Return `error` if meaning is materially changed, `warn` if tone drifts or ideas are subtly added/removed, `info` if minor style suggestions.
- [x] T12: Semantic validation orchestrator — Implement `runSemanticValidation(cards: Card[]): Promise<ValidationMessage[]>` that runs all three semantic checks for each card sequentially (one Claude CLI call at a time), reading/writing cache, and collecting results. Batch cards for the coherence check so adjacent cards are available. Print progress (e.g. "Semantic check 47/120: meditations-05-016...").
- [x] T13: CLI entry point — `scripts/validate.ts` accepts `--content <dir>` (default `src/content/`) or `--file <path>` for single file. `--semantic` flag enables AI-powered checks (requires `claude` CLI on PATH). `--no-cache` flag forces re-running semantic checks. Discovers all `_meta.json` and chapter JSON files. Runs structural validators always, semantic validators when flagged. Prints grouped report (by book, then by severity). Exit 1 on errors, 0 otherwise. Summary line: "N errors, M warnings, P info across K books (L cards)".
- [x] T14: Validate existing output — Legacy chunks use {book, index, text, plain_text, char_count} — entirely different from target card format. All schema checks fail as expected. Generator must produce new format. — Run validator (structural only) against `output/chunks/Meditations_book_1_plain.json` to test it works on the legacy format. Document any differences between legacy chunk format and target card format in stdout. This serves as a smoke test.

## Verify
```bash
# Structural validation only (offline)
npx tsx scripts/validate.ts --content src/content/

# Full validation including semantic checks (requires claude CLI)
npx tsx scripts/validate.ts --content src/content/ --semantic
```
