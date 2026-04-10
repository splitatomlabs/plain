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

## Documentation

- `ARCHITECTURE.md` — Data models, route structure, rendering strategy, and full project architecture
- `BRANDING.md` — Brand guide covering voice, visual identity, motion, sound, and brand rules
- `CONTENT_STRATEGY.md` — Book selection, card writing guidelines, tag taxonomy, and content pipeline
