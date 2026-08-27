/**
 * The Wall's audio-phase spans — `cli.ts`'s `wallSilentSpans`/`wallNoiseSpans`
 * — and the F02 edge case they feed into `mix()`.
 *
 * Pf39c2-social-pilot-02 N01 (2026-08-27) deleted the narration subsystem.
 * This file used to be `narration.test.ts` and also covered `narrationPlan`
 * (which lines get narrated, and that framing text — the running head, the
 * payoff label — never reaches a TTS provider) — both gone along with
 * `narrationPlan` itself (`cli.ts`) and `narration.ts`. `wallSilentSpans`/
 * `wallNoiseSpans` are NOT narration machinery, though: they are the noise
 * (scroll phase) / true-silence (post-cut) windows `cli.ts` hands to
 * `mix()` for every render, independent of whether anything is narrated,
 * so they and the F02 non-silent-mix edge case they enable survive here
 * under a name that reflects what's actually left.
 *
 * No live provider calls anywhere in this file — the one thing that used
 * to require that (`synthesizeNarration`/`recordingProvider`) is deleted
 * along with `narrationPlan`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { wallSilentSpans, wallNoiseSpans, WALL_DROP_SILENCE_MS } from '../../cli.js';
import { FPS, WALL_FRAMES, LANDING_LINE_SECONDS, computeWallTiming } from '../../remotion/wall-timing.js';
import { bedPath } from '../beds.js';
import { LOUDNESS_TOLERANCE_LU, TARGET_LUFS, mix } from '../mix.js';

const MIX_TIMEOUT_MS = 30_000;

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
// wallSilentSpans/wallNoiseSpans — U04's "noise, then WALL_DROP_SILENCE_MS
// of true silence, then the bed's own slow return" shape (silence length
// raised 500 -> 1000ms by V06)
// ---------------------------------------------------------------------------

describe('wallSilentSpans / wallNoiseSpans', () => {
	const wallEndMs = (WALL_FRAMES / FPS) * 1000;

	/**
	 * U04 (`plans/Pf39c2-social-pilot-02a.md`) narrowed this from T15's "the
	 * landing line ALONE" (2.5s -> 5.5s) down to just `WALL_DROP_SILENCE_MS`
	 * of TRUE silence right after the cut — the rest of the old
	 * landing-line-hold window is no longer silent: `wallNoiseSpans` carries
	 * the scroll instead of the bed, and the bed's own slow
	 * `BED_RETURN_FADE_MS` fade-in (`audio/mix.ts`'s `bedEnvelope`) fills the
	 * back end, landing at nominal exactly when the landing line ends.
	 */
	it('wallSilentSpans: covers only WALL_DROP_SILENCE_MS of TRUE silence, starting where the wall scroll ends', () => {
		expect(wallSilentSpans()).toEqual([{ startMs: wallEndMs, endMs: wallEndMs + WALL_DROP_SILENCE_MS }]);
	});

	it('sanity: the silent span never starts after it ends, whatever its current bounds are', () => {
		const [span] = wallSilentSpans();
		expect(span.endMs).toBeGreaterThan(span.startMs);
	});

	/**
	 * V06: `WALL_DROP_SILENCE_MS` sits inside the fixed 3s
	 * `LANDING_LINE_SECONDS` hold (the noise phase fills the front of that
	 * hold, the bed's return fade fills the back — see the doc comment
	 * above). Assert that relationship directly, against the real constants,
	 * so a future cut to `LANDING_LINE_SECONDS` can't silently push the
	 * silent span past the end of the hold instead of failing loudly here.
	 */
	it('WALL_DROP_SILENCE_MS fits inside the LANDING_LINE_SECONDS hold, with room to spare', () => {
		expect(WALL_DROP_SILENCE_MS).toBeLessThanOrEqual(LANDING_LINE_SECONDS * 1000);
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
// F02 edge case — a single-sentence Wall (no rest lines, hence nothing that
// would have been narrated even before N01) still produces a valid,
// non-silent mix
// ---------------------------------------------------------------------------

describe('a Wall whose plain_english is a single sentence (no rest lines) still produces a valid, non-silent mix', () => {
	const originalExcerpt = 'Thys is ye archaick excerpte, the only text scrolling in this card.';

	let workDir: string;

	beforeAll(async () => {
		workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-wall-spans-f02-'));
	});

	afterAll(async () => {
		await rm(workDir, { recursive: true, force: true });
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
