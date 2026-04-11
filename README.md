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

## Local Development

```bash
npm install

# Start the dev server (http://localhost:5173)
npm run dev --prefix web

# Expose to local network for mobile testing
npm run dev --prefix web -- --host
```

## Deploy

Vercel auto-deploys the `main` branch to production on every push. Pull requests automatically get preview deployments with a unique URL for review before merging.

## Content Pipeline

TypeScript CLI tools that turn plain-text source books into card JSON. Source texts live in `content/source/`, pipeline cache in `content/pipeline/`, and finished card JSON is written to `content/output/`. Requires `claude` CLI on PATH for translation and semantic checks.

**Pipeline:** `parse → refine → translate → assemble`

1. **Parse** — Split source text into sections by Roman numeral markers
2. **Refine** — AI reviews each section: splits multi-idea sections into separate chunks, merges sections that can't stand alone
3. **Translate** — Plain English translation + tagging, with built-in meaning preservation verification
4. **Assemble** — Generate card IDs, reading time, source refs, write to `content/output/`

```bash
# Install dependencies
npm install

# Parse all books (no AI calls needed)
npx tsx scripts/generate.ts --all --parse-only

# Test full pipeline on a small subset (2 sections per chapter)
npx tsx scripts/generate.ts --book shortness-of-life --limit 2

# Generate a full book
npx tsx scripts/generate.ts --book shortness-of-life

```

Key flags: `--limit <n>` caps sections per chapter, `--parse-only` skips AI calls.

## Testing

```bash
npm test          # runs both pipeline and web unit tests
```

`npm test` runs two suites in sequence:

1. **Pipeline tests** (84 tests) — parser, chunker, refine, validator, and assembler (`scripts/lib/__tests__/`)
2. **Web unit tests** (22 tests) — content utilities and tag logic (`web/tests/unit/`)

Playwright e2e tests are separate and require a built app:

```bash
npm run build --prefix web
npm run test:e2e --prefix web
```

## Documentation

- `docs/ARCHITECTURE.md` — Data models, route structure, rendering strategy, and full project architecture
- `docs/BRANDING.md` — Brand guide covering voice, visual identity, motion, sound, and brand rules
- `docs/CONTENT_STRATEGY.md` — Book selection, card writing guidelines, tag taxonomy, and content pipeline
- `docs/ANALYTICS.md` — Analytics strategy and event tracking
