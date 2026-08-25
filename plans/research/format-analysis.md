# Format analysis — rejected candidates and negative results (2026-08-23 to 2026-08-25)

Archaeology for `plans/Pf39c2-social-pilot-index.md`. The index carries only the durable RULES these produced;
this file keeps the measurements and the case-by-case reasoning, so a rejection can be re-checked rather than
re-derived. Platform and infrastructure research is in `social-experiment-notes.md`.

## Rejected formats

**Guess the Century** — the modern line must be fabricated. No version survives.

**Two Authors Disagree** — fabrication by framing; an LLM will confidently invent tension that is not in the text.

**Reply to the Comments** — comment text is untrusted input. An unattended pipeline ingesting it and generating a
video is a prompt-injection surface pointed at a public account. Only viable behind a human approval gate.

**The Speedrun / Book in 60 Seconds** — an entire book, first line of every section, under a minute. Cut on three
independent grounds: (1) the claim is false — 51 opening lines of the Enchiridion is a table of contents, not a
book, and a viewer who works that out feels cheated; (2) 1.1s per sentence is below retention threshold, so it is
wallpaper; (3) it contradicts the product's thesis that these books are worth reading properly, card by card. Even
the shortest book (Shortness of Life, 69 cards) cannot be honestly delivered in 60 seconds, so no salvageable
version exists.

**The Morph / Word Swap** — archaic words transforming in place into their plain counterparts. The most exciting
motion-native idea generated and uniquely Plain, but measured and killed: **only 9 honest pairs at <=80 words, 23 at
any length.** The pipeline rewrites rather than substitutes. Revisit only if it ever emits a `word_alignment` field.

**Slave, Emperor, or Senator?** — guess the author from a line. Cut on the user's knowledge of the corpus: the
plain-English translation homogenises the three voices at sentence level. The pipeline does encode distinct voices
(Epictetus blunt and second-person, Marcus weary and inward, Seneca warm and wry), but not survivably within
12 words.

**He Didn't Know Yet** — scored 250-350 by counting eligible cards, but the payoff space is exactly three
biographies. By the fourth showing the twist is spent; by the tenth it is a tic. Held briefly as a three-post launch
beat, then cut entirely 2026-08-25.

**Not Written For You** — condescending in tone ("this was never meant to be read" tells viewers something they are
assumed not to know), heavily duplicative of existing Meditations content, and the claim is FALSE for Seneca, whose
essays and letters were written for publication. True only for Meditations.

**One-Line Gut Punch** — 88 of 103 sub-40-word cards are Meditations. With motion it becomes literally
indistinguishable, frame for frame, from the saturated AI-Stoicism slop format. Motion actively hurts it.

**Posed-to-reader questions** — the ~44 estimate counted SYNTACTIC questions. Measured: 190 cards end on a question,
95 have a short unquoted closing question, but only ~25 survive a standalone test, and reading those 25, most are
the tail of an argument rather than a question posed to a reader (*"While everyone else sleeps peacefully, what is
Agamemnon doing?"*, *"I was elected to the college, but why only one?"*). Genuinely standalone: **~8-12.** A
miniseries at best.

**The Blank** · **What He Wrote Next** · **Which One Are You** · **The Rest of the Quote** · **The Untranslatable
Word** · **Who Was This Person** · **The Mortality Counter** — rejected on fabrication, supply, tone or
automatability. None were motion-dependent; all re-checked after motion was permitted.

## NEGATIVE RESULT — the contrast vein is exhausted
A focused search for more formats built on the original/plain contrast returned nothing clearing The Wall's bar.
The structural reason: **the (original, plain) pair encodes exactly one fact — what the passage means.** Every
format whose payload is that contrast has the same reveal object, the same payoff and the same shape. They are
DOORS, not rooms.

The Objection survived precisely because it does NOT run on the contrast — it runs on a second structure inside the
card, a quoted objection and its answer. The contrast is the medium; the objection is the payload.

Measured and rejected:
- **Readability delta.** FKGL across all 1,615 pairs: original mean 14.5 / median 12.6; plain mean 5.7 / median 5.6.
  515 cards drop >=10 grades. But the plain number is 4, 5 or 6 EVERY time — the reveal has one value. Also a
  hollow-claim risk: a computed grade is an artifact of an implementation, and 26 cards score WORSE in plain.
  Usable only as a bare first-frame number.
- **Vocabulary / obsolete words.** 1,686 candidates across 1,556 cards, but the list is dominated by words the
  rewrite merely did not reuse (`whatsoever, manner, towards, persons, honour`); genuinely obsolete ones are ~8 of
  the top 45. Inferring word correspondence from a rewritten sentence needs alignment the pipeline does not produce.
- **Length / time-to-read.** One payoff ("it got shorter"), 1,615 times. An opening variant, not a format.
- **The Second Read** (plain first, then the archaic wall you just decoded) — passes the repetition test but ENDS ON
  NOISE, inverting the house rule. Reordering it to resolve on calm turns it back into The Wall.
- **The Deflation** (grand original, mundane plain) — same first frame plus same reveal type equals same format.
  A corpus filter, not a format.

## Supply figures that collapsed on contact
Recorded because the pattern repeated: a syntactic or mechanical count reads as supply until the text is tested
standalone, then drops ~90%.

| candidate | estimated | measured | why |
|---|---|---|---|
| The Objection | ~150 | **15-25** | estimated off the 308 quoted-speech pool; the tight pattern matches ~50, and hand-reading those 50 leaves 15-25 |
| Posed-to-reader | ~44 | **~8-12** | counted syntactic questions, not standalone ones |
| He Didn't Know Yet | 250-350 | **3** | counted inputs, not payoffs |
| The Morph | "uniquely Plain" | **9** | assumed substitution; the pipeline rewrites |
| **The Question** | 90-130 | **~120-130** | the ONLY figure that held — because its gate already required a self-contained question |

## The 67-card dialogue class — do not fold into The Objection
Verified by reading the cards: the dialogue matches are lines spoken by characters in a SCENE, not objections a
viewer would raise — *"But I'll chain you up."*, *"What about my property?"*, *"Don't call me as a witness."*,
*"Don't lie after I'm dead and claim you were winning."* The distinction a mechanical gate misses is whether the
quoted line is a position the VIEWER might hold or a line from a dramatised dialogue. Only the first is the format.

## On the Happy Life — why The Objection does not lead with it
Its objections are in-house philosophy — *"But if moderation reduces pleasure, doesn't it damage the highest
good?"*, *"But pleasure combined with virtue can't give bad advice"* — a doctrinal dispute with Epicureans. On Anger
(15 cards) is the strongest vein: objections about the reader's own life on a universally lived subject.
Raw-50 book spread: Discourses 21, On Anger 15, Happy Life 6.
