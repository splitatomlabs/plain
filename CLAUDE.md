# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a free web app that presents classic Stoic philosophy books as bite-sized cards in plain English. Users read full books card by card, track progress via localStorage, and share cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier). No database, no auth. All content is static JSON.

See `ARCHITECTURE.md` for data models, routes, and rendering strategy. See `BRANDING.md` for voice, visual identity, motion, and sound guidelines. See `CONTENT_STRATEGY.md` for book selection, card guidelines, and tag taxonomy.

## Testing

```bash
npm test          # runs both pipeline and web unit tests
```

`npm test` runs two suites in sequence:

1. **Pipeline tests** (84 tests) — parser, chunker, refine, validator, and assembler (`scripts/lib/__tests__/`)
2. **Web unit tests** (22 tests) — content utilities and tag logic (`web/tests/unit/`)

Playwright e2e tests are separate: `npm run test:e2e --prefix web` (requires a built app).

## Screenshots

Start the dev server, then use Playwright CLI to capture pages:

```bash
cd web && npm run dev &                # starts on port 5173 (or next available)
npx playwright screenshot --viewport-size="390,844" http://localhost:5173/enchiridion /tmp/screenshot.png
npx playwright screenshot --viewport-size="390,844" --full-page http://localhost:5173/enchiridion /tmp/screenshot-full.png
```

- Use `--viewport-size="390,844"` for mobile and `--viewport-size="1280,800"` for desktop.
- Use `--full-page` to capture below the fold.
- Read the resulting PNG with the Read tool to view it.

## Content Guidelines

### Plain Translation Readability
When translating or rewriting source texts into "plain" versions for card display, target **Flesch-Kincaid Grade Level 7-8** (Flesch Reading Ease ~65-75). This balances quick readability with enough sophistication to preserve the reflective tone of philosophical content.
