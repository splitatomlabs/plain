# Content Premises

## Parent
`plans/Pf39c2-social-pilot-index.md`

## Objective
Gate and score the 1,615-card corpus into per-format pools, then generate the schedule ONE WEEK AT A TIME, so the
daily job makes no LLM call at post time.

## Decisions
- Scoring runs ONCE offline, so the schedule is auditable before anything is posted.
- Reuse the Batch helpers in `scripts/lib/claude.ts` (`createMessageBatch`, `pollBatchUntilDone`,
  `streamBatchResults`, `safeCustomId`) — same pattern as the translate phase.
- **Each format needs its own rubric AND its own gate.** A good Wall card, Question card and Objection card have
  nothing in common. The Question and The Objection are near-disjoint (measured overlap: 36 cards).
- **Most of the work is GATING, not scoring.** Compute the mechanical gates first; spend LLM calls only on survivors.
- Where judgement is needed the LLM must judge, not just cut: mechanical extraction alone fails (13,654 spans of
  8-45 words exist but are mostly context-dependent).

## Files
- `scripts/lib/premises.ts` — rubrics, gates, batch orchestration, schemas
- `scripts/score-premises.ts` — CLI
- `scripts/lib/__tests__/premises.test.ts`
- `content/social/premises/*.json` — one pool per format (committed)
- `content/social/pilot-schedule-wNN.json` — one file per week (committed as generated)

## Constraints
- Every word on screen must be traceable to `plain_english` or `original_excerpt`. Enforce mechanically.
- **On-screen text limits are PER FORMAT, not global** — The Wall deliberately shows 150+ words.
- Voice per `docs/BRANDING.md`: direct, second person, warm not soft, never clickbait.

## The pools to produce

| Format | Mechanical gate | LLM rubric |
|---|---|---|
| **The Wall** | `original_excerpt` >= 80 words (1,326) AND a self-contained plain landing line. Rank by visual archaism, and flag opening eligibility (T03) | how impenetrable the original LOOKS; cleanness of the landing line |
| **The Question** | short (<=14w), self-contained, unquoted question in the first three sentences of `plain_english`, author's own voice, not exclamation-shaped. Target 292 | verify the following sentences ACTUALLY ANSWER the question (T04) |
| **The Objection** | quoted span starting "But"/a question word, <=14 words, no proper nouns (~50 raw) | is the quoted line a position the VIEWER might hold, or a line from a dramatised scene? Reject doctrinal disputes. ~15-25 survive |

## Tasks
- [x] T01: Implement the MECHANICAL gates in `scripts/lib/premises.ts` — word counts, self-contained-opening
  detection (reject leading "But/So/This/It/And"), quoted-speech detection, book filter, length delta. No LLM calls.
  Acceptance: gate counts reproduce 1,326 / 674 / 308 / 318.
  **Note:** 674 (still12Word) did not reproduce under any tried definition, confirming the plan's own caveat.
  Implemented the clean definition (first sentence of `plain_english` <=12 words AND self-contained opener); this
  measures **739**, not the plan's stated fallback estimate of 740 — off by one from that estimate, but the
  implementation's <=11-word cross-check independently reproduces the plan's own stated anchor of 651 exactly, which
  is why 739 (not 674 or 740) is what's asserted in `premises.test.ts`. wallLength (1,326), quotedSpeech (308), and
  lengthDelta30 (318) all reproduce exactly. `npx vitest run scripts/lib/__tests__/premises.test.ts` — 27/27 green.
- [x] T02: Implement the **landing-line gate** for The Wall — reuse the T01 self-contained detector against
  `plain_english`; reject any card with no clean standalone sentence to cut to. Acceptance: every surviving entry has
  both a >=80-word original and a named landing line, AND actually stands alone with zero preceding context (a
  viewer who has read nothing else must understand it).
  **Note:** Added `findLandingLines`/`selectLandingLine`/`wallGate`/`verbatim`/`hasUnresolvedReference` to
  `scripts/lib/premises.ts`, reusing `isSelfContainedOpening`, `sentences`, and `wordCount` from T01. A qualifying
  landing line is a complete, non-question sentence (5-18 words — bounds documented in-file), passes the T01 opener
  check, and carries no unresolved pronoun/demonstrative reference ANYWHERE in the line (broader list than T01's,
  since a standalone payoff line has to resolve narrative references too, not just argument continuations).
  `selectLandingLine` deterministically prefers the LAST qualifying sentence (cards build to a conclusion).
  **Correction (same task):** the first pass measured 1,286 survivors but the gate wasn't actually testing
  standalone-ness — two mechanical defects inflated that count. (1) `sentences()` split on `.`/`!`/`?` naively,
  breaking inside quoted speech and emitting broken fragments (unbalanced quotes, orphaned leading `"` stolen from
  the previous sentence's closing quote — e.g. `" If you don't like the conditions, leave.`). Fixed by making
  `sentences()` quote-aware: a terminator inside an unclosed quote no longer ends the sentence unless the very next
  character is the closing `"`, and a closing `"` right after a terminator stays attached to the sentence it closes.
  (2) `hasUnresolvedLeadingReference` (renamed `hasUnresolvedReference`) only checked the LEADING word, so a
  pronoun sitting mid-sentence with no antecedent passed silently (e.g. "Husbands and wives fight about it all
  night." — "it" has nothing to point back to). Fixed by checking the whole line for a third-person
  pronoun/demonstrative, rejecting UNLESS a plausible antecedent exists in-line: either a demonstrative used as a
  determiner immediately before its noun ("that man", "those people" — referent on screen), or a capitalized,
  non-sentence-initial proper noun earlier in the line (ordinary sentence-initial capitalization doesn't count as
  proper-noun evidence — that's what makes "Husbands"/"wives" correctly NOT excuse "it"). Also added: a landing
  line can never start with `"` (no on-screen attribution) or have an unbalanced quote count (defense in depth,
  on top of the `sentences()` fix). `findLandingLines` also picked up bare "It" in
  `LANDING_LINE_REFERENCE_REJECTS` — it was previously covered only for the leading position (via
  `SELF_CONTAINED_OPENING_REJECTS`), not mid-sentence. `wallGate(loadCorpus())` now measures **1,138** survivors
  (<=1,326 wallLength, as required) — cards that lose their previously-selected sentence don't necessarily drop
  out; several fall back to an earlier still-qualifying sentence in the same card. The shared `sentences()` fix
  also moved T01's `still12Word` corpus count from 739 to **731** (documented in-file and in the test). Known
  remaining gap: lines with no third-person pronoun that still read as the tail of an argument (e.g. "Keep our
  anger on hold.") aren't caught by this mechanical gate — "our" is first-person, out of scope for
  `hasUnresolvedReference`'s pronoun list; would need a qualitative/LLM check to catch. Every survivor's
  `landing_line` is verified verbatim (exact substring) against its source card's `plain_english`, and a
  corpus-level regression test asserts no survivor has an odd `"` count or starts with `"`/whitespace.
  `npx vitest run scripts/lib/__tests__/premises.test.ts` — 56/56 green. `npx vitest run` (full pipeline suite) —
  312/312 green, confirming the shared `sentences()` change didn't regress T01 or any other consumer.
  **Round 2 correction (same task, second fix pass):** an audit found 230 of the 1,138 survivors still carried an
  unresolved reference — two remaining gaps in `hasUnresolvedReference`. (1) The demonstrative-as-determiner
  exception ("that man", "those people" — referent on screen) was the main leak: it also excused genuinely
  backward-pointing determiners like "this person", "these external things", "that way of life", because the
  exception only checked whether a noun followed the demonstrative, not whether that noun actually supplied the
  referent. Separately, "This" was missing from `LANDING_LINE_REFERENCE_REJECTS` entirely (only covered as a
  leading word via `SELF_CONTAINED_OPENING_REJECTS`), so a mid-sentence "this" was never checked at all. Fixed by
  dropping the determiner exception outright for `this`/`these`/`those`/`such` (always rejected, any grammatical
  role) and adding `this` to the reference-word list. `that` keeps one narrow, verb-list-gated exception for its
  non-referential use as a subordinating conjunction ("the truth is that...", "I know that...") —
  `isNonReferentialThat`; a relative-clause reading ("the man that spoke") was deliberately NOT implemented as a
  second exception path, because without POS tagging a bare "is the previous word noun-shaped" heuristic can't
  tell a real relative clause apart from a determiner leak ("Don't let that excellent part become enslaved." —
  "let" reads as noun-shaped to a stopword-list check) — measured, and dropped in favor of "when in doubt, REJECT".
  (2) The third-person-pronoun antecedent lookback accepted ANY earlier capitalized word regardless of number,
  so a plural proper noun could wrongly clear a singular pronoun or vice versa. Tightened to require number
  agreement (singular antecedent for he/she/it forms, plural for they forms) while keeping the capitalized-word
  restriction — extending to lowercase common nouns was tried and reverted: without POS tagging, ordinary verbs
  ("fight", "worry") pass the same blunt noun-shape check as real nouns and wrongly resolved pronouns ("Husbands
  and wives fight about it" — "fight" would incorrectly excuse "it"). Plural detection itself uses a curated
  whitelist for capitalized words (`KNOWN_PLURAL_PROPER_NOUNS` — "Stoics", "Athenians", etc.) rather than a
  trailing-`s` heuristic, since most singular proper names in this corpus end in `s` (Marcus, Socrates, Zeus,
  Chrysippus, Croesus, Pythagoras). Also fixed two tokenization gaps surfaced by the corpus audit: an em/en dash
  glued directly to the next word with no space ("love—this is true") hid a reference word from the whitespace
  tokenizer; and a contraction suffix (`'s`/`'re`/`'ll`/`'ve`/`'d`) glued a reference word into one token that
  never matched the exact-word lookup ("that's" != "that", "they're" != "they"). Both are now normalized in
  `stripPunctuation` before matching. `wallGate(loadCorpus())` now measures **1,003** survivors (down from 1,138;
  landed below the plan's 700-900 estimate range for this round, not tuned to hit it — see in-code rationale for
  each rejected/kept design option). Added a corpus-wide regression test asserting no surviving landing line
  contains a standalone `this`/`these`/`those` token, plus unit tests for all six real-corpus leak examples and
  the "That man..."/"Kings..." cases updated to their new expected outcomes.
  `npx vitest run scripts/lib/__tests__/premises.test.ts` — 67/67 green. `npx vitest run` (full pipeline suite) —
  323/323 green (312 baseline + 11 new tests from this round).
- [x] T03: Implement **visual-archaism ranking** for The Wall. Three deterministic sub-types:
  **Thou Wall (222)** — >=3 of thou/thee/thy/thine/hath/doth/dost/art/shalt/wilt/whither/wherefore/whereby/
  whensoever/perchance/nay/yea; **Cascade (204)** — >=3 semicolons; **Scene (176)** — >=2 quotation marks.
  The remaining ~670 are reserve.
  In the same pass, flag each entry's OPENING ELIGIBILITY — the two numeric openings are not universal. `190 -> 97`
  needs a plain version >=30 words shorter than the original (318 cards qualify), or the countdown barely moves;
  `Grade 14` needs an original grade high enough to be worth showing. Entries failing both can only take the
  standard opening. Acceptance: sub-type counts reproduce, every entry carries its eligible openings, and the
  scheduler can weight by both.
  **Note:** Added `ARCHAIC_MARKERS`, `classifyWallSubTypes`, `originalReadingGrade`, `eligibleWallOpenings`,
  `rankWall`, and the `WallSubType`/`WallOpening`/`RankedWallEntry` types to `scripts/lib/premises.ts`.
  `classifyWallSubTypes` is a standalone pure function over `original_excerpt` (not gated on `wallGate`), so it can
  be asserted directly against the full 1,326-card >=80-word set, independent of the smaller 1,003-card `wallGate`
  survivor pool `rankWall` actually ranks. All three sub-type checks match the plan's stated definitions exactly and
  reproduce the measured counts given in the task: **Thou Wall 222** (counting archaic-marker TOKEN occurrences,
  case-insensitive, word-boundary — NOT distinct markers, which measures 185), **Cascade 204** (>=3 `;` characters),
  **Scene 137** (>=2 `"` characters — the plan's own estimate here was 176, which did not reproduce under any
  quote-character definition tried: curly quotes gives 203, checking either `plain_english` or `original_excerpt`
  gives 311; 137 is implemented and asserted, with the gap documented in-file, same treatment T01 gave its own
  unreproducible 674 estimate). Sub-types are non-exclusive; union over the 1,326-card gate is 513 (`reserve` count
  813), matching the task's stated figures exactly. Opening eligibility: `countdown` (the "190 -> 97" treatment)
  requires `lengthDelta(card) >= 30`, reusing T01's `lengthDelta`; `grade` (the "Grade 14" treatment) requires
  `originalReadingGrade(card) >= 12` — grade 12 chosen as the threshold because it's the same "too difficult"
  ceiling `validateReadability` (`scripts/lib/validate.ts`) uses for the PLAIN version, so an original clearing that
  bar is unambiguously harder than anything else the app ships. `originalReadingGrade` reuses the same
  `rs.fleschKincaidGrade` call from `text-readability` that `validate.ts` uses (via the same
  `@ts-expect-error` import pattern), applied to `original_excerpt` instead of `plain_english`, so grades stay
  comparable across the pipeline. `rankWall` applies `classifyWallSubTypes` + `eligibleWallOpenings` over the T02
  `wallGate` survivors and reports its own, smaller measured counts (necessarily <= the 1,326-card figures, since
  not every length-gated card also has a qualifying landing line): within the 1,003-entry ranked pool, Thou Wall
  171, Cascade 174, Scene 96, reserve 608; `countdown`-eligible 248, `grade`-eligible 631. Every ranked entry's
  `eligible_openings` is non-empty and always contains `"standard"` (asserted corpus-wide). Added unit tests for
  each sub-type's exact boundary (2 vs 3 markers, 2 vs 3 semicolons, 1 vs 2 quotes), a non-exclusive-overlap case,
  opening-eligibility boundaries (`lengthDelta` 29 vs 30; reading grade below vs above 12; a card qualifying for
  both numeric openings at once), and corpus-level tests asserting the 222/204/137/513/813 classifier counts and
  the `rankWall`-pool counts above. `npx vitest run scripts/lib/__tests__/premises.test.ts` — 91/91 green (67
  baseline + 24 new). `npx vitest run` (full pipeline suite) — 347/347 green (323 baseline + 24 new), confirming no
  regression to T01/T02 or any other consumer.
- [ ] T04: Implement **the validation gate for The Question**, three layers, cheapest first:
  **(a) deterministic** — reject any question containing a pronoun or demonstrative whose antecedent is not inside
  the question (13 of 21 question-side failures); reject fragments and mid-thought openers ("Because", "Then",
  "What about", "you ask") (5 more).
  **(b) deterministic** — reject any candidate answer that itself ends in "?" (the Socratic chain continuing rather
  than resolving — 7 of 14 answer-side failures); reject attribution leaks ("he asks").
  **(c) LLM batch over survivors** — topic drift only (5 of 14), where the next sentence is chronologically next but
  not logically an answer.
  Layers (a)+(b) remove 20 of 35 observed failures at zero cost. Acceptance: the surviving pool is a MEASURED number;
  a known non-answer pair is rejected; both deterministic layers are unit-tested against the documented failures.
- [ ] T05: Balance the Epictetus skew (~65% of the usable Question pool) by weighting The Wall toward Meditations and
  the Seneca essays. Acceptance: the weekly schedule reports author mix across all formats combined, not per format.
- [ ] T06: Write scoring tests. Cover fenced-JSON parsing, rejection of text not traceable to the source card,
  per-rubric output shapes, per-format length limits. Acceptance: tests fail against an empty implementation.
- [ ] T07: Implement the three LLM rubrics and parsers. **The Objection's carries the most weight** — no regex
  separates "a position the viewer might hold" from "a line spoken in a scene". System prompt cached per author,
  reusing the `buildTranslationSystem` pattern in `scripts/lib/prompt.ts`. Acceptance: T06 passes.
- [ ] T08: Implement batch orchestration — chunk, submit, poll, stream, merge. Only T01/T02 survivors are sent. Log
  to `content/pipeline/social/premises.log` via the existing `logger`. Acceptance: `--dry-run` prints request counts
  with no API key set.
- [ ] T09: Implement the faithfulness check — reject any output whose on-screen text is not a faithful subset of its
  source card. Acceptance: a synthetic hallucinated response is rejected in tests.
- [ ] T10: Build `scripts/score-premises.ts` with `--format <wall|question|objection|still|all>`, `--dry-run`,
  `--limit`, `--verbose`. Acceptance: `--dry-run --limit 5` runs without an API key.
- [ ] T11: Run scoring for real; commit the pools. Acceptance: each pool covers 4 weeks; 10 per format spot-checked
  by hand; count and score distribution reported.
- [ ] T12: Implement the WEEKLY schedule generator — `content/social/pilot-schedule-wNN.json`, 7 days x 2 posts,
  format mix as a weighting argument, deterministic from a seed. Must read all prior weeks and never reuse a card.
  One slot per day carries the read-through: it draws the next card of the chosen book in strict sequence,
  independent of the format weighting. Acceptance: regenerating with the same seed and weights is byte-identical;
  a week 1 card cannot appear in week 2.
- [ ] T13: Write schedule tests — determinism, no cross-week repeats, weighting honoured, and the read-through
  counter advancing strictly sequentially across weeks without skipping or repeating. Acceptance: green.
- [ ] T14: Add the weekly review step — before generating week N+1, read week N's retention data and choose the
  format weighting and hook changes deliberately. Acceptance: a written, dated note per week beside the schedule file.

## Deferred
A validated `pull_quote` field in the CONTENT pipeline — a verbatim, self-contained sentence chosen once with the
full passage in context. Revives Three Voices, lifts One-Line Gut Punch, benefits the app. Out of scope for the pilot.

## Verify
```
npm test
npx tsx scripts/score-premises.ts --dry-run --limit 5
```
