# Plain — Content Strategy

## Core Concept

Classic Stoic philosophy books, chunked into bite-sized cards and translated into plain English at an 8th-grade reading level. The goal is genuine depth — encouraging users to read full books, not just browse quotes.

This is a Stoic-only product. The tight focus builds identity, makes distribution easier (the Stoic community is large, active, and easy to find), and creates a stronger completion incentive. Expansion to broader philosophy is a future act, not a launch concern.

---

## The Three Voices of Stoicism

This is the central narrative framing for the product. Stoicism's most powerful selling point is that the same philosophy was practiced by people in radically different life circumstances:

- **The Slave** — Epictetus. Born into slavery, physically disabled, eventually freed. Taught philosophy in a small school. His work is blunt, practical, and direct. He had nothing and found everything he needed in his own mind.
- **The Emperor** — Marcus Aurelius. Ruled the Roman Empire during plague, war, and betrayal. Wrote his reflections as a private journal never intended for publication. His work is introspective, personal, and sometimes raw.
- **The Senator** — Seneca. Advisor to Emperor Nero, one of the wealthiest men in Rome, eventually forced to take his own life by the emperor he served. His work is warm, conversational, and often wryly self-aware about the contradictions of preaching simplicity while living in luxury.

### How This Appears in the UI

- The home page organizes books under these three figures, not as a flat list.
- Each figure gets a brief, compelling bio (2–3 sentences, written at the same 8th-grade reading level as the cards).
- The visual treatment should differentiate the three — not through heavy theming, but through subtle cues (a distinct accent color per figure, or a small icon/motif).
- The framing invites the reader to explore: "Three men. Three completely different lives. The same philosophy."
- This structure also makes the cross-book tag experience more powerful — when you tap a tag like "facing hardship," seeing how a slave, an emperor, and a senator each approached the same problem is genuinely compelling.

---

## Launch Books (5 titles)

### The Slave — Epictetus

**1. The Enchiridion (The Manual)**
- Source: Project Gutenberg #45109
- Translation: Thomas Wentworth Higginson (public domain)
- Structure: 53 short sections (no chapter divisions — continuous numbered sections)
- Estimated cards: 60–80
- Character: Direct, instructional, no-nonsense. "Here's what you control. Here's what you don't. Act accordingly."
- Best for: Someone new to Stoicism who wants the essentials fast.
- Key themes: freedom & control, knowing yourself, calm your mind, what matters most

### The Emperor — Marcus Aurelius

**2. Meditations**
- Source: Project Gutenberg #2680
- Translation: George Long (public domain)
- Structure: 12 "books" (chapters), each containing numbered reflections — the only launch book with real author-defined chapters
- Estimated cards: 150–200
- Character: Private, reflective, sometimes struggling. He's writing to himself, reminding himself to be better. You're reading someone's journal.
- Best for: The flagship text. Highest name recognition. Most people start here.
- Key themes: calm your mind, facing hardship, death & mortality, knowing yourself, doing the right thing, what matters most

### The Senator — Seneca

**3. On the Shortness of Life**
- Source: Project Gutenberg #64576 (part of "Minor Dialogues, Together With the Dialogue on Clemency")
- Translation: Aubrey Stewart (public domain)
- Structure: Single essay, roughly 20 sections (no chapter divisions)
- Estimated cards: 40–60
- Character: Punchy, urgent, almost angry. Seneca is frustrated watching people waste their lives. This is his most quotable, most shareable work.
- Best for: The "gateway drug." Nearly every passage hits hard in isolation. Ideal for sharing.
- Key themes: what matters most, knowing yourself, death & mortality, calm your mind

**4. On the Happy Life**
- Source: Project Gutenberg #64576 (part of "Minor Dialogues, Together With the Dialogue on Clemency")
- Translation: Aubrey Stewart (public domain)
- Structure: Single essay, roughly 28 sections (no chapter divisions)
- Estimated cards: 40–60
- Character: Defensive, philosophical, surprisingly personal. Seneca is responding to critics who call him a hypocrite — a man preaching Stoic simplicity while living in luxury. He doesn't dodge the accusation. He argues that pursuing virtue and possessing wealth aren't contradictions, as long as wealth doesn't possess you.
- Best for: Someone wrestling with the gap between their ideals and their actual life. The most relatable Seneca essay for modern readers.
- Key themes: what matters most, knowing yourself, doing the right thing, human nature

**5. On Peace of Mind (De Tranquillitate Animi)**
- Source: Project Gutenberg #64576 (part of "Minor Dialogues, Together With the Dialogue on Clemency")
- Translation: Aubrey Stewart (public domain)
- Structure: Single essay, roughly 17 sections (no chapter divisions)
- Estimated cards: 40–60
- Character: Practical, warm, prescriptive. Written as a response to his friend Serenus, who is anxious and restless. Seneca diagnoses the problem and offers concrete advice — how to choose work, handle setbacks, deal with loss, and find calm without withdrawing from life.
- Best for: Someone who already knows something is wrong but can't name it. The most directly useful of Seneca's essays.
- Key themes: calm your mind, facing hardship, knowing yourself, what matters most, freedom & control

---

## Card Design

### What a Card Is

A card is NOT a single quote or sentence. It is a meaningful chunk — typically a full paragraph, a short passage, or a self-contained idea — carrying enough context that the reader gains genuine understanding.

Each card has two layers:
1. **Plain English translation** — the primary text. Written at an 8th-grade reading level. Clear, direct, modern language. No dumbing down — simplifying language while preserving the depth of the idea.
2. **Original text** — shown below in smaller, muted type. Collapsible/expandable. Lets curious readers see the source and appreciate the translation work.

### Plain English Writing Guidelines

- Target: 8th-grade reading level (Flesch-Kincaid Grade Level 8 or below).
- Use short sentences. Average 15 words per sentence.
- Use common words. Replace "ameliorate" with "improve." Replace "perturbation" with "worry."
- Use active voice. "You control your reactions" not "One's reactions are within one's control."
- Use second person ("you") where appropriate to make it feel direct and personal.
- Preserve the original meaning precisely. Never add ideas that aren't in the source text.
- Preserve the emotional tone. If Marcus Aurelius sounds tired and frustrated, the plain English should feel tired and frustrated. If Seneca sounds playful, keep the playfulness.
- Don't over-explain. Trust the reader. A good card makes you think, not think for you.
- Each card should stand alone. A reader landing on a single shared card should be able to understand it without context.

### Card Data Model

```json
{
  "id": "meditations-05-016",
  "book_slug": "meditations",
  "chapter_slug": "book-05",
  "card_number": 16,
  "total_cards_in_chapter": 34,
  "plain_english": "The quality of your thoughts shapes the quality of your life. If you constantly think about what's wrong, you'll feel miserable. But if you train yourself to notice what's working, what's true, and what's good — your mind becomes a place you actually want to live in.",
  "original_excerpt": "The happiness of your life depends upon the quality of your thoughts: therefore, guard accordingly, and take care that you entertain no notions unsuitable to virtue and reasonable nature.",
  "source_reference": "Meditations, Book 5, Section 16",
  "author_slug": "marcus-aurelius",
  "tags": ["calm-your-mind", "knowing-yourself", "what-matters-most"],
  "reading_time_seconds": 30
}
```

---

## Tag System

Exactly 8 tags. Plain emotional language that an 8th grader would search for. Every tag spans at least 3 of the 5 books.

| Tag Slug | Display Label | Description |
|---|---|---|
| `calm-your-mind` | Calm Your Mind | Inner tranquility, managing anxiety, stillness of thought, composure under pressure |
| `death-and-mortality` | Death & Mortality | Acceptance of death, impermanence, memento mori, legacy, grief, the shortness of life |
| `doing-the-right-thing` | Doing The Right Thing | Virtue, justice, ethics, duty, integrity, moral courage, fairness to others |
| `facing-hardship` | Facing Hardship | Enduring fear, anger, pain, loss, and adversity with resilience and courage |
| `freedom-and-control` | Freedom & Control | Distinguishing what is up to us from what is not, letting go, acceptance, detachment |
| `human-nature` | Human Nature | Understanding others, empathy, social bonds, forgiveness, tolerance |
| `knowing-yourself` | Knowing Yourself | Self-discipline, self-awareness, honesty with oneself, personal accountability |
| `what-matters-most` | What Matters Most | Priorities, ambition, use of time, purpose, simplicity, what to pursue and ignore |

### Tag Coverage Across Books

| Tag | Enchiridion | Meditations | Shortness of Life | Happy Life | Peace of Mind |
|---|---|---|---|---|---|
| calm-your-mind | heavy | heavy | light | light | heavy |
| death-and-mortality | light | heavy | heavy | medium | medium |
| doing-the-right-thing | heavy | heavy | medium | heavy | medium |
| facing-hardship | heavy | heavy | light | light | heavy |
| freedom-and-control | heavy | heavy | medium | medium | heavy |
| human-nature | medium | medium | heavy | heavy | medium |
| knowing-yourself | heavy | heavy | heavy | heavy | heavy |
| what-matters-most | heavy | heavy | heavy | heavy | heavy |

### Tag UX

- Tags appear as small tappable pills on each card.
- Tapping a tag shows related cards across all books, grouped by author (slave / emperor / senator). Default view should be one card per the two other authors to give diverse perspectives on the current card.
- No complex filtering UI. Just tap and explore.
- Tag pages use the three-voices framing: "Here's what the slave, the emperor, and the senator each had to say about [facing fear]."

---

## Progress & Milestones

### Progress Tracking

- Progress is tracked per book: "34 of 120 cards read."
- A card is marked "read" when the user advances to the next card (not on page load).
- Visual: a progress ring or bar on each book's landing page.
- "Continue where you left off" is the default returning-user experience.

### Author Progress

Author-level progress aggregates all books for a given figure into a single number. This is the highest-level view of a reader's journey and the primary progress visual on the home page for returning users.

- **Calculation:** sum of cards read across all books by that author / sum of total cards across all books by that author.
- **Display:** progress ring per author on the home page, using the author's accent color.
- **Purpose:** encourages cross-book exploration within an author ("I've finished On the Shortness of Life — what else did Seneca write?") and cross-author exploration ("I've read 80% of the Emperor but only 30% of the Senator").
- Book-level progress remains visible on individual book landing pages and within author sections on the home page, but author progress is the top-level metric.

### Milestone Celebrations

At 25%, 50%, 75%, and 100% thresholds, show a brief interstitial message that connects to the book's content and author. Examples:

**Meditations — 50%:**
"You're halfway through Marcus Aurelius. He wrote this while leading an empire and fighting a plague — you're keeping up."

**Enchiridion — 25%:**
"A quarter of the way through Epictetus. Remember — he developed this entire philosophy while living as a slave. He'd say you're already freer than most people."

**On the Happy Life — 75%:**
"Three-quarters through Seneca's defense of his own life. He was one of the richest men in Rome, writing about simplicity. His critics called him a hypocrite. His answer might surprise you."

**On the Shortness of Life — 100%:**
"You've finished Seneca's most urgent essay. He wrote it nearly 2,000 years ago, but the people he describes — busy, distracted, always planning for later — could be anyone on your commute this morning."

### Tag Milestones

Tag milestones reward cross-book exploration. When a reader has read a certain number of cards with a given tag, show a brief message on the tag page. Thresholds: **5 cards**, **15 cards**, and **30 cards**.

Messages should highlight the cross-author perspective — the whole point is seeing how the slave, the emperor, and the senator approached the same idea differently.

Examples:

**calm-your-mind — 5 cards:**
"Five different ways to quiet your mind — from three men with very different problems. Keep going."

**death-and-mortality — 15 cards:**
"You've now read 15 passages on death from people who lived nearly 2,000 years ago. Notice how little the fear has changed — and how consistent the advice is."

**knowing-yourself — 30 cards:**
"Thirty passages on knowing yourself. A slave, an emperor, and a senator all came to the same conclusion: freedom isn't about your circumstances. It's about what you do with your attention."

**what-matters-most — 15 cards:**
"Fifteen cards. Three authors. Two thousand years ago. And they keep saying the same thing: stop chasing what doesn't matter."

**facing-hardship — 5 cards:**
"Epictetus faced it as a slave. Marcus faced it leading an empire at war. Seneca faced it serving a tyrant. You're starting to see how they each handled it."

Design notes:
- Tag milestones appear as a subtle banner on the tag page, not as an interstitial. They should feel like a quiet reward for curiosity, not an interruption.
- The 30-card milestone is shareable — "I've read 30 passages on [Death & Mortality] across all five books."
- Thresholds are fixed numbers, not percentages. These can be revisited as the content library grows.

### Completion

When a user finishes all cards in a book:
- Redirect to a dedicated completion page.
- Show a summary of key themes from the book.
- Offer a shareable completion image: "I just read all of Meditations — in plain English."
- Suggest the next book based on which author/voice they might enjoy.

---

## Sharing

Three mechanisms. All should feel like giving something valuable to the recipient, never promotional.

### 1. Single Card Share
- Every card has a share button (Web Share API on mobile, clipboard fallback on desktop).
- Shared URL is the card's permalink.
- Open Graph preview shows the plain English text on a clean card image with source attribution.
- The recipient sees the card immediately with no sign-up. Below: "This is card 47 of 120 from Meditations. Start from the beginning?"

### 2. Completion Share
- Generated image: "I just read all of [Book Title] — in plain English"
- Clean, beautiful, suitable for LinkedIn / Twitter / Instagram Stories.
- Entirely opt-in. Only shown on the completion page.

### 3. Gift a Book
- "Send this book to a friend" with an optional personal note.
- Recipient sees: the friend's note, the book description, "Start reading."
- The note is encoded in the URL (no database needed).

---

## Content Pipeline (How to Produce the Cards)

### Step 1: Source Text Preparation
- Download the public domain translation from Gutenberg or other source.
- Clean up formatting artifacts, footnotes, translator commentary.
- Split into logical chunks (one per future card). Each chunk should be a self-contained idea.

### Step 2: Plain English Translation
- Use Claude to assist with initial translations, but human-review every card.
- Prompt strategy: Provide the original passage, ask for a plain English rewrite at 8th-grade reading level, preserving meaning and emotional tone.
- Validate reading level using Flesch-Kincaid scoring.

### Step 3: Tagging
- Assign 1–3 tags per card from the fixed set of 8.
- Use Claude to assist with initial tagging, then human-review for consistency.
- Check: does every tag have reasonable coverage across books? Does any tag dominate too heavily?

### Step 4: Quality Review
- Read each card in isolation. Does it make sense without context?
- Read cards in sequence. Does the book flow naturally from card to card?
- Check that the original excerpt maps correctly to the plain English version.
- Verify source references are accurate.

### Estimated Total Content

| Book | Est. Cards | Author |
|---|---|---|
| The Enchiridion | 60–80 | Epictetus |
| Meditations | 150–200 | Marcus Aurelius |
| On the Shortness of Life | 40–60 | Seneca |
| On the Happy Life | 40–60 | Seneca |
| On Peace of Mind | 40–60 | Seneca |
| **Total** | **330–460** | |

---

## Future Content Expansion

These are explicitly out of scope for launch, noted here for planning:

**Wave 2 — Deeper Stoic Canon:**
- Discourses of Epictetus (full text, 4 books — much longer and denser than the Enchiridion)
- Letters to Lucilius — Seneca (full 124 letters, read front to back as a complete correspondence)
- Seneca's On Anger, On Clemency

**Wave 3 — Stoic-Adjacent Philosophy:**
- Walden — Henry David Thoreau (bridges to Stoic themes naturally)
- The Prince — Niccolò Machiavelli (counterpoint: what happens when you reject Stoic virtue)
- On Liberty — John Stuart Mill
- Beyond Good and Evil — Friedrich Wilhelm Nietzsche

**Wave 4 — Ancient Foundations:**
- Cicero's Stoic Paradoxes
- Musonius Rufus lectures
- Hierocles fragments
