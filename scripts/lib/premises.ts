import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import type { Card } from "./types.js";
import { VALID_AUTHOR_SLUGS, type AuthorSlug } from "./constants.js";

// @ts-expect-error — text-readability has no type declarations
import rs from "text-readability";

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
 * mechanical gate, not a full sentence tokenizer — but it IS quote-aware,
 * because a naive split breaks inside quoted speech and emits garbage
 * (unbalanced quotes, orphaned leading `"` characters).
 *
 * Two rules, both about `"`:
 *  - A terminator (`.`/`!`/`?`) encountered while inside an unclosed quote
 *    does NOT end the sentence UNLESS the very next character is the
 *    closing `"` — i.e. mid-quote punctuation ("Stop. Go on.") stays part
 *    of the same running sentence, but a terminator that IS the end of the
 *    quoted material ("Stop.") still ends it.
 *  - A closing `"` immediately after a terminator is consumed as part of
 *    the sentence it closes, not left to become the next sentence's
 *    leading character (the historical bug: `" If you don't...`).
 *
 * This means a quote spanning several in-character sentences ("We'll do
 * this. But first, that." — one continuous quoted span) is emitted as one
 * long chunk rather than split at the internal periods. That's a
 * deliberate, conservative trade: it never fabricates a broken fragment,
 * and oversized chunks simply fail the landing-line word-count gate later.
 */
export function sentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];

  const results: string[] = [];
  let current = "";
  let quoteOpen = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    current += ch;

    if (ch === '"') {
      quoteOpen = !quoteOpen;
      continue;
    }

    if (ch === "." || ch === "!" || ch === "?") {
      const nextChar = trimmed[i + 1];
      if (quoteOpen && nextChar !== '"') {
        // Mid-quote terminator with more quoted text still to come — this
        // isn't the end of the quotation, so it isn't the end of the
        // sentence either.
        continue;
      }
      // Consume any immediately-following quote/terminator characters
      // (closing quote(s), stacked punctuation like `?!` or `."`) so they
      // stay attached to the sentence they close.
      let j = i + 1;
      while (
        j < trimmed.length &&
        (trimmed[j] === '"' || trimmed[j] === "." || trimmed[j] === "!" || trimmed[j] === "?")
      ) {
        if (trimmed[j] === '"') quoteOpen = !quoteOpen;
        current += trimmed[j];
        j++;
      }
      i = j - 1;
      results.push(current.trim());
      current = "";
    }
  }

  if (current.trim()) results.push(current.trim());
  return results.filter(Boolean);
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

// ---------------------------------------------------------------------------
// T02: The Wall's landing-line gate. Phase 1 shows original_excerpt as a
// wall of dense archaic text that outruns the viewer; phase 2 hard-cuts to
// ONE still, quiet plain-English sentence with zero preceding context. That
// sentence — the landing line — must stand completely alone: a viewer who
// has read nothing else must understand it. It is lifted VERBATIM from
// plain_english (never paraphrased), so on-screen text stays mechanically
// traceable to the card.
// ---------------------------------------------------------------------------

/**
 * Landing-line word-count bounds for The Wall's phase 2 payoff.
 *
 * Lower bound (5): below this, a "sentence" reads as an isolated fragment or
 * a single bare observation — too thin to carry meaning once it's the only
 * text on screen. It needs room for a subject, a verb, and something said
 * about it.
 *
 * Upper bound (18): The Still format already caps its *hook* line at 12
 * words (see MechanicalGates.still12Word) because a hook has to be read
 * while the viewer is still orienting. A landing line is a payoff, not a
 * hook — the viewer has just watched 2-3 seconds of dense text outrun them,
 * then lands on warm paper with zero motion and no countdown, so they're
 * primed to read something a bit longer than a hook. 18 words is roughly the
 * most that still reads as one held breath rather than a paragraph on a
 * single still frame.
 */
export const LANDING_LINE_MIN_WORDS = 5;
export const LANDING_LINE_MAX_WORDS = 18;

/**
 * Pronouns/demonstratives that leave an unresolved reference when a
 * sentence is lifted out of its card with zero preceding context. Broader
 * than SELF_CONTAINED_OPENING_REJECTS, which only covers openers that read
 * as a continuation of an *argument* (But/So/This/It/And) AND only checks
 * the leading word. This list adds subject/object pronouns and
 * demonstratives that instead read as a continuation of a *narrative* —
 * referring back to a person or thing named earlier in the card that the
 * standalone line can't supply — and `hasUnresolvedReference` (below)
 * checks for them ANYWHERE in the sentence, not just at the start.
 *
 * Includes bare "It" even though SELF_CONTAINED_OPENING_REJECTS already
 * rejects it as a leading word: that only catches "It [verb]...", not a
 * mid-sentence "...about it..." ("Husbands and wives fight about it all
 * night." — the pronoun sits mid-sentence, so the leading-word check alone
 * misses it).
 */
export const LANDING_LINE_REFERENCE_REJECTS = [
  "He",
  "She",
  "They",
  "It",
  "Him",
  "Her",
  "Them",
  "His",
  "Hers",
  "Their",
  "Theirs",
  "Its",
  "Itself",
  "Himself",
  "Herself",
  "Themselves",
  "This",
  "These",
  "Those",
  "That",
  "Such",
  "Who",
  "Whom",
  "Whose",
  "Which",
] as const;

const REFERENCE_WORDS = new Set(LANDING_LINE_REFERENCE_REJECTS.map((w) => w.toLowerCase()));
const DEMONSTRATIVES = new Set(["this", "that", "these", "those", "such"]);

/** Third-person personal pronouns/possessives subject to the T02-round-2 number-agreement check. */
const PERSONAL_SINGULAR_PRONOUNS = new Set(["he", "him", "his", "himself", "she", "her", "hers", "herself", "it", "its", "itself"]);
const PERSONAL_PLURAL_PRONOUNS = new Set(["they", "them", "their", "theirs", "themselves"]);
const PERSONAL_PRONOUNS = new Set([...PERSONAL_SINGULAR_PRONOUNS, ...PERSONAL_PLURAL_PRONOUNS]);

/**
 * Blunt verb list used only to detect the narrow non-referential use of
 * `that` as a subordinating conjunction ("the truth is that...", "I know
 * that...") — see `isNonReferentialThat`. Not exhaustive; deliberately
 * conservative so "when in doubt, REJECT" still holds for anything not on
 * this list.
 */
const NON_REFERENTIAL_THAT_VERBS = new Set([
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "know",
  "knew",
  "knows",
  "think",
  "thought",
  "thinks",
  "believe",
  "believed",
  "believes",
  "say",
  "said",
  "says",
  "feel",
  "felt",
  "feels",
  "hope",
  "hoped",
  "hopes",
  "remember",
  "remembered",
  "remembers",
  "understand",
  "understood",
  "understands",
  "realize",
  "realized",
  "realizes",
  "notice",
  "noticed",
  "notices",
  "admit",
  "admitted",
  "admits",
  "argue",
  "argued",
  "argues",
  "insist",
  "insisted",
  "insists",
  "suppose",
  "supposed",
  "supposes",
  "imagine",
  "imagined",
  "imagines",
  "doubt",
  "doubted",
  "doubts",
  "agree",
  "agreed",
  "agrees",
  "prove",
  "proved",
  "proves",
  "show",
  "showed",
  "shows",
  "claim",
  "claimed",
  "claims",
  "state",
  "stated",
  "states",
  "add",
  "added",
  "adds",
  "note",
  "noted",
  "notes",
  "learn",
  "learned",
  "learns",
  "discover",
  "discovered",
  "discovers",
  "find",
  "found",
  "finds",
  "tell",
  "told",
  "tells",
  "explain",
  "explained",
  "explains",
  "ask",
  "asked",
  "asks",
  "reply",
  "replied",
  "replies",
  "answer",
  "answered",
  "answers",
  "decide",
  "decided",
  "decides",
  "determine",
  "determined",
  "determines",
  "see",
  "saw",
  "sees",
  "hear",
  "heard",
  "hears",
  "mean",
  "meant",
  "means",
]);

/**
 * Function/stop words that can never themselves serve as a "plausible
 * antecedent noun" for the earlier-in-line lookback below, even though
 * they're ordinary alphabetic tokens that would otherwise pass a naive
 * "looks like a word" check. Includes the reference words themselves (a
 * pronoun can't resolve another pronoun) and common closed-class words
 * (articles, auxiliaries, conjunctions, prepositions, first/second person
 * pronouns).
 */
const NOT_A_NOUN = new Set([
  ...REFERENCE_WORDS,
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "if",
  "when",
  "while",
  "because",
  "as",
  "is",
  "was",
  "are",
  "were",
  "be",
  "been",
  "being",
  "has",
  "have",
  "had",
  "do",
  "does",
  "did",
  "will",
  "would",
  "can",
  "could",
  "should",
  "must",
  "may",
  "might",
  "not",
  "no",
  "yes",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "from",
  "about",
  "into",
  "than",
  "then",
  "there",
  "here",
  "you",
  "your",
  "yours",
  "i",
  "me",
  "my",
  "mine",
  "we",
  "us",
  "our",
  "ours",
]);

/**
 * Strips leading/trailing punctuation so word-shape checks see clean
 * tokens, then strips a trailing contraction/possessive suffix (`'s`,
 * `'re`, `'ll`, `'ve`, `'d` — e.g. "That's" -> "That", "they're" -> "they",
 * "Marcus's" -> "Marcus") — otherwise a reference word glued to a
 * contraction never matches the exact-word lookups below ("they're" !=
 * "they"). Deliberately excludes `'t` (don't/can't/won't/isn't): those
 * negate a preceding verb, not a reference word, so stripping it would
 * produce a meaningless fragment ("isn't" -> "isn") rather than surface a
 * reference word underneath.
 */
function stripPunctuation(word: string): string {
  const trimmed = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, "");
  return trimmed.replace(/'(s|re|ll|ve|d)$/i, "");
}

/**
 * True when `word` could plausibly be a noun antecedent. A deliberately
 * blunt heuristic — no POS tagging here — that excludes closed-class words
 * and anything too short to be a content word.
 */
function looksLikeNoun(word: string): boolean {
  const clean = stripPunctuation(word);
  if (clean.length < 3) return false;
  return !NOT_A_NOUN.has(clean.toLowerCase());
}

/**
 * Small, curated set of plural group/demonym words that show up in this
 * corpus capitalized ("the Stoics", "the Athenians") — the one case where a
 * capitalized antecedent is legitimately plural. Deliberately a finite
 * whitelist rather than a trailing-`s` heuristic: many singular proper
 * names in this corpus (Marcus, Socrates, Zeus, Chrysippus, Croesus,
 * Pythagoras...) end in `s`, so a trailing-`s` rule would wrongly mark
 * them plural and break `he`/`she`/`it` agreement against exactly the
 * antecedents the original rule relied on.
 */
const KNOWN_PLURAL_PROPER_NOUNS = new Set([
  "stoics",
  "cynics",
  "epicureans",
  "peripatetics",
  "romans",
  "greeks",
  "athenians",
  "spartans",
  "persians",
  "trojans",
  "christians",
  "gods",
]);

/**
 * Deliberately blunt plural heuristic. For ordinary lowercase words this is
 * a trailing-`s` check (no morphology). For capitalized proper nouns — the
 * only candidate shape this file uses for the personal-pronoun antecedent
 * lookback — trailing `s` is unreliable (see `KNOWN_PLURAL_PROPER_NOUNS`),
 * so a proper noun defaults to singular unless it's a known plural
 * group/demonym. Used only to gate the number-agreement check below.
 */
function isPluralNoun(word: string): boolean {
  const clean = stripPunctuation(word).toLowerCase();
  if (/^[A-Z]/.test(stripPunctuation(word))) {
    return KNOWN_PLURAL_PROPER_NOUNS.has(clean);
  }
  return clean.length >= 4 && clean.endsWith("s") && !clean.endsWith("ss");
}

/**
 * True when `word` is capitalized, non-sentence-initial evidence of a
 * proper noun — the same "plausible antecedent" evidence the original
 * lookback used. Deliberately still restricted to capitalized words rather
 * than opening up to any lowercase content word: without POS tagging, an
 * ordinary lowercase word that survives `looksLikeNoun` (not a stopword,
 * length >= 3) is just as likely to be a verb or adjective as a common
 * noun ("Husbands and wives fight about it" — "fight" would otherwise
 * wrongly resolve "it"). Capitalization is the one cheap, reliable signal
 * this file has for "this token names a specific on-screen thing."
 */
export function looksLikeProperNoun(word: string): boolean {
  const stripped = stripPunctuation(word);
  return stripped.length >= 2 && /^[A-Z]/.test(stripped) && looksLikeNoun(stripped);
}

/**
 * True when the `that` at `words[index]` is the narrow non-referential use
 * — a subordinating conjunction introducing a clause ("the truth is
 * that...", "I know that...") — rather than a demonstrative pointing at
 * something outside the frame. Detected narrowly by what sits immediately
 * before `that`: a verb from `NON_REFERENTIAL_THAT_VERBS`. Sentence-initial
 * `that` (index 0, nothing before it) can never qualify.
 *
 * Deliberately does NOT also treat "preceded by any noun-shaped word" as
 * qualifying (the relative-clause case, e.g. "the man that spoke"), even
 * though that's a real non-referential use of `that`. Without POS tagging,
 * `looksLikeNoun`'s only test is "not a stopword, length >= 3" — which
 * matches verbs and adjectives just as readily as nouns, so that fallback
 * measurably waved through real determiner leaks in this corpus ("Don't
 * let that excellent part become enslaved.", "I stopped... doing things
 * like that.", "You can change that judgment whenever you want." — "let"/
 * "like"/"change" all pass a bare noun-shape test). Restricting to the
 * curated verb list is a deliberate false-negative bias (a genuine "the
 * man that spoke" is over-rejected) in favor of "when in doubt, REJECT."
 */
function isNonReferentialThat(words: string[], index: number): boolean {
  if (index === 0) return false;
  const prevClean = stripPunctuation(words[index - 1]).toLowerCase();
  return NON_REFERENTIAL_THAT_VERBS.has(prevClean);
}

/**
 * True when `text` contains a third-person pronoun, relative pronoun, or
 * demonstrative (see LANDING_LINE_REFERENCE_REJECTS) ANYWHERE — not just as
 * the leading word — whose antecedent is not resolvable inside the line
 * itself. A standalone landing line has zero preceding context, so a
 * reference that would be fine mid-argument ("Husbands and wives fight
 * about it all night.") is unresolved once the line is the only text on
 * screen: there is no earlier sentence for "it" to point back to.
 *
 * Three categories, each handled differently:
 *  - Demonstratives (this/that/these/those/such): ALWAYS unresolved,
 *    regardless of grammatical role — determiner use ("this person",
 *    "these external things") still points BACKWARD out of the frame; the
 *    noun being on screen does not supply the referent. The one exception
 *    is `that` used non-referentially as a subordinating conjunction or
 *    relative pronoun (`isNonReferentialThat`) — narrow by design, so
 *    "when in doubt, REJECT" still holds.
 *  - Third-person personal pronouns (he/him/his/she/her/it/its/they/
 *    them/their/...): resolvable only by a capitalized, non-sentence-
 *    initial antecedent earlier in the line (same proper-noun evidence as
 *    the original rule) that additionally AGREES IN NUMBER — a singular
 *    antecedent for he/she/it forms, a plural antecedent for they forms.
 *    This is strictly tighter than the original rule, which let ANY
 *    earlier capitalized word clear ANY later pronoun regardless of
 *    number ("Socrates was the first to practice this" would have wrongly
 *    treated a singular "Socrates" as license for a plural pronoun, had
 *    one appeared). Sentence-initial capitalization (index 0) never counts
 *    as antecedent evidence.
 *  - Relative pronouns (who/whom/whose/which): resolvable by any plausible
 *    capitalized, non-sentence-initial antecedent earlier in the line —
 *    unchanged from the original rule, since these aren't the personal
 *    pronouns the number-agreement tightening targets.
 */
export function hasUnresolvedReference(text: string): boolean {
  // Em/en dashes are frequently used with no surrounding whitespace
  // ("love—this is true") as a parenthetical break, not as a hyphen
  // joining a compound word — normalize them to whitespace first so a
  // reference word glued to the previous word by a dash is still seen as
  // its own token.
  const words = text.trim().replace(/[—–]/g, " ").split(/\s+/);

  for (let i = 0; i < words.length; i++) {
    const clean = stripPunctuation(words[i]).toLowerCase();
    if (!clean || !REFERENCE_WORDS.has(clean)) continue;

    if (DEMONSTRATIVES.has(clean)) {
      if (clean === "that" && isNonReferentialThat(words, i)) continue;
      return true;
    }

    if (PERSONAL_PRONOUNS.has(clean)) {
      const requiredPlural = PERSONAL_PLURAL_PRONOUNS.has(clean);
      const hasAgreeingAntecedent = words
        .slice(1, i) // exclude index 0: sentence-initial capitalization isn't proper-noun evidence
        .some((w) => looksLikeProperNoun(w) && isPluralNoun(w) === requiredPlural);
      if (hasAgreeingAntecedent) continue;
      return true;
    }

    // Relative pronouns (who/whom/whose/which): unchanged behavior — no
    // number-agreement requirement.
    const hasEarlierProperNounAntecedent = words
      .slice(1, i) // exclude index 0: sentence-initial capitalization isn't proper-noun evidence
      .some((w) => looksLikeProperNoun(w));
    if (hasEarlierProperNounAntecedent) continue;

    return true;
  }

  return false;
}

/**
 * True when `sentence` ends in `.` or `!` — a complete declarative or
 * exclamatory statement. Excludes questions (trailing `?`, a separate
 * format: The Question) and fragments (no terminal punctuation, which
 * `sentences()` still returns for trailing text with no terminator). Also
 * excludes sentences ending in a closing `"` — those are entirely (or
 * mostly) quoted speech with no visible attribution once lifted out of the
 * card, so they can't stand alone as a landing line either.
 */
function isCompleteNonQuestion(sentence: string): boolean {
  return /[.!]$/.test(sentence.trim());
}

/** True when `sentence` has an even number of `"` characters — no unbalanced quote. */
function hasBalancedQuotes(sentence: string): boolean {
  return (sentence.match(/"/g) ?? []).length % 2 === 0;
}

/**
 * Every sentence of `card.plain_english` that qualifies as a Wall landing
 * line, in document order. A sentence qualifies when it:
 *  - is a complete declarative/exclamatory sentence, not a fragment or a
 *    question (`isCompleteNonQuestion`);
 *  - falls within the landing-line word-count bounds;
 *  - passes the T01 self-contained-opening check (no leading
 *    But/So/This/It/And);
 *  - carries no unresolved pronoun/demonstrative reference anywhere in
 *    the sentence, not just at the start (`hasUnresolvedReference`);
 *  - does not open with a bare `"` — a quote with no attribution on
 *    screen isn't self-contained;
 *  - has a balanced (even) count of `"` characters — never a broken,
 *    mid-quote fragment.
 */
export function findLandingLines(card: Card): string[] {
  return sentences(card.plain_english).filter((sentence) => {
    if (!isCompleteNonQuestion(sentence)) return false;
    if (sentence.startsWith('"')) return false;
    if (!hasBalancedQuotes(sentence)) return false;
    const wc = wordCount(sentence);
    if (wc < LANDING_LINE_MIN_WORDS || wc > LANDING_LINE_MAX_WORDS) return false;
    if (!isSelfContainedOpening(sentence)) return false;
    if (hasUnresolvedReference(sentence)) return false;
    return true;
  });
}

/**
 * Choose the landing line for a card, deterministically.
 *
 * Preference: the LAST qualifying sentence. Cards in this corpus build to a
 * conclusion, and phase 1's wall of archaic text ends mid-thought — phase 2
 * should read as that thought's resolution, not its setup. Falls back
 * through earlier qualifying sentences only in the sense that
 * `findLandingLines` already excludes anything that fails the gate; when
 * nothing qualifies, returns `null`.
 */
export function selectLandingLine(card: Card): string | null {
  const candidates = findLandingLines(card);
  return candidates.length ? candidates[candidates.length - 1] : null;
}

/**
 * True when `line` appears verbatim (exact substring) inside `source`. Used
 * to mechanically enforce that on-screen text is traceable to its source
 * card rather than paraphrased or synthesised. T09 builds the full
 * faithfulness check for LLM-authored copy on top of this; here it just
 * confirms a landing line is lifted directly from plain_english.
 */
export function verbatim(line: string, source: string): boolean {
  return source.includes(line);
}

export interface WallEntry {
  card_id: string;
  book_slug: string;
  author_slug: Card["author_slug"];
  original_word_count: number;
  landing_line: string;
}

/**
 * The Wall's landing-line gate. An entry survives only when both hold:
 *  - the original excerpt is long enough to outrun the viewer in phase 1
 *    (>=80 words, matching MechanicalGates.wallLength);
 *  - the card has a clean standalone sentence to cut to in phase 2
 *    (`selectLandingLine` returns non-null).
 */
export function wallGate(cards: Card[]): WallEntry[] {
  const entries: WallEntry[] = [];
  for (const card of cards) {
    const originalWordCount = wordCount(card.original_excerpt);
    if (originalWordCount < 80) continue;
    const landingLine = selectLandingLine(card);
    if (!landingLine) continue;
    entries.push({
      card_id: card.id,
      book_slug: card.book_slug,
      author_slug: card.author_slug,
      original_word_count: originalWordCount,
      landing_line: landingLine,
    });
  }
  return entries;
}

// ---------------------------------------------------------------------------
// T03: Visual-archaism ranking for The Wall. Phase 1 shows original_excerpt
// as dense, archaic-looking text; some cards LOOK more impenetrable than
// others (thick with "thou"/"hath"-style archaic diction, cascading
// semicolon clauses, or a scene rendered in dialogue). Three deterministic,
// non-exclusive sub-types capture that visual quality; a card matching none
// of them is `reserve`. In the same pass, every ranked entry is flagged for
// which of the format's OPENING treatments it's eligible for — the two
// numeric openings ("190 -> 97", a word-count countdown, and "Grade 14", a
// bare reading-grade readout) are conditional; every entry can always take
// the plain "standard" opening.
//
// All three sub-type checks run against `original_excerpt` (not
// plain_english) — the wall of text the viewer actually sees in phase 1.
// ---------------------------------------------------------------------------

/**
 * Archaic diction markers that make a passage visually read as old/thick
 * English. Matched case-insensitively at a word boundary; every OCCURRENCE
 * counts (a repeated marker counts more than once), not just distinct
 * markers — see `classifyWallSubTypes` for why (measured against the real
 * corpus: counting occurrences gives 222 over the >=80-word gate; counting
 * distinct markers per card gives 185, which does not match the plan).
 */
export const ARCHAIC_MARKERS = [
  "thou",
  "thee",
  "thy",
  "thine",
  "hath",
  "doth",
  "dost",
  "art",
  "shalt",
  "wilt",
  "whither",
  "wherefore",
  "whereby",
  "whensoever",
  "perchance",
  "nay",
  "yea",
] as const;

const ARCHAIC_MARKER_RE = new RegExp(`\\b(${ARCHAIC_MARKERS.join("|")})\\b`, "gi");

/** Sub-type match thresholds, all measured against `original_excerpt`. */
export const WALL_THOU_MARKER_MIN = 3;
export const WALL_CASCADE_SEMICOLON_MIN = 3;
export const WALL_SCENE_QUOTE_MIN = 2;

export type WallSubType = "thou_wall" | "cascade" | "scene";

/**
 * The Wall's two conditional openings, plus the always-available baseline.
 * `countdown` is the "190 -> 97" treatment (original word count counting
 * down live to the plain version's word count); `grade` is the "Grade 14"
 * treatment (the original's computed reading grade shown as a bare
 * measurement).
 */
export type WallOpening = "standard" | "countdown" | "grade";

export interface WallSubTypeClassification {
  sub_types: WallSubType[];
  reserve: boolean;
  archaic_marker_count: number;
  semicolon_count: number;
  quote_count: number;
}

/**
 * Classify a card's `original_excerpt` into its Wall visual-archaism
 * sub-type(s). Pure and standalone (does not require the T02 landing-line
 * gate) so the corpus test can assert its counts directly over the full
 * >=80-word wallLength set (1,326 cards), independent of how many of those
 * survive `wallGate`.
 *
 * Sub-types are NOT mutually exclusive — a card thick with archaic diction
 * AND full of semicolon cascades matches both `thou_wall` and `cascade`.
 * `reserve` is true only when none of the three match.
 *
 * Measured over the 1,326-card >=80-word gate: Thou Wall 222, Cascade 204,
 * Scene 137 (the plan's own estimate for Scene was 176; that figure does
 * not reproduce under any quote-character definition tried — curly quotes
 * gives 203, checking either plain_english or original_excerpt gives 311 —
 * so 137, the measured count for ">=2 straight double-quote characters in
 * original_excerpt", is what's implemented and asserted here. Same
 * treatment T01 gave its own unreproducible 674 estimate: implement the
 * clean stated definition, measure it, document the gap, don't contort the
 * definition to hit an estimate).
 */
export function classifyWallSubTypes(card: Card): WallSubTypeClassification {
  const text = card.original_excerpt;
  const archaicMarkerCount = (text.match(ARCHAIC_MARKER_RE) ?? []).length;
  const semicolonCount = (text.match(/;/g) ?? []).length;
  const quoteCount = (text.match(/"/g) ?? []).length;

  const subTypes: WallSubType[] = [];
  if (archaicMarkerCount >= WALL_THOU_MARKER_MIN) subTypes.push("thou_wall");
  if (semicolonCount >= WALL_CASCADE_SEMICOLON_MIN) subTypes.push("cascade");
  if (quoteCount >= WALL_SCENE_QUOTE_MIN) subTypes.push("scene");

  return {
    sub_types: subTypes,
    reserve: subTypes.length === 0,
    archaic_marker_count: archaicMarkerCount,
    semicolon_count: semicolonCount,
    quote_count: quoteCount,
  };
}

/** Minimum `lengthDelta` for the "190 -> 97" countdown opening to be worth showing (else the countdown barely moves). */
export const WALL_COUNTDOWN_DELTA_MIN = 30;

/**
 * Minimum original-text reading grade for the "Grade 14" opening to be
 * worth showing as a bare measurement. Grade 12 is the sensible floor: it's
 * the same "too difficult" ceiling `validateReadability` (`scripts/lib/
 * validate.ts`) uses for the PLAIN version, so a Wall original clearing
 * that same bar is unambiguously harder reading than anything the app
 * otherwise ships — worth calling out on screen. Measured over the
 * 1,326-card >=80-word gate: 856 cards clear grade >=12.
 */
export const WALL_ORIGINAL_GRADE_MIN = 12;

/**
 * The original excerpt's Flesch-Kincaid grade level, via the same
 * `text-readability` call `validateReadability` uses on the plain version
 * (`scripts/lib/validate.ts`) — kept identical so grades are comparable
 * across the pipeline.
 */
export function originalReadingGrade(card: Card): number {
  return rs.fleschKincaidGrade(card.original_excerpt);
}

/**
 * Which openings a card is eligible for. Every card can always take
 * `standard`. `countdown` requires the plain version to be meaningfully
 * shorter than the original (`lengthDelta(card) >= WALL_COUNTDOWN_DELTA_MIN`
 * — the same threshold as `MechanicalGates.lengthDelta30`), or the
 * countdown animation barely moves. `grade` requires the original's
 * reading grade to clear `WALL_ORIGINAL_GRADE_MIN`. An entry failing both
 * conditional checks carries only `["standard"]`; an entry passing both
 * carries all three.
 */
export function eligibleWallOpenings(card: Card): WallOpening[] {
  const openings: WallOpening[] = ["standard"];
  if (lengthDelta(card) >= WALL_COUNTDOWN_DELTA_MIN) openings.push("countdown");
  if (originalReadingGrade(card) >= WALL_ORIGINAL_GRADE_MIN) openings.push("grade");
  return openings;
}

export interface RankedWallEntry extends WallEntry {
  sub_types: WallSubType[];
  reserve: boolean;
  archaic_marker_count: number;
  semicolon_count: number;
  quote_count: number;
  original_grade: number;
  eligible_openings: WallOpening[];
}

/**
 * Rank every T02 `wallGate` survivor (a card that already has a landing
 * line) by visual-archaism sub-type and opening eligibility.
 *
 * The sub-type counts here are necessarily SMALLER than
 * `classifyWallSubTypes`'s own corpus-wide counts (222/204/137): those are
 * measured over all 1,326 length-gated cards, while `rankWall` only ever
 * sees the 1,003 cards that also survive the landing-line gate. Call
 * `classifyWallSubTypes` directly (or via `mechanicalGates`-style corpus
 * tests) to reproduce the 1,326-card figures; use `rankWall`'s own output
 * to measure the ranked-pool figures.
 */
export function rankWall(cards: Card[]): RankedWallEntry[] {
  const entries = wallGate(cards);
  const cardsById = new Map(cards.map((c) => [c.id, c]));

  return entries.map((entry) => {
    const card = cardsById.get(entry.card_id);
    if (!card) {
      throw new Error(`rankWall: no source card found for wallGate entry ${entry.card_id}`);
    }
    const classification = classifyWallSubTypes(card);
    return {
      ...entry,
      ...classification,
      original_grade: originalReadingGrade(card),
      eligible_openings: eligibleWallOpenings(card),
    };
  });
}

// ---------------------------------------------------------------------------
// T04: The Question. Format: a short second-person question appears alone on
// screen; the viewer silently predicts an answer; the card's own next
// sentence appears as the author's answer. So the QUESTION must stand alone
// with no context, and the following sentence must ACTUALLY ANSWER it.
//
// Three layers, cheapest first:
//  - MECHANICAL GATE: is there a short, unquoted, self-contained,
//    non-exclamatory question — in the author's own voice, not attributed to
//    someone else — in the first three sentences of plain_english?
//  - LAYER (a): does the chosen question stand alone (no dangling pronoun/
//    demonstrative, no mid-thought opener, not a fragment)?
//  - LAYER (b): does the candidate answer actually resolve rather than
//    continue the question (not itself a question, no attribution leak)?
//  - LAYER (c): topic drift — LLM judgement only, stubbed here (T07/T08).
// ---------------------------------------------------------------------------

/** Question word-count ceiling — must be readable at a glance with zero context. */
export const QUESTION_MAX_WORDS = 14;

/** The question must appear within the first N sentences of plain_english. */
export const QUESTION_SENTENCE_WINDOW = 3;

/**
 * Verbs of speech/attribution used by both the mechanical gate's
 * "author's own voice" check (on the question) and layer (b)'s attribution
 * check (on the answer). Matched against a single token via
 * `ATTRIBUTION_VERB_RE`, immediately preceded by an attribution subject —
 * see `hasAttributionLeak`.
 */
export const ATTRIBUTION_VERBS = [
  "ask",
  "asks",
  "asked",
  "say",
  "says",
  "said",
  "reply",
  "replies",
  "replied",
  "answer",
  "answers",
  "answered",
  "respond",
  "responds",
  "responded",
  "retort",
  "retorts",
  "retorted",
] as const;

const ATTRIBUTION_VERB_RE = /^(asks?|asked|says?|said|repl(?:y|ies|ied)|answers?|answered|responds?|responded|retorts?|retorted)$/i;

/**
 * Pronoun subjects that always signal a dialogue attribution when they sit
 * directly before an attribution verb ("he asks", "someone says", "they
 * ask"). Deliberately excludes "you": "you say"/"you ask" as a rhetorical
 * second-person prompt ("What should you say when...?") is often the
 * AUTHOR'S OWN direct address to the viewer, not a dialogue leak — measured
 * against the real corpus, treating bare "you" the same as "he"/"someone"
 * produced false positives (e.g. "What should you say when something
 * painful happens?", which is exactly the second-person voice this format
 * wants). "you ask" specifically is still rejected, but narrowly, via
 * `YOU_ASK_RE` below, matching the plan's literal example.
 */
const ATTRIBUTION_PRONOUN_SUBJECTS = new Set(["he", "she", "they", "someone", "people"]);

/** "you ask" specifically (not "you say"/"you reply") — see the comment on `ATTRIBUTION_PRONOUN_SUBJECTS`. */
const YOU_ASK_RE = /\byou\s+asks?\b/i;

/**
 * First-person speech verbs — "I ask", "I say", "I reply", "I answer" — that
 * `ATTRIBUTION_PRONOUN_SUBJECTS` originally missed entirely (that set only
 * covered third-party subjects: he/she/they/someone/people). "I ask back:
 * how does the earth keep holding all the buried bodies forever?" is the
 * author staging a rhetorical dialogue with an imagined interlocutor, not
 * speaking directly to the viewer — same leak as "he asks", just first
 * person (`meditations-04-022`). Matched literally on the four verbs the
 * corpus audit surfaced, not the full `ATTRIBUTION_VERBS` conjugation set —
 * deliberately narrow, since "I" is otherwise the normal subject of the
 * author's own direct statements ("I know that...") and a broader match
 * risks false-positiving on those.
 */
const FIRST_PERSON_ATTRIBUTION_RE = /\bI\s+(ask|say|reply|answer)\b/i;

/**
 * True when `clause` (a lead-in fragment, not necessarily a full sentence —
 * see `hasColonAttributionLeadIn`) itself reads as a speech attribution: it
 * contains an attribution verb AND opens with a plausible speaking subject.
 * Unlike the main `hasAttributionLeak` loop, a capitalized first word here
 * DOES count as subject evidence even though it's sentence/clause-initial
 * — a colon lead-in's whole job is to name who's about to speak ("Epictetus
 * asks:", "I ask back:"), so sentence-initial capitalization is exactly the
 * expected shape, not the rhetorical-wh-question false positive the
 * mid-sentence check guards against ("Who says...?").
 */
function isSpeechAttributionClause(clause: string): boolean {
  const words = clause.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const hasVerb = words.some((w) => ATTRIBUTION_VERB_RE.test(stripPunctuation(w).toLowerCase()));
  if (!hasVerb) return false;

  const firstClean = stripPunctuation(words[0]).toLowerCase();
  if (firstClean === "i") return true;
  if (ATTRIBUTION_PRONOUN_SUBJECTS.has(firstClean)) return true;
  return /^[A-Z]/.test(stripPunctuation(words[0]));
}

/**
 * True when the text BEFORE the first `:` in `text` is itself a speech
 * attribution — "I ask back: how does..." or "Epictetus asks: what should
 * you do?" — a dialogue lead-in the mechanical gate's word-adjacency scan
 * can miss when other words sit between the subject and the colon.
 */
export function hasColonAttributionLeadIn(text: string): boolean {
  const colonIndex = text.indexOf(":");
  if (colonIndex === -1) return false;
  return isSpeechAttributionClause(text.slice(0, colonIndex));
}

/**
 * True when `text` attributes a question/answer to a party other than the
 * author speaking directly to the viewer — "he asks", "someone says",
 * "you ask", "Epictetus said", "I ask back:". Checked, in order:
 *  - "you ask" specifically (`YOU_ASK_RE`);
 *  - a first-person speech verb — "I ask"/"I say"/"I reply"/"I answer"
 *    (`FIRST_PERSON_ATTRIBUTION_RE`) — the author staging a rhetorical
 *    dialogue with an imagined interlocutor is still a dialogue leak, just
 *    first person, and the plain pronoun-subject scan below never covered
 *    "I" (only third-party subjects);
 *  - a speech-attribution lead-in before a colon (`hasColonAttributionLeadIn`)
 *    — "I ask back: ..." / "Epictetus asks: ...";
 *  - a closed-class pronoun subject (`ATTRIBUTION_PRONOUN_SUBJECTS`), any
 *    position in the sentence, sitting IMMEDIATELY before an attribution
 *    verb;
 *  - a genuine capitalized proper-noun subject (`looksLikeProperNoun`,
 *    reusing T02's noun-shape heuristic), excluding sentence-initial
 *    position (index 0) — the same exclusion T02 uses, because ordinary
 *    sentence-initial capitalization ("Who says...?", "What does...?") is
 *    not proper-noun evidence and would otherwise false-positive on
 *    rhetorical wh-questions.
 * Shared by the mechanical gate (checked on the question, "author's own
 * voice") and layer (b) (checked on the answer, "attribution leak").
 */
export function hasAttributionLeak(text: string): boolean {
  if (YOU_ASK_RE.test(text)) return true;
  if (FIRST_PERSON_ATTRIBUTION_RE.test(text)) return true;
  if (hasColonAttributionLeadIn(text)) return true;

  const words = text.trim().replace(/[—–]/g, " ").split(/\s+/);
  for (let i = 1; i < words.length; i++) {
    if (!ATTRIBUTION_VERB_RE.test(stripPunctuation(words[i]).toLowerCase())) continue;

    const subjectClean = stripPunctuation(words[i - 1]).toLowerCase();
    if (ATTRIBUTION_PRONOUN_SUBJECTS.has(subjectClean)) return true;
    if (i - 1 !== 0 && looksLikeProperNoun(words[i - 1])) return true;
  }
  return false;
}

/** "How"-openers where the second word is not a question auxiliary — signals a rhetorical exclamation ("How wonderful..."), not a real question. */
const HOW_AUX_WORDS = new Set([
  "do",
  "does",
  "did",
  "can",
  "could",
  "would",
  "should",
  "will",
  "shall",
  "is",
  "are",
  "was",
  "were",
  "have",
  "has",
  "had",
  "many",
  "much",
  "long",
  "often",
  "far",
  "old",
]);

const EXCLAMATION_ENDING_RE = /[!?]{2,}$/;
const EXCLAMATION_OPENING_WHAT_RE = /^what\s+an?\b/i;

/**
 * True when `question` is rhetorically an exclamation dressed up with a
 * trailing `?`, not a genuine question the viewer can answer:
 *  - ends with stacked terminal punctuation (`?!`/`!?`);
 *  - opens "What a"/"What an" ("What a joy this is?" — always exclamatory);
 *  - opens "How <word>" where `<word>` is not a question auxiliary
 *    (`HOW_AUX_WORDS`) — "How wonderful is that?" is exclamatory, "How do
 *    you know?" is a real question. A deliberately blunt heuristic (no POS
 *    tagging), consistent with the rest of this file's approach.
 */
export function isExclamationShaped(question: string): boolean {
  const trimmed = question.trim();
  if (EXCLAMATION_ENDING_RE.test(trimmed)) return true;
  if (EXCLAMATION_OPENING_WHAT_RE.test(trimmed)) return true;

  const howMatch = /^how\s+(\S+)/i.exec(trimmed);
  if (howMatch && !HOW_AUX_WORDS.has(stripPunctuation(howMatch[1]).toLowerCase())) return true;

  return false;
}

export interface QuestionCandidate {
  question: string;
  /** Index of `question` within `sentences(card.plain_english)` — used to locate the candidate answer. */
  index: number;
}

/**
 * The mechanical gate for The Question. Finds the FIRST sentence, in
 * document order, among the first `QUESTION_SENTENCE_WINDOW` sentences of
 * `plain_english`, that satisfies ALL of:
 *  - ends with `?`;
 *  - <= `QUESTION_MAX_WORDS` words;
 *  - contains no `"` (unquoted — no on-screen attribution/dialogue frame);
 *  - passes `isSelfContainedOpening` (T01: no leading But/So/This/It/And);
 *  - is not exclamation-shaped (`isExclamationShaped`);
 *  - carries no attribution leak (`hasAttributionLeak` — author's own
 *    voice).
 *
 * These criteria are evaluated as a set (existence, not a fixed candidate
 * carried through each stage): a card can survive an earlier stage via one
 * of up to 3 first-window sentences and a later stage via a different one,
 * matching the measured corpus counts below. The final `question` selected
 * is the first sentence (by document order) to satisfy every criterion at
 * once, chosen deterministically.
 *
 * Measured over the full corpus (`content/output`), applying criteria in
 * order: question present in first 3 sentences — 458; + <=14 words — 380;
 * + unquoted — 379; + self-contained opening — 319; + not
 * exclamation-shaped and no attribution leak — **313** (0 cards were caught
 * by `isExclamationShaped` alone in this corpus; 11 were caught by
 * `hasAttributionLeak`, of which 3 also overlapped stages already excluded
 * by earlier filters, netting -6 from 319). The plan's target for this gate
 * was 292; 313 is what's implemented and measured — not contorted to hit
 * the estimate, per the same policy T01/T03 documented for their own
 * unreproducible targets.
 */
export function findQuestionCandidate(card: Card): QuestionCandidate | null {
  const sents = sentences(card.plain_english);
  const windowed = sents.slice(0, QUESTION_SENTENCE_WINDOW).map((question, index) => ({ question, index }));

  const survivors = windowed
    .filter(({ question }) => question.trim().endsWith("?"))
    .filter(({ question }) => wordCount(question) <= QUESTION_MAX_WORDS)
    .filter(({ question }) => !question.includes('"'))
    .filter(({ question }) => isSelfContainedOpening(question))
    .filter(({ question }) => !isExclamationShaped(question))
    .filter(({ question }) => !hasAttributionLeak(question));

  return survivors.length ? survivors[0] : null;
}

/**
 * The candidate answer for a question at `candidateIndex` in
 * `sentences(card.plain_english)`: exactly ONE sentence, the one
 * immediately following the question in document order. `null` when the
 * question is the last sentence in the card (no following sentence exists).
 *
 * Deliberately a single sentence, not a span: the format's own beat is "the
 * card's own NEXT sentence appears as the author's answer" — a single held
 * reveal the viewer checks their prediction against. Extending this to a
 * multi-sentence answer span was considered and rejected for T04: it would
 * dilute that one-beat reveal and there's no principled stopping rule (2
 * sentences? 3?) without LLM judgement, which is out of scope here. If a
 * future task needs multi-sentence answers, this is the place to extend it.
 */
export function questionCandidateAnswer(card: Card, candidateIndex: number): string | null {
  const sents = sentences(card.plain_english);
  return sents[candidateIndex + 1] ?? null;
}

/**
 * Leading words/phrases that make a question read as mid-conversation
 * rather than a self-contained opening — a continuation of an argument
 * ("Because...", "Then...") or a framing device signalling the question is
 * itself a quoted or imagined interjection ("What about...?", "You ask...").
 * Matched case-insensitively at the start of the trimmed question.
 */
export const QUESTION_OPENING_REJECTS = ["Because", "Then", "What about", "You ask"] as const;

const QUESTION_OPENER_RE = new RegExp(
  `^(${QUESTION_OPENING_REJECTS.map((phrase) => phrase.replace(/ /g, "\\s+")).join("|")})\\b`,
  "i",
);

/** True when `question` opens with one of `QUESTION_OPENING_REJECTS`. */
export function hasMidThoughtOpener(question: string): boolean {
  return QUESTION_OPENER_RE.test(question.trim());
}

/**
 * True when `question` doesn't start with a capital letter. A blunt but
 * effective signal that the "sentence" is actually a stray fragment grabbed
 * mid-thought (e.g. by `sentences()`'s quote-aware splitting keeping a
 * quoted run together and spilling a lowercase tail into the next chunk),
 * not a genuine, independently openable question.
 */
export function isFragmentQuestion(question: string): boolean {
  const trimmed = question.trim();
  if (!trimmed) return true;
  return !/^[A-Z]/.test(trimmed);
}

/**
 * Second-person(-ish) words whose presence exempts a question from
 * `hasThirdPartyReference` — the format's mechanic is FORCED
 * SELF-PREDICTION, a question the viewer answers about their OWN life, so a
 * question that's clearly addressed to the viewer (or includes them, "we"/
 * "our"/"us") is fine even if it happens to name someone ("What would you
 * say to Epictetus?").
 */
const SECOND_PERSON_WORDS = new Set(["you", "your", "yours", "yourself", "we", "our", "us"]);

/** True when `question` contains a second-person(-ish) word anywhere. */
export function isSecondPersonQuestion(question: string): boolean {
  const words = question.trim().replace(/[—–]/g, " ").split(/\s+/);
  return words.some((w) => SECOND_PERSON_WORDS.has(stripPunctuation(w).toLowerCase()));
}

/**
 * Named subjects excluded from third-party-reference evidence even though
 * they're capitalized, non-sentence-initial nouns: "I" is already excluded
 * structurally (`looksLikeNoun` rejects anything under 3 characters, and
 * `NOT_A_NOUN` lists it lowercase), but "God" is a common Stoic/theological
 * term in this corpus, not a third party the question is ABOUT the way
 * "Priam" or "Medea" are.
 */
const THIRD_PARTY_NAME_EXCLUDES = new Set(["god"]);

/**
 * True when `question` is asked ABOUT a named third party or literary work
 * ("What did Priam do in the Iliad?", "How does Medea put it?") rather than
 * posed TO the viewer about their own life — a failure of the format's core
 * mechanic (forced self-prediction), not just a well-formedness defect.
 * Second-person questions that merely MENTION a name ("What would you say
 * to Epictetus?") are not rejected — `isSecondPersonQuestion` exempts them
 * first. Otherwise, any capitalized, non-sentence-initial proper noun
 * (reusing T02's `looksLikeProperNoun`, excluding "God") is third-party
 * evidence.
 */
export function hasThirdPartyReference(question: string): boolean {
  if (isSecondPersonQuestion(question)) return false;

  const words = question.trim().replace(/[—–]/g, " ").split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    if (i === 0) continue; // sentence-initial capitalization isn't proper-noun evidence
    if (!looksLikeProperNoun(words[i])) continue;
    if (THIRD_PARTY_NAME_EXCLUDES.has(stripPunctuation(words[i]).toLowerCase())) continue;
    return true;
  }
  return false;
}

/**
 * A `'` preceded by start-of-string/whitespace and immediately followed by
 * a non-whitespace character — the shape of an opening quote mark
 * ("'I know..."), not a contraction (always letter-'-letter, e.g. "I'm")
 * or a possessive/closing apostrophe (always non-whitespace-'-non-letter,
 * e.g. "Epictetus' body").
 */
const SINGLE_QUOTE_OPEN_RE = /(?<=^|\s)'(?=\S)/g;

/**
 * A `'` preceded by a non-whitespace character and followed by
 * whitespace/punctuation/end-of-string — the shape of a closing quote mark
 * OR a possessive apostrophe ("Epictetus' body"). Deliberately can't tell
 * those two apart (no way to, without a matching open elsewhere) — used
 * only to count how many "closes" are available to pair against opens, so
 * treating a possessive as a close is the conservative direction (it can
 * only make an unbalanced count look balanced, never the reverse).
 * Excludes contractions: the lookahead requires a NON-letter next
 * character, so "I'm"/"don't" (letter immediately after `'`) never match.
 */
const SINGLE_QUOTE_CLOSE_RE = /(?<=\S)'(?=[\s,.!?;:")\]]|$)/g;

/**
 * True when `text` has more opening-shaped `'` marks than closing-shaped
 * ones — an orphan opening quote that's never closed within the text
 * ("'I know the evil I'm about to do..." — the trailing closing `'` was
 * split into the NEXT sentence by `sentences()`, which is quote-aware only
 * for `"`, not `'`; see `discourses-17-003`). Deliberately count-based, not
 * a strict pairing walk — mirrors T02's `hasBalancedQuotes` treatment of
 * `"`, which is also just an even/odd count.
 */
export function hasUnbalancedSingleQuote(text: string): boolean {
  const opens = (text.match(SINGLE_QUOTE_OPEN_RE) ?? []).length;
  const closes = (text.match(SINGLE_QUOTE_CLOSE_RE) ?? []).length;
  return opens > closes;
}

/**
 * True when `text` is not quote-well-formed: an odd count of `"` characters
 * (same even/odd check T02's `hasBalancedQuotes` applies to landing lines),
 * or an orphan opening `'` (`hasUnbalancedSingleQuote`). Applied to BOTH the
 * question and the candidate answer — a broken mid-quote fragment can't
 * stand alone on screen in either slot.
 */
export function hasUnbalancedQuotes(text: string): boolean {
  if ((text.match(/"/g) ?? []).length % 2 !== 0) return true;
  return hasUnbalancedSingleQuote(text);
}

/**
 * Layer (a) — deterministic. Rejects a question whose antecedent isn't
 * inside the question itself (reusing T02's whole-span
 * `hasUnresolvedReference`, applied to the question span exactly as
 * instructed — the same "no preceding context" problem the Wall's landing
 * line has), plus mid-thought openers, bare fragments, third-party/literary
 * references, and unbalanced quote characters.
 */
export function passesLayerA(question: string): boolean {
  if (hasUnresolvedReference(question)) return false;
  if (hasMidThoughtOpener(question)) return false;
  if (isFragmentQuestion(question)) return false;
  if (hasThirdPartyReference(question)) return false;
  if (hasUnbalancedQuotes(question)) return false;
  return true;
}

/**
 * True when `answer` itself ends in `?` — the Socratic chain continuing
 * (another question) rather than resolving into a stated answer.
 */
export function isSocraticChainAnswer(answer: string): boolean {
  return answer.trim().endsWith("?");
}

/**
 * Cataphoric "pivot" phrases — an answer that PROMISES an explanation
 * instead of GIVING one ("Think of it this way.", "Here's how it works.").
 * These pass the mechanical/layer-(a) checks cleanly (they're declarative,
 * not a question), but they resolve nothing: the viewer checks their
 * silent prediction against an empty frame, not a real answer
 * (`meditations-04-022`, `discourses-21-004`).
 */
export const PIVOT_ANSWER_PHRASES = [
  "Think of it this way",
  "Here's how it works",
  "Here's the thing",
  "Let me explain",
  "Consider this",
  "It works like this",
  "Look at it this way",
  "Here's what I mean",
] as const;

const PIVOT_ANSWER_RE = new RegExp(
  `^(${PIVOT_ANSWER_PHRASES.map((phrase) => phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})[.!?]*$`,
  "i",
);

/**
 * True when `answer`, once trimmed, IS (not merely contains) one of
 * `PIVOT_ANSWER_PHRASES`, allowing trailing punctuation — matched against
 * the WHOLE answer sentence so a longer answer that merely contains one of
 * these phrases mid-sentence ("Consider this carefully before you decide.")
 * is not rejected.
 */
export function isPivotAnswer(answer: string): boolean {
  return PIVOT_ANSWER_RE.test(answer.trim());
}

/**
 * Layer (b) — deterministic. Rejects a candidate answer that continues the
 * Socratic chain instead of resolving it (`isSocraticChainAnswer`), leaks
 * attribution to another speaker (`hasAttributionLeak`, shared with the
 * mechanical gate's author's-own-voice check), is a cataphoric pivot phrase
 * that promises an explanation instead of giving one (`isPivotAnswer`), or
 * is not quote-well-formed (`hasUnbalancedQuotes`).
 */
export function passesLayerB(answer: string): boolean {
  if (isSocraticChainAnswer(answer)) return false;
  if (hasAttributionLeak(answer)) return false;
  if (isPivotAnswer(answer)) return false;
  if (hasUnbalancedQuotes(answer)) return false;
  return true;
}

export interface QuestionEntry {
  card_id: string;
  book_slug: string;
  author_slug: Card["author_slug"];
  question: string;
  answer: string;
  /**
   * Not populated by `questionGate` (which returns survivors only) — present
   * so a future full-audit variant, or T07/T08's own rejection logging, can
   * reuse this same shape for rejected candidates too.
   */
  rejected_by?: string;
}

/**
 * The Question's full deterministic gate: mechanical gate + layer (a) +
 * layer (b). Returns only survivors — cards with a self-contained question
 * in the author's own voice, and a next sentence that actually answers it
 * rather than dangling a reference, opening mid-thought, or continuing the
 * question.
 *
 * Measured over the full corpus: mechanical gate 313 -> after layer (a) 162
 * -> after layer (b) **100**. This 100-card pool (pre layer (c)) is what
 * `buildQuestionDriftRequests` below hands to the LLM topic-drift check.
 */
export function questionGate(cards: Card[]): QuestionEntry[] {
  const entries: QuestionEntry[] = [];

  for (const card of cards) {
    const candidate = findQuestionCandidate(card);
    if (!candidate) continue;
    if (!passesLayerA(candidate.question)) continue;

    const answer = questionCandidateAnswer(card, candidate.index);
    if (!answer) continue;
    if (!passesLayerB(answer)) continue;

    entries.push({
      card_id: card.id,
      book_slug: card.book_slug,
      author_slug: card.author_slug,
      question: candidate.question,
      answer,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// T04 layer (c) — STUB ONLY. Topic drift (5 of 14 observed answer-side
// failures): the next sentence is chronologically next but not logically an
// answer to the question. That distinction needs LLM judgement — no regex
// separates "answers the question" from "merely follows it" — so this task
// (T04) defines ONLY the request-shaped data structure T07 (rubric/prompt)
// and T08 (batch submit/poll/stream/merge, reusing the Batch helpers in
// scripts/lib/claude.ts: createMessageBatch, pollBatchUntilDone,
// streamBatchResults, safeCustomId — same pattern as the translate phase)
// will build on. NO API calls and NO network code belong here.
// ---------------------------------------------------------------------------

export interface QuestionDriftRequest {
  /** Built by T08 via `safeCustomId(card_id)`, matching the translate phase's pattern. */
  card_id: string;
  question: string;
  answer: string;
}

/**
 * Shape layer (a)+(b) survivors into the plain request objects layer (c)
 * will submit as an Anthropic Batch. Pure data transformation — no SDK
 * calls, no prompt/system text (that's T07's rubric). T08 turns these into
 * real batch requests and merges the results back onto `QuestionEntry`.
 */
export function buildQuestionDriftRequests(entries: QuestionEntry[]): QuestionDriftRequest[] {
  return entries.map((entry) => ({
    card_id: entry.card_id,
    question: entry.question,
    answer: entry.answer,
  }));
}

// ---------------------------------------------------------------------------
// T05: Balance the Epictetus skew. The Question's usable pool is
// structurally skewed toward Epictetus (measured: epictetus 50 / 89 = 56%,
// marcus-aurelius 21 / 89 = 24%, seneca 18 / 89 = 20% — see T04's note; the
// plan's own ~65% estimate is close but not exact) because *Discourses* is a
// diatribe transcript that natively matches the question/answer format. That
// skew CANNOT be fixed inside The Question's own pool without discarding
// otherwise-good material, and T05 is explicitly scoped not to try. Instead,
// The Wall — whose ranked pool (1,003 entries; see `rankWall`) is more than
// ten times the size of The Question's — absorbs the correction: it is
// weighted AWAY from Epictetus and TOWARD Marcus Aurelius and Seneca so that
// once a week's Question and Wall posts are combined, the OVERALL author mix
// lands closer to even than The Question's pool ever could on its own.
//
// This section builds the mechanism (`wallAuthorWeights`,
// `selectWallBalanced`) and the reporting (`authorMix`, `combinedAuthorMix`)
// the scheduler (T12) will consume. T05 does not build the scheduler itself.
// ---------------------------------------------------------------------------

/**
 * Deterministic, seedable PRNG (mulberry32). Exported so T12 can reuse the
 * exact same generator `selectWallBalanced` uses — the plan requires
 * byte-identical regeneration from a seed, which is only possible if every
 * consumer shares one RNG implementation rather than each rolling its own.
 *
 * Returns a function that yields floats in `[0, 1)`, advancing an internal
 * 32-bit state on every call. Pure function of `seed` and call count — no
 * `Math.random()` anywhere in this file.
 */
export function createSeededRng(seed: number): () => number {
  let state = seed >>> 0;
  return function rng(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface AuthorMixEntry {
  count: number;
  share: number;
}

/**
 * Author mix (count and share of total) for ANY collection carrying
 * `author_slug` — a single format's pool, or a combined multi-format
 * selection. This is the piece the acceptance criterion needs: the weekly
 * schedule must report author mix across all formats COMBINED, not per
 * format, and this function is what makes that call site possible (see
 * `combinedAuthorMix` below).
 *
 * Always returns an entry for all three known authors (`VALID_AUTHOR_SLUGS`),
 * even when a given author has zero entries in `entries` — so a caller can
 * always read `mix.seneca.count` without a defined-ness check. `share` is 0
 * for every author when `entries` is empty (rather than `NaN`).
 */
export function authorMix<T extends { author_slug: AuthorSlug }>(entries: T[]): Record<AuthorSlug, AuthorMixEntry> {
  const counts = {} as Record<AuthorSlug, number>;
  for (const author of VALID_AUTHOR_SLUGS) counts[author] = 0;
  for (const entry of entries) counts[entry.author_slug] += 1;

  const total = entries.length;
  const result = {} as Record<AuthorSlug, AuthorMixEntry>;
  for (const author of VALID_AUTHOR_SLUGS) {
    result[author] = { count: counts[author], share: total > 0 ? counts[author] / total : 0 };
  }
  return result;
}

/**
 * Convenience wrapper for the scheduler's report: flattens any number of
 * per-format pools (e.g. a week's Question selections and a week's Wall
 * selections) and runs `authorMix` over the combined set. This is the exact
 * call T12's weekly report needs to satisfy T05's acceptance criterion —
 * "the weekly schedule reports author mix across all formats combined, not
 * per format."
 */
export function combinedAuthorMix<T extends { author_slug: AuthorSlug }>(
  ...pools: T[][]
): Record<AuthorSlug, AuthorMixEntry> {
  return authorMix(pools.flat());
}

/**
 * The balance target: an even three-way split (1/3 each). This is the
 * "obvious" target and the one implemented here, even though the corpus
 * itself is not quite even (1,615 cards: epictetus 458 / 28%, marcus-aurelius
 * 576 / 36%, seneca 581 / 36% — measured). An even split was chosen over
 * matching the corpus's own proportions for two reasons: (1) the corpus mix
 * is already close to even (28/36/36) — matching it instead of a clean 1/3
 * each would only reproduce a small part of the skew problem while adding
 * complexity for little gain; (2) "balanced" is a reader-facing promise
 * (three philosophers, one voice each, none dominating the feed) that reads
 * more honestly as an even split than as "proportional to how much each of
 * them happened to write."
 */
export const BALANCED_AUTHOR_SHARE: Record<AuthorSlug, number> = {
  epictetus: 1 / 3,
  "marcus-aurelius": 1 / 3,
  seneca: 1 / 3,
};

/**
 * Default assumption for how much of a week's two-post-per-day schedule is
 * Question posts (vs. Wall posts) when solving for Wall's correction weight
 * below — see `wallAuthorWeights`. T12 owns the schedule's real format mix;
 * this is only the assumption `wallAuthorWeights` uses to size its own
 * correction when the caller doesn't override it. 0.5 mirrors the plan's own
 * "7 days x 2 posts" shape read as one Question + one Wall per day.
 */
export const DEFAULT_QUESTION_FRACTION = 0.5;

/**
 * Compute the per-author weighting The Wall should apply so that the
 * COMBINED mix across formats lands closer to `BALANCED_AUTHOR_SHARE` than
 * The Question pool's own mix does alone.
 *
 * The algebra: for each author `a`, if a fraction `questionFraction` of the
 * week's posts are Question posts (share `q[a]` per `authorMix(questionPool)`)
 * and the remaining `1 - questionFraction` are Wall posts (share `w[a]`,
 * unknown), the combined share is:
 *
 *   combined[a] = questionFraction * q[a] + (1 - questionFraction) * w[a]
 *
 * Solving for `w[a]` that makes `combined[a] == 1/3` gives:
 *
 *   w[a] = (1/3 - questionFraction * q[a]) / (1 - questionFraction)
 *
 * Because `sum(q[a]) == 1`, the un-clamped solution always sums to exactly 1
 * across the three authors (`3 * 1/3 - sum(q[a]) == 1`), so it's already a
 * valid weight distribution UNLESS the Question pool's skew toward one
 * author is so severe that its solved Wall weight would need to be negative
 * (not possible here: the worst-skewed author, epictetus at 56%, is still
 * below the 66.7% ceiling at which its solved weight would hit zero — see
 * the corpus-level test). Weights are clamped to >= 0 and renormalized to
 * sum to 1 as a defensive measure for any future corpus where a Question
 * pool skews harder than that.
 *
 * `wallPool` is accepted (per the plan's specified signature) so a future
 * caller's weights are visibly tied to the pool they'll be applied against,
 * and so this function can guard against solving a positive weight for an
 * author the Wall pool cannot actually supply (also renormalized away).
 */
export function wallAuthorWeights(
  questionPool: QuestionEntry[],
  wallPool: RankedWallEntry[],
  questionFraction = DEFAULT_QUESTION_FRACTION,
): Record<AuthorSlug, number> {
  const questionMix = authorMix(questionPool);
  const wallMix = authorMix(wallPool);

  const raw = {} as Record<AuthorSlug, number>;
  for (const author of VALID_AUTHOR_SLUGS) {
    const solved = (BALANCED_AUTHOR_SHARE[author] - questionFraction * questionMix[author].share) / (1 - questionFraction);
    // An author with nothing in the Wall pool can't be assigned any weight,
    // regardless of what the algebra solves for.
    raw[author] = wallMix[author].count > 0 ? Math.max(0, solved) : 0;
  }

  const total = VALID_AUTHOR_SLUGS.reduce((sum, author) => sum + raw[author], 0);
  const weights = {} as Record<AuthorSlug, number>;
  for (const author of VALID_AUTHOR_SLUGS) {
    weights[author] = total > 0 ? raw[author] / total : 1 / VALID_AUTHOR_SLUGS.length;
  }
  return weights;
}

/**
 * Deterministic weighted selection, without replacement, of `n` entries from
 * `pool` — the mechanism The Wall uses to draw a week's cards so that the
 * resulting author mix honours `weights` (e.g. from `wallAuthorWeights`).
 *
 * Algorithm, repeated `min(n, pool.length)` times: (1) among authors that
 * still have unpicked entries, draw one author via roulette-wheel selection
 * weighted by `weights` (falling back to a uniform draw among remaining
 * authors if every remaining author's weight is 0 — keeps the function total
 * even against a degenerate all-zero weight map); (2) draw one entry
 * uniformly at random from that author's remaining bucket; (3) remove it so
 * it can never be picked twice.
 *
 * Deterministic and seedable: every random choice is drawn from `rng` (see
 * `createSeededRng`), never `Math.random()`, so the same `pool` + `weights` +
 * `rng` sequence (i.e. the same seed) always returns byte-identical output —
 * required by T12 for regeneration.
 */
export function selectWallBalanced<T extends { author_slug: AuthorSlug }>(
  pool: T[],
  weights: Record<AuthorSlug, number>,
  n: number,
  rng: () => number,
): T[] {
  const remaining = {} as Record<AuthorSlug, T[]>;
  for (const author of VALID_AUTHOR_SLUGS) remaining[author] = [];
  for (const entry of pool) remaining[entry.author_slug].push(entry);

  const selected: T[] = [];
  const draws = Math.min(n, pool.length);

  for (let i = 0; i < draws; i++) {
    const availableAuthors = VALID_AUTHOR_SLUGS.filter((author) => remaining[author].length > 0);
    const availableWeight = availableAuthors.reduce((sum, author) => sum + (weights[author] ?? 0), 0);

    let pickedAuthor: AuthorSlug;
    if (availableWeight > 0) {
      let r = rng() * availableWeight;
      pickedAuthor = availableAuthors[availableAuthors.length - 1];
      for (const author of availableAuthors) {
        r -= weights[author] ?? 0;
        if (r <= 0) {
          pickedAuthor = author;
          break;
        }
      }
    } else {
      const index = Math.min(Math.floor(rng() * availableAuthors.length), availableAuthors.length - 1);
      pickedAuthor = availableAuthors[index];
    }

    const bucket = remaining[pickedAuthor];
    const index = Math.min(Math.floor(rng() * bucket.length), bucket.length - 1);
    const [entry] = bucket.splice(index, 1);
    selected.push(entry);
  }

  return selected;
}

// ---------------------------------------------------------------------------
// T07a: The Objection's mechanical gate. Format: ONE short quoted line
// appears alone on screen — a claim the VIEWER instinctively wants to argue
// with, staged as an objection the author anticipates — followed by the
// author's own answer. This is a DIFFERENT structure inside the card than
// the original-vs-plain contrast every other format runs on: it runs on a
// second, internal structure — a quoted objection and its reply, both
// entirely within `plain_english`.
//
// T01 already built the loose precursor for this format (`quotedSpeech`,
// MechanicalGates.quotedSpeech — "plain_english contains >= 2 double
// quotes", measured 308). This section builds the ACTUAL mechanical gate the
// plan's format table specifies: a quoted span that starts with "But" or a
// question word, is at most 14 words, and contains no proper noun. Judging
// whether a surviving span reads as a position the VIEWER might hold (vs. a
// line from a dramatised scene, or a doctrinal dispute) needs an LLM — see
// `buildObjectionRubricSystem`/`buildObjectionRubricUser` in
// ./premises-scoring.ts (T07) — so this gate's only job is narrowing the
// full corpus down to a raw candidate pool cheaply, with no API calls.
// ---------------------------------------------------------------------------

/**
 * Words a quoted span must START with to read as an objection rather than a
 * plain statement: "But" (the classic anticipated-objection opener) plus a
 * set of question-word openers, including the interrogative-negative
 * contractions the plan calls out by example ("isn't"/"aren't"/"don't"/
 * "can't"/"shouldn't") and a few natural extensions of that same shape
 * ("wouldn't"/"won't"/"doesn't"/"didn't"/"couldn't"/"wasn't"/"weren't") —
 * all rhetorical-question openers of the same "isn't it true that..." kind
 * the plan's own list illustrates, not an exhaustive dictionary of every
 * possible question word. Matched case-insensitively at the START of the
 * (trimmed) span only — "starting with," not "containing."
 */
export const OBJECTION_OPENERS = [
  "But",
  "What",
  "Why",
  "How",
  "Who",
  "When",
  "Where",
  "Which",
  "Whose",
  "Whom",
  "Isn't",
  "Aren't",
  "Don't",
  "Can't",
  "Shouldn't",
  "Wouldn't",
  "Won't",
  "Doesn't",
  "Didn't",
  "Couldn't",
  "Wasn't",
  "Weren't",
] as const;

const OBJECTION_OPENER_RE = new RegExp(`^(${OBJECTION_OPENERS.join("|")})\\b`, "i");

/** Word-count ceiling for a candidate objection span, per the plan's format table. */
export const OBJECTION_GATE_MAX_WORDS = 14;

/**
 * Word-count floor for a candidate objection span. Below this, a quoted
 * span is a fragment or a bare interjection, not "a position the viewer
 * might hold" — the format's own requirement, from the plan, for what an
 * objection has to be. An objection is a proposition; a proposition needs a
 * subject and something said about it, which a 1-3 word span essentially
 * never has room for.
 *
 * Chosen by inspecting every raw-pool span at 1-6 words against the real
 * corpus (`content/output`) before picking a number, per the same
 * measure-first policy the rest of this file follows:
 *  - 1 word: `"But,"` (x4 across happy-life/on-anger/peace-of-mind),
 *    `"Why?"`, `"What?"`, `"How,"` — every one of these is a bare
 *    conjunction or interrogative with no proposition attached. Nothing to
 *    argue with.
 *  - 2 words: `"Don't eat,"`, `"How miserable."`, `"But wait,"`,
 *    `"What then?"` — still fragments; none states a position.
 *  - 3 words: `"Don't you care?"` (discourses-12-003) — the one 3-word
 *    span in the pool, and it's borderline-real ("don't you care [about
 *    this]?" gestures at a position), but it's an ELLIPTICAL rhetorical
 *    jab, not a stated claim, and at 3 words it's indistinguishable in
 *    shape from the 1-2 word fragments above without also reading the rest
 *    of the sentence — exactly the judgement call this mechanical gate is
 *    not supposed to make.
 *  - 4 words: the first point where genuine, self-contained positions show
 *    up reliably — `"But it's not fair,"` (discourses-64-004), `"But
 *    you'll be godless."` (discourses-16-004), `"What about my
 *    property?"` (discourses-01-004), `"Who are you threatening?"`
 *    (discourses-18-002), `"Shouldn't he be punished?"` (on-anger-03-079),
 *    `"Why are you upset?"` (peace-of-mind-14-004) — each one is a
 *    complete claim or challenge a viewer could actually hold and argue
 *    with. 4 words is also where the plan's own worked example,
 *    `"But it's not fair,"`, lands, which is the clearest signal this is
 *    the right floor rather than an arbitrary round number.
 *
 * 4 is therefore the floor: it rejects every 1-3 word fragment measured in
 * the corpus while admitting every 4-word span that reads as a real
 * position (the exclamation-shaped ones among those, e.g. `"What a
 * beautiful sight!"`, are still caught separately by
 * `isExclamationShaped` — see `objectionGate`).
 */
export const OBJECTION_GATE_MIN_WORDS = 4;

/** True when `text` (a candidate quoted span, already stripped of its surrounding `"` marks) starts with an `OBJECTION_OPENERS` word. */
export function startsWithObjectionOpener(text: string): boolean {
  return OBJECTION_OPENER_RE.test(text.trim());
}

/**
 * True when `text` is empty, or entirely punctuation/whitespace, once its
 * leading `OBJECTION_OPENERS` word is stripped off — i.e. the opener is
 * ALL the span has. `"But,"` is the real-corpus case this catches: it
 * starts with a valid opener and (before this rule existed) nothing else
 * disqualified it, but "But" plus a bare comma is not a position, it's a
 * dangling conjunction. In this corpus every such span is also short
 * enough to be caught by `OBJECTION_GATE_MIN_WORDS` already (a bare
 * opener-plus-punctuation is at most 1-2 words), but this check is kept
 * independent of word count so it also catches a hypothetical span like
 * `"But, --- ,"` that could pad its way past a pure word-count floor
 * without ever stating a claim.
 */
export function isOpenerOnly(text: string): boolean {
  const trimmed = text.trim();
  const match = OBJECTION_OPENER_RE.exec(trimmed);
  const rest = match ? trimmed.slice(match[0].length) : trimmed;
  return rest.replace(/[^a-zA-Z0-9]/g, "").length === 0;
}

/**
 * True when `text` contains a capitalized word, anywhere EXCEPT the leading
 * (sentence-initial) position, that reads as a proper noun — reusing T02's
 * `looksLikeProperNoun` exactly as instructed ("reuse where it helps; do
 * not rewrite"). `looksLikeProperNoun` already excludes bare "I" (its
 * length check requires >= 2 characters after stripping punctuation), so
 * this single reused predicate covers both parts of the spec's proper-noun
 * rule at once: "a capitalized word that is not sentence-initial and is not
 * 'I'." A proper noun makes the line about a SPECIFIC person in a scene
 * rather than a position any viewer could hold as their own — exactly the
 * dramatised-scene failure mode The Objection's LLM rubric (T07) exists to
 * catch qualitatively for everything this mechanical check can't.
 */
export function hasObjectionProperNoun(text: string): boolean {
  const words = text.trim().replace(/[—–]/g, " ").split(/\s+/);
  return words.some((word, index) => index > 0 && looksLikeProperNoun(word));
}

/** Every `"..."` quoted span within `sentence`, in order, as `[fullMatchEndIndex, content]` pairs. */
const QUOTE_SPAN_RE = /"([^"]+)"/g;

export interface ObjectionEntry {
  card_id: string;
  book_slug: string;
  author_slug: Card["author_slug"];
  /** The quoted line itself, exactly as it will appear on screen — the on-screen text is this string alone, never the surrounding quotes. */
  objection: string;
  /**
   * The author's answer to the objection: everything in `plain_english`
   * that comes after the quoted span closes. See `objectionGate` for how
   * this is assembled from the rest of the same sentence plus every
   * sentence that follows it. Can be an empty string when the objection is
   * the very last thing said in the card (measured: 2 of 78 raw
   * candidates) — `objectionGate` does not filter these out; a consumer
   * that requires a non-empty reply (the format's whole point is objection
   * THEN answer) should filter on `reply.length > 0` itself.
   */
  reply: string;
}

/**
 * The Objection's mechanical gate — no LLM calls.
 *
 * For each card, walks `sentences(card.plain_english)` (T02's quote-aware
 * splitter, reused rather than rewritten) and extracts every `"..."`
 * quoted span within each sentence. A span survives when its full content
 * (trimmed of the surrounding quote marks):
 *  - starts with an `OBJECTION_OPENERS` word (`startsWithObjectionOpener`);
 *  - is between `OBJECTION_GATE_MIN_WORDS` (4) and `OBJECTION_GATE_MAX_WORDS`
 *    (14) words, inclusive;
 *  - is not just its opener plus punctuation (`isOpenerOnly`) — a floor
 *    check independent of word count, see that function's doc comment;
 *  - contains no proper noun beyond the sentence-initial word
 *    (`hasObjectionProperNoun`);
 *  - is not exclamation-shaped (`isExclamationShaped`, reused from T04) —
 *    an exclamation ("What a beautiful sight!") is not a claim anyone
 *    argues with, it's an interjection.
 *
 * The word-floor, opener-only, and exclamation-shape checks together exist
 * because the format's requirement is that the objection be "a position
 * the viewer might hold" — a proposition. A bare conjunction (`"But,"`), a
 * bare interrogative (`"Why?"`), a two-word non-statement (`"How
 * miserable."`), or an exclamation (`"What a beautiful sight!"`) are none
 * of them propositions; nothing can be argued with any of them, so none of
 * them belong even in the LLM rubric's candidate pool. See
 * `OBJECTION_GATE_MIN_WORDS` for the corpus inspection behind the chosen
 * floor.
 *
 * Deliberately checks the SPAN'S FULL CONTENT against these three rules,
 * not each of the span's own internal sentences separately (a multi-
 * sentence quote like `"It's not fair. But I said nothing."` is judged as
 * one candidate and rejected here, since the whole span does not itself
 * start with an opener) — measured against the real corpus, judging by
 * internal sentence instead very nearly doubles the raw pool (148 vs. 78)
 * by counting throwaway mid-quote continuation sentences that only
 * incidentally start with a question word, not genuine anticipated
 * objections. Iterating sentence-by-sentence via `sentences()` rather than
 * regexing `card.plain_english` directly makes no difference to which
 * spans are found in this corpus — a well-formed quote pair can never
 * straddle a sentence boundary `sentences()` would introduce, by the same
 * invariant `sentences()` itself relies on for its own quote-tracking — but
 * it gets T02's defensive handling of malformed/unbalanced quote
 * characters for free, and it's what makes `reply` (below) simple to
 * assemble without re-deriving character offsets into the raw text.
 *
 * `reply` is the text following the quoted span: whatever remains of the
 * SAME sentence after the span's closing quote mark, followed by every
 * sentence after it in the card, joined with a single space. This is a
 * deliberate simplification, in the same spirit as T04's single-sentence
 * "candidate answer" — the format's own beat is "the quoted objection, then
 * the author's answer," and taking everything that follows (rather than
 * guessing how many sentences the "real" answer needs) is the simplest
 * definition that never truncates a genuine reply. T07's rubric
 * (`buildObjectionRubricUser`) doesn't consume this field directly — it
 * passes the whole card's `plain_english` as judging context instead — so
 * `reply` exists here for T08/rendering to use once a candidate is
 * accepted, not for the rubric call itself.
 *
 * Measured over the full corpus (`content/output`): **78** raw candidates —
 * epictetus 32, seneca 43, marcus-aurelius 3. This differs from the ad hoc
 * 61 (23/35/3) an earlier scan reported while drafting T07's prompt: that
 * scan was exploratory, not a formalized implementation of the plan's exact
 * definition, and the plan's own stated estimate (~50, splitting 24/24/2)
 * doesn't reproduce under this or any other definition tried either. 78 is
 * what this implementation of the stated spec measures — not contorted to
 * hit 50 or 61 — and it lands in the same neighbourhood as both prior
 * estimates (author mix dominated by epictetus/seneca, marcus-aurelius a
 * small minority), which is the check that matters: this pool still feeds
 * T07's LLM rubric, which is expected to cut it down to the plan's target
 * ~15-25 survivors.
 */
export function objectionGate(cards: Card[]): ObjectionEntry[] {
  const entries: ObjectionEntry[] = [];

  for (const card of cards) {
    const sents = sentences(card.plain_english);

    for (let i = 0; i < sents.length; i++) {
      const sentence = sents[i];

      for (const match of sentence.matchAll(QUOTE_SPAN_RE)) {
        const content = match[1].trim();
        if (!startsWithObjectionOpener(content)) continue;
        const wc = wordCount(content);
        if (wc > OBJECTION_GATE_MAX_WORDS) continue;
        if (wc < OBJECTION_GATE_MIN_WORDS) continue;
        if (isOpenerOnly(content)) continue;
        if (hasObjectionProperNoun(content)) continue;
        if (isExclamationShaped(content)) continue;

        const matchEnd = (match.index ?? 0) + match[0].length;
        const restOfSentence = sentence.slice(matchEnd).trim();
        const restOfCard = sents.slice(i + 1).join(" ").trim();
        const reply = restOfSentence ? `${restOfSentence} ${restOfCard}`.trim() : restOfCard;

        entries.push({
          card_id: card.id,
          book_slug: card.book_slug,
          author_slug: card.author_slug,
          objection: content,
          reply,
        });
      }
    }
  }

  return entries;
}
