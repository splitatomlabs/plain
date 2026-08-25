/**
 * T19: shared pool-file shape + write-decision logic for the social premise
 * pools (content/social/premises/{wall,question,objection,still}.json).
 *
 * THE BUG THIS FIXES: the T11 smoke run hit retired model IDs, all 30
 * requests errored, and `score-premises.ts` nonetheless wrote `[]` to every
 * pool file. `loadFormatPools` (./schedule.ts) falls back to the mechanical
 * gates only when a pool file is ABSENT — a present-but-empty file was
 * treated as a real, empty pool, and the next `generate-schedule` run died
 * with "pools exhausted". This module is the single place that decides
 * whether a scoring run's results are safe to write, so both
 * `score-premises.ts` (the writer) and `schedule.ts`'s `loadFormatPools`
 * (the reader) share one definition of what "the pool file is usable" means.
 *
 * Two on-disk shapes are supported, forever:
 *  - LEGACY: a bare JSON array of scored entries (every pool written before
 *    this task, and every pool `schedule.test.ts` hand-writes for its own
 *    fixtures).
 *  - CURRENT: `{ meta: PoolMeta, entries: T[] }` — an envelope recording
 *    whether the run that produced this file was complete, partial (some
 *    requests dropped), and/or capped by `--limit`, so a truncated or
 *    capped pool can never be mistaken for a full one just by looking at
 *    the file on disk.
 *
 * `parsePoolFile` is the single reader both `schedule.ts`'s
 * `loadFormatPools` and `writePoolFile`'s own `--limit` overwrite guard use,
 * so the two shapes are recognized identically everywhere a pool file is
 * read. `writePoolFile` is the single writer `score-premises.ts` calls for
 * every format (including the gate-only Still pool) — it owns the fs I/O,
 * the zero-successes refusal, the partial-run warning, and the `--limit`
 * overwrite guard, and is directly unit-testable (real fs, tmp dirs, no
 * network) without spinning up the CLI script or the Batch API.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// Shapes
// ---------------------------------------------------------------------------

export interface PoolMeta {
  /** Requests submitted for this run (or, for a gate-only format like Still, gate survivors processed). */
  submitted: number;
  /** Requests that produced a scored entry admitted to `entries`. */
  succeeded: number;
  /** `submitted - succeeded` — requests that errored, failed to parse, or were dropped by a downstream check (faithfulness, etc). Reasons are logged separately (content/pipeline/social/premises.log), not repeated here. */
  dropped: number;
  /** Whether `--limit` was in effect for this run — a capped run must never be mistaken for a full one. */
  limited: boolean;
  /** ISO timestamp of when this file was written. */
  generated_at: string;
}

export interface PoolFile<T> {
  meta: PoolMeta;
  entries: T[];
}

function isPoolFileEnvelope(value: unknown): value is { meta?: unknown; entries: unknown[] } {
  return (
    !!value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Array.isArray((value as { entries?: unknown }).entries)
  );
}

/**
 * Reads either on-disk shape uniformly. Legacy plain arrays get `meta:
 * null` — there is no run history to report for a pool written before this
 * task. Throws on anything that's neither shape (e.g. a bare object with no
 * `entries` array), rather than silently returning an empty pool.
 */
export function parsePoolFile<T>(raw: unknown): { meta: PoolMeta | null; entries: T[] } {
  if (Array.isArray(raw)) return { meta: null, entries: raw as T[] };
  if (isPoolFileEnvelope(raw)) return { meta: (raw.meta as PoolMeta | undefined) ?? null, entries: raw.entries as T[] };
  throw new Error(
    "parsePoolFile: unrecognized pool file shape — expected a JSON array (legacy) or { meta, entries } (current).",
  );
}

// ---------------------------------------------------------------------------
// Run classification + write decision. Pure, no fs, no process.exit — the
// part of this module that's cheapest to unit-test exhaustively.
// ---------------------------------------------------------------------------

export interface RunCounts {
  submitted: number;
  succeeded: number;
}

export type RunOutcome = "empty-gate" | "zero" | "partial" | "full";

/**
 * Classifies a scoring run.
 * - "empty-gate": nothing was even submitted (the mechanical gate found no
 *   survivors) — not a failure, nothing errored.
 * - "zero": at least one request was submitted and NONE succeeded — the
 *   actual T19 bug shape (all 30 requests errored against a retired model).
 * - "partial": some succeeded, some didn't.
 * - "full": every submitted request succeeded.
 */
export function classifyRun(counts: RunCounts): RunOutcome {
  if (counts.submitted === 0) return "empty-gate";
  if (counts.succeeded === 0) return "zero";
  if (counts.succeeded < counts.submitted) return "partial";
  return "full";
}

export function buildPoolMeta(counts: RunCounts, limited: boolean, generatedAt: string): PoolMeta {
  return {
    submitted: counts.submitted,
    succeeded: counts.succeeded,
    dropped: counts.submitted - counts.succeeded,
    limited,
    generated_at: generatedAt,
  };
}

export interface PoolWriteDecision {
  write: boolean;
  /** Non-zero iff the caller should refuse to write AND fail the whole run loudly. */
  exitCode: 0 | 1;
  error?: string;
  warning?: string;
}

/**
 * The T19 core decision: never write a pool file from a run that produced
 * no scored entries; warn loudly (but still write — a deliberate `--limit`
 * run is a legitimate workflow) on a partial run.
 */
export function decidePoolWrite(format: string, counts: RunCounts): PoolWriteDecision {
  const outcome = classifyRun(counts);

  switch (outcome) {
    case "empty-gate":
      // Nothing was submitted — not a failure, just nothing to write.
      return { write: false, exitCode: 0 };
    case "zero":
      return {
        write: false,
        exitCode: 1,
        error:
          `${format}: zero of ${counts.submitted} submitted request(s) produced a scored entry — refusing to ` +
          `write a pool file. Any existing ${format}.json is left untouched. See ` +
          `content/pipeline/social/premises.log for the failure reasons.`,
      };
    case "partial": {
      const dropped = counts.submitted - counts.succeeded;
      return {
        write: true,
        exitCode: 0,
        warning:
          `*** ${format}: PARTIAL run — ${counts.succeeded}/${counts.submitted} requests succeeded, ${dropped} ` +
          `dropped. This pool file is INCOMPLETE. See content/pipeline/social/premises.log for drop reasons. ***`,
      };
    }
    case "full":
      return { write: true, exitCode: 0 };
  }
}

// ---------------------------------------------------------------------------
// The writer. Owns all fs I/O for a pool file — the only place
// score-premises.ts should ever open/write one.
// ---------------------------------------------------------------------------

export interface WritePoolFileOptions<T> {
  outputDir: string;
  /** Pool name, e.g. "wall" — the file written is `<outputDir>/<name>.json`. */
  name: string;
  entries: T[];
  counts: RunCounts;
  /** Whether `--limit` was in effect for this run. */
  limited: boolean;
  /** Mirrors `generate-schedule.ts`/`review-week.ts`'s own `--force` convention. */
  force?: boolean;
  /** Injectable clock, for deterministic tests. Defaults to the real time. */
  now?: () => string;
}

export interface WritePoolFileResult {
  wrote: boolean;
  filePath: string;
  warning?: string;
}

/**
 * Writes (or deliberately skips writing) one pool file, per
 * `decidePoolWrite`'s decision.
 *
 * - Zero successes: throws (never writes; any existing file is left
 *   completely untouched — this function returns before opening the file
 *   for either read or write in that branch).
 * - Empty gate (nothing submitted): returns `{ wrote: false }`, no throw,
 *   no file touched.
 * - Partial: writes the envelope shape with `meta` recording the shortfall,
 *   and both prints (`console.warn`) and returns the warning, so a caller
 *   can't accidentally swallow it.
 * - `--limit` overwrite guard: if this run was limited AND an existing pool
 *   file already has MORE entries than this run produced, refuses to
 *   overwrite it (throws) unless `force` is set — mirrors
 *   `generate-schedule.ts`/`review-week.ts`'s own `--force` convention, so a
 *   `--limit 10` smoke run can never silently shrink a real full pool.
 */
export async function writePoolFile<T>(opts: WritePoolFileOptions<T>): Promise<WritePoolFileResult> {
  const { outputDir, name, entries, counts, limited, force = false, now = () => new Date().toISOString() } = opts;
  const filePath = path.join(outputDir, `${name}.json`);

  const decision = decidePoolWrite(name, counts);
  if (decision.warning) console.warn(`\n${decision.warning}\n`);

  if (!decision.write) {
    if (decision.exitCode !== 0) {
      throw new Error(decision.error!);
    }
    return { wrote: false, filePath };
  }

  if (limited && existsSync(filePath) && !force) {
    const existingRaw = JSON.parse(await readFile(filePath, "utf-8"));
    const { entries: existingEntries } = parsePoolFile<unknown>(existingRaw);
    if (existingEntries.length > entries.length) {
      throw new Error(
        `${name}: refusing to overwrite existing ${filePath} (${existingEntries.length} entries) with a ` +
          `--limit run producing only ${entries.length} entries — pass --force to overwrite anyway.`,
      );
    }
  }

  const meta = buildPoolMeta(counts, limited, now());
  const payload: PoolFile<T> = { meta, entries };

  await mkdir(outputDir, { recursive: true });
  await writeFile(filePath, JSON.stringify(payload, null, 2) + "\n", "utf-8");

  return { wrote: true, filePath, warning: decision.warning };
}
