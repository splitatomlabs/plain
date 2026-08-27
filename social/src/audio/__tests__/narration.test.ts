/**
 * The narration contract (social pilot 02a T14): what The Wall's audio is
 * SUPPOSED to look like once the framing layer (T11-T13) and the payoff fix
 * (T02-T09) have landed. Four things asserted here, straight from the plan:
 *
 *   1. `wallSilentSpans()` covers the LANDING LINE ALONE — the moving-wall
 *      scroll is no longer silenced; it carries the music bed instead.
 *   2. Rest lines (`narrationPlan`'s `lines` for a `'wall'` plan) are the
 *      ONLY narrated set — never the landing line, never the original
 *      excerpt, never the chapter scroll block.
 *   3. Framing text (the running head, the payoff label — `SourceHead.tsx`)
 *      never reaches `TtsProvider.synthesize`, for any of the four
 *      compositions.
 *   4. A Wall whose `plain_english` is a single sentence — no rest lines,
 *      hence NOTHING narrated at all — still produces a valid, non-silent
 *      mix (the F02 edge case: ffmpeg's `loudnorm` measuring a mix as
 *      digital silence on its first pass).
 *
 * ORDERING (per the plan): T15, not this task, is what actually shrinks
 * `wallSilentSpans()` down to the landing line alone and moves the bed
 * under the scroll. Assertion 1 below is therefore RED against today's
 * implementation (`wallSilentSpans()` still spans the full
 * `WALL_FRAMES + LANDING_LINE_FRAMES` window, starting at 0) and is
 * EXPECTED to fail until T15 lands — see that test's own comment.
 * Assertions 2-4 hold already, against the current (pre-T15) code, and are
 * pinned here as regression protection before T15 touches `wallSilentSpans`/
 * `mix.ts` at all.
 *
 * No live provider calls anywhere in this file. `synthesizeNarration` is
 * always given a fake `TtsProvider` that writes the recorded
 * `polly-sample.mp3` fixture and reports whatever marks the test hands it —
 * same pattern `social/src/__tests__/narration.test.ts` (F07/F09/F13) uses.
 * `resolveVoice` (`audio/voices.js`) is mocked to a fixed voice because
 * `VOICES_ARE_UNSET` (T14 in the OLDER plan 02 — no `ELEVENLABS_API_KEY`,
 * and live provider calls are forbidden in tests) unconditionally throws
 * otherwise.
 *
 * `cli.ts`'s `wallSilentSpans`/`narrationPlan` are private implementation
 * of the render CLI, exported here (visibility only, no behavior change) so
 * this file can assert on them directly. Importing `cli.ts` at all is only
 * safe because of the entry-point guard added alongside those exports —
 * without it, `main()` runs at import time and calls `process.exit()`. See
 * that guard's own comment in `cli.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuthorSlug } from '../../render/theme.js';
import type { WallPlan } from '../../cli.js';
import { wallSilentSpans, wallNoiseSpans, narrationPlan } from '../../cli.js';
import { FPS, WALL_FRAMES, computeWallTiming } from '../../remotion/wall-timing.js';
import { formatRunningHead, PAYOFF_LABEL_TEXT } from '../../remotion/SourceHead.js';
import { bedPath } from '../beds.js';
import { LOUDNESS_TOLERANCE_LU, TARGET_LUFS, mix } from '../mix.js';
import type { ProviderMark, TtsProvider, TtsResult } from '../tts.js';

const MIX_TIMEOUT_MS = 30_000;

// `resolveVoice` (`audio/voices.js`) unconditionally throws while T14 (plan
// 02) is blocked — mocked to a fixed voice so `synthesizeNarration` below is
// reachable at all. `vi.mock` is hoisted above every import in this file
// (including the one below), so `narration.js`'s own
// `import { resolveVoice } from './audio/voices.js'` resolves to this mock
// too — same pattern as `social/src/__tests__/narration.test.ts`.
vi.mock('../voices.js', () => ({
	resolveVoice: () => ({ provider: 'polly' as const, voiceId: 'test-voice', label: 'test' })
}));

import { synthesizeNarration } from '../../narration.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(moduleDir, 'fixtures');

// ---------------------------------------------------------------------------
// Shared fixtures — a real card-shaped WallPlan literal, never live pipeline
// output (this file's whole point is to be independent of any real render),
// but shaped exactly like `cli.ts`'s `buildRenderPlan` produces it.
//
// Pf39c2-social-pilot-02a D01: Question, Objection and Still were deleted
// outright — the channel is one Wall a day — so their plan fixtures and the
// assertions that exercised them are gone too.
// ---------------------------------------------------------------------------

const WALL_PLAN: WallPlan = {
	format: 'wall',
	originalExcerpt: 'Thys is ye archaick excerpte that scrolles by, never itself narrated.',
	chapterBlock: 'Thys is ye archaick excerpte that scrolles by, never itself narrated, plus the surrounding chapter.',
	sourceReference: 'Meditations, Book 7, Section 3',
	landingLine: 'This is the landing line, held in silence.',
	plainLines: ['This is the first rest line.', 'This is the second rest line.']
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-narration-contract-'));
	tempDirs.push(dir);
	return dir;
}

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fake `TtsProvider` that records the EXACT `text` argument every call to
 * `synthesize` receives (in `calls`, in order) and writes the real,
 * committed `polly-sample.mp3` fixture to `outPath` so any downstream
 * `ffprobe` call in `synthesizeNarration` sees a real, playable file. The
 * `marks` it reports are irrelevant to this file's assertions — nothing here
 * needs `synthesizeNarration`'s drift gate to actually PASS, only that
 * `synthesize` is REACHED with the right (or wrong) text; a failure past
 * that point is caught and ignored (see `capturedSynthesizeText`).
 */
function recordingProvider(calls: string[]): TtsProvider {
	return {
		name: 'polly',
		async synthesize(text, _voice, outPath): Promise<TtsResult> {
			calls.push(text);
			const audio = await readFile(path.join(fixturesDir, 'polly-sample.mp3'));
			await writeFile(outPath, audio);
			const marks: ProviderMark[] = [];
			return { audioPath: outPath, provider: 'polly', voiceId: 'test-voice', durationMs: 0, marks };
		}
	};
}

/**
 * Runs `synthesizeNarration(lines, ...)` against a recording fake provider
 * and returns the exact text it handed to `synthesize` — regardless of
 * whether `synthesizeNarration` itself went on to succeed or throw (an
 * empty/mismatched `marks` array from `recordingProvider` will usually make
 * it throw past the `synthesize` call, in `lineTimingsFromMarks` or
 * `assertNarrationInSync` — irrelevant here, since by then `synthesize` has
 * already been called with whatever text it was going to get).
 */
async function capturedSynthesizeText(lines: string[]): Promise<string> {
	const calls: string[] = [];
	const provider = recordingProvider(calls);
	const dir = await makeTempDir();
	const outPath = path.join(dir, 'narration.mp3');
	try {
		await synthesizeNarration(lines, 'epictetus' as AuthorSlug, provider, {}, outPath);
	} catch {
		// See doc comment above — downstream timing failures are expected
		// and irrelevant to what text reached `synthesize`.
	}
	expect(calls).toHaveLength(1);
	return calls[0];
}

/** Mean volume (dBFS) of `filePath` over [startSec, endSec), via ffmpeg's `volumedetect`. */
function meanVolumeDb(filePath: string, startSec: number, endSec: number): number {
	const result = spawnSync(
		'ffmpeg',
		['-y', '-i', filePath, '-af', `atrim=start=${startSec}:end=${endSec},volumedetect`, '-f', 'null', '-'],
		{ encoding: 'utf-8' }
	);
	const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
	if (!match) {
		throw new Error(`Could not find mean_volume in ffmpeg output:\n${result.stderr}`);
	}
	return Number(match[1]);
}

// ---------------------------------------------------------------------------
// 1. wallSilentSpans/wallNoiseSpans — U04's "noise, then 0.5s of true
//    silence, then the bed's own slow return" shape
// ---------------------------------------------------------------------------

describe('wallSilentSpans / wallNoiseSpans', () => {
	const wallEndMs = (WALL_FRAMES / FPS) * 1000;

	/**
	 * U04 (`plans/Pf39c2-social-pilot-02a.md`) narrowed this from T15's "the
	 * landing line ALONE" (2.5s -> 5.5s) down to just the 0.5s of TRUE
	 * silence right after the cut — the rest of the old landing-line-hold
	 * window is no longer silent: `wallNoiseSpans` carries the scroll instead
	 * of the bed, and the bed's own slow `BED_RETURN_FADE_MS` fade-in
	 * (`audio/mix.ts`'s `bedEnvelope`) fills the back end, landing at nominal
	 * exactly when the landing line ends.
	 */
	it('wallSilentSpans: covers only 0.5s of TRUE silence, starting where the wall scroll ends', () => {
		expect(wallSilentSpans()).toEqual([{ startMs: wallEndMs, endMs: wallEndMs + 500 }]);
	});

	it('sanity: the silent span never starts after it ends, whatever its current bounds are', () => {
		const [span] = wallSilentSpans();
		expect(span.endMs).toBeGreaterThan(span.startMs);
	});

	/**
	 * U04: the moving-wall SCROLL phase (`[0, wallEndMs)`) is where the dense,
	 * procedural noise track plays instead of the bed — see `audio/mix.ts`'s
	 * `MixInput.noiseSpans`.
	 */
	it('wallNoiseSpans: covers the whole scroll phase, from 0 to where wallSilentSpans begins', () => {
		expect(wallNoiseSpans()).toEqual([{ startMs: 0, endMs: wallEndMs }]);
		expect(wallNoiseSpans()[0].endMs).toBe(wallSilentSpans()[0].startMs);
	});
});

// ---------------------------------------------------------------------------
// 2. Rest lines are the only narrated set
// ---------------------------------------------------------------------------

describe('narrationPlan — the Wall narrates the rest lines, and only the rest lines', () => {
	it('lines is exactly plainLines, in order — never the landing line', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		expect(lines).toEqual(WALL_PLAN.plainLines);
		expect(lines).not.toContain(WALL_PLAN.landingLine);
	});

	it('lines never contains the original excerpt or the chapter scroll block', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		const joined = lines.join(' ');
		expect(joined).not.toContain(WALL_PLAN.originalExcerpt);
		expect(joined).not.toContain(WALL_PLAN.chapterBlock);
	});

	it('offsetMs lands exactly at the landing line\'s end frame — narration starts right after the silent phase, whatever its current bounds are', () => {
		const timing = computeWallTiming({ originalExcerpt: WALL_PLAN.originalExcerpt, plainLines: WALL_PLAN.plainLines });
		const { offsetMs } = narrationPlan(WALL_PLAN);
		expect(offsetMs).toBe((timing.landingLine.endFrame / FPS) * 1000);
	});

	it('a Wall with no rest lines (single-sentence plain_english) narrates nothing at all', () => {
		const singleSentencePlan: WallPlan = { ...WALL_PLAN, plainLines: [] };
		const { lines } = narrationPlan(singleSentencePlan);
		expect(lines).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. Framing text never reaches `synthesize`
// ---------------------------------------------------------------------------

describe('framing text (running head, payoff label) never reaches TtsProvider.synthesize', () => {
	const wallRunningHead = formatRunningHead({ author_slug: 'marcus-aurelius', source_reference: WALL_PLAN.sourceReference });

	it('Wall: narrationPlan\'s own lines exclude the running head and the payoff label', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		const joined = lines.join(' ');
		expect(joined).not.toContain(wallRunningHead);
		expect(joined).not.toContain(PAYOFF_LABEL_TEXT);
		expect(joined).not.toContain(WALL_PLAN.sourceReference);
	});

	it(
		'Wall: the text handed to TtsProvider.synthesize is exactly the joined rest lines — no framing text mixed in',
		async () => {
			const { lines } = narrationPlan(WALL_PLAN);
			const text = await capturedSynthesizeText(lines);
			expect(text).toBe(lines.join(' '));
			expect(text).not.toContain(wallRunningHead);
			expect(text).not.toContain(PAYOFF_LABEL_TEXT);
			expect(text).not.toContain(WALL_PLAN.sourceReference);
		},
		MIX_TIMEOUT_MS
	);

});

// ---------------------------------------------------------------------------
// 4. F02 edge case — a single-sentence Wall still produces a valid, non-
//    silent mix
// ---------------------------------------------------------------------------

describe('a Wall whose plain_english is a single sentence (no rest lines) still produces a valid, non-silent mix', () => {
	const originalExcerpt = 'Thys is ye archaick excerpte, the only text scrolling in this card.';
	const noRestLinesPlan: WallPlan = { ...WALL_PLAN, plainLines: [] };

	let workDir: string;

	beforeAll(async () => {
		workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-narration-f02-'));
	});

	afterAll(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('narrationPlan agrees: nothing is narrated for this card', () => {
		const { lines } = narrationPlan(noRestLinesPlan);
		expect(lines).toEqual([]);
	});

	it(
		'mix() succeeds — no SilentMixError, measured loudness within tolerance, audible after the silent span',
		async () => {
			const timing = computeWallTiming({ originalExcerpt, plainLines: [] });
			const durationMs = (timing.totalFrames / FPS) * 1000;
			const outPath = path.join(workDir, 'f02-single-sentence-mix.m4a');

			const result = await mix({
				bedPath: bedPath('bed-03-e-minor7'),
				narrationPath: undefined,
				durationMs,
				narrationSpans: [],
				silentSpans: wallSilentSpans(),
				// U04: matches cli.ts's real call for a Wall exactly — noise
				// under the scroll, true silence after the cut.
				noiseSpans: wallNoiseSpans(),
				outPath
			});

			// Not `-Infinity`/`NaN` — a real, finite loudness measurement is
			// exactly what `SilentMixError` exists to have prevented reaching.
			expect(Number.isFinite(result.measured.integratedLufs)).toBe(true);
			expect(Math.abs(result.measured.integratedLufs - TARGET_LUFS)).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);

			// Audible somewhere after the (possibly-shrunk, post-T15) silent
			// span — proves the mix isn't silently silent end-to-end despite
			// passing loudnorm's non-finite check.
			const [silentSpan] = wallSilentSpans();
			const durationSec = durationMs / 1000;
			const checkStartSec = Math.min(durationSec, silentSpan.endMs / 1000 + 0.5);
			const checkEndSec = Math.min(durationSec, checkStartSec + 6);
			const afterSilenceDb = meanVolumeDb(outPath, checkStartSec, checkEndSec);
			expect(afterSilenceDb).toBeGreaterThan(-45);
		},
		MIX_TIMEOUT_MS
	);
});

