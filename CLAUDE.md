# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a free web app that presents classic Stoic philosophy books as bite-sized cards in plain English. Users read full books card by card, track progress via localStorage, and share cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier). No database, no auth. All content is static JSON.

See `docs/ARCHITECTURE.md` for data models, routes, and rendering strategy. See `docs/BRANDING.md` for voice, visual identity, motion, and sound guidelines. See `docs/CONTENT_STRATEGY.md` for book selection, card guidelines, and tag taxonomy.

## Testing

```bash
npm test          # runs the pipeline, web unit, and social suites
```

`npm test` runs three suites in sequence:

1. **Pipeline tests** (186 tests) — parser, chunker, refine, translator, cache, batch, validator, and assembler (`scripts/lib/__tests__/`)
2. **Web unit tests** (36 tests) — content utilities and tag logic (`web/tests/unit/`)
3. **Social tests** (~440 tests, ~25s) — the `social/` workspace: Remotion compositions and gates for The Wall/Question/Objection, the encoder, TTS providers and narration timing, audio mixing, and CLI end-to-end renders (`social/src/**/__tests__/`). Slower than the other two suites because it does real Remotion renders and ffmpeg/ffprobe work, not because it calls any live API — TTS and image-gen calls are always fixture-replayed, never live.

Playwright e2e tests are separate: `npm run test:e2e --prefix web` (requires a built app).

**Important:** After significant changes to the web app (components, routes, navigation, progress tracking, layout), always run the e2e suite to catch regressions. Build the app first with `npm run build --prefix web`, then run `npm run test:e2e --prefix web`.

**E2e test updates:** When UI changes affect component structure or selectors, existing e2e tests (`web/tests/e2e/`) will need updating. Common issues: selectors matching new DOM elements (e.g., adding a second card requires scoping selectors to `.card-swipe-current`), `<details>` elements replaced by buttons. When creating implementation plans, include tasks for updating affected e2e tests.

## Local Development

```bash
npm run dev --prefix web              # starts dev server on port 5173
npm run dev --prefix web -- --host    # exposes it for mobile testing on the local network
```

## Deploy

Deploys are manual. Run `vercel` for a preview deploy or `vercel --prod` for production.

## Content Pipeline

TypeScript CLI that turns plain-text source books into card JSON. Uses the Anthropic Batch API (requires `ANTHROPIC_API_KEY`).

**Pipeline:** `parse → refine → translate → assemble`

```bash
# Run full pipeline for one book
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book enchiridion

# Run a single phase against persisted intermediates
npx tsx scripts/generate.ts --book enchiridion --phase parse
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book enchiridion --phase refine
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book enchiridion --phase translate
npx tsx scripts/generate.ts --book enchiridion --phase assemble

# Verbose mode — prints all log messages to stderr
ANTHROPIC_API_KEY=... npx tsx scripts/generate.ts --book enchiridion --verbose
```

Flags: `--book <slug>` (required), `--phase <parse|refine|translate|assemble>`, `--verbose`, `--output <dir>` (default: `content/output`), `--help`.

Directory layout: source texts in `content/source/`, pipeline cache in `content/pipeline/` (parse.json, refine.json, translate.json per book), fixtures in `content/fixtures/`, output card JSON in `content/output/`.

**Pipeline logs:** Every run writes a human-readable log to `content/pipeline/<slug>/pipeline.log`. This captures LLM decisions (split/keep/merge), validation errors, retries, cache hits/misses, and batch API progress. When troubleshooting, read this file first. Use `--verbose` to also stream these messages to stderr in real time.

**Batch debugging:** Anthropic Batch API results remain accessible after a batch completes. Batch IDs are logged to both `pipeline.log` and stderr (e.g., `Created batch msgbatch_...`). To re-read results from a past run, use the SDK's `client.messages.batches.results(batchId)` — no need to resubmit the batch.

**Cache invalidation:** Bump `PIPELINE_VERSION` in `scripts/lib/cache.ts` when pipeline logic changes — this auto-invalidates all cached intermediates.

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
