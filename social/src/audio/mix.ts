/**
 * The mixer (T15): trims/loops a music bed to length, ducks it under
 * narration with a SCRIPTED, DETERMINISTIC volume envelope (never
 * `sidechaincompress` — the plan requires the bed's level to be a pure
 * function of the narration's known time spans, not signal-dependent),
 * mixes bed + narration, then applies ffmpeg's `loudnorm` in the TWO-PASS
 * workflow the plan specifies: pass 1 measures with `print_format=json`,
 * pass 2 applies the measured `measured_I`/`measured_LRA`/`measured_TP`/
 * `measured_thresh`/`offset` from pass 1. A single-pass `loudnorm` is a
 * different (and worse) algorithm and is deliberately not used here.
 *
 * Nothing in this module reads `Math.random()` or `Date.now()` — same
 * inputs always produce the same envelope and the same ffmpeg argv.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Named constants
// ---------------------------------------------------------------------------

/**
 * CAVEAT (carried over from the plan itself, `plans/Pf39c2-social-pilot-02.md`
 * T15): -14 LUFS integrated / -1 dBTP is an INDUSTRY-STANDARD figure that
 * several platforms (Spotify, YouTube, Apple) converge on for normalized
 * loudness — it is NOT a confirmed spec for TikTok/Reels/Shorts, which
 * either don't publish one or re-normalize on ingest anyway. These are
 * named constants specifically so that a confirmed platform figure can
 * replace them in one place later.
 */
export const TARGET_LUFS = -14;

/** See TARGET_LUFS caveat above — same industry-standard-not-confirmed-spec status. */
export const TARGET_TRUE_PEAK_DBTP = -1;

/**
 * Loudness Range target (LU). 11 is ffmpeg's own `loudnorm` default and
 * sits in the middle of common streaming guidance (EBU R128 suggests
 * program-dependent values; most short-form platform guidance either
 * doesn't specify LRA or repeats the EBU default) — used here because nothing
 * about a narrated, music-bedded 15-60s vertical video calls for a wider or
 * narrower range than that default.
 */
export const TARGET_LRA = 11;

/** Verification tolerance, in LU, around TARGET_LUFS (see assertLoudnessWithinTolerance). */
export const LOUDNESS_TOLERANCE_LU = 1;

/** How far the bed drops under narration, in dB. */
export const BED_DUCK_DB = -12;

/** Time for the bed to fall from its nominal level to BED_DUCK_DB once narration starts. */
export const DUCK_ATTACK_MS = 250;

/** Time for the bed to climb back to its nominal level once narration ends. */
export const DUCK_RELEASE_MS = 600;

/**
 * social pilot 02a T15 ("THE CUT MUST BE AUDIBLE"): the ramp used whenever
 * the bed transitions INTO a silent span (e.g. The Wall's cut frame, where
 * the scroll ends and the landing line's silent hold begins) — a hard stop,
 * not a scripted duck. Not exactly 0ms: two `VolumePoint`s at the identical
 * `atMs` would make `buildVolumeExpr`'s per-segment `t1-t0` denominator zero,
 * and a genuinely instantaneous amplitude discontinuity produces an audible
 * click (a broadband transient) rather than a clean cut. 5ms is roughly a
 * sixth of a single video frame (33.3ms at 30fps — see `FPS` in
 * `wall-timing.ts`) and well under the ~10ms a human ear needs to perceive an
 * amplitude change as a "fade" rather than a cut, so it reads, sounds, and
 * measures as instantaneous while staying numerically well-defined.
 */
export const HARD_STOP_RAMP_MS = 5;

/** Fade-in length at the very head of the bed, so it never starts abruptly. */
export const BED_HEAD_FADE_MS = 1500;

/** Fade-out length at the very tail of the bed, so it never stops abruptly. */
export const BED_TAIL_FADE_MS = 1500;

/**
 * social pilot 02a U04 ("noisy scroll bed, then silence, then a slow
 * return"): the ramp the bed uses to climb back to NOMINAL after being held
 * at its floor across a `noiseSpans` window (The Wall's SCROLL phase) plus
 * whatever `silentSpans` immediately follows it (The Wall's 0.5s true
 * silence). Deliberately much slower than `DUCK_RELEASE_MS` (600ms): that
 * constant times the bed's return from an ordinary spoken line ending, but
 * this return follows a genuinely jarring noise-then-silence "drop" — the
 * user's own instruction was to fade the soothing bed back in "slowly
 * enough to be near-inaudible" until the landing line ends, not to snap
 * back to full volume the way ducking normally does. Only used when
 * `MixInput.noiseSpans` is non-empty (see `mix()`) — an ordinary
 * `silentSpans`-only caller (The Question/Objection never pass one; nothing
 * today does) keeps the fast `DUCK_RELEASE_MS` return.
 */
export const BED_RETURN_FADE_MS = 2500;

// ---------------------------------------------------------------------------
// Procedural noise (social pilot 02a U04, retimbred U08) — the dense,
// unreadable bed substitute under The Wall's SCROLL phase. Generated
// entirely by ffmpeg filters, never a committed asset: every seed below is a
// FIXED constant (never `Date.now()`/`Math.random()`/the post index the way
// `chooseBed` varies the music bed), so the whole filtergraph produces
// byte-identical samples on every render of every post — required by the
// same "pure function of its inputs, reproducible renders" rule as
// `bedEnvelope` itself.
//
// U08 (user, 2026-08-27): "The noise over the wall should sound like people
// talking." U04's single band-limited pink-noise source read as a hiss, not
// a crowd. This is the standard "babble-modulated noise" construction used
// in hearing research to build an unintelligible crowd murmur: several
// INDEPENDENT noise layers, each given (1) an LTAS-ish spectral tilt via
// pink noise's own 1/f rolloff, (2) vowel-like colour via three formant-ish
// bandpass resonances, and (3) amplitude modulation at a syllabic rate
// (3-6Hz) — summed, the layers' differing rates/phases/formant placements
// keep any one of them from popping out rhythmically, and the result fuses
// into a murmur. No layer is (or could be mistaken for) real speech — see
// `NOISE_LAYERS`' own doc comment.
// ---------------------------------------------------------------------------

/**
 * Pink (1/f), not white: white noise band-limited the same way still reads
 * as a harsh, fatiguing hiss, which is the opposite of what this phase asks
 * for ("dense/unreadable"/"a murmur" but never "painful" — the whole point
 * of the surrounding silence-then-slow-fade is sensory kindness). Pink
 * noise's energy already falls off with frequency, which is also most of
 * the LTAS-ish spectral tilt babble-shaped noise needs (see `NOISE_FORMANTS`
 * for the rest) — real speech's long-term average spectrum peaks in the
 * low-mids and rolls off above ~1kHz, and pink noise starts from that same
 * shape rather than fighting it.
 */
const NOISE_COLOR = 'pink';

/**
 * Roughly the standard multi-talker "babble" count used in hearing-research
 * generators (commonly 4-8 simultaneous simulated talkers): few enough
 * layers and individual voices pop out as a rhythmic pulse rather than
 * fusing; this many, differing in modulation rate, formant placement and
 * underlying noise seed, reads as one indistinct room rather than any one
 * "talker."
 */
const NOISE_LAYER_COUNT = 6;

/**
 * One synthetic "talker" per layer: an independent noise seed (so each
 * layer's fine structure is uncorrelated with the others), a distinct
 * syllabic-rate amplitude-modulation frequency (spread across the 3-6Hz
 * range real speech's syllable rate falls in — see `tremolo`'s `f` in
 * `renderNoiseTrack`), and a slight formant-frequency scale (so no two
 * layers colour identically, the way no two real voices share an exact
 * vocal-tract length). Deliberately not derived from a formula at runtime —
 * a literal, fixed table keeps the construction inspectable and exactly
 * reproducible without relying on floating-point arithmetic done the same
 * way on every machine.
 */
const NOISE_LAYERS: ReadonlyArray<{ seedOffset: number; tremoloHz: number; formantScale: number }> = [
	{ seedOffset: 0, tremoloHz: 3.1, formantScale: 0.92 },
	{ seedOffset: 7919, tremoloHz: 3.7, formantScale: 0.96 },
	{ seedOffset: 15838, tremoloHz: 4.3, formantScale: 1.0 },
	{ seedOffset: 23757, tremoloHz: 4.9, formantScale: 1.04 },
	{ seedOffset: 31676, tremoloHz: 5.5, formantScale: 1.08 },
	{ seedOffset: 39595, tremoloHz: 6.0, formantScale: 1.02 }
];

/**
 * `anoisesrc`'s own amplitude parameter for EACH of `NOISE_LAYER_COUNT`
 * layers (applied before this module's envelope/dB conversion, which only
 * ever attenuates from here; the layers are summed with `amix`'s
 * `normalize=0`, so this is chosen for the SUM, not one layer alone).
 * Chosen by measurement: at this per-layer amplitude, after formant shaping
 * and band-limiting, the six-layer sum measures (ffmpeg `volumedetect`) at
 * roughly -27dB mean / -15dB max — matching U04's original single-layer
 * pink noise (-26dB mean / -15dB max) closely enough that the downstream
 * mix/loudnorm balance this module already tuned for U04 carries over
 * unchanged; U08 is a timbre change, not a level change.
 */
const NOISE_LAYER_AMPLITUDE = 0.17;

/**
 * Three formant-ish resonances per layer (roughly the F1/F2/F3 of a neutral
 * vowel), applied via `equalizer` (a peaking EQ) at each layer's own
 * `formantScale`-adjusted frequency. Gains fall off with frequency — F1
 * boosted most, F3 attenuated slightly — which both gives the noise its
 * vowel-like colour AND reinforces the low-mid-peaking spectral tilt
 * `NOISE_COLOR`'s pink noise already leans toward; measured (see
 * `renderNoiseTrack`'s own tests) to land the six-layer sum's spectral
 * centroid in the ~1.2kHz range real running speech's LTAS centroid falls
 * in, not the 2kHz+ a naive equal-gain formant boost produces.
 */
const NOISE_FORMANTS: ReadonlyArray<{ hz: number; gainDb: number }> = [
	{ hz: 500, gainDb: 9 },
	{ hz: 1500, gainDb: 4 },
	{ hz: 2500, gainDb: -3 }
];

/** `equalizer`'s own Q (width_type=q) for every `NOISE_FORMANTS` peak — wide enough to sound like a resonance, not a whistle. */
const NOISE_FORMANT_Q = 1.4;

/**
 * `tremolo`'s own depth (0-1) — how far each layer's amplitude dips between
 * modulation peaks. Deep enough that the syllabic-rate modulation is
 * audible as "speech-like" rhythm (too shallow and the layers just sound
 * like steady noise with no babble character); not full depth (1.0), which
 * would gate each layer fully silent between peaks and sound choppy/gated
 * rather than murmuring.
 */
const NOISE_TREMOLO_DEPTH = 0.6;

/**
 * Below this, low end (including any of `NOISE_FORMANTS`' own energy)
 * reads as an oppressive sub-bass drone rather than a room of talking —
 * the sensory-kindness constraint this whole change exists to honour, U08
 * exactly as much as U04.
 */
const NOISE_HIGHPASS_HZ = 150;

/**
 * Applied TWICE per layer (see `renderNoiseTrack`) for a steeper rolloff
 * than a single `lowpass` stage — a single stage still left enough
 * high-frequency content in from the underlying pink noise (even after
 * `NOISE_FORMANTS`' own tilt) to pull the measured spectral centroid above
 * 2kHz; two stages in series pushed it down to ~1.2kHz (see
 * `NOISE_FORMANTS`' own doc comment) without needing a lower, more
 * muffled-sounding single cutoff. Above this, remaining content reads as a
 * piercing hiss rather than textured murmur — the same sensory-kindness
 * constraint `NOISE_HIGHPASS_HZ` protects at the other end.
 */
const NOISE_LOWPASS_HZ = 3000;

/**
 * Fixed, never derived from the post's date/slot/index — every Wall render
 * gets the exact same noise texture (each layer's own seed is this plus
 * `NOISE_LAYERS[i].seedOffset`). The bed varies per post
 * (`cli-plan.ts`'s `chooseBed`, seeded by post index) because the bed is a
 * chosen piece of music; the noise is not "content" in that sense, it is a
 * fixed sonic effect standing in for "the text is too dense to read, and
 * there is a room of talk behind it," so there is no reason for it to vary
 * and every reason (byte-comparable, reproducible renders) not to.
 */
const NOISE_SEED = 20260826;

/** The bed's nominal (un-ducked, un-muted) level, in dB relative to its own native level. */
const BED_NOMINAL_DB = 0;

/**
 * Effectively silent, in dB relative to native level. Not -Infinity: a
 * finite floor keeps every gain a well-defined, interpolable linear number
 * (10**(FLOOR/20) > 0) so the ffmpeg envelope expression never divides by
 * zero or multiplies by a non-finite value.
 */
const SILENCE_FLOOR_DB = -60;

/**
 * social pilot 02a T15: `volume=eval=frame` re-evaluates its expression once
 * per audio FRAME as received from upstream, not once per sample — and
 * without forcing a small frame size, that upstream frame size is whatever
 * the decoder happens to hand off (measured against `bed-05-g-sus4.flac`:
 * ~90-100ms FLAC blocks). A transition landing mid-frame is held at the
 * PREVIOUS frame's stale gain for the rest of that frame, so
 * `HARD_STOP_RAMP_MS` (or any ramp shorter than the upstream frame size) is
 * silently ineffective — measured directly: without this, the bed's hard
 * stop at the Wall's cut frame (2.5s) didn't actually land until ~2.6s, a
 * full 100ms late. `asetnsamples=n=<this>` inserted immediately before every
 * `volume=eval=frame` filter forces small, fixed-size frames so gain changes
 * land within a couple of milliseconds of their scripted `atMs` — well under
 * HARD_STOP_RAMP_MS. 128 samples is ~2.7ms at SAMPLE_RATE.
 */
const VOLUME_ENVELOPE_FRAME_SAMPLES = 128;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One point of a piecewise-linear (in dB) volume automation curve. */
export interface VolumePoint {
	atMs: number;
	gainDb: number;
}

/** A time span, in milliseconds, relative to the start of the mix. */
export interface TimeSpan {
	startMs: number;
	endMs: number;
}

export interface LoudnessMeasurement {
	integratedLufs: number;
	truePeakDbtp: number;
	lra: number;
}

export interface MixInput {
	/** Absolute path to a committed bed (see `beds.ts`). */
	bedPath: string;
	/** Absolute path to narration audio. Omit for a music-only mix. */
	narrationPath?: string;
	/** Total output duration, in milliseconds. */
	durationMs: number;
	/** Narration's known time spans (line-level or whole-clip) — drives ducking. */
	narrationSpans: TimeSpan[];
	/**
	 * Spans that must be silent in the OUTPUT — bed included. Real case
	 * (social pilot 02a U04): The Wall's 0.5s of TRUE silence, right after
	 * the cut frame — see `cli.ts`'s `wallSilentSpans`. Narrower than it used
	 * to be (it once covered the whole 3s landing-line hold); the rest of
	 * that hold is now `noiseSpans`' hard cut followed by the bed's own slow
	 * return, not silence.
	 */
	silentSpans?: TimeSpan[];
	/**
	 * Spans where dense, unreadable NOISE plays INSTEAD of the bed — the bed
	 * is held at its floor for the union of this and `silentSpans`, then
	 * returns via the slower `BED_RETURN_FADE_MS` ramp rather than the
	 * ordinary `DUCK_RELEASE_MS` used for a narration duck (see
	 * `bedEnvelope`'s doc comment). Real case (social pilot 02a U04): The
	 * Wall's SCROLL phase (`cli.ts`'s `wallNoiseSpans`) — "replace the
	 * soothing bed under the SCROLL with dense, unreadable noise matching the
	 * visual." Procedurally generated from a FIXED seed (`renderNoiseTrack`),
	 * never a committed asset and never randomized. Omit (or pass `[]`) for
	 * every format that has no such phase — today, everything except The
	 * Wall.
	 */
	noiseSpans?: TimeSpan[];
	outPath: string;
}

export interface MixResult {
	outPath: string;
	durationMs: number;
	measured: LoudnessMeasurement;
}

// ---------------------------------------------------------------------------
// bedEnvelope — the scripted, deterministic ducking envelope
// ---------------------------------------------------------------------------

type Level = 'NOMINAL' | 'DUCK' | 'FLOOR';

function levelDb(level: Level): number {
	switch (level) {
		case 'NOMINAL':
			return BED_NOMINAL_DB;
		case 'DUCK':
			return BED_DUCK_DB;
		case 'FLOOR':
			return SILENCE_FLOOR_DB;
	}
}

interface Interval {
	start: number;
	end: number;
	level: Level;
}

/** Clips spans to [0, durationMs] and drops any that are empty or invalid after clipping. */
function clipSpans(spans: TimeSpan[], durationMs: number): TimeSpan[] {
	return spans
		.map((s) => ({ startMs: Math.max(0, s.startMs), endMs: Math.min(durationMs, s.endMs) }))
		.filter((s) => s.endMs > s.startMs);
}

function coversMs(spans: TimeSpan[], atMs: number): boolean {
	return spans.some((s) => atMs >= s.startMs && atMs < s.endMs);
}

/**
 * Splits [0, durationMs] into intervals of constant level. `silentSpans`
 * take priority over `narrationSpans` wherever they overlap — silence
 * always wins, per the plan's "silence means silence, the bed included."
 */
function buildLevelIntervals(durationMs: number, narrationSpans: TimeSpan[], silentSpans: TimeSpan[]): Interval[] {
	const narration = clipSpans(narrationSpans, durationMs);
	const silence = clipSpans(silentSpans, durationMs);

	const breakpoints = new Set<number>([0, durationMs]);
	for (const s of [...narration, ...silence]) {
		breakpoints.add(s.startMs);
		breakpoints.add(s.endMs);
	}
	const sorted = Array.from(breakpoints).sort((a, b) => a - b);

	const raw: Interval[] = [];
	for (let i = 0; i < sorted.length - 1; i++) {
		const start = sorted[i];
		const end = sorted[i + 1];
		if (end <= start) continue;
		const mid = (start + end) / 2;
		const level: Level = coversMs(silence, mid) ? 'FLOOR' : coversMs(narration, mid) ? 'DUCK' : 'NOMINAL';
		raw.push({ start, end, level });
	}
	if (raw.length === 0) {
		return [{ start: 0, end: durationMs, level: 'NOMINAL' }];
	}

	// Merge adjacent intervals of the same level.
	const merged: Interval[] = [raw[0]];
	for (let i = 1; i < raw.length; i++) {
		const prev = merged[merged.length - 1];
		const cur = raw[i];
		if (cur.level === prev.level) {
			prev.end = cur.end;
		} else {
			merged.push({ ...cur });
		}
	}
	return merged;
}

/**
 * Turns level intervals into ramp points, using DUCK_ATTACK_MS/
 * DUCK_RELEASE_MS at every transition EXCEPT one: entering a silent span
 * (`cur.level === 'FLOOR'`) uses HARD_STOP_RAMP_MS instead. Per T15 ("THE
 * CUT MUST BE AUDIBLE"), silence must always arrive abruptly — "the beat of
 * silence IS the drop" — never as a scripted duck-style fade, which is what
 * made the previous full-clip silent span read as an absence rather than an
 * event. Leaving FLOOR normally uses the ordinary DUCK_RELEASE_MS ramp
 * (only the entry into silence is a hard stop, not the return from it) —
 * `floorReleaseMs` overrides that one ramp length, for the one caller (U04's
 * `bedEnvelope` after a `noiseSpans` window) that needs a slower, more
 * deliberate return than an ordinary narration duck's release.
 */
function intervalsToPoints(intervals: Interval[], floorReleaseMs: number = DUCK_RELEASE_MS): VolumePoint[] {
	const points: VolumePoint[] = [{ atMs: intervals[0].start, gainDb: levelDb(intervals[0].level) }];
	for (let i = 1; i < intervals.length; i++) {
		const prev = intervals[i - 1];
		const cur = intervals[i];
		if (cur.level === prev.level) continue;
		const goingDown = levelDb(cur.level) < levelDb(prev.level);
		const rawRampMs =
			cur.level === 'FLOOR' ? HARD_STOP_RAMP_MS : goingDown ? DUCK_ATTACK_MS : prev.level === 'FLOOR' ? floorReleaseMs : DUCK_RELEASE_MS;
		const rampMs = Math.min(rawRampMs, cur.end - cur.start);
		points.push({ atMs: cur.start, gainDb: levelDb(prev.level) });
		points.push({ atMs: cur.start + rampMs, gainDb: levelDb(cur.level) });
	}
	const last = intervals[intervals.length - 1];
	points.push({ atMs: last.end, gainDb: levelDb(last.level) });
	return points;
}

/** Applies a gentle fade-in/out at the head/tail, but only where the bed opens/closes at NOMINAL level. */
function applyHeadTailFade(points: VolumePoint[], durationMs: number): VolumePoint[] {
	const out = points.slice();

	const first = out[0];
	if (first.gainDb === BED_NOMINAL_DB) {
		const nextT = out.length > 1 ? out[1].atMs : durationMs;
		const fadeMs = Math.min(BED_HEAD_FADE_MS, nextT - first.atMs);
		if (fadeMs > 0) {
			out[0] = { atMs: 0, gainDb: SILENCE_FLOOR_DB };
			out.splice(1, 0, { atMs: fadeMs, gainDb: BED_NOMINAL_DB });
		}
	}

	const last = out[out.length - 1];
	if (last.gainDb === BED_NOMINAL_DB) {
		const prevT = out.length > 1 ? out[out.length - 2].atMs : 0;
		const fadeMs = Math.min(BED_TAIL_FADE_MS, last.atMs - prevT);
		if (fadeMs > 0) {
			out[out.length - 1] = { atMs: durationMs, gainDb: SILENCE_FLOOR_DB };
			out.splice(out.length - 1, 0, { atMs: durationMs - fadeMs, gainDb: BED_NOMINAL_DB });
		}
	}

	return out;
}

/**
 * The scripted, deterministic bed ducking envelope. Pure function of its
 * inputs (no randomness, no wall-clock) — same `durationMs`/`narrationSpans`/
 * `silentSpans`/`floorReleaseMs` always produce byte-identical output.
 *
 * `silentSpans` is optional and additional to the plan's documented
 * `bedEnvelope(durationMs, narrationSpans)` signature — `mix()` needs it to
 * honour "silence means silence, the bed included" (see `MixInput.silentSpans`).
 *
 * `floorReleaseMs` (social pilot 02a U04) overrides the ramp used the ONE
 * time the bed leaves its floor after this envelope's LAST silent interval —
 * see `intervalsToPoints`'s own doc comment and `BED_RETURN_FADE_MS`. `mix()`
 * passes `silentSpans` here as the UNION of `MixInput.silentSpans` and
 * `MixInput.noiseSpans` (the bed is silent for both: true silence and the
 * noise-replaces-the-bed SCROLL phase), so this same mechanism produces the
 * Wall's whole "noise, then true silence, then a slow fade back in" shape
 * without `bedEnvelope` needing to know noise exists at all.
 */
export function bedEnvelope(
	durationMs: number,
	narrationSpans: TimeSpan[],
	silentSpans: TimeSpan[] = [],
	floorReleaseMs: number = DUCK_RELEASE_MS
): VolumePoint[] {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`bedEnvelope: durationMs must be a positive finite number, got ${durationMs}`);
	}
	const intervals = buildLevelIntervals(durationMs, narrationSpans, silentSpans);
	const points = intervalsToPoints(intervals, floorReleaseMs);
	return applyHeadTailFade(points, durationMs);
}

/**
 * The narration-side counterpart to `bedEnvelope`: full level everywhere
 * except `silentSpans`, which duck to SILENCE_FLOOR_DB using the same
 * attack/release timing. No head/tail fade — narration should play at its
 * authored level except where the caller explicitly asked for silence.
 */
function narrationEnvelope(durationMs: number, silentSpans: TimeSpan[]): VolumePoint[] {
	const intervals = buildLevelIntervals(durationMs, [], silentSpans);
	return intervalsToPoints(intervals);
}

/**
 * social pilot 02a U04: the noise track's own envelope — full level (0dB,
 * i.e. `anoisesrc`'s own `NOISE_AMPLITUDE` unchanged) during each of
 * `noiseSpans`, `SILENCE_FLOOR_DB` everywhere else, with a `HARD_STOP_RAMP_MS`
 * transition on BOTH edges of every span. Symmetric with `bedEnvelope`'s own
 * hard-stop-into-silence reasoning: an instantaneous 0-to-full (or full-to-0)
 * gain jump on a continuous noise waveform is itself a broadband transient —
 * an audible click — so both the "noise switches on" and "noise cuts to
 * silence" edges get the same well-defined, near-instant (but not
 * `Math.min`-by-zero) ramp `HARD_STOP_RAMP_MS` already uses for the bed's own
 * cut. Never used for anything the sensory-kindness constraint would call
 * "gentle" — this phase is deliberately abrupt on both ends, matching the
 * visual scroll starting/stopping on a frame boundary rather than easing in.
 *
 * Pure function of its inputs, like `bedEnvelope`/`narrationEnvelope` — no
 * randomness, no wall-clock; the noise SIGNAL itself is made deterministic
 * separately, by `renderNoiseTrack`'s fixed `NOISE_SEED`.
 */
function noiseEnvelope(durationMs: number, noiseSpans: TimeSpan[]): VolumePoint[] {
	const spans = clipSpans(noiseSpans, durationMs).sort((a, b) => a.startMs - b.startMs);
	if (spans.length === 0) {
		return [
			{ atMs: 0, gainDb: SILENCE_FLOOR_DB },
			{ atMs: durationMs, gainDb: SILENCE_FLOOR_DB }
		];
	}

	const points: VolumePoint[] = [{ atMs: 0, gainDb: SILENCE_FLOOR_DB }];
	for (const span of spans) {
		const onRampEnd = Math.min(span.endMs, span.startMs + HARD_STOP_RAMP_MS);
		const offRampEnd = Math.min(durationMs, span.endMs + HARD_STOP_RAMP_MS);
		points.push({ atMs: span.startMs, gainDb: SILENCE_FLOOR_DB });
		points.push({ atMs: onRampEnd, gainDb: BED_NOMINAL_DB });
		points.push({ atMs: span.endMs, gainDb: BED_NOMINAL_DB });
		points.push({ atMs: offRampEnd, gainDb: SILENCE_FLOOR_DB });
	}
	points.push({ atMs: durationMs, gainDb: SILENCE_FLOOR_DB });
	return points;
}

// ---------------------------------------------------------------------------
// ffmpeg expression building
// ---------------------------------------------------------------------------

function dbToLinear(db: number): number {
	return Math.pow(10, db / 20);
}

function fmtNum(n: number): string {
	return n.toFixed(8);
}

/** De-duplicates same-timestamp points (keeping the later one) and sorts ascending. */
function normalizePoints(points: VolumePoint[]): VolumePoint[] {
	const sorted = points.slice().sort((a, b) => a.atMs - b.atMs);
	const out: VolumePoint[] = [];
	for (const p of sorted) {
		if (out.length > 0 && out[out.length - 1].atMs === p.atMs) {
			out[out.length - 1] = p;
		} else {
			out.push(p);
		}
	}
	return out;
}

/**
 * Builds an ffmpeg `volume` filter expression (`eval=frame`) implementing
 * piecewise-linear interpolation between `points`, in linear amplitude
 * (dB->linear conversion happens here in JS, never inside the ffmpeg
 * expression). `t` is ffmpeg's per-frame timestamp in seconds.
 */
function buildVolumeExpr(points: VolumePoint[]): string {
	const pts = normalizePoints(points);
	if (pts.length === 0) {
		return fmtNum(1);
	}
	if (pts.length === 1) {
		return fmtNum(dbToLinear(pts[0].gainDb));
	}

	let expr = fmtNum(dbToLinear(pts[pts.length - 1].gainDb));
	for (let i = pts.length - 2; i >= 0; i--) {
		const t0 = pts[i].atMs / 1000;
		const t1 = pts[i + 1].atMs / 1000;
		const v0 = dbToLinear(pts[i].gainDb);
		const v1 = dbToLinear(pts[i + 1].gainDb);
		const lerp = `(${fmtNum(v0)}+(${fmtNum(v1)}-${fmtNum(v0)})*(t-${fmtNum(t0)})/${fmtNum(t1 - t0)})`;
		expr = `if(lt(t,${fmtNum(t1)}),${lerp},${expr})`;
	}
	return expr;
}

// ---------------------------------------------------------------------------
// ffmpeg process helpers
// ---------------------------------------------------------------------------

const MAX_BUFFER = 32 * 1024 * 1024;

async function runFfmpeg(args: string[]): Promise<{ stdout: string; stderr: string }> {
	try {
		return await execFileAsync('ffmpeg', args, { maxBuffer: MAX_BUFFER });
	} catch (error) {
		const err = error as { stderr?: string; message?: string };
		throw new Error(`ffmpeg failed: ${err.stderr ?? err.message ?? String(error)}`);
	}
}

async function ffprobeDurationMs(filePath: string): Promise<number> {
	const { stdout } = await execFileAsync('ffprobe', [
		'-v',
		'error',
		'-show_entries',
		'format=duration',
		'-of',
		'default=nw=1:nk=1',
		filePath
	]);
	return Number(stdout.trim()) * 1000;
}

interface LoudnormPass1 {
	input_i: string;
	input_tp: string;
	input_lra: string;
	input_thresh: string;
	target_offset: string;
}

function parseLoudnormJson(stderr: string): LoudnormPass1 {
	const matches = stderr.match(/\{[^{}]*\}/g);
	if (!matches || matches.length === 0) {
		throw new Error(`Could not find loudnorm JSON in ffmpeg output:\n${stderr}`);
	}
	return JSON.parse(matches[matches.length - 1]) as LoudnormPass1;
}

function loudnormAnalysisArgs(filePath: string): string[] {
	return [
		'-y',
		'-i',
		filePath,
		'-af',
		`loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DBTP}:LRA=${TARGET_LRA}:print_format=json`,
		'-f',
		'null',
		'-'
	];
}

/** Measures a file's integrated loudness, true peak, and loudness range via ffmpeg's `loudnorm` analysis pass. */
export async function measureLoudness(filePath: string): Promise<LoudnessMeasurement> {
	const { stderr } = await runFfmpeg(loudnormAnalysisArgs(filePath));
	const parsed = parseLoudnormJson(stderr);
	return {
		integratedLufs: Number(parsed.input_i),
		truePeakDbtp: Number(parsed.input_tp),
		lra: Number(parsed.input_lra)
	};
}

/**
 * Throws if `measured` is not within LOUDNESS_TOLERANCE_LU of TARGET_LUFS,
 * or if its true peak exceeds TARGET_TRUE_PEAK_DBTP by more than
 * LOUDNESS_TOLERANCE_LU. Names the measured and target values in the error.
 */
export function assertLoudnessWithinTolerance(measured: LoudnessMeasurement): void {
	const lufsDelta = Math.abs(measured.integratedLufs - TARGET_LUFS);
	if (lufsDelta > LOUDNESS_TOLERANCE_LU) {
		throw new Error(
			`Measured integrated loudness ${measured.integratedLufs} LUFS is outside tolerance ` +
				`(target ${TARGET_LUFS} LUFS +-${LOUDNESS_TOLERANCE_LU} LU, delta ${lufsDelta.toFixed(2)} LU).`
		);
	}
	const peakOvershoot = measured.truePeakDbtp - TARGET_TRUE_PEAK_DBTP;
	if (peakOvershoot > LOUDNESS_TOLERANCE_LU) {
		throw new Error(
			`Measured true peak ${measured.truePeakDbtp} dBTP exceeds target ` +
				`${TARGET_TRUE_PEAK_DBTP} dBTP by ${peakOvershoot.toFixed(2)} dB ` +
				`(tolerance ${LOUDNESS_TOLERANCE_LU} LU).`
		);
	}
}

// ---------------------------------------------------------------------------
// mix
// ---------------------------------------------------------------------------

const SAMPLE_RATE = 48000;
const CHANNELS = 2;

async function renderBedTrack(bedPath: string, durationSec: number, envelope: VolumePoint[], outPath: string): Promise<void> {
	const expr = buildVolumeExpr(envelope);
	await runFfmpeg([
		'-y',
		'-stream_loop',
		'-1',
		'-i',
		bedPath,
		'-t',
		String(durationSec),
		'-af',
		`asetnsamples=n=${VOLUME_ENVELOPE_FRAME_SAMPLES},volume=eval=frame:volume='${expr}',` +
			`aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
		'-ar',
		String(SAMPLE_RATE),
		'-ac',
		String(CHANNELS),
		'-c:a',
		'pcm_s16le',
		outPath
	]);
}

async function renderNarrationTrack(
	narrationPath: string | undefined,
	durationSec: number,
	envelope: VolumePoint[],
	outPath: string
): Promise<void> {
	const expr = buildVolumeExpr(envelope);
	if (narrationPath) {
		await runFfmpeg([
			'-y',
			'-i',
			narrationPath,
			'-af',
			// apad guarantees enough tail to cover the full duration if narration is shorter than the mix.
			`apad,atrim=end=${durationSec},asetpts=PTS-STARTPTS,asetnsamples=n=${VOLUME_ENVELOPE_FRAME_SAMPLES},` +
				`volume=eval=frame:volume='${expr}',aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
			'-t',
			String(durationSec),
			'-ar',
			String(SAMPLE_RATE),
			'-ac',
			String(CHANNELS),
			'-c:a',
			'pcm_s16le',
			outPath
		]);
	} else {
		await runFfmpeg([
			'-y',
			'-f',
			'lavfi',
			'-i',
			`anullsrc=r=${SAMPLE_RATE}:cl=stereo`,
			'-t',
			String(durationSec),
			'-ar',
			String(SAMPLE_RATE),
			'-ac',
			String(CHANNELS),
			'-c:a',
			'pcm_s16le',
			outPath
		]);
	}
}

/**
 * social pilot 02a U04, retimbred U08: the noise track's own signal — now a
 * babble-modulated-noise construction (see the "Procedural noise" section
 * comment above), built ENTIRELY from `anoisesrc` SOURCE filters (no input
 * file — needs no `bedPath`-style asset) so the whole thing is still
 * generated, never a committed asset. One `anoisesrc` input per
 * `NOISE_LAYERS` entry, each shaped independently — three `NOISE_FORMANTS`
 * peaking-EQ bumps for vowel-like colour, a `tremolo` at that layer's own
 * syllabic rate for amplitude modulation, then band-limited
 * (`NOISE_HIGHPASS_HZ`/twice-cascaded `NOISE_LOWPASS_HZ`) — then summed with
 * `amix` (`normalize=0`: `NOISE_LAYER_AMPLITUDE` is already chosen for the
 * SUM, see its own doc comment). `d=${durationSec}` on every layer asks for
 * exactly the mix's own duration directly, so — unlike `renderBedTrack`,
 * which loops a shorter asset and then truncates with `-t` — there is no
 * separate trim step anywhere in this chain.
 *
 * The overall on/off gating (this phase's `noiseEnvelope`) is applied ONCE,
 * to the summed babble signal, via the same `asetnsamples` + `volume=eval=
 * frame` pairing `renderBedTrack`/`renderNarrationTrack` use, for the same
 * reason (`VOLUME_ENVELOPE_FRAME_SAMPLES`'s doc comment) — this track's own
 * hard cut at the end of each `noiseSpans` entry needs to land within a
 * couple of milliseconds of its scripted time, exactly like the bed's old
 * hard stop did. Applying it after the sum (rather than per-layer) is both
 * simpler and behaviourally identical: gating a sum of already-gated
 * identical-envelope signals is the same as gating the sum once.
 */
async function renderNoiseTrack(durationSec: number, envelope: VolumePoint[], outPath: string): Promise<void> {
	const expr = buildVolumeExpr(envelope);
	const lowpassChain = `lowpass=f=${NOISE_LOWPASS_HZ},lowpass=f=${NOISE_LOWPASS_HZ}`;
	const formantChain = NOISE_FORMANTS.map(
		(formant) => (layerScale: number) => `equalizer=f=${(formant.hz * layerScale).toFixed(1)}:t=q:w=${NOISE_FORMANT_Q}:g=${formant.gainDb}`
	);

	const inputArgs = NOISE_LAYERS.flatMap((layer) => [
		'-f',
		'lavfi',
		'-i',
		`anoisesrc=d=${durationSec}:c=${NOISE_COLOR}:r=${SAMPLE_RATE}:a=${NOISE_LAYER_AMPLITUDE}:s=${NOISE_SEED + layer.seedOffset}`
	]);

	const layerFilters = NOISE_LAYERS.map((layer, i) => {
		const formants = formantChain.map((build) => build(layer.formantScale)).join(',');
		return `[${i}:a]${formants},tremolo=f=${layer.tremoloHz}:d=${NOISE_TREMOLO_DEPTH},highpass=f=${NOISE_HIGHPASS_HZ},${lowpassChain}[babble${i}]`;
	});
	const layerLabels = NOISE_LAYERS.map((_, i) => `[babble${i}]`).join('');
	const sumFilter = `${layerLabels}amix=inputs=${NOISE_LAYERS.length}:duration=first:dropout_transition=0:normalize=0[babble]`;
	const gateFilter =
		`[babble]asetnsamples=n=${VOLUME_ENVELOPE_FRAME_SAMPLES},volume=eval=frame:volume='${expr}',` +
		`aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[out]`;

	await runFfmpeg([
		'-y',
		...inputArgs,
		'-filter_complex',
		[...layerFilters, sumFilter, gateFilter].join(';'),
		'-map',
		'[out]',
		'-ar',
		String(SAMPLE_RATE),
		'-ac',
		String(CHANNELS),
		'-c:a',
		'pcm_s16le',
		outPath
	]);
}

/**
 * Mixes an arbitrary number of same-format (48kHz stereo pcm_s16le) tracks
 * down to one. `duration=first` matches every existing caller's own tracks,
 * which are all rendered to the mix's exact `durationMs` already (via `-t`,
 * `atrim`, or `anoisesrc`'s own `d=`) — "first" is therefore never actually
 * doing any trimming/padding in practice, just naming which input ffmpeg's
 * `amix` should defer to if that ever stopped being true.
 */
async function mixTracks(trackPaths: string[], outPath: string): Promise<void> {
	const inputArgs = trackPaths.flatMap((trackPath) => ['-i', trackPath]);
	const inputLabels = trackPaths.map((_, index) => `[${index}:a]`).join('');
	await runFfmpeg([
		'-y',
		...inputArgs,
		'-filter_complex',
		`${inputLabels}amix=inputs=${trackPaths.length}:duration=first:dropout_transition=0:normalize=0[mixed]`,
		'-map',
		'[mixed]',
		'-ar',
		String(SAMPLE_RATE),
		'-ac',
		String(CHANNELS),
		'-c:a',
		'pcm_s16le',
		outPath
	]);
}

/**
 * Thrown by `mix()` when ffmpeg's first `loudnorm` pass measures a mix as
 * digital silence (a non-finite `measured_I`/`measured_TP`/`measured_thresh`
 * — ffmpeg's EBU R128 gating drops any track whose integrated loudness
 * falls below its absolute silence threshold, reporting `-inf` rather than
 * a real number). A silent mix is always a bug worth stopping on — see F02,
 * `plans/Pf39c2-social-pilot-02.md` — so `mix()` never substitutes a
 * default measurement and continues; it fails loudly here, before pass 2
 * ever hands `-inf` to ffmpeg's `measured_I` option (which fails on its own,
 * but with an opaque "Result too large" parse error rather than an
 * explanation).
 */
export class SilentMixError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'SilentMixError';
	}
}

/** True for any value ffmpeg's loudnorm JSON can report that isn't a finite number (`"-inf"`, `"nan"`, etc). */
function isNonFiniteMeasurement(value: string): boolean {
	return !Number.isFinite(Number(value));
}

async function applyTwoPassLoudnormAndEncode(
	mixedPath: string,
	durationSec: number,
	outPath: string,
	bedPath: string
): Promise<LoudnessMeasurement> {
	// Pass 1: measure.
	const { stderr } = await runFfmpeg(loudnormAnalysisArgs(mixedPath));
	const pass1 = parseLoudnormJson(stderr);

	if (
		isNonFiniteMeasurement(pass1.input_i) ||
		isNonFiniteMeasurement(pass1.input_tp) ||
		isNonFiniteMeasurement(pass1.input_thresh)
	) {
		throw new SilentMixError(
			`mix: the mix of bed "${path.basename(bedPath)}" over ${durationSec.toFixed(1)}s measured as digital ` +
				`silence on ffmpeg's first loudnorm pass (measured_I=${pass1.input_i}, measured_TP=${pass1.input_tp}, ` +
				`measured_thresh=${pass1.input_thresh}). This is not a measurement glitch — the mixed audio really is ` +
				`silent or effectively silent (e.g. a bed held at its silent floor for the whole duration with no ` +
				`audible narration). Refusing to encode a silent post rather than substituting a default loudness value.`
		);
	}

	// Pass 2: apply the pass-1 measurement, then encode to 48kHz stereo AAC.
	const loudnormFilter =
		`loudnorm=I=${TARGET_LUFS}:TP=${TARGET_TRUE_PEAK_DBTP}:LRA=${TARGET_LRA}:` +
		`measured_I=${pass1.input_i}:measured_TP=${pass1.input_tp}:measured_LRA=${pass1.input_lra}:` +
		`measured_thresh=${pass1.input_thresh}:offset=${pass1.target_offset}:print_format=summary`;

	await runFfmpeg([
		'-y',
		'-i',
		mixedPath,
		'-af',
		loudnormFilter,
		'-t',
		String(durationSec),
		'-ar',
		String(SAMPLE_RATE),
		'-ac',
		String(CHANNELS),
		'-c:a',
		'aac',
		'-b:a',
		'192k',
		outPath
	]);

	return measureLoudness(outPath);
}

/**
 * Trims/loops `input.bedPath` to `input.durationMs`, ducks it under
 * narration with the scripted `bedEnvelope`, mixes with narration (and,
 * when `input.noiseSpans` is non-empty — social pilot 02a U04 — a third
 * procedurally-generated noise track standing in for the bed during those
 * spans), and runs the two-pass `loudnorm` workflow to encode a 48kHz stereo
 * AAC file at `input.outPath`.
 */
export async function mix(input: MixInput): Promise<MixResult> {
	const { bedPath, narrationPath, durationMs, narrationSpans, outPath } = input;
	const silentSpans = input.silentSpans ?? [];
	const noiseSpans = input.noiseSpans ?? [];

	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`mix: durationMs must be a positive finite number, got ${durationMs}`);
	}
	const durationSec = durationMs / 1000;

	const workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-mix-'));
	try {
		const bedTrackPath = path.join(workDir, 'bed.wav');
		const narrationTrackPath = path.join(workDir, 'narration.wav');
		const mixedPath = path.join(workDir, 'mixed.wav');

		// The bed is silent for the UNION of the true-silence spans and the
		// noise-replaces-the-bed spans — see `bedEnvelope`'s and
		// `MixInput.noiseSpans`' own doc comments. It returns via the slower
		// `BED_RETURN_FADE_MS` specifically when a `noiseSpans` window
		// preceded it (an ordinary `silentSpans`-only caller keeps the fast
		// `DUCK_RELEASE_MS` narration-duck release).
		const bedFloorSpans = [...silentSpans, ...noiseSpans];
		const bedReturnRampMs = noiseSpans.length > 0 ? BED_RETURN_FADE_MS : DUCK_RELEASE_MS;

		const bedEnv = bedEnvelope(durationMs, narrationSpans, bedFloorSpans, bedReturnRampMs);
		// Narration stays silenced across both true silence AND the noise
		// phase (today's Wall never narrates during either, since rest-line
		// narration starts after the landing line ends — see `cli.ts`'s
		// `narrationPlan` — but this keeps the contract "narration is silent
		// wherever the bed is silenced for a scripted reason" true even if
		// that ever changed).
		const narrEnv = narrationEnvelope(durationMs, [...silentSpans, ...noiseSpans]);

		await renderBedTrack(bedPath, durationSec, bedEnv, bedTrackPath);
		await renderNarrationTrack(narrationPath, durationSec, narrEnv, narrationTrackPath);

		const trackPaths = [bedTrackPath, narrationTrackPath];
		if (noiseSpans.length > 0) {
			const noiseTrackPath = path.join(workDir, 'noise.wav');
			const noiseEnv = noiseEnvelope(durationMs, noiseSpans);
			await renderNoiseTrack(durationSec, noiseEnv, noiseTrackPath);
			trackPaths.push(noiseTrackPath);
		}
		await mixTracks(trackPaths, mixedPath);

		const measured = await applyTwoPassLoudnormAndEncode(mixedPath, durationSec, outPath, bedPath);
		const outDurationMs = await ffprobeDurationMs(outPath);

		return { outPath, durationMs: outDurationMs, measured };
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
