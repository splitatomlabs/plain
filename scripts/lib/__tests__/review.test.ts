import { describe, it, expect } from "vitest";
import { loadCorpus, rankWall } from "../premises.js";
import { generateWeek, type FormatPools, type WeekSchedule } from "../schedule.js";
import {
  PLACEHOLDER,
  buildReviewNoteTemplate,
  isReviewComplete,
  isReviewNoteFilled,
  isReviewNoteStructurallyValid,
  isValidDateString,
  parseReviewNote,
  reviewNoteFileName,
} from "../review.js";

// ---------------------------------------------------------------------------
// Fixtures — a real generated week (same pattern schedule.test.ts uses),
// since the review template's per-post list, author mix and read-through
// position are all derived directly from a WeekSchedule.
// ---------------------------------------------------------------------------

const cards = loadCorpus();
// Pf39c2-social-pilot-02a D01: Question and Objection were deleted outright
// (`questionGate`/`objectionGate` no longer exist) — the channel is one
// Wall a day, drawn from the Wall pool, nothing else. `FormatPools` still
// carries `question`/`objection` fields (collapsing that shape away is
// D02's job, not this one's), so these are always empty now.
const gatePools: FormatPools = {
  wall: rankWall(cards),
  question: [],
  objection: [],
};
const poolSource = { wall: "gate-only" as const, question: "gate-only" as const, objection: "gate-only" as const };

const week1: WeekSchedule = generateWeek({
  weekNumber: 1,
  seed: 42,
  cards,
  pools: gatePools,
  poolSource,
  priorUsedCardIds: new Set(),
  readThroughBook: "enchiridion",
  readThroughStartIndex: 0,
});

const SCHEDULE_PATH = "content/social/pilot-schedule-w01.json";

function blankTemplate(): string {
  return buildReviewNoteTemplate({ week: 1, date: "2026-08-25", schedule: week1, scheduleFilePath: SCHEDULE_PATH });
}

/** A realistic, fully filled-in note — replaces every PLACEHOLDER with a real value. */
function filledNote(): string {
  return blankTemplate()
    .replace(/- Day (\d+) Slot (\d+) — (.+): <TODO> views/g, "- Day $1 Slot $2 — $3: 1200 views")
    .replace("- Median views (this week): <TODO>", "- Median views (this week): 1200")
    .replace("- Maximum views (this week): <TODO>", "- Maximum views (this week): 4300")
    .replace("- Follows gained (this week): <TODO>", "- Follows gained (this week): 14")
    .replace("- Criterion A met (yes/no): <TODO>", "- Criterion A met (yes/no): no")
    .replace("- Criterion A evidence: <TODO>", "- Criterion A evidence: no post cleared 10,000 views this week")
    .replace("- Criterion B met (yes/no/not-yet-assessable): <TODO>", "- Criterion B met (yes/no/not-yet-assessable): not-yet-assessable")
    .replace("- Criterion B evidence: <TODO>", "- Criterion B evidence: only one week of data so far")
    .replace("- Next week wall weight: <TODO>", "- Next week wall weight: 5")
    .replace("- Next week question weight: <TODO>", "- Next week question weight: 8")
    .replace("- Next week objection weight: <TODO>", "- Next week objection weight: 1")
    .replace("- Next week hook changes: <TODO>", "- Next week hook changes: open on the numeral, not the archaic text")
    .replace("- Reason: <TODO>", "- Reason: Question posts held attention longer than Wall in the per-post breakdown");
}

describe("reviewNoteFileName", () => {
  it("pads the week number to two digits, matching the schedule file's own convention", () => {
    expect(reviewNoteFileName(1)).toBe("pilot-review-w01.md");
    expect(reviewNoteFileName(12)).toBe("pilot-review-w12.md");
  });
});

describe("isValidDateString", () => {
  it("accepts a real calendar date", () => {
    expect(isValidDateString("2026-08-25")).toBe(true);
  });

  it("rejects malformed shapes", () => {
    expect(isValidDateString("08/25/2026")).toBe(false);
    expect(isValidDateString("2026-8-25")).toBe(false);
    expect(isValidDateString("")).toBe(false);
  });

  it("rejects a shape-valid but impossible calendar date", () => {
    expect(isValidDateString("2026-02-30")).toBe(false);
    expect(isValidDateString("2026-13-01")).toBe(false);
  });
});

describe("buildReviewNoteTemplate", () => {
  it("throws on an invalid date rather than silently accepting it", () => {
    expect(() => buildReviewNoteTemplate({ week: 1, date: "not-a-date", schedule: week1, scheduleFilePath: SCHEDULE_PATH })).toThrow(
      /date/i,
    );
  });

  it("carries the caller-supplied date verbatim, never Date.now()", () => {
    const template = buildReviewNoteTemplate({ week: 1, date: "2020-01-01", schedule: week1, scheduleFilePath: SCHEDULE_PATH });
    expect(template).toContain("2020-01-01");
  });

  // -------------------------------------------------------------------------
  // Acceptance: the template contains every required field.
  // -------------------------------------------------------------------------
  it("contains every required field the review must be structured around", () => {
    const template = blankTemplate();

    // Per-post views.
    expect(template).toMatch(/Per-post views/);
    for (const slot of week1.slots) {
      expect(template).toContain(slot.card_id);
    }

    // Median, maximum, follows.
    expect(template).toMatch(/Median views \(this week\):/);
    expect(template).toMatch(/Maximum views \(this week\):/);
    expect(template).toMatch(/Follows gained \(this week\):/);

    // Criterion A and B, explicit.
    expect(template).toMatch(/Criterion A met \(yes\/no\):/);
    expect(template).toMatch(/Criterion A evidence:/);
    expect(template).toMatch(/Criterion B met \(yes\/no\/not-yet-assessable\):/);
    expect(template).toMatch(/Criterion B evidence:/);

    // Chosen weights + reason for next week.
    expect(template).toMatch(/Next week wall weight:/);
    expect(template).toMatch(/Next week question weight:/);
    expect(template).toMatch(/Next week objection weight:/);
    expect(template).toMatch(/Next week hook changes:/);
    expect(template).toMatch(/Reason:/);

    // Combined author mix (T05's own acceptance wording) and read-through position.
    expect(template).toMatch(/Combined author mix:/);
    expect(template).toMatch(/Read-through position:/);
  });

  it("mentions the pre-registered success criterion so review can't drift into post-hoc rationalisation", () => {
    const template = blankTemplate();
    expect(template).toMatch(/pre-registered/i);
    expect(template).toMatch(/10x-median/i);
  });

  it("embeds the week's actual combined author mix and read-through counter, not a placeholder", () => {
    const template = blankTemplate();
    for (const [author, m] of Object.entries(week1.author_mix)) {
      expect(template).toContain(`${author} ${m.count} (${(m.share * 100).toFixed(1)}%)`);
    }
    const lastReadThrough = week1.slots.filter((s) => s.read_through).at(-1)!;
    expect(template).toContain(lastReadThrough.read_through_counter!);
  });

  it("is unfilled by construction — every metric/decision field is the placeholder", () => {
    const template = blankTemplate();
    expect(isReviewNoteFilled(template)).toBe(false);
    expect(isReviewComplete(template)).toBe(false);
    // But it IS structurally valid — a blank template still has every field.
    expect(isReviewNoteStructurallyValid(template)).toBe(true);
  });
});

describe("isReviewNoteStructurallyValid / isReviewNoteFilled / isReviewComplete", () => {
  it("treats a filled-in note as both structurally valid and filled — i.e. complete/reviewed", () => {
    const note = filledNote();
    expect(isReviewNoteStructurallyValid(note)).toBe(true);
    expect(isReviewNoteFilled(note)).toBe(true);
    expect(isReviewComplete(note)).toBe(true);
  });

  it("treats an unfilled template as NOT complete/reviewed", () => {
    expect(isReviewComplete(blankTemplate())).toBe(false);
  });

  it("treats a note with even one remaining placeholder as NOT complete", () => {
    const almostFilled = filledNote().replace("- Reason: Question posts held attention longer than Wall in the per-post breakdown", `- Reason: ${PLACEHOLDER}`);
    expect(isReviewComplete(almostFilled)).toBe(false);
  });

  it("treats a structurally gutted note (a whole section deleted) as invalid even with no placeholder left", () => {
    const gutted = filledNote().replace(/## Criterion A[\s\S]*?(?=## Criterion B)/, "");
    expect(isReviewNoteStructurallyValid(gutted)).toBe(false);
    expect(isReviewComplete(gutted)).toBe(false);
  });
});

describe("parseReviewNote", () => {
  it("recovers every metric and decision field from a filled note", () => {
    const parsed = parseReviewNote(filledNote());
    expect(parsed.median).toBe(1200);
    expect(parsed.maximum).toBe(4300);
    expect(parsed.followsGained).toBe(14);
    expect(parsed.criterionAMet).toBe("no");
    expect(parsed.criterionBMet).toBe("not-yet-assessable");
    expect(parsed.hookChanges).toBe("open on the numeral, not the archaic text");
    expect(parsed.reason).toBe("Question posts held attention longer than Wall in the per-post breakdown");
  });

  // -------------------------------------------------------------------------
  // Acceptance: parsing a filled note recovers the chosen weights.
  // -------------------------------------------------------------------------
  it("recovers the chosen next-week format weights as a FormatWeights object", () => {
    const parsed = parseReviewNote(filledNote());
    expect(parsed.nextWeekWeights).toEqual({ wall: 5, question: 8, objection: 1 });
  });

  it("returns null weights (never a partial object) from a blank template", () => {
    const parsed = parseReviewNote(blankTemplate());
    expect(parsed.nextWeekWeights).toBeNull();
    expect(parsed.median).toBeNull();
    expect(parsed.criterionAMet).toBeNull();
  });

  it("returns null weights when only some of the three weight fields are filled in", () => {
    const partial = blankTemplate().replace("- Next week wall weight: <TODO>", "- Next week wall weight: 5");
    const parsed = parseReviewNote(partial);
    expect(parsed.nextWeekWeights).toBeNull();
  });
});
