/**
 * F05: publishes the renderer-derived Wall exclusion list.
 *
 * The scheduler (`scripts/lib/schedule.ts`, the ROOT pipeline) has no way to
 * know which Wall pool entries the renderer's own gate
 * (`social/src/remotion/wall-gate.ts`'s `gateWallCard`: the 39px legibility
 * floor and F03's 59s duration ceiling) will reject — `scripts/` and
 * `social/` are separate npm packages, and the root pipeline must never
 * import from `social/`. So this script runs the gate here, in `social/`,
 * where it already lives (`surveyWallPool`, `wall-pool.ts`), and writes the
 * verdict out as a plain JSON artifact the scheduler CAN read:
 * `content/social/wall-exclusions.json`.
 *
 * This is a regenerable, one-off/periodic CLI, not part of the daily render
 * path — re-run it whenever `content/social/premises/wall.json` or
 * `content/output/` changes in a way that could shift the gate's verdict
 * (a corpus edit, a `wall-gate.ts`/`wall-timing.ts` constant change, a
 * re-scored Wall pool), then commit the regenerated file alongside whatever
 * changed it.
 *
 * Deterministic by policy, same as every other tool in this pipeline
 * (`scripts/generate-schedule.ts`, `social/src/cli.ts`): `--date` is
 * required and becomes `meta.generated_at` verbatim (as
 * `<date>T00:00:00.000Z`) — never `Date.now()` — so re-running against an
 * unchanged pool and corpus with the same `--date` produces a byte-identical
 * file.
 *
 * Usage:
 *   npx tsx social/scripts/write-wall-exclusions.ts --date 2026-08-25
 *   npx tsx social/scripts/write-wall-exclusions.ts --date 2026-08-25 \
 *     --wall-pool content/social/premises/wall.json \
 *     --corpus-dir content/output \
 *     --out content/social/wall-exclusions.json
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { surveyWallPool, type WallPoolEntry } from '../src/remotion/wall-pool.js';
import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../src/remotion/duration-bounds.js';
import { WALL_MIN_LEGIBLE_FONT_PX } from '../src/remotion/wall-gate.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/scripts` -> `social` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..');

interface WallPoolFile {
	entries: WallPoolEntry[];
}

const { values: args } = parseArgs({
	options: {
		date: { type: 'string' },
		'wall-pool': { type: 'string', default: path.join('content', 'social', 'premises', 'wall.json') },
		'corpus-dir': { type: 'string', default: path.join('content', 'output') },
		out: { type: 'string', default: path.join('content', 'social', 'wall-exclusions.json') },
		help: { type: 'boolean', default: false }
	}
});

if (args.help) {
	console.log(`Usage: npx tsx social/scripts/write-wall-exclusions.ts --date <YYYY-MM-DD> [options]

Options:
  --date <YYYY-MM-DD>   Required. Recorded verbatim as meta.generated_at — never Date.now() (this pipeline
                         is deterministic by policy; see scripts/generate-schedule.ts).
  --wall-pool <path>    Scored Wall pool to survey (default: content/social/premises/wall.json)
  --corpus-dir <path>   Card corpus surveyWallPool resolves excerpts/plain_english against (default: content/output)
  --out <path>          Where to write the exclusion list (default: content/social/wall-exclusions.json)
  --help                Show this help

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

async function main(): Promise<void> {
	const wallPoolPath = resolvePath(args['wall-pool']!);
	const corpusDir = resolvePath(args['corpus-dir']!);
	const outPath = resolvePath(args.out!);

	const raw = JSON.parse(await readFile(wallPoolPath, 'utf-8')) as unknown;
	// The pool file is either the legacy bare array or the current
	// `{ meta, entries }` envelope (see the ROOT pipeline's `pool-file.ts` —
	// deliberately not imported here; see this file's own doc comment on why
	// `social/` never imports from `scripts/`). Recognize both shapes the
	// same way, without sharing code across that boundary.
	const entries: WallPoolEntry[] = Array.isArray(raw) ? (raw as WallPoolEntry[]) : (raw as WallPoolFile).entries;
	if (!Array.isArray(entries)) {
		console.error(`"${wallPoolPath}" is neither a bare array nor a { meta, entries } envelope — cannot survey it.`);
		process.exit(1);
		return;
	}

	console.log(`Surveying ${entries.length} Wall pool entries from ${wallPoolPath}...`);
	const result = surveyWallPool(entries, corpusDir);
	console.log(
		`  passed: ${result.passed}, rejected for legibility: ${result.rejectedForLegibility}, ` +
			`rejected for duration: ${result.rejectedForDuration}`
	);

	const generatedAt = `${args.date}T00:00:00.000Z`;
	const payload = {
		meta: {
			submitted: entries.length,
			succeeded: result.passed,
			dropped: result.rejections.length,
			limited: false,
			generated_at: generatedAt,
			max_post_duration_frames: MAX_POST_DURATION_FRAMES,
			max_post_duration_seconds: MAX_POST_DURATION_SECONDS,
			wall_min_legible_font_px: WALL_MIN_LEGIBLE_FONT_PX
		},
		entries: result.rejections
			.slice()
			.sort((a, b) => a.card_id.localeCompare(b.card_id))
			.map((r) => ({
				card_id: r.card_id,
				book_slug: r.book_slug,
				axis: r.axis,
				reason: r.reason
			}))
	};

	await mkdir(path.dirname(outPath), { recursive: true });
	await writeFile(outPath, JSON.stringify(payload, null, 2) + '\n', 'utf-8');
	console.log(`\nWrote ${outPath} (${payload.entries.length} exclusions)`);
}

main().catch((e) => {
	console.error('write-wall-exclusions failed:', e);
	process.exit(1);
});
