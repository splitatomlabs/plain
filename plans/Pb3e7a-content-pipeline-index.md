# Content Pipeline — Index

## Objective
Build a TypeScript content pipeline that (1) validates card JSON against the ARCHITECTURE.md data model and readability targets, and (2) generates card JSON from plain-text source books via chunking and Claude API translation.

## Plans
1. `plans/Pb3e7a-content-pipeline-01.md` — Content validator: schema, readability, tag, and cross-reference checks
   - Status: [x]
2. `plans/Pb3e7a-content-pipeline-02.md` — Content generator: text parsing, chunking, translation, and card JSON output
   - Status: [ ]
   - Depends on: 01 (validator used to verify generator output)

## Notes
- Both plans produce TypeScript in `scripts/` — no SvelteKit project exists yet, but TS chosen so code can migrate into `src/lib/` later.
- The validator is built first so the generator can invoke it as a final verification step.
- Existing Python scripts (`chunk_epub.py`, `chunk_stats.py`, `card_viewer.py`) are retained as-is — new TS scripts complement rather than replace them.
