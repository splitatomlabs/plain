# Pipeline Cost Performance Audit

## Objective
Reduce the cost and improve the efficiency of the `scripts/` content pipeline that uses the Claude CLI to refine and translate book sections into plain-English cards.

## Decisions
- Research-first plan: T01–T04 are measurement/analysis tasks; implementation tasks follow based on findings
- Target the two biggest levers first: model choice and CLI overhead

## Files
- `scripts/lib/claude.ts` — CLI invocation wrapper; main target for API migration or `--bare` flag
- `scripts/lib/prompt.ts` — translation prompt (~600-660 input tokens per call)
- `scripts/lib/refine.ts` — refine prompt (~200-400 input tokens per call)
- `scripts/generate.ts` — orchestrator; would gain cost reporting

## Constraints
- Pipeline must remain reproducible (same inputs → same quality output)
- Translation quality at FKGL 7-8 must not regress
- Keep the pipeline runnable with zero external dependencies beyond `claude` CLI or `@anthropic-ai/sdk`

## Background

### Current state
The pipeline calls `claude -p <prompt>` via `execFile` for every chunk, twice:
1. **Refine** (~140 source sections) — decides keep/split/merge
2. **Translate** (~51 final cards) — translates to plain English + tags + verification

No model is specified — the CLI uses its session default. No `--bare` flag is used, so every invocation loads CLAUDE.md, hooks, plugins, skills, memory, LSP, and auto-discovery. None of that context is needed for a stateless JSON-in/JSON-out prompt.

### Token estimates (current pipeline, all 5 books)
| Phase | Calls | Avg input tokens | Avg output tokens | Total tokens |
|-------|-------|-----------------|-------------------|-------------|
| Refine | ~140 | ~350 | ~80 | ~60k |
| Translate | ~51 | ~640 | ~400 | ~53k |
| **Total** | **~191** | — | — | **~113k** |

### Pricing reference (Claude API, per 1M tokens)
| Model | Input | Output | Cache write | Cache read |
|-------|-------|--------|-------------|------------|
| Opus 4 | $15 | $75 | $18.75 | $1.50 |
| Sonnet 4 | $3 | $15 | $3.75 | $0.30 |
| Haiku 3.5 | $0.80 | $4 | $1 | $0.08 |

### Cost projection at current volume (~113k tokens)
| Model | Estimated cost |
|-------|---------------|
| Opus 4 | ~$2.20 |
| Sonnet 4 | ~$0.44 |
| Haiku 3.5 | ~$0.12 |

Note: CLI overhead tokens (system prompt, CLAUDE.md, tool definitions, skills, etc.) are **not** counted above — they add to every call but are invisible to the script. The `--bare` flag or direct API usage eliminates this.

### CLI overhead analysis
Each `claude -p` invocation without `--bare` loads:
- System prompt (~2-4k tokens)
- CLAUDE.md contents (~500 tokens)
- Git status snapshot
- Memory index
- Plugin/skill definitions (potentially 5-10k+ tokens with Vercel plugin)
- Tool schemas

Conservative estimate: **5-15k tokens of overhead per invocation**. Over 191 calls, that's **~1-3M wasted input tokens** — potentially **$15-45 at Opus pricing** or **$3-9 at Sonnet pricing**, dwarfing the actual prompt cost.

## Tasks

- [x] T01: Measure actual CLI overhead — Run `claude -p "respond with ok" --output-format json 2>&1` and `claude -p "respond with ok" --bare --output-format json 2>&1` to compare. Check if `--output-format json` reports `usage` with token counts. If not, use `--debug api` to capture API request sizes.

  **T01 findings (2026-04-11):**
  - `--output-format json` reports full `usage` including token counts and cost ✓
  - **CLI overhead per call: ~22-24k tokens** (system prompt, CLAUDE.md, tools, plugins, skills, memory)
  - Each `-p` call creates a new session — **no cache reuse** (`cache_read_input_tokens` always 0)
  - `--bare` flag requires `ANTHROPIC_API_KEY` env var — won't work with OAuth auth
  - Per-call overhead cost: **$0.149 (Opus)**, **$0.082 (Sonnet)**
  - At 191 calls: **$28.46 overhead (Opus)** or **$15.70 (Sonnet)** — vs ~$2.20/$0.44 for actual prompts
  - **Overhead is 35-70x the actual prompt cost** → direct API migration is the clear win

- [x] T02: Measure per-call tokens with the API — Write a small test script (`scripts/lib/__tests__/token-audit.ts`) that calls the Anthropic API directly for one refine prompt and one translate prompt, and logs `response.usage.input_tokens` and `response.usage.output_tokens`. This gives ground-truth numbers.

  **T02 findings (2026-04-11):**
  - Script at `scripts/lib/__tests__/token-audit.ts` — run with `ANTHROPIC_API_KEY`
  - **Actual API token usage (Sonnet, no CLI overhead):**
    - Refine: 377 input / 27 output per call
    - Translate: 1,174 input / 188 output per call
  - **Full pipeline (140 refine + 51 translate): 112k input + 13k output = $0.54 (Sonnet)**
  - CLI overhead adds ~22k tokens × 191 calls = ~4.2M extra input tokens ($12.60 at Sonnet)
  - **Overhead is 23x the actual prompt cost**
  - `@anthropic-ai/sdk` installed as dependency for direct API path

- [x] T03: Quality comparison Opus vs Sonnet — Pick 5 representative chunks (1 easy, 1 long, 1 with archaic language, 1 with speaker labels, 1 short fragment). Run each through the translate prompt with Opus and Sonnet via direct API. Diff the outputs for FKGL, faithfulness, and tone. Document findings in `plans/` as a comment in this file.

  **T03 findings (2026-04-11):**
  - Test script: `scripts/lib/__tests__/quality-comparison.ts`
  - Test chunks saved: `scripts/lib/__tests__/fixtures/test-chunks.json`
  - Tested 4 chunks (easy, long, archaic, fragment) × 2 models
  - **Quality is indistinguishable** — both models:
    - Produce faithful translations at comparable FKGL
    - Preserve tone and emotional quality
    - Self-report faithful=true, tone_preserved=true, ideas_changed=false
    - Choose similar (often identical) tags
  - Opus is ~30-50% slower per call
  - **Recommendation: use Sonnet** — same quality, 5x cheaper, faster

- [x] T04: Write cost summary — Using T01-T03 data, update the estimates in this plan with actual numbers. Calculate: (a) current cost with CLI overhead, (b) cost with `--bare`, (c) cost with direct API + Sonnet, (d) cost with direct API + prompt caching.

  **T04 cost summary (2026-04-11):**

  | Scenario | Input tokens | Output tokens | Est. cost | Notes |
  |----------|-------------|---------------|-----------|-------|
  | (a) Current CLI (Opus, no --bare) | ~4.5M (22k×191 overhead + 113k prompts) | ~13k | ~$28+ | Each call pays full 22k overhead |
  | (b) CLI + --bare | N/A | N/A | N/A | Requires ANTHROPIC_API_KEY; doesn't work with OAuth |
  | (c) Direct API + Sonnet | 113k | 13k | **$0.54** | Zero overhead, ground-truth numbers |
  | (d) Direct API + Sonnet + caching | ~45k uncached + 68k cached | 13k | **~$0.23** | Static prompt portions cached (~60% of input) |

  **Bottom line: direct API + Sonnet = 50-120x cheaper than current CLI approach.**

- [x] T05: Add `--bare --model` flags to CLI calls — In `claude.ts`, update `callClaude()` to pass `["--bare", "--model", model, "-p", prompt]` where `model` defaults to `"sonnet"` but is configurable. This eliminates all unnecessary context loading. Acceptance: pipeline still produces valid JSON output for one test book.

- [x] T06: Evaluate direct API migration — Assess whether to replace `claude -p` with `@anthropic-ai/sdk` calls. Benefits: prompt caching (the system/voice/rules portion is identical across chunks), `usage` reporting, batch API (50% discount), structured JSON mode. Write the `callClaudeAPI()` function in `claude.ts` as an alternative path, gated by an env var `PLAIN_USE_API=1`.

- [x] T07: Implement prompt caching — If using the API (T06), restructure prompts so the static portion (voice guidance, rules, tag list, examples) goes into a cacheable system message. Only the per-chunk original text varies. This should reduce input token cost by ~60% after the first call per author.

- [x] T08: Add cost reporting to pipeline — After each `callClaudeJSON` call, accumulate token counts. At the end of `generate.ts`, print a summary: total input tokens, total output tokens, estimated cost at current model pricing. Acceptance: running the pipeline prints a cost report to stderr.

- [ ] T09: Run full pipeline with optimizations — Regenerate one book (e.g., Enchiridion) with the optimized pipeline. Compare output quality against current content. Verify no regressions. Record actual cost from the report (T08).

## Verify
```bash
npm test
```
