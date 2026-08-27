#!/usr/bin/env node
/**
 * The render CLI (T18): `social/src/cli.ts render --date <YYYY-MM-DD>`.
 *
 * Maps `--date` onto a committed weekly schedule (`content/social/
 * pilot-schedule-w<NN>.json`, see `pilot-config.ts`), resolves the card and
 * every field that schedule doesn't itself carry from `content/output/`,
 * renders that day's composition with Remotion, encodes it to the house MP4
 * profile (`render/encode.ts`), renders the Instagram feed still, and writes
 * a metadata sidecar (`render/post-metadata.ts`).
 *
 * Pf39c2-social-pilot-02a D02: `--slot` is gone — the read-through and the
 * two-slot day are both gone, so each day has exactly one Wall slot and
 * `--date` alone identifies it (see `cli-plan.ts`'s `resolveDay`).
 *
 * Deterministic by policy, same as every other tool in this pipeline
 * (`scripts/generate-schedule.ts`, `scripts/review-week.ts`): the date
 * always comes from `--date`, never `Date.now()`; the music bed is seeded
 * from `--date` alone (`cli-plan.ts`'s `postIndexForDay`), so re-running the
 * same `--date` always makes the same choice.
 *
 * NARRATION IS BLOCKED (T14 — `audio/voices.ts`'s `VOICES_ARE_UNSET`):
 * there are no auditioned voice ids yet, so every render here is
 * MUSIC-ONLY. This is not silently swallowed — a prominent warning naming
 * T14 is printed, and the metadata sidecar records `narration: false` so
 * plan 03's publish step can refuse to post a non-narrated asset.
 * `--require-narration` turns that warning into a hard failure instead,
 * for a caller that wants to assert narration is actually available.
 */

import { parseArgs } from 'node:util';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

import { dateToWeekDay } from './pilot-config.js';
import {
	scheduleFileName,
	resolveDay,
	postIndexForDay,
	chooseBed,
	computeWallPlainLines,
	renderAssetPaths
} from './cli-plan.js';
import type { WeekSchedule } from './schedule-types.js';
import { loadOutputCard } from './remotion/wall-pool.js';
import { loadChapterTextBlock, applyChapterEntryOffset } from './render/chapter-text.js';
import { computeWallTiming, WALL_FRAMES, FPS } from './remotion/wall-timing.js';
import { formatRunningHead } from './remotion/SourceHead.js';
import { bedPath } from './audio/beds.js';
import { mix, type TimeSpan } from './audio/mix.js';
import type { NarrationLineTiming } from './audio/timing.js';
import { VOICES_ARE_UNSET } from './audio/voices.js';
import { buildTtsProvider, synthesizeNarration, prependSilence } from './narration.js';
import { encode, probe, assertMeetsProfile } from './render/encode.js';
import { renderCard, closeRenderer } from './render/card.js';
import type { AuthorSlug } from './render/theme.js';
import { writePostMetadata, postMetadataPathFor, type PostMetadata, type PostFormat } from './render/post-metadata.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
/** `social/src` -> repo root. */
const REPO_ROOT = path.resolve(moduleDir, '..', '..');
const SCHEDULE_DIR = path.join(REPO_ROOT, 'content', 'social');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'social', 'out');
const ENTRY_POINT = path.join(moduleDir, 'remotion', 'entry.tsx');

const T14_NARRATION_WARNING =
	'\n' +
	'*'.repeat(70) +
	'\n' +
	'*  NARRATION IS BLOCKED (T14, plans/Pf39c2-social-pilot-02.md).\n' +
	'*  No voice has been auditioned yet (audio/voices.ts VOICE_REGISTRY is\n' +
	'*  unset) — this render is MUSIC-ONLY, with no spoken narration at all.\n' +
	'*  Its metadata sidecar records narration: false. Do not publish it as\n' +
	"*  a finished post until T14 lands and a real narrated render replaces\n" +
	'*  it.\n' +
	'*'.repeat(70) +
	'\n';

// ---------------------------------------------------------------------------
// CLI arguments
// ---------------------------------------------------------------------------

function printHelp(): void {
	console.log(`Usage: npx tsx social/src/cli.ts render --date <YYYY-MM-DD> [options]

Renders one day's video + Instagram feed still + metadata sidecar, from a
committed weekly schedule (content/social/pilot-schedule-w<NN>.json — see
scripts/generate-schedule.ts). Every day is a single Wall post
(Pf39c2-social-pilot-02a D02) — --date alone identifies it.

Options:
  --date <YYYY-MM-DD>    The post's calendar date (required). Mapped onto a
                          schedule week/day via pilot-config.ts's
                          PILOT_WEEK_1_START anchor.
  --out <dir>              Output directory (default: social/out/).
  --schedule-dir <dir>     Directory to read pilot-schedule-w<NN>.json from
                          (default: content/social/). Testing/override
                          affordance only — real renders should never need
                          this; it lets tests and one-off tooling point at a
                          fixture schedule without touching the committed
                          pipeline state in content/social/.
  --dry-run                Print the resolved render plan; write nothing.
  --require-narration      Fail instead of warning when no narration is
                          available (T14 is not done yet, so this always
                          fails today — see the module doc comment).
  --help                   Show this help.`);
}

interface RenderArgs {
	date: string;
	outDir: string;
	scheduleDir: string;
	dryRun: boolean;
	requireNarration: boolean;
}

function parseRenderArgs(argv: string[]): RenderArgs {
	const { values } = parseArgs({
		args: argv,
		options: {
			date: { type: 'string' },
			out: { type: 'string', default: DEFAULT_OUT_DIR },
			'schedule-dir': { type: 'string', default: SCHEDULE_DIR },
			'dry-run': { type: 'boolean', default: false },
			'require-narration': { type: 'boolean', default: false },
			help: { type: 'boolean', default: false }
		},
		allowPositionals: true
	});

	if (values.help) {
		printHelp();
		process.exit(0);
	}

	if (!values.date) {
		throw new Error('Specify --date <YYYY-MM-DD>');
	}

	return {
		date: values.date,
		outDir: values.out ?? DEFAULT_OUT_DIR,
		scheduleDir: values['schedule-dir'] ?? SCHEDULE_DIR,
		dryRun: Boolean(values['dry-run']),
		requireNarration: Boolean(values['require-narration'])
	};
}

// ---------------------------------------------------------------------------
// Loading the schedule
// ---------------------------------------------------------------------------

async function loadWeekSchedule(week: number, scheduleDir: string): Promise<WeekSchedule> {
	const filePath = path.join(scheduleDir, scheduleFileName(week));
	if (!existsSync(filePath)) {
		throw new Error(
			`No schedule found for week ${week}: ${filePath}\n` +
				`Generate it first: npx tsx scripts/generate-schedule.ts --week ${week} --seed <n>` +
				(week === 1 ? ' --first-week' : '')
		);
	}
	return JSON.parse(await readFile(filePath, 'utf-8')) as WeekSchedule;
}

// ---------------------------------------------------------------------------
// The render plan — resolved BEFORE anything is rendered, so --dry-run can
// print it and a real render can log exactly what it decided.
// ---------------------------------------------------------------------------

// Exported (social pilot 02a T14): so `audio/__tests__/narration.test.ts`
// can construct real-shaped `FormatPlan` fixtures and call the exported
// `wallSilentSpans`/`narrationPlan` below directly, without going through a
// live render. Visibility only — no field or behavior here changes for T14;
// see this file's entry-point guard (bottom of file) for how importing this
// module is made safe for a test file to do at all.
export interface WallPlan {
	format: 'wall';
	originalExcerpt: string;
	/**
	 * The moving wall phase's real scrolling text (social pilot 02a T09) —
	 * this card's own excerpt plus the surrounding chapter, in document
	 * order, one full lap starting at this card. See `Wall.tsx`'s
	 * `WallProps.chapterBlock` doc comment and `render/chapter-text.ts`'s
	 * `loadChapterTextBlock`.
	 *
	 * social pilot 02a T18: mid-chapter entry has already been applied by
	 * the time this field is set — `render/chapter-text.ts`'s
	 * `applyChapterEntryOffset`, keyed off this render's own `postIndex`, has
	 * shifted the block's start point to a different word of the card's own
	 * excerpt (never past it) so consecutive posts of the same card don't
	 * open on the same beat. See that function's own doc comment for the
	 * design decision.
	 */
	chapterBlock: string;
	/**
	 * The card's own `source_reference` (social pilot 02a T11/T12's framing
	 * layer) — threaded into `Wall.tsx`'s `sourceReference` prop, which
	 * derives the running head via `SourceHead.tsx`'s `formatRunningHead`
	 * alongside `author`. Same "real card metadata, never hardcoded" pattern
	 * `chapterBlock` set for T09.
	 */
	sourceReference: string;
	landingLine: string;
	plainLines: string[];
}

export type FormatPlan = WallPlan;

interface RenderPlan {
	date: string;
	week: number;
	day: number;
	cardId: string;
	bookSlug: string;
	authorSlug: string;
	compositionId: 'Wall';
	formatPlan: FormatPlan;
	postIndex: number;
	bedId: string;
}

async function buildRenderPlan(args: RenderArgs): Promise<RenderPlan> {
	const { week, day } = dateToWeekDay(args.date);
	const schedule = await loadWeekSchedule(week, args.scheduleDir);
	const slot = resolveDay(schedule, day);
	const card = loadOutputCard(slot.book_slug, slot.card_id);

	const postIndex = postIndexForDay(args.date);
	const bed = chooseBed(postIndex);

	const plainLines = computeWallPlainLines(card.plain_english, slot.content.landing_line);
	// social pilot 02a T18: mid-chapter entry, deterministic from this
	// render's own postIndex — see `applyChapterEntryOffset`'s doc comment
	// (`render/chapter-text.ts`) for the design.
	const chapterBlock = applyChapterEntryOffset(loadChapterTextBlock(slot.book_slug, slot.card_id), postIndex);
	const formatPlan: FormatPlan = {
		format: 'wall',
		originalExcerpt: slot.content.original_excerpt,
		chapterBlock,
		sourceReference: card.source_reference,
		landingLine: slot.content.landing_line,
		plainLines
	};
	const compositionId: RenderPlan['compositionId'] = 'Wall';

	return {
		date: args.date,
		week,
		day,
		cardId: slot.card_id,
		bookSlug: slot.book_slug,
		authorSlug: slot.author_slug,
		compositionId,
		formatPlan,
		postIndex,
		bedId: bed.id
	};
}

function printPlan(plan: RenderPlan): void {
	console.log(`Render plan for ${plan.date} (week ${plan.week} day ${plan.day}):`);
	console.log(`  composition: ${plan.compositionId}`);
	console.log(`  card: ${plan.cardId} (${plan.bookSlug}, ${plan.authorSlug})`);
	console.log(`  post index: ${plan.postIndex}`);
	console.log(`  bed: ${plan.bedId}`);
	console.log(`  plain lines after landing line: ${plan.formatPlan.plainLines.length}`);
	console.log(
		`  chapter block: ${plan.formatPlan.chapterBlock.split(/\s+/).filter(Boolean).length} words ` +
			`(card's own excerpt: ${plan.formatPlan.originalExcerpt.split(/\s+/).filter(Boolean).length} words)`
	);
	console.log(
		`  running head: "${formatRunningHead({ author_slug: plan.authorSlug as AuthorSlug, source_reference: plan.formatPlan.sourceReference })}"`
	);
	console.log('  narration: false (T14 not done — music-only)');
}

// ---------------------------------------------------------------------------
// Composition inputProps + duration
// ---------------------------------------------------------------------------

function buildInputProps(plan: RenderPlan, narrationTimings?: NarrationLineTiming[]): Record<string, unknown> {
	const base = { author: plan.authorSlug };
	return {
		...base,
		originalExcerpt: plan.formatPlan.originalExcerpt,
		chapterBlock: plan.formatPlan.chapterBlock,
		sourceReference: plan.formatPlan.sourceReference,
		landingLine: plan.formatPlan.landingLine,
		plainLines: plan.formatPlan.plainLines,
		// social pilot 02a T16 (F04): the Wall's timing adapts to real
		// per-line narration duration when supplied (`computeWallTiming`'s
		// own `narrationTimings` input) — see `narrationPlan`'s doc comment
		// for how `lines` maps onto this array.
		...(narrationTimings ? { narrationTimings } : {})
	};
}

/**
 * social pilot 02a U04 ("noisy scroll bed, then silence, then a slow
 * return"): the true-silence phase is now just this — half a second, not the
 * whole 3s landing-line hold. See `wallSilentSpans`'s own doc comment for
 * why, and `audio/mix.ts`'s module doc comment for the shape this and
 * `wallNoiseSpans` together produce.
 */
const WALL_DROP_SILENCE_MS = 500;

/**
 * The Wall's dense, unreadable NOISE phase — the entire moving-wall SCROLL,
 * `[0, WALL_FRAMES)` — where `audio/mix.ts`'s procedurally-generated noise
 * track plays INSTEAD of the music bed (the bed is held at its floor for
 * this whole span; see `MixInput.noiseSpans`'s own doc comment). Starts at 0,
 * not at some earlier "wind-up": the noise appears the instant the scroll
 * starts, exactly as abruptly as the visual density itself does.
 *
 * social pilot 02a U04 (replacing T15's "the bed plays at nominal level under
 * the scroll" — see `wallSilentSpans`'s doc comment for that history): the
 * user's own request was to replace the SOOTHING bed under the scroll with
 * noise matching the visual's density, not to keep the bed audible there.
 */
export function wallNoiseSpans(): TimeSpan[] {
	const wallEndMs = (WALL_FRAMES / FPS) * 1000;
	return [{ startMs: 0, endMs: wallEndMs }];
}

/**
 * The Wall's one true-silence phase — social pilot 02a U04 narrowed this
 * from the whole 3s landing-line hold down to exactly `WALL_DROP_SILENCE_MS`
 * (0.5s), right after the cut. See the module doc comment.
 *
 * HISTORY: social pilot 02a T15 ("THE CUT MUST BE AUDIBLE") first shrank this
 * from `0 -> WALL_FRAMES + LANDING_LINE_FRAMES` (silencing the bed under the
 * moving-wall scroll too) down to the landing line alone, with the bed
 * audible at nominal level under the scroll and hard-stopping on the cut
 * frame. U04 (this task) went further, per the user's own request ("a very
 * noisy background sound for the scrolling text, then cut to silence for 0.5
 * seconds then fade in the current background sound"): the scroll no longer
 * carries the bed at all — see `wallNoiseSpans` — so the bed's own floor
 * window now spans the noise phase too (`audio/mix.ts`'s `mix()` unions
 * `silentSpans` with `noiseSpans` for the bed specifically), but the OUTPUT
 * itself (bed AND the noise track AND narration) is only genuinely silent
 * for this narrower `WALL_DROP_SILENCE_MS` window — the noise track fills
 * the rest of the old landing-line-hold's front end, and the bed's own slow
 * `BED_RETURN_FADE_MS` fade-in fills the back end (`bedEnvelope`'s doc
 * comment), landing back at nominal exactly when the landing line ends.
 *
 * Still starts at `WALL_FRAMES` (the cut frame, see `wall-timing.ts`'s
 * `computeWallTiming` — `landingLine.startFrame` is always `wall.endFrame`,
 * i.e. `WALL_FRAMES`) — the hard cut from noise into true silence is the
 * exact same frame T15 hard-cut the bed on, unchanged.
 *
 * Deliberately does NOT extend to `WALL_FRAMES + LANDING_LINE_FRAMES` the way
 * it used to: that fixed boundary existed so a 0-plain-line Wall card's
 * duration-floor padding never went silent (see F02,
 * `plans/Pf39c2-social-pilot-02.md`) — this window is now short enough
 * (0.5s, always well inside the landing line's fixed 3s hold, never reaching
 * into any padding) that this concern no longer applies to it at all.
 */
export function wallSilentSpans(): TimeSpan[] {
	const wallEndMs = (WALL_FRAMES / FPS) * 1000;
	return [{ startMs: wallEndMs, endMs: wallEndMs + WALL_DROP_SILENCE_MS }];
}

// ---------------------------------------------------------------------------
// Real narration (T18 item 4) — see narration.ts's module doc comment.
// Unreachable while VOICES_ARE_UNSET (T14), but wired now so flipping that
// one flag is the only remaining step.
// ---------------------------------------------------------------------------

/**
 * The lines this slot's format actually narrates, and how far into the
 * composition (in ms, at `FPS`) that narration begins — i.e. where the
 * silent/moving phases end and the first narrated payoff line starts.
 *
 * The Wall narrates only the rest of the plain passage (never the landing
 * line, which is held in silence — see `wallSilentSpans`), starting right
 * after `WALL_FRAMES + LANDING_LINE_FRAMES`.
 *
 * social pilot 02a T16 (F04): the Wall's own timing module accepts a
 * `narrationTimings` input (`computeWallTiming` — see its own doc comment),
 * so once T14 lands and `renderCommand` below calls `synthesizeNarration`,
 * the returned per-line timings are threaded into `buildInputProps` and the
 * on-screen line boundaries move with the real narration instead of holding
 * a fixed duration regardless of how long the audio actually runs.
 *
 * Pf39c2-social-pilot-02a D01: this used to switch on
 * `formatPlan.format` across Wall/Question/Objection/Still; those three
 * were deleted outright (see `buildRenderPlan`'s doc comment), so
 * `FormatPlan` is Wall-only now and there is nothing left to switch on.
 */
export function narrationPlan(formatPlan: FormatPlan): { lines: string[]; offsetMs: number } {
	const timing = computeWallTiming({ originalExcerpt: formatPlan.originalExcerpt, plainLines: formatPlan.plainLines });
	return { lines: formatPlan.plainLines, offsetMs: (timing.landingLine.endFrame / FPS) * 1000 };
}

/** The still text shown on the Instagram feed card — the Wall's own landing line. */
function feedStillText(formatPlan: FormatPlan): string {
	return formatPlan.landingLine;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function renderCommand(args: RenderArgs): Promise<void> {
	const plan = await buildRenderPlan(args);

	if (args.dryRun) {
		printPlan(plan);
		console.log('\nDry run — no files written.');
		return;
	}

	if (VOICES_ARE_UNSET) {
		if (args.requireNarration) {
			throw new Error(
				'--require-narration was set, but T14 (plans/Pf39c2-social-pilot-02.md) is not done — no voice ' +
					'has been auditioned yet (audio/voices.ts VOICE_REGISTRY is unset). Refusing to render.'
			);
		}
		console.warn(T14_NARRATION_WARNING);
	}

	await mkdir(args.outDir, { recursive: true });
	const assetPaths = renderAssetPaths(args.outDir, plan.compositionId.toLowerCase(), plan.date);

	const workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-cli-'));
	try {
		// See narration.ts's module doc comment: unreachable today
		// (VOICES_ARE_UNSET), but a real narration track — not just
		// music — is produced the moment T14 populates the voice registry,
		// with no further change to this file.
		let narrationTimings: NarrationLineTiming[] | undefined;
		let narrationAudioPath: string | undefined;
		let narrationSpans: TimeSpan[] = [];
		if (!VOICES_ARE_UNSET) {
			const { lines, offsetMs } = narrationPlan(plan.formatPlan);
			console.log(`Synthesizing narration (${lines.length} line(s))...`);
			const provider = buildTtsProvider(process.env);
			const rawNarrationPath = path.join(workDir, 'narration-raw.mp3');
			const narration = await synthesizeNarration(lines, plan.authorSlug as AuthorSlug, provider, process.env, rawNarrationPath);
			narrationTimings = narration.timings;
			narrationAudioPath = path.join(workDir, 'narration-aligned.mp3');
			await prependSilence(rawNarrationPath, offsetMs, narrationAudioPath);
			// `narration.audioDurationMs` is probed off the WRITTEN FILE
			// (`narration.ts`), not `narration.tts.durationMs` — see that
			// module's doc comment for why the latter under-reports (and
			// on Polly, always under-reports by the final word).
			narrationSpans = [{ startMs: offsetMs, endMs: offsetMs + narration.audioDurationMs }];
		}

		const inputProps = buildInputProps(plan, narrationTimings);

		console.log('Bundling Remotion composition...');
		// `bundle()` defaults to a fresh `os.tmpdir()/remotion-webpack-bundle-*`
		// directory that it never cleans up. Bundle into a subdirectory of the
		// workDir this function already owns and removes in `finally` below,
		// so nothing is left behind in the system temp dir.
		const bundleDir = path.join(workDir, 'bundle');
		const bundleLocation = await bundle({
			entryPoint: ENTRY_POINT,
			outDir: bundleDir,
			// Source imports use explicit `.js` extensions (NodeNext module
			// resolution), which point at the `.ts`/`.tsx` files webpack
			// actually needs to bundle — map that alias so webpack resolves
			// them. Mirrors every `*.test.ts` in `remotion/__tests__/`.
			webpackOverride: (config) => ({
				...config,
				resolve: {
					...config.resolve,
					extensionAlias: { '.js': ['.js', '.ts', '.tsx'] }
				}
			})
		});

		const composition = await selectComposition({
			serveUrl: bundleLocation,
			id: plan.compositionId,
			inputProps
		});

		const totalFrames = composition.durationInFrames;
		const durationMs = (totalFrames / FPS) * 1000;

		console.log(`Rendering ${plan.compositionId} (${totalFrames} frames, ${(durationMs / 1000).toFixed(1)}s)...`);
		const silentVideoPath = path.join(workDir, 'silent.mp4');
		await renderMedia({
			composition,
			serveUrl: bundleLocation,
			codec: 'h264',
			outputLocation: silentVideoPath,
			inputProps,
			muted: true,
			overwrite: true
		});

		console.log(`Mixing audio (bed: ${plan.bedId})...`);
		const mixedAudioPath = path.join(workDir, 'mixed.m4a');
		// Pf39c2-social-pilot-02a D01: every plan is a Wall now (Question/
		// Objection/Still were deleted outright), so these are unconditional.
		const silentSpans = wallSilentSpans();
		const noiseSpans = wallNoiseSpans();
		await mix({
			bedPath: bedPath(plan.bedId),
			narrationPath: narrationAudioPath,
			durationMs,
			narrationSpans,
			silentSpans,
			noiseSpans,
			outPath: mixedAudioPath
		});

		console.log('Encoding to the house MP4 profile...');
		await encode({
			videoPath: silentVideoPath,
			audioPath: mixedAudioPath,
			outPath: assetPaths.video
		});

		const probeResult = await probe(assetPaths.video);
		assertMeetsProfile(probeResult);
		console.log(`Wrote ${assetPaths.video} (${(probeResult.durationSec ?? 0).toFixed(1)}s)`);

		console.log('Rendering Instagram feed still...');
		await renderCard({
			text: feedStillText(plan.formatPlan),
			author: plan.authorSlug as AuthorSlug,
			size: 'igFeed',
			outPath: assetPaths.feedStill
		});
		console.log(`Wrote ${assetPaths.feedStill}`);

		const metadata: PostMetadata = {
			card_id: plan.cardId,
			format: plan.compositionId.toLowerCase() as PostFormat,
			rendered_at: `${plan.date}T00:00:00.000Z`
		};
		const fullMetadata = { ...metadata, ...narrationFields(plan, !VOICES_ARE_UNSET) };
		const metadataPath = postMetadataPathFor(assetPaths.video);
		await writePostMetadata(metadataPath, fullMetadata);
		console.log(`Wrote ${metadataPath}`);
	} finally {
		// `closeRenderer()` runs first, in its own try, so a failing
		// `rm(workDir)` below can never leave the Playwright/Chromium
		// process (used by `renderCard` for the IG feed still) running.
		try {
			await closeRenderer();
		} finally {
			await rm(workDir, { recursive: true, force: true });
		}
	}
}

/**
 * Additive fields on the metadata sidecar beyond `PostMetadata`'s own
 * shape (`render/post-metadata.ts` is deliberately the smallest writer —
 * see its module doc comment — so T18-specific fields like `narration`
 * and `bed` live here rather than widening that shared interface).
 */
function narrationFields(plan: RenderPlan, narration: boolean): Record<string, unknown> {
	return {
		narration,
		bed: plan.bedId,
		book_slug: plan.bookSlug,
		author_slug: plan.authorSlug,
		day: plan.day,
		week: plan.week
	};
}

// ---------------------------------------------------------------------------
// entry point
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	const command = argv[0];

	if (command === undefined || command === '--help') {
		printHelp();
		process.exit(command === undefined ? 1 : 0);
		return;
	}

	if (command !== 'render') {
		console.error(`Unknown command "${command}". Only "render" is supported.\n`);
		printHelp();
		process.exit(1);
		return;
	}

	const args = parseRenderArgs(argv.slice(1));
	await renderCommand(args);
}

// social pilot 02a T14: only auto-run `main()` when this file is the actual
// process entry point (`npx tsx cli.ts render ...`, exactly how `cli.test.ts`
// invokes it via a subprocess). Without this guard, merely IMPORTING this
// module — which `narration.test.ts` needs to do, to unit-test the pure
// `wallSilentSpans`/`narrationPlan` functions below against recorded
// fixtures, without a live voice or a full Remotion render — would itself
// parse `process.argv` as CLI args and call `process.exit()`, killing the
// whole test worker. Identical runtime behavior for every real invocation:
// `import.meta.url` and `pathToFileURL(process.argv[1]).href` both resolve
// to this same file's URL when tsx runs it as the entry script.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
	main().catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exit(1);
	});
}
