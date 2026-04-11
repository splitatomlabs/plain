# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a free web app that presents classic Stoic philosophy books as bite-sized cards in plain English. Users read full books card by card, track progress via localStorage, and share cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier). No database, no auth. All content is static JSON.

See `docs/ARCHITECTURE.md` for data models, routes, and rendering strategy. See `docs/BRANDING.md` for voice, visual identity, motion, and sound guidelines. See `docs/CONTENT_STRATEGY.md` for book selection, card guidelines, and tag taxonomy.

## Testing

```bash
npm test          # runs both pipeline and web unit tests
```

`npm test` runs two suites in sequence:

1. **Pipeline tests** (84 tests) — parser, chunker, refine, validator, and assembler (`scripts/lib/__tests__/`)
2. **Web unit tests** (22 tests) — content utilities and tag logic (`web/tests/unit/`)

Playwright e2e tests are separate: `npm run test:e2e --prefix web` (requires a built app).

## Local Development

```bash
npm run dev --prefix web              # starts dev server on port 5173
npm run dev --prefix web -- --host    # exposes it for mobile testing on the local network
```

## Deploy

Deploys are manual. Run `vercel` for a preview deploy or `vercel --prod` for production.

## Content Pipeline

TypeScript CLI that turns plain-text source books into card JSON. Requires `claude` CLI on PATH (or `PLAIN_USE_API=1` with `ANTHROPIC_API_KEY`).

**Pipeline:** `parse → refine → translate → assemble`

```bash
# Parse only (no AI calls)
npx tsx scripts/generate.ts --book enchiridion --parse-only

# Generate one book
PLAIN_USE_API=1 npx tsx scripts/generate.ts --book enchiridion

# Generate all books
PLAIN_USE_API=1 npx tsx scripts/generate.ts --all

# Generate all books in parallel
PLAIN_USE_API=1 npx tsx scripts/generate.ts --all --parallel

# Limit refine calls (good for testing)
PLAIN_USE_API=1 npx tsx scripts/generate.ts --book enchiridion --limit 2

# Force re-generate, ignoring cache
PLAIN_USE_API=1 npx tsx scripts/generate.ts --book enchiridion --fresh

# Use Batch API for translate step (50% cheaper, async)
PLAIN_USE_API=1 PLAIN_USE_BATCH=1 npx tsx scripts/generate.ts --all
```

Flags: `--book <slug>`, `--all`, `--parse-only`, `--limit <n>`, `--output <dir>` (default: `content/output`), `--parallel`, `--fresh`, `--help`.

Directory layout: source texts in `content/source/`, pipeline cache in `content/pipeline/`, fixtures in `content/fixtures/`, output card JSON in `content/output/`.

## Screenshots

Start the dev server, then use Playwright CLI to capture pages:

```bash
npm run dev --prefix web &             # starts on port 5173 (or next available)
npx playwright screenshot --viewport-size="390,844" http://localhost:5173/enchiridion /tmp/screenshot.png
npx playwright screenshot --viewport-size="390,844" --full-page http://localhost:5173/enchiridion /tmp/screenshot-full.png
```

- Use `--viewport-size="390,844"` for mobile and `--viewport-size="1280,800"` for desktop.
- Use `--full-page` to capture below the fold.
- Read the resulting PNG with the Read tool to view it.

## Content Guidelines

### Plain Translation Readability
When translating or rewriting source texts into "plain" versions for card display, target **Flesch-Kincaid Grade Level 7-8** (Flesch Reading Ease ~65-75). This balances quick readability with enough sophistication to preserve the reflective tone of philosophical content.
