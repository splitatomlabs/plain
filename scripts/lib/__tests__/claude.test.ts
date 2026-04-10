import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock child_process before importing claude module
const mockExecFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => mockExecFile(...args),
}));

// Mock the Anthropic SDK
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn(),
}));

import { callClaude, callClaudeJSON, type CallClaudeOptions } from "../claude.js";

beforeEach(() => {
  mockExecFile.mockReset();
});

// Helper: simulate successful execFile
function mockExecFileSuccess(stdout: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(null, stdout, "");
    },
  );
}

// Helper: simulate failed execFile
function mockExecFileError(message: string) {
  mockExecFile.mockImplementation(
    (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
      cb(new Error(message), "", "some stderr");
    },
  );
}

describe("callClaude", () => {
  it("passes --model sonnet by default", async () => {
    mockExecFileSuccess("ok");
    await callClaude("test prompt");

    const args = mockExecFile.mock.calls[0][1];
    expect(args).toContain("--model");
    expect(args).toContain("sonnet");
    expect(args).toContain("-p");
    expect(args).toContain("test prompt");
  });

  it("does not pass --bare by default", async () => {
    mockExecFileSuccess("ok");
    await callClaude("test prompt");

    const args = mockExecFile.mock.calls[0][1];
    expect(args).not.toContain("--bare");
  });

  it("passes --bare when bare option is true", async () => {
    mockExecFileSuccess("ok");
    await callClaude("test prompt", { bare: true });

    const args = mockExecFile.mock.calls[0][1];
    expect(args).toContain("--bare");
  });

  it("uses specified model", async () => {
    mockExecFileSuccess("ok");
    await callClaude("test prompt", { model: "opus" });

    const args = mockExecFile.mock.calls[0][1];
    expect(args).toContain("opus");
  });

  it("trims output", async () => {
    mockExecFileSuccess("  hello world  \n");
    const result = await callClaude("test");
    expect(result).toBe("hello world");
  });

  it("rejects on execFile error", async () => {
    mockExecFileError("command not found");
    await expect(callClaude("test")).rejects.toThrow("claude CLI failed");
  });
});

describe("callClaudeJSON", () => {
  it("parses valid JSON response", async () => {
    mockExecFileSuccess('{"action": "keep"}');
    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "keep" });
  });

  it("extracts JSON from markdown fences", async () => {
    mockExecFileSuccess('Here is the result:\n```json\n{"action": "keep"}\n```');
    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "keep" });
  });

  it("extracts JSON from surrounding text", async () => {
    mockExecFileSuccess('Sure! {"action": "split"} Hope that helps!');
    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "split" });
  });

  it("appends schema instruction when provided", async () => {
    mockExecFileSuccess('{"action": "keep"}');
    await callClaudeJSON("test", "MySchema");

    const promptArg = mockExecFile.mock.calls[0][1].find(
      (a: string) => a.includes("MySchema"),
    );
    expect(promptArg).toContain("Respond with only valid JSON matching this schema: MySchema");
  });

  it("prepends system prompt in CLI mode when provided", async () => {
    mockExecFileSuccess('{"action": "keep"}');
    await callClaudeJSON("user message", undefined, {
      system: "You are a translator.",
    });

    const promptArg = mockExecFile.mock.calls[0][1][mockExecFile.mock.calls[0][1].indexOf("-p") + 1];
    expect(promptArg).toContain("You are a translator.");
    expect(promptArg).toContain("user message");
    // System should come before user content
    const sysIdx = promptArg.indexOf("You are a translator.");
    const userIdx = promptArg.indexOf("user message");
    expect(sysIdx).toBeLessThan(userIdx);
  });

  it("retries on invalid JSON then succeeds", async () => {
    mockExecFileSuccess("not json at all");
    // First call returns garbage, second returns valid JSON
    mockExecFile
      .mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, "not json at all", "");
        },
      )
      .mockImplementationOnce(
        (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
          cb(null, '{"action": "keep"}', "");
        },
      );

    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "keep" });
    expect(mockExecFile).toHaveBeenCalledTimes(2);
  });

  it("throws after retry also fails", async () => {
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], _opts: unknown, cb: Function) => {
        cb(null, "still not json", "");
      },
    );

    await expect(callClaudeJSON("test")).rejects.toThrow(
      "Failed to parse JSON from claude CLI after retry",
    );
  });
});
