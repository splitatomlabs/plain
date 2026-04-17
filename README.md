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

| Author | Book | Cards |
|---|---|---|
| Epictetus | The Enchiridion | 72 |
| Epictetus | Discourses | 294 |
| Marcus Aurelius | Meditations | 522 |
| Seneca | On the Shortness of Life | 69 |
| Seneca | On the Happy Life | 79 |
| Seneca | On Peace of Mind | 79 |
| Seneca | On Anger | 193 |

Every card has two layers: a **plain English translation** (8th-grade reading level) and the **original text** shown below it. Cards are tagged with 8 themes — tap a tag to see how a slave, an emperor, and a senator each approached the same idea.

| Tag | Cards |
|---|---|
| Knowing Yourself | 494 |
| Freedom & Control | 407 |
| What Matters Most | 387 |
| Human Nature | 382 |
| Calm Your Mind | 357 |
| Doing The Right Thing | 266 |
| Facing Hardship | 221 |
| Death & Mortality | 167 |

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

Deploys are manual via the Vercel CLI:

```bash
vercel          # preview deploy
vercel --prod   # production deploy
```

## Content Pipeline

TypeScript CLI that turns plain-text source books into card JSON via the Anthropic Batch API. Source texts live in `content/source/`, pipeline cache in `content/pipeline/`, and finished card JSON is written to `content/output/`.

**Pipeline:** `parse → refine → translate → assemble`

1. **Parse** — Split source text into sections by Roman numeral markers
2. **Refine** — AI reviews each section: splits multi-idea sections into separate chunks, merges sections that can't stand alone
3. **Translate** — Plain English translation + tagging, with built-in meaning preservation verification
4. **Assemble** — Generate card IDs, reading time, source refs, write to `content/output/`

```bash
# Run full pipeline for one book (requires ANTHROPIC_API_KEY)
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book shortness-of-life

# Run individual phases against persisted intermediates
npx tsx scripts/generate.ts --book shortness-of-life --phase parse         # no AI calls
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book shortness-of-life --phase refine
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book shortness-of-life --phase translate
npx tsx scripts/generate.ts --book shortness-of-life --phase assemble      # no AI calls

# Verbose mode — stream pipeline log messages to stderr
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book shortness-of-life --verbose
```

Flags: `--book <slug>` (required), `--phase <parse|refine|translate|assemble>`, `--verbose`, `--output <dir>` (default: `content/output`), `--help`.

Each run writes a diagnostic log to `content/pipeline/<slug>/pipeline.log` with LLM decisions, validation errors, retries, and cache status. Use `--verbose` to also print these to stderr.

## Testing

```bash
npm test          # runs both pipeline and web unit tests
```

`npm test` runs two suites in sequence:

1. **Pipeline tests** (186 tests) — parser, chunker, refine, translator, cache, batch, validator, and assembler (`scripts/lib/__tests__/`)
2. **Web unit tests** (36 tests) — content utilities and tag logic (`web/tests/unit/`)

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
