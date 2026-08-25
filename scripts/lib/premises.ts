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
function looksLikeProperNoun(word: string): boolean {
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
