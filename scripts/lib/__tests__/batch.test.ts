import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.hoisted(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ---------------------------------------------------------------------------
// Mock Anthropic SDK
// ---------------------------------------------------------------------------
const mockBatchCreate = vi.fn();
const mockBatchRetrieve = vi.fn();
const mockBatchResults = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      batches: {
        create: mockBatchCreate,
        retrieve: mockBatchRetrieve,
        results: mockBatchResults,
      },
    },
  })),
}));

import {
  createMessageBatch,
  pollBatchUntilDone,
  streamBatchResults,
  type BatchRequest,
} from "../claude.js";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// createMessageBatch
// ---------------------------------------------------------------------------
describe("createMessageBatch", () => {
  it("calls batches.create with mapped model ID and returns batch object", async () => {
    const fakeBatch = { id: "batch_abc", processing_status: "in_progress" };
    mockBatchCreate.mockResolvedValue(fakeBatch);

    const requests: BatchRequest[] = [
      {
        custom_id: "req-1",
        model: "sonnet",
        messages: [{ role: "user", content: "Hello" }],
      },
    ];

    const result = await createMessageBatch(requests);

    expect(mockBatchCreate).toHaveBeenCalledOnce();
    const callArg = mockBatchCreate.mock.calls[0][0];
    expect(callArg.requests).toHaveLength(1);
    expect(callArg.requests[0].custom_id).toBe("req-1");
    // Model should be the resolved model ID, not the alias
    expect(callArg.requests[0].params.model).toMatch(/claude-sonnet/);
    expect(callArg.requests[0].params.messages).toEqual([
      { role: "user", content: "Hello" },
    ]);
    expect(callArg.requests[0].params.max_tokens).toBe(4096);
    expect(result).toEqual(fakeBatch);
  });

  it("includes system prompt when provided", async () => {
    mockBatchCreate.mockResolvedValue({ id: "batch_xyz", processing_status: "in_progress" });

    await createMessageBatch([
      {
        custom_id: "req-2",
        system: "You are a helpful assistant.",
        messages: [{ role: "user", content: "Hi" }],
      },
    ]);

    const callArg = mockBatchCreate.mock.calls[0][0];
    expect(callArg.requests[0].params.system).toBe("You are a helpful assistant.");
  });

  it("uses provided max_tokens when specified", async () => {
    mockBatchCreate.mockResolvedValue({ id: "batch_zzz", processing_status: "in_progress" });

    await createMessageBatch([
      {
        custom_id: "req-3",
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1024,
      },
    ]);

    const callArg = mockBatchCreate.mock.calls[0][0];
    expect(callArg.requests[0].params.max_tokens).toBe(1024);
  });
});

// ---------------------------------------------------------------------------
// pollBatchUntilDone
// ---------------------------------------------------------------------------
describe("pollBatchUntilDone", () => {
  it("returns immediately when status is already ended", async () => {
    const endedBatch = { id: "batch_done", processing_status: "ended" };
    mockBatchRetrieve.mockResolvedValue(endedBatch);

    const promise = pollBatchUntilDone("batch_done");
    // Advance timers to avoid hanging; but with status=ended it resolves without waiting
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(mockBatchRetrieve).toHaveBeenCalledOnce();
    expect(result).toEqual(endedBatch);
  });

  it("polls multiple times before ending with exponential backoff", async () => {
    mockBatchRetrieve
      .mockResolvedValueOnce({ id: "batch_poll", processing_status: "in_progress" })
      .mockResolvedValueOnce({ id: "batch_poll", processing_status: "in_progress" })
      .mockResolvedValueOnce({ id: "batch_poll", processing_status: "ended" });

    const promise = pollBatchUntilDone("batch_poll");

    // First retrieve fires immediately (no initial sleep)
    await vi.advanceTimersByTimeAsync(5_000); // wait 5s → second retrieve
    await vi.advanceTimersByTimeAsync(10_000); // wait 10s → third retrieve (doubled)

    const result = await promise;
    expect(mockBatchRetrieve).toHaveBeenCalledTimes(3);
    expect(result.processing_status).toBe("ended");
  });
});

// ---------------------------------------------------------------------------
// streamBatchResults
// ---------------------------------------------------------------------------
describe("streamBatchResults", () => {
  it("yields all result items from the async iterable", async () => {
    const fakeResults = [
      { custom_id: "req-1", result: { type: "succeeded", message: { content: [] } } },
      { custom_id: "req-2", result: { type: "errored", error: { type: "server_error" } } },
    ];

    // results() returns an async iterable
    async function* asyncIter() {
      for (const item of fakeResults) yield item;
    }
    mockBatchResults.mockResolvedValue(asyncIter());

    const collected: unknown[] = [];
    for await (const item of streamBatchResults("batch_results")) {
      collected.push(item);
    }

    expect(mockBatchResults).toHaveBeenCalledWith("batch_results");
    expect(collected).toHaveLength(2);
    expect(collected[0]).toMatchObject({ custom_id: "req-1", result: { type: "succeeded" } });
    expect(collected[1]).toMatchObject({ custom_id: "req-2", result: { type: "errored" } });
  });
});
