import Anthropic from "@anthropic-ai/sdk";

export class ClaudeCliError extends Error {
  constructor(message: string, public readonly rawOutput?: string) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

export interface CallClaudeOptions {
  /** Model to use (default: "sonnet") */
  model?: string;
  /** System prompt (used for prompt caching) */
  system?: string;
}

export function extractJSON(text: string): string {
  // 1. Try the full output as-is
  try {
    JSON.parse(text);
    return text;
  } catch {
    // continue
  }

  // 2. Strip ```json fences
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (fenceMatch) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // continue
    }
  }

  // 3. Extract between first { and last }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const extracted = text.slice(firstBrace, lastBrace + 1);
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // continue
    }
  }

  // 3b. Try array extraction [ ... ]
  const firstBracket = text.indexOf("[");
  const lastBracket = text.lastIndexOf("]");
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const extracted = text.slice(firstBracket, lastBracket + 1);
    try {
      JSON.parse(extracted);
      return extracted;
    } catch {
      // continue
    }
  }

  throw new ClaudeCliError("Could not extract JSON from response", text);
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

const API_MODEL_MAP: Record<string, string> = {
  sonnet: "claude-sonnet-4-20250514",
  opus: "claude-opus-4-20250514",
};

/** Accumulated token usage for cost reporting */
export const tokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
};

/** Accumulated batch statistics for cost reporting */
export const batchStats = {
  totalRequests: 0,
  succeeded: 0,
  failed: 0,
};

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY is required. Set it in your environment.");
    }
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

// Simple rate limiter: tracks timestamps of recent calls and waits if needed.
const callTimestamps: number[] = [];
const MAX_RPM = parseInt(process.env.PLAIN_API_RPM ?? "4", 10); // default 4 rpm (safe margin under 5)

async function rateLimit(): Promise<void> {
  const now = Date.now();
  const windowStart = now - 60_000;
  // Remove timestamps older than 1 minute
  while (callTimestamps.length > 0 && callTimestamps[0] < windowStart) {
    callTimestamps.shift();
  }
  if (callTimestamps.length >= MAX_RPM) {
    const waitMs = callTimestamps[0] - windowStart + 100; // wait until oldest exits window + buffer
    process.stderr.write(`[rate-limit] Waiting ${Math.round(waitMs / 1000)}s...\n`);
    await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
  }
  callTimestamps.push(Date.now());
}

async function callClaudeAPI(
  prompt: string,
  model = "sonnet",
  system?: string,
): Promise<string> {
  await rateLimit();
  const client = getClient();
  const modelId = API_MODEL_MAP[model] ?? model;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
    ...(system
      ? {
          system: [
            {
              type: "text" as const,
              text: system,
              cache_control: { type: "ephemeral" as const },
            },
          ],
        }
      : {}),
    messages: [{ role: "user", content: prompt }],
  });

  tokenUsage.inputTokens += response.usage.input_tokens;
  tokenUsage.outputTokens += response.usage.output_tokens;
  tokenUsage.cacheReadTokens += response.usage.cache_read_input_tokens ?? 0;
  tokenUsage.cacheCreationTokens +=
    response.usage.cache_creation_input_tokens ?? 0;

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new ClaudeCliError("No text in API response");
  }
  return textBlock.text.trim();
}

// ---------------------------------------------------------------------------
// Batch API
// ---------------------------------------------------------------------------

/** Build a custom_id that fits the Batch API's 64-char limit. */
export function safeCustomId(...parts: (string | number)[]): string {
  const joined = parts.join("_");
  if (joined.length <= 64) return joined;
  // Truncate the longest part (usually the chapter slug) and add a hash suffix
  const hash = joined.split("").reduce((h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0, 0);
  const suffix = `_${(hash >>> 0).toString(36)}`;
  return joined.slice(0, 64 - suffix.length) + suffix;
}

export interface BatchRequest {
  custom_id: string;
  model?: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  max_tokens?: number;
}

export interface BatchResultItem {
  custom_id: string;
  result:
    | { type: "succeeded"; message: Anthropic.Message }
    | { type: "errored"; error: unknown };
}

/**
 * Creates a message batch via the Anthropic Batch API.
 * Returns the batch object (id, processing_status, etc.).
 */
export async function createMessageBatch(
  requests: BatchRequest[],
): Promise<Anthropic.MessageBatch> {
  const client = getClient();
  const sdkRequests = requests.map((r) => {
    const modelId = API_MODEL_MAP[r.model ?? "sonnet"] ?? r.model ?? API_MODEL_MAP["sonnet"];
    return {
      custom_id: r.custom_id,
      params: {
        model: modelId,
        max_tokens: r.max_tokens ?? 4096,
        ...(r.system ? { system: r.system } : {}),
        messages: r.messages,
      },
    };
  });
  return client.messages.batches.create({ requests: sdkRequests });
}

/**
 * Polls a batch until processing_status is "ended" (or any terminal state).
 * Uses exponential backoff: starts at 5s, doubles each attempt, caps at 60s.
 * Times out after 24 hours. Logs status updates to stderr.
 * Retries transient API errors up to 5 consecutive times before giving up.
 */
export async function pollBatchUntilDone(
  batchId: string,
): Promise<Anthropic.MessageBatch> {
  const client = getClient();
  const MAX_WAIT_MS = 24 * 60 * 60 * 1000; // 24 hours
  const MIN_INTERVAL_MS = 5_000;
  const MAX_INTERVAL_MS = 30_000;
  const MAX_CONSECUTIVE_ERRORS = 5;

  let intervalMs = MIN_INTERVAL_MS;
  let consecutiveErrors = 0;
  const startTime = Date.now();
  const deadline = startTime + MAX_WAIT_MS;

  while (Date.now() < deadline) {
    let batch: Anthropic.MessageBatch;
    try {
      batch = await client.messages.batches.retrieve(batchId);
      consecutiveErrors = 0;
    } catch (err) {
      consecutiveErrors++;
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[batch] ${batchId} poll error (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${msg}\n`,
      );
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        throw new Error(
          `Batch ${batchId} polling failed after ${MAX_CONSECUTIVE_ERRORS} consecutive errors: ${msg}`,
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
      intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS);
      continue;
    }

    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    const elapsedStr = mins > 0 ? `${mins}m${secs}s` : `${secs}s`;
    const counts = batch.request_counts;
    const total = counts.processing + counts.succeeded + counts.errored + counts.canceled + counts.expired;
    const progress = total > 0
      ? ` (${counts.succeeded}/${total} succeeded${counts.errored ? `, ${counts.errored} errored` : ""}, ${elapsedStr} elapsed)`
      : ` (${elapsedStr} elapsed)`;
    process.stderr.write(
      `[batch] ${batchId} status=${batch.processing_status}${progress}\n`,
    );
    if (batch.processing_status === "ended") {
      return batch;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
    intervalMs = Math.min(intervalMs * 2, MAX_INTERVAL_MS);
  }

  throw new Error(`Batch ${batchId} did not complete within 24 hours`);
}

/**
 * Streams results from a completed batch.
 * Yields each result item (succeeded or errored).
 */
export async function* streamBatchResults(
  batchId: string,
): AsyncGenerator<BatchResultItem> {
  const client = getClient();
  for await (const item of await client.messages.batches.results(batchId)) {
    yield item as BatchResultItem;
  }
}

// ---------------------------------------------------------------------------
// Unified entry point — API only
// ---------------------------------------------------------------------------

export async function callClaudeJSON<T>(
  prompt: string,
  schema?: string,
  options?: CallClaudeOptions,
): Promise<T> {
  const fullPrompt = schema
    ? `${prompt}\n\nRespond with only valid JSON matching this schema: ${schema}`
    : prompt;

  const model = options?.model ?? "sonnet";
  const system = options?.system;

  const output = await callClaudeAPI(fullPrompt, model, system);

  try {
    return JSON.parse(extractJSON(output)) as T;
  } catch {
    // Retry once with explicit JSON instruction
    const retryOutput = await callClaudeAPI(
      `${fullPrompt}\n\nRespond with only valid JSON, no other text.`,
      model,
      system,
    );
    try {
      return JSON.parse(extractJSON(retryOutput)) as T;
    } catch {
      throw new ClaudeCliError(
        "Failed to parse JSON from API after retry",
        retryOutput,
      );
    }
  }
}
