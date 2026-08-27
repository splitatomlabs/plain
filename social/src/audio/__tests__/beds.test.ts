import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { bedPath, listBeds, selectBed, type BedInfo } from "../beds.js";

interface Probe {
  sampleRate: number;
  channels: number;
  durationSec: number;
}

function probe(filePath: string): Probe {
  const out = execFileSync("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "a:0",
    "-show_entries",
    "stream=sample_rate,channels,duration",
    "-of",
    "json",
    filePath,
  ]).toString("utf-8");
  const json = JSON.parse(out);
  const stream = json.streams[0];
  return {
    sampleRate: Number(stream.sample_rate),
    channels: Number(stream.channels),
    durationSec: Number(stream.duration),
  };
}

function sha256(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("listBeds", () => {
  const beds = listBeds();

  it("has between 5 and 8 beds", () => {
    expect(beds.length).toBeGreaterThanOrEqual(5);
    expect(beds.length).toBeLessThanOrEqual(8);
  });

  it("has unique ids", () => {
    const ids = new Set(beds.map((b) => b.id));
    expect(ids.size).toBe(beds.length);
  });

  it("every bed's audio file exists on disk", () => {
    for (const bed of beds) {
      const p = bedPath(bed.id);
      expect(existsSync(p), `${p} should exist`).toBe(true);
    }
  });
});

describe("bed audio properties (via ffprobe)", () => {
  const beds = listBeds();

  it.each(beds.map((b) => [b.id, b] as const))("%s is 48kHz stereo, 60.00s +-20ms", (_id, bed: BedInfo) => {
    const p = probe(bedPath(bed.id));
    expect(p.sampleRate).toBe(48000);
    expect(p.channels).toBe(2);
    expect(Math.abs(p.durationSec - 60)).toBeLessThanOrEqual(0.02);
  });
});

describe("bed uniqueness (file hashes)", () => {
  it("every bed is a distinct audio file", () => {
    const beds = listBeds();
    const hashes = beds.map((b) => sha256(bedPath(b.id)));
    const unique = new Set(hashes);
    expect(unique.size).toBe(beds.length);
  });
});

describe("selectBed", () => {
  it("is deterministic for a given numeric seed", () => {
    for (const seed of [0, 1, 5, 13, 42, -3]) {
      const a = selectBed(seed);
      const b = selectBed(seed);
      expect(a.id).toBe(b.id);
    }
  });

  it("is deterministic for a given date seed", () => {
    const a = selectBed("2026-08-25");
    const b = selectBed("2026-08-25");
    expect(a.id).toBe(b.id);
  });

  it("throws on an invalid seed", () => {
    expect(() => selectBed("not-a-date")).toThrow();
    expect(() => selectBed(Number.NaN)).toThrow();
  });

  it("never repeats the same bed on consecutive numeric slots across a 14-slot week", () => {
    const picks = Array.from({ length: 14 }, (_, i) => selectBed(i));
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].id).not.toBe(picks[i - 1].id);
    }
  });

  it("never repeats the same bed on consecutive calendar dates across a 14-day window", () => {
    const dates = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(Date.UTC(2026, 7, 1 + i)); // 2026-08-01 .. 2026-08-14
      return d.toISOString().slice(0, 10);
    });
    const picks = dates.map((d) => selectBed(d));
    for (let i = 1; i < picks.length; i++) {
      expect(picks[i].id).not.toBe(picks[i - 1].id);
    }
  });

  it("cycles through the full bed set (round robin over N slots hits every bed once)", () => {
    const beds = listBeds();
    const picks = Array.from({ length: beds.length }, (_, i) => selectBed(i).id);
    expect(new Set(picks).size).toBe(beds.length);
  });

  it("a given slot always maps to the same bed regardless of how it's reached", () => {
    // slot 20 and slot 20 - beds.length*3 should coincide with the same phase
    const beds = listBeds();
    const a = selectBed(20);
    const b = selectBed(20 - beds.length * 3);
    expect(a.id).toBe(b.id);
  });
});
