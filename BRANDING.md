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

- **Typography-first.** A high-quality serif font carries the brand. The text is the product.
- **Warm, not white.** Paper-like backgrounds. Think "well-made book" not "tech app."
- **Minimal chrome.** No logos competing with the words. No decorative UI. Every pixel serves the reading experience.
- **Three subtle accent colors.** One for each author/figure. Used sparingly on progress rings, chapter headings, and author labels. Never dominant.
- **Dark mode feels like lamplight.** Warm and restful, not a code editor.

## Motion

Plain moves like a book being read — deliberate, unhurried, never competing with the words.

### Principles

- **Purposeful only.** Every animation must answer: "does this help the reader?" If no, remove it. Motion is not decoration.
- **Slow enough to feel calm, fast enough to never wait.** Transitions should feel like turning a page, not loading a screen.
- **Exit faster than enter.** Elements arrive with gentle ease; they leave quickly and without ceremony. Attention moves forward, never lingers on what's leaving.
- **No bouncing, no springing, no overshoot.** Ease-out curves only. The Stoics would not approve of your UI doing a little dance.

### Timing

- Micro-interactions (favorite heart, tag pill tap): 150ms
- Card transitions (swipe between cards): 250ms, ease-out
- View transitions (navigating between pages): 300ms, ease-out
- Progress ring fill: 600ms, ease-in-out — the only animation that earns the right to be slow
- Milestone modal entrance: 400ms fade + gentle scale from 0.97 to 1.0
- Milestone modal exit: 200ms fade out

### Specific Interactions

- **Card swipe.** The next card slides in from the direction of travel. The departing card fades to 80% opacity as it exits. Subtle, not dramatic.
- **Favorite (heart).** A single, clean fill transition from outline to solid. No particle bursts, no confetti, no pulse. Just: empty → filled. 150ms.
- **Progress ring.** When a card is read, the ring advances by one increment. Smooth arc animation, 600ms. This is the most satisfying motion in the app — it should feel like ink filling a pen stroke.
- **Milestone modal.** Fades in gently with a barely perceptible scale. Sits still while the reader absorbs the message. Tap to dismiss fades out fast.
- **Share button.** Standard OS share sheet. No custom animation needed. The system handles it.
- **"Show original" toggle.** The original text section expands with a clean height transition, 250ms. No accordion bounce.
- **Page transitions.** Cross-fade between views at 300ms. No sliding, no zooming, no parallax. The reader should feel like they turned to a different section of the same book.

### What Never Moves

- Card text. Once rendered, the words are still. No typing effects, no word-by-word reveals, no fade-in-per-paragraph. Text appears complete and ready to read.
- Progress indicators while reading. The thin progress bar at the top of a card is static during reading. It updates only on navigation.
- Tag pills. They don't animate on load. They're part of the card, not a separate event.

## Sound

Sound in Plain is almost entirely absent. This is a reading app. Silence is the default, and it's a feature.

### Principles

- **Off by default.** Sound is opt-in via settings. The reader should never be surprised by audio.
- **Silence is the haptic.** On web, the absence of sound *is* the feedback. A smooth visual transition confirms the action happened. Don't fill the silence with audio just because you can't vibrate. When a native mobile app exists, add subtle haptic feedback (gentle tap on card advance, soft thud on milestone) — haptics are private and don't disturb the room.
- **Organic, not digital.** When sound is enabled, tones should feel physical and warm — a soft wooden knock, a muted bell, the quiet thump of a book closing. Never synthetic, never bright, never chiming.
- **One voice.** All sounds belong to the same family. Same instrument, same room, same warmth. They should feel like they come from the same quiet place.

### Sound Palette (when enabled)

- **Card advance.** A barely audible page-turn texture. Not a literal page sound effect — something more abstract. A soft breath of air. Under 0.3 seconds.
- **Favorite.** A single, warm, low-mid tone. Like a finger tapping the cover of a hardback book. Brief and satisfying.
- **Milestone reached.** A short, resonant tone — a wooden chime or a single plucked string that decays naturally over 1–2 seconds. Warm. Grounding. It should make you pause for a moment, not celebrate.
- **Book completed.** The richest sound in the app. A slow, low bell or a deep wooden resonance that lingers for 2–3 seconds. This is the only sound that earns the right to fill the room. It marks something real — you finished an entire book.
- **Everything else.** Silent. Navigation, toggling original text, opening the tag view, returning to the home page — all silent. Sound is reserved for moments of genuine progress.

### What Never Makes Sound

- Errors or validation. No error buzzes, no warning tones. Errors are handled visually and calmly.
- Sharing. The act of giving a card to someone is quiet.
- UI interactions. Buttons, toggles, menus — all silent. These are infrastructure, not events.

## Brand Rules

1. Never make the brand louder than the content.
2. Never use jargon the Stoics wouldn't recognise.
3. Never guilt, shame, or pressure the reader. No streaks. No "you missed a day."
4. Sharing is always giving — never asking the reader to promote us.
5. If Marcus Aurelius wouldn't put it in his journal, don't put it in the app.
