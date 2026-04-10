import type { BookConfig } from "./constants.js";
import { VALID_TAGS } from "./constants.js";
import type { Chunk } from "./chunker.js";

const TAG_DESCRIPTIONS = VALID_TAGS.map(
  (t) => `"${t.slug}" — ${t.label}`,
).join("\n");

const AUTHOR_VOICE: Record<string, string> = {
  epictetus: `Epictetus is direct, instructional, and blunt. He speaks like a teacher who has no patience for excuses. The tone is firm but caring — "Here's what you control. Here's what you don't. Act accordingly." Use second person ("you") heavily. Keep sentences punchy and declarative.`,

  "marcus-aurelius": `Marcus Aurelius is reflective, personal, and sometimes weary. He is writing to himself in a private journal. The tone is quiet, honest, and inward — like someone talking themselves through a hard day. Preserve any sense of struggle or fatigue. Use second person sparingly (he addresses himself as "you" sometimes).`,

  seneca: `Seneca is warm, conversational, and occasionally wry. He writes like an intelligent friend giving advice over dinner. The tone is urbane but earnest — he genuinely wants to help. He uses vivid examples and analogies. Preserve any humor or self-awareness about his own contradictions. He sometimes addresses a specific person (Paulinus, Gallio, Serenus) — keep that personal quality.`,
};

const EXAMPLES: Record<string, string> = {
  epictetus: `EXAMPLE 1:
Original: "There are things which are within our power, and there are things which are beyond our power. Within our power are opinion, aim, desire, aversion, and, in one word, whatever affairs are our own. Beyond our power are body, property, reputation, office, and, in one word, whatever are not properly our own affairs."
Translation: "Some things are up to you. Some things are not. What's up to you: your opinions, your goals, what you want, and what you want to avoid — basically, anything that is truly your own doing. What's not up to you: your body, your possessions, your reputation, your job title — anything that isn't really your own doing."
Tags: ["freedom-and-control", "what-really-matters"]

EXAMPLE 2:
Original: "Men are disturbed not by things, but by the views which they take of things. Thus death is nothing terrible, else it would have appeared so to Socrates."
Translation: "It's not things that upset you. It's how you think about them. Death, for example, is not frightening on its own. If it were, Socrates would have been afraid of it."
Tags: ["calm-your-mind", "facing-fear"]`,

  "marcus-aurelius": `EXAMPLE 1:
Original: "Of my grandfather Verus I have learned to be gentle and meek, and to refrain from all anger and passion. From the fame and memory of him that begot me I have learned both shamefastness and manlike behaviour."
Translation: "From my grandfather Verus I learned to be gentle and calm, and to hold back anger. From the memory of my father I learned both humility and strength of character."
Tags: ["self-discipline", "what-really-matters"]

EXAMPLE 2:
Original: "Remember how long thou hast already put off these things, and how often a certain day and hour as it were, having been set unto thee by the gods, thou hast neglected it."
Translation: "Remember how long you have been putting these things off. Again and again you have been given the chance, and you have let it pass."
Tags: ["self-discipline", "what-really-matters"]`,

  seneca: `EXAMPLE 1:
Original: "The greater part of mankind, my Paulinus, complains of the unkindness of Nature, because we are born only for a short space of time, and that this allotted period of life runs away so swiftly."
Translation: "Most people, Paulinus, complain that nature has been unfair to us. They say we are born with too little time, and that even the time we are given slips away far too quickly."
Tags: ["death-and-mortality", "what-really-matters"]

EXAMPLE 2:
Original: "We do not have a very short time assigned to us, but we lose a great deal of it: life is long enough to carry out the most important projects."
Translation: "We haven't been given a short life. We've just wasted a lot of it. Life is long enough to do great things — if you stop throwing it away."
Tags: ["self-discipline", "what-really-matters"]`,
};

/** Static system prompt for a given author — cacheable across all chunks of the same book */
export function buildTranslationSystem(bookConfig: BookConfig): string {
  const voice = AUTHOR_VOICE[bookConfig.author_slug] ?? "";
  const examples = EXAMPLES[bookConfig.author_slug] ?? "";
  const authorName =
    bookConfig.author_slug === "marcus-aurelius"
      ? "Marcus Aurelius"
      : bookConfig.author_slug === "epictetus"
        ? "Epictetus"
        : "Seneca";

  return `You are translating passages from "${bookConfig.title}" by ${authorName} into plain, modern English.

VOICE GUIDANCE:
${voice}

RULES:
1. Target Flesch-Kincaid Grade Level 7-8 (Reading Ease ~65-75).
2. Keep the original meaning intact. Do not add ideas or remove ideas.
3. Keep the same structure and paragraph breaks as the original.
4. Use short sentences. Average ~15 words per sentence. Prefer common words.
5. Preserve the emotional tone. If the author sounds tired, frustrated, playful, or urgent — keep that.
6. Replace archaic words ("thou", "thee", "hast", "doth", "forbear") with modern equivalents.
7. Use active voice. Use second person ("you") where it feels natural.
8. Do not over-explain. Do not patronize. Trust the reader.
9. Each passage should make sense on its own to someone who hasn't read the surrounding text.

TAG ASSIGNMENT:
Assign 1-3 tags from this fixed list that best describe the passage's theme:
${TAG_DESCRIPTIONS}

${examples}

---

Your task has two steps. Do them in order.

STEP 1 — TRANSLATE:
Read the original passage and write a plain English translation following the rules and voice guidance above. Assign 1-3 tags.

STEP 2 — VERIFY:
Re-read the original passage. Then re-read your translation. Answer honestly:
(a) Does your translation preserve the original meaning precisely? (faithful)
(b) Does it preserve the emotional tone? (tone_preserved)
(c) Did you add or remove any ideas? (ideas_changed)
(d) Does it over-explain or patronize? (over_explains)
If you find a problem in step 2, revise your translation before responding.

Respond with ONLY this JSON (no other text):

{
  "plain_english": "your translation here",
  "tags": ["tag-1", "tag-2"],
  "faithful": true,
  "tone_preserved": true,
  "ideas_changed": false,
  "over_explains": false,
  "verification_notes": null
}

Set booleans accordingly. Use verification_notes (one sentence) only if there is an issue you could not fully resolve.`;
}

/** Per-chunk user message — only the original text */
export function buildTranslationUser(chunk: Chunk): string {
  return `ORIGINAL:\n${chunk.text}`;
}

export function buildTranslationPrompt(
  chunk: Chunk,
  bookConfig: BookConfig,
): string {
  return `${buildTranslationSystem(bookConfig)}\n\n${buildTranslationUser(chunk)}`;
}
