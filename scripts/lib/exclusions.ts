/**
 * F05/F06: reads the renderer-published exclusion list
 * (`content/social/render-exclusions.json`, written by
 * `social/scripts/write-exclusions.ts`) so `./schedule.ts` never schedules a
 * card the renderer's own gate (`social/src/remotion/wall-gate.ts`) would
 * reject at render time.
 *
 * Pf39c2-social-pilot-02a D01 deleted Question, Objection and Still
 * outright; D02 deleted the read-through. The channel is one Wall a day,
 * drawn from the Wall pool, nothing else — so this file's shape narrows to
 * the one section that still matters: `wall`. The committed
 * `render-exclusions.json` may still carry old `question`/`objection`/
 * `read_through`/`still` sections until a future regeneration drops them
 * (D04) — this reader simply ignores whatever extra sections a stale file
 * still has; only `wall` is read.
 *
 * Deliberately does NOT import anything from `social/` — the root pipeline
 * (`scripts/`) and `social/` are separate npm packages, and the whole point
 * of this module is to read the committed JSON ARTIFACT the renderer
 * publishes rather than share code across that boundary. See
 * `social/scripts/write-exclusions.ts` for the writer this file's shape
 * must match.
 *
 * The file is entirely OPTIONAL: a checkout that has never run the writer
 * (or an intentionally stale/removed file) has no exclusions to apply, and
 * `loadExclusions` reports that with `null` rather than throwing —
 * `./schedule.ts`'s `loadWallPool` treats `null` as "run the pool ungated,
 * exactly as before F05/F06", never as an error.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** One rejected card, as `social/scripts/write-exclusions.ts` records it. */
export interface ExclusionEntry {
  card_id: string;
  book_slug: string;
  /** Which axis of the Wall renderer gate rejected this card (e.g. `gateWallCard`'s `"legibility" | "duration" | "landingLine"`). */
  axis: string;
  /** Human-readable reason, verbatim from the gate's own result. */
  reason: string;
}

export interface ExclusionsCounts {
  /** Total entries surveyed for this section. */
  submitted: number;
  /** Entries that passed the renderer's gate. */
  succeeded: number;
  /** Entries the gate rejected — `entries.length` for this section. */
  dropped: number;
}

export interface ExclusionsMeta {
  /** Caller-supplied `--date`, never `Date.now()` — see `write-exclusions.ts`. */
  generated_at: string;
  /** `duration-bounds.ts`'s `MAX_POST_DURATION_FRAMES` at generation time. */
  max_post_duration_frames: number;
  /** `duration-bounds.ts`'s `MAX_POST_DURATION_SECONDS` at generation time. */
  max_post_duration_seconds: number;
  wall: ExclusionsCounts;
  [key: string]: unknown;
}

export interface ExclusionsFile {
  meta: ExclusionsMeta;
  wall: ExclusionEntry[];
  [key: string]: unknown;
}

export interface LoadedExclusions {
  wall: Set<string>;
}

function toSet(entries: unknown, filePath: string, section: string): Set<string> {
  if (!Array.isArray(entries)) {
    throw new Error(
      `loadExclusions: unrecognized shape at "${filePath}" — expected a "${section}" array, as written by ` +
        `social/scripts/write-exclusions.ts.`,
    );
  }
  return new Set((entries as ExclusionEntry[]).map((e) => e.card_id));
}

/**
 * Reads `filePath` and returns the Wall pool's excluded card-id set, or
 * `null` when the file doesn't exist. Throws on a present-but-unrecognized
 * shape (a truncated or hand-edited file should fail loudly, not silently
 * run ungated).
 */
export async function loadExclusions(filePath: string): Promise<LoadedExclusions | null> {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `loadExclusions: unrecognized shape at "${filePath}" — expected { meta, wall } as written by ` +
        `social/scripts/write-exclusions.ts.`,
    );
  }
  const file = raw as Partial<ExclusionsFile>;
  return {
    wall: toSet(file.wall, filePath, "wall"),
  };
}
