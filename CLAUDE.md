# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Plain is a free web app that presents classic Stoic philosophy books as bite-sized cards in plain English. Users read full books card by card, track progress via localStorage, and share cards or completed books.

**Tech stack:** SvelteKit + Vercel (free tier). No database, no auth. All content is static JSON.

See `ARCHITECTURE.md` for data models, routes, and rendering strategy. See `CONTENT_STRATEGY.md` for book selection, card guidelines, and tag taxonomy.

## Content Guidelines

### Plain Translation Readability
When translating or rewriting source texts into "plain" versions for card display, target **Flesch-Kincaid Grade Level 7-8** (Flesch Reading Ease ~65-75). This balances quick readability with enough sophistication to preserve the reflective tone of philosophical content.
