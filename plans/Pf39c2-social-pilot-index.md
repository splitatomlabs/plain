# Social Viability Pilot — Index

## The question
**Is social media viable at all for Plain?** Not "which format performs best" — that cannot be answered at n=1.

## Success criterion (pre-registered — do not renegotiate after posting)
A single 10x-median outlier is NOT sufficient; across ~168 posts one is expected from variance alone.

Viable requires at least one of:
- **A. Breakout with conversion** — a post clearing ~10,000 views on any platform AND converting visibly to follows.
- **B. Accumulating standing** — the account's median views trend upward from week 1 to week 4.

Either met -> social is viable; rebuild around whatever premise did it.
Neither met -> stop. An outlier with no conversion and no trend is explicitly a NO.

Track maximum AND median AND follow-conversion. The maximum alone is not the signal.

## Decisions
- **No founder face.** Revisit only if social shows traction.
- **Three recurring characters** — The Slave, The Emperor, The Senator — one fixed stylised portrait and one fixed
  voice each, generated once and reused. Stylised, so exempt from AI disclosure on both platforms.
- **Three accounts:** one TikTok, one Instagram, one YouTube. Same content cross-posted.
- **YouTube is IN** with a manual visibility flip: upload private via API, flip in Studio (~10s/video) during the
  weekly session. Submit the compliance audit in parallel. Shorts has search longevity Reels and TikTok lack.
- **TikTok posts via its native scheduler**, manually, ~20 min/week — its POSTING API is unusable here. Its read
  APIs are separate and may still automate metrics; plan 03 T13 settles that.
- **Narration and music are IN.** Silent video is a known handicap; narration gives viewers a reason to stay.
- **Gen-AI video is OUT** — that is where the cost and risk live (~$168/mo, plus face/text leakage with no
  published failure rates and a validation gate to build). Research in
  `plans/research/social-experiment-notes.md`.
- **Schedule one week at a time.** Review retention, adjust hooks and format mix, then generate the next week.
- **Line-level caption timing only.** Word-level sync is available from both TTS providers but unnecessary: The Wall
  is silent and every payoff is one still line at a time.

## THE HOUSE RULE — asymmetric motion
Motion is permitted, which makes tone the binding constraint. Bounce, overshoot and punch-ins are the native dialect
of the AI-voiced-Marcus-over-marble niche Plain must not be mistaken for.

> **The archaic side moves. The plain side does not.**
> Dense, fast, unreadable -> HARD CUT -> still, quiet, one sentence on warm paper, zero motion, a beat of silence.

Three checkable rules:
1. No easing with overshoot, anywhere.
2. The payoff frame has ZERO motion for >= 2.5s.
3. TTS pitch and rate never below default — no "wise deep voice".

**Corollary:** with motion everywhere, a still 1080x1350 image is the pattern interrupt. Keep one running deliberately.

## The formats

| # | Format | Cadence | Mechanic | Supply |
|---|---|---|---|---|
| 1 | **The Wall** | daily, video | induced incomprehension, then relief — a wall of archaic text that outruns you, then one still plain sentence in silence | 1,326 raw / **~600 strong**; 3 sub-types (the opening rotation was retired outright — T17) |
| 2 | **The Question** | daily, video | forced self-prediction — a second-person question compels an answer, then you check yours against his | **~120-130 validated** (292 gated x 42-44% measured survival) |
| 3 | **The Objection** | weekly, video | the claim you want to argue with, pre-loaded | **15-25** |

Each depends on Plain's faithful plain rewrite: a quote account has no wall to escape from, and in the original the
question is buried mid-clause and the objection structure is invisible.

**The read-through counter is not a format** — it is a "Card 1 of 72" label rendered onto posts of the formats
above, running one book sequentially from the start. Mechanic: open loop plus completionism, and the only thing in
the pilot that converts reach into retention. It is a genuine commitment — abandoning the public read-through at day
40 is worse than never starting — so run it on a book that finishes (Enchiridion, 72 cards) before attempting
Meditations. Constrains the scheduler (plan 01) and the renderer (plan 02); it never occupies a slot of its own.

**The Wall's wall phase is 2-3 seconds, not 6.** Scroll decisions happen in 1-2s. The hard cut IS the payoff.

**The Objection: lead with On Anger** (15 cards) — objections about the reader's own life. Do NOT lead with On the
Happy Life, whose objections are Epicurean doctrinal disputes. Do NOT widen into the 67-card dialogue class: those
are lines spoken by characters in a scene, not positions a viewer holds. That distinction needs an LLM judgement at
generation time; no regex catches it. Author spread of the raw 50: Epictetus 24, Seneca 24, Marcus 2.

**The opening rotation for The Wall was RETIRED (social pilot 02a T17), not replaced.** It originally answered a
real pressure — "a daily format with an identical frame 0.0 gets filtered by the feed" — with a three-way rotation
across the same pool: standard, plus two numeric openings (**190 -> 97**, the original's word count counting down
to the plain version's; **Grade 14**, the original's reading grade as a bare measurement). Both numerals were cut
outright, and no third numeral replaces them. `grade` first: a reading-grade number is not compelling to a
consumer, and it was broken twice over — "Grade" rendered unreadably over the archaic text, and the numeral itself
was unrepresentative (191 of 896 pool cards clear grade 20, max 65.7 — Flesch-Kincaid explodes on run-on sentences).
Then `countdown`, for a worse reason than its looks: **"190 -> 97" sells compression, and Plain does not sell
compression** — rule 4 below, never contradict the product. It is also unrepresentative of the corpus: the plain
version is a median 0.86 of the original (a 14% trim) and 44 cards get LONGER in plain English; the >=30-word gate
that fed `countdown` cherry-picks the 212 cards where compression happens to be dramatic (median 0.73), so each
numeral was true of its own card while the aggregate impression was a claim the corpus does not support. Both were
also the same 320px accent numeral pinned over the text with no backing plate — furniture, which is what the
saturated niche looks like. Three textual axes replace the pressure the rotation existed to answer, without an
overlay: (1) mid-chapter entry (T18) — the wall's own scroll starts mid-passage, not always frame 0.0 of the same
card; (2) the running head (T11/T12, already landed) — a small, fixed, factual "Author · Book" label, occupying the
exact region the old opening badge used to claim; (3) sub-type spacing (T19) in the scheduler.

**Lower priority:** Search Answer (discovery-optimised, weak stopper, best on Shorts) · Uncomfortable Diagnosis
(down-ranked; motion pushes it toward the "ancient philosopher predicted your phone" genre) · The Filter
(trailer/pinned post) · Three Voices (15-37 usable triads) · Debts and Lessons (30 cards, finite series).

## The Wall — sub-types
Length is a dead end as a variation axis: the longest original is **201 words** and there is no long tail. What
varies is TEXTURE, and half the pool is weaker than the raw 1,326 suggests.

| sub-type | n | what makes it impenetrable |
|---|---|---|
| **The Thou Wall** | 222 | >=3 archaic markers. Visually foreign before a word is read. **Lead with these.** |
| **The Cascade** | 204 | >=3 semicolons. One sentence that will not end — impenetrable through structure. |
| **The Scene** | 176 | >=2 quotation marks. An argument walked in on halfway. |
| plain-looking | ~670 | No strong markers. **Reserve** — if the wall reads as ordinary prose the viewer just does not bother. |

Variation comes from the sub-type (3), the mid-chapter entry point (T18) and the payoff length — **not** from
varying the visual grammar, and not from an opening rotation (retired outright — T17). The chaos-to-calm asymmetry
is the signature and the one thing no scraper account can copy.

## The supply inversion
For the archaic half, comprehension was never the goal — **incomprehension is**. That reverses the old 12-word
frame-zero rule: long passages go from liability to preferred material (1,326 cards at >=80 words, 816 at >=120,
396 at >=150), and The Wall consumes the corpus's long tail instead of competing for short punchy cards. The 12-word
rule still applies to STILL formats (674 cards qualify).

## The Question — validated 2026-08-24
50-card hand-judged sample: **42-44% survive** (question-side 58%, answer-side 68%). Against a 292-card gated pool
that is ~120-130 usable — the only supply figure in this exercise that did not shrink on contact with the text.

Failure taxonomy and the resulting gate spec live in plan 01, T04. Two deterministic gates (pronoun with no
antecedent inside the question; candidate answer itself ending in "?") remove 20 of 35 observed failures at zero
API cost; only topic drift needs an LLM.

**Author skew:** Epictetus 56% survival / 143 pool / ~80 usable; Marcus 31% / 77 / ~24; Seneca 25% / 72 / ~18.
Structural — *Discourses* is a diatribe transcript that natively matches the format. ~65% of the usable pool is
Epictetus, balanced by The Wall, whose best material favours Meditations and the Seneca essays.

Strongest examples: *"What is a master anyway?"* -> *"One person can't really master another. But death can master
you."* · *"What weighs us down and disturbs us?"* -> *"Nothing but our opinions."*

**Payoff variety confirmed:** 450 distinct answer clusters, 87% singletons; 161 of 226 match none of the six
canonical Stoic moves. The corpus answers with particulars, not doctrine.

## THE REPETITION TEST (apply to every candidate)
Supply counts INPUTS, not how many times a viewer can be surprised. **Ask: how many distinct PAYOFFS does this
format have?** It is what cut He Didn't Know Yet. The Wall, The Question and The Objection pass:
their payoff is drawn fresh from the corpus each time.

## CONSTRAINT 6 RULING
**Any text presented as the author's words must be VERBATIM from the card. Framing text is permitted if it is
(a) visually distinct from quoted content, (b) factually true, and (c) not attributed to the author.**

"190 words" — framing, true, unattributed: permitted. "Written 2,000 years ago, and it's about your phone" — asserts
something false about the passage: not permitted.

## Saturation warnings
- The saturated niche is specifically AI-voiced Stoicism with kinetic captions and punch-ins. The house rule is the
  mitigation, and the risk went UP with motion, not down.
- Warm paper #FAF7F2 is an asset precisely because the niche is black-and-orange.
- **Do not narrate The Wall in v1** — fast TTS mangles archaic spellings and proper nouns. Voice on the payoff only.
- Karaoke caption sync is table stakes, not an edge; it becomes an asset only when deliberately too fast to follow.

## Rules that killed formats (the list of names is in `plans/research/format-analysis.md`)
Four principles, each derived from several rejected candidates. Test new ideas against these before researching them.

1. **Nothing fabricated, ever** — if the format needs a line, a date or a tension that is not in the card, it is
   dead. (Killed Guess the Century, Two Authors Disagree.)
2. **The pipeline rewrites, it does not substitute.** Any format needing word-for-word correspondence or a
   recognisable per-author voice at sentence level has no data behind it. (Killed The Morph, Slave/Emperor/Senator.)
   Revisit only if the pipeline ever emits `word_alignment` or a validated `pull_quote`.
3. **Count payoffs, not inputs** — the repetition test above. (Killed He Didn't Know Yet.)
4. **Never contradict the product.** Plain's thesis is that these books are worth reading properly. A format saying
   they are skimmable cannot be run by this account whatever it scores. (Killed The Speedrun.)

Two standing hazards, not format rules: **untrusted input** — anything ingesting comments points a prompt-injection
surface at a public account, viable only behind a human gate (killed Reply to the Comments); and **the slop
boundary** — with motion, short single-line Meditations quotes are frame-for-frame indistinguishable from the
saturated niche (killed One-Line Gut Punch).

## NEGATIVE RESULT — the contrast vein is exhausted
**The (original, plain) pair encodes exactly one fact: what the passage means.** Every format whose payload is that
contrast therefore has the same reveal object and the same shape — they are DOORS, not rooms. Six candidates were
measured and rejected; do not re-mine this vein. **The Objection survived precisely because it does NOT run on the
contrast** — it runs on a second structure inside the card. The contrast is the medium; the payload must come from
somewhere else. Detail in `plans/research/format-analysis.md`.

**Apply a standalone test to every supply figure before believing it.** Syntactic counts read as supply until you
test whether the text stands alone, then collapse ~90% — that pattern held for four of the five formats measured.

## Recommended follow-on (not in the pilot)
A validated `pull_quote` field in the content pipeline — a verbatim, self-contained sentence chosen once with the
full passage in context. One-time cost; revives Three Voices and lifts One-Line Gut Punch.

## Plans
1. `plans/Pf39c2-social-pilot-01.md` — Content premises: gate and score the corpus into pools, generate a weekly schedule
   - Status: [x]
2. `plans/Pf39c2-social-pilot-02.md` — Character system and rendering: three characters, per-format templates, encode
   - Status: [ ]
   - Depends on: 01
2a. `plans/Pf39c2-social-pilot-02a.md` — The Wall refined: legible payoff, chapter-sourced scroll, framing layer
   - Status: [ ]
   - Depends on: 02
3. `plans/Pf39c2-social-pilot-03.md` — Publish and measure: R2, Instagram + YouTube adapters, TikTok staging, readout
   - Status: [ ]
   - Depends on: 02a

## Cross-cutting constraints
- **No logo, URL or watermark inside any video frame** — TikTok's watermark rule warns this "may also lead to
  deleted content or disabled accounts". Branding is caption-and-bio only.
- **`docs/BRANDING.md` motion rules do NOT apply to social** (confirmed 2026-08-23): "text never moves",
  ease-out-only and no-bounce govern the app. Kinetic typography, word-by-word reveals, punch-ins and cuts are
  available. What still holds is tonal: calm, direct, warm-not-soft, second person, never clickbait.
- **One MP4 profile:** H.264 High L4.0, yuv420p, 1080x1920, 30fps, AAC-LC 48kHz, `+faststart`, 15-59s. Never 60fps
  at L4.0 — 1080x1920@30 already uses 8,160 of 8,192 max macroblocks.
- **Always include an audio track**, even on stills.
- Instagram: JPEG only for feed, <=8MB; media must be at a public HTTPS URL. Tokens expire in 60 days and must be
  refreshed — the most likely silent failure.
- Full research and citations: `plans/research/social-experiment-notes.md` (platforms, APIs, infrastructure) and
  `plans/research/format-analysis.md` (rejected formats, corpus measurements, negative results).

## Out of scope
No crossover design, no format comparison, no per-account rotation offsets, no gen-AI video, no word-level caption
sync, no 90-day commitment. Each is a deliberate omission, not an oversight — plan any of them fresh if and only
if the pilot finds signal.
