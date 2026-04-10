import { execFile } from "node:child_process";
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
  /** Use --bare mode to skip hooks, plugins, CLAUDE.md, etc. Requires ANTHROPIC_API_KEY. */
  bare?: boolean;
}

export function callClaude(
  prompt: string,
  options: CallClaudeOptions = {},
): Promise<string> {
  const { model = "sonnet", bare = true } = options;
  const args = bare
    ? ["--bare", "--model", model, "-p", prompt]
    : ["--model", model, "-p", prompt];

  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      args,
      { maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new ClaudeCliError(
              `claude CLI failed: ${error.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve(stdout.trim());
      },
    );
  });
}

function extractJSON(text: string): string {
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
// Direct API path (PLAIN_USE_API=1)
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

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic {
  if (!anthropicClient) {
    anthropicClient = new Anthropic();
  }
  return anthropicClient;
}

async function callClaudeAPI(prompt: string, model = "sonnet"): Promise<string> {
  const client = getClient();
  const modelId = API_MODEL_MAP[model] ?? model;

  const response = await client.messages.create({
    model: modelId,
    max_tokens: 4096,
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
// Unified entry point — routes to CLI or API based on PLAIN_USE_API
// ---------------------------------------------------------------------------

const useAPI = process.env.PLAIN_USE_API === "1";

export async function callClaudeJSON<T>(
  prompt: string,
  schema?: string,
  options?: CallClaudeOptions,
): Promise<T> {
  const fullPrompt = schema
    ? `${prompt}\n\nRespond with only valid JSON matching this schema: ${schema}`
    : prompt;

  const model = options?.model ?? "sonnet";
  const call = useAPI
    ? (p: string) => callClaudeAPI(p, model)
    : (p: string) => callClaude(p, options);

  const output = await call(fullPrompt);

  try {
    return JSON.parse(extractJSON(output)) as T;
  } catch {
    // Retry once with explicit JSON instruction
    const retryOutput = await call(
      `${fullPrompt}\n\nRespond with only valid JSON, no other text.`,
    );
    try {
      return JSON.parse(extractJSON(retryOutput)) as T;
    } catch {
      throw new ClaudeCliError(
        "Failed to parse JSON from claude CLI after retry",
        retryOutput,
      );
    }
  }
}
