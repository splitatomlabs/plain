/**
 * F05: reads the renderer-published Wall exclusion list
 * (`content/social/wall-exclusions.json`, written by
 * `social/scripts/write-wall-exclusions.ts` from `surveyWallPool`'s
 * verdict) so `./schedule.ts` never schedules a Wall card the renderer's
 * gate (`social/src/remotion/wall-gate.ts`'s legibility floor and F03's
 * 59s duration ceiling) would reject at render time.
 *
 * Deliberately does NOT import anything from `social/` — the root pipeline
 * (`scripts/`) and `social/` are separate npm packages, and the whole point
 * of this module is to read the committed JSON ARTIFACT the renderer
 * publishes rather than share code across that boundary. See
 * `social/scripts/write-wall-exclusions.ts` for the writer this file's
 * shape must match.
 *
 * The file is entirely OPTIONAL: a checkout that has never run the writer
 * (or an intentionally stale/removed file) has no exclusions to apply, and
 * `loadWallExclusions` reports that with `null` rather than throwing —
 * `./schedule.ts`'s `loadFormatPools` treats `null` as "run ungated, exactly
 * as before F05", never as an error.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** One rejected card, as `social/scripts/write-wall-exclusions.ts` records it. */
export interface WallExclusionEntry {
  card_id: string;
  book_slug: string;
  /** Which axis of `gateWallCard` rejected this card. */
  axis: "legibility" | "duration";
  /** Human-readable reason, verbatim from `gateWallCard`'s `WallGateResult.reason`. */
  reason: string;
}

export interface WallExclusionsMeta {
  /** Total Wall pool entries surveyed. */
  submitted: number;
  /** Entries that passed the renderer's gate. */
  succeeded: number;
  /** Entries the gate rejected — `entries.length`. */
  dropped: number;
  /** Always `false` — this file is never a partial/capped run. Present for shape parity with `PoolFile`/`PoolMeta`. */
  limited: boolean;
  /** Caller-supplied `--date`, never `Date.now()` — see `write-wall-exclusions.ts`. */
  generated_at: string;
  /** `duration-bounds.ts`'s `MAX_POST_DURATION_FRAMES` at generation time. */
  max_post_duration_frames: number;
  /** `duration-bounds.ts`'s `MAX_POST_DURATION_SECONDS` at generation time. */
  max_post_duration_seconds: number;
  /** `wall-gate.ts`'s `WALL_MIN_LEGIBLE_FONT_PX` at generation time. */
  wall_min_legible_font_px: number;
}

export interface WallExclusionsFile {
  meta: WallExclusionsMeta;
  entries: WallExclusionEntry[];
}

/**
 * Reads `filePath` and returns the set of excluded card ids, or `null` when
 * the file doesn't exist. Throws on a present-but-unrecognized shape (a
 * truncated or hand-edited file should fail loudly, not silently run
 * ungated).
 */
export async function loadWallExclusions(filePath: string): Promise<Set<string> | null> {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object" || !Array.isArray((raw as { entries?: unknown }).entries)) {
    throw new Error(
      `loadWallExclusions: unrecognized shape at "${filePath}" — expected { meta, entries: [...] } as written ` +
        `by social/scripts/write-wall-exclusions.ts.`,
    );
  }
  const entries = (raw as WallExclusionsFile).entries;
  return new Set(entries.map((e) => e.card_id));
}
