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
 * Question, Objection and Still outright, and D02 deleted the read-through
 * itself (the channel is one Wall a day, drawn from the Wall pool, nothing
 * else) — this script now surveys the Wall pool ONLY.
 * `content/social/render-exclusions.json` itself still carries
 * `question`/`objection`/`read_through`/`still` sections from before this
 * change until a later regeneration (D04) drops them; this script no longer
 * writes those sections on a fresh run.
 *
 * This is a regenerable, one-off/periodic CLI, not part of the daily render
 * path — re-run it whenever `content/social/premises/wall.json` or
 * `content/output/` changes in a way that could shift the gate's verdict (a
 * corpus edit, a `wall-gate.ts` constant change, a re-scored pool), then
 * commit the regenerated file alongside whatever changed it.
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
 *     --out content/social/render-exclusions.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surveyWallPool, type WallPoolEntry } from '../src/remotion/wall-pool.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../src/remotion/duration-bounds.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/scripts` -> `social` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..');

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
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const wallPoolPath = resolvePath(args['wall-pool']!);
	const corpusDir = resolvePath(args['corpus-dir']!);
	const outPath = resolvePath(args.out!);

	const wallEntries = readPoolEntries<WallPoolEntry>(wallPoolPath, JSON.parse(await readFile(wallPoolPath, 'utf-8')));

	console.log(`Surveying ${wallEntries.length} Wall pool entries...`);

	const wall = surveyWall(wallEntries, corpusDir);

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
			wall: { submitted: wall.submitted, succeeded: wall.succeeded, dropped: wall.rejections.length }
		},
		wall: sortedEntries(wall.rejections)
	};

	await mkdir(path.dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
	console.log(`\nWrote ${outPath} (${payload.wall.length} Wall exclusions)`);
}

main().catch((e) => {
	console.error('write-exclusions failed:', e);
	process.exit(1);
});
