import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { callClaudeJSON, ClaudeCliError } from "./claude.js";
import type { Card, ValidationMessage } from "./types.js";

const CACHE_DIR = "output/validation-cache";

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

function cacheKey(card: Card): string {
  const hash = createHash("sha256")
    .update(card.plain_english + "\n" + card.original_excerpt)
    .digest("hex")
    .slice(0, 16);
  return `${card.id}-${hash}`;
}

async function readCache<T>(key: string): Promise<T | null> {
  const filePath = path.join(CACHE_DIR, `${key}.json`);
  if (!existsSync(filePath)) return null;
  try {
    const data = await readFile(filePath, "utf-8");
    return JSON.parse(data) as T;
  } catch {
    return null;
  }
}

async function writeCache(key: string, data: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  await writeFile(
    path.join(CACHE_DIR, `${key}.json`),
    JSON.stringify(data, null, 2),
  );
}

// ---------------------------------------------------------------------------
// T09: Single-idea check
// ---------------------------------------------------------------------------

interface SingleIdeaResponse {
  single_idea: boolean;
  suggestion?: string;
}

export async function validateSingleIdea(
  card: Card,
  useCache: boolean = true,
): Promise<ValidationMessage[]> {
  const key = `single-idea-${cacheKey(card)}`;

  if (useCache) {
    const cached = await readCache<SingleIdeaResponse>(key);
    if (cached) return singleIdeaToMessages(card.id, cached);
  }

  try {
    const result = await callClaudeJSON<SingleIdeaResponse>(
      `Analyze this card text. Does it contain a single coherent idea, or does it contain multiple distinct ideas that should be separate cards?

Card text:
"""
${card.plain_english}
"""

Respond with JSON: { "single_idea": boolean, "suggestion"?: string }
If multiple ideas, include a suggestion describing where to split.`,
      '{ "single_idea": boolean, "suggestion"?: string }',
    );

    await writeCache(key, result);
    return singleIdeaToMessages(card.id, result);
  } catch (e) {
    return [
      {
        severity: "warn",
        card_id: card.id,
        message: `Semantic check (single-idea) failed to parse: ${e instanceof ClaudeCliError ? e.message : String(e)}`,
      },
    ];
  }
}

function singleIdeaToMessages(
  cardId: string,
  result: SingleIdeaResponse,
): ValidationMessage[] {
  if (result.single_idea) return [];
  return [
    {
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Card may contain multiple ideas. ${result.suggestion ?? "Consider splitting."}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// T10: Standalone coherence
// ---------------------------------------------------------------------------

interface StandaloneResponse {
  standalone: boolean;
  resolution?: string;
}

export async function validateStandalone(
  card: Card,
  prevCard: Card | null,
  nextCard: Card | null,
  useCache: boolean = true,
): Promise<ValidationMessage[]> {
  const key = `standalone-${cacheKey(card)}`;

  if (useCache) {
    const cached = await readCache<StandaloneResponse>(key);
    if (cached) return standaloneToMessages(card.id, cached);
  }

  let contextSection = "";
  if (prevCard) {
    contextSection += `\nPrevious card:\n"""\n${prevCard.plain_english}\n"""`;
  }
  if (nextCard) {
    contextSection += `\nNext card:\n"""\n${nextCard.plain_english}\n"""`;
  }

  try {
    const result = await callClaudeJSON<StandaloneResponse>(
      `Analyze whether this card makes sense on its own to a reader with no surrounding context. Or does it depend on an adjacent card to be understood?

Card text:
"""
${card.plain_english}
"""
${contextSection}

Respond with JSON: { "standalone": boolean, "resolution"?: string }
If not standalone, include a resolution (e.g. "merge with previous card" or "add brief context phrase").`,
      '{ "standalone": boolean, "resolution"?: string }',
    );

    await writeCache(key, result);
    return standaloneToMessages(card.id, result);
  } catch (e) {
    return [
      {
        severity: "warn",
        card_id: card.id,
        message: `Semantic check (standalone) failed to parse: ${e instanceof ClaudeCliError ? e.message : String(e)}`,
      },
    ];
  }
}

function standaloneToMessages(
  cardId: string,
  result: StandaloneResponse,
): ValidationMessage[] {
  if (result.standalone) return [];
  return [
    {
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Card may not stand alone. ${result.resolution ?? "Consider adding context."}`,
    },
  ];
}

// ---------------------------------------------------------------------------
// T11: Meaning preservation
// ---------------------------------------------------------------------------

interface MeaningResponse {
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  notes?: string;
}

export async function validateMeaningPreservation(
  card: Card,
  useCache: boolean = true,
): Promise<ValidationMessage[]> {
  const key = `meaning-${cacheKey(card)}`;

  if (useCache) {
    const cached = await readCache<MeaningResponse>(key);
    if (cached) return meaningToMessages(card.id, cached);
  }

  try {
    const result = await callClaudeJSON<MeaningResponse>(
      `Compare the original excerpt with its plain English translation. Assess:
(a) Does the translation preserve the original meaning precisely?
(b) Does it preserve the emotional tone?
(c) Are any ideas added or removed?
(d) Does it over-explain or patronize?

Original:
"""
${card.original_excerpt}
"""

Plain English:
"""
${card.plain_english}
"""

Respond with JSON: { "faithful": boolean, "tone_preserved": boolean, "ideas_changed": boolean, "over_explains": boolean, "notes"?: string }`,
      '{ "faithful": boolean, "tone_preserved": boolean, "ideas_changed": boolean, "over_explains": boolean, "notes"?: string }',
    );

    await writeCache(key, result);
    return meaningToMessages(card.id, result);
  } catch (e) {
    return [
      {
        severity: "warn",
        card_id: card.id,
        message: `Semantic check (meaning) failed to parse: ${e instanceof ClaudeCliError ? e.message : String(e)}`,
      },
    ];
  }
}

function meaningToMessages(
  cardId: string,
  result: MeaningResponse,
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (!result.faithful) {
    msgs.push({
      severity: "error",
      card_id: cardId,
      field: "plain_english",
      message: `Meaning not faithfully preserved. ${result.notes ?? ""}`.trim(),
    });
  }

  if (!result.tone_preserved) {
    msgs.push({
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Emotional tone may have drifted. ${result.notes ?? ""}`.trim(),
    });
  }

  if (result.ideas_changed) {
    msgs.push({
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Ideas may have been added or removed. ${result.notes ?? ""}`.trim(),
    });
  }

  if (result.over_explains) {
    msgs.push({
      severity: "info",
      card_id: cardId,
      field: "plain_english",
      message: `Translation may over-explain. ${result.notes ?? ""}`.trim(),
    });
  }

  return msgs;
}

// ---------------------------------------------------------------------------
// T12: Semantic validation orchestrator
// ---------------------------------------------------------------------------

export async function runSemanticValidation(
  cards: Card[],
  useCache: boolean = true,
): Promise<ValidationMessage[]> {
  const msgs: ValidationMessage[] = [];
  const total = cards.length;

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const prev = i > 0 ? cards[i - 1] : null;
    const next = i < cards.length - 1 ? cards[i + 1] : null;

    process.stderr.write(
      `Semantic check ${i + 1}/${total}: ${card.id}...\n`,
    );

    // Run all three checks sequentially (one Claude call at a time)
    const singleIdeaMsgs = await validateSingleIdea(card, useCache);
    msgs.push(...singleIdeaMsgs);

    const standaloneMsgs = await validateStandalone(card, prev, next, useCache);
    msgs.push(...standaloneMsgs);

    const meaningMsgs = await validateMeaningPreservation(card, useCache);
    msgs.push(...meaningMsgs);
  }

  return msgs;
}
