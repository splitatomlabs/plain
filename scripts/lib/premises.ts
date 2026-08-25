import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Card } from "./types.js";

// ---------------------------------------------------------------------------
// T01: Mechanical gates — word counts, opener detection, quoted speech,
// book filter, length delta. No LLM calls; every predicate here is pure and
// deterministic so the scoring pipeline (T07+) only spends API calls on
// survivors.
// ---------------------------------------------------------------------------

/**
 * Words that make a sentence read as a continuation rather than a
 * self-contained opening line (e.g. "But he was wrong." reads mid-argument).
 * Matched case-insensitively at a word boundary against the start of text.
 * Exported so T02 (landing-line gate) and T04 (question validation) can
 * reuse the same list.
 */
export const SELF_CONTAINED_OPENING_REJECTS = ["But", "So", "This", "It", "And"] as const;

const OPENER_RE = new RegExp(`^(${SELF_CONTAINED_OPENING_REJECTS.join("|")})\\b`, "i");

/**
 * Load every card in the corpus from `content/output`.
 * Skips `_meta.json` per book directory and top-level files like
 * `authors.json`. Returns cards in a deterministic order: book directories
 * sorted by name, then chapter files sorted by name within each book.
 */
export function loadCorpus(dir = "content/output"): Card[] {
  const outputDir = path.resolve(dir);

  const bookSlugs = readdirSync(outputDir)
    .filter((entry) => {
      try {
        return statSync(path.join(outputDir, entry)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();

  const cards: Card[] = [];
  for (const slug of bookSlugs) {
    const bookDir = path.join(outputDir, slug);
    const files = readdirSync(bookDir)
      .filter((f) => f.endsWith(".json") && f !== "_meta.json")
      .sort();
    for (const file of files) {
      const raw = readFileSync(path.join(bookDir, file), "utf-8");
      const parsed = JSON.parse(raw) as Card[];
      cards.push(...parsed);
    }
  }
  return cards;
}

/** Word count matching the corpus-fact definition: whitespace-split, empty tokens dropped. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * False when `text` opens with But/So/This/It/And (case-insensitive, word
 * boundary) — i.e. it reads as a continuation, not a self-contained line.
 */
export function isSelfContainedOpening(text: string): boolean {
  return !OPENER_RE.test(text.trim());
}

/**
 * Split text into sentences on `.`/`!`/`?`. Simple by design — this is a
 * mechanical gate, not a full sentence tokenizer.
 */
export function sentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const matches = trimmed.match(/[^.!?]+[.!?]*/g);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [trimmed];
}

/** The first sentence of `text`, or the whole trimmed text if no terminator is found. */
export function firstSentence(text: string): string {
  const found = sentences(text);
  return found.length ? found[0] : text.trim();
}

/** True when `text` contains 2 or more `"` characters (the quoted-speech gate). */
export function hasQuotedSpeech(text: string): boolean {
  return (text.match(/"/g) ?? []).length >= 2;
}

/** original_excerpt word count minus plain_english word count. */
export function lengthDelta(card: Card): number {
  return wordCount(card.original_excerpt) - wordCount(card.plain_english);
}

/** Cards whose `book_slug` is in `slugs`. */
export function byBook(cards: Card[], slugs: string[]): Card[] {
  const set = new Set(slugs);
  return cards.filter((c) => set.has(c.book_slug));
}

export interface MechanicalGateResult {
  ids: string[];
  count: number;
}

export interface MechanicalGates {
  /** The Wall: original_excerpt >= 80 words. Measured: 1,326. */
  wallLength: MechanicalGateResult;
  /**
   * The Still: first sentence of plain_english <= 12 words AND a
   * self-contained opening (not leading But/So/This/It/And).
   *
   * The plan estimated 674 for this gate; that number was not reproducible
   * under any definition tried. The closest clean definition — the one
   * implemented here — measures 739, not the plan's alternate estimate of
   * 740. This implementation's <=11-word cross-check (651) matches the
   * plan's own stated anchor exactly, which is why 739 (not 740) is
   * asserted as correct for <=12 in the test suite. Do not contort this
   * definition to hit either estimate.
   */
  still12Word: MechanicalGateResult;
  /** The Objection precursor: plain_english contains >= 2 `"` characters. Measured: 308. */
  quotedSpeech: MechanicalGateResult;
  /** original_excerpt word count exceeds plain_english word count by >= 30. Measured: 318. */
  lengthDelta30: MechanicalGateResult;
}

function gateResult(cards: Card[], predicate: (card: Card) => boolean): MechanicalGateResult {
  const ids = cards.filter(predicate).map((c) => c.id);
  return { ids, count: ids.length };
}

/**
 * Run all mechanical gates over `cards` and return the per-gate id sets and
 * counts. Pure and deterministic — no LLM calls.
 */
export function mechanicalGates(cards: Card[]): MechanicalGates {
  return {
    wallLength: gateResult(cards, (c) => wordCount(c.original_excerpt) >= 80),
    still12Word: gateResult(
      cards,
      (c) => wordCount(firstSentence(c.plain_english)) <= 12 && isSelfContainedOpening(c.plain_english),
    ),
    quotedSpeech: gateResult(cards, (c) => hasQuotedSpeech(c.plain_english)),
    lengthDelta30: gateResult(cards, (c) => lengthDelta(c) >= 30),
  };
}
