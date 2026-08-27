import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { bedPath } from '../beds.js';
import {
	BED_DUCK_DB,
	HARD_STOP_RAMP_MS,
	LOUDNESS_TOLERANCE_LU,
	SilentMixError,
	TARGET_LUFS,
	TARGET_TRUE_PEAK_DBTP,
	assertLoudnessWithinTolerance,
	bedEnvelope,
	measureLoudness,
	mix,
	type LoudnessMeasurement,
	type VolumePoint
} from '../mix.js';

/** Mirrors The Wall's real audio shape (social pilot 02a U04): dense noise
 * under the SCROLL, a hard cut into 0.5s of true silence, then the bed's own
 * slow fade back in. See `cli.ts`'s `wallNoiseSpans`/`wallSilentSpans`. */
const WALL_CUT_MS = 2500;
const WALL_TRUE_SILENCE_END_MS = 3000;

const MIX_TIMEOUT_MS = 30_000;

interface Probe {
	codecName: string;
	sampleRate: number;
	channels: number;
	durationSec: number;
}

function probe(filePath: string): Probe {
	const out = execFileSync('ffprobe', [
		'-v',
		'error',
		'-select_streams',
		'a:0',
		'-show_entries',
		'stream=codec_name,sample_rate,channels',
		'-show_entries',
		'format=duration',
		'-of',
		'json',
		filePath
	]).toString('utf-8');
	const json = JSON.parse(out);
	const stream = json.streams[0];
	return {
		codecName: stream.codec_name,
		sampleRate: Number(stream.sample_rate),
		channels: Number(stream.channels),
		durationSec: Number(json.format.duration)
	};
}

/**
 * Mean volume (dBFS) of `filePath` over [startSec, endSec), via ffmpeg's
 * `volumedetect` — its result is logged to stderr, never stdout, so this
 * uses `spawnSync` to capture stderr regardless of exit status.
 */
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

/**
 * Linear-in-dB interpolation of `points` at `atMs`, for test assertions
 * only. Wherever two adjacent points share the same gainDb (every sustained
 * region `bedEnvelope` produces), this is exact regardless of the domain
 * the real ffmpeg filter interpolates in.
 */
function sampleEnvelopeDb(points: VolumePoint[], atMs: number): number {
	if (atMs <= points[0].atMs) return points[0].gainDb;
	const last = points[points.length - 1];
	if (atMs >= last.atMs) return last.gainDb;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (atMs >= a.atMs && atMs <= b.atMs) {
			const frac = (atMs - a.atMs) / (b.atMs - a.atMs);
			return a.gainDb + (b.gainDb - a.gainDb) * frac;
		}
	}
	throw new Error(`sampleEnvelopeDb: unreachable for atMs=${atMs}`);
}

describe('mix', () => {
	let workDir: string;

	beforeAll(async () => {
		workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-mix-test-'));
	});

	afterAll(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	/**
	 * A synthetic "narration" track: a 350Hz tone (speech-band) amplitude-
	 * modulated into word-like bursts via `tremolo`, deterministic (pure
	 * ffmpeg synthesis, no randomness), no live narration/TTS needed.
	 */
	function synthesizeNarration(outPath: string, durationSec: number): void {
		execFileSync(
			'ffmpeg',
			[
				'-y',
				'-v',
				'error',
				'-f',
				'lavfi',
				'-i',
				`sine=frequency=350:duration=${durationSec}`,
				'-af',
				'tremolo=f=2:d=0.9,volume=0.4',
				'-ar',
				'48000',
				'-ac',
				'2',
				outPath
			],
			{ stdio: ['ignore', 'ignore', 'ignore'] }
		);
	}

	describe('acceptance: measured loudness of a real mixed output', () => {
		const DURATION_SEC = 20;
		let result: Awaited<ReturnType<typeof mix>>;
		let outPath: string;

		beforeAll(async () => {
			const narrationPath = path.join(workDir, 'acceptance-narration.wav');
			synthesizeNarration(narrationPath, DURATION_SEC);

			outPath = path.join(workDir, 'acceptance-mix.m4a');
			result = await mix({
				bedPath: bedPath('bed-01-c-major9'),
				narrationPath,
				durationMs: DURATION_SEC * 1000,
				narrationSpans: [{ startMs: 2000, endMs: 18000 }],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'measured integrated loudness is within tolerance of TARGET_LUFS',
			() => {
				const delta = Math.abs(result.measured.integratedLufs - TARGET_LUFS);
				expect(delta).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'measured true peak does not exceed TARGET_TRUE_PEAK_DBTP (within tolerance)',
			() => {
				expect(result.measured.truePeakDbtp).toBeLessThanOrEqual(TARGET_TRUE_PEAK_DBTP + LOUDNESS_TOLERANCE_LU);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'assertLoudnessWithinTolerance does not throw for this output',
			() => {
				expect(() => assertLoudnessWithinTolerance(result.measured)).not.toThrow();
			},
			MIX_TIMEOUT_MS
		);

		it(
			'output is AAC, 48000Hz, stereo',
			() => {
				const p = probe(outPath);
				expect(p.codecName).toBe('aac');
				expect(p.sampleRate).toBe(48000);
				expect(p.channels).toBe(2);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'measureLoudness independently reproduces a comparable measurement',
			async () => {
				const remeasured = await measureLoudness(outPath);
				expect(Math.abs(remeasured.integratedLufs - TARGET_LUFS)).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);
			},
			MIX_TIMEOUT_MS
		);
	});

	describe('bed looping', () => {
		const DURATION_MS = 75_000; // longer than the 60s beds, forces a loop
		let outPath: string;
		let result: Awaited<ReturnType<typeof mix>>;

		beforeAll(async () => {
			outPath = path.join(workDir, 'looped-mix.m4a');
			result = await mix({
				bedPath: bedPath('bed-02-d-minor9'),
				durationMs: DURATION_MS,
				narrationSpans: [],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'output duration matches the requested (longer than bed) duration within +-20ms',
			() => {
				expect(Math.abs(result.durationMs - DURATION_MS)).toBeLessThanOrEqual(20);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'contains no silent gap where the loop joins (60s boundary)',
			() => {
				const boundaryDb = meanVolumeDb(outPath, 59.8, 60.2);
				const trackDb = meanVolumeDb(outPath, 0, 75);
				// A silent gap at the join would read tens of dB below the track's
				// overall level; a clean loop stays within a few dB of it.
				expect(boundaryDb).toBeGreaterThan(trackDb - 10);
			},
			MIX_TIMEOUT_MS
		);
	});

	describe('silence is honoured', () => {
		const DURATION_SEC = 20;
		let outPath: string;

		beforeAll(async () => {
			const narrationPath = path.join(workDir, 'silence-narration.wav');
			synthesizeNarration(narrationPath, DURATION_SEC);

			outPath = path.join(workDir, 'silence-mix.m4a');
			await mix({
				bedPath: bedPath('bed-03-e-minor7'),
				narrationPath,
				durationMs: DURATION_SEC * 1000,
				narrationSpans: [
					{ startMs: 1000, endMs: 7000 },
					{ startMs: 15000, endMs: 19000 }
				],
				silentSpans: [{ startMs: 8000, endMs: 14000 }],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'a silentSpan produces measurably near-silence, well below a narrated window',
			() => {
				const silentDb = meanVolumeDb(outPath, 9, 13);
				const narratedDb = meanVolumeDb(outPath, 2, 6);
				expect(silentDb).toBeLessThan(-45);
				expect(silentDb).toBeLessThan(narratedDb - 20);
			},
			MIX_TIMEOUT_MS
		);
	});

	/**
	 * R05 (`plans/Pf39c2-social-pilot-02a.md`): guards T15's hard stop against
	 * the latent `volume=eval=frame` defect its own doc comment on
	 * `VOLUME_ENVELOPE_FRAME_SAMPLES` describes — without the
	 * `asetnsamples=n=128` filter inserted before `volume=eval=frame` in
	 * `renderBedTrack`, ffmpeg only re-evaluates the volume expression once
	 * per upstream FLAC frame (~90-100ms against `bed-05-g-sus4.flac`), so a
	 * transition landing mid-frame is held at the stale PREVIOUS gain for the
	 * rest of that frame — a hard cut into a mid-track `silentSpans` doesn't
	 * actually land until ~100ms late. Sampling close to the edge is
	 * deliberate — the existing "silence is honoured" test above samples a
	 * full second inside its span and would pass whether or not
	 * `asetnsamples` is present.
	 *
	 * RETARGETED, NOT REMOVED, by U04: this no longer mirrors The Wall's own
	 * real shape — U04 replaced "the bed plays under the scroll" with "dense
	 * NOISE plays under the scroll, the bed stays silent throughout" (see
	 * `cli.ts`'s `wallNoiseSpans`/`wallSilentSpans`), so the bed itself no
	 * longer has any mid-track entry into silence in a real Wall render. This
	 * test is kept anyway, unchanged in shape (bed audible, then a mid-track
	 * `silentSpans` hard-stop), as a GENERIC regression guard on
	 * `renderBedTrack`'s own `asetnsamples` — still a real, supported, tested
	 * `mix()` capability (`bedEnvelope`'s hard-stop-into-FLOOR path), and
	 * VERIFIED load-bearing directly: temporarily removing `asetnsamples`
	 * from `renderBedTrack` turns this test red (measured
	 * `meanVolumeDb(out, 2.55, 5.4)` at -31.8dB, not the required <-60dB);
	 * restoring it returns -73.1dB. Without a tight-window test SOMEWHERE
	 * on the bed's own hard-stop path, nothing in this file would catch that
	 * regression — the noise-track test below, which now owns The Wall's
	 * real cut, provably does NOT catch it (see that test's own doc comment).
	 */
	describe('the cut is audible: the bed hard-stops within ~100ms of a mid-track silentSpans (T15/R05, generic regression guard)', () => {
		const DURATION_SEC = 8;
		let outPath: string;

		beforeAll(async () => {
			outPath = path.join(workDir, 'hard-stop-mix.m4a');
			await mix({
				bedPath: bedPath('bed-05-g-sus4'),
				narrationPath: undefined,
				durationMs: DURATION_SEC * 1000,
				narrationSpans: [],
				silentSpans: [{ startMs: WALL_CUT_MS, endMs: 5500 }],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'the bed is clearly audible just before the cut, and near-silent within 50ms after it',
			() => {
				expect(meanVolumeDb(outPath, 0.5, 2.4)).toBeGreaterThan(-30);
				expect(meanVolumeDb(outPath, 2.55, 5.4)).toBeLessThan(-60);
			},
			MIX_TIMEOUT_MS
		);
	});

	/**
	 * U04 (`plans/Pf39c2-social-pilot-02a.md`): The Wall's REAL cut is now on
	 * the NOISE track, not the bed (see the test above's doc comment) — this
	 * verifies the actual output shape: noise clearly audible under the
	 * "scroll," a hard cut, then true silence through the narrow
	 * `[WALL_CUT_MS, WALL_TRUE_SILENCE_END_MS)` window (0.5s), before the
	 * bed's own slow `BED_RETURN_FADE_MS` fade-in would raise the floor
	 * again.
	 *
	 * HONESTLY DOES NOT PROVE `asetnsamples` IS LOAD-BEARING HERE, and says so
	 * rather than pretending otherwise: `anoisesrc` is an in-filtergraph
	 * SOURCE filter (not a file decode), and its own default frame size
	 * (`nb_samples`, 1024 samples = ~21ms at 48kHz) is already well under the
	 * ~90-100ms FLAC-block problem `asetnsamples` exists to fix — verified
	 * directly: temporarily removing `asetnsamples` from `renderNoiseTrack`
	 * left this exact test GREEN (no measurable change to either assertion).
	 * `asetnsamples` is kept on the noise chain anyway, for consistency with
	 * every other envelope-driven track in this file and as a defensive
	 * margin against any future change to how the noise signal is produced
	 * (e.g. `nb_samples` changing, or the noise ever being pre-rendered to a
	 * file and decoded back in) — just not because this test would catch its
	 * removal today. The test above this one is what actually keeps
	 * `asetnsamples` honest.
	 */
	describe("the cut is audible: the noise track hard-stops at the Wall's real cut point (U04)", () => {
		const DURATION_SEC = 8;
		let outPath: string;

		beforeAll(async () => {
			outPath = path.join(workDir, 'hard-stop-mix-noise.m4a');
			await mix({
				bedPath: bedPath('bed-05-g-sus4'),
				narrationPath: undefined,
				durationMs: DURATION_SEC * 1000,
				narrationSpans: [],
				// Mirrors the real Wall shape: noise under the scroll, a hard
				// cut into 0.5s of true silence at WALL_CUT_MS.
				noiseSpans: [{ startMs: 0, endMs: WALL_CUT_MS }],
				silentSpans: [{ startMs: WALL_CUT_MS, endMs: WALL_TRUE_SILENCE_END_MS }],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'the noise is clearly audible just before the cut, and near-silent within 50ms after it',
			() => {
				expect(meanVolumeDb(outPath, 0.5, 2.4)).toBeGreaterThan(-30);
				expect(meanVolumeDb(outPath, 2.55, 2.95)).toBeLessThan(-60);
			},
			MIX_TIMEOUT_MS
		);
	});

	/**
	 * Regression for F02 (`plans/Pf39c2-social-pilot-02.md`): a music-only
	 * (no narration) Wall render whose card has no plain-passage lines left
	 * after the landing line ends up with `durationMs` padded to the 15s
	 * floor and a `silentSpans` window that covers only the documented
	 * WALL_FRAMES+LANDING_LINE_FRAMES 5.5s phase, not the padding after it
	 * (that was the bug — see `cli.ts`'s `wallSilentSpans`). Both real-world
	 * failures used `bed-03-e-minor7`, so this pins that exact bed.
	 */
	describe('bed-03-e-minor7, no narration, padded-duration Wall shape (F02 regression)', () => {
		const DURATION_MS = 15_000; // MIN_POST_DURATION_FRAMES (450 @ 30fps)
		let result: Awaited<ReturnType<typeof mix>>;
		let outPath: string;

		beforeAll(async () => {
			outPath = path.join(workDir, 'f02-regression-mix.m4a');
			result = await mix({
				bedPath: bedPath('bed-03-e-minor7'),
				narrationPath: undefined,
				durationMs: DURATION_MS,
				narrationSpans: [],
				// The wall + landing line's own fixed 5.5s window — never the
				// full (possibly padded) duration.
				silentSpans: [{ startMs: 0, endMs: 5500 }],
				outPath
			});
		}, MIX_TIMEOUT_MS);

		it(
			'succeeds rather than throwing on a non-finite pass-1 measurement',
			() => {
				expect(result.measured.integratedLufs).toBeGreaterThan(-70);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'measured integrated loudness is within tolerance of TARGET_LUFS',
			() => {
				const delta = Math.abs(result.measured.integratedLufs - TARGET_LUFS);
				expect(delta).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);
			},
			MIX_TIMEOUT_MS
		);

		it(
			'the bed is clearly audible after the silent 5.5s window',
			() => {
				const afterSilenceDb = meanVolumeDb(outPath, 7, 14);
				expect(afterSilenceDb).toBeGreaterThan(-45);
			},
			MIX_TIMEOUT_MS
		);
	});

	describe('a deliberately all-silent input throws SilentMixError, not a raw ffmpeg parse failure', () => {
		const DURATION_MS = 15_000;
		let outPath: string;
		let thrown: unknown;

		beforeAll(async () => {
			outPath = path.join(workDir, 'all-silent-mix.m4a');
			try {
				// silentSpans covering the FULL duration reproduces the exact
				// pre-fix bug shape: the bed is held at SILENCE_FLOOR_DB for the
				// entire mix, which ffmpeg's loudnorm measures as -inf on pass 1.
				await mix({
					bedPath: bedPath('bed-03-e-minor7'),
					narrationPath: undefined,
					durationMs: DURATION_MS,
					narrationSpans: [],
					silentSpans: [{ startMs: 0, endMs: DURATION_MS }],
					outPath
				});
			} catch (error) {
				thrown = error;
			}
		}, MIX_TIMEOUT_MS);

		it(
			'throws a SilentMixError (not a generic/ffmpeg-shaped error)',
			() => {
				expect(thrown).toBeInstanceOf(SilentMixError);
			},
			MIX_TIMEOUT_MS
		);

		it(
			"the error names the bed and the mix's duration, and never quotes raw ffmpeg option-parsing output",
			() => {
				const message = (thrown as Error).message;
				expect(message).toContain('bed-03-e-minor7');
				expect(message).toContain('15.0s');
				expect(message).not.toMatch(/Result too large/);
				expect(message).not.toMatch(/Error applying option/);
			},
			MIX_TIMEOUT_MS
		);
	});
});

describe('bedEnvelope', () => {
	it('is deterministic: same inputs produce byte-identical (deep-equal) output', () => {
		const spans = [
			{ startMs: 3000, endMs: 6000 },
			{ startMs: 9000, endMs: 12000 }
		];
		const a = bedEnvelope(20000, spans);
		const b = bedEnvelope(20000, spans);
		expect(a).toEqual(b);
		expect(JSON.stringify(a)).toBe(JSON.stringify(b));
	});

	it('ducks the bed by exactly BED_DUCK_DB during a narration span', () => {
		const spans = [{ startMs: 5000, endMs: 10000 }];
		const env = bedEnvelope(20000, spans);

		// Sampled well inside the span (after the attack completes) and well
		// outside it (after the head fade completes, before the span starts).
		const duringSpan = sampleEnvelopeDb(env, 7500);
		const outsideSpan = sampleEnvelopeDb(env, 2500);

		expect(outsideSpan - duringSpan).toBeCloseTo(-BED_DUCK_DB, 5);
	});

	it('entering a silentSpan is a hard stop: {atMs:2500,gainDb:0} is immediately followed by {atMs:2505,gainDb:-60} (T15/R05)', () => {
		// Names the real constant values rather than trusting the hardcoded
		// numbers below: HARD_STOP_RAMP_MS is 5ms (a scripted duck-length ramp
		// like DUCK_ATTACK_MS would be wrong here), and the floor gain matches
		// mix.ts's private SILENCE_FLOOR_DB (-60, not exported — hardcoded here
		// deliberately, mirroring the "silence is honoured" tests above, which
		// already assert against -45/-60 dB thresholds without an export).
		expect(HARD_STOP_RAMP_MS).toBe(5);

		const env = bedEnvelope(8000, [], [{ startMs: 2500, endMs: 5500 }]);
		const cutIndex = env.findIndex((p) => p.atMs === 2500 && p.gainDb === 0);

		expect(cutIndex).toBeGreaterThanOrEqual(0);
		expect(env[cutIndex]).toEqual({ atMs: 2500, gainDb: 0 });
		// Immediately the next point in the envelope — not a scripted ramp
		// spread over DUCK_ATTACK_MS/DUCK_RELEASE_MS.
		expect(env[cutIndex + 1]).toEqual({ atMs: 2500 + HARD_STOP_RAMP_MS, gainDb: -60 });
	});

	it('has a gentle fade-in at the head and fade-out at the tail (never starts/stops abruptly)', () => {
		const env = bedEnvelope(20000, []);
		expect(env[0].atMs).toBe(0);
		expect(env[0].gainDb).toBeLessThan(-20); // starts near-silent, not at nominal level
		expect(sampleEnvelopeDb(env, 0)).toBeLessThan(sampleEnvelopeDb(env, 2000));

		const last = env[env.length - 1];
		expect(last.atMs).toBe(20000);
		expect(last.gainDb).toBeLessThan(-20); // ends near-silent, not at nominal level
	});
});

describe('assertLoudnessWithinTolerance', () => {
	function measurement(overrides: Partial<LoudnessMeasurement>): LoudnessMeasurement {
		return { integratedLufs: TARGET_LUFS, truePeakDbtp: TARGET_TRUE_PEAK_DBTP, lra: 4, ...overrides };
	}

	it('does not throw for a measurement at the target', () => {
		expect(() => assertLoudnessWithinTolerance(measurement({}))).not.toThrow();
	});

	it('throws, naming measured and target values, when far too loud', () => {
		expect(() => assertLoudnessWithinTolerance(measurement({ integratedLufs: -6 }))).toThrow(
			new RegExp(`-6.*${TARGET_LUFS}`)
		);
	});

	it('throws when far too quiet', () => {
		expect(() => assertLoudnessWithinTolerance(measurement({ integratedLufs: -30 }))).toThrow(
			new RegExp(`-30.*${TARGET_LUFS}`)
		);
	});

	it('throws when true peak exceeds target beyond tolerance', () => {
		expect(() => assertLoudnessWithinTolerance(measurement({ truePeakDbtp: 2 }))).toThrow(
			new RegExp(`2.*${TARGET_TRUE_PEAK_DBTP}`)
		);
	});
});
