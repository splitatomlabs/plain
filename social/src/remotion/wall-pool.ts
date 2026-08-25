/**
 * Runs the T06 Wall gate (`wall-gate.ts`) across the real card pool.
 *
 * Deliberately split out from `wall-gate.ts`: this module reads
 * `content/output/` off disk with Node's `fs`, which only works in a Node
 * process (the schedule/CLI, T18, and this module's tests). `wall-gate.ts`
 * stays pure so `Wall.tsx`/`Root.tsx` can import it directly without
 * dragging `node:fs` into Remotion's browser-side webpack bundle — see the
 * `UnhandledSchemeError` that motivated this split.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { gateWallCard } from './wall-gate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src/remotion` -> `social/src` -> `social` -> repo root. */
const DEFAULT_OUTPUT_DIR = path.resolve(moduleDir, '..', '..', '..', 'content', 'output');

export interface WallPoolEntry {
	card_id: string;
	book_slug: string;
	[key: string]: unknown;
}

/**
 * A card from `content/output/<book_slug>/*.json`. `plain_english` is
 * typed explicitly (not left to the index signature) because T18's render
 * CLI needs it directly — every other field the corpus carries is still
 * reachable via the index signature without this module needing to know
 * its shape.
 */
export interface OutputCard {
	id: string;
	book_slug: string;
	original_excerpt: string;
	plain_english: string;
	author_slug: string;
	[key: string]: unknown;
}

// Keyed by `${outputDir}::${bookSlug}`, so a book's chapter files are read
// from disk once no matter how many pool entries reference it.
const bookIndexCache = new Map<string, Map<string, OutputCard>>();

function loadBookIndex(bookSlug: string, outputDir: string): Map<string, OutputCard> {
	const cacheKey = `${outputDir}::${bookSlug}`;
	const cached = bookIndexCache.get(cacheKey);
	if (cached) {
		return cached;
	}

	const bookDir = path.join(outputDir, bookSlug);
	const index = new Map<string, OutputCard>();
	const files = readdirSync(bookDir).filter((f) => f.endsWith('.json') && f !== '_meta.json');
	for (const file of files) {
		const cards = JSON.parse(readFileSync(path.join(bookDir, file), 'utf-8')) as OutputCard[];
		for (const card of cards) {
			index.set(card.id, card);
		}
	}

	bookIndexCache.set(cacheKey, index);
	return index;
}

/**
 * Resolves a wall pool entry's verbatim `original_excerpt` from
 * `content/output/<book_slug>/`. Card ids don't map onto chapter filenames
 * (see `discourses-59-004`, which lives in `on-freedom-from-fear.json`), so
 * this searches every chapter file in the book's directory rather than
 * guessing a filename.
 */
export function resolveWallCardExcerpt(entry: WallPoolEntry, outputDir: string = DEFAULT_OUTPUT_DIR): string {
	const index = loadBookIndex(entry.book_slug, outputDir);
	const card = index.get(entry.card_id);
	if (!card) {
		throw new Error(`Wall pool entry "${entry.card_id}" not found under ${path.join(outputDir, entry.book_slug)}`);
	}
	return card.original_excerpt;
}

/**
 * Resolves a card's FULL record (not just `original_excerpt` — see
 * `resolveWallCardExcerpt`) from `content/output/<bookSlug>/`. T18's render
 * CLI is the primary caller: a `ScheduleSlot` only carries the on-screen
 * fields a given format needs (see `scripts/lib/schedule.ts`'s
 * `SlotContent`), never the rest of the card (e.g. The Question's
 * `originalExcerpt`, or The Wall's full `plain_english` for the lines
 * after the landing line) — those are resolved here, from the same
 * `content/output/` corpus the schedule itself was generated against.
 */
export function loadOutputCard(bookSlug: string, cardId: string, outputDir: string = DEFAULT_OUTPUT_DIR): OutputCard {
	const index = loadBookIndex(bookSlug, outputDir);
	const card = index.get(cardId);
	if (!card) {
		throw new Error(`Card "${cardId}" not found under ${path.join(outputDir, bookSlug)}`);
	}
	return card;
}

export interface WallPoolSurveyResult {
	passed: number;
	rejected: number;
	rejectedIds: string[];
}

/**
 * Runs `gateWallCard` across every entry in `content/social/premises/wall.json`
 * (or any equivalent list of `{ card_id, book_slug }` entries), resolving
 * each excerpt from `content/output/`. This is how the schedule (T18) is
 * meant to feed only renderable cards to the renderer — a card the gate
 * rejects here should never reach `Wall.tsx` in the first place, though
 * `assertWallCardRenderable` remains the backstop if one slips through.
 */
export function surveyWallPool(
	entries: WallPoolEntry[],
	outputDir: string = DEFAULT_OUTPUT_DIR
): WallPoolSurveyResult {
	let passed = 0;
	const rejectedIds: string[] = [];

	for (const entry of entries) {
		const excerpt = resolveWallCardExcerpt(entry, outputDir);
		const result = gateWallCard(excerpt);
		if (result.ok) {
			passed++;
		} else {
			rejectedIds.push(entry.card_id);
		}
	}

	return { passed, rejected: rejectedIds.length, rejectedIds };
}
