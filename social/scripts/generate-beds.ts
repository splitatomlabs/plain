/**
 * Generate the six ambient music beds (T11), once, manually.
 *
 * This is the ONE-OFF generation path. The daily render job must never call
 * this script — it reads the already-committed files in
 * `social/assets/music/` via `social/src/audio/beds.ts` instead.
 *
 * No generative-audio service is reachable from this environment, so the
 * beds are synthesized deterministically with ffmpeg: layered sine partials
 * forming a chord, a slow amplitude LFO ("breathing"), a gentle lowpass, and
 * a little stereo width from panning the partials differently per channel.
 *
 * Seamless looping: every partial frequency and every LFO rate is quantized
 * to an exact multiple of 1/60 Hz, so the underlying waveform mathematically
 * repeats every 60.0s (sin(2*pi*f*(t+60)) === sin(2*pi*f*t) whenever f*60 is
 * an integer). The lowpass filter is stateful, so naively rendering exactly
 * 60s from a cold filter start would NOT loop cleanly (the filter's startup
 * transient at t=0 doesn't match its settled state at t=60). To avoid that,
 * each bed is rendered with a 6s pre-roll (66s total), the lowpass runs
 * continuously across the whole 66s so its transient decays away (audio
 * lowpass time constants are on the order of 1/(2*pi*f_c), i.e. well under a
 * millisecond here — 6s is enormous headroom), and only the settled
 * `[6s, 66s)` window is kept. Because the pre-filter signal is exactly
 * periodic with period 60s, sample 6s and sample 66s of that signal are
 * identical, so the kept window's start and end match to the residual of an
 * effectively-zero filter transient.
 *
 * Output: FLAC (lossless, but far smaller than 16-bit WAV for this kind of
 * low-partial-count, slowly-varying material) at 48kHz stereo, 60.000s.
 *
 * Deterministic: same script + same ffmpeg version on the same machine =>
 * byte-identical output every run (no timestamps, no random seeds; output
 * metadata is stripped with -map_metadata -1 and -fflags +bitexact).
 *
 * Usage:
 *   npx tsx social/scripts/generate-beds.ts
 *   npx tsx social/scripts/generate-beds.ts --out social/assets/music
 */

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SAMPLE_RATE = 48000;
const DURATION_SEC = 60;
const PRE_ROLL_SEC = 6;
const TOTAL_SEC = DURATION_SEC + PRE_ROLL_SEC;

// Equal temperament, A4 = 440Hz. Semitone offset of each note name from A4.
const SEMITONE_FROM_A4: Record<string, number> = {
  C: -9,
  "C#": -8,
  D: -7,
  "D#": -6,
  E: -5,
  F: -4,
  "F#": -3,
  G: -2,
  "G#": -1,
  A: 0,
  "A#": 1,
  B: 2,
};

/** Equal-temperament frequency for `note` in scientific pitch octave `octave` (A4 = octave 4). */
function noteFreq(note: string, octave: number): number {
  const semitone = SEMITONE_FROM_A4[note] + 12 * (octave - 4);
  return 440 * Math.pow(2, semitone / 12);
}

/** Round `freq` to the nearest exact multiple of 1/60 Hz, so its period divides 60s exactly. */
function quantizeToLoop(freq: number): number {
  return Math.round(freq * DURATION_SEC) / DURATION_SEC;
}

interface Tone {
  note: string;
  octave: number;
  /** Base amplitude (before L/R panning). */
  amp: number;
  /** -1 (hard left) .. +1 (hard right); 0 = centered. */
  pan: number;
}

interface BedConfig {
  id: string;
  root: string;
  quality: string;
  tones: Tone[];
  /** LFO cycles per 60s loop (must be a positive integer so the LFO period divides 60s exactly). */
  lfoCycles: number;
  /** Lowpass cutoff in Hz. */
  cutoffHz: number;
  /** Final gain trim in dB, applied after mixing (headroom / consistent quiet level). */
  gainDb: number;
}

// Six beds: distinct root note, distinct chord quality, distinct LFO "breathing" rate and
// register/brightness, so they are genuinely tellable apart across a week of posts.
const BEDS: BedConfig[] = [
  {
    id: "bed-01-c-major9",
    root: "C",
    quality: "major9",
    tones: [
      { note: "C", octave: 3, amp: 0.1, pan: 0 },
      { note: "E", octave: 3, amp: 0.075, pan: -0.5 },
      { note: "G", octave: 3, amp: 0.08, pan: 0.5 },
      { note: "D", octave: 4, amp: 0.045, pan: 0.3 },
    ],
    lfoCycles: 2, // 30s breathing period
    cutoffHz: 900,
    gainDb: -2,
  },
  {
    id: "bed-02-d-minor9",
    root: "D",
    quality: "minor9",
    tones: [
      { note: "D", octave: 3, amp: 0.1, pan: 0 },
      { note: "F", octave: 3, amp: 0.075, pan: 0.5 },
      { note: "A", octave: 3, amp: 0.08, pan: -0.5 },
      { note: "E", octave: 4, amp: 0.045, pan: -0.3 },
    ],
    lfoCycles: 3, // 20s breathing period
    cutoffHz: 1100,
    gainDb: -2,
  },
  {
    id: "bed-03-e-minor7",
    root: "E",
    quality: "minor7",
    tones: [
      { note: "E", octave: 2, amp: 0.11, pan: 0 },
      { note: "G", octave: 2, amp: 0.08, pan: -0.4 },
      { note: "B", octave: 2, amp: 0.08, pan: 0.4 },
      { note: "D", octave: 3, amp: 0.045, pan: 0.25 },
    ],
    lfoCycles: 4, // 15s breathing period
    cutoffHz: 750, // darkest/warmest of the six
    gainDb: -1.5,
  },
  {
    id: "bed-04-f-major7",
    root: "F",
    quality: "major7",
    tones: [
      { note: "F", octave: 3, amp: 0.095, pan: 0 },
      { note: "A", octave: 3, amp: 0.07, pan: 0.45 },
      { note: "C", octave: 4, amp: 0.075, pan: -0.45 },
      { note: "E", octave: 4, amp: 0.04, pan: -0.25 },
    ],
    lfoCycles: 6, // 10s breathing period
    cutoffHz: 1400, // airiest of the six
    gainDb: -2.5,
  },
  {
    id: "bed-05-g-sus4",
    root: "G",
    quality: "sus4",
    tones: [
      { note: "G", octave: 3, amp: 0.1, pan: 0 },
      { note: "C", octave: 4, amp: 0.075, pan: -0.4 },
      { note: "D", octave: 4, amp: 0.075, pan: 0.4 },
      { note: "G", octave: 4, amp: 0.03, pan: 0.2 },
    ],
    lfoCycles: 1, // 60s breathing period, one slow swell per loop
    cutoffHz: 1000,
    gainDb: -2,
  },
  {
    id: "bed-06-a-minor",
    root: "A",
    quality: "minor",
    tones: [
      { note: "A", octave: 2, amp: 0.11, pan: 0 },
      { note: "C", octave: 3, amp: 0.08, pan: -0.4 },
      { note: "E", octave: 3, amp: 0.08, pan: 0.4 },
      { note: "B", octave: 3, amp: 0.035, pan: -0.2 },
    ],
    lfoCycles: 8, // 7.5s breathing period, most active of the six (still slow/calm)
    cutoffHz: 1250,
    gainDb: -1.5,
  },
];

const ENV_MIN = 0.6;
const ENV_DEPTH = 0.4;
const RIGHT_LFO_PHASE_OFFSET = 0.15 * Math.PI; // subtle stereo motion, same period

function fmt(n: number): string {
  return n.toFixed(8);
}

function envelopeExpr(lfoHz: number, phase: number): string {
  return `(${fmt(ENV_MIN)}+${fmt(ENV_DEPTH)}*(0.5+0.5*sin(2*PI*${fmt(lfoHz)}*t+${fmt(phase)})))`;
}

/** Convert a pan (-1..1) to independent left/right gain weights (equal-power-ish, simple linear here). */
function panWeights(pan: number): { left: number; right: number } {
  return { left: 1 - Math.max(0, pan), right: 1 + Math.min(0, pan) };
}

function buildExpr(bed: BedConfig, channel: "left" | "right"): string {
  const lfoHz = bed.lfoCycles / DURATION_SEC;
  const phase = channel === "right" ? RIGHT_LFO_PHASE_OFFSET : 0;
  const terms = bed.tones
    .map((tone) => {
      const freq = quantizeToLoop(noteFreq(tone.note, tone.octave));
      const { left, right } = panWeights(tone.pan);
      const weight = tone.amp * (channel === "left" ? left : right);
      return `${fmt(weight)}*sin(2*PI*${fmt(freq)}*t)`;
    })
    .join("+");
  return `(${terms})*${envelopeExpr(lfoHz, phase)}`;
}

interface RenderedBed extends BedConfig {
  file: string;
  frequencies: { note: string; octave: number; hz: number }[];
  lfoHz: number;
  lfoPeriodSec: number;
}

function render(bed: BedConfig, outDir: string): RenderedBed {
  const exprLeft = buildExpr(bed, "left");
  const exprRight = buildExpr(bed, "right");
  const file = `${bed.id}.flac`;
  const outPath = path.join(outDir, file);

  const af = [
    `lowpass=f=${bed.cutoffHz}:poles=2`,
    `atrim=start=${PRE_ROLL_SEC}:end=${TOTAL_SEC}`,
    `asetpts=PTS-STARTPTS`,
    `volume=${bed.gainDb}dB`,
    `aformat=sample_fmts=s16:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
  ].join(",");

  const args = [
    "-y",
    "-fflags",
    "+bitexact",
    "-f",
    "lavfi",
    "-i",
    `aevalsrc=exprs='${exprLeft}|${exprRight}':s=${SAMPLE_RATE}:d=${TOTAL_SEC}:c=stereo`,
    "-af",
    af,
    "-t",
    String(DURATION_SEC),
    "-ar",
    String(SAMPLE_RATE),
    "-ac",
    "2",
    "-c:a",
    "flac",
    "-compression_level",
    "8",
    "-map_metadata",
    "-1",
    "-flags:a",
    "+bitexact",
    outPath,
  ];

  execFileSync("ffmpeg", args, { stdio: "inherit" });

  const frequencies = bed.tones.map((tone) => ({
    note: tone.note,
    octave: tone.octave,
    hz: quantizeToLoop(noteFreq(tone.note, tone.octave)),
  }));

  return {
    ...bed,
    file,
    frequencies,
    lfoHz: bed.lfoCycles / DURATION_SEC,
    lfoPeriodSec: DURATION_SEC / bed.lfoCycles,
  };
}

function parseArgs(argv: string[]): { outDir: string } {
  let outDir = path.resolve(__dirname, "..", "assets", "music");
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out" && argv[i + 1]) {
      outDir = path.resolve(argv[i + 1]);
      i++;
    }
  }
  return { outDir };
}

function main(): void {
  const { outDir } = parseArgs(process.argv.slice(2));
  mkdirSync(outDir, { recursive: true });

  console.log(`Generating ${BEDS.length} beds into ${outDir}\n`);

  const results: RenderedBed[] = [];
  for (const bed of BEDS) {
    console.log(`  ${bed.id} (${bed.root} ${bed.quality}, LFO ${bed.lfoCycles}/60Hz)...`);
    results.push(render(bed, outDir));
  }

  console.log("\nDone. Frequencies used (quantized to nearest 1/60 Hz for seamless looping):\n");
  for (const bed of results) {
    console.log(`${bed.id}:`);
    for (const f of bed.frequencies) {
      console.log(`  ${f.note}${f.octave}: ${f.hz.toFixed(4)} Hz`);
    }
    console.log(`  LFO: ${bed.lfoHz.toFixed(6)} Hz (period ${bed.lfoPeriodSec}s), cutoff ${bed.cutoffHz}Hz, gain ${bed.gainDb}dB`);
  }
}

main();
