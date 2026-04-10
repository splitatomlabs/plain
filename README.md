# Plain

Ancient philosophy, stripped to its core, in words anyone can understand.

Plain turns classic Stoic philosophy books into bite-sized cards written in plain English — so you can actually read them and finish them.

## The Three Voices

Three men. Three completely different lives. The same philosophy.

- **Epictetus** (The Slave) — Born into slavery. Found freedom in his own mind.
- **Marcus Aurelius** (The Emperor) — Ruled Rome. Wrote a private journal to keep himself sane.
- **Seneca** (The Senator) — One of the richest men alive. Forced to kill himself by the emperor he served.

They all arrived at the same answers. Plain lets you read those answers in words that don't require a philosophy degree.

## Launch Books

| Author | Book | Est. Cards |
|---|---|---|
| Epictetus | The Enchiridion | 60–80 |
| Marcus Aurelius | Meditations | 150–200 |
| Seneca | On the Shortness of Life | 40–60 |
| Seneca | On the Happy Life | 40–60 |
| Seneca | On Peace of Mind | 40–60 |

Every card has two layers: a **plain English translation** (8th-grade reading level) and the **original text** shown below it. Cards are tagged with 12 themes like "Calm Your Mind," "Facing Fear," and "Death & Mortality" — tap a tag to see how a slave, an emperor, and a senator each approached the same idea.

## Tech Stack

**SvelteKit + Vercel** (free tier). No database. No auth. All content is static JSON. Progress tracking uses localStorage.

- Structural pages pre-rendered at build time
- Card pages use ISR (Incremental Static Regeneration) — cached at the edge after first visit
- OG images generated on-demand via `@vercel/og` for card sharing
- Self-hosted serif font for a book-like reading experience

## Content Pipeline

TypeScript CLI tools that turn plain-text source books into card JSON. Requires `claude` CLI on PATH for translation and semantic checks.

**Pipeline:** `parse → precheck → translate → assemble`

1. **Parse** — Split source text into sections by Roman numeral markers
2. **Pre-check** — AI check that each section contains a single idea and stands alone
3. **Translate** — Plain English translation + tagging, with built-in meaning preservation verification
4. **Assemble** — Generate card IDs, reading time, source refs, write to `src/content/`

```bash
# Install dependencies
npm install

# Parse all books (no AI calls needed)
npx tsx scripts/generate.ts --all --phase parse

# Test full pipeline on a small subset (2 sections per chapter)
npx tsx scripts/generate.ts --book shortness-of-life --limit 2

# Generate a full book
npx tsx scripts/generate.ts --book shortness-of-life

```

Key flags: `--limit <n>` caps sections per chapter, `--dry-run` skips AI calls, `--skip-precheck` skips the pre-check phase, `--phase` runs a single phase.

## Testing

```bash
npm test
```

70 unit tests covering the parser (all 5 book formats against real source files), chunker (prefix stripping, fragment merging), structural validator (schema, tags, readability, cross-refs), and card assembler (ID generation, source references, reading time).

## Documentation

- `ARCHITECTURE.md` — Data models, route structure, rendering strategy, and full project architecture
- `BRANDING.md` — Brand guide covering voice, visual identity, motion, sound, and brand rules
- `CONTENT_STRATEGY.md` — Book selection, card writing guidelines, tag taxonomy, and content pipeline
