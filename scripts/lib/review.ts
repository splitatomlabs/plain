/**
 * T14: The weekly review step.
 *
 * The plan's whole cadence decision is "Schedule one week at a time. Review
 * retention, adjust hooks, then generate the next week." This module is what
 * makes that a real gate rather than a habit: it builds the dated
 * review-note TEMPLATE for a week (`buildReviewNoteTemplate`), and parses an
 * existing note back (`parseReviewNote`) so `scripts/generate-schedule.ts`
 * can refuse to generate week N+1 until week N's note exists and is
 * actually filled in.
 *
 * Pf39c2-social-pilot-02a D02: the note used to also carry the reviewer's
 * chosen NEXT WEEK wall/question/objection weights, carried forward as the
 * next run's defaults — there is only one format left (Wall), so there is
 * nothing left to weight. The "Next week ... weight" fields and
 * `FormatWeights`/`nextWeekWeights` are gone; the gate is now purely "did you
 * review retention before generating the next week." The note's
 * "Read-through position" field is also gone — the read-through itself is
 * gone (D02).
 *
 * The note is a plain Markdown file, `content/social/pilot-review-wNN.md`,
 * written BESIDE `pilot-schedule-wNN.json` (same directory) — not merged
 * into the schedule JSON, so the schedule stays exactly what T12/T13 made it:
 * pure, deterministic from a seed, and free of any wall-clock timestamp. The
 * review note is the one place a real date belongs; it's supplied by the
 * CALLER via `--date YYYY-MM-DD` (see scripts/review-week.ts), never read
 * from `Date.now()`.
 *
 * "Filled in", precisely: the template's placeholder token, `PLACEHOLDER`
 * (`<TODO>`), must not appear anywhere in the file. `isReviewNoteFilled`
 * checks exactly that; `isReviewNoteStructurallyValid` separately checks
 * every required field/section header is still present (so a hand-edited
 * file that deleted a whole section isn't accidentally treated as "filled"
 * just because it happens to contain no literal "<TODO>"). `isReviewComplete`
 * requires both — that's what `generate-schedule.ts`'s gate calls.
 *
 * The note is deliberately structured around the pre-registered success
 * criterion in `plans/Pf39c2-social-pilot-index.md` (median AND maximum AND
 * follow-conversion; a single 10x-median outlier is NOT sufficient), so a
 * reviewer can't drift into post-hoc rationalisation — the template has an
 * explicit field for the criterion A check, the criterion B check, and
 * nothing else counts as "viable."
 */

import type { AuthorSlug } from "./constants.js";
import type { AuthorMixEntry } from "./premises.js";
import type { WeekSchedule } from "./schedule.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** The template's fill-in marker. A note counts as "filled in" only once every one of these has been replaced. */
export const PLACEHOLDER = "<TODO>";

/** `YYYY-MM-DD`, nothing fancier — validated as a real calendar date, not just shape. */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// Date validation — the caller supplies the date; this module never calls
// Date.now() itself, so the review note's date is exactly what --date said.
// ---------------------------------------------------------------------------

export function isValidDateString(value: string): boolean {
  const match = DATE_RE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match;
  const year = Number(y);
  const month = Number(m);
  const day = Number(d);
  if (month < 1 || month > 12) return false;
  // Construct in UTC and read the fields back — catches "2026-02-30" etc.
  // without any timezone-dependent shifting of the caller's literal string.
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// ---------------------------------------------------------------------------
// File naming — beside the schedule file, predictable, zero-padded to match
// pilot-schedule-wNN.json's own convention.
// ---------------------------------------------------------------------------

export function reviewNoteFileName(week: number): string {
  return `pilot-review-w${String(week).padStart(2, "0")}.md`;
}

// ---------------------------------------------------------------------------
// Template generation
// ---------------------------------------------------------------------------

export interface ReviewTemplateOptions {
  week: number;
  /** `YYYY-MM-DD`, supplied by the caller — see the module doc comment. */
  date: string;
  /** The week's own generated schedule — supplies the per-post list and combined author mix. */
  schedule: WeekSchedule;
  /** For the note's own "Schedule file" reference line, e.g. "content/social/pilot-schedule-w01.json". */
  scheduleFilePath: string;
}

function formatAuthorMix(mix: Record<AuthorSlug, AuthorMixEntry>): string {
  return Object.entries(mix)
    .map(([author, m]) => `${author} ${m.count} (${(m.share * 100).toFixed(1)}%)`)
    .join(", ");
}

/**
 * Build the week's review-note TEMPLATE — unfilled, every metric/decision
 * field carrying `PLACEHOLDER`. This is what `scripts/review-week.ts` writes;
 * a human (or a future automated retention import) fills it in by hand
 * before the gate in `generate-schedule.ts` will allow the next week.
 */
export function buildReviewNoteTemplate(options: ReviewTemplateOptions): string {
  if (!isValidDateString(options.date)) {
    throw new Error(`Invalid --date "${options.date}" — must be a real calendar date in YYYY-MM-DD form.`);
  }

  const { week, date, schedule, scheduleFilePath } = options;
  const p = PLACEHOLDER;

  const postLines = schedule.slots.map((slot) => `- Day ${slot.day} — ${slot.content.format}, ${slot.card_id}: ${p} views`).join("\n");

  return `# Week ${week} Review — ${date}

Pre-registered success criterion (\`plans/Pf39c2-social-pilot-index.md\` — do NOT renegotiate after posting):
Viable requires at least one of A or B. A single 10x-median outlier is NOT sufficient; across ~168 posts one is
expected from variance alone. Track maximum AND median AND follow-conversion — the maximum alone is not the signal.

## Schedule
- Schedule file: ${scheduleFilePath}
- Combined author mix: ${formatAuthorMix(schedule.author_mix)}

## Per-post views
<!-- Fill in each post's total views below (sum across TikTok + Instagram + YouTube, or note per-platform if the split matters). -->
${postLines}

## Retention metrics
- Median views (this week): ${p}
- Maximum views (this week): ${p}
- Follows gained (this week): ${p}

## Criterion A — Breakout with conversion
<!-- Met when a single post clears ~10,000 views on any platform AND visibly converts to follows. -->
- Criterion A met (yes/no): ${p}
- Criterion A evidence: ${p}

## Criterion B — Accumulating standing
<!-- Met when the account's median views trend upward from week 1 to week 4. Not assessable before week 2. -->
- Criterion B met (yes/no/not-yet-assessable): ${p}
- Criterion B evidence: ${p}

## Decision for next week
<!-- Must be a deliberate choice made FROM the metrics above, not a hunch. -->
- Next week hook changes: ${p}
- Reason: ${p}
`;
}

// ---------------------------------------------------------------------------
// Parsing an existing note
// ---------------------------------------------------------------------------

export interface ParsedReviewNote {
  scheduleFile: string | null;
  combinedAuthorMix: string | null;
  median: number | null;
  maximum: number | null;
  followsGained: number | null;
  criterionAMet: string | null;
  criterionAEvidence: string | null;
  criterionBMet: string | null;
  criterionBEvidence: string | null;
  hookChanges: string | null;
  reason: string | null;
}

/**
 * Extract a `- Label: value` line's value, trimmed. Returns `null` both when
 * the line is missing entirely AND when its value is still `PLACEHOLDER` —
 * an unfilled template line is not a "value" for any field, string or
 * numeric, so every caller gets `null` from either case without needing its
 * own placeholder check.
 */
function matchLine(content: string, label: string): string | null {
  const re = new RegExp(`^- ${label}: (.+)$`, "m");
  const match = re.exec(content);
  if (!match) return null;
  const value = match[1].trim();
  return value === PLACEHOLDER ? null : value;
}

function parseNumberField(content: string, label: string): number | null {
  const raw = matchLine(content, label);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse a review note's fields back out. Works on both a filled note and a
 * blank template (every field simply comes back `null` in the latter case,
 * since `PLACEHOLDER` is never treated as a real value) — callers that need
 * to know whether the note counts as REVIEWED should call `isReviewComplete`
 * instead of inferring it from which fields parsed.
 */
export function parseReviewNote(content: string): ParsedReviewNote {
  return {
    scheduleFile: matchLine(content, "Schedule file"),
    combinedAuthorMix: matchLine(content, "Combined author mix"),
    median: parseNumberField(content, "Median views \\(this week\\)"),
    maximum: parseNumberField(content, "Maximum views \\(this week\\)"),
    followsGained: parseNumberField(content, "Follows gained \\(this week\\)"),
    criterionAMet: matchLine(content, "Criterion A met \\(yes\\/no\\)"),
    criterionAEvidence: matchLine(content, "Criterion A evidence"),
    criterionBMet: matchLine(content, "Criterion B met \\(yes\\/no\\/not-yet-assessable\\)"),
    criterionBEvidence: matchLine(content, "Criterion B evidence"),
    hookChanges: matchLine(content, "Next week hook changes"),
    reason: matchLine(content, "Reason"),
  };
}

// ---------------------------------------------------------------------------
// Validity / completeness checks — what the generate-schedule.ts gate calls.
// ---------------------------------------------------------------------------

/** Every field label a real note must carry, regardless of whether it's filled in yet. */
const REQUIRED_FIELD_LABELS = [
  "Schedule file",
  "Combined author mix",
  "Median views \\(this week\\)",
  "Maximum views \\(this week\\)",
  "Follows gained \\(this week\\)",
  "Criterion A met \\(yes\\/no\\)",
  "Criterion A evidence",
  "Criterion B met \\(yes\\/no\\/not-yet-assessable\\)",
  "Criterion B evidence",
  "Next week hook changes",
  "Reason",
];

/**
 * Structural check only — every required field label is present somewhere in
 * the file (as a `- Label: ...` line) and there's at least one per-post views
 * row. Does NOT check whether values are filled in — see `isReviewNoteFilled`
 * for that. Guards against a hand-edited note that deleted a whole section
 * but happens to contain no literal `PLACEHOLDER` text.
 */
export function isReviewNoteStructurallyValid(content: string): boolean {
  const hasEveryField = REQUIRED_FIELD_LABELS.every((label) => new RegExp(`^- ${label}: `, "m").test(content));
  const hasPerPostRow = /^- Day \d+ — .+: .+ views$/m.test(content);
  return hasEveryField && hasPerPostRow;
}

/** `true` only once every `PLACEHOLDER` token has been replaced with a real value. */
export function isReviewNoteFilled(content: string): boolean {
  return !content.includes(PLACEHOLDER);
}

/**
 * The gate's actual check: a note counts as REVIEWED when it is both
 * structurally intact (every required field/section still present) and
 * filled in (no placeholder left anywhere) — a bare, unedited template
 * passes the structural check but fails this one.
 */
export function isReviewComplete(content: string): boolean {
  return isReviewNoteStructurallyValid(content) && isReviewNoteFilled(content);
}
