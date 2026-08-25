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
- [x] T07: Implement the three LLM rubrics and parsers. **The Objection's carries the most weight** — no regex
  separates "a position the viewer might hold" from "a line spoken in a scene". System prompt cached per author,
  reusing the `buildTranslationSystem` pattern in `scripts/lib/prompt.ts`. Acceptance: T06 passes.
  **Note:** Filled in every T06 stub in `scripts/lib/premises-scoring.ts`. Parsers (`parseWallRubricResponse`/
  `parseQuestionRubricResponse`/`parseObjectionRubricResponse`) reuse `extractJSON` (./claude.js) unmodified for
  fence/prose-stripping, then run field-level validation via shared `requireNumber`/`requireString`/`requireEnum`/
  `optionalString`/`rejectUnknownFields` helpers — every thrown message names the specific field, matching T06's
  message-specificity tests exactly. **Two field-check orderings were load-bearing, not incidental:** Question checks
  `verdict` before `reason` (so a Wall-shaped payload, missing `verdict` entirely, always fails on `verdict` rather
  than on its own present-but-irrelevant `reason`); Objection checks `classification` before `verdict` (so a
  Question-shaped payload — `{verdict: "answers", reason}` — fails on the missing `classification`, not on
  `"answers"` also being an invalid Objection verdict, per T06's own explanatory comment on that test). `reason` is
  optional on the Wall result (per its `WallRubricResult` interface) and required on Question/Objection. Also added
  `rejectUnknownFields` (not itself asserted by name in any T06 test, but required by the stub's own docstring
  ("reject... an extra unrecognized field") — verified it doesn't false-positive against any of T06's valid payloads
  before adding it). `checkFaithfulness` (nominally T09, but T06's tests cover it and T08 needs it to validate every
  rubric response) is a thin two-field wrapper over T02's own `verbatim(line, source)`: exact substring against
  EITHER `plain_english` OR `original_excerpt`, case-sensitive, no fuzzy matching — sufficient to reject every T06
  case (paraphrase, embellishment, wholesale invention, the single-word "life"->"soul" near-miss, and text stitched
  from two real-but-non-adjacent fragments) because none of those are literal substrings of either field; flagged in
  the report below as a genuine T07/T09 scope overlap rather than silently absorbed. Length-limit functions are
  one-line wrappers reusing `LANDING_LINE_MIN_WORDS`/`MAX_WORDS`/`QUESTION_MAX_WORDS` from `premises.ts` and the
  new (T06) `OBJECTION_MAX_WORDS`/`WALL_ORIGINAL_MIN_WORDS` — no new bounds invented.
  **Prompt builders** (`build{Wall,Question,Objection}RubricSystem(authorSlug)` +
  `build{Wall,Question,Objection}RubricUser(...)`), mirroring `buildTranslationSystem`'s structure but keyed on
  `authorSlug` ALONE (not book+author like the translate phase) since none of the three judgements depend on which
  book a card came from — a genuine cache-hit improvement over the translate phase's per-book keying, and exactly
  what the task asked for. Every system prompt is built from module-level string constants concatenated with
  `AUTHOR_VOICE[authorSlug]` (exported from `./prompt.ts` for reuse — a one-line, behavior-preserving change,
  confirmed `prompt.test.ts` still 13/13 green) or a per-author `OBJECTION_EXAMPLES` entry, so it is a pure function
  of `authorSlug`: byte-identical across calls, asserted directly in new tests. `buildWallRubricUser(card)` calls
  T02's `findLandingLines(card)` (not the single deterministic `selectLandingLine` pick) and lists every qualifying
  candidate for the model to choose among verbatim — a multiple-choice design deliberately chosen over free
  generation, since it makes `chosen_landing_line` mechanically checkable against a known-good list rather than
  merely against the faithfulness substring check; throws if a card somehow has zero candidates (should be
  unreachable for a real `wallGate` survivor, defensive only). `buildQuestionRubricUser` takes T04's own
  `QuestionDriftRequest` shape directly, no new type invented. `buildObjectionRubricUser(quotedLine, card)` takes a
  bare `(string, card)` pair rather than a bespoke `ObjectionCandidate` interface, because **no mechanical Objection
  gate exists yet** — see the flagged plan gap below — so inventing a gate-result shape now risked not matching
  whatever T08 (or an unassigned task) actually builds to produce Objection candidates.
  **The Objection's system prompt — the heaviest, per the plan — carries real corpus examples, not invented ones.**
  Scanned `content/output` (via `loadCorpus`) for the plan's own mechanical description (quoted span starting
  "But"/a question word, <=14 words, no proper nouns) and measured **61 raw candidates** (epictetus 23, seneca 35,
  marcus-aurelius 3) — close to, not identical to, the plan's own "~50 raw" estimate, same "measure it, document the
  gap" treatment every prior task in this plan gave its own unreproducible estimates. Read the full card context for
  ~20 of those to hand-classify real discriminators, then built each author's `OBJECTION_EXAMPLES` entry from
  genuine corpus lines: Epictetus gets one real `viewer_position` accept (`discourses-53-011`, "But why did he bring
  me into the world under these conditions?") and one real `dramatized_scene` reject (`discourses-64-004`, the
  gossiping-friend exchange — "But it's not fair," you say. "I told you my neighbor's secrets..."); Marcus Aurelius
  (only 3 raw candidates) gets one real `viewer_position` accept (`meditations-12-041`, the "only three acts are
  done" theater metaphor) plus a note that most of his candidates read as private self-reflection rather than staged
  dialogue; Seneca — per the task's explicit instruction to "LEAD WITH On Anger... whose objections are about the
  reader's own life" and flag On the Happy Life's doctrinal disputes — gets two real `viewer_position` accepts from
  On Anger (`on-anger-01-025`, "But some angry people stay in control," you might say; `on-anger-03-081`, "But this
  person has already hurt me," you say), one real `dramatized_scene` reject (`peace-of-mind-14-004`, Kanus's "Why
  are you upset?" spoken mid-execution-anecdote to specific friends), and two real `doctrinal_dispute` rejects from
  On the Happy Life (`happy-life-11-002`/`happy-life-15-001`, both explicitly attributed to "our opponent" arguing
  the Epicurean position on "the highest good") — chosen specifically because they are grammatically
  indistinguishable in shape from a good `viewer_position` line, which is the whole reason this rubric needs an LLM
  rather than a regex. **Flagged plan gap (reported, not silently patched):** the plan's own table names an Objection
  "mechanical gate" (quoted span starting But/question-word, <=14 words, no proper nouns, ~50 raw survivors) as a
  prerequisite for this rubric, but no task in T01-T14 is explicitly scoped to build it in `premises.ts` — T01 built
  only `quotedSpeech` as a stated "Objection precursor" (>=2 `"` in plain_english, 308 cards), a much looser gate than
  the one the rubric actually needs. This task's own scope ("prompt construction + response parsing + validation
  ONLY... T08 owns batch orchestration") means it was correctly out of bounds to build that gate here; the ad hoc
  scan above was written as a disposable one-off script (not committed, not exported) purely to source real prompt
  examples, and is NOT the mechanical gate itself. **T08 (or a new task) will need to build the actual Objection
  mechanical gate in `premises.ts` before it has anything to submit to `buildObjectionRubricUser`** — recommend
  inserting that as an explicit T08 sub-step or a new T07.5, rather than assuming T08's "chunk, submit, poll, stream,
  merge" scope silently includes writing a brand-new gate. Added 15 new tests (on top of T06's 51, now 66 total in
  this file): per-rubric system-prompt determinism (same-author byte-identical) and cross-author divergence (3
  distinct authors x 3 rubrics = 6 tests), content assertions that each system prompt names its own required JSON
  fields and scoping language, and — the heaviest coverage — Objection-specific tests pinning all three
  classification labels present per author and the exact real corpus example strings quoted above, so the discriminating
  examples can't silently drift or be deleted in a future edit without a test failing. `npx vitest run
  scripts/lib/__tests__/premises-scoring.test.ts` — 66/66 green (51 T06 baseline + 15 new). `npx vitest run` (full
  pipeline suite) — 506/506 green (491 baseline + 15 new), confirming no regression to T01-T06 or any other consumer.
- [x] T07a: Implement The Objection's MECHANICAL gate in `scripts/lib/premises.ts` (gap found during T07 — the
  plan's format table specifies this gate but no task itemized it; T01 built only the looser `quotedSpeech`
  precursor). Per the table: quoted span starting "But"/a question word, <=14 words, no proper nouns (~50 raw).
  Acceptance: the raw pool is a MEASURED number near 50, unit-tested, and feeds the T07 Objection rubric.
  **Note:** Added `OBJECTION_OPENERS`, `OBJECTION_GATE_MAX_WORDS`, `startsWithObjectionOpener`,
  `hasObjectionProperNoun`, `ObjectionEntry`, and `objectionGate` to `scripts/lib/premises.ts`; exported the
  previously-internal `looksLikeProperNoun` (T02) for reuse rather than duplicating proper-noun detection.
  `objectionGate` walks `sentences(card.plain_english)` (T02's quote-aware splitter, reused not rewritten) and
  extracts every `"..."` quoted span within each sentence via a plain regex; a span survives when its FULL content
  (not each of its own internal sentences separately — see in-file rationale, judging by internal sentence nearly
  doubles the raw pool to 148 by counting throwaway mid-quote continuations) starts with an `OBJECTION_OPENERS` word
  (`But` plus a documented list of question-word/negative-interrogative openers — "isn't/aren't/don't/can't/
  shouldn't" per the plan's own examples, plus natural extensions of the same shape), is <=14 words, and carries no
  proper noun outside the sentence-initial position (`hasObjectionProperNoun`, built on the reused
  `looksLikeProperNoun`, which already excludes bare "I"). `reply` (the author's answer) is defined as whatever
  remains of the SAME sentence after the span's closing quote, followed by every later sentence in the card, joined
  with a space — a deliberate simplification in the same spirit as T04's single-sentence "candidate answer," chosen
  because it never truncates a genuine reply; can be empty when the objection is the card's last sentence (measured:
  2 of 78). `buildObjectionRubricUser` (T07) doesn't need any code changes — it already takes the quoted line plus
  the full card as context, exactly what `objectionGate`'s output can supply. Measured over the full corpus: **78**
  raw candidates — epictetus 32, seneca 43, marcus-aurelius 3. This differs from both the plan's own ~50 estimate
  (24/24/2) and the ad hoc 61 (23/35/3) an earlier scan reported while drafting T07's prompt — neither reproduces
  under this or any other definition of the stated spec tried; 78 is what's implemented and measured, per the same
  "don't contort to hit the estimate" policy T01/T03/T04 documented for their own unreproducible targets, and it's
  in the same neighbourhood (epictetus/seneca-dominated, marcus-aurelius a small minority) as both prior figures.
  Added unit tests for each opener, case-insensitivity, word-boundary (not prefix) matching, the proper-noun rule's
  three required cases (proper noun after the opener rejected; sentence-initial-only capital not rejected; mid-span
  "I" not rejected), quoted-vs-unquoted extraction, the >14-word rejection, and the reply-assembly logic (including
  the empty-reply case) — plus corpus-level tests asserting the exact 78/32/43/3 counts, a 40-80 regression guard,
  verbatim traceability of every `objection` string to its source card, and that every survivor actually satisfies
  the word-count/opener rules. `npx vitest run scripts/lib/__tests__/premises.test.ts` — 204/204 green (178 baseline
  + 26 new). `npx vitest run` (full pipeline suite) — 526/526 green, confirming no regression to T01-T07 or any
  other consumer. `npm test` — 526 pipeline + 95 web unit tests, all green.
  **Fix pass (floor added):** the 78-candidate pool had no MINIMUM length, so bare fragments/interjections survived
  as "objections" even though nothing about them is a position a viewer could hold — real examples pulled from the
  78: `"But,"` (happy-life-06-001, on-anger-01-024/030, peace-of-mind-03-002 — a bare conjunction+comma, 1 word),
  `"Why?"`/`"What?"`/`"How,"` (bare interrogatives, 1 word each), `"How miserable."` (discourses-40-004, 2 words, no
  proposition), `"What a beautiful sight!"`/`"What a kingly deed!"` (on-anger-02-012, exclamations not claims). Added
  exported `OBJECTION_GATE_MIN_WORDS = 4` (chosen by inspecting every 1-6 word span in the raw pool: every 1-3 word
  span measured is a fragment/interjection — `"Don't you care?"`, discourses-12-003, is the sole 3-word span and is
  the closest real judgment call, but it's elliptical rather than a stated claim; every 4-word span that isn't
  independently exclamation-shaped — `"But it's not fair,"`, `"Who are you threatening?"`, `"Shouldn't he be
  punished?"`, etc. — is a genuine, self-contained position). Also added `isOpenerOnly` (rejects a span whose content
  after the opener is empty/punctuation-only — the `"But,"` case specifically, kept independent of word count per
  its own doc comment) and reused T04's `isExclamationShaped` (no second implementation written) to catch
  exclamation-shaped 4-word survivors like `"What a beautiful sight!"` that clear the new word floor. Re-measured
  over the full corpus with all three new checks applied: **59** raw candidates (down from 78) — epictetus 24, seneca
  32, marcus-aurelius 3. On Anger's own share of the pool shrank somewhat more than other books (23/78 -> 15/59,
  since several of its rejected spans were interjection-heavy dialogue: `"But,"` x2, `"Why?"`, `"How,"`, `"What a
  beautiful sight!"`, `"What a kingly deed!"`) but it remains the SECOND-LARGEST single book in the pool (behind only
  discourses' 19) and still the largest contributor within Seneca (15 of Seneca's 32) — the plan's "lead with On
  Anger" guidance is not undermined by this floor. Updated the corpus-level tests to the new 59/24/32/3 counts and
  narrowed the regression guard from 40-80 to 35-65 (still wide enough to absorb future corpus edits without being a
  tautology); added floor-specific unit tests for each of the four fragment/interjection examples above (asserting
  rejection) plus a counter-example at exactly the new minimum (`"But it's not fair,"`, discourses-64-004, 4 words,
  asserted as an accept) and direct tests for `isOpenerOnly` and the corpus-wide "no survivor is opener-only or
  exclamation-shaped" invariant. `npx vitest run` (full pipeline suite) — 534/534 green, confirming no regression to
  T01-T07 or any other consumer.
- [x] T08: Implement batch orchestration — chunk, submit, poll, stream, merge. Only T01/T02 survivors are sent. Log
  to `content/pipeline/social/premises.log` via the existing `logger`. Acceptance: `--dry-run` prints request counts
  with no API key set.
  **Resolved by T07a:** the Objection's own mechanical gate (`objectionGate` in `premises.ts`) is now built — 59 raw
  candidates after the T07a fix pass's minimum-length/opener-only/exclamation-shape floor (epictetus 24 / seneca 32 /
  marcus-aurelius 3; was 78 before the floor). T08 can submit `objectionGate(loadCorpus())` entries directly against
  `buildObjectionRubricSystem`/`buildObjectionRubricUser`, the same way it submits `wallGate`/`questionGate`
  survivors for the other two formats.
  **Note:** Added `scripts/lib/premises-batch.ts`, mirroring `translateChunksBatch`'s (`translator.ts`) structure —
  build requests via T07's builders -> `createMessageBatch` -> `pollBatchUntilDone` -> `streamBatchResults` -> merge —
  while calling only T07's prompt builders/parsers, never re-implementing prompting or parsing (gate code stays in
  `premises.ts`, scoring code stays in `premises-scoring.ts`, orchestration lives here, per the plan's own file-layout
  instruction). Three entry points, one per format: `scoreWallSurvivors(entries: RankedWallEntry[], cards: Card[])`,
  `scoreQuestionSurvivors(entries: QuestionEntry[])`, `scoreObjectionSurvivors(entries: ObjectionEntry[], cards: Card[])`
  — each takes the ALREADY-GATED survivor pool (never `loadCorpus()`'s raw output) plus whatever `Card[]` lookup
  context its own rubric's user-message builder needs (Wall/Objection need the full card for
  `original_excerpt`/`plain_english`; Question doesn't, since `buildQuestionRubricUser` takes T04's own
  `QuestionDriftRequest` shape directly). **"Only survivors are sent" is enforced two ways, not just documented:**
  (1) type-level — `RankedWallEntry`/`QuestionEntry`/`ObjectionEntry` are structurally incompatible with `Card`
  (missing `landing_line`/`question`/`objection` etc.), so passing `loadCorpus()` itself as `entries` fails to
  compile; (2) a runtime trip-wire, `assertWithinSurvivorCeiling` — per-format ceilings (Wall 1,100, Question 150,
  Objection 100) set with generous headroom above this file's own measured gate sizes but strictly below the full
  corpus (1,615), so a caller that accidentally passes an un-gated list throws immediately instead of silently
  submitting (and paying for) an LLM call on every card in the app; unit-tested for all three formats. A corpus-level
  test for Question and Objection also asserts the exact submitted count equals `questionGate`/`objectionGate`'s own
  count (89 / 59) and is strictly less than `loadCorpus().length` (1,615) — the literal acceptance wording ("never
  submit the raw 1,615") pinned as a test, not just a design note.
  **Cache-control — fix pass (post-review):** the original note here observed, correctly, that `translator.ts`'s batch
  function doesn't set `cache_control` and concluded this file should match that pattern. That conclusion was wrong:
  the plan asks for the rubric system prompt to be "cached per author," and `sortByAuthor` grouping alone reuses a
  byte-identical string but never actually establishes a cache breakpoint on the Batch API path — `claude.ts`'s
  real-time path (`callClaudeAPI`) has always set `cache_control: { type: "ephemeral" }` on its system block; the
  batch path just never grew the same capability, because `BatchRequest.system` (`claude.ts`) was typed as a plain
  string and `createMessageBatch` passed it straight through with no wrapper. Fixed by adding an optional
  `cache_system?: boolean` field to `BatchRequest`: when set, `createMessageBatch` emits `system` as the
  array-with-`cache_control` form (mirroring the real-time path); when absent, it emits the original plain string,
  so `translator.ts`/`refine.ts` (neither of which sets the new flag) are unaffected. All three rubric request
  builders here (`buildWallRequests`/`buildQuestionRequests`/`buildObjectionRequests`) now set `cache_system: true`,
  so — combined with `sortByAuthor`'s grouping — Wall's ~1,003 requests actually share a server-side cache across
  the ~3 per-author system prompts instead of each paying full input price. New tests: `createMessageBatch` emits the
  plain-string form when `cache_system` is absent (protecting `translator.ts`/`refine.ts`) and the `cache_control`
  array form when present (`scripts/lib/__tests__/batch.test.ts`); all three rubric builders assert
  `request.cache_system === true` (`scripts/lib/__tests__/premises-batch.test.ts`). `npx vitest run` — 558/558 green
  (556 baseline + 2 new).
  **Chunking:** `chunkArray<T>(items, size)` is a small generic helper; orchestration pages every format's requests at
  `MAX_REQUESTS_PER_BATCH = 500` — well under the Batch API's own 100,000-request ceiling, chosen so a single batch
  failure only costs re-submitting one page (relevant mainly to the ~1,003-entry Wall pool; Question/Objection are
  single-page today at 89/59). Unit-tested at the exact boundary (`chunkArray([1,2,3,4,5], 2)` -> `[[1,2],[3,4],[5]]`)
  and at the orchestration level (a synthetic 505-entry Wall pool produces two `createMessageBatch` calls of 500 and 5).
  **Failure handling deliberately does NOT retry** (unlike `translateChunksBatch`'s real-time-API retry-then-throw):
  the task's own wording is "drop failures with a logged reason," and a dropped premise candidate just means one fewer
  post-worthy card in a pool of hundreds, not a missing card in a shipped book — flagged here in case T11 (the real
  scoring run) decides a retry is worth adding later. Every drop path (`errored` result, missing text block, JSON
  parse/validation failure) logs via `logger.warn` with the `custom_id` and a reason, and — Wall only — a response
  whose `chosen_landing_line` isn't verbatim among the candidates `buildWallRubricUser` actually offered
  (`findLandingLines(card)`) is also dropped with a logged reason, defending against a hallucinated line the T09
  faithfulness check (not yet built) would otherwise have to catch alone.
  **`logger` — one small, behavior-preserving change:** `PipelineLogger.init` (`logger.ts`) gained an optional third
  `fileName` parameter (default `"pipeline.log"`, unchanged for every existing caller) so this module's log can live at
  `content/pipeline/social/premises.log` instead of colliding with `generate.ts`'s own per-book
  `content/pipeline/<book>/pipeline.log` convention; `logger.test.ts` (12 tests, none touching the new parameter) is
  untouched and still green. This module only ever calls `logger.info`/`.warn` — never `.init`/`.close` — so a future
  CLI (T10) owns calling `logger.init("social", verbose, "premises.log")` before invoking anything here.
  **Dry run — the acceptance criterion.** `buildDryRunReport(cards: Card[])` builds every request for every format via
  the same pure builders the real path uses, then stops — it never calls `createMessageBatch`/`pollBatchUntilDone`/
  `streamBatchResults`, so it never touches `getClient()` (`claude.ts`) and never reads `ANTHROPIC_API_KEY`; verified
  both by a unit test that deletes `ANTHROPIC_API_KEY` from `process.env` before calling it and by an ad hoc
  `npx tsx` run with the key unset. T10 owns wiring an actual `--dry-run` CLI flag to this function; this task's own
  scope (per the plan's T10 line) is the function itself, not the CLI. **Measured dry-run counts against the full
  corpus** (`content/output`, 1,615 cards): Wall 1,003 requests, Question 89 requests, Objection 59 requests — 1,151
  requests total, ~1,207,900 estimated tokens (rough 4-chars/token heuristic, cheap to compute, not billing-accurate;
  Wall alone accounts for ~1,086,600 of that, since every Wall prompt repeats the >=80-word `original_excerpt`).
  Added `scripts/lib/__tests__/premises-batch.test.ts` (22 new tests), mocking only `createMessageBatch`/
  `pollBatchUntilDone`/`streamBatchResults` from `claude.js` (via `importOriginal`, exactly `translateBatch.test.ts`'s
  own pattern) so `safeCustomId`/`tokenUsage`/`batchStats`/`extractJSON` stay real: `chunkArray` (even split, boundary
  split, oversized chunk size, empty input, invalid size); `buildDryRunReport` (no-API-key/no-SDK-call, survivor count
  == request count, empty-corpus zeroes); `buildQuestionRequests` (author-contiguous grouping, unique custom_ids per
  entry); `scoreQuestionSurvivors` (merge a success, drop an errored item with a logged reason, drop a malformed-JSON
  item with a logged reason, submit exactly the gate count against the real corpus and not the corpus size, the
  ceiling trip-wire); `scoreWallSurvivors` (merge + token accumulation, drop a hallucinated `chosen_landing_line`, the
  ceiling trip-wire); `scoreObjectionSurvivors` (merge, submit exactly the gate count against the real corpus, the
  ceiling trip-wire); and one orchestration-level paging test. `npx vitest run
  scripts/lib/__tests__/premises-batch.test.ts` — 22/22 green. `npx vitest run` (full pipeline suite) — 556/556 green
  (534 baseline + 22 new), confirming no regression to T01-T07a, `logger.test.ts`, `claude.test.ts`, or
  `translateBatch.test.ts`.
- [x] T09: Implement the faithfulness check — reject any output whose on-screen text is not a faithful subset of its
  source card. Acceptance: a synthetic hallucinated response is rejected in tests.
  **Enforcement, not a second implementation.** T07's `checkFaithfulness` (`premises-scoring.ts`) already existed and
  was unit-tested; this task's job was wiring it into every merge step in `premises-batch.ts` so a hallucinated
  response can never reach a committed pool, plus a run-stats counter and end-to-end tests.
  **Audit — which on-screen fields were already covered vs. newly wired:**
  - Wall: `chosen_landing_line` (LLM rubric output) was ALREADY defended, but only by Wall's own narrower "must be
    among the offered `findLandingLines(card)` candidates" check, not by `checkFaithfulness` itself. Added an
    explicit `checkFaithfulness` call BEFORE that check, so a hallucinated line is now rejected by the general
    faithfulness constraint first; the narrower candidate-membership check is retained as a second, Wall-specific
    defense (it also catches a real substring — e.g. drawn from `original_excerpt` — that's faithful but was never
    actually offered as a landing-line option). `original_excerpt` itself (phase 1 on screen) was never at risk — it's
    read straight off the card, never LLM output.
  - Question: `question`/`answer` were UNCHECKED. Both are mechanically extracted from `plain_english` by
    `questionGate` (not authored by the LLM rubric, which returns only `verdict`/`reason`), and a corpus-wide check
    confirmed 0/89 real survivors currently fail faithfulness — but nothing enforced that invariant at the merge
    step, so a future gate defect or corrupted intermediate could ship unfaithful text undetected. Added
    `checkFaithfulness` on both fields in `scoreQuestionSurvivors`'s merge loop; changed its signature to
    `(entries, cards: Card[])` (previously `entries` only) so it can look up each survivor's source card — the only
    call sites were this file's own tests, all updated.
  - Objection: `objection` (the quoted line) and `reply` (the author's answer, per `ObjectionEntry`'s own doc comment:
    "exists here for T08/rendering to use once a candidate is accepted") were both UNCHECKED. Same corpus-wide result
    (0/59 failures today). Added `checkFaithfulness` on both fields in `scoreObjectionSurvivors`'s merge loop. An
    empty `reply` (2/78 raw candidates per T07a's own measurement) passes trivially — `verbatim("", source)` is
    vacuously true — matching `ObjectionEntry`'s documented contract that an empty reply is valid, not a defect.
  **Reject, never repair**, per the task's own instruction: every faithfulness failure `continue`s past that entry in
  the merge loop rather than attempting any fallback/substitution.
  **Counted separately:** added `export const faithfulnessStats = { rejected: number }` (`premises-batch.ts`) —
  incremented by a new `assertFaithful(format, cardId, field, text, card)` helper shared across all three merge
  steps, so T11's report can surface a nonzero faithfulness-rejection count as its own signal rather than folding it
  into `batchStats.failed` (generic batch/parse failures, in `claude.ts`). Every rejection logs via `logger.warn`,
  naming both the card id and the specific field (`... failed faithfulness check on "field": reason — dropped`).
  **Tests** (`premises-batch.test.ts`, new `describe("T09 faithfulness enforcement")` block, 9 new tests): for EACH of
  the three formats — a synthetic hallucinated response (plausible, well-formed, parses cleanly, not present in the
  source card) is rejected and counted (the acceptance criterion); a near-miss (source text with exactly one word
  swapped for a nonsense token) is also rejected — the case a substring/fuzzy check would let through; a faithful,
  verbatim response is admitted and increments nothing. Also updated the pre-existing Wall "not among offered
  candidates" test to use genuinely faithful-but-uncatalogued text (`original_excerpt`) instead of wholly invented
  text, so it still isolates that SECOND defense now that `checkFaithfulness` runs first and would otherwise catch
  the old invented-text fixture before the candidate-membership check ever ran. `npx vitest run` — 567/567 green (558
  baseline + 9 new).
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
