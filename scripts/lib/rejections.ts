/**
 * The committed record of cards REJECTED ON CONTENT GROUNDS, so a card
 * judged unusable once is never drawn again.
 *
 * WHY THIS EXISTS, concretely: commit ee25b4f (#46) pulled
 * `on-anger-02-054` from week 1 day 2 — its landing line, "A boy was raised
 * in Plato's household.", is the opening of an anecdote, not a payoff, and
 * says nothing on screen by itself. That swap edited `pilot-schedule-w01.json`
 * only. `loadPriorWeeks` derives later weeks' exclusion sets from what the
 * schedules CONTAIN, so removing the card from week 1 also removed it from
 * the "already used" set — and the week 2 draw handed back the exact card
 * that had just been rejected. A rejection that lives only in a schedule
 * diff is not a rejection; it is a one-week deferral.
 *
 * DISTINCT FROM `render-exclusions.json`, deliberately, and not merged into
 * it: that file is RENDERER-DERIVED (`social/scripts/write-exclusions.ts`
 * regenerates it wholesale from the Wall renderer's own gate — legibility,
 * duration, landing-line bounds) and is a statement that a card CANNOT BE
 * RENDERED. This file is HAND-MAINTAINED and is a statement that a card
 * renders fine but must not be POSTED. Writing these entries into
 * `render-exclusions.json` would both misstate the reason and lose them the
 * next time the writer regenerates it.
 *
 * Deliberately has no writer CLI. Entries are added by hand, in a commit,
 * with a reason — that review is the point, and a tool that appended rows
 * would only make it easy to skip. `reason` is therefore REQUIRED and
 * validated: an id with no justification is not a record of anything.
 *
 * Mirrors `./exclusions.ts`'s shape and failure style on purpose (a `wall`
 * section, a `meta` block, `null` when absent, a loud throw on a
 * present-but-unrecognized file) so the two read as siblings rather than as
 * two unrelated inventions.
 */

import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { isValidDateString } from "./review.js";

/** One card rejected on content grounds — never to be scheduled again. */
export interface RejectionEntry {
  card_id: string;
  book_slug: string;
  /**
   * Why this card must never be posted. REQUIRED — see the module doc
   * comment. Written for someone reading it a year from now with no memory
   * of the session that rejected it.
   */
  reason: string;
  /**
   * `YYYY-MM-DD`, supplied by whoever made the call — never `Date.now()`,
   * matching every other date-carrying artifact in this pipeline
   * (`review-week.ts --date`, `write-exclusions.ts --date`).
   */
  rejected_on: string;
  /** The commit/PR that made the call, when there is one (e.g. `"ee25b4f (#46)"`). */
  rejected_in?: string;
  /** The card that took its slot, when it was rejected out of a real schedule. */
  replaced_by?: string;
}

export interface RejectionsFile {
  meta: { purpose: string; [key: string]: unknown };
  wall: RejectionEntry[];
  [key: string]: unknown;
}

function fail(filePath: string, detail: string): never {
  throw new Error(`loadRejections: ${detail} at "${filePath}".`);
}

/**
 * Reads `filePath` and returns the set of card ids that must never be
 * scheduled, or `null` when the file doesn't exist (a checkout that has
 * never rejected anything runs ungated — the CALLER decides whether to
 * announce that; see `generate-schedule.ts`).
 *
 * Throws on a present-but-malformed file rather than silently running
 * ungated: this list is the only thing standing between a rejected card and
 * a redraw, so a truncated or hand-mangled file must fail loudly.
 */
export async function loadRejections(filePath: string): Promise<Set<string> | null> {
  if (!existsSync(filePath)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(filePath, "utf-8"));
  } catch (e) {
    fail(filePath, `unparseable JSON (${(e as Error).message})`);
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    fail(filePath, 'unrecognized shape — expected an object with a "wall" array');
  }

  const entries = (raw as Partial<RejectionsFile>).wall;
  if (!Array.isArray(entries)) {
    fail(filePath, 'unrecognized shape — expected a "wall" array');
  }

  const ids = new Set<string>();
  entries.forEach((entry, i) => {
    const where = `entry ${i}`;
    if (!entry || typeof entry !== "object") fail(filePath, `${where} is not an object`);

    const { card_id, reason, rejected_on } = entry as Partial<RejectionEntry>;

    if (typeof card_id !== "string" || card_id.trim() === "") {
      fail(filePath, `${where} has no card_id`);
    }
    // A rejection with no stated reason is an id nobody can audit later —
    // the record's whole value is the justification, not the id.
    if (typeof reason !== "string" || reason.trim() === "") {
      fail(filePath, `${where} ("${card_id}") has no reason — every rejection must say why`);
    }
    if (typeof rejected_on !== "string" || !isValidDateString(rejected_on)) {
      fail(filePath, `${where} ("${card_id}") has an invalid rejected_on ("${rejected_on}") — expected YYYY-MM-DD`);
    }
    // Two rows for one card means two different stated reasons for the same
    // decision — an unresolved record, not a harmless duplicate.
    if (ids.has(card_id)) {
      fail(filePath, `"${card_id}" is listed twice`);
    }

    ids.add(card_id);
  });

  return ids;
}

/**
 * Throws if any rejected card id isn't in the corpus at all — a typo'd id
 * silently protects nothing, which is the one failure this whole file
 * exists to prevent, and it would never surface on its own (the card it was
 * meant to block would simply get drawn one day).
 */
export function assertRejectionsResolve(rejected: ReadonlySet<string>, corpusCardIds: ReadonlySet<string>): void {
  const unknown = [...rejected].filter((id) => !corpusCardIds.has(id)).sort();
  if (unknown.length > 0) {
    throw new Error(
      `Rejected card id${unknown.length === 1 ? "" : "s"} not found in the corpus: ${unknown.join(", ")}. ` +
        `A rejected id that matches no card blocks nothing — fix the spelling, or drop the entry if the card is gone.`,
    );
  }
}
