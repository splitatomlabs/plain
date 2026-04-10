import { execFile } from "node:child_process";

export class ClaudeCliError extends Error {
  constructor(message: string, public readonly rawOutput?: string) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

export function callClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      "claude",
      ["-p", prompt],
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
): Promise<T> {
  const fullPrompt = schema
    ? `${prompt}\n\nRespond with only valid JSON matching this schema: ${schema}`
    : prompt;

  const output = await callClaude(fullPrompt);

  try {
    return JSON.parse(extractJSON(output)) as T;
  } catch {
    // Retry once with explicit JSON instruction
    const retryOutput = await callClaude(
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
