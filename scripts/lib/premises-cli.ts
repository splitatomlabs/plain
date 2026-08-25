// ---------------------------------------------------------------------------
// T10: Pure, side-effect-free CLI helpers for scripts/score-premises.ts.
//
// Split out of score-premises.ts (a top-level CLI script whose module body
// parses argv and calls main() unconditionally on import, exactly like
// generate.ts) specifically so scripts/lib/__tests__/score-premises.test.ts
// can unit-test format/limit logic directly, without importing
// score-premises.ts itself — doing that would re-run its top-level argument
// parsing and `main()` against the TEST RUNNER's own process.argv/env as an
// import side effect.
// ---------------------------------------------------------------------------

export const VALID_FORMATS = ["wall", "question", "objection", "still", "all"] as const;
export type Format = (typeof VALID_FORMATS)[number];
export type ScoredFormat = Exclude<Format, "all">;

export function isValidFormat(value: string): value is Format {
  return (VALID_FORMATS as readonly string[]).includes(value);
}

/** Expands "all" to every scored/reported format; a specific format passes through as a single-element array. */
export function formatsToRun(f: Format): ScoredFormat[] {
  return f === "all" ? ["wall", "question", "objection", "still"] : [f];
}

/**
 * Parse and validate `--limit`. Returns `undefined` when no limit was
 * given (uncapped). Throws with a message naming "positive integer" when
 * the raw string isn't a positive integer — the CLI catches this and exits
 * 1 with the thrown message.
 */
export function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Invalid --limit "${raw}" — must be a positive integer.`);
  }
  return n;
}
