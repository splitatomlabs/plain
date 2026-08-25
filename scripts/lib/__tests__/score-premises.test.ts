import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { VALID_FORMATS, formatsToRun, parseLimit } from "../premises-cli.js";

// ---------------------------------------------------------------------------
// T10: scripts/score-premises.ts is a top-level CLI script (parseArgs runs at
// module scope, and `main()` runs unconditionally at the bottom, exactly like
// generate.ts) — it must NEVER be `import`ed by a test, since that would
// re-run its own argument parsing and `main()` as an import side effect
// against the TEST RUNNER's own process.argv/env (confirmed the hard way:
// an earlier draft of this file imported from "../../score-premises.js" for
// `VALID_FORMATS`/`formatsToRun` alone, and the import silently kicked off a
// real, unguarded `main()` run attempting a live Wall scoring batch).
// `VALID_FORMATS`/`formatsToRun`/`parseLimit` live in the side-effect-free
// ../premises-cli.ts instead, imported by both this test and the script.
// Everything else here spawns the script as a real subprocess — the same way
// the acceptance command itself is run — and asserts on exit code / stdout /
// stderr.
// ---------------------------------------------------------------------------

const SCRIPT = "scripts/score-premises.ts";

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function run(args: string[], env: NodeJS.ProcessEnv = process.env): RunResult {
  try {
    const stdout = execFileSync("npx", ["tsx", SCRIPT, ...args], {
      cwd: process.cwd(),
      env,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { status: 0, stdout, stderr: "" };
  } catch (e) {
    const err = e as { status: number | null; stdout: string; stderr: string };
    return { status: err.status ?? 1, stdout: err.stdout, stderr: err.stderr };
  }
}

function withoutApiKey(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  return env;
}

// ---------------------------------------------------------------------------
// formatsToRun / VALID_FORMATS — pure, no subprocess needed.
// ---------------------------------------------------------------------------
describe("VALID_FORMATS / formatsToRun", () => {
  it("lists the five valid --format values", () => {
    expect(VALID_FORMATS).toEqual(["wall", "question", "objection", "still", "all"]);
  });

  it("expands 'all' to all four scored formats", () => {
    expect(formatsToRun("all")).toEqual(["wall", "question", "objection", "still"]);
  });

  it("returns a single-element array for a specific format", () => {
    expect(formatsToRun("wall")).toEqual(["wall"]);
    expect(formatsToRun("question")).toEqual(["question"]);
    expect(formatsToRun("objection")).toEqual(["objection"]);
    expect(formatsToRun("still")).toEqual(["still"]);
  });
});

describe("parseLimit", () => {
  it("returns undefined when no limit was given", () => {
    expect(parseLimit(undefined)).toBeUndefined();
  });

  it("parses a positive integer string as a number", () => {
    expect(parseLimit("5")).toBe(5);
    expect(parseLimit("1")).toBe(1);
    expect(parseLimit("1000")).toBe(1000);
  });

  it("rejects zero", () => {
    expect(() => parseLimit("0")).toThrow(/positive integer/i);
  });

  it("rejects a negative number", () => {
    expect(() => parseLimit("-5")).toThrow(/positive integer/i);
  });

  it("rejects a non-integer", () => {
    expect(() => parseLimit("2.5")).toThrow(/positive integer/i);
  });

  it("rejects a non-numeric string", () => {
    expect(() => parseLimit("abc")).toThrow(/positive integer/i);
  });
});

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
describe("argument parsing", () => {
  it.each(["wall", "question", "objection", "still", "all"])(
    "accepts --format %s",
    (format) => {
      const result = run(["--dry-run", "--limit", "2", "--format", format], withoutApiKey());
      expect(result.status).toBe(0);
    },
  );

  it("rejects an invalid --format with a clear message and nonzero exit", () => {
    const result = run(["--format", "bogus"], withoutApiKey());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/invalid format/i);
    expect(result.stderr).toMatch(/bogus/);
  });

  it("parses --limit as a number", () => {
    const result = run(["--dry-run", "--limit", "3", "--format", "wall"], withoutApiKey());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/processing 3/);
  });

  it("rejects a zero --limit with a clear message and nonzero exit", () => {
    const result = run(["--dry-run", "--limit", "0"], withoutApiKey());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/positive integer/i);
  });

  it("rejects a negative --limit", () => {
    // "--limit=-5" (one token) avoids node:util's parseArgs treating a
    // separate "-5" token as an ambiguous option-like value.
    const result = run(["--dry-run", "--limit=-5"], withoutApiKey());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/positive integer/i);
  });

  it("rejects a non-numeric --limit", () => {
    const result = run(["--dry-run", "--limit", "abc"], withoutApiKey());
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/positive integer/i);
  });

  it("--help exits 0 and prints usage without touching the corpus or API", () => {
    const result = run(["--help"], withoutApiKey());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Usage: npx tsx scripts\/score-premises\.ts/);
    expect(result.stdout).toMatch(/--format/);
    expect(result.stdout).toMatch(/--dry-run/);
    expect(result.stdout).toMatch(/--limit/);
    expect(result.stdout).toMatch(/--verbose/);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// --dry-run --limit 5 — the acceptance criterion.
// ---------------------------------------------------------------------------
describe("--dry-run --limit 5", () => {
  it("runs to completion with no ANTHROPIC_API_KEY set", () => {
    const result = run(["--dry-run", "--limit", "5"], withoutApiKey());
    expect(result.status).toBe(0);
  });

  it("caps each scored format's processed count at 5", () => {
    const result = run(["--dry-run", "--limit", "5"], withoutApiKey());
    expect(result.stdout).toMatch(/The Wall: \d+ gate survivors, processing 5/);
    expect(result.stdout).toMatch(/The Question: \d+ gate survivors, processing 5/);
    expect(result.stdout).toMatch(/The Objection: \d+ gate survivors, processing 5/);
    expect(result.stdout).toMatch(/The Still: \d+ gate survivors, processing 5/);
  });

  it("reports exactly 5 requests per scored format", () => {
    const result = run(["--dry-run", "--limit", "5"], withoutApiKey());
    const wallLine = result.stdout.match(/The Wall:.*\n\s*Requests: (\d+)/);
    const questionLine = result.stdout.match(/The Question:.*\n\s*Requests: (\d+)/);
    const objectionLine = result.stdout.match(/The Objection:.*\n\s*Requests: (\d+)/);
    expect(wallLine?.[1]).toBe("5");
    expect(questionLine?.[1]).toBe("5");
    expect(objectionLine?.[1]).toBe("5");
  });

  it("never constructs an SDK client or spends any tokens (no Cost Report emitted)", () => {
    const result = run(["--dry-run", "--limit", "5"], withoutApiKey());
    expect(result.status).toBe(0);
    expect(result.stderr).not.toMatch(/Cost Report/);
  });

  it("writes no pool files", () => {
    const result = run(["--dry-run", "--limit", "5"], withoutApiKey());
    expect(result.stdout).not.toMatch(/Wrote \d+ entries/);
  });
}, 30_000);

// ---------------------------------------------------------------------------
// --format still — gate-only, no LLM rubric.
// ---------------------------------------------------------------------------
describe("--format still", () => {
  it("reports the gate-only pool and explicitly states it has no LLM scoring", () => {
    const result = run(["--dry-run", "--format", "still", "--limit", "5"], withoutApiKey());
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/The Still:/);
    expect(result.stdout).toMatch(/gate-only/i);
    expect(result.stdout).toMatch(/no LLM rubric/i);
    // Never builds/submits a request for Still.
    expect(result.stdout).not.toMatch(/The Still:[\s\S]*Requests:/);
  });

  it("does not appear alongside Wall/Question/Objection request counts when run alone", () => {
    const result = run(["--dry-run", "--format", "still", "--limit", "5"], withoutApiKey());
    expect(result.stdout).not.toMatch(/The Wall:/);
    expect(result.stdout).not.toMatch(/The Question:/);
    expect(result.stdout).not.toMatch(/The Objection:/);
  });
}, 15_000);
