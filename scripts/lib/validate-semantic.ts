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
// Combined semantic check — one Claude call per card
// ---------------------------------------------------------------------------

interface SemanticCheckResponse {
  single_idea: boolean;
  single_idea_suggestion?: string;
  standalone: boolean;
  standalone_resolution?: string;
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  notes?: string;
}

function buildSemanticPrompt(
  card: Card,
  prevCard: Card | null,
  nextCard: Card | null,
): string {
  let adjacentContext = "";
  if (prevCard) {
    adjacentContext += `\nPrevious card:\n"""\n${prevCard.plain_english}\n"""\n`;
  }
  if (nextCard) {
    adjacentContext += `\nNext card:\n"""\n${nextCard.plain_english}\n"""\n`;
  }

  return `Evaluate this card on three dimensions. Be concise.

ORIGINAL TEXT:
"""
${card.original_excerpt}
"""

PLAIN ENGLISH TRANSLATION:
"""
${card.plain_english}
"""
${adjacentContext}
Check all three:

1. SINGLE IDEA — Does the plain English contain one coherent idea, or multiple ideas that should be separate cards?
2. STANDALONE — Does the plain English make sense on its own without surrounding context?
3. MEANING — Does the translation (a) preserve the original meaning, (b) preserve emotional tone, (c) avoid adding/removing ideas, (d) avoid over-explaining?

Respond with ONLY this JSON (no other text):

{
  "single_idea": true,
  "single_idea_suggestion": null,
  "standalone": true,
  "standalone_resolution": null,
  "faithful": true,
  "tone_preserved": true,
  "ideas_changed": false,
  "over_explains": false,
  "notes": null
}

Set booleans to false and fill in the string fields when there are problems. Keep string fields short (one sentence).`;
}

function responseToMessages(
  cardId: string,
  result: SemanticCheckResponse,
): ValidationMessage[] {
  const msgs: ValidationMessage[] = [];

  if (!result.single_idea) {
    msgs.push({
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Card may contain multiple ideas. ${result.single_idea_suggestion ?? "Consider splitting."}`,
    });
  }

  if (!result.standalone) {
    msgs.push({
      severity: "warn",
      card_id: cardId,
      field: "plain_english",
      message: `Card may not stand alone. ${result.standalone_resolution ?? "Consider adding context."}`,
    });
  }

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
// Public API
// ---------------------------------------------------------------------------

export async function validateCardSemantic(
  card: Card,
  prevCard: Card | null,
  nextCard: Card | null,
  useCache: boolean = true,
): Promise<ValidationMessage[]> {
  const key = `semantic-${cacheKey(card)}`;

  if (useCache) {
    const cached = await readCache<SemanticCheckResponse>(key);
    if (cached) return responseToMessages(card.id, cached);
  }

  try {
    const prompt = buildSemanticPrompt(card, prevCard, nextCard);
    const result = await callClaudeJSON<SemanticCheckResponse>(prompt);
    await writeCache(key, result);
    return responseToMessages(card.id, result);
  } catch (e) {
    return [
      {
        severity: "warn",
        card_id: card.id,
        message: `Semantic check failed to parse: ${e instanceof ClaudeCliError ? e.message : String(e)}`,
      },
    ];
  }
}

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

    const cardMsgs = await validateCardSemantic(card, prev, next, useCache);
    msgs.push(...cardMsgs);
  }

  return msgs;
}
