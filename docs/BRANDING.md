# Plain — Brand Guide

## Name

**Plain**

## Tagline

Ancient philosophy, stripped to its core, in words anyone can understand.

## One-liner

Plain turns classic Stoic philosophy books into bite-sized cards written in plain English — so you can actually read them and finish them.

## Why "Plain"

The name is the mission. Every design decision, every word choice, every feature exists to make philosophy plainer — clearer, more direct, more accessible. In a space full of apps trying to sound profound, calling yourself Plain is a quiet act of rebellion. The content speaks for itself.

"Plain" also works as a product language. The cards are "plain translations." The reading experience is "plain English." The design is plain by intention, not by neglect.

## Narrative Hook

**Three men. Three completely different lives. The same philosophy.**

- **The Slave** — Epictetus. Born into slavery. Found freedom in his own mind.
- **The Emperor** — Marcus Aurelius. Ruled Rome. Wrote a private journal to keep himself sane.
- **The Senator** — Seneca. One of the richest men alive. Forced to kill himself by the emperor he served.

They all arrived at the same answers. Plain lets you read those answers in words that don't require a philosophy degree.

## Voice

- **Direct.** Short sentences. No hedging. Say what the card means.
- **Warm, not soft.** Friendly but not fluffy. These texts deal with death, anger, fear, and power. Respect that.
- **Confident without being clever.** Never perform intelligence. Never dumb down. Just be clear.
- **Second person.** "You" not "one." The reader is being spoken to, not lectured at.

## Visual Identity

### Principles

- **Typography-first.** The text is the product. Every visual decision serves readability.
- **Warm, not white.** Paper-like backgrounds. Think "well-made book" not "tech app."
- **Minimal chrome.** No logos competing with the words. No decorative UI. Every pixel serves the reading experience.
- **Dark mode feels like lamplight.** Warm and restful, not a code editor.

### Typography

**Body / Card Text — Literata**
- Source: Google Fonts (self-host via `@fontsource/literata`)
- Designed specifically for long-form book reading on screens. Warm, humanist quality with excellent readability at body sizes. Variable font support keeps file size small.
- Card text: 18–20px on mobile, font-weight 400
- Line height: ~1.6
- Max line width: ~65 characters
- Original text excerpts: 14px, italic, muted color

**UI / Navigation — DM Sans**
- Source: Google Fonts (self-host via `@fontsource/dm-sans`)
- Geometric and clean but slightly warm. Pairs with Literata without jarring contrast. Stays invisible — the reader never notices it.
- UI elements, tag pills, progress indicators, buttons, navigation: 13–14px, font-weight 400/500

### Color Palette — Light Mode

| Role | Hex | Usage |
|---|---|---|
| Background | `#FAF7F2` | Page background, reading surface |
| Surface | `#FFFFFF` | Card backgrounds, elevated elements |
| Primary text | `#2C2520` | Card body text, headings |
| Secondary text | `#736B62` | Source references, meta info, timestamps |
| Tertiary text | `#655F5A` | Tag pill text, subtle labels |
| Border | `#E8E2D9` | Card borders, dividers, separators |
| Tag background | `#F0EDE8` | Tag pill fills, subtle backgrounds |

### Color Palette — Dark Mode

| Role | Hex | Usage |
|---|---|---|
| Background | `#1A1816` | Page background |
| Surface | `#252220` | Card backgrounds, elevated elements |
| Primary text | `#E8E2D9` | Card body text, headings |
| Secondary text | `#9E958C` | Source references, meta info |
| Tertiary text | `#A89E94` | Tag pill text, subtle labels |
| Border | `#33302B` | Card borders, dividers, separators |
| Tag background | `#33302B` | Tag pill fills, subtle backgrounds |

### Author Accent Colors

Each of the three Stoic figures gets a subtle accent color, drawn from the ancient world. Used sparingly on progress rings, chapter headings, and author labels. Never dominant — the text is always the focus.

**Accessibility note:** In light mode, accent colors pass WCAG AA for large text and UI components (3:1) but not for normal body text (4.5:1). Only use accents at ≥18px or ≥14px bold. Never use them for body text, source references, or any text at small sizes. In dark mode, all accents pass both thresholds.

| Author | Light Mode | Dark Mode | Inspiration |
|---|---|---|---|
| The Slave (Epictetus) | `#B5704F` | `#C9886A` | Terracotta clay — earth, simplicity, the ground beneath a slave's feet |
| The Emperor (Marcus Aurelius) | `#5B6E8A` | `#7BA3CC` | Muted indigo — imperial but restrained, the colour of Roman twilight |
| The Senator (Seneca) | `#6B7F5E` | `#8FA67E` | Olive sage — Roman gardens, wealth held lightly, the natural world |

### Accessibility

All text/background pairings meet WCAG AA (4.5:1 for normal text, 3:1 for large text and UI components). Verified minimum contrast ratios:

| Pairing | Light Mode | Dark Mode |
|---|---|---|
| Primary text on background | 14.1:1 | 13.8:1 |
| Primary text on surface | — | 12.3:1 |
| Secondary text on background | 4.9:1 | 6.0:1 |
| Secondary text on surface | 5.2:1 | 5.4:1 |
| Tertiary text on tag background | 5.4:1 | 5.0:1 |
| Author accents on background | 3.6–4.9:1 (large text only) | 5.1–5.9:1 |

## Motion

Plain moves like a book being read — deliberate, unhurried, never competing with the words.

- **Purposeful only.** Every animation must answer: "does this help the reader?" If no, remove it. Motion is not decoration.
- **Slow enough to feel calm, fast enough to never wait.** Transitions should feel like turning a page, not loading a screen.
- **Exit faster than enter.** Elements arrive with gentle ease; they leave quickly and without ceremony. Attention moves forward, never lingers on what's leaving.
- **No bouncing, no springing, no overshoot.** Ease-out curves only. The Stoics would not approve of your UI doing a little dance.
- **Text never moves.** Once rendered, the words are still. No typing effects, no word-by-word reveals. Text appears complete and ready to read.

## Sound

Sound in Plain is almost entirely absent. This is a reading app. Silence is the default, and it's a feature.

- **Off by default.** Sound is opt-in via settings. The reader should never be surprised by audio.
- **Silence is the haptic.** On web, the absence of sound *is* the feedback. A smooth visual transition confirms the action happened. When a native mobile app exists, add subtle haptic feedback — haptics are private and don't disturb the room.
- **Organic, not digital.** When sound is enabled, tones should feel physical and warm — a soft wooden knock, a muted bell, the quiet thump of a book closing. Never synthetic, never bright, never chiming.
- **One voice.** All sounds belong to the same family. Same instrument, same room, same warmth. They should feel like they come from the same quiet place.
- **Reserved for progress.** Sound only marks moments of genuine reading progress — advancing a card, reaching a milestone, completing a book. Everything else is silent.

## Brand Rules

1. Never make the brand louder than the content.
2. Never use jargon the Stoics wouldn't recognise.
3. Never guilt, shame, or pressure the reader. No streaks. No "you missed a day."
4. Sharing is always giving — never asking the reader to promote us.
5. If Marcus Aurelius wouldn't put it in his journal, don't put it in the app.
