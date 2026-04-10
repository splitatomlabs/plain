# Philosophy Cards — Content Strategy

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
- This structure also makes the cross-book tag experience more powerful — when you tap a tag like "facing fear," seeing how a slave, an emperor, and a senator each approached the same problem is genuinely compelling.

---

## Launch Books (4 titles)

### The Slave — Epictetus

**1. The Enchiridion (The Manual)**
- Source: Project Gutenberg #45109
- Translation: Thomas Wentworth Higginson (public domain)
- Structure: 53 short sections
- Estimated cards: 60–80
- Character: Direct, instructional, no-nonsense. "Here's what you control. Here's what you don't. Act accordingly."
- Best for: Someone new to Stoicism who wants the essentials fast.
- Key themes: freedom & control, self-discipline, calm your mind, what really matters

### The Emperor — Marcus Aurelius

**2. Meditations**
- Source: Project Gutenberg #2680
- Translation: George Long (public domain)
- Structure: 12 "books" (chapters), each containing numbered reflections
- Estimated cards: 150–200
- Character: Private, reflective, sometimes struggling. He's writing to himself, reminding himself to be better. You're reading someone's journal.
- Best for: The flagship text. Highest name recognition. Most people start here.
- Key themes: calm your mind, dealing with anger, death & mortality, self-discipline, leading others, doing the right thing, what really matters

### The Senator — Seneca

**3. Letters to Lucilius (Selected)**
- Source: Richard M. Gummere translation (1917–1925, public domain). Available via Wikisource and Internet Archive.
- Structure: Curated selection of 20–30 letters from the full collection of 124.
- Estimated cards: 120–150
- Character: Warm, conversational, personal. Seneca writes to a younger friend, sharing wisdom from his own messy, complicated life. He quotes other philosophers freely and isn't afraid to admit his own failures.
- Best for: Someone who wants philosophy that feels like advice from a wise friend, not a textbook.
- Key themes: facing fear, death & mortality, doing the right thing, human nature, what really matters, freedom & control, ambition & power
- Note on letter selection: Prioritize letters that are self-contained, emotionally resonant, and translate well to plain English. Strong candidates include Letter 1 (on saving time), Letter 3 (on friendship), Letter 7 (on crowds), Letter 12 (on old age), Letter 13 (on fear), Letter 16 (on philosophy), Letter 18 (on voluntary hardship), Letter 28 (on travel), Letter 33 (on thinking for yourself), Letter 40 (on speaking style), Letter 47 (on treating slaves as equals), Letter 49 (on the shortness of life), Letter 56 (on noise), Letter 70 (on dying well), Letter 77 (on taking your own exit), Letter 83 (on drunkenness), Letter 90 (on technology), Letter 104 (on running from yourself).

**4. On the Shortness of Life**
- Source: Public domain translation available via multiple sources. John W. Basore translation (Loeb Classical Library, 1932) is public domain.
- Structure: Single essay, roughly 20 sections
- Estimated cards: 40–60
- Character: Punchy, urgent, almost angry. Seneca is frustrated watching people waste their lives. This is his most quotable, most shareable work.
- Best for: The "gateway drug." Nearly every passage hits hard in isolation. Ideal for sharing.
- Key themes: what really matters, self-discipline, death & mortality, calm your mind, ambition & power

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
  "tags": ["calm-your-mind", "self-discipline", "what-really-matters"],
  "reading_time_seconds": 30
}
```

---

## Tag System

Exactly 12 tags. Plain emotional language that an 8th grader would search for. Every tag spans at least 3 of the 4 books.

| Tag Slug | Display Label |
|---|---|
| `calm-your-mind` | Calm Your Mind |
| `facing-fear` | Facing Fear |
| `dealing-with-anger` | Dealing With Anger |
| `death-and-mortality` | Death & Mortality |
| `doing-the-right-thing` | Doing The Right Thing |
| `self-discipline` | Self-Discipline |
| `ambition-and-power` | Ambition & Power |
| `leading-others` | Leading Others |
| `freedom-and-control` | Freedom & Control |
| `human-nature` | Human Nature |
| `standing-alone` | Standing Alone |
| `what-really-matters` | What Really Matters |

### Tag Coverage Across Books

| Tag | Enchiridion | Meditations | Letters | Shortness of Life |
|---|---|---|---|---|
| calm-your-mind | heavy | heavy | medium | light |
| facing-fear | heavy | medium | heavy | light |
| dealing-with-anger | medium | heavy | light | — |
| death-and-mortality | light | heavy | heavy | heavy |
| doing-the-right-thing | heavy | heavy | heavy | medium |
| self-discipline | heavy | heavy | medium | heavy |
| ambition-and-power | light | light | medium | heavy |
| leading-others | medium | heavy | medium | — |
| freedom-and-control | heavy | heavy | heavy | medium |
| human-nature | medium | medium | heavy | heavy |
| standing-alone | heavy | medium | medium | light |
| what-really-matters | heavy | heavy | heavy | heavy |

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

### Milestone Celebrations

At 25%, 50%, 75%, and 100% thresholds, show a brief interstitial message that connects to the book's content and author. Examples:

**Meditations — 50%:**
"You're halfway through Marcus Aurelius. He wrote this while leading an empire and fighting a plague — you're keeping up."

**Enchiridion — 25%:**
"A quarter of the way through Epictetus. Remember — he developed this entire philosophy while living as a slave. He'd say you're already freer than most people."

**Letters — 75%:**
"Three-quarters through Seneca's letters. He wrote these knowing he might be killed by Nero at any moment. He chose to spend that time helping a friend think more clearly."

**On the Shortness of Life — 100%:**
"You've finished Seneca's most urgent essay. He wrote it nearly 2,000 years ago, but the people he describes — busy, distracted, always planning for later — could be anyone on your commute this morning."

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
- Assign 1–3 tags per card from the fixed set of 12.
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
| Letters (selected) | 120–150 | Seneca |
| On the Shortness of Life | 40–60 | Seneca |
| **Total** | **370–490** | |

---

## Future Content Expansion

These are explicitly out of scope for launch, noted here for planning:

**Wave 2 — Deeper Stoic Canon:**
- Discourses of Epictetus (full text, 4 books — much longer and denser than the Enchiridion)
- Remaining Seneca Letters (complete the full 124)
- Seneca's On Anger, On Clemency, On the Happy Life

**Wave 3 — Stoic-Adjacent Philosophy:**
- Walden — Henry David Thoreau (bridges to Stoic themes naturally)
- The Prince — Niccolò Machiavelli (counterpoint: what happens when you reject Stoic virtue)
- On Liberty — John Stuart Mill
- Beyond Good and Evil — Friedrich Wilhelm Nietzsche

**Wave 4 — Ancient Foundations:**
- Cicero's Stoic Paradoxes
- Musonius Rufus lectures
- Hierocles fragments
