import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// T23: persist the raw response whenever a premises rubric response fails
// to parse, so a parse failure is diagnosable instead of silently dropped.
// Before this, `submitAndCollect` (./premises-batch.ts) threw the raw text
// away and logged only the parse error message — which is why T20's fix was
// a code-review inference rather than a confirmed diagnosis, and why the
// failures recurred (22/1,003 in the Wall run, 6/89 in the Question
// re-score). Capturing `stop_reason` here is the whole point: it settles,
// definitively, whether a drop was caused by `max_tokens` truncation
// (`stop_reason === "max_tokens"`) or by `extractJSON` genuinely failing on
// a complete response (`stop_reason === "end_turn"`).
//
// Written under content/pipeline/ alongside the rest of this run's own
// artifacts (premises.log lives right next to this directory), but — unlike
// content/pipeline/<book>/{parse,refine,translate}.json, which are
// deliberately committed intermediates — these captures are excluded from
// git (see .gitignore: content/pipeline/social/parse-failures/) because a
// raw failing response is debugging exhaust, not a build artifact anyone
// downstream depends on.
// ---------------------------------------------------------------------------

export const PARSE_FAILURE_DIR = path.join(
  process.cwd(),
  "content",
  "pipeline",
  "social",
  "parse-failures",
);

export interface ParseFailureRecord {
  custom_id: string;
  /** Which rubric this request belonged to — "wall" | "question" | "objection". */
  format: string;
  /** The message thrown by the format-specific parser (e.g. parseQuestionRubricResponse). */
  error: string;
  /**
   * The Anthropic message's own `stop_reason` — the actual diagnostic this
   * task exists to capture. `"max_tokens"` means the response was cut off
   * (truncation); `"end_turn"` means the model finished normally and
   * `extractJSON`/the parser genuinely couldn't make sense of a complete
   * response. `null` covers batch result shapes where the field is absent.
   */
  stop_reason: string | null;
  /** `message.usage.output_tokens` for this response — compare against `max_tokens` to sanity-check truncation. */
  output_tokens: number;
  /** The full, untouched response text that failed to parse. */
  raw_text: string;
}

/** custom_ids are already filesystem-safe (see `safeCustomId` in ./claude.ts) but this is defensive. */
function safeFileName(customId: string): string {
  return customId.replace(/[^a-zA-Z0-9_.-]/g, "_");
}

/**
 * Writes one parse-failure capture to `content/pipeline/social/parse-failures/<custom_id>.json`.
 * Overwrites any previous capture for the same `custom_id` (a re-run
 * shouldn't accumulate stale captures from an earlier attempt).
 */
export async function recordParseFailure(record: ParseFailureRecord): Promise<string> {
  await mkdir(PARSE_FAILURE_DIR, { recursive: true });
  const filePath = path.join(PARSE_FAILURE_DIR, `${safeFileName(record.custom_id)}.json`);
  await writeFile(filePath, JSON.stringify(record, null, 2) + "\n", "utf-8");
  return filePath;
}
