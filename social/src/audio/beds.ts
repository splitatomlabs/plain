/**
 * Loader for the six committed ambient music beds (T11).
 *
 * The beds themselves live in `social/assets/music/` and were generated
 * once, manually, by `social/scripts/generate-beds.ts` — see
 * `social/assets/music/README.md` for provenance. This module never
 * generates audio; it only describes and selects the already-committed
 * files.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Directory containing the committed bed audio files. */
export const MUSIC_DIR = path.resolve(__dirname, "..", "..", "assets", "music");

export interface BedInfo {
  /** Stable identifier, also the file stem (e.g. "bed-01-c-major9"). */
  id: string;
  /** Filename within MUSIC_DIR. */
  file: string;
  /** Root note, e.g. "C". */
  root: string;
  /** Chord quality, e.g. "major9". */
  quality: string;
  /** Amplitude LFO rate in Hz. */
  lfoRateHz: number;
  /** Amplitude LFO period in seconds (1 / lfoRateHz). */
  lfoPeriodSec: number;
  /** Bed duration in seconds. Always 60. */
  durationSec: number;
}

// Canonical order. This order IS the round-robin selection cycle used by
// `selectBed` below, so its exact sequence matters (see that function's
// doc comment) — it is not just a display order.
const BEDS: readonly BedInfo[] = [
  { id: "bed-01-c-major9", file: "bed-01-c-major9.flac", root: "C", quality: "major9", lfoRateHz: 2 / 60, lfoPeriodSec: 30, durationSec: 60 },
  { id: "bed-02-d-minor9", file: "bed-02-d-minor9.flac", root: "D", quality: "minor9", lfoRateHz: 3 / 60, lfoPeriodSec: 20, durationSec: 60 },
  { id: "bed-03-e-minor7", file: "bed-03-e-minor7.flac", root: "E", quality: "minor7", lfoRateHz: 4 / 60, lfoPeriodSec: 15, durationSec: 60 },
  { id: "bed-04-f-major7", file: "bed-04-f-major7.flac", root: "F", quality: "major7", lfoRateHz: 6 / 60, lfoPeriodSec: 10, durationSec: 60 },
  { id: "bed-05-g-sus4", file: "bed-05-g-sus4.flac", root: "G", quality: "sus4", lfoRateHz: 1 / 60, lfoPeriodSec: 60, durationSec: 60 },
  { id: "bed-06-a-minor", file: "bed-06-a-minor.flac", root: "A", quality: "minor", lfoRateHz: 8 / 60, lfoPeriodSec: 7.5, durationSec: 60 },
];

/** All committed beds, in canonical order. */
export function listBeds(): BedInfo[] {
  return BEDS.slice();
}

/** Absolute path to a bed's audio file, given its `id`. Throws on an unknown id. */
export function bedPath(id: string): string {
  const bed = BEDS.find((b) => b.id === id);
  if (!bed) {
    throw new Error(`Unknown bed id "${id}". Known ids: ${BEDS.map((b) => b.id).join(", ")}`);
  }
  return path.join(MUSIC_DIR, bed.file);
}

/**
 * A seed for `selectBed`: either a sequential slot index (0, 1, 2, ... —
 * one per scheduled post, in posting order) or an ISO calendar date
 * ("YYYY-MM-DD"). Both are inherently sequential/incrementing by
 * construction, which `selectBed` relies on to guarantee no immediate
 * repeat (see below).
 */
export type BedSeed = number | string;

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Deterministically converts a seed into a linear integer slot index. */
function slotIndex(seed: BedSeed): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed)) {
      throw new Error(`Invalid numeric bed seed: ${seed}`);
    }
    return Math.trunc(seed);
  }
  const match = ISO_DATE_RE.exec(seed);
  if (!match) {
    throw new Error(`Invalid bed seed "${seed}" — expected a number or an ISO date "YYYY-MM-DD".`);
  }
  const [, y, m, d] = match;
  // Date.UTC, not Date.now() — deterministic given the string, no wall-clock reliance.
  const ms = Date.UTC(Number(y), Number(m) - 1, Number(d));
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid calendar date in bed seed "${seed}".`);
  }
  // Days since the Unix epoch. Consecutive calendar dates always differ by
  // exactly 1, which is what makes the round-robin guarantee below hold.
  return Math.floor(ms / 86_400_000);
}

/**
 * Deterministically selects a bed for a given `seed`.
 *
 * - Same seed always returns the same bed (pure function of `seed`, no
 *   `Math.random()`, no `Date.now()`).
 * - Consecutive integer slot indices (or consecutive calendar dates) never
 *   select the same bed: selection is a fixed round-robin cycle through
 *   `listBeds()`'s canonical order, i.e. `beds[slotIndex(seed) mod N]`.
 *   Because a round-robin cycles through N>1 distinct entries in a fixed
 *   order, adjacent slots (n and n+1) always land on different entries —
 *   this holds for every pair of consecutive integers, not just typical
 *   ones, so it holds across an arbitrarily long run of scheduled posts,
 *   not merely "most weeks."
 */
export function selectBed(seed: BedSeed): BedInfo {
  const beds = listBeds();
  const idx = ((slotIndex(seed) % beds.length) + beds.length) % beds.length;
  return beds[idx];
}
