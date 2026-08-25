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
- [x] T04: Implement **the validation gate for The Question**, three layers, cheapest first:
  **(a) deterministic** — reject any question containing a pronoun or demonstrative whose antecedent is not inside
  the question (13 of 21 question-side failures); reject fragments and mid-thought openers ("Because", "Then",
  "What about", "you ask") (5 more).
  **(b) deterministic** — reject any candidate answer that itself ends in "?" (the Socratic chain continuing rather
  than resolving — 7 of 14 answer-side failures); reject attribution leaks ("he asks").
  **(c) LLM batch over survivors** — topic drift only (5 of 14), where the next sentence is chronologically next but
  not logically an answer.
  Layers (a)+(b) remove 20 of 35 observed failures at zero cost. Acceptance: the surviving pool is a MEASURED number;
  a known non-answer pair is rejected; both deterministic layers are unit-tested against the documented failures.
  **Note:** Added the MECHANICAL gate, layers (a)/(b), and a layer-(c) STUB to `scripts/lib/premises.ts`, reusing
  `sentences`, `wordCount`, `isSelfContainedOpening` (T01) and `hasUnresolvedReference` (T02) exactly as instructed
  — layer (a) applies T02's whole-span pronoun/demonstrative rule to the question span unmodified, with no second
  reference-resolution rule written. `findQuestionCandidate` implements the mechanical gate: among the first
  `QUESTION_SENTENCE_WINDOW` (3) sentences of `plain_english`, the first (document order) sentence satisfying ALL of
  — ends `?`, <=`QUESTION_MAX_WORDS` (14) words, unquoted, passes `isSelfContainedOpening`, not exclamation-shaped
  (`isExclamationShaped` — stacked `?!`/`!?`, "What a"/"What an" openers, or "How <non-auxiliary>" openers like "How
  wonderful"), and no attribution leak (`hasAttributionLeak` — author's-own-voice check). Measured stage-by-stage
  against the real corpus (`content/output`): question present in first 3 sentences 458; + <=14 words 380; +
  unquoted 379; + self-contained opening 319; + not exclamation-shaped/no attribution leak — **313** (0 cards caught
  by `isExclamationShaped` alone in this corpus; 11 caught by `hasAttributionLeak`, netting -6 after overlap with
  already-excluded cards). The plan's target was 292; 313 is what's measured and asserted — not contorted to hit the
  estimate, per the same policy T01/T03 documented for their own unreproducible targets. `hasAttributionLeak`
  required one design correction during implementation: an initial version treated bare "you" the same as
  "he"/"someone" (any subject immediately before a speech verb), which false-positived on the author's own direct
  second-person address ("What should you say when something painful happens?" — genuinely the author's voice, not
  a dialogue leak) — fixed by narrowing "you" to the literal "you ask" pattern the plan specifies, leaving "you say"/
  "you reply" etc. unflagged. A second correction: the named-proper-noun subject branch (for "Epictetus said"-style
  leaks) originally matched ANY capitalized word before a speech verb, including ordinary sentence-initial
  capitalization ("Who says...?", "What does...?" — a common rhetorical device, not real attribution) — fixed by
  excluding sentence-initial position (index 0) from counting as proper-noun evidence, the same restriction T02 uses
  for its own antecedent lookback. `questionCandidateAnswer(card, index)` defines "the candidate answer" as exactly
  ONE sentence — the one immediately following the question in `sentences(plain_english)` order — documented
  in-file as a deliberate simplification (a multi-sentence span has no principled stopping rule without LLM
  judgement, out of scope for T04). Layer (a) (`passesLayerA`) rejects `hasUnresolvedReference(question)`,
  `hasMidThoughtOpener` (leading "Because"/"Then"/"What about"/"You ask", exported as `QUESTION_OPENING_REJECTS`),
  and `isFragmentQuestion` (no leading capital letter — a stray fragment). Layer (b) (`passesLayerB`) rejects
  `isSocraticChainAnswer` (answer itself ends `?`) and `hasAttributionLeak` (shared with the mechanical gate's
  author's-voice check). `questionGate(cards)` composes mechanical + (a) + (b) and returns only survivors as
  `QuestionEntry[]` (`{ card_id, book_slug, author_slug, question, answer, rejected_by? }` — `rejected_by` reserved
  for a future full-audit variant or T07/T08's rejection logging; not populated by `questionGate` itself). Measured
  full pipeline: mechanical 313 -> after layer (a) 162 -> after layer (b) **100** (this 100-card pool is what layer
  (c) will judge for topic drift). Acceptance's "known non-answer pair" is drawn from the real corpus
  (`discourses-49-010`: question "Was your desire in any danger?", candidate answer "Was your dislike of
  something?" — the Socratic chain continuing, correctly rejected by `passesLayerB` and absent from
  `questionGate`'s survivors). **Scope limit honored:** layer (c) is a documented stub only —
  `QuestionDriftRequest` (`{ card_id, question, answer }`) and `buildQuestionDriftRequests(entries)` do pure data
  shaping with no SDK/API calls and no network code; the in-file comment points at T07 (rubric/prompt) and T08
  (batch submit/poll/stream/merge via `scripts/lib/claude.ts`'s `createMessageBatch`/`pollBatchUntilDone`/
  `streamBatchResults`/`safeCustomId`, same pattern as the translate phase). Added 33 new tests to
  `scripts/lib/__tests__/premises.test.ts`: unit tests for `isExclamationShaped`/`hasAttributionLeak` (including
  the two false-positive corrections above, each pinned with a corpus-drawn example); layer (a) tests for a dangling
  pronoun, each of the four `QUESTION_OPENING_REJECTS`, and a fragment; layer (b) tests for a Socratic-chain answer,
  an attribution-leak answer, and the `discourses-49-010` corpus pair; corpus-level tests asserting the measured
  313/162/100 counts and that every survivor's question/answer are verbatim substrings of `plain_english`; and
  `buildQuestionDriftRequests` shape tests. `npx vitest run scripts/lib/__tests__/premises.test.ts` — 124/124 green
  (91 baseline + 33 new). `npx vitest run` (full pipeline suite) — 380/380 green (347 baseline + 33 new), confirming
  no regression to T01/T02/T03 or any other consumer.
  **Fix pass (same task):** an audit of the 100 survivors found four real leaks the deterministic layers were
  missing — all fixed in layers (a)/(b) per the plan's own "GATING, not scoring" instruction, no LLM calls added.
  (1) **Attribution leak `hasAttributionLeak` missed:** it only covered THIRD-party subjects
  (he/she/they/someone/people) immediately before an attribution verb, never first person ("I ask back: how does the
  earth keep holding all the buried bodies forever?" — `meditations-04-022` — survived because "I" wasn't in
  `ATTRIBUTION_PRONOUN_SUBJECTS`). Fixed with `FIRST_PERSON_ATTRIBUTION_RE` (literal "I ask"/"I say"/"I reply"/"I
  answer", deliberately narrow — not the full verb-conjugation set, since "I" is also the ordinary subject of the
  author's own direct statements) plus `hasColonAttributionLeadIn`/`isSpeechAttributionClause`, a second, more
  general check for a speech attribution sitting before a `:` where the subject and verb aren't strictly adjacent
  ("I ask back: ...", "Epictetus asks: ...") — this one deliberately DOES count sentence-initial capitalization as
  subject evidence (unlike the main loop's mid-sentence check), because a colon lead-in's whole job is to name the
  speaker. Both live inside `hasAttributionLeak` itself, so the fix applies everywhere that function is already
  called — the mechanical gate (on the question) and layer (b) (on the answer) — with no new call sites needed.
  (2) **Pivot-answer non-answers:** an answer that's purely cataphoric — it promises an explanation instead of
  giving one ("Think of it this way." for `discourses-21-004`; "Here's how it works." for `meditations-04-022`) —
  passed layer (b) cleanly (declarative, not a question, no attribution leak) but resolves nothing: the viewer
  checks their silent prediction against an empty frame. Added `PIVOT_ANSWER_PHRASES` (8 phrases) and `isPivotAnswer`
  to layer (b), matched against the WHOLE trimmed answer sentence (allowing trailing punctuation) via an anchored
  `^...$` regex, not a substring search — a longer answer that merely contains one of these phrases mid-sentence
  ("Consider this carefully before you decide what to do.") is correctly NOT rejected (unit-tested).
  (3) **Third-party/literary reference questions:** the format's mechanic is FORCED SELF-PREDICTION — a
  second-person question the viewer answers about their own life — and a question asked ABOUT a named third party
  or work ("What did Priam do in the Iliad?" — `on-anger-02-092`; "How does Medea put it?" — `discourses-17-003`)
  fails that mechanic even though it's otherwise well-formed. Added `hasThirdPartyReference` to layer (a): rejects a
  question containing a capitalized, non-sentence-initial proper noun (reusing T02's `looksLikeProperNoun`,
  excluding "God" — a common Stoic/theological term in this corpus, not a third party) UNLESS the question is
  second-person-ish (`isSecondPersonQuestion` — contains you/your/yours/yourself/we/our/us), which exempts a
  question that merely MENTIONS a name while still addressing the viewer directly (real corpus counter-example,
  unit-tested: "Why did you want to be elected governor of the Cnossians?" — `discourses-43-002` — survives).
  (4) **Unbalanced quote characters:** `sentences()` (unmodified, per the task's constraint) is quote-aware only for
  `"`, not `'` — a mid-sentence terminator inside a single-quoted span it doesn't track gets split, orphaning a
  leading `'I know the evil I'm about to do, but my anger is stronger than my better judgment.` as the candidate
  ANSWER for `discourses-17-003` (the closing `'` was left as the next sentence's leading character). Applied the
  same well-formedness idea T02's `hasBalancedQuotes` uses for `"` (even/odd count) to BOTH the question and answer
  here via `hasUnbalancedQuotes`, plus a new, more careful check for `'` specifically: `hasUnbalancedSingleQuote`
  counts "opening-shaped" `'` (preceded by start/whitespace, followed by a non-whitespace char) against
  "closing-shaped" `'` (preceded by non-whitespace, followed by whitespace/punctuation/end) and rejects when opens
  exceed closes. This distinguishes a real orphan quote-open from ordinary contractions ("don't", "I'm" — apostrophe
  has a LETTER immediately after, so it's never counted as opening OR closing) and possessives ("Epictetus' body" —
  counts as a "close" even though it's really a possessive, which is the conservative direction: it can only make an
  unbalanced count look balanced, never manufacture a false rejection) — both unit-tested as counter-examples,
  including a real corpus one (`discourses-17-007`: "Don't think I'm saying that." survives). Added to layer (a)
  (question) and layer (b) (answer).
  **Measured, stage by stage, after all four fixes** (mechanical gate's shared `hasAttributionLeak` fix moves the
  first number too): mechanical 313 -> **306**; after layer (a) 162 -> **150**; after layer (b) 100 -> **89**. Not
  tuned to hit any target — measured and asserted as-is, corpus-count assertions updated in
  `scripts/lib/__tests__/premises.test.ts` to match. **Author mix of the 89 survivors:** epictetus 50 (56%),
  marcus-aurelius 21 (24%), seneca 18 (20%) — the Epictetus skew T05 is scoped to address is if anything slightly
  worse in this smaller pool than the plan's own "~65% of the usable Question pool" estimate suggested at the
  100-card stage, so T05 remains necessary and unchanged in scope. All four real corpus leaks are confirmed absent
  from `questionGate`'s survivors via a dedicated corpus-level test. Added 39 new tests, spread across
  `hasAttributionLeak`/`hasColonAttributionLeadIn` (first-person + colon-lead-in), new
  `isSecondPersonQuestion`/`hasThirdPartyReference` describe blocks, `passesLayerA` (third-party reference +
  unbalanced quotes), `passesLayerB` (pivot answer + unbalanced quotes), new `isPivotAnswer`/
  `hasUnbalancedSingleQuote`/`hasUnbalancedQuotes` describe blocks, and updated corpus-level tests (counts,
  author-mix, leak-absence, and the broadened "no survivor has X" sweeps) — each of the six examples quoted in the
  fix-pass instructions is pinned as its own rejection test, and each new rule has at least one counter-example test
  proving it doesn't over-reject. `npx vitest run
  scripts/lib/__tests__/premises.test.ts` — 163/163 green (124 baseline + 39 new). `npx vitest run` (full pipeline
  suite) — 419/419 green (380 baseline + 39 new), confirming no regression to T01/T02/T03 or any other consumer.
- [x] T05: Balance the Epictetus skew (~65% of the usable Question pool) by weighting The Wall toward Meditations and
  the Seneca essays. Acceptance: the weekly schedule reports author mix across all formats combined, not per format.
  **Note:** Added `authorMix`, `combinedAuthorMix`, `wallAuthorWeights`, `selectWallBalanced`, and `createSeededRng`
  to `scripts/lib/premises.ts`, reusing `loadCorpus`, `rankWall`, `questionGate`, `RankedWallEntry`, and
  `QuestionEntry` exactly as instructed — `sentences()`, the T02 reference rules, the T03 classifier, and the T04
  gate predicates are all untouched. `authorMix<T extends { author_slug: AuthorSlug }>(entries)` is generic over any
  collection carrying `author_slug` (a single format's pool or a flattened multi-format selection) and always
  returns all three authors, count 0 / share 0 rather than `undefined`/`NaN` when an author has no entries.
  `combinedAuthorMix(...pools)` flattens any number of pools and calls `authorMix` — this is the exact call the
  weekly scheduler (T12) needs to satisfy the acceptance criterion. **Balance target, stated explicitly per the
  task:** an even three-way split (`BALANCED_AUTHOR_SHARE`, 1/3 each) — chosen over matching the corpus's own
  proportions (1,615 cards: epictetus 458/28%, marcus-aurelius 576/36%, seneca 581/36%) because the corpus mix is
  already close to even, so matching it instead of a clean 1/3 would only reproduce part of the skew problem, and
  because "balanced" is a reader-facing promise (three philosophers, none dominating the feed) that reads more
  honestly as an even split than as "proportional to how much each of them happened to write" — full reasoning
  in-file. `wallAuthorWeights(questionPool, wallPool, questionFraction = DEFAULT_QUESTION_FRACTION)` solves
  algebraically for the Wall weight `w[a]` per author that makes `questionFraction * q[a] + (1 - questionFraction) *
  w[a] == 1/3`, given `questionFraction = 0.5` by default (mirroring the plan's "7 days x 2 posts" as one Question +
  one Wall per day; overridable once T12 knows the schedule's real format mix). Because `sum(q[a]) == 1`, the
  un-clamped solution always sums to exactly 1; clamped to >= 0 and renormalized as a defensive measure for a future
  corpus where a Question pool's skew could exceed the 66.7% ceiling at which a solved weight would go negative (not
  the case here — measured worst case is epictetus at 56%). An author absent from the Wall pool is forced to weight
  0 regardless of what the algebra solves for. Measured over the real corpus:
  `wallAuthorWeights(questionGate(loadCorpus()), rankWall(loadCorpus()))` = epictetus 0.1049, marcus-aurelius
  0.4307, seneca 0.4644 — pushed away from epictetus (natural Wall-pool share 33%) and toward marcus-aurelius
  (up from 26%) and seneca (up from 41%), exactly as required. `selectWallBalanced(pool, weights, n, rng)` is a
  generic (any `{ author_slug }` collection, not Wall-specific) deterministic weighted selection without
  replacement: roulette-wheel author draw weighted by `weights` among authors with remaining entries, then a
  uniform draw within that author's remaining bucket, removing the picked entry so it can never repeat. Every
  random choice comes from the injected `rng`, never `Math.random()`. `createSeededRng(seed)` is a self-contained
  mulberry32 PRNG, exported so T12 reuses the identical generator — required for T12's byte-identical regeneration
  from a seed. **Measured combined mix for a representative 7 Question + 7 Wall week** (seed 42, Question sample
  drawn with weights matching its OWN natural/uncorrected mix — T05 does not rebalance The Question itself, only
  The Wall — and Wall sample drawn with `wallAuthorWeights`'s correction): epictetus 3/14 (21.4%), marcus-aurelius
  5/14 (35.7%), seneca 6/14 (42.9%) — materially lower than the Question pool's own 56% epictetus share, which is
  unchanged and unchangeable at 50/89 (56.2%). A directional large-draw test (n=300 from the full Wall pool) also
  confirms `selectWallBalanced` honours the weighting: epictetus share below 1/3, marcus-aurelius and seneca above
  it. Added 21 new tests to `scripts/lib/__tests__/premises.test.ts`: `authorMix` unit tests (synthetic collection,
  missing-author zero entries, empty-collection share, and the real Question pool's measured 50/21/18);
  `combinedAuthorMix` tests (synthetic multi-pool flatten, equivalence to `authorMix` over a manually flattened
  Question+Wall pool); `wallAuthorWeights` tests (directional push away from epictetus/toward the other two, the
  exact solved weights at the default fraction, weights summing to 1, an author absent from a synthetic Wall pool
  forced to 0, an explicit `questionFraction` override); `createSeededRng` tests (same-seed determinism,
  different-seed divergence, output bounded to `[0, 1)`); `selectWallBalanced` tests (same-seed determinism,
  different-seed divergence, no duplicates and all entries traceable to the input pool, capping at pool size, and
  the large-draw directional check); and the combined-mix week-level test proving the point of the task, pinning
  both the exact seed-42 combined counts and the qualitative "materially lower than 56%" claim. `npx vitest run
  scripts/lib/__tests__/premises.test.ts` — 184/184 green (163 baseline + 21 new). `npx vitest run` (full pipeline
  suite) — 440/440 green (419 baseline + 21 new), confirming no regression to T01/T02/T03/T04 or any other
  consumer.
- [x] T06: Write scoring tests. Cover fenced-JSON parsing, rejection of text not traceable to the source card,
  per-rubric output shapes, per-format length limits. Acceptance: tests fail against an empty implementation.
  **Note:** Added `scripts/lib/premises-scoring.ts` (stubs only — gate code in `premises.ts` stays separate from
  scoring code, per the plan's file layout) and `scripts/lib/__tests__/premises-scoring.test.ts` (51 new tests).
  Every exported function in `premises-scoring.ts` throws `new Error("not implemented")`; the module's constants
  (`WALL_SCORE_MIN`/`MAX`, `OBJECTION_MAX_WORDS`, `WALL_ORIGINAL_MIN_WORDS`, the verdict/classification enums) are
  real values, not stubs, since they're facts to assert against, not logic to implement. **Shapes chosen, matching
  the plan's "three different shapes" framing:** Wall = `{ impenetrability_score, landing_line_score,
  chosen_landing_line, reason? }` (scores + a chosen line, no verdict — every Wall candidate already survived T02's
  mechanical gate, so the LLM's job here is scoring/selection, not accept/reject); Question =
  `{ verdict: "answers"|"drifts", reason }` (T04 layer (c)'s topic-drift judgement); Objection =
  `{ verdict: "accept"|"reject", classification: "viewer_position"|"dramatized_scene"|"doctrinal_dispute", reason }`
  (the heaviest shape, per the plan's own description). Four coverage areas, each its own `describe` block group: (1)
  **fenced-JSON parsing** — 12 tests, 4 per parser (bare JSON, ```json-fenced, JSON with leading/trailing prose, a
  malformed-JSON rejection asserting the thrown message matches `/json/i`); (2) **traceability** — 9 tests against a
  new `checkFaithfulness(text, card)` stub, covering verbatim-from-`plain_english`, verbatim-from-`original_excerpt`,
  a verbatim partial-sentence substring, paraphrase, embellishment (source text plus an invented tail), wholly
  invented text, a **near-miss single-word substitution** ("life" -> "soul") — the plan's named central case — text
  stitched from two non-adjacent real fragments (not itself a contiguous substring), and a reason-string check;
  `checkFaithfulness` is documented as mechanical only (no LLM call inside it), matching "Enforce mechanically"; (3)
  **per-rubric output shapes** — 17 tests: each parser accepts its own shape and rejects missing/extra required
  fields, a wrong-typed score, out-of-range scores (Wall only — the plan explicitly names this), an invalid
  verdict/classification enum value, and BOTH other formats' shapes; (4) **per-format length limits** — 13 tests
  across four new pure-boolean stubs (`withinWallOriginalLimit`, `withinWallLandingLineLimit`, `withinQuestionLimit`,
  `withinObjectionLimit`), reusing `LANDING_LINE_MAX_WORDS`/`QUESTION_MAX_WORDS` from `premises.ts` rather than
  redefining them, plus a new `OBJECTION_MAX_WORDS` (14) kept as its OWN constant even though it numerically equals
  `QUESTION_MAX_WORDS` — deliberately not shared, so the two formats' limits can never silently drift together. The
  capstone test in this group is the one the task calls out explicitly: a single 150-word string passes
  `withinWallOriginalLimit` (no ceiling on the Wall's original side) while the same-length string fails
  `withinQuestionLimit`, proving no single global limit is applied. **Correction during implementation:** the first
  pass of the 15 "rejects a malformed/wrong-shape payload" tests asserted only `.toThrow()` with no message pattern
  — every one of them passed trivially against the stub (which throws unconditionally), leaving 15 of 51 new tests
  accidentally green, violating the task's "tests MUST be red" requirement. Fixed by tightening each to
  `.toThrow(/specific-field-name/i)` (e.g. `/chosen_landing_line/`, `/score/i`, `/verdict/i`, `/classification/i`,
  `/reason/i`) — a message a real T07 validator will plausibly produce, but that the stub's literal "not implemented"
  text can never match — which turned all 15 red without weakening what they assert once T07 lands (each still
  fails for exactly the field/shape reason its name describes). **Measured:** `npx vitest run
  scripts/lib/__tests__/premises-scoring.test.ts` — 51/51 RED (all fail against the stubs, confirmed both before and
  after the message-specificity fix — 36/51 before, 51/51 after). `npx vitest run
  scripts/lib/__tests__/premises.test.ts` — 184/184 GREEN, untouched. `npx vitest run` (full pipeline suite) — 491
  total (440 baseline + 51 new): 440 passed, 51 failed, confirming zero regression to T01-T05 or any other existing
  consumer.
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
