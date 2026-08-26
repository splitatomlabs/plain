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
import { computeWallPlainLines } from '../cli-plan.js';

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
	/**
	 * Added social pilot 02a T05, for `chapter-text.ts`'s chapter-sourced wall
	 * block — every card in `content/output/` already carries these two
	 * fields (confirmed across the whole corpus), they just weren't typed
	 * explicitly before because nothing needed them typed (callers reached
	 * them, if at all, through the index signature as `unknown` — e.g.
	 * `exclusions.test.ts`'s `String(c.chapter_slug)`). Adding them here is
	 * additive and backward-compatible: every existing access pattern still
	 * type-checks.
	 */
	chapter_slug: string;
	card_number: number;
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

/**
 * Every card of `bookSlug`, from `content/output/<bookSlug>/`. F06: the
 * read-through survey (`social/scripts/write-exclusions.ts`) needs the
 * WHOLE book's cards (to build the read-through slice), not one card at a
 * time via `loadOutputCard` — reuses the same `loadBookIndex` cache so a
 * book already read for `loadOutputCard`/`resolveWallCardExcerpt` isn't
 * re-read from disk.
 */
export function loadBookCards(bookSlug: string, outputDir: string = DEFAULT_OUTPUT_DIR): OutputCard[] {
	return [...loadBookIndex(bookSlug, outputDir).values()];
}

/**
 * One rejected pool entry, with enough detail (F05) for
 * `social/scripts/write-exclusions.ts` to publish a per-card reason
 * and axis to `content/social/render-exclusions.json` — `rejectedIds` alone
 * (below) only says WHICH cards failed, not why.
 */
export interface WallPoolRejection {
	card_id: string;
	book_slug: string;
	/**
	 * Which `gateWallCard` axis rejected this card. `'landingLine'` (T02) is
	 * unreachable via THIS survey today — it never passes `plainEnglish`/
	 * `landingLine` to `gateWallCard` (a scored pool entry's landing line is
	 * already vetted upstream, T07) — included only so this type stays in
	 * sync with `WallGateResult['failure']`.
	 */
	axis: 'travel' | 'duration' | 'landingLine';
	/** Verbatim `WallGateResult.reason` from `gateWallCard`. */
	reason: string;
}

export interface WallPoolSurveyResult {
	passed: number;
	/** Cards the travel floor rejected (F16) — see `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`. */
	rejectedForTravel: number;
	/** Cards the `MAX_POST_DURATION_FRAMES` ceiling rejected — see F03. */
	rejectedForDuration: number;
	rejectedIds: string[];
	/** Every rejection, WITH its axis and reason (F05) — same cards as `rejectedIds`, in the same order. */
	rejections: WallPoolRejection[];
}

/**
 * Resolves a Wall pool entry's landing line the same way
 * `scripts/lib/schedule.ts`'s `contentFromEntry` does: prefer the scored
 * rubric's `chosen_landing_line` (T07) over the mechanical `landing_line`
 * when the entry carries one. Kept in one place so the survey's duration
 * check (below) picks the same line the real schedule would post, rather
 * than a second guess that could disagree with it.
 */
function resolveEntryLandingLine(entry: WallPoolEntry): string {
	const rubric = entry.rubric as { chosen_landing_line?: string } | undefined;
	const landingLine = rubric?.chosen_landing_line ?? entry.landing_line;
	if (typeof landingLine !== 'string') {
		throw new Error(`Wall pool entry "${entry.card_id}" has no usable landing_line to survey duration against.`);
	}
	return landingLine;
}

/**
 * Runs `gateWallCard` across every entry in `content/social/premises/wall.json`
 * (or any equivalent list of `{ card_id, book_slug }` entries), resolving
 * each excerpt (and, for the duration check, the rest of the plain passage)
 * from `content/output/`. This is how the schedule (T18) is meant to feed
 * only renderable cards to the renderer — a card the gate rejects here
 * should never reach `Wall.tsx` in the first place, though
 * `assertWallCardRenderable` remains the backstop if one slips through.
 *
 * `rejectedForTravel` and `rejectedForDuration` are reported separately
 * (F03) rather than as one combined `rejected` count, so a pipeline log can
 * tell "too small to read" apart from "too long to ship" at a glance.
 */
export function surveyWallPool(
	entries: WallPoolEntry[],
	outputDir: string = DEFAULT_OUTPUT_DIR
): WallPoolSurveyResult {
	let passed = 0;
	let rejectedForTravel = 0;
	let rejectedForDuration = 0;
	const rejectedIds: string[] = [];
	const rejections: WallPoolRejection[] = [];

	for (const entry of entries) {
		const card = loadOutputCard(entry.book_slug, entry.card_id, outputDir);
		const landingLine = resolveEntryLandingLine(entry);
		const plainLines = computeWallPlainLines(card.plain_english, landingLine);
		const result = gateWallCard(card.original_excerpt, { plainLines });
		if (result.ok) {
			passed++;
		} else {
			rejectedIds.push(entry.card_id);
			rejections.push({
				card_id: entry.card_id,
				book_slug: entry.book_slug,
				axis: result.failure,
				reason: result.reason
			});
			if (result.failure === 'duration') {
				rejectedForDuration++;
			} else {
				rejectedForTravel++;
			}
		}
	}

	return { passed, rejectedForTravel, rejectedForDuration, rejectedIds, rejections };
}
