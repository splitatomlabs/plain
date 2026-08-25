import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { reviewNoteFileName } from "../review.js";

// ---------------------------------------------------------------------------
// T14: the review gate wired into scripts/generate-schedule.ts.
//
// generate-schedule.ts (like score-premises.ts before it) is a top-level CLI
// script whose module body parses argv and calls main() unconditionally on
// import — so, per that file's own documented lesson, this suite spawns it
// as a real subprocess rather than importing it. review-week.ts is spawned
// the same way, and files are read/written directly to fill notes in.
// ---------------------------------------------------------------------------

const GENERATE = "scripts/generate-schedule.ts";
const REVIEW = "scripts/review-week.ts";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(script: string, args: string[]): RunResult {
  try {
    const stdout = execFileSync("npx", ["tsx", script, ...args], {
      cwd: process.cwd(),
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number | null; stdout: string; stderr: string };
    return { status: err.status ?? 1, stdout: err.stdout, stderr: err.stderr };
  }
}

function generate(args: string[]): RunResult {
  return run(GENERATE, args);
}

function reviewWeek(args: string[]): RunResult {
  return run(REVIEW, args);
}

/** Replace every "<TODO>" placeholder with a real, distinct value so the note passes `isReviewComplete`. */
async function fillReviewNote(filePath: string): Promise<void> {
  const content = await readFile(filePath, "utf-8");
  let n = 0;
  const filled = content.replace(/<TODO>/g, () => {
    n += 1;
    return String(100 * n);
  });
  await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, filled, "utf-8"));
}

let outputDir: string;

beforeEach(async () => {
  outputDir = await mkdtemp(path.join(tmpdir(), "generate-schedule-review-gate-"));
});

afterEach(async () => {
  await rm(outputDir, { recursive: true, force: true });
});

describe("review gate", () => {
  // ---------------------------------------------------------------------
  // Acceptance: the week-1 escape hatch works.
  // ---------------------------------------------------------------------
  it("refuses week 1 without --first-week", () => {
    const result = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--dry-run"]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/--first-week/);
  });

  it("generates week 1 with --first-week and no review note required", () => {
    const result = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week", "--dry-run"]);
    expect(result.status).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Acceptance: generating week N+1 without a review note fails with a
  // clear message.
  // ---------------------------------------------------------------------
  it("refuses week 2 when week 1 has no review note at all", () => {
    const week1 = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(week1.status).toBe(0);

    const week2 = generate(["--week", "2", "--seed", "1", "--output", outputDir, "--dry-run"]);
    expect(week2.status).not.toBe(0);
    expect(week2.stderr).toMatch(/missing review note/i);
    expect(week2.stderr).toMatch(/pilot-review-w01\.md/);
    expect(week2.stderr).toMatch(/review-week\.ts/);
  });

  // ---------------------------------------------------------------------
  // Acceptance: with an unfilled template it fails.
  // ---------------------------------------------------------------------
  it("refuses week 2 when week 1's review note exists but is still a blank template", () => {
    const week1 = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(week1.status).toBe(0);

    const template = reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    expect(template.status).toBe(0);

    const week2 = generate(["--week", "2", "--seed", "1", "--output", outputDir, "--dry-run"]);
    expect(week2.status).not.toBe(0);
    expect(week2.stderr).toMatch(/not filled in yet/i);
    expect(week2.stderr).toMatch(/pilot-review-w01\.md/);
  });

  // ---------------------------------------------------------------------
  // Acceptance: with a filled note it succeeds.
  // ---------------------------------------------------------------------
  it("generates week 2 once week 1's review note is filled in", async () => {
    const week1 = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(week1.status).toBe(0);

    const template = reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    expect(template.status).toBe(0);

    const reviewPath = path.join(outputDir, reviewNoteFileName(1));
    await fillReviewNote(reviewPath);

    const week2 = generate(["--week", "2", "--seed", "1", "--output", outputDir, "--dry-run"]);
    expect(week2.status).toBe(0);
  });

  it("carries the review note's chosen weights forward as week 2's defaults", async () => {
    const week1 = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(week1.status).toBe(0);

    const template = reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    expect(template.status).toBe(0);

    const reviewPath = path.join(outputDir, reviewNoteFileName(1));
    let content = await readFile(reviewPath, "utf-8");
    content = content
      .replace(/<TODO>/g, "0") // fill every remaining field with a harmless default first...
      .replace("- Next week wall weight: 0", "- Next week wall weight: 2")
      .replace("- Next week question weight: 0", "- Next week question weight: 9")
      .replace("- Next week objection weight: 0", "- Next week objection weight: 3");
    await (await import("node:fs/promises")).writeFile(reviewPath, content, "utf-8");

    const week2 = generate(["--week", "2", "--seed", "1", "--output", outputDir, "--dry-run"]);
    expect(week2.status).toBe(0);
    expect(week2.stdout).toMatch(/wall=2, question=9, objection=3/);
  });

  // ---------------------------------------------------------------------
  // Deliberate override escape hatch.
  // ---------------------------------------------------------------------
  it("bypasses the gate entirely with --skip-review-check, even with no review note", () => {
    const week1 = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(week1.status).toBe(0);

    const week2 = generate(["--week", "2", "--seed", "1", "--output", outputDir, "--skip-review-check", "--dry-run"]);
    expect(week2.status).toBe(0);
  });

  // ---------------------------------------------------------------------
  // Acceptance: the review note's presence does NOT change the schedule
  // JSON's byte-identity — the T12/T13 determinism property must survive.
  // ---------------------------------------------------------------------
  it("produces a byte-identical schedule JSON whether or not a review note gates the run", async () => {
    // Both runs pin the SAME explicit weights, so the review note's own
    // (arbitrary, fillReviewNote-assigned) weight fields can't be the thing
    // that makes the two schedules differ — the only variable under test is
    // whether the gate is satisfied by a real filled note (A) or bypassed
    // with --skip-review-check (B).
    const pinnedWeights = ["--wall-weight", "7", "--question-weight", "6", "--objection-weight", "1"];

    // Run A: week 1 -> real review note -> week 2 generated normally through the gate.
    const dirA = await mkdtemp(path.join(tmpdir(), "generate-schedule-byte-a-"));
    generate(["--week", "1", "--seed", "1", "--output", dirA, "--first-week"]);
    reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", dirA]);
    await fillReviewNote(path.join(dirA, reviewNoteFileName(1)));
    const week2A = generate(["--week", "2", "--seed", "1", "--output", dirA, ...pinnedWeights]);
    expect(week2A.status).toBe(0);

    // Run B: identical week 1 and week 2, generated with --skip-review-check
    // instead (no review note ever written), so the gate's presence/absence
    // is the ONLY difference between the two runs.
    const dirB = await mkdtemp(path.join(tmpdir(), "generate-schedule-byte-b-"));
    generate(["--week", "1", "--seed", "1", "--output", dirB, "--first-week"]);
    const week2B = generate(["--week", "2", "--seed", "1", "--output", dirB, "--skip-review-check", ...pinnedWeights]);
    expect(week2B.status).toBe(0);

    const scheduleA = await readFile(path.join(dirA, "pilot-schedule-w02.json"), "utf-8");
    const scheduleB = await readFile(path.join(dirB, "pilot-schedule-w02.json"), "utf-8");
    expect(scheduleA).toBe(scheduleB);

    await rm(dirA, { recursive: true, force: true });
    await rm(dirB, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// M7 (PR #39 review): re-running --week N must never silently clobber an
// already-posted week's authoritative record. Mirrors review-week.ts's own
// --force guard on its output file.
// ---------------------------------------------------------------------------
describe("overwrite guard (M7)", () => {
  it("refuses to overwrite an already-generated week without --force, leaving the file byte-unchanged", async () => {
    const first = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(first.status).toBe(0);

    const filePath = path.join(outputDir, "pilot-schedule-w01.json");
    const before = await readFile(filePath, "utf-8");

    const second = generate(["--week", "1", "--seed", "2", "--output", outputDir, "--first-week"]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/i);

    const after = await readFile(filePath, "utf-8");
    expect(after).toBe(before);
  });

  it("overwrites an already-generated week with --force", async () => {
    const first = generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    expect(first.status).toBe(0);

    const filePath = path.join(outputDir, "pilot-schedule-w01.json");
    const before = await readFile(filePath, "utf-8");

    const second = generate(["--week", "1", "--seed", "2", "--output", outputDir, "--first-week", "--force"]);
    expect(second.status).toBe(0);

    const after = await readFile(filePath, "utf-8");
    expect(after).not.toBe(before);
  });
});

describe("review-week.ts", () => {
  it("refuses to build a template for a week whose schedule hasn't been generated yet", () => {
    const result = reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/no schedule found/i);
  });

  it("refuses an invalid --date", () => {
    generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    const result = reviewWeek(["--week", "1", "--date", "not-a-date", "--schedule-dir", outputDir]);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid --date/i);
  });

  it("refuses to overwrite an existing review note without --force", () => {
    generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    const second = reviewWeek(["--week", "1", "--date", "2026-08-26", "--schedule-dir", outputDir]);
    expect(second.status).not.toBe(0);
    expect(second.stderr).toMatch(/already exists/i);
  });

  it("overwrites with --force", () => {
    generate(["--week", "1", "--seed", "1", "--output", outputDir, "--first-week"]);
    reviewWeek(["--week", "1", "--date", "2026-08-25", "--schedule-dir", outputDir]);
    const second = reviewWeek(["--week", "1", "--date", "2026-08-26", "--schedule-dir", outputDir, "--force"]);
    expect(second.status).toBe(0);
  });
});
