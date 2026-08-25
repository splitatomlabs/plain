/**
 * F05/F06: reads the renderer-published exclusion list
 * (`content/social/render-exclusions.json`, written by
 * `social/scripts/write-exclusions.ts`) so `./schedule.ts` never schedules
 * a card the renderer's own gates (`social/src/remotion/wall-gate.ts`,
 * `question-gate.ts`, `objection-gate.ts`) would reject at render time.
 *
 * F05 covered The Wall only. F06 extends the file to all three formats
 * (`wall`/`question`/`objection`, one array each, consulted by
 * `loadFormatPools` to filter each format's own pool) plus a fourth section
 * — `read_through` — the renderer's verdict on every card of the
 * read-through's own book/chapter slice, surveyed with the read-through's
 * OWN landing-line derivation (not a scored Wall pool entry's
 * `rubric.chosen_landing_line`, which can compute a different result — see
 * `write-exclusions.ts`'s doc comment). `./schedule.ts`'s read-through
 * branch (`tryReadThroughContent`) consults `read_through` instead of
 * `wall`, since the Wall pool structurally can't cover every read-through
 * card (a read-through card is excluded from the weighted pools entirely —
 * see `generateWeek`'s own `readThroughCardIds` filtering).
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
 * `./schedule.ts`'s `loadFormatPools` treats `null` as "run every format
 * ungated, exactly as before F05/F06", never as an error.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

/** One rejected card, as `social/scripts/write-exclusions.ts` records it. */
export interface ExclusionEntry {
  card_id: string;
  book_slug: string;
  /** Which axis of the format's renderer gate rejected this card (e.g. `gateWallCard`'s `"legibility" | "duration"`). */
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
  /** `wall-gate.ts`'s `WALL_MIN_LEGIBLE_FONT_PX` at generation time. */
  wall_min_legible_font_px: number;
  /** `question-gate.ts`'s `QUESTION_MIN_LEGIBLE_FONT_PX` at generation time. */
  question_min_legible_font_px: number;
  /** `question-gate.ts`'s `QUESTION_MAX_WORDS` at generation time. */
  question_max_words: number;
  /** `objection-gate.ts`'s `OBJECTION_MIN_LEGIBLE_FONT_PX` at generation time. */
  objection_min_legible_font_px: number;
  /** The read-through book surveyed for the `read_through` section. */
  read_through_book: string;
  /** The read-through chapter slice surveyed (empty array = the whole book). */
  read_through_chapters: string[];
  wall: ExclusionsCounts;
  question: ExclusionsCounts;
  objection: ExclusionsCounts;
  read_through: ExclusionsCounts;
}

export interface ExclusionsFile {
  meta: ExclusionsMeta;
  wall: ExclusionEntry[];
  question: ExclusionEntry[];
  objection: ExclusionEntry[];
  read_through: ExclusionEntry[];
}

export interface LoadedExclusions {
  wall: Set<string>;
  question: Set<string>;
  objection: Set<string>;
  readThrough: Set<string>;
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
 * Reads `filePath` and returns each format's excluded card-id set plus the
 * read-through slice's, or `null` when the file doesn't exist. Throws on a
 * present-but-unrecognized shape (a truncated or hand-edited file should
 * fail loudly, not silently run ungated).
 */
export async function loadExclusions(filePath: string): Promise<LoadedExclusions | null> {
  if (!existsSync(filePath)) return null;
  const raw = JSON.parse(await readFile(filePath, "utf-8")) as unknown;
  if (!raw || typeof raw !== "object") {
    throw new Error(
      `loadExclusions: unrecognized shape at "${filePath}" — expected { meta, wall, question, objection, ` +
        `read_through } as written by social/scripts/write-exclusions.ts.`,
    );
  }
  const file = raw as Partial<ExclusionsFile>;
  return {
    wall: toSet(file.wall, filePath, "wall"),
    question: toSet(file.question, filePath, "question"),
    objection: toSet(file.objection, filePath, "objection"),
    readThrough: toSet(file.read_through, filePath, "read_through"),
  };
}
