import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import type { FileHandle } from "node:fs/promises";

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
    // "w" flag truncates the file on open
    this.fileHandle = await open(logPath, "w");
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
