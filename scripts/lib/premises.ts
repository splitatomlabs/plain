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

/** Cards whose `book_slug` is in `slugs`. */
export function byBook(cards: Card[], slugs: string[]): Card[] {
  const set = new Set(slugs);
  return cards.filter((c) => set.has(c.book_slug));
}

// Pf39c2-social-pilot-02a D01: `mechanicalGates`/`MechanicalGates` (and the
// `hasQuotedSpeech`/`lengthDelta` helpers it alone used) measured population
// counts for the Still gate (`still12Word`) and the Objection precursor
// (`quotedSpeech`/`lengthDelta30`) — both formats were deleted outright (the
// channel is one Wall a day, drawn from the Wall pool, nothing else), and
// nothing else called this function, so it went with them.

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
// of them is `reserve`.
//
// All three sub-type checks run against `original_excerpt` (not
// plain_english) — the wall of text the viewer actually sees in phase 1.
//
// T17 (social pilot 02a) retired the two numeric OPENING treatments this
// pass used to also flag every entry for ("190 -> 97", a word-count
// countdown, and "Grade 14", a bare reading-grade readout) — see that
// plan's own paragraph for why: neither replaces the other, both are
// deleted outright, no third numeral takes their place. `original_grade`
// (below, via `originalReadingGrade`) survives as plain measured data on
// every ranked entry; `eligible_openings`/`eligibleWallOpenings`/
// `WallOpening` do not.
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

/**
 * The original excerpt's Flesch-Kincaid grade level, via the same
 * `text-readability` call `validateReadability` uses on the plain version
 * (`scripts/lib/validate.ts`) — kept identical so grades are comparable
 * across the pipeline. Plain measured data on every ranked entry
 * (`RankedWallEntry.original_grade`) — not tied to any opening mechanic.
 */
export function originalReadingGrade(card: Card): number {
  return rs.fleschKincaidGrade(card.original_excerpt);
}

export interface RankedWallEntry extends WallEntry {
  sub_types: WallSubType[];
  reserve: boolean;
  archaic_marker_count: number;
  semicolon_count: number;
  quote_count: number;
  original_grade: number;
}

/**
 * Rank every T02 `wallGate` survivor (a card that already has a landing
 * line) by visual-archaism sub-type.
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
    };
  });
}

/**
 * Pf39c2-social-pilot-02a D01: The Question format (its mechanical gate,
 * layers (a)/(b), and `questionGate` itself) was deleted outright — the
 * channel is one Wall a day, drawn from the Wall pool, nothing else. This
 * shape survives ONLY because `wallAuthorWeights` below still takes a
 * Question pool as an input to its author-balance correction (and
 * `./schedule.ts` still carries a `FormatPools.question` field, kept
 * compiling by D01, restructured away by D02) — every entry is always `[]`
 * now that nothing produces one. See that plan's "Deprecation" section.
 */
export interface QuestionEntry {
  card_id: string;
  book_slug: string;
  author_slug: Card["author_slug"];
  question: string;
  answer: string;
  rejected_by?: string;
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
 *
 * T17 note: when a `readThrough` context is passed to `wallAuthorWeights`,
 * this fraction describes the split of the FREE (non-read-through) slots
 * only, not the whole week — see `ReadThroughShareContext`.
 */
export const DEFAULT_QUESTION_FRACTION = 0.5;

/**
 * T17: the read-through's fixed contribution to a week's author mix.
 *
 * T16 moved the pilot's default read-through onto Meditations, so every
 * read-through slot's author is now fixed to a single philosopher instead
 * of drawing from a pool. That author is NOT something Wall's weighting can
 * offset — it is a hard floor. Passing this context to `wallAuthorWeights`
 * makes the solve target the COMBINED 14-slot mix (read-through + free
 * slots) instead of pretending the free slots are the whole week, which is
 * what caused Marcus Aurelius to be counted twice (50% from the
 * read-through, then another ~43% from a Wall correction that still assumed
 * no read-through existed) — see the module's T05 section for the pre-T17
 * mechanism this replaces.
 */
export interface ReadThroughShareContext {
  /** The fixed author of every read-through slot this week (e.g. the read-through book's author — one book, one author). */
  author: AuthorSlug;
  /**
   * Fraction of the week's TOTAL slots (read-through + free) occupied by
   * the read-through — e.g. 7/14 = 0.5 for the pilot's 7-day, 2-slot-per-day
   * week (1 read-through slot + 1 free slot per day).
   */
  slotShare: number;
  /**
   * The Objection pool — folds its own natural (unweighted, uncorrected —
   * The Objection draws uniformly from its pool, same as The Question)
   * author mix into the free-slot budget, exactly as `questionPool` already
   * does for The Question. Required (rather than defaulted to `[]`) because
   * an empty pool would silently zero out the `objection` share of
   * `freeSlotFormatShare` below without reducing that share itself, which
   * would make the free-slot budget sum to less than 1 — see the "no format
   * share may be asserted without also supplying its pool" guard in
   * `wallAuthorWeights`.
   */
  objectionPool: { author_slug: AuthorSlug }[];
  /**
   * Expected format split of the FREE (non-read-through) slots — what
   * fraction of that budget is expected to render as Wall vs. Question vs.
   * Objection. Defaults to the ratio `generateWeek` (./schedule.ts) actually
   * draws slot 2's format from — `DEFAULT_FORMAT_WEIGHTS` there is `{ wall:
   * 7, question: 6, objection: 1 }` (sum 14), which reduces to `{ wall: 0.5,
   * question: 3/7, objection: 1/14 }`; not imported directly to avoid a
   * schedule.ts <-> premises.ts import cycle, so this default is kept in
   * sync by hand and by `schedule.test.ts`'s cross-check.
   */
  freeSlotFormatShare?: { wall: number; question: number; objection: number };
}

/** See `ReadThroughShareContext.freeSlotFormatShare`'s doc comment for where 7:6:1 comes from. */
export const DEFAULT_FREE_SLOT_FORMAT_SHARE = { wall: 7 / 14, question: 6 / 14, objection: 1 / 14 };

/**
 * Compute the per-author weighting The Wall should apply so that the
 * COMBINED mix across formats lands closer to `BALANCED_AUTHOR_SHARE` than
 * The Question pool's own mix does alone.
 *
 * Two modes, selected by whether `readThrough` is passed:
 *
 * 1. **No `readThrough` (default, byte-identical to the pre-T17 function).**
 *    For each author `a`, if a fraction `questionFraction` of the week's
 *    posts are Question posts (share `q[a]` per `authorMix(questionPool)`)
 *    and the remaining `1 - questionFraction` are Wall posts (share `w[a]`,
 *    unknown), the combined share is:
 *
 *      combined[a] = questionFraction * q[a] + (1 - questionFraction) * w[a]
 *
 *    Solving for `w[a]` that makes `combined[a] == 1/3`:
 *
 *      w[a] = (1/3 - questionFraction * q[a]) / (1 - questionFraction)
 *
 * 2. **With `readThrough` (T17).** A `readThrough.slotShare` fraction of
 *    the week is fixed to `readThrough.author` regardless of what Wall
 *    does, and only the remaining `freeShare = 1 - slotShare` is split
 *    across Wall/Question/Objection per `freeSlotFormatShare`. The combined
 *    share generalizes to:
 *
 *      combined[a] = slotShare * (a == readThrough.author ? 1 : 0)
 *                  + freeShare * (wallShare * w[a] + questionShare * q[a] + objectionShare * o[a])
 *
 *    Solving for `w[a]` that makes `combined[a] == 1/3`:
 *
 *      w[a] = (1/3 - slotShare*(a==author) - freeShare*questionShare*q[a] - freeShare*objectionShare*o[a])
 *             / (freeShare * wallShare)
 *
 *    REACHABLE FLOOR: `readThrough.author`'s combined share can never drop
 *    below `readThrough.slotShare` — Wall supplies none of the
 *    read-through's fixed slots, so its solved weight for that author comes
 *    out negative whenever `slotShare` alone already exceeds 1/3 (true for
 *    the pilot's default 7/14 = 0.5: that author is mathematically
 *    guaranteed at least 50%, so the even 1/3 target is UNREACHABLE for it,
 *    by design, not by a bug). The clamp below turns that negative solve
 *    into 0 — "give that author none of Wall's discretionary weight" — which
 *    is the correct "push as far as possible" answer, not a workaround.
 *    `freeShare * wallShare` can also be 0 (a week with no read-through-free
 *    Wall budget at all, e.g. `slotShare` -> 1 or `freeSlotFormatShare.wall`
 *    -> 0); that is guarded explicitly rather than left to divide-by-zero,
 *    and falls through to the same "no signal, weight evenly" renormalize
 *    step used when every author's Wall pool is empty.
 *
 * In both modes, an author absent from `wallPool` gets weight 0 regardless
 * of the algebra, and the raw solved weights are clamped to `>= 0`
 * (`Math.max`) then renormalized to sum to exactly 1 (equivalently, into
 * `[0, 1]`) — defensive for any corpus/config where a pool skews harder
 * than the target can absorb.
 */
export function wallAuthorWeights(
  questionPool: QuestionEntry[],
  wallPool: RankedWallEntry[],
  questionFraction = DEFAULT_QUESTION_FRACTION,
  readThrough?: ReadThroughShareContext,
): Record<AuthorSlug, number> {
  const questionMix = authorMix(questionPool);
  const wallMix = authorMix(wallPool);

  const raw = {} as Record<AuthorSlug, number>;

  if (readThrough === undefined) {
    for (const author of VALID_AUTHOR_SLUGS) {
      const solved = (BALANCED_AUTHOR_SHARE[author] - questionFraction * questionMix[author].share) / (1 - questionFraction);
      // An author with nothing in the Wall pool can't be assigned any weight,
      // regardless of what the algebra solves for.
      raw[author] = wallMix[author].count > 0 ? Math.max(0, solved) : 0;
    }
  } else {
    const objectionMix = authorMix(readThrough.objectionPool);
    const { wall: wallShare, question: questionShare, objection: objectionShare } =
      readThrough.freeSlotFormatShare ?? DEFAULT_FREE_SLOT_FORMAT_SHARE;
    const freeShare = 1 - readThrough.slotShare;
    const denom = freeShare * wallShare;

    for (const author of VALID_AUTHOR_SLUGS) {
      if (denom <= 0) {
        // No free-slot Wall budget to solve for at all (see the doc
        // comment's REACHABLE FLOOR note) — leave raw at 0 for every
        // author; the renormalize step below falls back to an even split.
        raw[author] = 0;
        continue;
      }
      const fixedContribution =
        readThrough.slotShare * (author === readThrough.author ? 1 : 0) +
        freeShare * questionShare * questionMix[author].share +
        freeShare * objectionShare * objectionMix[author].share;
      const solved = (BALANCED_AUTHOR_SHARE[author] - fixedContribution) / denom;
      raw[author] = wallMix[author].count > 0 ? Math.max(0, solved) : 0;
    }
  }

  const total = VALID_AUTHOR_SLUGS.reduce((sum, author) => sum + raw[author], 0);
  const weights = {} as Record<AuthorSlug, number>;
  for (const author of VALID_AUTHOR_SLUGS) {
    weights[author] = total > 0 ? Math.min(1, Math.max(0, raw[author] / total)) : 1 / VALID_AUTHOR_SLUGS.length;
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

/**
 * Pf39c2-social-pilot-02a D01: The Objection format (its mechanical gate,
 * `objectionGate` itself, and every OBJECTION_* opener/word-count helper)
 * was deleted outright — the channel is one Wall a day, drawn from the Wall
 * pool, nothing else. This shape survives for the same reason `QuestionEntry`
 * does — see that interface's own doc comment.
 */
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
  /**
   * The character offset into THIS entry's own card's `card.plain_english`
   * immediately after the matched quoted span (`"${objection}"`, closing
   * quote included) closes — i.e. `card.plain_english.slice(reply_start)`
   * is the exact remainder of the raw string, before trimming, that
   * `reply` above was assembled from.
   *
   * Exists so a consumer can re-derive a guaranteed-verbatim reply by
   * slicing the card's own text directly (`card.plain_english.slice(
   * reply_start).trim()`) instead of re-searching for the quoted span with
   * `indexOf`, which always resolves to the FIRST occurrence in the card
   * and silently returns the wrong text when a card quotes the same
   * objection span more than once (see M8 in the PR #39 second review
   * round — reproduced with a card quoting `"But it is not fair at all."`
   * twice). `reply_start` is captured HERE, from the same walk over
   * `sentences(card.plain_english)` that found the matching span in the
   * first place, so it is correct by construction for whichever occurrence
   * this particular entry actually came from — no re-searching, and so no
   * possibility of resolving to the wrong occurrence.
   */
  reply_start: number;
}

