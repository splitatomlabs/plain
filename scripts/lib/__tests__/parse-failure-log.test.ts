import { describe, it, expect, afterEach } from "vitest";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { recordParseFailure, PARSE_FAILURE_DIR } from "../parse-failure-log.js";

// ---------------------------------------------------------------------------
// T23: unit coverage for the capture path in isolation from the batch
// orchestration (scripts/lib/__tests__/premises-batch.test.ts covers the
// integration — a real parse failure inside `submitAndCollect` actually
// triggering this module).
// ---------------------------------------------------------------------------

const writtenFiles: string[] = [];

afterEach(async () => {
  await Promise.all(writtenFiles.map((f) => rm(f, { force: true })));
  writtenFiles.length = 0;
});

describe("recordParseFailure", () => {
  it("writes a JSON capture under content/pipeline/social/parse-failures/<custom_id>.json with the raw text, stop_reason, and output_tokens", async () => {
    const record = {
      custom_id: "question_test-card-001_0",
      format: "question",
      error: "Question rubric response missing required field \"verdict\"",
      stop_reason: "max_tokens" as const,
      output_tokens: 4096,
      raw_text: '{"verdict": "answers", "standalone_intellig',
    };

    const filePath = await recordParseFailure(record);
    writtenFiles.push(filePath);

    expect(filePath).toBe(path.join(PARSE_FAILURE_DIR, `${record.custom_id}.json`));

    const onDisk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(onDisk).toEqual(record);
  });

  it("distinguishes truncation (stop_reason max_tokens) from a genuinely malformed complete response (stop_reason end_turn) — the actual diagnostic this task exists to capture", async () => {
    const truncated = {
      custom_id: "question_truncated-card_1",
      format: "question",
      error: "Could not extract JSON from response",
      stop_reason: "max_tokens" as const,
      output_tokens: 4096,
      raw_text: '{"verdict": "answ',
    };
    const completeButMalformed = {
      custom_id: "question_malformed-card_2",
      format: "question",
      error: "Could not extract JSON from response",
      stop_reason: "end_turn" as const,
      output_tokens: 40,
      raw_text: "Sorry, I can't help with that request.",
    };

    const [truncatedPath, malformedPath] = await Promise.all([
      recordParseFailure(truncated),
      recordParseFailure(completeButMalformed),
    ]);
    writtenFiles.push(truncatedPath, malformedPath);

    const truncatedOnDisk = JSON.parse(await readFile(truncatedPath, "utf-8"));
    const malformedOnDisk = JSON.parse(await readFile(malformedPath, "utf-8"));
    expect(truncatedOnDisk.stop_reason).toBe("max_tokens");
    expect(malformedOnDisk.stop_reason).toBe("end_turn");
  });

  it("overwrites a previous capture for the same custom_id rather than accumulating stale files", async () => {
    const customId = "question_overwrite-test_3";
    const first = await recordParseFailure({
      custom_id: customId,
      format: "question",
      error: "first attempt error",
      stop_reason: "end_turn",
      output_tokens: 10,
      raw_text: "first raw text",
    });
    writtenFiles.push(first);

    const second = await recordParseFailure({
      custom_id: customId,
      format: "question",
      error: "second attempt error",
      stop_reason: "max_tokens",
      output_tokens: 4096,
      raw_text: "second raw text",
    });

    expect(second).toBe(first);
    const onDisk = JSON.parse(await readFile(second, "utf-8"));
    expect(onDisk.error).toBe("second attempt error");
    expect(onDisk.raw_text).toBe("second raw text");
  });

  it("sanitizes an unsafe custom_id into a filesystem-safe filename (defensive — custom_ids are already safe via safeCustomId)", async () => {
    const record = {
      custom_id: "weird/../id with spaces:*",
      format: "wall",
      error: "boom",
      stop_reason: null,
      output_tokens: 0,
      raw_text: "",
    };
    const filePath = await recordParseFailure(record);
    writtenFiles.push(filePath);

    // The real safety property: no path separator survives sanitization,
    // so the write can never escape PARSE_FAILURE_DIR — not merely that the
    // string ".." (harmless once "/" is gone) doesn't appear anywhere.
    expect(path.dirname(filePath)).toBe(PARSE_FAILURE_DIR);
    expect(filePath).not.toContain(" ");
    const onDisk = JSON.parse(await readFile(filePath, "utf-8"));
    expect(onDisk.custom_id).toBe(record.custom_id);
  });
});
