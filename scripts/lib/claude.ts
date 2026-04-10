import { execFile } from "node:child_process";

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

export async function callClaudeJSON<T>(
  prompt: string,
  schema?: string,
  options?: CallClaudeOptions,
): Promise<T> {
  const fullPrompt = schema
    ? `${prompt}\n\nRespond with only valid JSON matching this schema: ${schema}`
    : prompt;

  const output = await callClaude(fullPrompt, options);

  try {
    return JSON.parse(extractJSON(output)) as T;
  } catch {
    // Retry once with explicit JSON instruction
    const retryOutput = await callClaude(
      `${fullPrompt}\n\nRespond with only valid JSON, no other text.`,
      options,
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
