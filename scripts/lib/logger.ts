import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";

const MAX_LOG_BYTES = 100 * 1024; // 100 KB

type Level = "INFO" | "WARN" | "ERROR" | "DECISION";

class PipelineLogger {
  private fileHandle: FileHandle | null = null;
  private verbose = false;

  async init(bookSlug: string, verbose: boolean): Promise<void> {
    // Close any previously open handle
    await this.close();

    this.verbose = verbose;

    const dir = path.join(process.cwd(), "content", "pipeline", bookSlug);
    await mkdir(dir, { recursive: true });

    const logPath = path.join(dir, "pipeline.log");

    // Truncate to last MAX_LOG_BYTES if the file is too large
    await this.truncateIfNeeded(logPath);

    // Append mode — preserves previous runs
    this.fileHandle = await open(logPath, "a");

    // Write a run separator
    const now = new Date();
    const ts = now.toISOString().replace("T", " ").slice(0, 19);
    await this.fileHandle.write(`\n--- Run ${ts} ---\n`);
  }

  private async truncateIfNeeded(logPath: string): Promise<void> {
    let content: Buffer;
    try {
      content = await readFile(logPath);
    } catch {
      return; // File doesn't exist yet
    }
    if (content.length <= MAX_LOG_BYTES) return;

    // Keep the last MAX_LOG_BYTES, trimming to the next full line
    const tail = content.subarray(content.length - MAX_LOG_BYTES);
    const firstNewline = tail.indexOf(0x0a);
    const trimmed = firstNewline >= 0 ? tail.subarray(firstNewline + 1) : tail;
    await writeFile(logPath, trimmed);
  }

  async close(): Promise<void> {
    if (this.fileHandle) {
      await this.fileHandle.sync().catch(() => {});
      await this.fileHandle.close();
      this.fileHandle = null;
    }
  }

  info(message: string): void {
    this.write("INFO", message);
  }

  warn(message: string): void {
    this.write("WARN", message);
  }

  error(message: string): void {
    this.write("ERROR", message);
  }

  decision(message: string): void {
    this.write("DECISION", message);
  }

  private write(level: Level, message: string): void {
    const now = new Date();
    const hh = String(now.getHours()).padStart(2, "0");
    const mm = String(now.getMinutes()).padStart(2, "0");
    const ss = String(now.getSeconds()).padStart(2, "0");
    const line = `[${hh}:${mm}:${ss}] [${level}] ${message}\n`;

    if (this.fileHandle) {
      // writeFile on FileHandle is async but we fire-and-forget intentionally;
      // close() calls sync() before closing to ensure all writes flush.
      this.fileHandle.write(line).catch(() => {});
    }

    if (this.verbose) {
      process.stderr.write(line);
    }
  }
}

export const logger = new PipelineLogger();
