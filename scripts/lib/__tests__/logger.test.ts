import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let tempDir: string;
const originalCwd = process.cwd();

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "logger-test-"));
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

// Import after setting up tempDir so logger resolves paths relative to tempDir
import { logger } from "../logger.js";

describe("PipelineLogger", () => {
  describe("file writing", () => {
    it("writes info lines to the log file", async () => {
      await logger.init("enchiridion", false);
      logger.info("hello world");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      expect(log).toContain("[INFO] hello world");
    });

    it("writes warn lines to the log file", async () => {
      await logger.init("enchiridion", false);
      logger.warn("something off");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      expect(log).toContain("[WARN] something off");
    });

    it("writes error lines to the log file", async () => {
      await logger.init("enchiridion", false);
      logger.error("something failed");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      expect(log).toContain("[ERROR] something failed");
    });

    it("writes decision lines to the log file", async () => {
      await logger.init("enchiridion", false);
      logger.decision("keep section 3");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      expect(log).toContain("[DECISION] keep section 3");
    });

    it("truncates the log file on each init", async () => {
      await logger.init("enchiridion", false);
      logger.info("first run");
      await logger.close();

      await logger.init("enchiridion", false);
      logger.info("second run");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      expect(log).not.toContain("first run");
      expect(log).toContain("second run");
    });

    it("creates the book directory if it does not exist", async () => {
      await logger.init("meditations", false);
      logger.info("test");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/meditations/pipeline.log"),
        "utf-8"
      );
      expect(log).toContain("[INFO] test");
    });
  });

  describe("line format", () => {
    it("prefixes each line with a timestamp [HH:MM:SS]", async () => {
      await logger.init("enchiridion", false);
      logger.info("timed message");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      // Matches [HH:MM:SS] at start of line
      expect(log).toMatch(/\[\d{2}:\d{2}:\d{2}\] \[INFO\] timed message/);
    });

    it("each entry ends with a newline", async () => {
      await logger.init("enchiridion", false);
      logger.info("line one");
      logger.info("line two");
      await logger.close();

      const log = await readFile(
        path.join(tempDir, "content/pipeline/enchiridion/pipeline.log"),
        "utf-8"
      );
      const lines = log.split("\n").filter((l) => l.length > 0);
      expect(lines).toHaveLength(2);
    });
  });

  describe("verbose stderr", () => {
    it("does not write to stderr when verbose=false", async () => {
      const stderrSpy = vi
        .spyOn(process.stderr, "write")
        .mockImplementation(() => true);

      await logger.init("enchiridion", false);
      logger.info("quiet message");
      await logger.close();

      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it("writes to stderr when verbose=true", async () => {
      const lines: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

      await logger.init("enchiridion", true);
      logger.info("loud message");
      await logger.close();

      expect(lines.some((l) => l.includes("[INFO] loud message"))).toBe(true);
    });

    it("writes all levels to stderr in verbose mode", async () => {
      const lines: string[] = [];
      vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
        lines.push(String(chunk));
        return true;
      });

      await logger.init("enchiridion", true);
      logger.warn("a warning");
      logger.error("an error");
      logger.decision("a decision");
      await logger.close();

      const combined = lines.join("");
      expect(combined).toContain("[WARN] a warning");
      expect(combined).toContain("[ERROR] an error");
      expect(combined).toContain("[DECISION] a decision");
    });
  });
});
