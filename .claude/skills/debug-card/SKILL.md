# Debug Card Content

Diagnose issues with specific card content — trace a string or problem through the full pipeline to find where it originates and whether it's a bug.

## When to use

When a user reports unexpected text, formatting, or content on a specific card (e.g., "I found this weird string on a card").

## Process

### 1. Locate the string across the pipeline

Search for the problematic string (or a distinctive fragment) across all content layers:

```
Grep for the string in:
  content/source/          — raw source texts (do not modify these)
  content/pipeline/        — parse.json, refine.json, translate.json per book
  content/output/          — final card JSON served to the web app
  content/fixtures/        — test fixture copies of output
```

### 2. Trace origin through pipeline stages

The content pipeline flows: **source text -> parse -> refine -> translate -> assemble -> output**

For each stage where the string appears, read the surrounding context to understand:
- **source**: Is this part of the original philosophical text, or an editorial annotation (footnote, colophon, glossary entry, translator note)?
- **parse.json**: Did the parser correctly separate it from the main section text, or did it get concatenated?
- **refine.json**: Did the refine stage carry it forward or strip it?
- **translate.json**: Did the LLM translate/preserve it? Check both `originalText` and `plainEnglish` fields.
- **output JSON**: Which card ID and fields contain it? (`plain_english`, `original_excerpt`)

### 3. Identify root cause

Classify the issue:
- **Parser bug**: Source annotation (italic colophons, footnotes, glossary refs) incorrectly attached to section text
- **Refine bug**: Content that should have been cleaned wasn't
- **Translate bug**: LLM introduced, dropped, or mangled content
- **Assemble bug**: Card boundaries or metadata are wrong
- **Not a bug**: The text is legitimate content that just looks odd

### 4. Assess scope

Check whether the issue is isolated or systemic:
- Search for similar patterns across other books/chapters in the same pipeline stage
- For parser issues, check if the pattern (e.g., italic annotations) appears elsewhere in source texts

### 5. Report

Summarize findings in a table:

| Field | Value |
|---|---|
| **What** | Description of the problematic content |
| **Where** | Card ID and field(s) affected |
| **Root cause** | Which pipeline stage introduced the issue and why |
| **Scope** | One-off or systemic across multiple cards/books |
| **Verdict** | Bug or not-a-bug, with recommended fix location |

Do NOT fix anything unless explicitly asked. The goal is diagnosis.

## Key files

- Parser: `scripts/lib/parser.ts`
- Parser config: `scripts/lib/constants.ts`
- Pipeline cache: `content/pipeline/{book-slug}/`
- Output: `content/output/{book-slug}/`
- Fixtures: `content/fixtures/{book-slug}/`
