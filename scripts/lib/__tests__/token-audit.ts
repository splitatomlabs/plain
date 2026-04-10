/**
 * T02: Token audit — measure actual input/output tokens for refine and translate
 * prompts via the Anthropic API directly (no CLI overhead).
 *
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/lib/__tests__/token-audit.ts
 */

import Anthropic from "@anthropic-ai/sdk";
import { BOOK_CONFIGS } from "../constants.js";
import { buildTranslationPrompt } from "../prompt.js";

const client = new Anthropic();

// Sample chunks representative of the pipeline
const SAMPLE_REFINE_CHUNK = {
  sectionNumber: 1,
  text: `There are things which are within our power, and there are things which are beyond our power. Within our power are opinion, aim, desire, aversion, and, in one word, whatever affairs are our own. Beyond our power are body, property, reputation, office, and, in one word, whatever are not properly our own affairs.`,
};

const SAMPLE_TRANSLATE_CHUNK = {
  sectionNumber: 5,
  text: `Men are disturbed not by things, but by the views which they take of things. Thus death is nothing terrible, else it would have appeared so to Socrates. But the terror consists in our notion of death, that it is terrible. When, therefore, we are hindered or disturbed, or grieved, let us never impute it to others, but to ourselves—that is, to our own views. It is the action of an uninstructed person to reproach others for his own misfortunes; of one entering upon instruction, to reproach himself; and one perfectly instructed, to reproach neither others nor himself.`,
};

const enchiridionConfig = BOOK_CONFIGS.find((b) => b.slug === "enchiridion")!;

// Build prompts identical to what the pipeline uses
function buildRefinePrompt(chunk: typeof SAMPLE_REFINE_CHUNK): string {
  return `You are preparing sections from "The Enchiridion" for translation into bite-sized reading cards. Each card will be translated into plain English at an 8th-grade reading level.

A good card:
- Contains ONE coherent idea
- Makes sense on its own to a reader with no surrounding context
- Is roughly 50-300 words (shorter is fine if the idea is complete; longer sections with multiple ideas should be split)

AUTHOR CONTEXT: Epictetus is direct and instructional. His sections are short, punchy lessons — most work well as standalone cards. Very short sections (a sentence or two) are common and may need merging.

Evaluate this section and decide what to do with it.

CURRENT SECTION (section ${chunk.sectionNumber}):
"""
${chunk.text}
"""

Choose ONE action:

1. "keep" — This section contains a single idea and stands alone. No changes needed.
2. "split" — This section contains multiple distinct ideas. Split it into separate segments.
3. "merge_next" — This section is too dependent on the next section to stand alone.
4. "merge_prev" — This section is too dependent on the previous section to stand alone.

Respond with ONLY this JSON (no other text):

{
  "action": "keep",
  "segments": null,
  "reason": null
}`;
}

async function measureCall(
  label: string,
  prompt: string,
  model: "claude-sonnet-4-20250514",
) {
  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });
  const elapsed = Date.now() - start;

  console.log(`\n--- ${label} (${model}) ---`);
  console.log(`  Input tokens:  ${response.usage.input_tokens}`);
  console.log(`  Output tokens: ${response.usage.output_tokens}`);
  console.log(`  Elapsed:       ${elapsed}ms`);
  console.log(`  Stop reason:   ${response.stop_reason}`);

  return response.usage;
}

async function main() {
  console.log("Token audit: measuring actual API token usage\n");

  const refinePrompt = buildRefinePrompt(SAMPLE_REFINE_CHUNK);
  const translatePrompt = buildTranslationPrompt(
    SAMPLE_TRANSLATE_CHUNK,
    enchiridionConfig,
  );

  console.log(`Refine prompt length:    ${refinePrompt.length} chars`);
  console.log(`Translate prompt length: ${translatePrompt.length} chars`);

  // Measure with Sonnet (likely production model)
  const refineSonnet = await measureCall(
    "Refine",
    refinePrompt,
    "claude-sonnet-4-20250514",
  );
  const translateSonnet = await measureCall(
    "Translate",
    translatePrompt,
    "claude-sonnet-4-20250514",
  );

  // Summary
  console.log("\n=== SUMMARY ===");
  console.log(
    "\nPer-call tokens (no CLI overhead — these are the ground-truth numbers):",
  );
  console.log(
    `  Refine:    ~${refineSonnet.input_tokens} in / ~${refineSonnet.output_tokens} out (Sonnet)`,
  );
  console.log(
    `  Translate: ~${translateSonnet.input_tokens} in / ~${translateSonnet.output_tokens} out (Sonnet)`,
  );

  // Cost projections at full pipeline scale
  const refineCount = 140;
  const translateCount = 51;

  for (const [name, pricing, refineU, translateU] of [
    ["Sonnet", { input: 3, output: 15 }, refineSonnet, translateSonnet],
  ] as const) {
    const totalInput =
      refineCount * refineU.input_tokens +
      translateCount * translateU.input_tokens;
    const totalOutput =
      refineCount * refineU.output_tokens +
      translateCount * translateU.output_tokens;
    const cost =
      (totalInput / 1_000_000) * pricing.input +
      (totalOutput / 1_000_000) * pricing.output;
    console.log(
      `\n  ${name} full pipeline (~${refineCount} refine + ~${translateCount} translate):`,
    );
    console.log(`    Total input:  ${totalInput.toLocaleString()} tokens`);
    console.log(`    Total output: ${totalOutput.toLocaleString()} tokens`);
    console.log(`    Est. cost:    $${cost.toFixed(4)}`);
  }

  console.log(
    "\n  Compare: CLI overhead adds ~22k tokens x 191 calls = ~4.2M extra input tokens",
  );
  console.log(
    "  CLI overhead cost at Sonnet pricing: ~$12.60 (vs pennies for actual prompts)",
  );
}

main().catch((e) => {
  console.error("Token audit failed:", e);
  process.exit(1);
});
