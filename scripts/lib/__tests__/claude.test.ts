import { describe, it, expect, vi, beforeEach } from "vitest";

// Set env vars before module loads (vi.hoisted runs before vi.mock hoisting)
vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
  process.env.PLAIN_API_RPM = "1000";
});

// Mock the Anthropic SDK
const mockCreate = vi.fn();
vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockCreate,
    },
  })),
}));

import { callClaudeJSON, extractJSON, type CallClaudeOptions } from "../claude.js";

beforeEach(() => {
  mockCreate.mockReset();
});

// Helper: simulate a successful API response
function mockAPIResponse(text: string) {
  mockCreate.mockResolvedValue({
    content: [{ type: "text", text }],
    usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  });
}

describe("extractJSON", () => {
  it("parses valid JSON directly", () => {
    const result = extractJSON('{"action": "keep"}');
    expect(JSON.parse(result)).toEqual({ action: "keep" });
  });

  it("extracts JSON from markdown fences", () => {
    const result = extractJSON('Here is the result:\n```json\n{"action": "keep"}\n```');
    expect(JSON.parse(result)).toEqual({ action: "keep" });
  });

  it("extracts JSON from surrounding text", () => {
    const result = extractJSON('Sure! {"action": "split"} Hope that helps!');
    expect(JSON.parse(result)).toEqual({ action: "split" });
  });

  it("extracts JSON arrays", () => {
    const result = extractJSON('Here: [1, 2, 3] done');
    expect(JSON.parse(result)).toEqual([1, 2, 3]);
  });

  it("throws on non-JSON text", () => {
    expect(() => extractJSON("not json at all")).toThrow("Could not extract JSON");
  });

  // T20 fix: a naive "slice from the first { to the last }" breaks the
  // moment ANY unrelated curly brace shows up in prose BEFORE the real JSON
  // object — the slice then spans two unrelated brace groups plus the text
  // between them, which never parses even though a valid JSON object is
  // right there. This is exactly the failure mode found while investigating
  // premises.log's "Could not extract JSON from response" drops.
  it("extracts JSON that follows prose containing an unrelated brace", () => {
    const result = extractJSON(
      'I\'ll assess this {mentally} first.\n{"impenetrability_score": 4, "landing_line_score": 5}',
    );
    expect(JSON.parse(result)).toEqual({ impenetrability_score: 4, landing_line_score: 5 });
  });

  it("extracts JSON when a string value itself contains literal curly braces", () => {
    const result = extractJSON(
      'Reasoning: the passage uses {nested clauses} heavily.\n\n{"impenetrability_score": 4, "reason": "dense {nested} structure"}',
    );
    expect(JSON.parse(result)).toEqual({ impenetrability_score: 4, reason: "dense {nested} structure" });
  });

  it("still throws when no candidate span is valid JSON despite balanced braces", () => {
    expect(() => extractJSON("Just some {mentally} unrelated {braces} here, no real JSON.")).toThrow(
      "Could not extract JSON",
    );
  });
});

describe("callClaudeJSON", () => {
  it("parses valid JSON response from API", async () => {
    mockAPIResponse('{"action": "keep"}');
    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "keep" });
  });

  it("extracts JSON from markdown fences in API response", async () => {
    mockAPIResponse('```json\n{"action": "keep"}\n```');
    const result = await callClaudeJSON<{ action: string }>("test");
    expect(result).toEqual({ action: "keep" });
  });

  it("appends schema instruction when provided", async () => {
    mockAPIResponse('{"action": "keep"}');
    await callClaudeJSON("test", "MySchema");

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].content).toContain("Respond with only valid JSON matching this schema: MySchema");
  });

  it("passes system prompt via API system parameter", async () => {
    mockAPIResponse('{"action": "keep"}');
    await callClaudeJSON("user message", undefined, {
      system: "You are a translator.",
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system[0].text).toBe("You are a translator.");
    expect(callArgs.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(callArgs.messages[0].content).toContain("user message");
  });

  it("throws on invalid JSON without retrying", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "not json at all" }],
      usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    });

    await expect(callClaudeJSON("test")).rejects.toThrow(
      "Failed to parse JSON from API",
    );
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
