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

  // ---------------------------------------------------------------------
  // T23: `attemptUnclosedJSONRepair` — the real cause diagnosed from raw
  // responses captured (via ./parse-failure-log.ts) during a Question
  // rubric re-score. `stop_reason` on all four captures was "end_turn"
  // (never "max_tokens") and each used well under 10% of the 4096-token
  // budget — ruling out truncation. The model simply never emitted the
  // final closing brace of an otherwise complete, correctly-formed object.
  //
  // Fix pass (post-T23): narrowed the repair to ONLY close unclosed
  // braces/brackets. It must never close an unterminated string, since
  // `extractJSON` is shared with the content pipeline's translator and a
  // string cut off mid-sentence is a genuinely incomplete VALUE, not a
  // missing trailing close — repairing it would silently ship a
  // half-sentence translation into a book. All four real captures below had
  // their strings correctly closed and only the object's own closing brace
  // missing, so this narrowing does not regress the diagnosed fix.
  // ---------------------------------------------------------------------
  describe("repairs a response missing only its trailing closing brace(s)", () => {
    it("repairs the real captured shape: object complete except for the final '}'", () => {
      // Verbatim (re-typed, not abbreviated) shape of one of the four
      // responses captured during the T23 re-score run — a fully-formed
      // object whose last character is the closing quote of its "reason"
      // string, with no trailing "}" at all.
      const raw =
        '{"verdict":"drifts","standalone_intelligible":false,"answer_has_substance":true,' +
        '"modern_premise":false,"reason":"The question is a bare fragment with no context."';
      const result = extractJSON(raw);
      expect(JSON.parse(result)).toEqual({
        verdict: "drifts",
        standalone_intelligible: false,
        answer_has_substance: true,
        modern_premise: false,
        reason: "The question is a bare fragment with no context.",
      });
    });

    it("repairs nested objects missing more than one trailing close, innermost first", () => {
      // None of the three nested objects has its own closing "}" anywhere
      // in the text, so there's no partial balanced span for step 3 to
      // find first — this exercises the repair appending multiple closers
      // in the correct (innermost-first) order: "}}}"
      const raw = '{"a": {"b": {"c": 1, "note": "still going"';
      const result = extractJSON(raw);
      expect(JSON.parse(result)).toEqual({ a: { b: { c: 1, note: "still going" } } });
    });

    // Fix pass: the repair must NEVER close an unterminated string. Closing
    // a string that the model cut off mid-sentence turns a genuinely
    // truncated response into JSON that parses cleanly and reads as a
    // complete value — silently shipping a half-sentence translation into a
    // book with no error raised anywhere. `extractJSON` is shared with the
    // content pipeline's translator, so this is the path that matters most.
    // A response cut off inside a string must still throw (and therefore be
    // retried), same as before this repair existed.
    it("does NOT repair (still throws) a response cut off mid-string — a truncated VALUE is not a missing trailing close", () => {
      const raw = '{"reason": "This got cut off mid';
      expect(() => extractJSON(raw)).toThrow("Could not extract JSON");
    });

    // Regression test for the exact silent-corruption case this fix pass
    // closes: a `plain_english` translation cut off mid-sentence must throw,
    // not be "repaired" into a valid-looking half-sentence card.
    it("does NOT repair (still throws) a translation cut off mid-sentence — the demonstrated silent-corruption case", () => {
      const raw = '{"plain_english": "Some things are up to you. Some things are not. What is up to';
      expect(() => extractJSON(raw)).toThrow("Could not extract JSON");
    });

    it("repairs an unclosed array", () => {
      const raw = "[1, 2, 3";
      const result = extractJSON(raw);
      expect(JSON.parse(result)).toEqual([1, 2, 3]);
    });

    it("repairs an array with unclosed braces but properly closed strings (an object element missing its own closing brace)", () => {
      const raw = '["a", "b", {"c": 1, "note": "done"';
      const result = extractJSON(raw);
      expect(JSON.parse(result)).toEqual(["a", "b", { c: 1, note: "done" }]);
    });

    it("does NOT repair (still throws) an array truncated mid-string inside an element", () => {
      const raw = '["a", "b';
      expect(() => extractJSON(raw)).toThrow("Could not extract JSON");
    });

    it("does NOT repair (still throws) when a closing brace/bracket is mismatched — refuses to guess at genuinely broken structure", () => {
      expect(() => extractJSON('{"a": 1]')).toThrow("Could not extract JSON");
    });

    it("does not misfire on a response that already parses (fully balanced) — repair is a last resort, not a first choice", () => {
      const raw = '{"a": 1}';
      expect(extractJSON(raw)).toBe(raw);
    });
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
