import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parsePoolFile,
  classifyRun,
  buildPoolMeta,
  decidePoolWrite,
  writePoolFile,
  type RunCounts,
} from "../pool-file.js";

// ---------------------------------------------------------------------------
// T19: "Never write a pool file from a run that produced no scored
// entries." This is the reproduction the plan itself names — the T11 smoke
// run hit retired model IDs, all requests errored, and score-premises.ts
// nonetheless wrote `[]` to wall/question/objection.json, which
// `loadFormatPools` then treated as a real (empty) pool instead of falling
// back to the mechanical gates, dying with "pools exhausted".
//
// No API call anywhere in this file — every "run" here is a fake
// RunCounts, and writePoolFile's fs work is exercised against real tmp
// directories only.
// ---------------------------------------------------------------------------

describe("parsePoolFile", () => {
  it("reads the legacy plain-array shape, with meta: null", () => {
    const result = parsePoolFile<{ id: number }>([{ id: 1 }, { id: 2 }]);
    expect(result.meta).toBeNull();
    expect(result.entries).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("reads the current { meta, entries } envelope shape", () => {
    const meta = { submitted: 2, succeeded: 2, dropped: 0, limited: false, generated_at: "2026-08-25T00:00:00.000Z" };
    const result = parsePoolFile<{ id: number }>({ meta, entries: [{ id: 1 }] });
    expect(result.meta).toEqual(meta);
    expect(result.entries).toEqual([{ id: 1 }]);
  });

  it("reads an empty legacy array", () => {
    const result = parsePoolFile<unknown>([]);
    expect(result.meta).toBeNull();
    expect(result.entries).toEqual([]);
  });

  it("reads an envelope with no meta field as meta: null", () => {
    const result = parsePoolFile<{ id: number }>({ entries: [{ id: 1 }] });
    expect(result.meta).toBeNull();
    expect(result.entries).toEqual([{ id: 1 }]);
  });

  it("throws on an unrecognized shape (bare object, no entries array)", () => {
    expect(() => parsePoolFile({ foo: "bar" })).toThrow(/unrecognized pool file shape/i);
  });

  it("throws on a scalar", () => {
    expect(() => parsePoolFile("not json array or object" as unknown)).toThrow(/unrecognized pool file shape/i);
  });
});

describe("classifyRun", () => {
  it("classifies zero submitted as empty-gate", () => {
    expect(classifyRun({ submitted: 0, succeeded: 0 })).toBe("empty-gate");
  });

  it("classifies submitted > 0, succeeded === 0 as zero (the T19 bug shape)", () => {
    expect(classifyRun({ submitted: 30, succeeded: 0 })).toBe("zero");
  });

  it("classifies 0 < succeeded < submitted as partial", () => {
    expect(classifyRun({ submitted: 10, succeeded: 7 })).toBe("partial");
  });

  it("classifies succeeded === submitted (> 0) as full", () => {
    expect(classifyRun({ submitted: 10, succeeded: 10 })).toBe("full");
  });
});

describe("buildPoolMeta", () => {
  it("computes dropped as submitted - succeeded and carries limited/generated_at through", () => {
    const meta = buildPoolMeta({ submitted: 10, succeeded: 7 }, true, "2026-08-25T12:00:00.000Z");
    expect(meta).toEqual({
      submitted: 10,
      succeeded: 7,
      dropped: 3,
      limited: true,
      generated_at: "2026-08-25T12:00:00.000Z",
    });
  });
});

describe("decidePoolWrite", () => {
  it("empty-gate (nothing submitted): write: false, exitCode 0, no error", () => {
    const decision = decidePoolWrite("wall", { submitted: 0, succeeded: 0 });
    expect(decision).toEqual({ write: false, exitCode: 0 });
  });

  it("zero successes: write: false, exitCode 1, error names the format and failure count", () => {
    const decision = decidePoolWrite("wall", { submitted: 30, succeeded: 0 });
    expect(decision.write).toBe(false);
    expect(decision.exitCode).toBe(1);
    expect(decision.error).toMatch(/wall/i);
    expect(decision.error).toMatch(/30/);
    expect(decision.error).toMatch(/zero/i);
  });

  it("partial success: write: true, exitCode 0, warning names both counts", () => {
    const decision = decidePoolWrite("question", { submitted: 10, succeeded: 7 });
    expect(decision.write).toBe(true);
    expect(decision.exitCode).toBe(0);
    expect(decision.warning).toMatch(/question/i);
    expect(decision.warning).toMatch(/7/);
    expect(decision.warning).toMatch(/10/);
    expect(decision.warning).toMatch(/partial/i);
  });

  it("full success: write: true, exitCode 0, no warning or error", () => {
    const decision = decidePoolWrite("objection", { submitted: 5, succeeded: 5 });
    expect(decision).toEqual({ write: true, exitCode: 0 });
  });
});

// ---------------------------------------------------------------------------
// writePoolFile — real fs, tmp dirs, no network.
// ---------------------------------------------------------------------------

describe("writePoolFile", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "pool-file-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("zero successes with an existing pool file: throws, exits non-zero, and leaves the file byte-unchanged", async () => {
    const filePath = path.join(dir, "wall.json");
    const originalContent = JSON.stringify([{ card_id: "a" }, { card_id: "b" }], null, 2) + "\n";
    await writeFile(filePath, originalContent, "utf-8");

    const counts: RunCounts = { submitted: 30, succeeded: 0 };
    await expect(
      writePoolFile({ outputDir: dir, name: "wall", entries: [], counts, limited: false }),
    ).rejects.toThrow(/zero of 30/i);

    const afterContent = await readFile(filePath, "utf-8");
    expect(afterContent).toBe(originalContent);
  });

  it("zero successes with NO pre-existing file: throws and creates no file", async () => {
    const filePath = path.join(dir, "question.json");
    expect(existsSync(filePath)).toBe(false);

    const counts: RunCounts = { submitted: 12, succeeded: 0 };
    await expect(
      writePoolFile({ outputDir: dir, name: "question", entries: [], counts, limited: false }),
    ).rejects.toThrow(/zero of 12/i);

    expect(existsSync(filePath)).toBe(false);
  });

  it("empty gate (nothing submitted): does not throw, writes nothing", async () => {
    const filePath = path.join(dir, "still.json");
    const counts: RunCounts = { submitted: 0, succeeded: 0 };
    const result = await writePoolFile({ outputDir: dir, name: "still", entries: [], counts, limited: false });
    expect(result.wrote).toBe(false);
    expect(existsSync(filePath)).toBe(false);
  });

  it("partial run: writes the file, records partial metadata, and warns loudly", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = path.join(dir, "objection.json");
    const counts: RunCounts = { submitted: 10, succeeded: 7 };
    const entries = Array.from({ length: 7 }, (_, i) => ({ card_id: `c${i}` }));

    const result = await writePoolFile({
      outputDir: dir,
      name: "objection",
      entries,
      counts,
      limited: false,
      now: () => "2026-08-25T00:00:00.000Z",
    });

    expect(result.wrote).toBe(true);
    expect(result.warning).toMatch(/partial/i);
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls.some((call) => /partial/i.test(String(call[0])))).toBe(true);

    const written = JSON.parse(await readFile(filePath, "utf-8"));
    expect(written.meta).toEqual({
      submitted: 10,
      succeeded: 7,
      dropped: 3,
      limited: false,
      generated_at: "2026-08-25T00:00:00.000Z",
    });
    expect(written.entries).toHaveLength(7);

    warnSpy.mockRestore();
  });

  it("full run: writes the file silently (no warning) with meta.dropped === 0", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const filePath = path.join(dir, "wall.json");
    const counts: RunCounts = { submitted: 3, succeeded: 3 };
    const entries = [{ card_id: "a" }, { card_id: "b" }, { card_id: "c" }];

    const result = await writePoolFile({
      outputDir: dir,
      name: "wall",
      entries,
      counts,
      limited: false,
      now: () => "2026-08-25T00:00:00.000Z",
    });

    expect(result.wrote).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(warnSpy).not.toHaveBeenCalled();

    const written = JSON.parse(await readFile(filePath, "utf-8"));
    expect(written.meta.dropped).toBe(0);
    expect(written.meta.limited).toBe(false);
    expect(written.entries).toEqual(entries);

    warnSpy.mockRestore();
  });

  it("--limit run refuses to overwrite an existing larger pool without --force", async () => {
    const filePath = path.join(dir, "question.json");
    const existing = Array.from({ length: 20 }, (_, i) => ({ card_id: `existing-${i}` }));
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

    const counts: RunCounts = { submitted: 5, succeeded: 5 };
    const entries = Array.from({ length: 5 }, (_, i) => ({ card_id: `limited-${i}` }));

    await expect(
      writePoolFile({ outputDir: dir, name: "question", entries, counts, limited: true }),
    ).rejects.toThrow(/refusing to overwrite/i);

    // File untouched.
    const afterContent = await readFile(filePath, "utf-8");
    expect(JSON.parse(afterContent)).toEqual(existing);
  });

  it("--limit run with --force overwrites an existing larger pool", async () => {
    const filePath = path.join(dir, "question.json");
    const existing = Array.from({ length: 20 }, (_, i) => ({ card_id: `existing-${i}` }));
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

    const counts: RunCounts = { submitted: 5, succeeded: 5 };
    const entries = Array.from({ length: 5 }, (_, i) => ({ card_id: `limited-${i}` }));

    const result = await writePoolFile({
      outputDir: dir,
      name: "question",
      entries,
      counts,
      limited: true,
      force: true,
      now: () => "2026-08-25T00:00:00.000Z",
    });

    expect(result.wrote).toBe(true);
    const written = JSON.parse(await readFile(filePath, "utf-8"));
    expect(written.entries).toHaveLength(5);
    expect(written.meta.limited).toBe(true);
  });

  it("--limit run does NOT trip the overwrite guard against a smaller or equal existing pool", async () => {
    const filePath = path.join(dir, "wall.json");
    const existing = Array.from({ length: 3 }, (_, i) => ({ card_id: `existing-${i}` }));
    await writeFile(filePath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

    const counts: RunCounts = { submitted: 5, succeeded: 5 };
    const entries = Array.from({ length: 5 }, (_, i) => ({ card_id: `limited-${i}` }));

    const result = await writePoolFile({ outputDir: dir, name: "wall", entries, counts, limited: true });
    expect(result.wrote).toBe(true);
    const written = JSON.parse(await readFile(filePath, "utf-8"));
    expect(written.entries).toHaveLength(5);
  });

  it("--limit overwrite guard also recognizes a legacy plain-array existing file", async () => {
    const filePath = path.join(dir, "objection.json");
    const existingLegacyArray = Array.from({ length: 15 }, (_, i) => ({ card_id: `legacy-${i}` }));
    await writeFile(filePath, JSON.stringify(existingLegacyArray), "utf-8");

    const counts: RunCounts = { submitted: 4, succeeded: 4 };
    const entries = Array.from({ length: 4 }, (_, i) => ({ card_id: `limited-${i}` }));

    await expect(
      writePoolFile({ outputDir: dir, name: "objection", entries, counts, limited: true }),
    ).rejects.toThrow(/refusing to overwrite/i);
  });

  it("a non-limited run overwrites an existing pool of any size with no guard at all", async () => {
    const filePath = path.join(dir, "wall.json");
    const existing = Array.from({ length: 100 }, (_, i) => ({ card_id: `existing-${i}` }));
    await writeFile(filePath, JSON.stringify(existing), "utf-8");

    const counts: RunCounts = { submitted: 3, succeeded: 3 };
    const entries = [{ card_id: "a" }, { card_id: "b" }, { card_id: "c" }];

    const result = await writePoolFile({ outputDir: dir, name: "wall", entries, counts, limited: false });
    expect(result.wrote).toBe(true);
    const written = JSON.parse(await readFile(filePath, "utf-8"));
    expect(written.entries).toHaveLength(3);
  });
});
