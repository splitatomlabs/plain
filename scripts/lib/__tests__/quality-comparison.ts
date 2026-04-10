/**
 * T03: Quality comparison — Opus vs Sonnet on 5 representative chunks.
 *
 * Uses the actual parser + chunker to get real pipeline chunks.
 * Usage: ANTHROPIC_API_KEY=sk-... npx tsx scripts/lib/__tests__/quality-comparison.ts
 */

import { readFile } from "node:fs/promises";
import Anthropic from "@anthropic-ai/sdk";
import { BOOK_CONFIGS } from "../constants.js";
import { parseSourceText } from "../parser.js";
import { chunkSections, type Chunk } from "../chunker.js";
import { buildTranslationPrompt } from "../prompt.js";

const client = new Anthropic();

// Models to compare
const OPUS = "claude-opus-4-20250514";
const SONNET = "claude-sonnet-4-20250514";

interface ChunkPick {
  label: string;
  bookSlug: string;
  criteria: (chunks: Chunk[]) => Chunk | undefined;
}

// 5 representative picks per the plan
const PICKS: ChunkPick[] = [
  {
    label: "1-EASY (short, simple language)",
    bookSlug: "enchiridion",
    criteria: (chunks) =>
      chunks.find(
        (c) =>
          c.text.length > 80 &&
          c.text.length < 300 &&
          !c.text.includes("thou") &&
          !c.text.includes("hast"),
      ),
  },
  {
    label: "2-LONG (300+ words)",
    bookSlug: "meditations",
    criteria: (chunks) =>
      chunks.find((c) => c.text.split(/\s+/).length > 300),
  },
  {
    label: "3-ARCHAIC (thou/thee/hast language)",
    bookSlug: "enchiridion",
    criteria: (chunks) =>
      chunks.find(
        (c) =>
          /\b(thou|thee|hast|doth|thy|forbear)\b/i.test(c.text) &&
          c.text.length > 100,
      ),
  },
  {
    label: "4-SENECA (conversational tone, Peace of Mind)",
    bookSlug: "peace-of-mind",
    criteria: (chunks) =>
      chunks.find((c) => c.text.length > 150 && c.text.length < 800),
  },
  {
    label: "5-FRAGMENT (very short, 1-2 sentences)",
    bookSlug: "meditations",
    criteria: (chunks) =>
      chunks.find(
        (c) => c.text.length > 30 && c.text.length < 120,
      ),
  },
];

async function getChunks(bookSlug: string): Promise<Chunk[]> {
  const config = BOOK_CONFIGS.find((b) => b.slug === bookSlug)!;
  const text = await readFile(config.source_file, "utf-8");
  const parsed = parseSourceText(text, config);
  const allChunks: Chunk[] = [];
  for (const ch of parsed.chapters) {
    allChunks.push(...chunkSections(ch.sections, config.speakerLabels));
  }
  return allChunks;
}

async function translate(
  chunk: Chunk,
  bookSlug: string,
  model: string,
): Promise<{ text: string; usage: Anthropic.Usage; elapsed: number }> {
  const config = BOOK_CONFIGS.find((b) => b.slug === bookSlug)!;
  const prompt = buildTranslationPrompt(chunk, config);
  const start = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });
  const elapsed = Date.now() - start;
  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  return { text, usage: response.usage, elapsed };
}

async function main() {
  console.log("T03: Quality comparison — Opus vs Sonnet\n");

  // Load all needed books
  const chunksByBook = new Map<string, Chunk[]>();
  const neededBooks = [...new Set(PICKS.map((p) => p.bookSlug))];
  for (const slug of neededBooks) {
    chunksByBook.set(slug, await getChunks(slug));
  }

  // Select chunks
  const selected: { label: string; bookSlug: string; chunk: Chunk }[] = [];
  for (const pick of PICKS) {
    const chunks = chunksByBook.get(pick.bookSlug)!;
    const chunk = pick.criteria(chunks);
    if (!chunk) {
      console.log(`  WARN: no chunk matched for ${pick.label}`);
      continue;
    }
    selected.push({ label: pick.label, bookSlug: pick.bookSlug, chunk });
    console.log(
      `  ${pick.label}: section ${chunk.sectionNumber} (${chunk.text.length} chars, ${chunk.text.split(/\s+/).length} words)`,
    );
  }

  console.log(`\nRunning ${selected.length} chunks x 2 models...\n`);

  // Run each chunk through both models
  for (const { label, bookSlug, chunk } of selected) {
    console.log(`\n${"=".repeat(70)}`);
    console.log(`CHUNK: ${label}`);
    console.log(`Original (${chunk.text.split(/\s+/).length} words):`);
    console.log(chunk.text.slice(0, 200) + (chunk.text.length > 200 ? "..." : ""));

    const [opusResult, sonnetResult] = await Promise.all([
      translate(chunk, bookSlug, OPUS),
      translate(chunk, bookSlug, SONNET),
    ]);

    for (const [name, result] of [
      ["OPUS", opusResult],
      ["SONNET", sonnetResult],
    ] as const) {
      console.log(`\n  --- ${name} (${result.elapsed}ms) ---`);
      try {
        const parsed = JSON.parse(result.text);
        console.log(`  Translation: ${parsed.plain_english?.slice(0, 300)}${(parsed.plain_english?.length ?? 0) > 300 ? "..." : ""}`);
        console.log(`  Tags: ${JSON.stringify(parsed.tags)}`);
        console.log(`  Faithful: ${parsed.faithful}, Tone: ${parsed.tone_preserved}, Ideas changed: ${parsed.ideas_changed}`);
      } catch {
        console.log(`  [raw response - not JSON]: ${result.text.slice(0, 300)}`);
      }
      console.log(
        `  Tokens: ${result.usage.input_tokens} in / ${result.usage.output_tokens} out`,
      );
    }
  }

  console.log(`\n${"=".repeat(70)}`);
  console.log("DONE — review outputs above for FKGL, faithfulness, and tone.");
}

main().catch((e) => {
  console.error("Quality comparison failed:", e);
  process.exit(1);
});
