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
- [ ] T02: Implement the **landing-line gate** for The Wall — reuse the T01 self-contained detector against
  `plain_english`; reject any card with no clean standalone sentence to cut to. Acceptance: every surviving entry has
  both a >=80-word original and a named landing line.
- [ ] T03: Implement **visual-archaism ranking** for The Wall. Three deterministic sub-types:
  **Thou Wall (222)** — >=3 of thou/thee/thy/thine/hath/doth/dost/art/shalt/wilt/whither/wherefore/whereby/
  whensoever/perchance/nay/yea; **Cascade (204)** — >=3 semicolons; **Scene (176)** — >=2 quotation marks.
  The remaining ~670 are reserve.
  In the same pass, flag each entry's OPENING ELIGIBILITY — the two numeric openings are not universal. `190 -> 97`
  needs a plain version >=30 words shorter than the original (318 cards qualify), or the countdown barely moves;
  `Grade 14` needs an original grade high enough to be worth showing. Entries failing both can only take the
  standard opening. Acceptance: sub-type counts reproduce, every entry carries its eligible openings, and the
  scheduler can weight by both.
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
