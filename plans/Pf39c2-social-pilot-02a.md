# The Wall — Legible Payoff, Chapter Scroll, and the Framing Layer

## Parent
`plans/Pf39c2-social-pilot-index.md`

## Depends on
- `plans/Pf39c2-social-pilot-02.md` — this refines what 02 built; the encoder, mixer, scheduler gating, counter
  overlay, CLI and house-rule checks all stay as they are

## Objective
Make The Wall actually read as "a wall of archaic text refined into one plain sentence" — by fixing the payoff,
sourcing the wall from the surrounding chapter instead of the single card, and adding a framing layer that names
what the viewer is looking at.

## Why (measured, 2026-08-26, from frames of `social/out/wall-2026-09-05-slot1.mp4`)

Three defects, in order of cost:

1. **The payoff is not a payoff.** `tryReadThroughContent` does `selectLandingLine(card) ?? card.plain_english`.
   When no sentence qualifies, the fallback renders **the whole plain passage** as the "one still sentence" —
   100 words at ~40px, motionless for 12.5s, no rest lines. **18 of 48** read-through cards hit this; **323 of
   1,326** corpus-wide (24.4%), median 105 words, max 179. The format's promise inverts: wall → denser wall.
   (The scored pool path is fine — median landing line 9 words, none over 25. This is read-through only, i.e.
   slot 1 every single day.)
2. **Type-size polarity runs backwards.** Wall type fits 65-91px (mean 80.6); payoff box is 40-88px. The hard
   text is set LARGER and airier than the easy text. Eye reads big→small, sparse→dense. Nothing says *refined*.
3. **The wall reads as a large-print book, not a wall.** Frame 0 is ~18 lines of 3.5 words. Direct consequence
   of the never-finishes invariant: block height scales with the SQUARE of font size, so the only way to buy
   3,170px of travel from a ≤201-word card is to blow the type up. The geometry forces the opposite of the look.

4. **The audio design is inverted, and the cut is silent.** `wallSilentSpans()` spans 0 →
   `WALL_FRAMES + LANDING_LINE_FRAMES`, and `silentSpans` ducks the BED too ("silence means silence, the bed
   included"). Measured on the real render: wall phase **−75.3 dB**, landing line **−76.9 dB**, rest lines
   **−15.2 dB**. So the first **5.5s** of every Wall is dead air (36% of a 15s post), the hard cut carries **no
   audio event at all**, and music arrives to accompany the CALM text. The house rule is "dense, fast,
   unreadable → HARD CUT → still, quiet"; what ships is "silent → nothing → silent → music."

Plus: nothing on screen tells a viewer that the first thing is a 2,000-year-old book or that the second thing is
the same passage rewritten. The product concept is invisible.

## Decisions

- **Never fall back to the whole passage.** No qualifying landing line → the card is not a Wall. It becomes a
  Still (F19's fallback, already built). Enforced in the gate at survey time, with a word-count backstop in the
  composition so a whole-passage payoff can never render again.
- **The wall is sourced from the CHAPTER, not the card.** Frame 0 starts at this card's own excerpt; the block
  continues with the following cards' `original_excerpt` in document order. This is the change that resolves the
  tension plan 02's handoff called unresolvable ("the corpus cannot produce a true wall").
- **CONSTRAINT 6 AMENDMENT (deliberate, recorded here).** The index plan's rule is "any text presented as the
  author's words must be VERBATIM from the card." The scrolling block now draws verbatim text from *adjacent
  cards in the same chapter of the same book by the same author, in document order*. Still verbatim, still
  unfabricated, still correctly attributed by the running head. The payoff — the only text a viewer actually
  reads — remains this card's own. Rule as amended: **verbatim from the card, or from contiguous source text
  surrounding it in the same chapter.**
- **Font size goes back to FIXED, ~44px.** Block height now comes from concatenation, not from magnifying type,
  so the per-card block-height fit (F18) and the `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` gate both DELETE. Measured at
  44px: ~39 chars/line, ~7.1 words/line — a real page of a real book, not large print. Never-finishes needs 412
  words; chapters hold 2,196 (Meditations bk2) to 3,305 (bk3). Constraint stops binding entirely.
- **Scroll rate is expressed in LINES PER SECOND, not px/s.** Perceptually meaningful and decoupled from font
  size. Start at **4.5 lines/s** (≈250px/s at 44px) ≈32 words/s ≈1,900wpm ≈7.5x reading pace. 500px/s at 44px
  would be 9.1 lines/s, which strobes.
- **Framing = running head + payoff label** (user's choice, 2026-08-26). The wall carries a fixed, non-scrolling
  running head; the payoff carries a small label in the same position. Visual grammar becomes **book page → not
  a book page**. Both are FRAMING TEXT under Constraint 6, set apart by every signal `Counter.tsx` already uses:
  DM Sans not Literata, secondary ink `#736B62` not `INK`, small, fixed position. Not a logo, URL or watermark.
- **RETIRE THE OPENING ROTATION ENTIRELY** (user, 2026-08-26). Both numeric openings go, and no third numeral
  replaces them. `grade` first: a reading-grade number is not compelling to a consumer, and it was broken twice
  over — "Grade" rendered unreadably over the archaic text and the numeral read **23**, because Flesch-Kincaid
  explodes on run-on sentences (**191 of 896** pool cards over grade 20, max **65.7**). Then `countdown`, for a
  worse reason than its looks: **"190 → 97" sells compression, and Plain does not sell compression.** Index plan
  rule 4 — never contradict the product; these books are worth reading properly. It is also unrepresentative:
  across the whole pool the plain version is a median **0.86** of the original (a 14% trim) and **44 cards get
  LONGER** in plain English. The ≥30-word gate cherry-picks the 212 cards where compression happens to be
  dramatic (median 0.73), so each numeral is true of its card while the aggregate impression is a claim the
  corpus does not support. Both were also the same 320px accent numeral pinned over the text with no backing
  plate — furniture, which is what the saturated niche looks like.
- **Frame-0 variation moves from OVERLAYS to the TEXT.** See below.
- **Framing text is NEVER narrated.** The voice only ever speaks the author's plain rewrite. Keeps the rule
  clean and avoids "In plain English" becoming a spoken catchphrase.
- **THE CUT MUST BE AUDIBLE.** Bed plays under the scroll, HARD-STOPS on the cut frame, three seconds of true
  silence on the landing line, returns under the rest lines. The cut becomes an audio event and a visual one at
  the same instant — the somatic drop T05 asked for and never got — and the silent opening goes away, which is
  independently worth doing (silent first seconds are a known retention killer on TikTok and Reels). Care
  required: F02's failure mode is the mixer dying on loudnorm when the WHOLE clip measures as silence, so the
  silent span must stay bounded and a first-pass `-inf` measurement must still raise the named error.
- **SHORTEN THE PAYOFF BY PACING, NOT BY REJECTING CARDS.** After the payoff fix the read-through's 30 Walls
  run **p50 26.5s, p75 30s, max 44s**, with up to **11 payoff lines** — eleven hard cuts of centred text over
  ~38s reads as a slideshow. But a line CAP is the wrong lever: capping at 6 lines costs 11 of the 30 Walls and
  pushes the read-through to **60% Stills**, which is worse than the problem. Measured alternatives:

  | line cap | Walls / Stills (of 48) |   | pacing | p50 | p75 | max |
  |---|---|---|---|---|---|---|
  | ≤6 | 19 / 29 |  | 3.5s (today) | 26.5s | 30.0s | 44.0s |
  | ≤7 | 24 / 24 |  | 3.0s | 23.5s | 26.5s | 38.5s |
  | ≤8 | 25 / 23 |  | 2.5s | 20.5s | 23.0s | 33.0s |
  | none | 30 / 18 |  | | | | |

  Decision: drop `DEFAULT_LINE_SECONDS` **3.5 → 3.0** and set a Wall duration ceiling at **40s**, which at that
  pacing rejects **zero** Walls (30/30 kept) while bringing p50 to 23.5s. 2.5s is faster but sits exactly on the
  house rule's 2.5s motionless floor with no margin, and is quick for reading a reflective line. **Caveat to
  carry forward:** once T14's voices land, line duration comes from narration timings, not this fallback — so
  the pacing lever applies only to the music-only case and the 40s ceiling may start rejecting cards then.
- **Still ratio: accept 30 Walls / 18 Stills.** Measured alternatives rejected — see below.

### Still-ratio recommendation (asked 2026-08-26)

Accept it. Measured why the 18 fail: 16/18 have a sentence over the 18-word cap, but **14/18 also hit unresolved
reference**, which no cap change touches. Raising the cap recovers almost nothing and costs payoff quality:

| cap | recovers | result |
|---|---|---|
| 22 | 2 of 18 | 32 Walls / 16 Stills |
| 25 | 3 of 18 | 33 Walls / 15 Stills |
| 30 | 3 of 18 | 33 Walls / 15 Stills |

One recovered line is *"Not just because you get closer to death each day, but because your ability to think
clearly is fading too."* — not self-contained, and it lands on the one beat the whole format exists for. Three
cards is not worth degrading the payoff.

Moving the slice is a bigger call than a geometry change and shouldn't be bundled with one. And the honest
baseline comparison is not 31→30: today only **20 of 48** render a *correct* Wall (11 more render the broken
whole-passage payoff). This plan takes correct Walls **20 → 30**.

Real lever if it still reads as filler after T19: improve landing-line *selection* (an LLM pick, like the pool's
`rubric.chosen_landing_line`, extended to the whole read-through slice) rather than loosening a mechanical
threshold. Recorded as F20, not built here.

### Where frame-0 variation comes from now

T17's rotation existed because "a daily format with an identical frame 0.0 gets filtered by the feed" (index
plan). That pressure is real; the answer is not another overlay. Every numeral treatment is furniture pinned over
the text, and furniture is the saturated niche's visual language. Three textual axes replace it, all cheaper:

1. **Mid-chapter entry (T16)** — frame 0 lands at a different point in the passage each time. Universal, no
   eligibility gate, no overlay, and only possible because of T05's chapter block.
2. **The running head (T11)** — arrives free with the framing layer. Frame 0 for a Seneca post genuinely differs
   from a Marcus one; book and chapter change across the read-through.
3. **Sub-type spacing (T17)** — the index plan already names texture as a variation axis, but
   `scripts/lib/schedule.ts` never reads `sub_types` (confirmed: no reference to it anywhere in the scheduler).
   Pool coverage: `thou_wall` 120, `cascade` 110, `scene` 78, `cascade+thou_wall` 28, `cascade+scene` 13, and 547
   plain-looking reserve. A Cascade and a Scene look visibly unalike at frame 0, so simply not scheduling the
   same sub-type on consecutive days is the honest version of "don't let frame 0 repeat."

Consequence to accept: **plan 03 loses its opening comparison.** `post-metadata.ts` carries an `opening` field
specifically so plan 03 could compare openings; that experiment is cancelled, not deferred. The field goes.

### How narration fits (asked 2026-08-26)

Settled, and mostly already true — this plan's job is to keep it correct under the new shape, not to rebuild it.

| Phase | Audio |
|---|---|
| Wall (scroll) | **Silent.** Index plan: "Do NOT narrate The Wall in v1 — fast TTS mangles archaic spellings and proper nouns." Music bed only. |
| Landing line (3s) | **Silent.** The beat of silence IS the drop — house rule. |
| Rest lines | **Narrated**, line-level timings from native provider data (T13). |
| Running head / payoff label / counter | **Never narrated.** |

Status: fully wired (`narrationPlan`, `wallSilentSpans`, `timing.ts`, `mix.ts`) and blocked only on **T14**, which
needs an `ELEVENLABS_API_KEY` and a human auditioning three voices — not unblockable here. What this plan does add:
the payoff fix means every Wall now has a real landing line, so the narrated-lines set changes; and **F04** (The
Question and The Objection don't accept `narrationTimings`, so real narration can drift against their fixed holds)
is fixable now against recorded fixtures without live voices, so it comes in here.

## Files
- `scripts/lib/schedule.ts` — drop the `?? card.plain_english` fallback; route landing-line-less cards to Still
- `social/src/remotion/wall-gate.ts` — add the landing-line requirement; delete `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`
- `social/src/remotion/wall-timing.ts` — fixed font size, lines/sec rate, delete `fitWallFontSize` block-height fit
- `social/src/render/chapter-text.ts` — NEW: builds the scrolling block from the chapter
- `social/src/remotion/SourceHead.tsx` — NEW: running head + payoff label
- `social/src/remotion/Wall.tsx`, `Question.tsx`, `Objection.tsx`, `Still.tsx` — consume the framing layer
- `social/src/remotion/question-timing.ts`, `objection-timing.ts` — accept `narrationTimings` (F04)
- `social/src/remotion/wall-openings.ts` — DELETED; `Wall.tsx` loses `WallOpeningBadge` and the `opening` prop
- `scripts/lib/premises.ts`, `content/social/premises/wall.json` — drop `eligible_openings` entirely
- `social/src/render/post-metadata.ts` — drop the `opening` field
- `scripts/lib/schedule.ts` — space consecutive Wall slots by `sub_types`
- `plans/Pf39c2-social-pilot-index.md` — amend the opening-rotation paragraph (three-way → two-way)
- `social/src/audio/mix.ts`, `social/src/cli.ts` — `wallSilentSpans` becomes landing-line-only; bed under the scroll
- `social/src/cli.ts` — pass chapter block + framing props
- `social/scripts/write-exclusions.ts`, `content/social/render-exclusions.json` — regenerate
- tests alongside each

## Constraints
- **THE HOUSE RULE holds unchanged.** No overshoot easing anywhere; payoff frame motionless ≥2.5s; TTS pitch and
  rate never below default. The running head is fixed and the payoff label is static — neither introduces motion.
- **No logo, URL or watermark in frame.** The running head names the *book*, never Plain.
- Framing text must be visually distinct from quoted content, factually true, and not attributed to the author.
- Duration floor 15s / ceiling 59s still applies. The payoff fix changes line counts, so the ceiling must be
  re-measured, not assumed.
- Palette from `docs/BRANDING.md`. Framing text at secondary `#736B62`, DM Sans — never an accent colour, which
  would read as branding.
- `social/src/remotion/landing-line.ts` must stay behaviourally identical to `scripts/lib/premises.ts`. If one
  changes, change both (no automated sync check exists).

## Tasks

- [x] T01: Test the landing-line requirement — `social/src/remotion/__tests__/wall-gate.test.ts`. A card whose
  `plain_english` yields no qualifying landing line is REJECTED by the gate; a card whose landing line exceeds a
  named max-words backstop is rejected by the composition. Acceptance: both fail against today's implementation.
  Done: added a `describe('gateWallCard — the landing-line requirement (T02, not yet implemented)', ...)` block
  (constant-existence check for a new `WALL_LANDING_LINE_MAX_WORDS` export, a `gateWallCard` rejection test using a
  synthetic no-terminal-punctuation `plainEnglish` fixture sanity-checked against `landing-line.ts`'s own
  `selectLandingLine`, and an `assertWallCardRenderable` throw test), plus one new composition-level test in the
  existing `'the composition path surfaces the rejection (T06 wiring)'` block (`selectComposition` with a 45-word
  `landingLine`). All 4 new tests fail against today's implementation (confirmed via `npx vitest run
  src/remotion/__tests__/wall-gate.test.ts`); all 17 pre-existing tests in the file still pass. Named the new
  `WallGateResult.failure` variant `'landingLine'` and the backstop constant `WALL_LANDING_LINE_MAX_WORDS` —
  T02/T03's implementer should either match these names or update the tests alongside the implementation.
- [x] T02: Remove the whole-passage fallback — `scripts/lib/schedule.ts` (`tryReadThroughContent`),
  `social/src/remotion/wall-gate.ts`, `Wall.tsx`. No qualifying landing line → not a Wall → Still. Acceptance:
  T01 passes; `meditations-02-005` no longer renders as a Wall.
  Done: `tryReadThroughContent`'s wall branch now returns `null` (not `landing_line: card.plain_english`) when
  `selectLandingLine(card)` is `null`, routing the card through `resolveReadThrough`'s existing fallback cascade
  to Question/Objection/Still exactly like an unsupported candidate already does. `wall-gate.ts` gained the
  landing-line requirement T01 specified: a new `'landingLine'` `WallGateResult.failure` variant, an optional
  `plainEnglish` field on `WallGateContentInput` (rejects when `selectLandingLine` finds nothing), and an optional
  `landingLine` field checked against a new exported `WALL_LANDING_LINE_MAX_WORDS` (30) backstop. Wired the
  backstop into both call sites that build the actual composition: `Root.tsx`'s `calculateMetadata` (the
  `selectComposition`-time gate, needed for T01's `'selectComposition throws for a landingLine over the named
  max-words backstop'` test — not in the plan's file list but required for that test to pass) and `Wall.tsx`'s
  own render-time `assertWallCardRenderable` call, both now pass `landingLine: props.landingLine` through.
  `social/src/remotion/wall-pool.ts`'s `WallPoolRejection.axis` type was widened to include `'landingLine'` to
  keep `tsc --noEmit` clean (unreachable via that survey today — it never passes `plainEnglish`/`landingLine` to
  `gateWallCard` — but the type must stay in sync with `WallGateResult['failure']`).
  Verified: all 21 `wall-gate.test.ts` tests pass (the T01 block's title updated to drop "not yet implemented").
  A direct `generateWeek` run forcing every day's weighted draw to Wall confirms `meditations-02-005` now resolves
  to `format: "still"` (verbatim `plain_english`), not `wall`. All 123 pre-existing `scripts/lib/__tests__/
  schedule.test.ts` tests pass after updating 4 that had baked in the old fallback as correct behavior (2
  read-through-format tests updated to handle/expect the now-reachable Still branch and a working `readThroughStartIndex`
  for a forced "wall" override; the F19 "normal card" test switched from `meditations-02-002` to
  `meditations-02-004`, since -002 itself has no qualifying landing line in the real corpus; the M14 empty-reply
  fixture gained a leading sentence so it has a real landing line, preserving that test's original "falls back to
  Wall" intent instead of degrading to "falls back to Still"). `social/tsc --noEmit` is clean.
  Fix pass (2026-08-26): the one failure above (`social/src/__tests__/cli.test.ts`'s `'produces a
  house-profile-conformant MP4 (15s-59s)...'` e2e test, `result.status` 1) was resolved by regenerating the
  committed schedule per the plan's Verify block: `npx tsx scripts/generate-schedule.ts --week 1 --seed 42
  --first-week --force`. This re-ran `tryReadThroughContent`/`resolveReadThrough` against the real corpus under
  the new rule, so `content/social/pilot-schedule-w01.json` now routes both `meditations-02-002` (day 2/slot 1)
  and `meditations-02-005` (day 3/slot 1) — the two read-through cards whose old `landing_line` equalled the
  whole `plain_english` passage — to `format: "still"` instead of `wall`. `format_counts` moved from `wall: 6,
  still: 4` to `wall: 4, still: 6`; no other slot changed. This left `cli.test.ts`'s e2e Wall test pointed at a
  slot that was no longer a Wall, so it was retargeted to day 6/slot 1 (`meditations-02-006`), which the file's
  own `computeWallPlainLines` tests already documented as "a real Wall read-through slot ... whose landing line
  is a real (non-whole-passage) substring." No test assertions were loosened and `WALL_LANDING_LINE_MAX_WORDS`
  is unchanged (30). Verified: `social/src/__tests__/cli.test.ts` 25/25,
  `social/src/remotion/__tests__/wall-gate.test.ts` 21/21, `scripts/lib/__tests__/schedule.test.ts` 123/123 (run
  from repo root), and the full `social/` suite 496/496. `content/social/render-exclusions.json` was left
  untouched, as directed — T04 regenerates it after T03's duration ceiling lands, and T20 regenerates week 1
  again in full once T05-T12's geometry changes land, so further churn to `pilot-schedule-w01.json` here is
  expected and fine.
- [ ] T03: Shorten the payoff — `social/src/remotion/wall-timing.ts` + `wall-gate.ts`. Drop
  `DEFAULT_LINE_SECONDS` 3.5 → 3.0 and add a named Wall duration ceiling of 40s to the gate (a card over it is
  REJECTED, never truncated mid-passage). Acceptance: the read-through slice keeps all 30 Walls; p50 duration
  drops to ~23.5s and max to ~38.5s; the existing 59s global ceiling still applies independently; every payoff
  line still holds ≥2.5s per the house rule.
- [ ] T04: Regenerate `content/social/render-exclusions.json` and report the supply shift per pool — this now
  measures T02's payoff fix AND T03's duration ceiling together. Acceptance: read-through slice reports 30 Wall /
  18 Still (T03 is calibrated to cost nothing); the artifact's per-pool counts move and are recorded here.
- [ ] T05: Test the chapter-text loader — `social/src/render/__tests__/chapter-text.test.ts`. Block starts at the
  target card's excerpt; continues with following cards in document order; wraps to preceding cards at chapter
  end; returns enough text to clear the travel requirement for every card in the slice; text is verbatim and
  unmodified. Acceptance: fails against an empty implementation.
- [ ] T06: Implement `social/src/render/chapter-text.ts`. Acceptance: T04 passes.
- [ ] T07: Test the new wall geometry — `social/src/remotion/__tests__/wall-timing.test.ts`. Fixed font size;
  rate expressed in lines/sec; scroll never finishes before the cut (now by construction, not by gate); frame-0
  velocity is already full; no card in the corpus is rejected for block height. Acceptance: fails against the
  F18 per-card fit.
- [ ] T08: Rewrite the geometry in `wall-timing.ts` — fixed `WALL_FONT_SIZE` (~44px), `WALL_SCROLL_LINES_PER_SEC`
  (~4.5), delete `fitWallFontSize`'s block-height target, `WALL_TARGET_BLOCK_HEIGHT_PX`, `WALL_FONT_FLOOR_PX`/
  `CAP_PX` and `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`. Acceptance: T06 passes.
- [ ] T09: Wire `Wall.tsx` to render the chapter block. Acceptance: renders from a real card; frame 0 shows the
  card's own first words at the top of the frame; the block is continuous verbatim chapter text below it.
- [ ] T10: Fix the payoff polarity — the payoff must be set LARGER than the wall. Raise `PAYOFF_MIN_FONT` above
  `WALL_FONT_SIZE` and assert the relationship as a test, not a coincidence. Acceptance: a test fails if wall
  type is ever ≥ payoff type.
- [ ] T11: Test the framing layer — `social/src/remotion/__tests__/source-head.test.ts`. Running head is fixed
  (identical at every wall frame); payoff label sits in the same position; neither collides with or reflows the
  read-through counter (retarget `counter.test.ts`'s pixel-level proof); both use DM Sans + secondary ink, never
  `SERIF_STACK` and never an accent. Acceptance: fails against an empty implementation.
- [ ] T12: Implement `SourceHead.tsx` and wire into `Wall.tsx` — running head `"MARCUS AURELIUS · MEDITATIONS,
  BOOK 2"` from card metadata (never hardcoded), payoff label `"In plain English"`. Acceptance: T10 passes.
- [ ] T13: Extend the framing layer to `Question.tsx`, `Objection.tsx` and `Still.tsx` so the channel reads as one
  product. Acceptance: all four compositions carry it; plan 02's house-rule checks still pass on all four.
- [ ] T14: Assert the narration contract under the new shape —
  `social/src/audio/__tests__/narration.test.ts`. the landing line ALONE is in `wallSilentSpans` (the scroll now carries the bed); rest
  lines are the only narrated set; framing text never reaches `synthesize`; a Wall whose `plain_english` is a
  single sentence (no rest lines) still produces a valid, non-silent mix. Acceptance: tests pass with voices
  still unset, using recorded fixtures.
- [ ] T15: Make the cut audible — `social/src/audio/mix.ts`, `wallSilentSpans` in `social/src/cli.ts`.
  The bed plays under the scroll at nominal level, hard-stops on the cut frame, stays at `SILENCE_FLOOR_DB` for
  the landing line only, and returns under the rest lines. Acceptance: `volumedetect` on a rendered Wall shows
  audible level across 0-2.5s, floor across 2.5-5.5s, audible after; F02's named non-finite-loudnorm error still
  raises rather than surfacing raw ffmpeg output; `bedEnvelope` stays a pure, deterministic function of its
  inputs.
- [ ] T16: F04 — make `question-timing.ts` and `objection-timing.ts` accept `narrationTimings` so their holds
  follow real narration instead of fixed frames, matching `computeWallTiming`. Acceptance: a drifted timing set
  moves the on-screen line boundaries; `assertNarrationInSync` still gates.
- [ ] T17: Retire the opening rotation — DELETE `social/src/remotion/wall-openings.ts` outright, along with
  `Wall.tsx`'s `opening`/`eligibleOpenings` props and `WallOpeningBadge`, `scripts/lib/premises.ts`'s
  `eligibleWallOpenings`, the `eligible_openings` field in a regenerated `content/social/premises/wall.json`,
  `chooseWallOpening` in `social/src/cli.ts`, and the `opening` field in `social/src/render/post-metadata.ts`.
  Amend the index plan's opening-rotation paragraph and plan 03's opening comparison. Acceptance: no numeral can
  be rendered over the wall in any composition; `npm test` green with the opening tests DELETED, not skipped.
- [ ] T18: Mid-chapter entry — vary frame 0's start point within the chapter block so consecutive posts do not
  open on the same beat, deriving the offset deterministically from the post index (never randomly — renders must
  be reproducible). Frame 0 must still be legible text mid-thought, never mid-word. Acceptance: two posts from
  the same card open at different points; the never-finishes invariant still holds at every offset.
- [ ] T19: Sub-type spacing in the scheduler — `scripts/lib/schedule.ts` currently never reads `sub_types`. Space
  consecutive Wall slots so the same sub-type does not run on consecutive days where the pool allows it, and
  report when it cannot. Acceptance: a generated week shows no back-to-back repeat of `thou_wall`/`cascade`/
  `scene`; the read-through's card order is NEVER reordered to achieve it (it walks the book in order).
- [ ] T20: Regenerate week 1 and render all 14 posts; re-measure durations against the 15s/59s bounds and record
  the new Wall/Question/Objection/Still mix in this file. Acceptance: all 14 render; ffprobe confirms the profile;
  frames extracted at 0.0s / mid-scroll / cut / payoff show the intended reduction. Then T19's phone review.

## Verify
```
npm test
npx tsx social/scripts/write-exclusions.ts --date 2026-08-26
npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force
for d in 01 02 03 04 05 06 07; do for s in 1 2; do npx tsx social/src/cli.ts render --date 2026-09-$d --slot $s; done; done
ffprobe -v error -show_streams social/out/*.mp4
```

## Follow-up
- [ ] F20: If the 18 Stills read as filler after T19's phone review, recover Walls by improving landing-line
  SELECTION (an LLM pick like the pool's `rubric.chosen_landing_line`, extended to the whole read-through slice)
  rather than by loosening the mechanical word cap — measured above as buying 3 cards at the cost of payoff
  quality. Only 21 of the 48 slice cards are in the scored pool today.
