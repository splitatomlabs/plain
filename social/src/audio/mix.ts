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

/** Fade-in length at the very head of the bed, so it never starts abruptly. */
export const BED_HEAD_FADE_MS = 1500;

/** Fade-out length at the very tail of the bed, so it never stops abruptly. */
export const BED_TAIL_FADE_MS = 1500;

/** The bed's nominal (un-ducked, un-muted) level, in dB relative to its own native level. */
const BED_NOMINAL_DB = 0;

/**
 * Effectively silent, in dB relative to native level. Not -Infinity: a
 * finite floor keeps every gain a well-defined, interpolable linear number
 * (10**(FLOOR/20) > 0) so the ffmpeg envelope expression never divides by
 * zero or multiplies by a non-finite value.
 */
const SILENCE_FLOOR_DB = -60;

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
	 * Spans that must be silent in the OUTPUT — bed included. Real case:
	 * The Wall's silent phase, whose landing line is held in silence.
	 */
	silentSpans?: TimeSpan[];
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

/** Turns level intervals into ramp points, using DUCK_ATTACK_MS/DUCK_RELEASE_MS at every transition. */
function intervalsToPoints(intervals: Interval[]): VolumePoint[] {
	const points: VolumePoint[] = [{ atMs: intervals[0].start, gainDb: levelDb(intervals[0].level) }];
	for (let i = 1; i < intervals.length; i++) {
		const prev = intervals[i - 1];
		const cur = intervals[i];
		if (cur.level === prev.level) continue;
		const goingDown = levelDb(cur.level) < levelDb(prev.level);
		const rawRampMs = goingDown ? DUCK_ATTACK_MS : DUCK_RELEASE_MS;
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
 * `silentSpans` always produce byte-identical output.
 *
 * `silentSpans` is optional and additional to the plan's documented
 * `bedEnvelope(durationMs, narrationSpans)` signature — `mix()` needs it to
 * honour "silence means silence, the bed included" (see `MixInput.silentSpans`).
 */
export function bedEnvelope(durationMs: number, narrationSpans: TimeSpan[], silentSpans: TimeSpan[] = []): VolumePoint[] {
	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`bedEnvelope: durationMs must be a positive finite number, got ${durationMs}`);
	}
	const intervals = buildLevelIntervals(durationMs, narrationSpans, silentSpans);
	const points = intervalsToPoints(intervals);
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
		`volume=eval=frame:volume='${expr}',aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
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
			`apad,atrim=end=${durationSec},asetpts=PTS-STARTPTS,volume=eval=frame:volume='${expr}',` +
				`aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
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

async function mixTracks(bedTrackPath: string, narrationTrackPath: string, outPath: string): Promise<void> {
	await runFfmpeg([
		'-y',
		'-i',
		bedTrackPath,
		'-i',
		narrationTrackPath,
		'-filter_complex',
		'[0:a][1:a]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[mixed]',
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

async function applyTwoPassLoudnormAndEncode(mixedPath: string, durationSec: number, outPath: string): Promise<LoudnessMeasurement> {
	// Pass 1: measure.
	const { stderr } = await runFfmpeg(loudnormAnalysisArgs(mixedPath));
	const pass1 = parseLoudnormJson(stderr);

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
 * narration with the scripted `bedEnvelope`, mixes with narration, and
 * runs the two-pass `loudnorm` workflow to encode a 48kHz stereo AAC file
 * at `input.outPath`.
 */
export async function mix(input: MixInput): Promise<MixResult> {
	const { bedPath, narrationPath, durationMs, narrationSpans, outPath } = input;
	const silentSpans = input.silentSpans ?? [];

	if (!Number.isFinite(durationMs) || durationMs <= 0) {
		throw new Error(`mix: durationMs must be a positive finite number, got ${durationMs}`);
	}
	const durationSec = durationMs / 1000;

	const workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-mix-'));
	try {
		const bedTrackPath = path.join(workDir, 'bed.wav');
		const narrationTrackPath = path.join(workDir, 'narration.wav');
		const mixedPath = path.join(workDir, 'mixed.wav');

		const bedEnv = bedEnvelope(durationMs, narrationSpans, silentSpans);
		const narrEnv = narrationEnvelope(durationMs, silentSpans);

		await renderBedTrack(bedPath, durationSec, bedEnv, bedTrackPath);
		await renderNarrationTrack(narrationPath, durationSec, narrEnv, narrationTrackPath);
		await mixTracks(bedTrackPath, narrationTrackPath, mixedPath);

		const measured = await applyTwoPassLoudnormAndEncode(mixedPath, durationSec, outPath);
		const outDurationMs = await ffprobeDurationMs(outPath);

		return { outPath, durationMs: outDurationMs, measured };
	} finally {
		await rm(workDir, { recursive: true, force: true });
	}
}
