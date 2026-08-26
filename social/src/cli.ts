#!/usr/bin/env node
/**
 * The render CLI (T18): `social/src/cli.ts render --date <YYYY-MM-DD> --slot <1|2>`.
 *
 * Maps `--date`/`--slot` onto a committed weekly schedule
 * (`content/social/pilot-schedule-w<NN>.json`, see `pilot-config.ts`),
 * resolves the card and every field that schedule doesn't itself carry
 * from `content/output/`, renders that slot's composition with Remotion,
 * encodes it to the house MP4 profile (`render/encode.ts`), renders the
 * Instagram feed still, and writes a metadata sidecar (`render/
 * post-metadata.ts`).
 *
 * Deterministic by policy, same as every other tool in this pipeline
 * (`scripts/generate-schedule.ts`, `scripts/review-week.ts`): the date
 * always comes from `--date`, never `Date.now()`; the Wall's opening and
 * the music bed are both seeded from `--date`/`--slot` alone
 * (`cli-plan.ts`'s `postIndexForSlot`), so re-running the same
 * `--date`/`--slot` always makes the same choices.
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
import { fileURLToPath } from 'node:url';

import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition } from '@remotion/renderer';

import { dateToWeekDay } from './pilot-config.js';
import {
	scheduleFileName,
	resolveSlot,
	postIndexForSlot,
	chooseWallOpening,
	chooseBed,
	computeWallPlainLines,
	renderAssetPaths
} from './cli-plan.js';
import type { WeekSchedule } from './schedule-types.js';
import { loadOutputCard } from './remotion/wall-pool.js';
import { loadChapterTextBlock } from './render/chapter-text.js';
import { computeEligibleOpenings, type WallOpening } from './remotion/wall-openings.js';
import { computeWallTiming, WALL_FRAMES, LANDING_LINE_FRAMES, FPS } from './remotion/wall-timing.js';
import { formatRunningHead } from './remotion/SourceHead.js';
import { computeQuestionTiming } from './remotion/question-timing.js';
import { computeObjectionTiming, OBJECTION_REPLY_LINE_COUNT } from './remotion/objection-timing.js';
import { bedPath } from './audio/beds.js';
import { mix, type TimeSpan } from './audio/mix.js';
import { splitPayoffLines, type NarrationLineTiming } from './audio/timing.js';
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
	console.log(`Usage: npx tsx social/src/cli.ts render --date <YYYY-MM-DD> --slot <1|2> [options]

Renders one scheduled slot's video + Instagram feed still + metadata
sidecar, from a committed weekly schedule (content/social/
pilot-schedule-w<NN>.json — see scripts/generate-schedule.ts).

Options:
  --date <YYYY-MM-DD>    The slot's calendar date (required). Mapped onto a
                          schedule week/day via pilot-config.ts's
                          PILOT_WEEK_1_START anchor.
  --slot <1|2>            Which of the day's two slots to render (required).
                          Slot 1 is always the read-through slot.
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
	slotNumber: number;
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
			slot: { type: 'string' },
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
	if (!values.slot) {
		throw new Error('Specify --slot <1|2>');
	}
	const slotNumber = Number(values.slot);
	if (slotNumber !== 1 && slotNumber !== 2) {
		throw new Error(`Invalid --slot "${values.slot}" — must be 1 or 2.`);
	}

	return {
		date: values.date,
		slotNumber,
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

interface WallPlan {
	format: 'wall';
	originalExcerpt: string;
	/**
	 * The moving wall phase's real scrolling text (social pilot 02a T09) —
	 * this card's own excerpt plus the surrounding chapter, in document
	 * order, one full lap starting at this card. See `Wall.tsx`'s
	 * `WallProps.chapterBlock` doc comment and `render/chapter-text.ts`'s
	 * `loadChapterTextBlock`.
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
	opening: WallOpening;
	eligibleOpenings: WallOpening[];
}

interface QuestionPlan {
	format: 'question';
	question: string;
	answer: string;
	originalExcerpt: string;
}

interface ObjectionPlan {
	format: 'objection';
	objection: string;
	reply: string;
}

/**
 * F19 — the read-through's fallback format. `text` is the card's raw
 * `plain_english`, verbatim, in full — see `remotion/Still.tsx`.
 */
interface StillPlan {
	format: 'still';
	text: string;
}

type FormatPlan = WallPlan | QuestionPlan | ObjectionPlan | StillPlan;

interface RenderPlan {
	date: string;
	week: number;
	day: number;
	slotNumber: number;
	cardId: string;
	bookSlug: string;
	authorSlug: string;
	counter: string | null;
	compositionId: 'Wall' | 'Question' | 'Objection' | 'Still';
	formatPlan: FormatPlan;
	postIndex: number;
	bedId: string;
}

async function buildRenderPlan(args: RenderArgs): Promise<RenderPlan> {
	const { week, day } = dateToWeekDay(args.date);
	const schedule = await loadWeekSchedule(week, args.scheduleDir);
	const slot = resolveSlot(schedule, day, args.slotNumber);
	const card = loadOutputCard(slot.book_slug, slot.card_id);

	const postIndex = postIndexForSlot(args.date, args.slotNumber);
	const bed = chooseBed(postIndex);

	let formatPlan: FormatPlan;
	let compositionId: RenderPlan['compositionId'];

	switch (slot.content.format) {
		case 'wall': {
			const plainLines = computeWallPlainLines(card.plain_english, slot.content.landing_line);
			const eligibleOpenings = computeEligibleOpenings(slot.content.original_excerpt, card.plain_english);
			const opening = chooseWallOpening(postIndex, eligibleOpenings);
			const chapterBlock = loadChapterTextBlock(slot.book_slug, slot.card_id);
			formatPlan = {
				format: 'wall',
				originalExcerpt: slot.content.original_excerpt,
				chapterBlock,
				sourceReference: card.source_reference,
				landingLine: slot.content.landing_line,
				plainLines,
				opening,
				eligibleOpenings
			};
			compositionId = 'Wall';
			break;
		}
		case 'question': {
			formatPlan = {
				format: 'question',
				question: slot.content.question,
				answer: slot.content.answer,
				originalExcerpt: card.original_excerpt
			};
			compositionId = 'Question';
			break;
		}
		case 'objection': {
			formatPlan = {
				format: 'objection',
				objection: slot.content.objection,
				reply: slot.content.reply
			};
			compositionId = 'Objection';
			break;
		}
		case 'still': {
			formatPlan = {
				format: 'still',
				text: slot.content.text
			};
			compositionId = 'Still';
			break;
		}
	}

	return {
		date: args.date,
		week,
		day,
		slotNumber: args.slotNumber,
		cardId: slot.card_id,
		bookSlug: slot.book_slug,
		authorSlug: slot.author_slug,
		counter: slot.read_through_counter,
		compositionId,
		formatPlan,
		postIndex,
		bedId: bed.id
	};
}

function printPlan(plan: RenderPlan): void {
	console.log(`Render plan for ${plan.date} slot ${plan.slotNumber} (week ${plan.week} day ${plan.day}):`);
	console.log(`  composition: ${plan.compositionId}`);
	console.log(`  card: ${plan.cardId} (${plan.bookSlug}, ${plan.authorSlug})`);
	console.log(`  counter: ${plan.counter ?? '(none — not a read-through slot)'}`);
	console.log(`  post index: ${plan.postIndex}`);
	console.log(`  bed: ${plan.bedId}`);
	if (plan.formatPlan.format === 'wall') {
		console.log(`  opening: ${plan.formatPlan.opening} (eligible: ${plan.formatPlan.eligibleOpenings.join(', ')})`);
		console.log(`  plain lines after landing line: ${plan.formatPlan.plainLines.length}`);
		console.log(
			`  chapter block: ${plan.formatPlan.chapterBlock.split(/\s+/).filter(Boolean).length} words ` +
				`(card's own excerpt: ${plan.formatPlan.originalExcerpt.split(/\s+/).filter(Boolean).length} words)`
		);
		console.log(
			`  running head: "${formatRunningHead({ author_slug: plan.authorSlug as AuthorSlug, source_reference: plan.formatPlan.sourceReference })}"`
		);
	}
	console.log('  narration: false (T14 not done — music-only)');
}

// ---------------------------------------------------------------------------
// Composition inputProps + duration
// ---------------------------------------------------------------------------

function buildInputProps(plan: RenderPlan, narrationTimings?: NarrationLineTiming[]): Record<string, unknown> {
	const base = { author: plan.authorSlug, counter: plan.counter };
	switch (plan.formatPlan.format) {
		case 'wall':
			return {
				...base,
				originalExcerpt: plan.formatPlan.originalExcerpt,
				chapterBlock: plan.formatPlan.chapterBlock,
				sourceReference: plan.formatPlan.sourceReference,
				landingLine: plan.formatPlan.landingLine,
				plainLines: plan.formatPlan.plainLines,
				opening: plan.formatPlan.opening,
				eligibleOpenings: plan.formatPlan.eligibleOpenings,
				// Only The Wall's timing adapts to real per-line narration
				// duration (`computeWallTiming`'s `narrationTimings` input) —
				// The Question/The Objection have a fixed shape (see
				// `narrationOffsetMs`'s doc comment) and take no such prop.
				...(narrationTimings ? { narrationTimings } : {})
			};
		case 'question':
			return {
				...base,
				question: plan.formatPlan.question,
				answer: plan.formatPlan.answer,
				originalExcerpt: plan.formatPlan.originalExcerpt
			};
		case 'objection':
			return {
				...base,
				objection: plan.formatPlan.objection,
				reply: plan.formatPlan.reply
			};
		case 'still':
			// `base` carries `author`, unused by `Still.tsx` (no accent colour
			// in this format — see that component's own doc comment); kept
			// here only so `Still`'s props follow the same `{...base, ...}`
			// shape as every other format's, harmlessly ignored by the
			// component.
			return {
				...base,
				text: plan.formatPlan.text
			};
	}
}

/**
 * The Wall's silent phases (the moving wall + the mandated 3s landing-line
 * hold), in ms — see the module doc comment.
 *
 * Deliberately uses the FIXED `WALL_FRAMES + LANDING_LINE_FRAMES` boundary
 * rather than `computeWallTiming(...).landingLine.endFrame`: when a card has
 * no plain-passage lines left after the landing line, `computeWallTiming`
 * extends `landingLine.endFrame` to absorb the 15s duration-floor pad (see
 * `duration-bounds.ts`'s `padToMinimumDuration`) so the PICTURE keeps
 * holding the landing line for the full post. That padding is not part of
 * the documented "silent, motionless" 5.5s window — it exists purely to
 * clear the MP4 duration floor. Silencing the bed for that padding too
 * meant the whole clip (bed included) went silent for any 0-plain-line Wall
 * card, which ffmpeg's loudnorm then measures as digital silence
 * (`measured_I: -inf`) on its first pass (see F02,
 * `plans/Pf39c2-social-pilot-02.md`).
 */
function wallSilentSpans(): TimeSpan[] {
	return [{ startMs: 0, endMs: ((WALL_FRAMES + LANDING_LINE_FRAMES) / FPS) * 1000 }];
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
 * after `WALL_FRAMES + LANDING_LINE_FRAMES`. The Question narrates its
 * answer, starting after `QUESTION_HOLD_FRAMES + WALL_FRAMES`. The
 * Objection narrates its two capped reply sentences as one continuous
 * clip, starting after `OBJECTION_HOLD_FRAMES` — NOTE: unlike The Wall,
 * neither The Question's nor The Objection's own timing module accepts a
 * `narrationTimings` input (their schedules are fixed shapes — see
 * `question-timing.ts`/`objection-timing.ts`), so if the real narration
 * ever runs long or short of their fixed per-line holds, the audio and the
 * on-screen line can drift out of step. That's a real, acknowledged gap in
 * those two formats' timing modules, not something this CLI can paper
 * over — flagged here rather than silently pretending it's solved.
 */
function narrationPlan(formatPlan: FormatPlan): { lines: string[]; offsetMs: number } {
	switch (formatPlan.format) {
		case 'wall': {
			const timing = computeWallTiming({ originalExcerpt: formatPlan.originalExcerpt, plainLines: formatPlan.plainLines });
			return { lines: formatPlan.plainLines, offsetMs: (timing.landingLine.endFrame / FPS) * 1000 };
		}
		case 'question': {
			const timing = computeQuestionTiming({ question: formatPlan.question });
			return { lines: [formatPlan.answer], offsetMs: (timing.wall.endFrame / FPS) * 1000 };
		}
		case 'objection': {
			const timing = computeObjectionTiming();
			const lines = splitPayoffLines(formatPlan.reply).slice(0, OBJECTION_REPLY_LINE_COUNT);
			return { lines, offsetMs: (timing.objection.endFrame / FPS) * 1000 };
		}
		case 'still': {
			// The Still has no silent/moving phase to wait out — the whole
			// composition is the payoff frame from frame 0 (see
			// `still-timing.ts`), so narration begins immediately.
			return { lines: splitPayoffLines(formatPlan.text), offsetMs: 0 };
		}
	}
}

/** The still text shown on the Instagram feed card — the format's own "hook" line. */
function feedStillText(formatPlan: FormatPlan): string {
	switch (formatPlan.format) {
		case 'wall':
			return formatPlan.landingLine;
		case 'question':
			return formatPlan.question;
		case 'objection':
			return formatPlan.objection;
		case 'still':
			// The Still's feed still and its video frame are the SAME text —
			// there is no shorter "hook" line for this format; the whole
			// point is the full passage, verbatim (see `Still.tsx`).
			return formatPlan.text;
	}
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
	const assetPaths = renderAssetPaths(args.outDir, plan.compositionId.toLowerCase(), plan.date, plan.slotNumber);

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
			if (plan.formatPlan.format === 'wall') {
				narrationTimings = narration.timings;
			}
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
		const silentSpans = plan.formatPlan.format === 'wall' ? wallSilentSpans() : [];
		await mix({
			bedPath: bedPath(plan.bedId),
			narrationPath: narrationAudioPath,
			durationMs,
			narrationSpans,
			silentSpans,
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
			opening: plan.formatPlan.format === 'wall' ? plan.formatPlan.opening : null,
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
		slot: plan.slotNumber,
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

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exit(1);
});
