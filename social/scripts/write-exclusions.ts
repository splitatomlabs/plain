/**
 * F05/F06: publishes the renderer-derived exclusion list.
 *
 * The scheduler (`scripts/lib/schedule.ts`, the ROOT pipeline) has no way to
 * know which pool entries the renderer's own gate (`social/src/remotion/
 * wall-gate.ts`) will reject — `scripts/` and `social/` are separate npm
 * packages, and the root pipeline must never import from `social/`. So this
 * script runs the gate here, in `social/`, where it already lives, and
 * writes the verdict out as a plain JSON artifact the scheduler CAN read:
 * `content/social/render-exclusions.json`.
 *
 * Originally (F05/F06) surveyed Wall, Question and Objection pools plus a
 * `read_through` section, then (F19) added a `still` section for the
 * read-through's Still fallback. Pf39c2-social-pilot-02a D01 deleted
 * Question, Objection and Still outright (the channel is one Wall a day,
 * drawn from the Wall pool, nothing else) — this script now surveys Wall and
 * the read-through slice only. `content/social/render-exclusions.json`
 * itself still carries `question`/`objection`/`still` sections from before
 * this change until a later regeneration (D04) drops them; this script no
 * longer writes those sections on a fresh run.
 *
 * The read-through section survey uses the READ-THROUGH's OWN landing-line
 * derivation (`selectLandingLine(plainEnglish)` — see
 * `../src/remotion/landing-line.ts` — with NO `?? plainEnglish` fallback,
 * social pilot 02a T02/T04: a card with no qualifying landing line is not a
 * Wall at all, full stop), not a scored pool's `rubric.chosen_landing_line`:
 * the two can compute different frame totals for the same card (M2's own
 * finding), so surveying with the wrong derivation can give a wrong verdict
 * even for a card the Wall pool DID cover.
 *
 * This is a regenerable, one-off/periodic CLI, not part of the daily render
 * path — re-run it whenever `content/social/premises/wall.json` or
 * `content/output/` changes in a way that could shift the gate's verdict (a
 * corpus edit, a `wall-gate.ts` constant change, a re-scored pool, a
 * different read-through book/chapter slice), then commit the regenerated
 * file alongside whatever changed it.
 *
 * Deterministic by policy, same as every other tool in this pipeline
 * (`scripts/generate-schedule.ts`, `social/src/cli.ts`): `--date` is
 * required and becomes `meta.generated_at` verbatim (as
 * `<date>T00:00:00.000Z`) — never `Date.now()` — so re-running against an
 * unchanged pool and corpus with the same `--date` produces a byte-identical
 * file.
 *
 * Usage:
 *   npx tsx social/scripts/write-exclusions.ts --date 2026-08-25
 *   npx tsx social/scripts/write-exclusions.ts --date 2026-08-25 \
 *     --wall-pool content/social/premises/wall.json \
 *     --corpus-dir content/output \
 *     --read-through-book meditations \
 *     --read-through-chapters book-02,book-03 \
 *     --out content/social/render-exclusions.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	surveyWallPool,
	loadBookCards,
	type WallPoolEntry,
	type OutputCard
} from '../src/remotion/wall-pool.js';
import { computeWallPlainLines } from '../src/cli-plan.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../src/remotion/duration-bounds.js';
import { gateWallCard } from '../src/remotion/wall-gate.js';
import { selectLandingLine } from '../src/remotion/landing-line.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/scripts` -> `social` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..');

// Mirrors `scripts/lib/schedule.ts`'s own `DEFAULT_READ_THROUGH_BOOK` /
// `DEFAULT_READ_THROUGH_CHAPTERS` — duplicated, never imported, same
// reasoning as `../src/remotion/landing-line.ts`'s own top-of-file comment
// (`social/` is a self-contained npm project — see T01). Kept numerically
// identical by convention; both are overridable via CLI flags below so a
// future read-through can be surveyed without touching this file.
const DEFAULT_READ_THROUGH_BOOK = 'meditations';
const DEFAULT_READ_THROUGH_CHAPTERS = ['book-02', 'book-03'];

interface PoolFile<T> {
	entries: T[];
}

interface ExclusionEntry {
	card_id: string;
	book_slug: string;
	axis: string;
	reason: string;
}

const { values: args } = parseArgs({
	options: {
		date: { type: 'string' },
		'wall-pool': { type: 'string', default: path.join('content', 'social', 'premises', 'wall.json') },
		'corpus-dir': { type: 'string', default: path.join('content', 'output') },
		'read-through-book': { type: 'string', default: DEFAULT_READ_THROUGH_BOOK },
		'read-through-chapters': { type: 'string', default: DEFAULT_READ_THROUGH_CHAPTERS.join(',') },
		out: { type: 'string', default: path.join('content', 'social', 'render-exclusions.json') },
		help: { type: 'boolean', default: false }
	}
});

if (args.help) {
	console.log(`Usage: npx tsx social/scripts/write-exclusions.ts --date <YYYY-MM-DD> [options]

Options:
  --date <YYYY-MM-DD>          Required. Recorded verbatim as meta.generated_at — never Date.now() (this
                                pipeline is deterministic by policy; see scripts/generate-schedule.ts).
  --wall-pool <path>           Scored Wall pool to survey (default: content/social/premises/wall.json)
  --corpus-dir <path>          Card corpus excerpts/plain_english are resolved against (default: content/output)
  --read-through-book <slug>   Read-through book to survey (default: ${DEFAULT_READ_THROUGH_BOOK})
  --read-through-chapters <s>  Comma-separated chapter slugs restricting the read-through survey to a slice
                                (default: ${DEFAULT_READ_THROUGH_CHAPTERS.join(',')} — matches
                                scripts/lib/schedule.ts's own DEFAULT_READ_THROUGH_CHAPTERS). Pass an empty
                                string to survey the entire --read-through-book.
  --out <path>                 Where to write the exclusion list (default: content/social/render-exclusions.json)
  --help                       Show this help

Paths are resolved relative to the repo root when not already absolute.`);
	process.exit(0);
}

if (!args.date) {
	console.error('Specify --date <YYYY-MM-DD> (recorded as meta.generated_at — this pipeline never uses Date.now()).');
	process.exit(1);
}
if (!/^\d{4}-\d{2}-\d{2}$/.test(args.date)) {
	console.error(`Invalid --date "${args.date}" — expected YYYY-MM-DD.`);
	process.exit(1);
}

function resolvePath(p: string): string {
	return path.isAbsolute(p) ? p : path.join(REPO_ROOT, p);
}

/** Recognizes both on-disk pool shapes: a legacy bare array, or the current `{ meta, entries }` envelope. */
function readPoolEntries<T>(filePath: string, raw: unknown): T[] {
	const entries = Array.isArray(raw) ? (raw as T[]) : (raw as PoolFile<T>).entries;
	if (!Array.isArray(entries)) {
		throw new Error(`"${filePath}" is neither a bare array nor a { meta, entries } envelope — cannot survey it.`);
	}
	return entries;
}

// ---------------------------------------------------------------------------
// The Wall — unchanged from F05 (`surveyWallPool`).
// ---------------------------------------------------------------------------

function surveyWall(entries: WallPoolEntry[], corpusDir: string) {
	const result = surveyWallPool(entries, corpusDir);
	console.log(`  Wall: passed ${result.passed}, rejected for duration: ${result.rejectedForDuration}`);
	return { submitted: entries.length, succeeded: result.passed, rejections: result.rejections as ExclusionEntry[] };
}

// ---------------------------------------------------------------------------
// The read-through slice (F06/M2) — walks every card of
// `readThroughBook`/`readThroughChapters`, in the same chapter-then-
// card_number order `scripts/lib/schedule.ts`'s `buildReadThroughSequence`
// uses, and gates each one as Wall using the READ-THROUGH's OWN landing-line
// derivation.
// ---------------------------------------------------------------------------

function buildReadThroughSlice(cards: OutputCard[], chapters: string[]): OutputCard[] {
	if (chapters.length === 0) {
		return cards;
	}
	const byChapter = new Map<string, OutputCard[]>();
	for (const c of cards) {
		const chapterSlug = String(c.chapter_slug);
		if (!byChapter.has(chapterSlug)) byChapter.set(chapterSlug, []);
		byChapter.get(chapterSlug)!.push(c);
	}
	const sequence: OutputCard[] = [];
	for (const chapterSlug of chapters) {
		const group = byChapter.get(chapterSlug);
		if (!group || group.length === 0) {
			throw new Error(
				`Unknown chapter "${chapterSlug}" for read-through book — available chapters: ${[...byChapter.keys()].join(', ')}`
			);
		}
		sequence.push(...[...group].sort((a, b) => Number(a.card_number) - Number(b.card_number)));
	}
	return sequence;
}

/** Resolves the read-through's own sequential card slice. */
function resolveReadThroughSlice(bookSlug: string, chapters: string[], corpusDir: string): OutputCard[] {
	const bookCards = loadBookCards(bookSlug, corpusDir);
	if (bookCards.length === 0) {
		throw new Error(`No cards found for read-through book "${bookSlug}" under ${corpusDir}`);
	}
	const slice = buildReadThroughSlice(bookCards, chapters);
	if (slice.length === 0) {
		throw new Error(`Read-through slice for book "${bookSlug}" with chapters [${chapters.join(', ')}] is empty.`);
	}
	return slice;
}

function surveyReadThrough(slice: OutputCard[], bookSlug: string, chapters: string[]) {
	const rejections: ExclusionEntry[] = [];
	let succeeded = 0;
	for (const card of slice) {
		const plainEnglish = String(card.plain_english);
		// social pilot 02a T04: no more `?? plainEnglish` fallback — matches
		// `scripts/lib/schedule.ts`'s post-T02 `tryReadThroughContent`, which
		// returns `null` (not a Wall at all) the instant `selectLandingLine`
		// finds nothing, before ever consulting the travel/duration gate. A
		// card with no qualifying landing line is excluded here on that basis
		// alone, without regard to whether its excerpt would otherwise clear
		// `gateWallCard`'s travel or duration floors — the real scheduler
		// never gets that far for this card either.
		const landingLine = selectLandingLine(plainEnglish);
		if (landingLine === null) {
			rejections.push({
				card_id: card.id,
				book_slug: card.book_slug,
				axis: 'landingLine',
				reason:
					'Read-through card rejected: plain_english has no qualifying landing line — selectLandingLine ' +
					'(landing-line.ts) found no self-contained sentence within the mechanical bounds, so this card ' +
					'cannot pay off as a Wall (matches scripts/lib/schedule.ts\'s tryReadThroughContent, which ' +
					'returns null here rather than falling back to the whole passage).'
			});
			continue;
		}
		const plainLines = computeWallPlainLines(plainEnglish, landingLine);
		const result = gateWallCard(card.original_excerpt, { plainEnglish, landingLine, plainLines });
		if (result.ok) {
			succeeded++;
		} else {
			rejections.push({ card_id: card.id, book_slug: card.book_slug, axis: result.failure, reason: result.reason });
		}
	}
	console.log(`  Read-through (${bookSlug}${chapters.length ? `, ${chapters.join('+')}` : ', full book'}): passed ${succeeded}, rejected ${rejections.length}`);
	return { submitted: slice.length, succeeded, rejections };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const wallPoolPath = resolvePath(args['wall-pool']!);
	const corpusDir = resolvePath(args['corpus-dir']!);
	const outPath = resolvePath(args.out!);
	const readThroughBook = args['read-through-book']!;
	const readThroughChapters = args['read-through-chapters']!
		.split(',')
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	const wallEntries = readPoolEntries<WallPoolEntry>(wallPoolPath, JSON.parse(await readFile(wallPoolPath, 'utf-8')));

	console.log(`Surveying ${wallEntries.length} Wall pool entries, plus the ${readThroughBook} read-through slice...`);

	const wall = surveyWall(wallEntries, corpusDir);
	const readThroughSlice = resolveReadThroughSlice(readThroughBook, readThroughChapters, corpusDir);
	const readThrough = surveyReadThrough(readThroughSlice, readThroughBook, readThroughChapters);

	const generatedAt = `${args.date}T00:00:00.000Z`;

	function sortedEntries(rejections: ExclusionEntry[]) {
		return rejections
			.slice()
			.sort((a, b) => a.card_id.localeCompare(b.card_id))
			.map((r) => ({ card_id: r.card_id, book_slug: r.book_slug, axis: r.axis, reason: r.reason }));
	}

	const payload = {
		meta: {
			generated_at: generatedAt,
			max_post_duration_frames: MAX_POST_DURATION_FRAMES,
			max_post_duration_seconds: MAX_POST_DURATION_SECONDS,
			read_through_book: readThroughBook,
			read_through_chapters: readThroughChapters,
			wall: { submitted: wall.submitted, succeeded: wall.succeeded, dropped: wall.rejections.length },
			read_through: {
				submitted: readThrough.submitted,
				succeeded: readThrough.succeeded,
				dropped: readThrough.rejections.length
			}
		},
		wall: sortedEntries(wall.rejections),
		read_through: sortedEntries(readThrough.rejections)
	};

	await mkdir(path.dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
	console.log(`\nWrote ${outPath} (${payload.wall.length} Wall, ${payload.read_through.length} read-through exclusions)`);
}

main().catch((e) => {
	console.error('write-exclusions failed:', e);
	process.exit(1);
});
