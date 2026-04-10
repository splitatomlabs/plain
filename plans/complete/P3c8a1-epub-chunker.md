# EPUB Chunker & Plain Translation Pipeline

## Objective
Build a Python script that reads an EPUB file, chunks it into card-sized text segments, then generates simplified "plain" translations using a consistent AI prompt — starting with Meditations Books 1 and 2.

## Decisions
- Python script using `ebooklib` for EPUB parsing and `beautifulsoup4` for HTML-to-text extraction
- Chunk boundaries follow the existing Roman numeral sections (I, II, III…) already present in Meditations; sections that exceed ~600 chars get split at sentence boundaries
- Claude Code subagent (Agent tool) for plain translation — no API key or SDK needed; allows fast prompt iteration before scaling to API
- Output stored as JSON files in `output/chunks/` — one file per book containing both original and plain chunks
- Translation prompt lives in a standalone text file (`scripts/plain_translation_prompt.txt`) for repeatability and version control

## Files
- `scripts/chunk_epub.py` — EPUB reader + chunker, outputs original chunks JSON
- `scripts/plain_translation_prompt.txt` — the reusable prompt for translation (used by subagent and eventually API)
- `output/chunks/meditations_book_1_original.json` — Book 1 original chunks
- `output/chunks/meditations_book_1_plain.json` — Book 1 plain translation chunks
- `output/chunks/meditations_book_2_original.json` — Book 2 original chunks
- `output/chunks/meditations_book_2_plain.json` — Book 2 plain translation chunks

## Constraints
- Card text must fit ~600 characters (roughly what fits on an iPhone screen card with comfortable reading typography)
- Plain translations must preserve the author's meaning; target 6th grade reading level (Flesch-Kincaid ~6.0, Flesch Reading Ease ~75-80)
- Chunks must be logically self-contained (no mid-sentence splits)
- Each chunk retains metadata: book number, section number, position within section
- Must work with any EPUB 3 file (not hardcoded to Meditations structure)

## Tasks
- [x] T01: Create `scripts/chunk_epub.py` — Use `ebooklib` to parse EPUB and `beautifulsoup4` to strip HTML to plain text. Accept CLI args: `--epub <path> --books <1,2>`. Split text on Roman numeral section markers (e.g. `I.`, `II.`). Sub-split sections exceeding 600 chars at sentence boundaries. Output JSON with fields: `book`, `section`, `part`, `text`, `char_count`. Write to `output/chunks/<title>_book_<n>_original.json`. Install deps: `pip install ebooklib beautifulsoup4`.
- [x] T02: Test chunker on Meditations Books 1 & 2 — Run `chunk_epub.py` on `books/pg2680-images-3.epub --books 1,2`. Verify: all sections captured, no chunk exceeds 600 chars, no empty chunks, text is clean (no HTML artifacts). Fix any parsing issues.
- [x] T03: Create `scripts/plain_translation_prompt.txt` — Write the reusable prompt for Claude. Requirements: rewrite to 6th grade reading level (Flesch-Kincaid ~6.0, Flesch Reading Ease ~75-80), preserve original meaning, keep the same structure and paragraph breaks, use modern accessible language, avoid slang or over-simplification, maintain the reflective/meditative tone. Include few-shot examples in the prompt.
- [x] T04: Translate Book 1 via subagent — Spawn a Claude Code subagent with the translation prompt from T03 and the original chunks JSON from T02. The subagent reads the original chunks, translates each one, and writes the output to `output/chunks/meditations_book_1_plain.json` (same structure with `plain_text` field added). Review output quality.
- [x] T05: Translate Book 2 via subagent — Same approach as T04 for Book 2. Write to `output/chunks/meditations_book_2_plain.json`. Review output quality and adjust prompt if needed.
- [x] T06: Create `scripts/chunk_stats.py` — Read original and plain JSON files, report: min/max/mean/median char count, distribution histogram (buckets: 0-200, 200-400, 400-600), longest chunks with preview text. Compute Flesch-Kincaid Grade Level and Flesch Reading Ease for plain translations to verify they hit the 6th grade target. Accept `--input <json_path>` (or multiple). Output to stdout for quick review. Run on Books 1 & 2 output and include results in a `output/chunks/stats.txt` snapshot.
- [x] T07: Create `scripts/card_viewer.py` — Interactive CLI card viewer. Accept `--original <json> --plain <json>`. Display one chunk at a time in the terminal: show the original text, a separator, then the plain translation. Controls: right arrow or `n` for next card, left arrow or `p` for previous, `o` to show only original, `t` to show only plain translation, `q` to quit. Show card position (e.g. "3/17") and chunk metadata (book, section). Use `curses` or raw terminal input for keypress handling.
- [x] T08: Add `scripts/run_pipeline.sh` — Convenience wrapper that runs chunk + translate for specified books end-to-end. Update CLAUDE.md with new commands under a "Scripts" section.

## Verify
```bash
python3 scripts/chunk_epub.py --epub books/pg2680-images-3.epub --books 1,2
python3 scripts/chunk_stats.py --input output/chunks/meditations_book_1_original.json output/chunks/meditations_book_1_plain.json output/chunks/meditations_book_2_original.json output/chunks/meditations_book_2_plain.json
```
