# Plain

A free web app that presents classic Stoic philosophy books as bite-sized cards translated into plain English. Users read full books card by card, track their progress, and share individual cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier)

No database. No auth. All content is static JSON. Progress tracking uses localStorage.

## The Three Voices

Books are organized around three Stoic figures — a slave, an emperor, and a senator — who practiced the same philosophy from radically different lives.

- **Epictetus** (The Slave) — *The Enchiridion*
- **Marcus Aurelius** (The Emperor) — *Meditations*
- **Seneca** (The Senator) — *Letters to Lucilius (Selected)*, *On the Shortness of Life*

## Documentation

- `ARCHITECTURE.md` — Data models, route structure, rendering strategy, and full project architecture
- `CONTENT_STRATEGY.md` — Book selection, card writing guidelines, tag taxonomy, and content pipeline
