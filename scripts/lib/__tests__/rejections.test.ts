/**
 * Tests for the committed content-rejection list (./lib/rejections.ts).
 *
 * The acceptance property, stated as the bug it exists to prevent: a card
 * swapped out of a week's schedule by hand is NOT in any schedule file, so
 * `loadPriorWeeks` cannot know it was ever rejected — and the next week's
 * draw hands it straight back. That really happened (on-anger-02-054, week
 * 1 -> week 2). The last test in this file pins it end to end against the
 * real committed list rather than a fixture.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertRejectionsResolve, loadRejections, type RejectionEntry } from "../rejections.js";

let tempDir: string;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "rejections-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

const VALID: RejectionEntry = {
  card_id: "on-anger-02-054",
  book_slug: "on-anger",
  reason: "Landing line is the opening of an anecdote, not a payoff.",
  rejected_on: "2026-09-10",
};

async function writeList(wall: unknown): Promise<string> {
  const filePath = path.join(tempDir, "rejected-cards.json");
  await writeFile(filePath, JSON.stringify({ meta: { purpose: "test" }, wall }), "utf-8");
  return filePath;
}

describe("loadRejections", () => {
  it("returns the card-id set for a well-formed list", async () => {
    const filePath = await writeList([VALID]);
    const ids = await loadRejections(filePath);
    expect(ids).not.toBeNull();
    expect(ids!.has("on-anger-02-054")).toBe(true);
    expect(ids!.size).toBe(1);
  });

  it("returns null when the file does not exist — a checkout that has rejected nothing runs ungated", async () => {
    expect(await loadRejections(path.join(tempDir, "absent.json"))).toBeNull();
  });

  // The file is the only thing standing between a rejected card and a
  // redraw, so every malformed shape must fail loudly rather than quietly
  // resolving to "nothing is rejected".
  it("throws on a bare JSON array rather than treating it as empty", async () => {
    const filePath = path.join(tempDir, "rejected-cards.json");
    await writeFile(filePath, "[]", "utf-8");
    await expect(loadRejections(filePath)).rejects.toThrow(/unrecognized shape/i);
  });

  it("throws on unparseable JSON", async () => {
    const filePath = path.join(tempDir, "rejected-cards.json");
    await writeFile(filePath, "{ not json", "utf-8");
    await expect(loadRejections(filePath)).rejects.toThrow(/unparseable JSON/i);
  });

  it("throws when the wall section is missing", async () => {
    const filePath = path.join(tempDir, "rejected-cards.json");
    await writeFile(filePath, JSON.stringify({ meta: {} }), "utf-8");
    await expect(loadRejections(filePath)).rejects.toThrow(/"wall" array/i);
  });

  it("throws on an entry with no card_id, naming which entry", async () => {
    const filePath = await writeList([{ ...VALID, card_id: undefined }]);
    await expect(loadRejections(filePath)).rejects.toThrow(/entry 0 has no card_id/i);
  });

  // A rejection nobody can audit later is not a record — see the module's
  // own doc comment.
  it("throws on an entry with no reason, naming the card", async () => {
    const filePath = await writeList([{ ...VALID, reason: "   " }]);
    await expect(loadRejections(filePath)).rejects.toThrow(/on-anger-02-054.*no reason/i);
  });

  it("throws on an invalid rejected_on date", async () => {
    const filePath = await writeList([{ ...VALID, rejected_on: "2026-02-30" }]);
    await expect(loadRejections(filePath)).rejects.toThrow(/invalid rejected_on/i);
  });

  it("throws when one card is listed twice — two stated reasons for one decision is an unresolved record", async () => {
    const filePath = await writeList([VALID, { ...VALID, reason: "a different reason" }]);
    await expect(loadRejections(filePath)).rejects.toThrow(/listed twice/i);
  });
});

describe("assertRejectionsResolve", () => {
  it("passes when every rejected id is a real corpus card", () => {
    expect(() => assertRejectionsResolve(new Set(["a", "b"]), new Set(["a", "b", "c"]))).not.toThrow();
  });

  // A typo'd id blocks nothing and would never surface on its own — the
  // card it was meant to stop would simply get drawn one day.
  it("throws naming every id that matches no card", () => {
    expect(() => assertRejectionsResolve(new Set(["typo-01", "b"]), new Set(["b"]))).toThrow(/typo-01/);
  });
});

describe("the real committed list", () => {
  const REAL_PATH = path.join(process.cwd(), "content/social/rejected-cards.json");

  it("parses, and every entry resolves to a real corpus card", async () => {
    const ids = await loadRejections(REAL_PATH);
    expect(ids).not.toBeNull();

    const { loadCorpus } = await import("../premises.js");
    const corpusIds = new Set(loadCorpus("content/output").map((c) => c.id));
    expect(() => assertRejectionsResolve(ids!, corpusIds)).not.toThrow();
  });

  // THE REGRESSION THIS FILE EXISTS FOR. on-anger-02-054 was swapped out of
  // week 1 by commit ee25b4f, which left it absent from every schedule —
  // and so absent from `loadPriorWeeks`'s used-card set — and the week 2
  // draw handed it straight back. It must be on the list permanently.
  it("still carries on-anger-02-054, the card that was rejected in week 1 and redrawn in week 2", async () => {
    const ids = await loadRejections(REAL_PATH);
    expect(ids!.has("on-anger-02-054")).toBe(true);
  });

  // The rejected card must not have quietly survived in a real schedule.
  it("lists no card that an already-generated week actually schedules", async () => {
    const ids = await loadRejections(REAL_PATH);
    const scheduleDir = path.join(process.cwd(), "content/social");
    const { readdirSync } = await import("node:fs");
    const weeks = readdirSync(scheduleDir).filter((f) => /^pilot-schedule-w\d+\.json$/.test(f));
    expect(weeks.length).toBeGreaterThan(0);

    for (const file of weeks) {
      const schedule = JSON.parse(readFileSync(path.join(scheduleDir, file), "utf-8")) as {
        slots: { card_id: string }[];
      };
      for (const slot of schedule.slots) {
        expect(ids!.has(slot.card_id), `${file} schedules rejected card ${slot.card_id}`).toBe(false);
      }
    }
  });
});
