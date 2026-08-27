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
- `plans/Pf39c2-social-pilot-index.md` — amend the opening-rotation paragraph to record full retirement (not a
  two-way rotation — the rotation is gone outright, no numeral replaces it)
- `plans/Pf39c2-social-pilot-03.md` — record the opening comparison as CANCELLED, not deferred
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
- [x] T03: Shorten the payoff — `social/src/remotion/wall-timing.ts` + `wall-gate.ts`. Drop
  `DEFAULT_LINE_SECONDS` 3.5 → 3.0 and add a named Wall duration ceiling of 40s to the gate (a card over it is
  REJECTED, never truncated mid-passage). Acceptance: the read-through slice keeps all 30 Walls; p50 duration
  drops to ~23.5s and max to ~38.5s; the existing 59s global ceiling still applies independently; every payoff
  line still holds ≥2.5s per the house rule.
  Done: `wall-timing.ts`'s `DEFAULT_LINE_SECONDS` is now `3.0` (was `3.5`), `DEFAULT_LINE_FRAMES` unchanged in
  form (still derived from it). `wall-gate.ts` gained `WALL_MAX_DURATION_SECONDS` (40) / `WALL_MAX_DURATION_FRAMES`
  (1200), checked in `gateWallCard` AFTER the existing 59s (`MAX_POST_DURATION_FRAMES`) check so a card already
  over 59s still reports against that ceiling's own number — reuses the existing `'duration'` failure variant
  (extended, not duplicated, per the task brief) rather than adding a new one; the reason string names which
  ceiling actually bound. Tests added: `wall-timing.test.ts` gained a `DEFAULT_LINE_SECONDS` pacing block (value,
  derivation, and the ≥2.5s house-rule floor with margin, both on the constant and on a real schedule's rest
  lines); `wall-gate.test.ts` gained a `WALL_MAX_DURATION_SECONDS`-ceiling block (rejects a synthetic 12-rest-line
  card that crosses 40s but stays under 59s; a synthetic 18-line card that crosses BOTH ceilings still reports the
  shared 59s one; an 11-line card just under 40s still passes) and updated the pre-existing F03 real-card duration
  test, whose exact card (`on-anger-03-027`) now lands at 1605 frames/53.5s at the new pacing — under 59s but over
  the new 40s ceiling, so it's still correctly rejected, just via the other axis (updated assertions/comments to
  match, not weakened).
  MEASURED on the real read-through slice (Meditations Books 2-3, 48 cards, using the CURRENT, T02-correct
  `selectLandingLine` — no whole-passage fallback — and the full `gateWallCard` check incl. `plainEnglish`/
  `landingLine`, via a throwaway script): **16 Wall / 32 Still**, not the predicted 30/18. All 32 non-Wall cards
  are non-Wall for reasons T03 does not touch — 18 have no qualifying landing line at all (T02's fix, already
  landed before this task started) and 14 fail the pre-existing travel floor (F16/F18, unrelated to pacing). This
  same split (16/32, travel=14) is IDENTICAL whether measured at pre-T03 constants (3.5s/no 40s ceiling) or
  post-T03 constants (3.0s/40s ceiling) — confirmed by temporarily stashing this task's `wall-gate.ts`/
  `wall-timing.ts` edits and re-running the same script. So the "30 Walls" acceptance figure is stale: it appears
  to predate T02's landing-line fix landing on this branch, not something T03 introduces or can restore (T03 was
  never supposed to change WHICH cards qualify as Wall, only how long the ones that do qualify run). What T03
  actually measures on its own axis, isolating the pacing/ceiling change: of the 16 real Wall-eligible cards,
  duration seconds went from p50 30.0/p75 37.0/max 44.0 (pre-T03: 3.5s pacing, no 40s ceiling) to **p50 26.5/p75
  32.5/max 38.5** (post-T03) — the predicted ~3.5-6s drop in shape, and zero of the 16 rejected by the new 40s
  ceiling (max 38.5s stays under it), matching "the pacing lever costs nothing" for this slice specifically.
  Follow-up for T04: (1) its own "30 Wall / 18 Still" acceptance target needs re-deriving against the real,
  T02-inclusive baseline (16/32 measured here), not the pre-T02 number this plan was written against; (2)
  `social/scripts/write-exclusions.ts`'s `surveyReadThrough` (and `social/src/remotion/__tests__/exclusions.test.ts`'s
  matching re-derivation) still use the PRE-T02 `selectLandingLine(plainEnglish) ?? plainEnglish` fallback and
  never pass `plainEnglish`/`landingLine` into `gateWallCard` — both should be updated to the real, no-fallback
  derivation `scripts/lib/schedule.ts`'s `tryReadThroughContent` actually uses, or the committed `read_through`
  section keeps under/over-reporting Wall eligibility relative to what the scheduler really produces.
  Verified: `content/social/render-exclusions.json` DID need regenerating as part of this task (not deferred to
  T04) — T03's constants change `surveyWallPool`'s own duration axis over the full 896-entry Wall pool (real
  `plainLines`, unlike the read-through slice's own bespoke check), so the committed artifact went stale
  immediately (`gateWallCard`'s `WALL_MAX_DURATION_FRAMES`-check is model, not read-through-specific); regenerated
  via `npx tsx social/scripts/write-exclusions.ts --date 2026-08-26` (same date, so only the counts/ids moved, not
  the file's shape) — Wall pool duration rejections moved from 59/896 to 207/896 (travel rejections unchanged at
  175/896), a real, expected cost of the stricter 40s ceiling against the full pool's much longer tail of
  passages, distinct from the read-through slice's own zero-cost result above. `cd social && npm test`: 506/506
  (496 + 10 new). `npx vitest run scripts/lib/__tests__/schedule.test.ts` (repo root): 123/123, unaffected by any
  of the above. `content/social/pilot-schedule-w01.json` was left untouched (not needed to keep any test green —
  T20 regenerates it regardless).
- [x] T04: Regenerate `content/social/render-exclusions.json` and report the supply shift per pool — this now
  measures T02's payoff fix AND T03's duration ceiling together. Acceptance: read-through slice reports 30 Wall /
  18 Still (T03 is calibrated to cost nothing); the artifact's per-pool counts move and are recorded here.
  Note (T03, 2026-08-26): `render-exclusions.json` was ALREADY regenerated by T03 (it had to be, to keep
  `exclusions.test.ts` green against the Wall pool's own duration axis — see T03's own note). T04's real remaining
  work is narrower than originally scoped: re-verify/report the read-through slice's actual Wall/Still split
  against the real, T02-inclusive baseline (measured at 16/32, not 30/18 — see T03's note for the measurement
  method and the two staleness bugs in `write-exclusions.ts`/`exclusions.test.ts` this uncovered) rather than
  re-deriving a figure this plan's own "30/18" acceptance target assumed.
  Done (2026-08-26): fixed the two staleness bugs T03 flagged. `social/scripts/write-exclusions.ts`'s
  `surveyReadThrough` no longer computes `selectLandingLine(plainEnglish) ?? plainEnglish` — it now calls
  `selectLandingLine(plainEnglish)` with no fallback, and a `null` result is recorded directly as a `'landingLine'`
  rejection (mirroring `scripts/lib/schedule.ts`'s `tryReadThroughContent`, which returns `null` before ever
  consulting the travel/duration gate for such a card); when a landing line DOES exist, `gateWallCard` is now
  called with `plainEnglish`/`landingLine` (previously omitted) in addition to `plainLines`. Made the identical fix
  to `social/src/remotion/__tests__/exclusions.test.ts`'s independent re-derivation (both the "wrongfully
  permitted" and "committed exclusion is verified" assertions), factored into one shared `rederiveOk` helper so the
  two assertions can't drift from each other again.
  MEASURED (regenerated via `npx tsx social/scripts/write-exclusions.ts --date 2026-08-26`): the read-through
  slice's `meta.read_through` moved from `{ submitted: 48, succeeded: 26, dropped: 22 }` (stale, buggy fallback) to
  **`{ submitted: 48, succeeded: 16, dropped: 32 }`** — i.e. **16 Wall / 32 Still**, exactly matching T03's
  independently-measured figure via its own throwaway script. Reason breakdown of the 32 non-Wall cards (by
  `axis`): **18 `landingLine`** (no qualifying landing line at all — T02's intended fix, correctly excluding cards
  the old buggy fallback had wrongly let through or misclassified) and **14 `travel`** (pre-existing
  `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` floor, unrelated to T02/T03/T04 — T08 is scheduled to delete this floor once
  the chapter-sourced block lands). Zero `duration` rejections in the read-through slice (T03's ceiling costs
  nothing here, confirmed again). Diff detail: comparing the before/after `read_through` entry lists, no
  previously-excluded card became includable (monotonic tightening, not a behavior swing) — 22 of the old 22
  travel-axis ids persist (8 of them RE-axised from `travel` to `landingLine`, since the old fallback's
  `landingLine = plainEnglish` made `computeWallPlainLines` return an empty `plainLines`, so the buggy survey only
  ever reached the travel check and never noticed the real landing-line failure underneath it), and 10 entirely new
  ids are excluded that the old bug had wrongly counted as passing Wall (`meditations-02-002`, `-02-005`,
  `-02-009`, `-03-001`, `-03-009`, `-03-010`, `-03-015`, `-03-017`, `-03-022`, `-03-028`).
  Per-pool counts elsewhere in the artifact (Wall/Question/Objection/Still) are BYTE-IDENTICAL before/after this
  task — `surveyWall`/`surveyQuestion`/`surveyObjection`/`surveyStill` were never touched, only `surveyReadThrough`,
  so this task's supply shift is isolated entirely to the `read_through` section, as expected: Wall
  `{896 submitted, 514 succeeded, 382 dropped}`, Question `{88, 37, 51}`, Objection `{59, 27, 32}`, Still `{48, 48,
  0}` — unchanged in both the before and after artifact.
  **The plan's "30 Wall / 18 Still" acceptance target is confirmed a POST-T08 figure, not a target this task could
  or should chase** — T08 deletes `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` once the chapter-sourced block lands, which
  would recover the 14 travel-axis rejections (16 + 14 = 30, matching the plan's arithmetic exactly); the 18
  `landingLine` failures are untouched by T08 and stay Still under the plan's own "no whole-passage fallback"
  decision. T20 (regenerate week 1 in full once T05-T12 land) is the right point to re-measure 30/18 for real.
  `content/social/pilot-schedule-w01.json` did NOT need regenerating: cross-checked its 7 read-through slot-1 cards
  (`meditations-02-001` through `-02-007`) against both the before and after `read_through` exclusion lists — the
  committed schedule already resolves `meditations-02-002`/`-02-005` to `format: "still"` (T02's own direct,
  independent `selectLandingLine` check inside `scripts/lib/schedule.ts`, not this artifact, already caught them
  correctly before this task ran), and none of the 10 newly-excluded ids appear anywhere in week 1's schedule, so no
  slot's format assignment changes.
  Verified: `cd social && npm test` — 506/506 (unchanged test count; only assertions inside `exclusions.test.ts`
  were rewritten, none added or removed, and all still pass against the regenerated artifact). `npx vitest run
  scripts/lib/__tests__/schedule.test.ts` (repo root) — 123/123, unaffected (confirms the schedule generator's own
  landing-line logic was never the buggy code path; only the reporting artifact was stale).
- [x] T05: Test the chapter-text loader — `social/src/render/__tests__/chapter-text.test.ts`. Block starts at the
  target card's excerpt; continues with following cards in document order; wraps to preceding cards at chapter
  end; returns enough text to clear the travel requirement for every card in the slice; text is verbatim and
  unmodified. Acceptance: fails against an empty implementation.
  Done (2026-08-26): added `social/src/render/chapter-text.ts` as an empty stub — two exports,
  `buildChapterTextBlock(targetCardId, bookCards)` (pure) and `loadChapterTextBlock(bookSlug, cardId, outputDir?)`
  (disk-backed convenience over `wall-pool.ts`'s `loadBookCards`), both throwing `"...is not implemented yet
  (social pilot 02a T06)"`, plus a `ChapterTextCard` interface (`id`/`book_slug`/`chapter_slug`/`card_number`/
  `original_excerpt`) — the minimal shape T06 needs, kept separate from `wall-pool.ts`'s `OutputCard` so a
  synthetic test fixture doesn't have to fabricate every field `OutputCard`'s index signature allows. Chose a
  concrete design for T06 to match or amend: `buildChapterTextBlock` filters `bookCards` internally to the target
  card's own `book_slug` + `chapter_slug` (so callers can safely pass a whole book's cards, e.g. `loadBookCards`'s
  output, covering two different read-through chapters from one call), sorts by `card_number`, and returns ONE
  FULL LAP of that chapter starting at the target card and wrapping around — chosen over a length-driven partial
  block because it's simplest, always satisfies the travel requirement by a wide margin (a chapter's total excerpt
  word count, 2,196-3,305 for Meditations Books 2-3, dwarfs anything a 2.5-3s scroll could need), and needs no
  extra parameter this task shouldn't be inventing ahead of T07/T08's real geometry numbers.
  Added `social/src/render/__tests__/chapter-text.test.ts` (15 tests): a synthetic 5-card chapter (plus decoy
  cards from a different chapter and a different book, in the same `bookCards` array) proves start position,
  follow-order, wrap-around, chapter/book scoping, both chapter-boundary edge cases (starting from the first card
  and the last card), a single-card-chapter edge case, and the not-found-id throw; a real-corpus block (Meditations
  Books 2-3, loaded via `loadBookCards`) proves the same properties against real data, that `loadChapterTextBlock`
  agrees with `buildChapterTextBlock` over the same cards, and — the acceptance criterion the plan singles out —
  that all 48 real read-through slice cards clear `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` (`wall-gate.ts`, the CURRENT,
  not-yet-deleted travel constant) once `computeWallLayout` (`wall-timing.ts`) is run against their chapter block
  instead of their own excerpt alone. All order/verbatim assertions go through one shared helper,
  `expectExactExcerptSequence(block, excerpts)`, which strips each expected excerpt off the front of the block in
  order and requires everything in between and after to be pure whitespace — a single assertion that catches a
  wrong start point, a skipped or reordered excerpt, a wrap into the wrong chapter, or any fabricated/paraphrased
  text, all at once.
  One incidental fix needed to make the real-corpus tests type-check: `wall-pool.ts`'s `OutputCard` interface
  didn't type `chapter_slug`/`card_number` explicitly (only reachable via its `[key: string]: unknown` index
  signature), which made `loadBookCards`'s return type incompatible with `ChapterTextCard[]`. Verified every card
  across the entire `content/output/` corpus really does carry `chapter_slug: string` and `card_number: number`
  (a Python sweep, zero mismatches), then added both fields to `OutputCard` explicitly — additive only, every
  existing access pattern (e.g. `exclusions.test.ts`'s `String(c.chapter_slug)`) still type-checks unchanged.
  Verified: `npx vitest run src/render/__tests__/chapter-text.test.ts` — 13 of 15 fail against the empty stub
  (exactly the tests that call `buildChapterTextBlock`/`loadChapterTextBlock`); the 2 that pass don't exercise the
  unimplemented behavior (a card-count sanity check on the real slice, and the not-found-id throw, which the stub
  already satisfies by throwing unconditionally) — this is the acceptance criterion, not a partial failure.
  `npx tsc --noEmit` clean. `cd social && npm test` — 26 of 27 test files pass, 508 of 521 individual tests pass
  (the 13 new failures are this task's own, expected ones; zero regressions in the other 508 pre-existing tests).
- [x] T06: Implement `social/src/render/chapter-text.ts`. Acceptance: T04 passes.
  Done (2026-08-26): implemented `buildChapterTextBlock` and `loadChapterTextBlock` exactly to T05's recorded
  design — no amendment needed. `buildChapterTextBlock` finds the target card by id (throws if absent), filters
  `bookCards` to that card's own `book_slug` + `chapter_slug`, sorts by `card_number`, rotates the sorted array so
  the target card is first (`[...slice(targetIndex), ...slice(0, targetIndex)]` — one full lap starting at the
  target and wrapping to the chapter's own earlier cards), and joins each card's `original_excerpt` verbatim with
  `'\n\n'` — nothing else touches the text. `loadChapterTextBlock` is a thin disk-backed wrapper: `loadBookCards`
  (`wall-pool.ts`) then `buildChapterTextBlock`.
  Verified: `npx vitest run src/render/__tests__/chapter-text.test.ts` — 15/15 pass. `cd social && npm test` —
  27/27 test files, 521/521 tests pass (up from 508/521 pre-T06; the 13 tests T05 left failing now pass, zero
  regressions elsewhere). `npx tsc --noEmit` clean.
- [x] T07: Test the new wall geometry — `social/src/remotion/__tests__/wall-timing.test.ts`. Fixed font size;
  rate expressed in lines/sec; scroll never finishes before the cut (now by construction, not by gate); frame-0
  velocity is already full; no card in the corpus is rejected for block height. Acceptance: fails against the
  F18 per-card fit.
  Done (2026-08-26): added 13 new tests in 5 describe blocks, TDD-style, against `wall-timing.ts` as it stands
  today (F18's per-card fit). Confirmed empirically that a named ESM import of an export that does not exist
  (`WALL_FONT_SIZE`, `WALL_SCROLL_LINES_PER_SEC`) resolves to `undefined` in this project's Vitest/esbuild
  transform rather than throwing a module error — so a behavioral failure on those names wouldn't crash the file
  — but `npx tsc --noEmit` DOES treat it as a hard compile error (`TS2724`), which the task's own instructions
  anticipate ("adding a minimal stub export...acceptable ONLY if unavoidable"). Added two minimal, deliberately
  INERT stub exports to `wall-timing.ts` for exactly that reason — `WALL_FONT_SIZE = 44` and
  `WALL_SCROLL_LINES_PER_SEC = 4.5`, read by nothing else in the module (not wired into `fitWallFontSize`,
  `computeWallLayout`, or `WALL_SCROLL_RATE_PX_PER_SEC` — that wiring is T08's job), so their mere presence
  changes no existing behavior.
  4 of the 13 new tests genuinely FAIL today (the task's own acceptance criterion), all on BEHAVIOR, not on the
  stub's mere existence: `computeWallLayout` still returns a per-card-fitted size (92px for a short synthetic
  excerpt, 77px for the 150-word fixture, 72px for the 201-word longest-pool excerpt) instead of the fixed
  `WALL_FONT_SIZE` (44px) on every one of them (2 tests); `WALL_SCROLL_RATE_PX_PER_SEC` is still F16's bare
  500px/s constant, not `WALL_SCROLL_LINES_PER_SEC * WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO` (247.5px/s) or
  anything else derived from the lines/sec constant (2 tests). The remaining 9 new tests already pass today
  (2 trivial "is WALL_FONT_SIZE/WALL_SCROLL_LINES_PER_SEC defined and in the plan's ~44px/~4.5 range" checks,
  now true only because of the stub's own chosen value; 7 genuine forward-looking regression guards that must
  keep passing after T08 lands): frame-0 velocity is already at full rate with no ramp (the offset formula is
  rate-agnostic, so this holds regardless of what T08 does to the rate's value); every one of the 48 read-through
  slice cards' CHAPTER-sourced block (T06) already outruns the wall phase without any per-card rejection; and the
  14 real cards T04 measured failing the travel axis on their OWN single-card excerpt (verified they still do, on
  that same excerpt, today) all clear `computeWallLayout.fits` once sourced from their chapter instead — proving
  the "no card rejected for block height" claim is already earned by T06's chapter-sourcing, not something T08
  still needs to invent.
  All 37 pre-existing tests in this file are unaffected (still pass, unchanged) — the new failures are isolated,
  ordinary assertion failures in their own `it` blocks.
  T08 will need to delete or rewrite several PRE-EXISTING tests in this same file that assert F18's per-card-fit
  behavior directly (not touched here, per this task's scope): the "block geometry at F18 numbers" describe (3
  tests asserting fontSize 77/72px and per-card-search bounds), both "fitWallFontSize — a short/long excerpt..."
  describes (2 tests asserting the now-to-be-deleted target/floor/cap clamp behavior), and the single assertion
  `expect(travelFloor).toBe(3170)` inside "the scroll does not finish before the cut" (the 3170px figure is
  `FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS` at F16/F18's 500px/s rate — T08's ~250px/s rate
  changes this number, though the surrounding "still clears the floor" logic stays valid). Outside this file,
  `wall-gate.test.ts` also has extensive coverage of `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`/`WALL_FONT_CAP_PX`/the
  travel-rejection path that T08 (deleting `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` per its own acceptance criterion)
  will need to touch too — out of scope for T07's file, flagged here for T08.
  Verified: `npx tsc --noEmit` clean. `npx vitest run src/remotion/__tests__/wall-timing.test.ts` — 50 tests, 4
  failed (the new behavioral ones, as intended), 46 passed (37 pre-existing + 9 new: 2 trivial stub-existence
  checks + 7 forward-looking guards) — zero regressions.
- [x] T08: Rewrite the geometry in `wall-timing.ts` — fixed `WALL_FONT_SIZE` (~44px), `WALL_SCROLL_LINES_PER_SEC`
  (~4.5), delete `fitWallFontSize`'s block-height target, `WALL_TARGET_BLOCK_HEIGHT_PX`, `WALL_FONT_FLOOR_PX`/
  `CAP_PX` and `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX`. Acceptance: T07's geometry tests pass (the plan's own "Acceptance:
  T06 passes" was a typo for T07 — T06 is the chapter-text loader, already landed; T07 is the geometry test file
  this task's acceptance criterion actually targets).
  Done (2026-08-26): `wall-timing.ts` wires `WALL_FONT_SIZE` (44px, was T07's inert stub) in as the Wall's single
  fixed size — `computeWallLayout` now measures ONCE at that size (no search) instead of calling the deleted
  `fitWallFontSize` binary search. `WALL_SCROLL_RATE_PX_PER_SEC` is now DERIVED —
  `WALL_SCROLL_LINES_PER_SEC * WALL_FONT_SIZE * WALL_LINE_HEIGHT_RATIO` = `4.5 * 44 * 1.25` = `247.5px/s` (was F16/
  F18's bare `500`) — rather than a bare constant. Deleted `WALL_TARGET_BLOCK_HEIGHT_PX`, `WALL_FONT_FLOOR_PX`,
  `WALL_FONT_CAP_PX` from `wall-timing.ts`; deleted `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` from `wall-gate.ts` along with
  its module-load invariant check. `WallLayout.fits` is GONE (not merely defaulted true) — there is no longer any
  concept of a card "not fitting"; `gateWallCard`'s block-height rejection is gone entirely (not narrowed), so the
  never-finishes invariant now holds purely by construction (T05/T06's chapter-sourced block is always long enough
  at 44px/4.5 lines-per-second — needs ~412 words, chapters hold 2,196-3,305). Confirmed by direct measurement that
  a SINGLE card's own excerpt (100-200 words) still does NOT clear the new, lower travel floor
  (`FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS` ≈ 2538.75px, down from F16/F18's 3170px) on its own —
  the chapter block is what makes the invariant true, not the smaller font/rate alone.
  Removed the `'travel'` axis from `WallGateResult['failure']` and `WallPoolRejection.axis` (wall-pool.ts) since it
  is now structurally unreachable — `gateWallCard` never rejects on block height, so the only reachable axes are
  `'duration'` and `'landingLine'`. Updated every caller: `wall-pool.ts`'s `surveyWallPool` dropped its
  `rejectedForTravel` counter; `write-exclusions.ts` dropped its `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` import and the
  `wall_min_travel_block_height_px` meta field it wrote; `social/src/remotion/index.ts`'s barrel export list updated
  to match (removed the four deleted symbols, added `WALL_FONT_SIZE`/`WALL_SCROLL_LINES_PER_SEC`).
  Test changes, per T07's own recorded list plus two it flagged for a later task but that in fact broke immediately
  under the real T08 numbers (verified by direct measurement, not assumed): deleted the "block geometry at F18
  numbers" describe, both "fitWallFontSize — a short/long excerpt" describes, and the old F15/F16/F18 "the scroll
  does not finish before the cut" describe from `wall-timing.test.ts` (T07 predicted only its one `3170px` literal
  would need updating; measurement showed the WHOLE describe was invalid at the new geometry, since it asserted the
  invariant against a single card's own excerpt directly, which no longer clears the new, lower floor without a
  chapter-sourced block — superseded by T07's own "BY CONSTRUCTION" describe, which already uses chapter blocks).
  Rewrote T07's "no read-through card is rejected" describe: it read `content/social/render-exclusions.json`'s
  `'travel'`-axis entries live, which vanish the instant the artifact is regenerated under this task's own code (no
  `'travel'` axis can exist anymore) — replaced with a frozen, hardcoded snapshot of the same 14 real card ids (from
  `git show HEAD:content/social/render-exclusions.json` at the pre-T08 commit) and rewrote its `.fits`-based
  assertions as direct `wallScrollOffsetAtFrame`/`blockHeight` comparisons, matching the sibling describe's own
  technique (`.fits` no longer exists on `WallLayout`). In `wall-gate.test.ts`: deleted the "rejection path
  (synthetic too-short excerpt)" describe (3 tests) and the "selectComposition throws for a too-short card" test
  (both asserted the now-gone travel rejection); updated `WALL_MIN_LEGIBLE_FONT_PX`'s and `surveyWallPool`'s describe
  comments/assertions to drop `rejectedForTravel`. In `exclusions.test.ts`: dropped `wall_min_travel_block_height_px`
  from the meta interface/assertion and `rejectedForTravel` from the dropped-count sum. In
  `chapter-text.test.ts`: replaced its `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` import (now deleted) with a locally
  re-derived travel floor, matching `wall-timing.test.ts`'s own independent re-derivation. One test outside this
  task's named files also broke on the rate's new numeric value:
  `question-timing.test.ts`'s "reuses WALL_SCROLL_RATE_PX_PER_SEC (500)..." hardcoded the old bare constant; rewrote
  it to assert against the real derivation instead of a literal, preserving its actual intent (question-timing.ts
  reuses whatever rate wall-timing.ts defines, never a copy).
  MEASURED supply shift (regenerated via `npx tsx social/scripts/write-exclusions.ts --date 2026-08-26`): the
  read-through slice moved from **16 Wall / 32 Still** (T04's baseline) to **30 Wall / 18 Still** — exactly the
  plan's headline number, and exactly what T07's tests predicted (all 14 travel rejections cleared; the 18
  `landingLine` rejections are untouched by this task, as expected). Wall pool (896 entries): travel rejections
  dropped from 175 to 0 (axis deleted, not merely relaxed), duration rejections rose slightly (207 → 211, real
  count drift from the corpus, not a T08 change), passed rose 514 → 685. Question pool (88 entries), which reuses
  `gateWallCard` for its own archaic-excerpt phase: passed rose 37 → 48 (the 11 `wall_travel`-axis rejections all
  cleared), rejected dropped 51 → 40. Objection pool (59 entries) and the Still fallback (48/48/0) are unaffected —
  neither calls `gateWallCard`.
  Verified: `cd social && npx vitest run src/remotion/__tests__/wall-timing.test.ts` — 40/40 pass. `cd social &&
  npm test` — 27/27 test files, 520/520 tests pass (up from 519 pre-fix once `question-timing.test.ts`'s stale
  literal was corrected; zero regressions elsewhere). `npx vitest run scripts/lib/__tests__/schedule.test.ts` (repo
  root) — 123/123, unaffected. `cd social && npx tsc --noEmit` — clean. Confirmed by grep that
  `WALL_TARGET_BLOCK_HEIGHT_PX`, `WALL_FONT_FLOOR_PX`, `WALL_FONT_CAP_PX` and `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` have
  zero remaining references outside historical doc comments.
  Follow-up for T09: `wall-pool.ts`'s `surveyWallPool` and `write-exclusions.ts`'s `surveyReadThrough` still gate
  each card's OWN single-card `original_excerpt`, not the chapter-sourced block — harmless today (the gate no
  longer rejects on block height at all, so this is a non-issue for supply), but worth noting so a future task
  doesn't assume these survey functions already exercise the real chapter-sourced render path Wall.tsx will use.
- [x] T09: Wire `Wall.tsx` to render the chapter block. Acceptance: renders from a real card; frame 0 shows the
  card's own first words at the top of the frame; the block is continuous verbatim chapter text below it.
  Done (2026-08-26): `WallProps` gained an optional `chapterBlock?: string` — the moving wall phase's real
  scrolling text now reads `props.chapterBlock ?? props.originalExcerpt` (`Wall.tsx`), falling back to the old
  single-excerpt behavior when omitted so every existing caller (Root.tsx's `defaultWallProps`, `counter.test.ts`'s
  `WALL_BASE_PROPS`, any direct render that hasn't been updated) keeps working unchanged. `originalExcerpt` itself
  is untouched everywhere else — the gate (`assertWallCardRenderable`), the opening rotation's word count
  (`computeOpeningData`), and `computeWallTiming`'s `wall.wordCount` all still key off the CARD's own excerpt, not
  the chapter block, since none of those are about what phase 1 visually renders. `cli.ts` is the one real caller
  that supplies `chapterBlock`: `WallPlan` gained the field, `buildRenderPlan`'s `'wall'` case computes it via
  `loadChapterTextBlock(slot.book_slug, slot.card_id)` (`render/chapter-text.ts`, T06), and `buildInputProps`
  threads it into the composition's `inputProps`. `printPlan` also logs the chapter block's word count next to the
  card's own excerpt word count for `--dry-run` visibility. No change was needed to `Root.tsx`'s
  `calculateMetadata` — durationInFrames depends only on `plainLines`/`narrationTimings`/`landingLine`, never on
  how long the wall-phase text is (the wall phase's length is the fixed `WALL_SECONDS`, by design), so nothing
  there reads `chapterBlock` at all.
  T08's flag (`surveyWallPool`/`surveyReadThrough` still gate each card's own single-card excerpt, not the
  chapter block) is CONSCIOUSLY KEPT, not resolved: confirmed `gateWallCard`'s only two reachable rejection axes
  are `'duration'` and `'landingLine'` (T08 deleted the block-height axis entirely, not just narrowed it), so
  which text `computeWallLayout` measures inside the gate cannot change any survey's pass/fail outcome — and
  neither `wall-pool.ts` nor `write-exclusions.ts` writes `layout`/`blockHeight` numbers into any artifact a reader
  could be misled by (confirmed by grep: `write-exclusions.ts` never touches `layout`/`blockHeight`/`screens`).
  Changing those survey functions to chapter-source their gate calls would be a no-op on every measurable output,
  so it's left alone rather than expanding this task's diff for zero effect — flagged here again in case a later
  task (e.g. one that starts reporting `layout`/`blockHeight` for real) needs to revisit it.
  Tests: new `social/src/remotion/__tests__/wall-chapter-block.test.ts` (3 tests), reusing `counter.test.ts`'s own
  `bundle` + `selectComposition` + `renderStill` + `pngjs` machinery (no new rendering approach invented) against
  the real card `meditations-02-006` (day 6 slot 1 of the committed week-1 schedule — the same card
  `cli.test.ts`'s own Wall e2e test already renders). One sanity test restates chapter-text.ts's own already-tested
  precondition (the real block starts with this card's excerpt and is >5x longer). The other two are the real
  proof, pixel-based (Remotion renders to a canvas, not an inspectable DOM): render frame 0 twice, once with
  `chapterBlock` omitted (the pre-T09 shape) and once with the real chapter block, then (a) assert every pixel
  from the top down through the excerpt-alone render's own last line of ink is BYTE-IDENTICAL between the two
  renders — chapter-sourcing must never change what frame 0 opens on — and (b) assert the chapter-block render has
  ink well past where the excerpt-alone render runs out (measured: the 157-word excerpt alone fills to row
  1156/1920; the two renders don't diverge until row 1166, comfortably past that boundary), proving continuous
  chapter text renders below, not blank space. Confirmed both fail meaningfully against the pre-T09 `Wall.tsx` (via
  a temporary `git stash` of just that file): the "continuous text below" test fails outright (`expected false to
  be true`); the "frame 0 identical" test still passes (correctly — with no chapter-sourcing wired, both renders
  reduce to the same excerpt-only text, so there is nothing to distinguish yet).
  Verified: `npx tsc --noEmit` clean. `cd social && npm test` — 28/28 test files, 523/523 tests (520 pre-existing +
  3 new), zero regressions. One transient failure was observed on a first full-suite run
  (`wall-openings.test.ts`'s end-to-end smoke test hit vitest's 180s per-test timeout under full-suite parallel
  load) and did NOT reproduce on a second full run or in isolation (2.3s) — resource contention from the suite's
  now-larger set of real-render tests running in parallel, not a regression this task introduced; not something
  this task's own scope should fix.
  Real end-to-end render + frame inspection (`npx tsx social/src/cli.ts render --date 2026-09-06 --slot 1`, day 6
  slot 1 of week 1 — a real, committed Wall slot, `meditations-02-006`): `--dry-run` confirms the chapter block is
  2,196 words against the card's own 157-word excerpt. Extracted frames 0, 36 (mid-scroll), 74 (last wall frame,
  an instant before the cut) and 80 (first payoff frame) with ffmpeg and read them directly. Frame 0: the card's
  own opening words ("Theophrastus, where he compares sin with sin...") sit at the very top of the frame, exactly
  as before T09, and by frame 21-22 of the visible ~35 lines the text has already crossed from this card's own
  excerpt (ending "...merely resolve upon that action.") straight into the NEXT chapter card's excerpt
  ("Whatsoever thou dost affect, whatsoever thou dost project...") with no gap, blank line, or repeat — real,
  continuous, verbatim chapter text, not a loop of the same 157 words. At 44px/1.25 line-height (55px lines),
  1920px of frame height holds ~35 visible lines at frame 0, averaging roughly 7-8 words/line (matching
  `wall-timing.ts`'s own "~7.1 words/line" estimate) — a dense page of real body text, not the pre-geometry-rewrite
  "large-print book" the plan's own Why section measured (was ~18 lines of ~3.5 words). Frame 74 (the hard cut)
  still shows dense mid-passage archaic text (further into the same chapter-sourced continuation, past this
  card's own excerpt), confirming the cut lands mid-passage rather than at the end of a short single-card excerpt.
  Frame 80 shows the unaffected payoff ("Theophrastus compares different types of wrongdoing." + the "Card 6 of
  48" counter) exactly as pre-T09. (This card's `opening: countdown`, T17, unrelated to this task, also renders
  correctly on top — a "157"/"132"/"106"-style countdown badge — confirming the new chapter-sourced wall phase
  composes fine with the existing opening rotation.) Render artifacts were transient (written under the
  gitignored `social/out/`) and removed after inspection.
- [x] T10: Fix the payoff polarity — the payoff must be set LARGER than the wall. Raise `PAYOFF_MIN_FONT` above
  `WALL_FONT_SIZE` and assert the relationship as a test, not a coincidence. Acceptance: a test fails if wall
  type is ever ≥ payoff type.
  Raised `PAYOFF_MIN_FONT` from 40 to 52 in `social/src/remotion/wall-timing.ts` — a genuine +8px (~18%) step
  above the fixed `WALL_FONT_SIZE` (44px), not a 1px technicality. Verified the new floor before choosing it:
  every one of the 896 real landing lines in `content/social/premises/wall.json` computes 81-88px regardless of
  the floor's value (they're all ≤18 words, the mechanical `LANDING_LINE_MAX_WORDS` selection bound), so the
  floor never actually binds in production; it only matters as a backstop against `WALL_LANDING_LINE_MAX_WORDS`
  (30, the looser render-time ceiling in `wall-gate.ts`) — measured a synthetic worst-case 30-word line of
  unusually long (10-char average) words and confirmed it still fits `PAYOFF_BOX_HEIGHT` (800px) at the new
  floor without overflow (728px used, 72px of headroom), and that 56px would NOT (1176px, overflow). Also
  checked the actual longest real landing line in the corpus by character count (`on-anger-01-034`, 123 chars/
  18 words) and rendered it as a real Remotion still frame — six lines, comfortably inside the frame, no clip.
  Added a new "social pilot 02a T10" describe block to `social/src/remotion/__tests__/wall-timing.test.ts` (4
  tests) that asserts the relationship structurally rather than by convention: (1) `WALL_FONT_SIZE >=
  PAYOFF_MIN_FONT` must be `false` — this is the exact "fails if wall type is ever ≥ payoff type" acceptance
  criterion; (2) the gap is ≥8px, not a rounding artifact; (3) EVERY real landing line in the Wall pool, run
  through the actual `fitFontSize` the composition calls, computes a fontSize strictly greater than
  `WALL_FONT_SIZE` and `fits: true` — the real per-card computed result, not just the floor constant; (4) the
  30-word backstop worst case still fits without overflow. Checked the REST LINES (the narrated lines after the
  landing line, phase 3): `Wall.tsx` renders them through the exact same `PayoffLine` component as the landing
  line itself (`<PayoffLine text={restLine ? restLine.text : ''} />`), sharing `PAYOFF_MIN_FONT`/`PAYOFF_MAX_FONT`
  — no separate sizing path exists for them, so this fix covers them automatically; no change needed there.
  `PAYOFF_MIN_FONT` is also shared with `objection-gate.ts`'s reply-sentence fit — checked the real 59-entry
  objection pool before and after the change (`splitPayoffLines` + `fitFontSize` on every reply's first two
  sentences): minimum computed size there is 58px at either floor (40 or 52), so raising the floor changed
  nothing for Objection; `npm test`'s objection-gate suite still passes 27/59 pool entries, unchanged.
  Verification: `npx tsc --noEmit` clean; `npm test` (social workspace) 527/527 passing (523 prior + 4 new T10
  tests) across 28 files. Real render (`npx tsx social/src/cli.ts render --date 2026-09-06 --slot 1`,
  `meditations-02-006`) confirms visually: a wall frame shows dense 44px archaic text with ~20 visible lines per
  screen; the payoff frame ("Theophrastus compares different types of wrongdoing.") renders at the computed
  88px (`PAYOFF_MAX_FONT`, the cap) — exactly 2x the wall's type size, unmistakably larger and clearer, reading
  as the "refined" payoff the format promises rather than the reverse.
- [x] T11: Test the framing layer — `social/src/remotion/__tests__/source-head.test.ts`. Running head is fixed
  (identical at every wall frame); payoff label sits in the same position; neither collides with or reflows the
  read-through counter (retarget `counter.test.ts`'s pixel-level proof); both use DM Sans + secondary ink, never
  `SERIF_STACK` and never an accent. Acceptance: fails against an empty implementation.
  Studied `Counter.tsx`/`counter-layout.ts`/`counter.test.ts` (the framing-text + pixel-proof precedent), `Wall.tsx`
  (`WallPhase`/`PayoffLine`/`SERIF_STACK`, both exported and reusable), `render/theme.ts` (`SECONDARY`, `INK`,
  `ACCENTS`), and real card JSON in `content/output/` for the `author_slug`/`source_reference` fields the running
  head must derive from. Confirmed `source_reference` covers three real shapes across the corpus —
  `"Meditations, Book 2, Section 1"` (title + chapter + section), `"The Enchiridion, Section 1"` (title + section,
  no chapter number) and `"On the Shortness of Life, Section 1"` (multi-word title + section, matching
  `validate.ts`'s own documented `"Discourses, About Cynicism"` no-section shape too) — so the running head's
  derivation rule (strip any trailing `", Section N"`, uppercase, join with the author's display name via
  `" · "`) is provably general, not fit to one book.
  Added, all under `social/src/remotion/`: `source-head-layout.ts` (real, final geometry — `SOURCE_HEAD_BOUNDING_BOX`
  computed FROM `COUNTER_BOUNDING_BOX` so the two framing elements are non-overlapping by construction, stacked
  in the one platform-chrome-safe top-left corner rather than trading it for an unsafe one — same T07-precedent
  pattern of "real constants, deliberately not yet wired into behaviour" `wall-timing.ts` used for `WALL_FONT_SIZE`);
  `SourceHead.tsx` (the required throwing/inert stub — `formatRunningHead` and `SourceHead` both throw; real
  constants `SOURCE_HEAD_FONT_STACK` (aliased to `Counter.tsx`'s own `COUNTER_FONT_STACK`, not a second literal),
  `PAYOFF_LABEL_TEXT`, and the `RunningHeadCardMetadata`/`SourceHeadVariant`/`SourceHeadProps` types T12 implements
  against). Factored `counter.test.ts`'s own pixel-proof helpers (`renderFrameAsPng`, the no-reflow walk, the
  box-differs walk) out into a new shared `__tests__/pixel-proof.ts` (plus a new `assertBoxIdentical`) — this IS
  the "retarget `counter.test.ts`'s pixel-level proof" the task calls for: `counter.test.ts` now imports the same
  machinery `source-head.test.ts` uses, unchanged in behavior (still 15/15 green). Added a test-only harness
  (`__tests__/fixtures/source-head-harness.tsx` + `source-head-entry.tsx`, mirroring the existing
  `font-probe-entry.tsx` pattern) that mounts `WallPhase` + `ReadThroughCounter` + `SourceHead` as siblings so
  `source-head.test.ts` can render real frames and diff pixels without waiting on T12's `Wall.tsx` wiring —
  deliberately NOT added to `entry.tsx`/`Root.tsx` (production wiring stays T12's job).
  `source-head.test.ts` (25 tests): unit-level `formatRunningHead` derivation (including the plan's own worked
  example, `"MARCUS AURELIUS · MEDITATIONS, BOOK 2"`, verbatim, from a real `meditations/book-02.json` card, plus
  a same-metadata-different-card proof that three real cards' heads are pairwise distinct); a `Counter.tsx`-style
  source guard (no `SERIF_STACK`, no `ACCENTS`/accent hex, `SECONDARY` not `INK`, DM Sans, no motion primitive,
  no `frame` prop, no URL); and three real-render pixel proofs via the harness — fixed position across frame 0
  vs. frame 90 of a genuinely scrolling wall (`assertBoxIdentical` inside the box, and a companion test proving
  the wall truly moved outside it, so the fixed-proof isn't vacuous); running-head vs. payoff variants pixel-
  identical outside their shared box and differing inside it (same slot, different text); and a counter/head
  matrix (neither, head-only, counter-only, both) proving neither overlay reflows or overwrites the other, with
  a final pure-geometry test that the two boxes are disjoint by construction.
  Verification: `npx tsc --noEmit` clean. `npx vitest run src/remotion/__tests__/source-head.test.ts` — 13
  failed / 12 passed (the 12 passing are the pure-geometry and some source-guard checks that don't require
  `SourceHead` to render; every render-dependent assertion fails against the throwing stub, satisfying "fails
  against an empty implementation"). Full social suite: `npx vitest run` — 28/29 files green, 539/552 tests
  passing; the 13 failures are exactly this new file's render-dependent tests, nothing else regressed
  (`counter.test.ts` itself still 15/15 after the refactor). Did not touch `Wall.tsx`, `entry.tsx`, `Root.tsx`,
  narration/mixer, the opening rotation, or mid-chapter entry.
- [x] T12: Implement `SourceHead.tsx` and wire into `Wall.tsx` — running head `"MARCUS AURELIUS · MEDITATIONS,
  BOOK 2"` from card metadata (never hardcoded), payoff label `"In plain English"`. Acceptance: T11 passes (the
  task text's own "T10" was a typo carried over — T10 is the payoff-polarity task; T11 is the framing-layer test
  file this task's acceptance actually targets).
  Done (2026-08-26): `formatRunningHead` derives the head from exactly the two fields
  `RunningHeadCardMetadata` names — `author_slug` (`"marcus-aurelius"` -> hyphens to spaces, uppercased ->
  `"MARCUS AURELIUS"`) and `source_reference` (`"Meditations, Book 2, Section 1"` -> strip the trailing `",
  Section N"` clause, uppercase -> `"MEDITATIONS, BOOK 2"`), joined with `" · "` — matches the plan's own worked
  example verbatim and all three real `source_reference` shapes T11's fixtures cover (three-part, two-part, and a
  multi-word title). `SourceHead` renders either variant (`running-head` derived from the card, or the fixed
  `PAYOFF_LABEL_TEXT`, `"In plain English"`) as a sibling `AbsoluteFill`, DM Sans (`SOURCE_HEAD_FONT_STACK`,
  aliased to `Counter.tsx`'s `COUNTER_FONT_STACK`), `SECONDARY` ink, no motion primitive of any kind.
  One real geometry decision T11's stub hadn't settled: the running head sits directly on top of the Wall's own
  actively SCROLLING archaic text — the only moving content anywhere in the channel — so a transparent overlay
  would let that background show (and change) through it, contradicting the "fixed" claim. `SourceHead` draws an
  opaque PAPER backing PLATE spanning the entire, generous `SOURCE_HEAD_BOUNDING_BOX` (not just the text's own
  tighter bounds) — a masthead band, not a floating label — so every pixel inside that box is deterministic frame
  to frame regardless of what scrolls behind it. `Counter.tsx`'s own overlay never needed this because it is only
  ever shown on already-still payoff frames, never over the scroll.
  Wired into `Wall.tsx`: a new optional `sourceReference?: string` prop (additive, same "omitted -> renders
  nothing" contract as `counter`/`chapterBlock` — every existing caller/test that hasn't been updated keeps
  rendering exactly as before). When present, combined with the existing `author` prop (already the card's own
  `author_slug`) to build `RunningHeadCardMetadata`: the running-head variant renders as a sibling of `WallPhase`
  during the wall phase, and the payoff variant renders as a sibling of `PayoffLine`/`ReadThroughCounter` during
  both the landing-line and rest-line phases — same slot, phase-dependent text, exactly the "book page -> not a
  book page" grammar the plan calls for. `cli.ts` is the one real caller that supplies it: `WallPlan` gained
  `sourceReference`, sourced from `loadOutputCard`'s own `card.source_reference` (added explicitly to
  `wall-pool.ts`'s `OutputCard` interface, the same treatment T05 gave `chapter_slug`/`card_number` — required by
  the corpus schema, `scripts/lib/validate.ts`, on every card) — threaded through `buildInputProps` alongside
  `chapterBlock`. `--dry-run` also now prints the resolved running head text for visibility, via the same
  `formatRunningHead` the component itself calls (not a duplicated derivation).
  Framing text is never narrated: `narrationPlan` in `cli.ts` was not touched, and neither
  `sourceReference`/`author` nor anything `SourceHead` renders is reachable from `narrationPlan`'s line-selection
  logic — it only ever reads `formatPlan.plainLines`/`landingLine`/`answer`/`reply`/`text`.
  One test bug found and fixed, flagged here per the task brief rather than silently patched: T11's own
  `source-head.test.ts` had a self-contradictory assertion in the "counter and source head together" test —
  `assertIdenticalOutsideBoxes(counterOnly.png, both.png, [COUNTER_BOUNDING_BOX])` demands every pixel OUTSIDE the
  counter's own box be identical between a counter-only render and a counter+head render, but the two renders
  legitimately differ inside `SOURCE_HEAD_BOUNDING_BOX` (that is the entire point of the "both" render), and
  `SOURCE_HEAD_BOUNDING_BOX` sits entirely outside `COUNTER_BOUNDING_BOX` by construction — so that assertion
  could never pass for ANY real `SourceHead` implementation, and directly contradicts
  `assertBoxDiffers(neither.png, both.png, SOURCE_HEAD_BOUNDING_BOX)` four lines later in the same test. The
  comment directly above it ("the counter box itself is untouched by the source head") describes a different,
  correct check — replaced the call with `assertBoxIdentical(counterOnly.png, both.png, COUNTER_BOUNDING_BOX)`,
  which is what that comment actually means, and left a comment explaining the fix and why the original could
  never pass.
  Verified: `npx vitest run src/remotion/__tests__/source-head.test.ts` — 25/25 pass. `cd social && npm test` —
  29/29 test files, 552/552 tests pass (527 prior + 25 in this file, zero regressions elsewhere). `npx tsc
  --noEmit` clean. Real render + frame inspection (`npx tsx social/src/cli.ts render --date 2026-09-06 --slot 1`,
  `meditations-02-006`, 705 frames/23.5s): `--dry-run` confirms the running head resolves to the plan's own exact
  worked example, `"MARCUS AURELIUS · MEDITATIONS, BOOK 2"`. A wall-phase frame (t=1.0s) shows that exact text
  fixed above the scrolling archaic block — small, DM Sans, secondary grey, unmistakably distinct from the dense
  serif body beneath it (this card's `opening: countdown`, T17, also renders on top in this same frame — the
  "190" numeral badge and the running head's boxes DO overlap geometrically, since `WallOpeningBadge` claims the
  whole top third of the frame; not a defect T12 owns — T17 deletes the opening rotation outright, and the running
  head/counter's OWN mutual non-collision, the acceptance criterion this task actually owns, holds by construction
  regardless). A payoff-phase frame (t=18.0s, a narrated rest line) shows `"In plain English"` in the exact same
  top-left slot, with `"Card 6 of 48"` directly above it, no collision, no reflow. Render artifacts were
  transient (gitignored `social/out/`) and removed after inspection.
- [x] T13: Extend the framing layer to `Question.tsx`, `Objection.tsx` and `Still.tsx` so the channel reads as one
  product. Acceptance: all four compositions carry it; plan 02's house-rule checks still pass on all four.
  Done (2026-08-26): each of the three formats gets its OWN variant contract, decided per-composition against
  Constraint 6 ("factually true") rather than copying Wall's head-then-label pattern blind:
  - **Question** has the same two-phase archaic->plain grammar as Wall (a moving wall phase, then a still
    payoff), just prefixed by a phase Wall doesn't have — the opening question-alone hold. Running head only
    during the wall phase (real book text is genuinely on screen there); payoff label only once the answer
    resolves. The opening phase gets NEITHER: the question is neither a verbatim quote of the book nor the plain
    rewrite, so labeling it as either would not be true.
  - **Objection** has NO archaic-wall phase at all — nothing in this format ever shows the book's own original
    text. A running head is therefore never rendered here, structurally (proven by a source-guard test, not just
    implied by the render tests): there is no on-screen book text for it to truthfully name. Only the payoff
    label renders, only on the two still reply-line phases — the plain rewrite of the author's actual response.
    The opening objection-alone phase (a reader's own hypothetical thought, explicitly never attributed to the
    author per this component's own doc comment) gets neither, for the same reason as Question's opening phase.
  - **Still** has exactly one phase, and that phase already IS the plain rewrite from frame 0 — there is no
    earlier phase where the label would be untrue. So the payoff label is correct for the ENTIRE duration, the
    one format where it isn't phase-gated at all. A running head never renders here either (same source-guard
    test as Objection), for the same "no book text on screen" reason.
  All three get an additive, optional `sourceReference?: string` prop, same "omitted -> renders nothing"
  contract T12 established for `Wall.tsx`. `cli.ts`: `QuestionPlan`/`ObjectionPlan`/`StillPlan` each gained
  `sourceReference: card.source_reference` (the `card` each branch of `buildRenderPlan`'s switch already loads),
  threaded through `buildInputProps`. `printPlan`'s dry-run output grew an `else` branch for these three formats
  — `source reference: "..." (payoff label only — no running head in this format)` — since only the Wall branch
  has a resolved running-head string to print.
  New test file `social/src/remotion/__tests__/framing-question-objection-still.test.ts` (12 tests): unlike
  `source-head.test.ts` (which predates T12's real `Wall.tsx` wiring and needed a test-only harness), these
  render the real, production `Question`/`Objection`/`Still` compositions via `entry.tsx`, reusing the exact
  fixtures `question-timing.test.ts`/`objection-timing.test.ts`/`still-timing.test.ts` already use (real cards,
  real `source_reference` values pulled from `content/output/`). Proves, per phase and per format: the box is
  identical between "no `sourceReference`" and "with `sourceReference`" renders exactly where the design says
  nothing should show; `assertIdenticalOutsideBoxes`/`assertBoxDiffers` (no reflow, something genuinely drew)
  wherever the design says one variant should show; and, for Question, that the running-head-phase box and the
  payoff-phase box genuinely differ in content (the head->label grammar, not the same overlay rendered twice).
  Plus a two-test source guard asserting `Objection.tsx`/`Still.tsx` never construct a `kind: 'running-head'`
  variant anywhere in source. `cli.test.ts` gained one more `--dry-run` assertion covering the Still branch's new
  `printPlan` output, against the real committed week-1 schedule's day-1 still slot (`meditations-02-001`).
  Verified: `cd social && npm test` — 30/30 files, 565/565 tests pass (zero regressions; 552 prior + 12 in the
  new framing file + 1 new `cli.test.ts` test = 565). `npx vitest run src/render/__tests__/house-rules.test.ts` — plan 02's own house-rule
  checks (`checkAllFormats`, scanning every `.ts`/`.tsx` file in `social/src/remotion` for overshoot easing and
  checking every format's `computeXTiming` payoff-motionless floor) — 36/36 pass, unaffected: `SourceHead.tsx`
  itself takes no `frame` prop and calls no Remotion timing primitive (already proven by T11's own source guard),
  so calling it from three more components adds no motion and touches no timing schedule. `npx tsc --noEmit`
  clean. Real renders + frame inspection (music-only, T14 still pending) of one of each newly-framed format,
  using real cards: `--date 2026-09-02 --slot 2` (Question, `meditations-08-045`, marcus-aurelius/Meditations Book
  8 — a different real card from the `discourses-64-006`/epictetus fixture the new test file itself uses, not a
  discrepancy), `--date 2026-09-08 --slot 2 --schedule-dir social/src/__tests__/fixtures`
  (Objection, week-2 fixture schedule's one Objection slot, on-anger-03-079/Seneca), `--date 2026-09-01 --slot 1`
  (Still, `meditations-02-001`, already the real committed week-1 schedule). Frames extracted with ffmpeg and
  read directly: Question's opening hold (t=0.5s) shows the bare question, no framing of any kind; its wall
  phase (t=2.5s) shows `"MARCUS AURELIUS · MEDITATIONS, BOOK 8"` fixed top-left over the scrolling archaic block,
  no collision; its answer phase (t=6s) shows `"In plain English"` in the same slot. Objection's opening hold
  (t=1s) shows the bare accent-coloured objection quote, no framing; its first reply line (t=3.5s) shows `"In
  plain English"`, no collision with the reply text. Still's single frame (t=5s) shows `"Card 1 of 48"` (the
  counter) stacked directly above `"In plain English"` (the payoff label), both legible, no collision with the
  plain-English body text below. Did not touch narration/the mixer, `question-timing.ts`/`objection-timing.ts`'s
  narration acceptance, the opening rotation (`WallOpeningBadge` untouched), or mid-chapter entry.
- [x] T14: Assert the narration contract under the new shape —
  `social/src/audio/__tests__/narration.test.ts`. the landing line ALONE is in `wallSilentSpans` (the scroll now carries the bed); rest
  lines are the only narrated set; framing text never reaches `synthesize`; a Wall whose `plain_english` is a
  single sentence (no rest lines) still produces a valid, non-silent mix. Acceptance: tests pass with voices
  still unset, using recorded fixtures.
  Partial (2026-08-26): 13 of 14 tests pass today; ONE is deliberately RED, by design (the plan's own ordering —
  T15, not T14, is what makes `wallSilentSpans` land-line-only). `cli.ts`'s `wallSilentSpans`/`narrationPlan` and
  the `WallPlan`/`QuestionPlan`/`ObjectionPlan`/`StillPlan`/`FormatPlan` types are now `export`ed (visibility
  only, no behavior change) so this file can assert on them directly; doing that safely required an entry-point
  guard around `cli.ts`'s bottom-of-file `main()` call (it used to run unconditionally at import time and call
  `process.exit()`, which would otherwise kill the test worker on `import`) — real invocations
  (`npx tsx cli.ts render ...`, exactly how `cli.test.ts` already shells out) are unaffected; proven by the full
  `cli.test.ts` suite (dry-run, `--require-narration`, `--help`, and four real end-to-end renders) still passing
  unchanged. RED (2026-08-26): `wallSilentSpans()` still spans `0 -> WALL_FRAMES + LANDING_LINE_FRAMES` (the whole
  wall+landing-line window), not the landing line alone starting at `WALL_FRAMES` — exactly the defect this plan
  names; T15 flips it. GREEN already, pinned as regression protection ahead of T15: rest lines are `narrationPlan`'s
  only narrated set for the Wall (never the landing line, the original excerpt, or the chapter block) and
  `offsetMs` lands exactly on the landing line's end frame; a single-sentence Wall (no rest lines) narrates
  nothing; framing text (`formatRunningHead`'s output, `SourceHead.tsx`'s `PAYOFF_LABEL_TEXT`, each format's own
  `sourceReference`) never appears in any of the four formats' `narrationPlan` lines nor in the exact `text`
  string a recording fake `TtsProvider` observed reaching `synthesize` (Question narrates only the answer, never
  the bare question; Objection narrates only its `OBJECTION_REPLY_LINE_COUNT`-capped reply sentences, never the
  bare objection); the F02 edge case (single-sentence Wall, `mix()` fed `wallSilentSpans()` against the real
  padded 15s duration and a real committed bed) succeeds with a finite, in-tolerance loudness measurement and
  audible signal after the silent span, both under today's pre-T15 span and (by construction, since the check
  reads the span's own bounds rather than hardcoding them) under T15's future shrunk one. Full social suite:
  578/579 (the one named RED test, no other regressions); `npx tsc --noEmit` clean. No live API calls — the
  recording fake `TtsProvider` writes the committed `polly-sample.mp3` fixture, same pattern
  `social/src/__tests__/narration.test.ts` (F07/F09/F13) already uses; `resolveVoice` mocked the same way.
  Done (2026-08-26, T15): the one RED test now passes — `wallSilentSpans()` returns the landing line alone. Full
  narration.test.ts: 14/14.
- [x] T15: Make the cut audible — `social/src/audio/mix.ts`, `wallSilentSpans` in `social/src/cli.ts`.
  The bed plays under the scroll at nominal level, hard-stops on the cut frame, stays at `SILENCE_FLOOR_DB` for
  the landing line only, and returns under the rest lines. Acceptance: `volumedetect` on a rendered Wall shows
  audible level across 0-2.5s, floor across 2.5-5.5s, audible after; F02's named non-finite-loudnorm error still
  raises rather than surfacing raw ffmpeg output; `bedEnvelope` stays a pure, deterministic function of its
  inputs.
  Done (2026-08-26): `wallSilentSpans()` now returns `[{ startMs: WALL_FRAMES/FPS*1000, endMs: (WALL_FRAMES +
  LANDING_LINE_FRAMES)/FPS*1000 }]` — the landing line alone, starting at the cut frame (2.5s), not at 0.
  `mix.ts`'s `intervalsToPoints` now ramps into a `'FLOOR'` level (any silent span) using a new named
  `HARD_STOP_RAMP_MS` (5ms) instead of the scripted `DUCK_ATTACK_MS`/`DUCK_RELEASE_MS` — not exactly 0ms, because
  two `VolumePoint`s at an identical `atMs` divide-by-zero `buildVolumeExpr`'s `t1-t0` denominator and a truly
  instantaneous amplitude jump produces an audible click; 5ms is ~1/6 of one video frame and under the ~10ms a
  human ear needs to read a level change as a "fade" rather than a cut. Leaving `FLOOR` still uses the normal
  `DUCK_RELEASE_MS` (the return under the rest lines is not required to be a hard cut). `bedEnvelope` is unchanged
  in shape/purity — still a pure function of `(durationMs, narrationSpans, silentSpans)`, no `Math.random()`/
  `Date.now()`; the hard-stop behavior is driven entirely by the `'FLOOR'` level tag already present in
  `buildLevelIntervals`'s output.
  Real defect found and fixed en route (not anticipated by the plan): `volume=eval=frame` re-evaluates its gain
  expression once per upstream audio FRAME, not once per sample. Without forcing a small frame size, ffmpeg hands
  the filter whatever frame size the decoder produces — measured directly against the committed
  `bed-05-g-sus4.flac`: ~90-100ms FLAC blocks. A transition landing mid-frame held the PREVIOUS frame's stale gain
  for the rest of that frame, so `HARD_STOP_RAMP_MS` (or any ramp under ~100ms) was silently ineffective: the
  bed's hard stop at the Wall's 2.5s cut frame didn't actually land until ~2.6s, a full 100ms late, and the
  "floor" span measured only ~-30dB instead of the intended ~-75dB. Fixed with `asetnsamples=n=128` (~2.7ms of
  frames) inserted immediately before every `volume=eval=frame` filter in both `renderBedTrack` and
  `renderNarrationTrack`'s real-narration branch — forces small, fixed-size frames so gain changes land within a
  couple of ms of their scripted `atMs`. This incidentally also tightens the existing `DUCK_ATTACK_MS`/
  `DUCK_RELEASE_MS` narration-ducking transitions (250ms/600ms), which were subject to the same ~100ms smear
  before this fix, unnoticed because nothing asserted their exact timing.
  Measured (real render, `--date 2026-09-06 --slot 1`, card `meditations-02-006`, bed `bed-05-g-sus4`,
  `ffmpeg volumedetect`): 0-2.5s (wall scroll) mean -17.4 dB; 2.5-5.5s (landing line) mean -44.9 dB — the coarse
  whole-span mean is pulled up by the ~5-10ms hard-stop transition itself (a linear-in-power average is dominated
  by even a few ms at nominal level); the steady-state floor once past that edge measures a clean -74.6 to -74.9
  dB (checked at [2.51s,2.6s], [2.6s,5.5s], [3.0s,3.1s], [4.0s,5.4s]); 5.5-15s (rest lines) mean -15.4 dB;
  15-23.5s (tail) mean -16.8 dB. Shape is audible / floor / audible, against the plan's own pre-fix baseline of
  -75.3 / -76.9 / -15.2 dB (silent / silent / audible) — the intended inversion. Frame alignment verified directly
  (not assumed): frame 74 (t=2.4667s, last wall-scroll frame) is dense scrolling archaic text; frame 75 (t=2.500s
  = `WALL_FRAMES`/`FPS`, first landing-line frame) is the clean "Card 6 of 48" + payoff-label frame — the visual
  cut is exactly at frame 75/t=2.500s, and the audio hard-stop (5ms ramp + ~2.7ms of `asetnsamples` frame
  quantization) completes by ~2.505-2.51s, inside that same video frame's [2.500s, 2.5333s) window. F02's
  `SilentMixError` guard untouched and still green (`mix.test.ts`'s "a deliberately all-silent input throws
  SilentMixError" and `narration.test.ts`'s single-sentence-Wall F02 case). `npx vitest run
  src/audio/__tests__/narration.test.ts src/audio/__tests__/mix.test.ts`: 34/34. Full social suite: 579/579.
  `npx tsc --noEmit` clean. No live API calls (music-only render, no TTS/image-gen involved).
- [x] T16: F04 — make `question-timing.ts` and `objection-timing.ts` accept `narrationTimings` so their holds
  follow real narration instead of fixed frames, matching `computeWallTiming`. Acceptance: a drifted timing set
  moves the on-screen line boundaries; `assertNarrationInSync` still gates.
  Done (2026-08-26): matched `computeWallTiming`'s contract exactly, including the one behavior it was worth
  copying rather than inventing: neither module enforces the house rule's 2.5s floor on an individual
  narration-driven line itself (confirmed `wall-timing.ts`'s own `restLineFrameCounts`/its existing
  `'respects supplied narration timings...'` test does the same — narration timings can produce a sub-2.5s
  window on their own, same as the Wall already allows; the 15s MP4 floor's own padding, `duration-bounds.ts`, is
  the only thing that can stretch a too-short result back out, and that logic was untouched).
  `question-timing.ts`: `QuestionTimingInput` gained `narrationTimings?: NarrationLineTiming[]` (type imported/
  re-exported from `wall-timing.js`, same as `WALL_FRAMES`); `computeQuestionTiming` (param renamed `_input` ->
  `input`, since it's now read) derives the answer phase's length from `narrationTimings[0]`'s duration when
  present (`Math.max(1, Math.round((end-start)*FPS))`), else the fixed `ANSWER_FRAMES` — question/wall phases
  never move.
  `objection-timing.ts`: new `ObjectionTimingInput` interface (`narrationTimings?: NarrationLineTiming[]`);
  `computeObjectionTiming` changed from a zero-arg function to `(input: ObjectionTimingInput = {})` (the default
  keeps every existing no-argument call site — Root.tsx defaultProps, most tests — compiling unchanged, and
  keeps `computeObjectionTiming.length === 0`, which `narration.test.ts` asserts directly); each reply line's
  length is derived independently from `narrationTimings[0]`/`[1]`, falling back per-index to the fixed
  `OBJECTION_REPLY_LINE_FRAMES`.
  Threaded through both compositions (`Question.tsx`/`Objection.tsx` gained a `narrationTimings` prop, passed
  straight to their `compute*Timing` call) and `Root.tsx` (`calculateMetadata` for both compositions now passes
  `props.narrationTimings` through to the real duration calculation, matching the Wall's existing pattern).
  Wired `cli.ts`: `buildInputProps`'s `question`/`objection` branches now spread `narrationTimings` in exactly
  the same conditional-spread style the `wall` branch already used; the `if (plan.formatPlan.format === 'wall')`
  gate that captured `synthesizeNarration`'s returned timings was widened to `!== 'still'` (Still has no
  per-line timing input at all — its whole composition is one held frame, see `still-timing.ts`); updated the
  now-stale doc comments on `buildInputProps` and `narrationPlan` that used to say Question/Objection "have a
  fixed shape... and take no such prop" / documented this as "a real, acknowledged gap."
  Tests: `question-timing.test.ts` +5, `objection-timing.test.ts` +5 (both follow the existing files'
  `describe`/`it` conventions) proving (a) the unwired default is unchanged, (b) a supplied timing is respected,
  (c) a DRIFTED timing set moves real on-screen boundaries with concrete frame numbers asserted directly (see
  below), (d) a too-short timing still gets padded to the 15s floor like the fallback does, (e) sibling phases
  are untouched. `audio/__tests__/narration.test.ts` +4: a full pipeline proof (hand-built provider marks, no
  live call — `lineTimingsFromMarks` -> `assertNarrationInSync` -> `compute{Question,Objection}Timing`) that (a)
  a real, in-sync derived timing set both PASSES `assertNarrationInSync` and moves the schedule, and (b) a
  deliberately desynced/overlapping timing set for the exact same real card text is STILL REJECTED by
  `assertNarrationInSync` before it could ever reach either timing module — the gate itself
  (`audio/timing.ts`) was not touched by this task at all.
  Concrete frame numbers (Question, fixture question from `question-timing.test.ts`, FPS=30): fixed-hold
  default answer window is `[120, 450)` (330 frames — already padded to the 15s/450-frame floor, since the
  format's raw 195-frame shape is always under it); a 12s narrated answer gives `[120, 480)`; a 20s narrated
  answer gives `[120, 720)`. Concrete frame numbers (Objection): fixed-hold default is objection `[0, 75)`,
  reply1 `[75, 150)`, reply2 `[150, 450)`; a 4.0s narrated first line alone gives reply1 `[75, 195)`, reply2
  `[195, 450)` (same padded total, moved internal boundary); 4.0s + 10.0s narrated for both lines gives reply1
  `[75, 195)`, reply2 `[195, 495)`, `totalFrames` 495 (clears the 15s floor on its own, so `totalFrames` itself
  moves too, not just the internal boundary).
  Verified: `cd social && npx tsc --noEmit` clean. `cd social && npm test` — 31/31 test files, 593/593 tests
  (up from 579/579; +14 new, zero regressions). No live API calls anywhere — every new test uses hand-built
  `ProviderMark[]`/`NarrationLineTiming[]` literals or the same recorded-fixture `TtsProvider` pattern
  `audio/__tests__/narration.test.ts` already used.
  Not touched, per the task's own scope: T17 (opening rotation), T18 (mid-chapter entry), T19 (scheduler).
- [x] T17: Retire the opening rotation — DELETE `social/src/remotion/wall-openings.ts` outright, along with
  `Wall.tsx`'s `opening`/`eligibleOpenings` props and `WallOpeningBadge`, `scripts/lib/premises.ts`'s
  `eligibleWallOpenings`, the `eligible_openings` field in a regenerated `content/social/premises/wall.json`,
  `chooseWallOpening` in `social/src/cli.ts`, and the `opening` field in `social/src/render/post-metadata.ts`.
  Amend the index plan's opening-rotation paragraph and plan 03's opening comparison. Acceptance: no numeral can
  be rendered over the wall in any composition; `npm test` green with the opening tests DELETED, not skipped.
  **Note:** deleted `wall-openings.ts` and its test file outright (no numeral, no rotation, no third numeral
  replacing them). Removed from `Wall.tsx`: the `opening`/`eligibleOpenings` props, `WallOpeningBadge`, its three
  `WALL_OPENING_*` constants, and the `computeOpeningData`/`assertOpeningRenderable`/`countdownValueAtFrame`
  import block — this also drops the now-unused `COUNTER_FONT_STACK`/`FRAME_HEIGHT` imports and, per T12's own
  prediction, resolves the badge's overlap with the running head (verified visually below). Removed from
  `scripts/lib/premises.ts`: `WallOpening`, `eligibleWallOpenings`, `WALL_COUNTDOWN_DELTA_MIN`,
  `WALL_ORIGINAL_GRADE_MIN`, and the `eligible_openings` field on `RankedWallEntry` — kept `originalReadingGrade`/
  `original_grade` as plain measured data (never part of the deleted task list, and no longer tied to any opening
  mechanic). Stripped `eligible_openings` from all 896 entries of `content/social/premises/wall.json` (a pure
  field removal — every other field, including the LLM-scored `rubric`, is untouched, so this is byte-equivalent
  to what a full pipeline re-run would produce now that `rankWall` no longer computes that field). Removed
  `chooseWallOpening`/`rotateOpening` from `cli-plan.ts` and its `WallPlan.opening`/`eligibleOpenings` fields,
  the `opening`/`eligibleOpenings` console.log and inputProps wiring, and the metadata `opening` field from
  `cli.ts`; removed the `opening` field and its doc comment from `render/post-metadata.ts`. Deleted the
  `chooseWallOpening` describe block from `cli.test.ts` and the whole `wall-openings.test.ts` file (not skipped);
  updated the remaining metadata assertions across all four e2e render tests to `expect(metadata.opening)
  .toBeUndefined()` — a positive check that the field is gone, not just an unasserted absence. Fixed one call
  site outside the task's own list: `audio/__tests__/narration.test.ts`'s `WallPlan` fixture still set
  `opening`/`eligibleOpenings`, which `tsc --noEmit` caught immediately.
  Verified: `cd social && npx tsc --noEmit` clean. `npm test` from repo root — pipeline 817/817, web 95/95,
  social 555/555 (down from 593/593; the deleted `wall-openings.test.ts` plus the deleted
  `chooseWallOpening`/`eligibleWallOpenings` describe blocks account for the drop — deletion, not skipping).
  Rendered the exact card T12 flagged (`meditations-02-006`, week 1 day 6 slot 1, `--date 2026-09-06 --slot 1`)
  and read frame 0 and an early mid-scroll frame: no numeral anywhere over the wall, and the running head
  ("MARCUS AURELIUS · MEDITATIONS, BOOK 2") now sits in its own unobstructed band exactly where T12 predicted
  the badge used to collide with it. The metadata sidecar carries no `opening` key at all.
  Also amended: the index plan's "Opening rotation for The Wall" paragraph now documents full retirement (not a
  two-way rotation) and names the three textual axes that replace the pressure it existed to answer
  (T18/T11-T12/T19); its Wall supply-table row and "Variation comes from..." sentence were updated to match.
  Plan 03's opening-tagging decision and its T12 metrics-schema bullet now record the opening comparison as
  CANCELLED, not deferred, and note `post-metadata.ts`'s `opening` field (which existed specifically for that
  comparison) is gone.
- [x] T18: Mid-chapter entry — vary frame 0's start point within the chapter block so consecutive posts do not
  open on the same beat, deriving the offset deterministically from the post index (never randomly — renders must
  be reproducible). Frame 0 must still be legible text mid-thought, never mid-word. Acceptance: two posts from
  the same card open at different points; the never-finishes invariant still holds at every offset.
  Done (2026-08-26): DESIGN DECISION (the plan's own "IMPORTANT TENSION" was left open on this point) — the
  chapter block itself is UNCHANGED: it still always starts at the target card's own `original_excerpt` (T05/T06
  not reopened). What varies is a new, separate transformation applied ONE LAYER UP, in `cli.ts`'s
  `buildRenderPlan`, after `loadChapterTextBlock` runs: `render/chapter-text.ts`'s new
  `applyChapterEntryOffset(chapterBlock, postIndex)` drops the first N words off the FRONT of the block, where N
  (`chapterEntryOffsetWords`) is `postIndex mod excerptWordCount` — bounded to the target card's OWN excerpt
  length, never past it into the following cards' text. Two consequences of that bound, both load-bearing: (1)
  honesty — whatever a given post's frame 0 shows is still, word for word, drawn from the target card's own
  excerpt, never another card's, so the wall stays recognisably "this card's passage" even though it no longer
  always opens on the excerpt's own first word; (2) the never-finishes invariant becomes trivial to prove: the
  offset can consume at most `excerptWordCount - 1` words (order of 100-200) off a block that's already an order
  of magnitude longer (2,196-3,305 words for the read-through slice) than the ~412-word travel floor, so the
  worst case was never close. The rejected alternative — starting the BLOCK itself elsewhere in the chapter (a
  different card's excerpt at the very front) — was rejected outright: it can skip the target card's own excerpt
  out of the visible wall entirely, breaking "the viewer sees the card's own passage during the wall", not just
  weakening it. `Wall.tsx` itself is untouched — it still renders whatever `chapterBlock` string it's given
  starting at scroll offset 0 (frame 0's velocity is already full, no ramp — the house rule holds unchanged), so
  T09's "frame 0 shows this string's own first words at the top of the frame" contract stays literally true; T18
  only changes WHICH string that is, never how the composition scrolls. `postIndex` is `cli-plan.ts`'s existing
  `postIndexForSlot` (already used to seed the music bed) — no new source of entropy, and no randomness anywhere.
  Cut always lands exactly on a word boundary (`\S+` token starts), never mid-word, by construction (slicing at
  a matched token's own start index).
  Tests: `social/src/render/__tests__/chapter-text.test.ts` — 15 new tests: `chapterEntryOffsetWords` is
  deterministic, varies across consecutive `postIndex` values, stays in `[0, excerptWordCount)` across a 500-value
  sweep, returns 0 for <2-word excerpts, and is defensive against a hypothetical negative `postIndex`;
  `applyChapterEntryOffset` returns the block unmodified at offset 0, returns a real suffix cut exactly on a word
  boundary for a nonzero offset, produces genuinely different openings for two different `postIndex` values on
  the same card (the acceptance criterion, direct), stays inside the target card's own excerpt at EVERY offset
  in its range (the honesty property), and handles the single-card-chapter case (no `\n\n` in the block). Plus
  one new test against the REAL 48-card read-through slice: every card's WORST-CASE offset
  (`excerptWordCount - 1`, the maximum possible truncation) still clears `computeWallLayout`'s travel floor —
  worst-case margin across the slice: **11,211.3px** (travel floor 2,538.8px; smallest real block still ~4.4x the
  floor after its own worst-case truncation). `npm test`: pipeline 817/817, web 95/95, social 566/566 (up from
  555 — 12 net new: the 15 above plus `tsc --noEmit` unaffected, clean).
  Rendered PROOF, not just unit tests: two real end-to-end CLI renders of the exact same real card
  (`happy-life-25-001`, Seneca, `On the Happy Life`) at two different `postIndex` values (1 and 139, the second
  via a throwaway fixture schedule week so a second real date/slot could reuse the same card content), frame 0
  extracted from each MP4 with ffmpeg. postIndex 1 (offset 1 word) opens "then, since we both agree that they are
  desirable, what my reason is amongst counting them among good things, and in what respects I should behave
  differently to..." (drops only the excerpt's own first word, "Learn,"). postIndex 139 (offset 139 words) opens
  "I prefer the magnificent house to the beggar's bridge. Place me among magnificent furniture and all the
  appliances of luxury: I shall not think myself any..." — genuinely different text, both fully legible, both cut
  exactly on word boundaries, neither mid-word. Both renders completed normally (1065 frames, 35.5s, house-profile
  MP4) — direct proof the never-finishes invariant held for both real offsets, not just the unit-tested bound.
- [x] T19: Sub-type spacing in the scheduler — `scripts/lib/schedule.ts` currently never reads `sub_types`. Space
  consecutive Wall slots so the same sub-type does not run on consecutive days where the pool allows it, and
  report when it cannot. Acceptance: a generated week shows no back-to-back repeat of `thou_wall`/`cascade`/
  `scene`; the read-through's card order is NEVER reordered to achieve it (it walks the book in order).
  Done (2026-08-26): worked out which slots are actually free to space BEFORE touching anything, per the task's own
  instruction. Slot 1 (the read-through) has NO pool at all — its card is fixed by sequence, so when it renders as
  Wall its sub-type is whatever `classifyWallSubTypes` finds on that exact, un-substitutable card; there is nothing
  to space it WITH. Slot 2 (the weighted free slot) DOES draw from a real pool (`RankedWallEntry[]`, which already
  carries `sub_types` from T07/T08/T21's own `rankWall`/scored-pool work) — this is the only slot the scheduler can
  actively space. So the implementation is two halves: slot 2 actively PREFERS a pool entry whose `sub_types` don't
  overlap the immediately preceding Wall slot's (filtering the candidate array before the existing single
  `selectWallBalanced` call, so rng consumption is byte-identical to before this task); slot 1 only ever REPORTS
  when its fixed card's sub-type repeats — it never swaps its own format to dodge a repeat, since that would
  perturb the Wall/Still ratio T02-T04 already tuned and measured, which is not this task's job and not what "the
  card order is never reordered" licenses touching.
  "Consecutive" is defined as immediately-adjacent slots in the week's own day/slot emission order (day N slot 1,
  day N slot 2, day N+1 slot 1, ...) — a non-Wall slot in between (Question/Objection/Still) already breaks
  "back-to-back" on its own (those formats look nothing alike at frame 0 to begin with), so the spacing state
  (`previousSlotWasWall`/`previousWallSubTypes`) resets to inactive after any non-Wall slot, tracked fresh within
  each `generateWeek` call (cross-week continuity was explicitly out of scope — the VERIFY block only asks for ONE
  generated week — and `generateWeek` stays pure/stateless across calls exactly as before; flagged as a followup
  below, not silently assumed away). The intersection check is non-exclusive-aware (`wallSubTypesIntersect`): a
  card matching `thou_wall` AND `cascade` shares "the same sub-type" with a purely-`cascade` neighbor and must
  still be avoided; a `reserve` entry (`sub_types: []`) never intersects anything, since it has no texture to
  repeat. Reports are `logger.warn` calls (same mechanism T21's own reserve-pool-exhaustion warning already uses,
  not a new field or channel) naming week/day/slot and the exact sub-type(s) that couldn't be avoided.
  Tests (`scripts/lib/__tests__/schedule.test.ts`, +2, both new, 123 -> 125): (1) a fully hand-traced, deterministic
  synthetic fixture — 7 read-through cards all fixed to `thou_wall` (guaranteed via a crafted qualifying landing
  line on every card, no rng-dependent branching) and an 8-entry free-slot pool split 4 `thou_wall`/4 `cascade`,
  with `weights: { wall: 1, question: 0, objection: 0 }` forcing every one of the 14 slots to Wall. Hand-derived and
  confirmed: days 1-4 space away from the fixed `thou_wall` by drawing the 4 disjoint `cascade` entries; once that
  supply is exhausted (day 5), the only entries left are `thou_wall`, which DOES repeat — and is reported, not
  silently accepted, on days 5-7 (5 total back-to-back-Wall pairs in the final 14-slot sequence, all 5 exactly
  reported: 3 slot-2 warnings, 2 slot-1 warnings, matched by day number and by each warning's own distinct wording).
  Also proves the hard constraint directly: the 7-card read-through sequence is unchanged and in order. (2) a
  real-corpus, 8-week, wall-dominant chain against the actual scored `content/social/premises/wall.json` pool,
  asserting an EXACT correspondence between real back-to-back sub-type repeats (independently re-derived per slot:
  `classifyWallSubTypes(card)` for read-through slots, the scored pool's own `sub_types` field for free-slot
  draws — i.e. the same source of truth `generateWeek` itself consults) and the count of logged spacing warnings —
  proving both that no repeat goes unreported AND that nothing is reported that didn't actually repeat.
  MEASURED on the real, seed-42, first-week generation (`npx tsx scripts/generate-schedule.ts --week 1 --seed 42
  --first-week --force`, inspected then reverted — see the note below on why it wasn't kept): per-day format/card
  sequence — day1 wall(`meditations-02-001`)/wall(`peace-of-mind-17-005`), day2 still(`meditations-02-002`)/
  question(`meditations-11-005`), day3 wall(`meditations-02-003`)/question(`discourses-18-001`), day4
  wall(`meditations-02-004`)/question(`on-anger-03-108`), day5 still(`meditations-02-005`)/wall(`on-anger-02-100`),
  day6 wall(`meditations-02-006`)/wall(`on-anger-01-027`), day7 wall(`meditations-02-007`)/question(`discourses-64-006`).
  Sub-types of every Wall card: `meditations-02-001`->`[thou_wall]`, `peace-of-mind-17-005`->`[]`,
  `meditations-02-003`->`[thou_wall]`, `meditations-02-004`->`[]`, `on-anger-02-100`->`[]`,
  `meditations-02-006`->`[thou_wall]`, `on-anger-01-027`->`[]`, `meditations-02-007`->`[thou_wall]`. The 4
  immediately-adjacent Wall pairs this real week actually produces — (day1 slot1, day1 slot2), (day5 slot2, day6
  slot1), (day6 slot1, day6 slot2), (day6 slot2, day7 slot1) — each pair has one `thou_wall` side and one `[]`
  (reserve) side, so NONE overlap: zero back-to-back sub-type repeats, and zero spacing warnings were logged for
  this run (confirmed by grep over stderr) — the acceptance criterion holds for real, not just in the synthetic
  fixture. Read-through order proof: captured the slot-1 `card_id` sequence from the previously-committed schedule
  before regenerating (`[meditations-02-001..007]`), regenerated, and confirmed the sequence is byte-identical
  after — the read-through was never reordered.
  Did NOT keep the regenerated `content/social/pilot-schedule-w01.json` — `git checkout --` reverted it back to the
  committed version after inspection. The regeneration command in this task's own VERIFY block is for INSPECTION;
  permanently regenerating week 1 is explicitly T20's job (the task brief's own "DO NOT touch" list), and the
  committed schedule is already known-stale relative to `content/social/render-exclusions.json`/`premises/wall.json`
  (both committed hours after the schedule file, per `git log`) for reasons entirely unrelated to this task (T08's
  travel-floor deletion and later premises work, not sub-type spacing) — regenerating it here would have bundled an
  unrelated, larger diff into this task's own commit.
  Follow-up (not built here, flagged for whoever owns it): true CROSS-WEEK spacing (the last Wall slot of week N
  vs. the first slot of week N+1) is out of scope — `generateWeek` stays a pure, single-week function with no
  memory of a prior week's trailing format, matching its existing architecture (`loadPriorWeeks` only tracks used
  card ids and the read-through cursor, never format history) and matching the task's own acceptance criterion,
  which only asks about "a generated week." If this matters later, it needs a new optional `GenerateWeekOptions`
  field (e.g. `priorLastWallSubTypes`) threaded through the CLI the same way `priorUsedCardIds` already is.
  Verified: `npx vitest run scripts/lib/__tests__/schedule.test.ts` — 125/125 (123 pre-existing + 2 new, zero
  regressions). `npm test` from repo root — pipeline 819/819 (up from 817), web 95/95, social 566/566 (unchanged —
  this task never touches `social/`). `cd social && npx tsc --noEmit` — clean.
- [x] T20: Regenerate week 1 and render all 14 posts; re-measure durations against the 15s/59s bounds and record
  the new Wall/Question/Objection/Still mix in this file. Acceptance: all 14 render; ffprobe confirms the profile;
  frames extracted at 0.0s / mid-scroll / cut / payoff show the intended reduction. Then T19's phone review.
  Done (2026-08-26): ran the plan's own Verify block exactly, in order.
  `npm test` (repo root, all three suites): **pipeline 819/819, web 95/95, social 566/566** — clean baseline before
  touching any artifact, confirms T01-T19 landed in a fully green state.
  `npx tsx social/scripts/write-exclusions.ts --date 2026-08-26`: Wall 685 passed/211 rejected (duration only, the
  travel axis stays gone per T08), Question 48/40, Objection 27/32, **read-through 30 passed/18 rejected** — the
  first time this branch has reproduced the plan's own headline "30 Wall / 18 Still" figure for real (T04 could only
  measure 16/32 pre-T08; T08 itself measured 30/18 against the pool but didn't regenerate the read-through-specific
  artifact past that one confirmation run). `content/social/render-exclusions.json` changed only in that it's
  byte-identical to what T08 already produced at this same date — no drift since.
  `npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force`: **format_counts { wall: 8,
  question: 4, objection: 0, still: 2 }**, author mix epictetus 2 (14.3%), marcus-aurelius 8 (57.1%), seneca 4
  (28.6%). Per-slot mix (day/slot/format/card/author):

  | day | slot | format | card | author | duration |
  |---|---|---|---|---|---|
  | 1 | 1 | wall | meditations-02-001 | marcus-aurelius | 20.501s |
  | 1 | 2 | wall | peace-of-mind-17-005 | seneca | 35.520s |
  | 2 | 1 | still | meditations-02-002 | marcus-aurelius | 15.018s |
  | 2 | 2 | question | meditations-11-005 | marcus-aurelius | 15.018s |
  | 3 | 1 | wall | meditations-02-003 | marcus-aurelius | 20.501s |
  | 3 | 2 | question | discourses-18-001 | epictetus | 15.018s |
  | 4 | 1 | wall | meditations-02-004 | marcus-aurelius | 15.018s |
  | 4 | 2 | question | on-anger-03-108 | seneca | 15.018s |
  | 5 | 1 | still | meditations-02-005 | marcus-aurelius | 15.018s |
  | 5 | 2 | wall | on-anger-02-100 | seneca | 38.506s |
  | 6 | 1 | wall | meditations-02-006 | marcus-aurelius | 23.509s |
  | 6 | 2 | wall | on-anger-01-027 | seneca | 23.509s |
  | 7 | 1 | wall | meditations-02-007 | marcus-aurelius | 15.018s |
  | 7 | 2 | question | discourses-64-006 | epictetus | 15.018s |

  This confirms T19's own real-week measurement (the schedule it inspected and reverted) reproduces byte-identical
  on a second, kept generation: same 8 read-through slot-1 cards in the same order, same free-slot picks, zero
  back-to-back Wall sub-type repeats (re-checked: the four adjacent Wall pairs this week produces — day1
  slot1/slot2, day5 slot2/day6 slot1, day6 slot1/slot2, day6 slot2/day7 slot1 — each pairs a `thou_wall` card
  against a `[]`-reserve card, never two of the same texture).
  Rendered all 14 (`for d in 01..07; for s in 1 2; ... render --date 2026-09-$d --slot $s`, split across two Bash
  calls only because of the tool's own 2-minute per-call timeout, not a render failure — every one of the 14
  exited 0 with no retries or fixes needed). `social/out/` holds exactly 8 wall / 4 question / 2 still MP4s (0
  objection, matching `format_counts`), each with matching `-feed.jpg` and `.json` metadata sidecar. Every metadata
  sidecar reads `"narration": false` (no `ELEVENLABS_API_KEY` set, so every render is the music-only path — no live
  API calls anywhere in this task, per its own instructions).
  **Duration check (15s floor / 59s global ceiling / 40s Wall ceiling):** all 14 durations are in the table above;
  every one is ≥15.018s (the encoder's own floor-padding rounds the nominal 15.000s up slightly) and ≤38.506s.
  Zero cards hit the 59s global ceiling (nothing above 38.506s). Zero Walls hit the 40s Wall-specific ceiling (max
  38.506s, `on-anger-02-100`, 1.494s of headroom) — matches T03's own predicted "p50 23.5s / p75 26.5-32.5s / max
  38.5s" shape almost exactly (this week's 8 real Walls: sorted 15.018, 15.018, 20.501, 20.501, 23.509, 23.509,
  35.520, 38.506 — median 22.0s, max 38.506s).
  **ffprobe profile:** the plan's own literal `ffprobe -v error -show_streams social/out/*.mp4` errors immediately
  — ffprobe only ever accepts ONE input file; passing a shell glob of 14 files makes it reject the 2nd+ as
  duplicate `-i` args (`Argument '...' provided as input filename, but '...' was already specified.`), a tool
  limitation not a render defect. Ran the equivalent per-file instead (`for f in social/out/*.mp4; do ffprobe -v
  error -show_entries format=duration -show_entries
  stream=index,codec_type,codec_name,width,height,pix_fmt,r_frame_rate,sample_rate,channels,profile,level ...;
  done`) across all 14: **every file** reports video `h264, profile=High, level=40, 1080x1920, yuv420p, 30/1 fps`
  and audio `aac, profile=LC, 48000Hz, 2 channels` — the full house profile, zero violations, zero exceptions.
  **Frame inspection** (Wall `meditations-02-001`, `social/out/wall-2026-09-01-slot1.mp4`, 20.501s, `WALL_FRAMES`
  75/2.5s, `LANDING_LINE_FRAMES` 90/3.0s — cut at frame 75, landing line frames 75-164): extracted frames 0
  (0.000s), 36 (1.200s, mid-scroll), 74 (2.4667s, the last wall frame, an instant before the cut), and 80 (2.667s,
  inside the landing-line window) with ffmpeg and read all four directly.
  - Frame 0: dense archaic body text, ~35 visible lines averaging ~7-8 words/line (counted: "Remember how long
    thou hast already put / off these things, and how often a certain day / and hour as it were, having been set
    unto / thee by the gods, thou hast neglected it..." continuing through "...man's happiness depends from
    himself, but" at the bottom edge) — a real page of a real book, not large print. The fixed running head
    `"MARCUS AURELIUS · MEDITATIONS, BOOK 2"` sits on an opaque backing plate partway down the frame (small,
    DM Sans, secondary grey `#736B62`-toned, unmistakably distinct from the dense serif body); the scrolling text
    is visibly interrupted at the plate's edges (fragment "ie" / "art a" bleeding at either side) proving the plate
    masks rather than composites over the moving text. **No numeral anywhere** — T17's deletion holds.
  - Frame 36 (mid-scroll): continuous, verbatim chapter text — the block has scrolled past this card's own excerpt
    ending ("...and never after return.") straight into "Let it be thy earnest and incessant care as a Roman and a
    man to perform whatsoever it is that thou art about..." with no gap, blank line, loop-back, or repeat. Same
    running head, same fixed position, still masking the scroll cleanly.
  - Frame 74 (the hard cut, an instant before it fires): still dense mid-passage archaic text, further into the
    same chapter continuation ("...Every man's happiness depends from himself, but behold thy life is almost at an
    end..."), confirming the cut lands mid-passage, not at a convenient excerpt boundary.
  - Frame 80 (first payoff window, 2.667s into the landing-line phase): **ONE plain sentence** — "There is only a
    certain amount of time given to you." — set dramatically larger than the wall's 44px body (measured earlier at
    T10 as 81-88px on this exact card's landing line), centred, motionless, with `"In plain English"` sitting in
    the exact slot the running head occupied during the wall phase, and `"Card 1 of 48"` (the read-through counter)
    above it. Large -> small, dense -> sparse is now visibly reversed from the pre-plan defect: eye reads
    wall (small, dense, archaic) -> cut -> payoff (large, sparse, plain), matching every acceptance bullet the task
    names: dense 44px wall (not large print), no numeral, continuous verbatim scroll, an audible/visual hard cut,
    and a single larger plain sentence with the "In plain English" label in the framing slot.
  Verified: `cd social && npx tsc --noEmit` clean (unaffected — no source touched, only regenerated artifacts and
  fresh renders). `content/social/render-exclusions.json` and `content/social/pilot-schedule-w01.json` both changed
  in the working tree as expected (this task owns their regeneration) — left uncommitted per instructions.
  `social/out/` (gitignored) holds all 14 renders plus feed JPEGs and metadata sidecars; not committed.
  **T19's phone review is a human step and was not performed here** — the renders are in `social/out/` for that
  review. Everything else in this task's acceptance criteria is met.

## Verify
Updated by D04 (2026-08-27) for the post-D02 single-slot shape — `--slot` no longer exists on either
command, and there is one render per day, not two:
```
npm test
npx tsx social/scripts/write-exclusions.ts --date <today>
npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force
for d in 01 02 03 04 05 06 07; do npx tsx social/src/cli.ts render --date 2026-09-$d; done
for f in social/out/*.mp4; do ffprobe -v error -show_streams "$f"; done   # ffprobe takes one input at a time
```

## Follow-up
- [ ] F20: If the 18 Stills read as filler after T19's phone review, recover Walls by improving landing-line
  SELECTION (an LLM pick like the pool's `rubric.chosen_landing_line`, extended to the whole read-through slice)
  rather than by loosening the mechanical word cap — measured above as buying 3 cards at the cost of payoff
  quality. Only 21 of the 48 slice cards are in the scored pool today.

### Review follow-up (code review of PR #41, 2026-08-26)

Six must-fix findings. M2/M3/M4 share one root cause: the plan's measurements and the read-through slice
are both Meditations, which has by far the LONGEST chapters (median 5,355 words) and the SHORTEST source
references in the corpus. Measured chapter medians: enchiridion **94**, happy-life 440, shortness-of-life
502, peace-of-mind 709, discourses 812, meditations 5,355, on-anger 13,456. Never-finishes needs ~412
words. The work is correct for the slice it was tested against and breaks outside it.

- [x] R01: Fix the red suite — `social/src/__tests__/cli.test.ts` (lines ~122, 139-142, 227, 245, 504) still
  asserts the pre-T20 week-1 schedule. Repoint at the regenerated slots: day 1 slot 1 → `wall`
  `meditations-02-001`, slot 2 → `peace-of-mind-17-005`; the Still e2e/dry-run tests → day 2 slot 1
  (`meditations-02-002`). Acceptance: `npx vitest run src/__tests__/cli.test.ts` 22/22; root `npm test` green.
  DONE 2026-08-26: Verified the reviewer's suggested slots against the regenerated
  `content/social/pilot-schedule-w01.json` — they matched exactly. Repointed 5 assertions plus their
  explanatory comments (day 1 slot 1 is genuinely `wall` now — its landing line is a real substring, not the
  whole passage; day 1 slot 2 is `peace-of-mind-17-005`; the Still dry-run and e2e tests moved to day 2 slot 1,
  `meditations-02-002`, whose plain_english has no qualifying landing line per
  `render-exclusions.json`'s `read_through` section, so it genuinely falls through to Still). Also fixed three
  other now-stale "day 1 falls through to Still" comments elsewhere in the same file (the `computeWallPlainLines`
  test and the Wall/Still e2e describe blocks) for consistency, since they made the same now-false claim.
  `npx vitest run src/__tests__/cli.test.ts` — 22/22. `npx tsc --noEmit` — clean. Root `npm test` — green
  (819 pipeline, 95 web unit, 566-568 social depending on concurrent R02 work landing mid-run; one transient
  failure in `social/src/render/__tests__/chapter-text.test.ts` during a run that overlapped with R02's
  in-flight edit — unrelated to this task, confirmed by an isolated rerun passing 28/28, and by a subsequent
  full `npm test` passing clean).
- [x] R02: Restore the never-finishes guarantee for SHORT chapters — `social/src/render/chapter-text.ts`.
  `buildChapterTextBlock` returns exactly one lap, which clears the 2,538.75px travel floor only in
  Meditations. Measured: 53 of 685 non-excluded Wall pool entries fail at offset 0, 25 more at T18's
  worst-case offset (78 total, 11%). Repeat the lap until the block clears the floor (keeping the text
  verbatim and the wrap honest), or restore a gate axis fed the CHAPTER BLOCK rather than the single card.
  Acceptance: a test sweeping EVERY non-excluded entry of `content/social/premises/wall.json` — not the
  48-card Meditations slice — asserts the block clears the floor at both offset 0 and `excerptWordCount - 1`.
  DONE 2026-08-26: Chose repeat-the-lap over restoring the gate axis — measured both options directly before
  deciding. A single lap (the gate-axis option's own input) already fails to clear the floor for Enchiridion's
  MEDIAN chapter (94 words, one lap), so gating on it would have rejected roughly that whole book's Wall pool,
  not just its short tail; repeating is provably convergent instead (every extra whole lap adds its full,
  untrimmed height — T18's worst-case offset only ever trims the FIRST lap, by at most `excerptWordCount - 1`
  words, never a later one) and measured cheap: across all 685 non-excluded pool entries, worst case needs 6
  laps (median 1, i.e. most chapters already clear the floor unmodified), and 0 entries fail to converge even
  at a 100-lap defensive cap. `buildChapterTextBlock` now repeats its one-lap sequence whole (verbatim,
  `\n\n`-joined, same as the existing chapter-wrap seam) until `computeWallLayout` on the block — simulated at
  T18's own worst-case offset — clears `WALL_TRAVEL_FLOOR_PX`; throws (rather than silently under-supplying)
  if the 100-lap cap is ever hit, which no real chapter does. Supply is UNCHANGED (still 685/896 Wall,
  unaffected `render-exclusions.json` — no gate axis touched, no regeneration needed). On honesty: the repeat
  is only ever visible by pausing frame-by-frame (confirmed below); at ~1,900wpm nobody reads far enough into
  a 2.5s wall to consciously notice a short chapter looping, and looping is not a new KIND of thing this
  function does — it already wraps chapter-end back to chapter-start once per lap; this only continues past
  that same seam. Added a new `chapter-text.test.ts` suite sweeping all 685 non-excluded `wall.json` entries
  (not just the 48-card Meditations slice) at offset 0 AND at each entry's own worst-case offset — passes,
  reporting worst margins of 706.3px (offset 0) and 46.3px (worst-case offset) over the 2,538.75px floor.
  Updated 4 synthetic-fixture tests whose short strings now legitimately repeat (added
  `expectRepeatedExcerptSequence`) and one T18 guard test to construct its no-`\n\n` input directly rather than
  via `buildChapterTextBlock` (which can no longer produce that shape for a short solo-card chapter). Rendered
  `discourses-37-001` (the reviewer's repro: a single-card, 89-word chapter) frame 0 and the last wall frame
  (frame 74) — both now show text packed edge to edge, top to bottom, no blank paper under the running head.
  `npx tsc --noEmit` clean. `social` suite: 30 files, 568 tests green. Root `npm test`: 819 pipeline + 95 web
  unit + 568 social, all green.
- [x] R03: Thread the chapter block into `Question.tsx` — it still feeds `WallPhase` the card's own
  `originalExcerpt` (T09 wired only `Wall.tsx`), so at 44px its archaic phase is ~1100px against a 1920px
  frame and ALL 48 non-excluded question-pool cards under-fill. Add `chapterBlock` to `QuestionProps`, load it
  in `cli.ts`'s question branch, and apply T18's entry offset consistently. Acceptance: rendered block height
  exceeds the travel floor for a real Discourses card; a frame shows no blank lower half.
  DONE 2026-08-26: Added optional `chapterBlock?: string` to `QuestionProps` (mirrors `WallProps.chapterBlock`'s
  doc comment and contract exactly) and changed `Question.tsx`'s archaic-wall-phase render to
  `const wallText = props.chapterBlock ?? props.originalExcerpt;` fed to `WallPhase` — same fallback pattern as
  `Wall.tsx`, so any caller that hasn't been updated (Remotion Studio's `defaultProps`, existing component
  tests) keeps rendering exactly as before. `cli.ts`'s `question` branch now calls
  `applyChapterEntryOffset(loadChapterTextBlock(slot.book_slug, slot.card_id), postIndex)`, the identical call
  the `wall` branch already made, and threads `chapterBlock` through `QuestionPlan` and `buildInputProps`.
  `Root.tsx`'s Question `calculateMetadata` needed no change — duration there is `QUESTION_HOLD_FRAMES +
  WALL_FRAMES + answerFrames`, none of which depend on the wall-phase text length (the wall phase's frame count
  is fixed, same as `Wall.tsx`), and the wall-phase font/inset are fixed too (`WALL_FONT_SIZE`), so
  `computeWallLayout`'s only text-dependent field (`blockHeight`) was already unused by `WallPhase`'s own
  rendering — matches `Wall.tsx`'s own gate/layout-off-`originalExcerpt`-render-`chapterBlock` split precisely.
  Added a new `chapter-text.test.ts` suite: (1) three targeted tests for `discourses-64-006` (the reviewer's
  repro) proving its own bare `original_excerpt` alone falls short of the 2,538.75px travel floor but the
  chapter block clears it at both offset 0 and T18's worst-case offset, and (2) an R03 acceptance sweep across
  all 48 non-excluded `content/social/premises/question.json` entries (mirrors R02's wall.json sweep) — passes,
  worst margins 486.3px (offset 0) and 101.3px (worst-case offset) over the floor, zero shortfalls. Rendered
  `discourses-64-006` as a real Question via a scratch schedule fixture + `cli.ts render`: extracted the wall
  phase's first frame (frame 45) and last frame (frame 119) with ffmpeg. Measured ink extent (darkest-pixel row
  scan): BEFORE (reviewer's own report) — first frame ink ended at row 1155/1920, last frame at row 553/1920,
  roughly two-thirds blank paper. AFTER (this fix) — first frame ink runs to row 1919/1920, last frame to row
  1919/1920 — both frames full to the bottom edge, no blank lower half. `npx tsc --noEmit` clean. Root
  `npm test`: 819 pipeline + 95 web unit + 573 social, all green (33 tests in `chapter-text.test.ts`, up from 28
  pre-R03; also added the missing `chapterBlock` field to `narration.test.ts`'s `QUESTION_PLAN` fixture, which
  the widened `QuestionPlan` interface now requires).
- [x] R04: Clamp the running head — `social/src/remotion/SourceHead.tsx` paints into a fixed 900x120 plate
  with no wrap handling, but `formatRunningHead` returns up to 135 chars (Discourses chapter titles), which
  wraps to 4 lines / 128px and spills outside `SOURCE_HEAD_BOUNDING_BOX` over the scrolling wall, breaking
  T11's `assertIdenticalOutsideBoxes` proofs. 18 wall-pool + 3 question-pool cards exceed 110 chars.
  Acceptance: a `source-head.test.ts` case using a real long Discourses `source_reference` asserts rendered
  ink stays inside the bounding box.
  DONE 2026-08-26: Clamped the running head/payoff span to a SINGLE LINE via CSS (`overflow: hidden`,
  `whiteSpace: 'nowrap'`, `textOverflow: 'ellipsis'`, `minWidth: 0` to defeat the flex item's default
  `min-width: auto`), rather than pre-truncating the string by character count — the real Chromium text
  shaper Remotion renders through measures actual DM Sans glyph widths, so this is correct for every string,
  not just today's profiled outliers. New `SOURCE_HEAD_TEXT_MAX_WIDTH_PX` (`source-head-layout.ts`) sets the
  clamp width to `SOURCE_HEAD_BOUNDING_BOX.width - SOURCE_HEAD_SAFE_INSET_PX` (836px) — deliberately the SAME
  content width the text already had today, not narrower, so the plan's own worked example ("MARCUS AURELIUS
  · MEDITATIONS, BOOK 2", 37 chars) is provably unaffected (verified: its existing pixel-render test is
  unmodified and still passes). Because `formatRunningHead` always puts author+book FIRST and any long
  descriptive chapter clause LAST, a right-hand ellipsis on the whole string naturally cuts the least
  important part while preserving the most important part — no special-casing needed, and the truncation
  stays factually true (a visible "…" signals more exists, rather than silently dropping it). Longest real
  `source_reference` in the corpus, verified by scanning every `content/output/` chapter file: 135 chars,
  `discourses/that-when-we-cannot-fulfil-...json` → "EPICTETUS · DISCOURSES, THAT WHEN WE CANNOT FULFIL THAT
  WHICH THE CHARACTER OF A MAN PROMISES, WE ASSUME THE CHARACTER OF A PHILOSOPHER". Two new proofs in
  `source-head.test.ts`: (1) a real Remotion pixel-render of that longest card asserting ink stays inside
  `SOURCE_HEAD_BOUNDING_BOX` (`assertIdenticalOutsideBoxes`) and does draw something (`assertBoxDiffers`); (2)
  a fast real-Chromium-DOM-measurement sweep (Playwright directly, the same technique `render/card.ts` already
  uses for its own overflow check, plus the real base64-embedded DM Sans via `render/fonts.ts`'s `getFontCss`)
  across every one of the 83 distinct running-head strings the whole corpus actually produces, asserting each
  clamped span's `getBoundingClientRect().right` never exceeds the plate's right edge — chosen over 83+ full
  Remotion video-frame renders (~400ms each) for suite-runtime reasons, while still exercising real layout +
  real font metrics for every distinct case, not a character-count heuristic. `npx tsc --noEmit` clean.
  `source-head.test.ts`: 27/27 (up from 25). Root `npm test`: 819 pipeline + 95 web unit + 575 social, all
  green (full suite run alongside R02/R03/R05/R06 landing concurrently). Rendered a real Wall composition (not
  just the test harness) for `discourses-24-005` (same 135-char chapter title) at a mid-scroll frame and for
  `meditations-02-001` at the same offset, extracted PNGs, and read them: the Discourses head renders
  "EPICTETUS · DISCOURSES, THAT WHEN WE CAN…" on one line, fully inside its opaque plate, with the scrolling
  wall text visible above and below but never showing through or overlapping it; the Meditations head still
  renders "MARCUS AURELIUS · MEDITATIONS, BOOK 2" in full, unclipped, byte-for-byte the same as before this
  change.
- [x] R05: Guard T15's hard stop — `social/src/audio/__tests__/mix.test.ts`. Neither the `FLOOR` →
  `HARD_STOP_RAMP_MS` branch nor the `asetnsamples=n=128` insertion is asserted anywhere; the existing
  silence test samples a full second inside the span, so it passes either way. Add (a) a `bedEnvelope` unit
  assertion that `{atMs: 2500, gainDb: 0}` is immediately followed by `{atMs: 2505, gainDb: -60}`, and (b) a
  real `mix()` case asserting `meanVolumeDb(out, 2.6, 5.4) < -60` and `meanVolumeDb(out, 0.5, 2.4) > -30`.
  Acceptance: (b) fails if `asetnsamples` is removed.

  Done (2026-08-26). Added two tests, not the ten-plus this entry originally sketched — two were enough to
  cover both named gaps and both satisfy the real acceptance criterion (proven, not assumed — see below).
  (a) A `bedEnvelope` unit case (`bedEnvelope(8000, [], [{startMs:2500,endMs:5500}])`) asserts the array
  contains `{atMs:2500,gainDb:0}` immediately followed (next array element, not just "found somewhere") by
  `{atMs: 2500 + HARD_STOP_RAMP_MS, gainDb: -60}` — imports and asserts the real `HARD_STOP_RAMP_MS` (5)
  rather than hardcoding it; `-60` is hardcoded with a comment, since `SILENCE_FLOOR_DB` is a private,
  unexported constant in `mix.ts` (matches how the pre-existing "silence is honoured" tests already assert
  against unexported-constant-shaped thresholds, e.g. `-45`).
  (b) A real `mix()` case renders `bed-05-g-sus4` (T15's own manually-verified bed) with
  `silentSpans: [{startMs: 2500, endMs: 5500}]` (mirrors `cli.ts`'s `wallSilentSpans` shape exactly) and no
  narration, then asserts `meanVolumeDb(out, 0.5, 2.4) > -30` (audible before the cut) and
  `meanVolumeDb(out, 2.55, 5.4) < -60` (near-silent after it) — **deviated from the plan's literal `2.6`
  lower bound to `2.55`, and this is load-bearing, not cosmetic**. Proved empirically (not assumed) before
  committing to either number: temporarily stripped `asetnsamples=n=128` from `renderBedTrack` and re-ran
  the real `mix()` pipeline (amix + two-pass loudnorm + AAC encode) at fine-grained windows. Through this
  exact pipeline, removing `asetnsamples` delays the cut into audibility through `[2.55s, 2.6s)` (measured
  ~-14dB there, ~-31.8dB over `[2.55s, 5.4s)`) but the stale frame has already resolved to silence by `2.6s`
  either way (~-73dB with or without the fix) — so a window starting at `2.6s`, as the plan sketch specified,
  does NOT discriminate the regression in the full pipeline (confirmed: with the literal `2.6` window, the
  test stayed green even with `asetnsamples` removed — a worthless guard, exactly what this task exists to
  avoid). This is a real, environment-specific measurement — the raw bed track *alone* (no amix/loudnorm/AAC)
  showed the stale gain persisting slightly later (toward `2.6`-`2.65`), so the discriminating window shifts
  once the rest of the pipeline (particularly the AAC encode) is in the loop; `2.55` is what's proven to work
  against the actual code path this test exercises. Full remove-and-restore proof, run end to end:
  (1) baseline `mix.test.ts` green (22/22) with `mix.ts` unmodified; (2) removed `asetnsamples=n=${VOLUME_ENVELOPE_FRAME_SAMPLES},`
  from `renderBedTrack`'s filter string only — the new (b) test went red
  (`expected -31.8 to be less than -60`), all 21 others stayed green; (3) restored `mix.ts` from a pre-edit
  copy, confirmed byte-identical via `diff` and `git diff` (empty), reran — 22/22 green again. `git diff
  social/src/audio/mix.ts` is empty at hand-off; only `mix.test.ts` changed. `npx tsc --noEmit` clean. Root
  `npm test`: 819 pipeline + 95 web unit + 587 social, all green (full suite run alongside R06 landing
  concurrently — see that entry's note on the "12 new mix.ts tests" figure it cites, which predates this
  entry and should be read as 2, not 12).
  Files: `social/src/audio/__tests__/mix.test.ts` (imports `HARD_STOP_RAMP_MS`; two new `it`s — one under
  `describe('bedEnvelope', ...)`, one a new `describe` under `describe('mix', ...)`). `mix.ts` untouched (test-only task).
- [x] R06: Hold the 2.5s motionless floor in `objection-timing.ts` (lines ~182-191). T16 made
  `replyLineFrames[0]` follow `narrationTimings[0]` with only a 1-frame floor, and unlike the second reply
  line it is never extended by `padToMinimumDuration` — a ~1.8s narrated first sentence yields a 54-frame
  motionless payoff, violating the house rule. Acceptance: a 1.5s first-line timing still yields
  `endFrame - startFrame >= 75`.

  Done (2026-08-26). `computeObjectionTiming`'s reply-line map now clamps EACH narration-driven line's
  duration to `OBJECTION_REPLY_MIN_FRAMES` (a new export, `Math.round(OBJECTION_REPLY_MIN_SECONDS * FPS)` =
  75 frames), not just line 0 — investigation turned up that line 1 (the "final" line, previously assumed
  protected by `padToMinimumDuration`) is ONLY protected when the schedule's raw pre-pad total still falls
  under the 450-frame/15s pad point; a long first sentence (e.g. 13s) plus a genuinely short second sentence
  (e.g. 0.3s, still gate-legal — the gate only requires two COMPLETE sentences, nothing about minimum length)
  clears that pad point before padding is even considered and leaves line 1 at its raw, unfloored duration.
  Both lines now get the same one-line clamp; the no-`narrationTimings` fallback path (`OBJECTION_REPLY_LINE_FRAMES`,
  already exactly 2.5s) is untouched. Concrete numbers: a 1.5s narrated first line was 45 frames pre-fix, is
  75 frames post-fix (`objection-timing.test.ts`'s new "R06" describe asserts this exactly, plus the
  long-first/short-second edge case). Consequences considered and confirmed, not assumed:
    - **Trailing silence is the intended tradeoff, not a bug**: when narration is shorter than the floor, the
      line now holds up to ~1s longer than the voice — silence at the end of the hold. The plan already
      treats a beat of silence as part of this format's grammar (T15's "the cut must be audible"), so this is
      deliberate, documented in `ObjectionTimingInput`'s doc comment, not an accidental side effect.
    - **59s ceiling**: the clamp only ever RAISES a duration already under 75 frames up to 75 — worst case
      +74 frames (~2.5s) per line, and only when narration is unusually short (well under 2.5s, itself an
      unusual case for a full sentence). `padToMinimumDuration` already throws if a schedule is over 1770
      frames (59s) before padding; nothing in this change moves a schedule closer to that ceiling in any
      realistic case — verified with the same 13.0s/0.3s edge-case fixture used in the test (total 507
      frames, nowhere near 1770).
    - **`assertNarrationInSync` (`audio/timing.ts`) is unaffected**: it operates on the raw
      `NarrationLineTiming[]` array BEFORE it ever reaches `objection-timing.ts` — checks monotonic
      ordering/no-overlap/non-positive-duration and drift of the LAST line's `endSeconds` against the actual
      audio file duration. It has no visibility into the frame schedule at all, so holding a line's ON-SCREEN
      window longer than its narrated duration cannot make this gate start failing (confirmed by reading the
      function, not assumed).
    - **A real architectural gap this fix does NOT close, flagged for follow-up**: `cli.ts`'s
      `narrationPlan`/`prependSilence` synthesize The Objection's two reply sentences as ONE continuous TTS
      clip, placed at a single fixed offset (`objection.endFrame`) and played straight through — the split
      between line 0's speech and line 1's speech is whatever gap the TTS take itself has, not something
      re-synced to the video's own (now-padded) per-line frame boundaries. Once T14's live voices land, a
      real narrated first line under 2.5s will cause line 1's SPOKEN AUDIO to begin slightly before its own
      TEXT appears on screen (audio arrives up to ~1s early relative to the padded hold), because only the
      VIDEO schedule was taught to hold longer here — the audio track was not correspondingly delayed. Fixing
      that requires splicing the two reply sentences into separately-placed audio clips in `cli.ts`/`narration.ts`
      (each offset to its own frame window's start), which is out of this task's scope (`cli.ts` was on the
      DO NOT TOUCH list) and a materially bigger change than a timing-module clamp. Not filed as a numbered
      follow-up task in this plan — noted here for whoever picks up T14 next, since the gap is unreachable
      (`VOICES_ARE_UNSET`) until then.
    - **Question does NOT share this gap** (verified, not assumed): its answer phase is the only narrated
      phase, and the fixed question hold + wall phase ahead of it (`QUESTION_HOLD_FRAMES + WALL_FRAMES` = 120
      frames) is always far enough under the 450-frame pad point that `padToMinimumDuration` fires
      unconditionally whenever the answer is short — proven algebraically (padding fires whenever
      `120 + answerRaw < 450`, i.e. whenever `answerRaw < 330` frames = 11s, which is always true when
      `answerRaw` is under the 75-frame floor being checked) and confirmed with a direct 0.2s-narrated-answer
      test against `checkPayoffMotionless` (held 330 frames, 11x the floor).
    - **The Wall has the SAME class of bug for its NON-FINAL rest lines** (confirmed with a concrete
      `checkPayoffMotionless` fixture — a 0.2s-narrated non-final rest line holds only 6 frames, 0.2s, well
      under the 2.5s floor) — only the LAST rest line is ever extended, and only when padding fires.
      Deliberately NOT fixed here (report-only, per this task's explicit scope): fixing it needs the floor
      applied to every rest line, not just the first, which is the Wall's own, separate follow-up.
    - **`house-rules.test.ts`'s `checkAllFormats` did not, and still does not, catch this class of bug**,
      because its `FORMATS` registry always calls every `compute*Timing` with no `narrationTimings` — the
      fixed-duration fallback path, which by construction already meets the floor. `checkPayoffMotionless`
      itself (the underlying checker) is general-purpose and DOES catch a too-short narration-driven hold the
      moment it is given one — confirmed by feeding it real narration-driven schedules directly. Added a new
      `describe` block to `house-rules.test.ts` (not touching `checkAllFormats`/`FORMATS` itself, to avoid
      making the shared production registry start failing on Wall's separate, unfixed gap) that exercises
      `computeObjectionTiming`/`computeQuestionTiming`/`computeWallTiming` with short narration directly
      against `checkPayoffMotionless` — passing for Objection (post-fix) and Question (structurally
      protected), and asserting Wall's known gap still fails today, so a future Wall fix has a test to flip
      green rather than one to newly write.
  Files: `social/src/remotion/objection-timing.ts` (the clamp + `OBJECTION_REPLY_MIN_FRAMES` export + doc
  comments), `social/src/remotion/__tests__/objection-timing.test.ts` (new "R06" describe, 5 tests),
  `social/src/render/__tests__/house-rules.test.ts` (new "R06" describe, 5 tests; imports
  `computeWallTiming`/`computeQuestionTiming`/`computeObjectionTiming`). `npx tsc --noEmit` clean. Root
  `npm test`: 819 pipeline + 95 web unit + 587 social (up from 575 — R05's 12 new mix.ts tests landed
  concurrently plus this task's 10), all green.

  Follow-up (not filed as a numbered task — flagged for whoever does T14 or the Wall non-final-line fix):
  (1) The Objection's two-reply-sentence narration needs per-line audio splicing in `cli.ts`/`narration.ts`
  once T14 lands, so a padded first-line hold doesn't let the second sentence's audio arrive before its own
  text. (2) The Wall's non-final rest lines need the same floor this task added to Objection's two lines,
  generalized to an array of any length — `house-rules.test.ts`'s new Wall regression test is already in
  place to confirm the fix once it lands.

- [x] R07: Fix R04's descender clip — `social/src/remotion/SourceHead.tsx` (span style, ~lines 187-197). The
  `overflow: hidden` clamp added by R04 clips to the span's padding box, whose height is the 32px line box,
  but DM Sans' content area at 32px/`lineHeight: 1` is 37px — so the `p` and `g` of `PAYOFF_LABEL_TEXT`
  ("In plain English") are flat-cut on every render, across the whole payoff phase of Wall, Question AND
  Objection. Measured in real Chromium: unclamped ink rows 47-78, clamped 47-75, 47 differing pixels;
  `scrollHeight` 37 vs `clientHeight` 32. The all-caps running head is unaffected, which is why R04's own
  corpus sweep (`source-head.test.ts:490`, which measures only `getBoundingClientRect().right`) and T11's
  pixel proofs stayed green — nothing asserts the VERTICAL axis. Fix with `paddingTop`/`paddingBottom: 8`
  (verified 0 differing pixels vs the pre-R04 payoff render, 135-char Discourses clamp unchanged), or
  `lineHeight: 1.4`. Acceptance: a test asserts the PAYOFF variant's vertical ink extent — the axis the
  existing sweep does not cover — and the Discourses horizontal clamp still holds.

  Done (2026-08-26). Chose `paddingTop`/`paddingBottom: SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` (8px, a new
  export in `source-head-layout.ts`) over a taller `lineHeight`: padding is a fixed, measured allowance that
  changes nothing about how the text is laid out or measured (same line height, same baseline, same glyph
  metrics) — it only gives the clip box enough room not to cut into them — whereas `lineHeight: 1.4` would
  have made the exact vertical-centring math depend on the browser's own half-leading distribution, one more
  moving part than needed to fix a fixed, measured 5px shortfall (37px content vs 32px line box). Verified by
  literally reproducing the reviewer's own measurement, not just trusting the fix by inspection: rendered the
  real payoff variant through the harness/pixel-proof machinery this suite already uses, scanning
  `SOURCE_HEAD_BOUNDING_BOX` (top 200, height 120) for non-PAPER rows. Pre-fix (padding 0, R04's shape):
  ink rows 247-275 (relative 47-75). Post-fix: ink rows 247-278 (relative 47-78) — the exact 47-75-vs-47-78
  split the reviewer reported, reproduced independently. Then rendered the real pre-R04 `SourceHead.tsx` (via
  `git show 91b3a9f^`, before any clamp existed) and diffed it pixel-for-pixel against the post-R07 render:
  **0 differing channel values across the entire 1080x1920 frame** — the padding fix is visually identical to
  the original, pre-clamp payoff render, exactly as claimed. Re-rendered the 135-char Discourses running head
  (R04's own worst case) and read the PNG: still a single line, ellipsis-truncated, fully inside the opaque
  plate, wall text visible immediately outside it — unaffected, since `paddingTop`/`paddingBottom` don't
  interact with the `maxWidth`/`overflow`/`whiteSpace` horizontal clamp (default `box-sizing: content-box`
  means padding doesn't add to measured width either). Added a witness-pattern test pair to
  `source-head.test.ts` (mirroring the file's own "wall text actually moved" witness for the fixed-head
  proof): (1) a span built with zero vertical padding (the pre-R07 shape) has real-Chromium `scrollHeight`
  strictly greater than `clientHeight` for `PAYOFF_LABEL_TEXT` — proves the probe itself can detect the bug,
  not just that it's blind to it; (2) the real component's own span (`SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX`)
  never lets `scrollHeight` exceed `clientHeight` — proves the fix. Also updated the corpus sweep's mirrored
  probe markup (`source-head.test.ts` ~line 514) to include the same vertical padding, so it stays a faithful
  copy of the real component's inline styles per its own doc comment, even though vertical padding doesn't
  affect that sweep's horizontal-only assertion. `SOURCE_HEAD_BOUNDING_BOX` (120px) has ample room left over
  for the new 48px-tall padded span, so it cannot spill outside the plate or collide with
  `COUNTER_BOUNDING_BOX` (documented in the new constant's own doc comment, referencing
  `SOURCE_HEAD_TOP_PX`'s existing disjoint-by-construction proof).
  Files: `social/src/remotion/SourceHead.tsx` (span style + R07 doc comment), `social/src/remotion/source-head-layout.ts`
  (new `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` export + doc comment), `social/src/remotion/__tests__/source-head.test.ts`
  (new import, updated corpus-sweep probe markup, new "vertical ink extent" describe block with 2 tests).
  `npx vitest run src/remotion/__tests__/source-head.test.ts` — 29/29 (up from 27). `npx tsc --noEmit` clean.
  Root `npm test`: 819 pipeline + 95 web unit + 589 social, all green.

## User feedback (2026-08-27)

Phone review of the Wall format. Five items, plus the interactions they force. Decisions taken with the user
in the same session are recorded inline.

**CONSTRAINT AMENDMENT (U05).** The plan's rule was "**No logo, URL or watermark in frame.** The running head
names the *book*, never Plain." U05 adds a closing frame reading `thinkplain.ai`. This is the product owner
amending their own constraint, deliberately: the rule was written against furniture pinned OVER content (the
saturated niche's visual language, and the reason T17 deleted the numeral badges). A dedicated end card after
the content ends is a different object. Rule as amended: **no logo, URL or watermark over content; a closing
frame may name the product.**

- [x] U01 (DONE 2026-08-27): Give the framing plate visual contrast — `social/src/remotion/SourceHead.tsx`,
  `social/src/render/theme.ts`. Today the plate is `PAPER` (#FAF7F2), identical to the page, so the running
  head reads as text floating on the same surface as the passage rather than as a distinct overlay. Use the
  tokens `docs/BRANDING.md` already defines for exactly this: Tag background `#F0EDE8` for the plate fill and
  Border `#E8E2D9` for a hairline rule along its lower edge. Add both to `theme.ts` (only PAPER/INK/SECONDARY/
  ACCENTS exist today) and keep them in sync with the branding doc. NEVER an accent colour — the plan forbids
  it for framing text because it reads as branding. Apply to BOTH variants (running head and payoff label):
  they share one slot and one treatment, and tinting only one breaks the "book page → not a book page"
  grammar T12 built. Acceptance: the plate is visibly distinct from the page at phone size; T11's
  `assertIdenticalOutsideBoxes` / bounding-box proofs still hold; no accent colour used.
  DONE: added `BORDER` (#E8E2D9) and `TAG_BACKGROUND` (#F0EDE8) to `theme.ts`, each doc-commented against the
  branding doc's Border/Tag background rows. `SourceHead.tsx`'s single shared plate `<div>` (both variants
  render through it, so there is no way for the two to diverge) now fills with `TAG_BACKGROUND` instead of
  `PAPER` and adds `borderBottom: 1px solid BORDER` with `boxSizing: 'border-box'` (so the hairline doesn't
  push the box past its own fixed height). No `ACCENTS` reference added — `source-head.test.ts`'s source-guard
  block (which greps the file for every accent hex and for `ACCENTS`) still passes.
  Verified: `npx vitest run src/remotion/__tests__/source-head.test.ts` 29/29. `npx tsc --noEmit` clean. Root
  `npm test`: 819 pipeline + 95 web unit + 588/589 social — the one social failure
  (`question-timing.test.ts`'s end-to-end smoke test) was a 120s timeout under concurrent CPU load (this
  task's own Wall render plus U04's parallel work); rerun alone it passes 46/46 in 1.8s, and it is not a file
  this task touched. Rendered a real Wall (`--date 2026-09-06 --slot 1`) and read frames at both mid-scroll
  (running head over moving archaic text) and payoff (label over the still plain-English sentence): the plate
  now reads as a distinct warm-grey band with a visible, non-heavy hairline rule at its lower edge, text fully
  legible, same treatment on both variants. Frames and a cropped close-up are in the scratchpad the task
  supplied; not committed to the repo.
- [x] U02 (DONE 2026-08-27): Move the read-through counter to CENTERED BELOW the card text —
  `social/src/remotion/Counter.tsx`, `counter-layout.ts`, and the four compositions that render it. **Interaction
  to resolve first:** `source-head-layout.ts` derives `SOURCE_HEAD_TOP_PX` from `COUNTER_BOUNDING_BOX.top +
  height + gap` — that derivation exists specifically so the two framing boxes are disjoint BY CONSTRUCTION
  (T11). Moving the counter out from under the running head breaks the premise, so the running head needs its
  own top-left anchor and the non-collision proof needs re-establishing on the new geometry rather than
  deleted. Note the counter renders in all four compositions (`Wall.tsx`, `Question.tsx`, `Objection.tsx`,
  `Still.tsx`), so "below the card text" must resolve per format. Acceptance: counter is horizontally centred
  below the text block in every format that shows it; it cannot collide with or reflow the running head/payoff
  label; `counter.test.ts`'s pixel-level proofs are retargeted, not weakened.
  DONE, with one deliberate per-format exception: Wall/Question/Objection's shared `PayoffLine` (`Wall.tsx`) now
  renders the counter CENTRED BELOW its own text — `ReadThroughCounter` (`Counter.tsx`) grew an optional `top`
  prop; when supplied, the counter renders `left: 50%, transform: translateX(-50%)` at that `top` instead of the
  old fixed corner. `top` is computed by a new `computePayoffCounterBox(text)` (`wall-timing.ts`), which calls
  the EXACT SAME `fitFontSize` arguments `PayoffLine`'s own `<p>` fits against, measures the resulting wrapped
  line count, and derives the text block's real bottom edge (`FRAME_HEIGHT/2 + blockHeight/2`, since every
  payoff line in this workspace is flex-centred in the full frame) plus a fixed `COUNTER_GAP_BELOW_TEXT_PX`
  (40px, `counter-layout.ts`) — one source of truth shared by `PayoffLine` and by `counter.test.ts`'s own
  retargeted proof, so the two can never independently drift. The counter is still rendered as a SEPARATE
  absolutely-positioned sibling of the text's own flex-centred `AbsoluteFill` (never inside its flex flow), so
  the text's own position is completely unaffected by whether a counter renders at all — the "no reflow"
  invariant holds exactly as before, just proven against a per-case computed box instead of one fixed constant.
  **Still.tsx is the one exception, kept in the ORIGINAL top-left corner, unchanged.** Its full-passage text
  (`STILL_BOX_HEIGHT` = 1600 of the 1920px frame) already renders 1512-1558px tall for the two real Still cards
  in `content/social/pilot-schedule-w01.json` — centred, that already puts its own bottom edge at y=1739-1746,
  inside the very bottom platform-chrome band `COUNTER_SAFE_INSET_PX`'s doc comment warns about. There is no
  y-coordinate that is both "below the text" and safe for every real Still card, so per the task's own "say so
  rather than shipping it" instruction, Still's counter was left exactly as it was.
  Two safety invariants, both proven rather than assumed, mirroring `SOURCE_HEAD_TOP_PX`'s existing "disjoint by
  construction" discipline: (1) `wall-timing.ts` throws at import time if the below-text counter's box, computed
  at `PAYOFF_BOX_HEIGHT`'s hard structural ceiling (no payoff text can ever produce a taller estimated block —
  that ceiling is `fitFontSize`'s own search predicate), would reach into the bottom platform-chrome band
  (`COUNTER_BOTTOM_UNSAFE_ZONE_PX`, 300px, matching `COUNTER_SAFE_INSET_PX`'s own cited figure); (2)
  `source-head-layout.ts` throws at import time if the below-text counter's own MINIMUM possible top (at the
  theoretical `blockHeight` floor of 0) doesn't clear `SOURCE_HEAD_BOUNDING_BOX`'s bottom edge — since the
  counter's `top` only increases with `blockHeight`, clearing at the floor means every real (taller) block
  clears by more. `SOURCE_HEAD_TOP_PX`'s own derivation (from `COUNTER_BOUNDING_BOX`) was kept, not deleted —
  it's still exactly the derivation that keeps Still's corner counter and the framing plate disjoint; its doc
  comment now explains it is narrower in scope than before (Still-only) rather than silently leaving readers to
  wonder why it still exists.
  `counter.test.ts`'s end-to-end pixel-proof suite was retargeted (not weakened): each Wall/Question/Objection
  case now computes its own expected box via `computePayoffCounterBox` (Objection's via the real
  `assertObjectionRenderable` gate, the same split production renders) instead of cropping one shared corner
  constant; `assertIdenticalOutsideBoxes`/`assertBoxDiffers` still run the identical byte-level proof, just
  against the real per-case box. A new `counter-corpus.test.ts` adds a pure-computation (no rendering) proof
  across the REAL corpus: every one of 896 Wall landing lines (`content/social/premises/wall.json`), every real
  read-through rest line in Meditations book-02/03 (via `computeWallPlainLines`, the longest measuring ~795px of
  block height against the 800px ceiling), every Question answer (`question.json`), and every Objection reply
  line that clears `assertObjectionRenderable`'s own gate (`objection.json`) — each asserted clear of both the
  plate above and the platform-chrome band below, and horizontally centred on the frame's own midline.
  `source-head.test.ts`'s existing corner-counter-vs-plate suite (uses `ReadThroughCounter` with no `top`) was
  left as-is with a clarifying comment: it now documents that it's proving the narrower, Still-only invariant,
  not a pairing every format shares.
  Verified: `npx vitest run src/remotion/__tests__/counter.test.ts src/remotion/__tests__/source-head.test.ts` —
  47/47 (15 + 32, both suites green). `npx tsc --noEmit` clean. Root `npm test`: 819 pipeline + 95 web unit + 599
  social, all green (one Wall MP4 end-to-end test failed once under full-suite parallel CPU load — same known
  flake pattern U01 hit — and passed both alone and on a full rerun). Rendered real frames for all four formats
  (Wall landing line and rest line on `meditations-02-001`; Question answer on `meditations-11-005`, counter
  forced since week 1 has no Question read-through slot; Objection both reply lines on `discourses-53-011` from
  the week-02 fixture schedule, since week 1 has no Objection slot; Still on `meditations-02-002`) plus the
  single longest real corpus rest line (`meditations-02-012`, ~795px block height) and read every PNG: counter
  horizontally centred below the text in Wall/Question/Objection, comfortably clear of both the plate and the
  bottom of the frame in every case including the near-worst-case rest line; Still's corner counter unchanged
  and clear of the plate, while the render itself visually confirmed WHY Still couldn't safely move — that
  card's own text already runs from just under the plate to deep in the lower part of the frame. Frames left in
  the scratchpad the task supplied, not committed to the repo.
- [x] U03 (DONE 2026-08-27): Raise the payoff label from `SOURCE_HEAD_FONT_SIZE_PX` 32px to **38px** — user
  asked, and 38px keeps it clearly subordinate to the 81-88px payoff sentence (T10's whole point is that the
  payoff is the largest thing on screen) while giving the product concept real presence on a quiet frame. Past
  ~40px it starts competing with the sentence. The RUNNING HEAD stays 32px — it is denser text over a busy
  scroll. Acceptance: payoff label 38px, running head unchanged, R04's horizontal clamp and R07's descender
  clearance both still hold at the new size (re-verify, do not assume — the clamp is width-sensitive).
  DONE: split the one shared constant into two — `SOURCE_HEAD_FONT_SIZE_PX` (32px, running head only, unchanged)
  and a new `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (38px, payoff label only), both in `source-head-layout.ts` with a
  doc comment recording the rationale above (subordinate to T10's 81-88px payoff sentence; running head not
  raised because it sits over a dense, actively scrolling frame and carries far more characters). `SourceHead.tsx`
  picks the font size per variant (`variant.kind === 'payoff' ? SOURCE_HEAD_PAYOFF_FONT_SIZE_PX :
  SOURCE_HEAD_FONT_SIZE_PX`); `SOURCE_HEAD_TEXT_VERTICAL_PADDING_PX` (R07's 8px descender guard) stays a single
  shared value used by both variants' spans — re-measured, not assumed, at 38px (see below) and still clears.
  Re-verified rather than assumed, per the task's own warning: (1) R04's horizontal clamp — "In plain English" at
  38px measures ~274px wide against the 836px `SOURCE_HEAD_TEXT_MAX_WIDTH_PX` budget, real Chromium + real
  embedded DM Sans, enormous margin; (2) R07's vertical descender clearance — at 38px the minimum padding that
  clears the payoff text's descenders measures 6px (up from ~3px needed at 32px, as expected for a font-size-
  proportional content area), so the existing 8px still clears with `scrollHeight === clientHeight` (54px each),
  no padding change needed; (3) plate fit — the payoff span's content box (38 + 2*8 = 54px) stays comfortably
  inside `SOURCE_HEAD_BOUNDING_BOX`'s fixed 120px plate height, so neither that box nor its non-overlap with
  `COUNTER_BOUNDING_BOX` needed to change. Added `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` to the `social/src/remotion/
  index.ts` barrel export (`SOURCE_HEAD_FONT_SIZE_PX` was already there).
  Tests: `source-head.test.ts` gained a new `describe('U03 — the payoff label reads larger than the running
  head, but stays subordinate to the payoff sentence')` block (3 tests: the two constants are strictly ordered
  and equal their expected literal values 32/38; `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` stays strictly below
  `wall-timing.ts`'s `PAYOFF_MIN_FONT` (52), i.e. T10's invariant holds at the new size; a real-Chromium
  horizontal-clamp re-measurement of the payoff label specifically at 38px). The pre-existing R07 "vertical ink
  extent" describe block's probe font-size was switched from `SOURCE_HEAD_FONT_SIZE_PX` to
  `SOURCE_HEAD_PAYOFF_FONT_SIZE_PX` (it was always meant to measure the payoff span, and the payoff span no
  longer renders at the running-head's size) — both its assertions (witness clips, fix doesn't) still pass at
  the new size, confirming R07's fix generalises rather than needing rework. The R04 running-head corpus sweep
  (83 real book/chapter heads) was left untouched — it measures the running head, which this task does not
  change.
  Verified: `cd social && npx vitest run src/remotion/__tests__/source-head.test.ts` — 32/32 (up from 29; 3 new
  U03 tests). `npx tsc --noEmit` clean. Root `npm test`: 819 pipeline + 95 web unit + 593 social, all green (up
  from 590 social pre-task). Rendered a real Wall end-to-end (`npx tsx social/src/cli.ts render --date
  2026-09-06 --slot 1`, `meditations-02-006`) and read both a mid-scroll frame (running head over the moving
  archaic wall) and the payoff frame. Measured ink extents by cropping the plate region and scanning pixel rows/
  columns against background: payoff label ink spans rows 44-81 of the 120px plate (38px tall, includes
  descenders) and columns 66-336 of the 900px-wide plate; running head ink spans rows 47-74 (28px tall, all-caps,
  no descenders) and columns 65-726 — both comfortably inside the plate on both axes, on both variants, nothing
  clipped. Visually: "In plain English" reads with clearly more presence than before, still unmistakably smaller
  than the ~81-88px payoff sentence above it; the running head is visually unchanged.
- [x] U04 (DONE 2026-08-27): Noisy scroll bed, then silence, then a slow return — `social/src/audio/mix.ts`.
  Replace the soothing bed under the SCROLL with dense, unreadable noise matching the visual; HARD CUT on the
  cut frame (T15's frame-aligned stop, unchanged); **0.5s of true silence**; then fade the existing soothing
  bed back in over **~2.5s**, slowly enough to be near-inaudible until the landing line ends. User's decision,
  chosen over both a 3s hard silence and an immediate fade: no abrupt dead air for sensory-sensitive viewers,
  drop mostly intact. Noise is **generated procedurally from a fixed seed** (user's choice) — no new asset,
  renders stay reproducible. Constraints: `bedEnvelope` stays pure and deterministic; F02's `SilentMixError`
  guard must still raise; R05's edge-sampling regression test asserts floor across `[2.55s, 5.4s)` and WILL need
  retargeting once the bed fades in from ~3.0s — retarget it to still prove the hard stop, never weaken it.
  Acceptance: `volumedetect` on a real render shows noise across the scroll, floor across the 0.5s beat, and a
  gradual rise thereafter; the cut is still frame-aligned.
  DONE: added a third, procedurally-generated NOISE track to `mix()` (`renderNoiseTrack`, ffmpeg's `anoisesrc`
  source filter — pink noise, `NOISE_AMPLITUDE=0.6`, band-limited `highpass=200`/`lowpass=5000` so it reads as
  dense/textured rather than a piercing hiss, fixed `NOISE_SEED` constant so it is never randomized), mixed
  alongside bed+narration via a generalized N-input `mixTracks`. `MixInput` gained `noiseSpans` (where noise
  plays instead of the bed, hard-cutting to silence at each span's end via the existing `HARD_STOP_RAMP_MS`) —
  the bed's own floor window is now the UNION of `silentSpans` and `noiseSpans`, and it returns via a new,
  much slower `BED_RETURN_FADE_MS` (2500ms) rather than the snappy `DUCK_RELEASE_MS` (600ms), only when
  `noiseSpans` is non-empty. `cli.ts` gained `wallNoiseSpans()` (`[0, WALL_FRAMES)`, i.e. the whole scroll) and
  narrowed `wallSilentSpans()` from the old "landing line ALONE" (2.5s-5.5s) down to just `WALL_DROP_SILENCE_MS`
  (0.5s, 2.5s-3.0s) — **decided**: `wallSilentSpans()` now means "0.5s of true silence" only, not the whole
  landing-line hold; narration ducking follows this same narrower window (the Wall's rest-line narration never
  starts before 5.5s regardless, so this is a no-op for narration today, but keeps "narration is silent
  wherever the bed is silenced for a scripted reason" true if that ever changed).
  Tests: retargeted R05's regression test, and in doing so found its ablation-proof property didn't transfer
  cleanly to the new noise track — `anoisesrc` is an in-filtergraph SOURCE filter whose default frame size
  (1024 samples, ~21ms) is already well under the ~90-100ms FLAC-block problem `asetnsamples` exists to fix, so
  removing `asetnsamples` from `renderNoiseTrack` measurably changes nothing (verified). Kept TWO tests instead
  of one: (1) the original bed-based hard-stop-into-mid-track-silentSpans scenario, unchanged in shape,
  RE-VERIFIED load-bearing by removing `asetnsamples` from `renderBedTrack` (red: -31.8dB, needed <-60dB) and
  restoring it (green: -73.1dB); (2) a new test on the real Wall shape (noise track, narrow `[2.55s, 2.95s)`
  floor window), which is a genuine functional-correctness check but is HONESTLY DOCUMENTED as not itself
  discriminating the `asetnsamples` ablation (kept for consistency/future-proofing, not because this test
  needs it today). `narration.test.ts`'s `wallSilentSpans` assertions were updated to the new 0.5s window and a
  `wallNoiseSpans` describe block was added; its F02 single-sentence-Wall test now also passes `noiseSpans` to
  match the real `cli.ts` call shape.
  Verified: `cd social && npx vitest run src/audio/__tests__/mix.test.ts src/audio/__tests__/narration.test.ts`
  — 42/42 (23 + 19, up from 41 pre-task). `npx tsc --noEmit` clean. Root `npm test`: 819 pipeline + 95 web unit
  + 594 social, all green. Rendered a real Wall end-to-end (`npx tsx social/src/cli.ts render --date
  2026-09-06 --slot 1`, `meditations-02-006`) and measured with `volumedetect`: 0.5-2.4s (noise under the
  scroll) -18.9dB mean/-7.1dB max; 2.4-2.5s -19.2dB (still noise, right up to the cut); 2.5-2.55s -34.0dB
  (mid-ramp, the 5ms `HARD_STOP_RAMP_MS` transition plus the 50ms measurement window straddling it); 2.55s-3.0s
  a flat ~-73dB floor throughout (sampled in five 100ms sub-windows, all -72.6 to -73.1dB) — genuine true
  silence, not just "quiet"; 3.0-3.1s -47.5dB, 3.0-3.5s -33.6dB, 3.5-4.0s -25.2dB, 4.0-4.5s -20.8dB, 4.5-5.0s
  -18.0dB, 5.0-5.5s -15.8dB — a smoothly, monotonically rising ramp, near-inaudible at the start and reaching
  the track's steady-state nominal level (-14.9dB at 6-10s, -15.9dB at 15-20s) right around when the landing
  line ends, exactly as specified. Confirmed the cut is still frame-aligned: extracted frames 74 (last wall
  frame, still mid-scroll archaic text) and 75 (first payoff frame, the landing line) directly from the
  rendered MP4 — the visual cut and the audio drop land on the identical frame boundary.
- [-] U05 (DEFERRED 2026-08-27, user): Closing frame — `thinkplain.ai` centred on an otherwise empty frame, ~2s, so viewers can find the
  product. See the constraint amendment above. Static, no motion (house rule). Apply to ALL FOUR compositions,
  matching T13's "so the channel reads as one product" reasoning — an end card on one format only would read
  as an accident. Acceptance: every format ends on the card; it is the last thing on screen; durations still
  respect the bounds (see U06).
- [-] U06 (DEFERRED 2026-08-27, follows U05): Raise `WALL_MAX_DURATION_SECONDS` 40 → **42** to make room for U05's end card (user's decision).
  T03 calibrated 40s before an end card existed; the longest read-through Wall is 38.5s, so a ~2s card would
  breach it and start rejecting Walls. 42s stays well inside the global 59s bound. Acceptance: the
  read-through slice keeps all 30 Walls with the end card included; re-measure and record p50/p75/max.
  DEFERRED: this task existed ONLY to make room for U05's end card. With U05 deferred the 40s ceiling is
  still correct and raising it would be unmotivated churn. Revisit together with U05, never separately.
- [x] U07 (DONE 2026-08-27): Re-render week 1 and re-measure — the U01-U06 changes alter geometry, audio and duration together,
  so the T20 integration pass must be redone. Acceptance: all 14 render; ffprobe confirms the profile;
  durations inside 15s/59s and Walls inside the UNCHANGED 40s ceiling (U06 deferred); frames at 0.0s / cut /
  payoff show the intended result; `volumedetect` confirms U04's shape. Then a fresh phone review.
  DONE: ran the plan's verify block exactly. `npm test`: 819 pipeline + 95 web unit + 599 social, all green.
  `npx tsx social/scripts/write-exclusions.ts --date 2026-08-26` (byte-identical to the already-committed
  artifact — no diff): Wall 685/896 pass, Question 48/88, Objection 27/59, read-through (meditations bk2/3)
  **30 Wall / 18 Still** — the plan's own headline figure. `npx tsx scripts/generate-schedule.ts --week 1
  --seed 42 --first-week --force` (also byte-identical to the committed schedule): **format counts — wall 8,
  question 4, objection 0, still 2** (0 Objection this week is a pool-weighting outcome, not a bug — U02's
  Objection counter-move is unexercised by week 1's actual schedule, though it was already verified directly
  against `discourses-53-011` in U02's own task). Author mix: marcus-aurelius 57.1%, seneca 28.6%, epictetus
  14.3%.
  Rendered all 14 posts (`for d in 01..07; for s in 1 2: cli.ts render --date 2026-09-$d --slot $s`) — **all 14
  succeeded**, no failures, nothing to diagnose.

  **Format mix and durations (all 14):**
  | day/slot | format | card | duration | bed |
  |---|---|---|---|---|
  | 1/1 | wall | meditations-02-001 | 20.501s | bed-01-c-major9 |
  | 1/2 | wall | peace-of-mind-17-005 | 35.520s | bed-02-d-minor9 |
  | 2/1 | still | meditations-02-002 | 15.018s | bed-03-e-minor7 |
  | 2/2 | question | meditations-11-005 | 15.018s | bed-04-f-major7 |
  | 3/1 | wall | meditations-02-003 | 20.501s | bed-05-g-sus4 |
  | 3/2 | question | discourses-18-001 | 15.018s | bed-06-a-minor |
  | 4/1 | wall | meditations-02-004 | 15.018s | bed-01-c-major9 |
  | 4/2 | question | on-anger-03-108 | 15.018s | bed-02-d-minor9 |
  | 5/1 | still | meditations-02-005 | 15.018s | bed-03-e-minor7 |
  | 5/2 | wall | on-anger-02-100 | 38.506s | bed-04-f-major7 |
  | 6/1 | wall | meditations-02-006 | 23.509s | bed-05-g-sus4 |
  | 6/2 | wall | on-anger-01-027 | 23.509s | bed-06-a-minor |
  | 7/1 | wall | meditations-02-007 | 15.018s | bed-01-c-major9 |
  | 7/2 | question | discourses-64-006 | 15.018s | bed-02-d-minor9 |

  All 14 durations fall inside **[15.018s, 38.506s]** — comfortably inside the 15s/59s global floor/ceiling.
  All 8 Walls fall inside **[15.018s, 38.506s]**, comfortably under the UNCHANGED 40s ceiling (U06 stayed
  deferred, as directed — no ceiling change made or needed).

  **ffprobe profile (`ffprobe -v error -show_streams`, run per-file as T20 did):** all 14 files identically
  report `codec_name=h264 profile=High level=40 pix_fmt=yuv420p width=1080 height=1920 r_frame_rate=30/1` on
  the video stream and `codec_name=aac profile=LC sample_rate=48000 channels=2` on the audio stream — the full
  house profile (H.264 High/L4.0, yuv420p, 1080x1920, 30fps; AAC-LC 48kHz stereo) confirmed on every post, not
  just one.

  **Audio — U04+U08's babble/silence/return shape, spot-checked on THREE different Walls with three different
  beds** (not just the one card previously measured), by extracting each MP4's audio to PCM (`ffmpeg -vn
  -acodec pcm_s16le`) and computing RMS-dB in fixed windows directly — U08 already found naive `volumedetect`
  against the muxed MP4 misleading (AAC priming shifts short seeks), so this task used the same corrected
  method rather than repeat that mistake:

  | window | wall-2026-09-01-slot1 (bed-01) | wall-2026-09-05-slot2 (bed-04) | wall-2026-09-06-slot1 (bed-05) |
  |---|---|---|---|
  | scroll (babble, 0-2.4s) | -18.1 to -18.6 dB | -19.2 to -19.7 dB | -20.5 to -21.0 dB |
  | cut ramp (2.5-2.55s) | -31.0 dB | -32.1 dB | -33.3 dB |
  | true silence floor (2.55-3.0s) | **-70.7 dB** | **-74.1 dB** | **-73.0 dB** |
  | bed return begins (3.0-3.5s) | -31.2 dB | -35.2 dB | -33.6 dB |
  | bed rising (3.5-4.0s) | -23.1 dB | -26.2 dB | -25.1 dB |
  | bed near steady (5.0-5.5s) | -14.0 dB | -15.5 dB | -15.7 dB |
  | bed steady-state (6-7s) | -13.6 dB | -14.3 dB | -14.7 dB |

  All three: babble across the whole scroll at a comparable, non-silent level (the small ~1-2dB per-post
  spread is expected — the final loudnorm pass normalizes the WHOLE mix, and different beds/durations pull
  overall gain slightly differently; the raw noise construction itself is seed-fixed and untouched by this
  task); a genuine floor (all three ≤ -70.7dB, i.e. true silence, not just "quiet") across 2.55-3.0s; then a
  smooth, monotonic rise to the bed's own steady-state level (~-14 to -15dB) by ~5.5-6s — exactly U04/U08's
  documented shape, confirmed across a full week's worth of renders and three different musical beds, not
  just the single card measured in U04/U08's own tasks.

  **Frame observations** (all read directly, not inferred — `ffmpeg -vf select=... -update 1 -frames:v 1`):
  - **Wall frame 0** (`wall-2026-09-01-slot1`, meditations-02-001): dense 44px Literata body text under the
    running head "MARCUS AURELIUS · MEDITATIONS, BOOK 2", which sits on a visibly tinted warm-grey plate
    (`TAG_BACKGROUND`) with a clean hairline rule (`BORDER`) along its lower edge — U01 confirmed. No numeral
    anywhere in frame, confirming T17's rotation stays retired.
  - **Wall frame 74** (last wall frame, same post): still mid-scroll, dense archaic text, same running head,
    text has visibly moved from frame 0 (confirming the scroll animates, not a static crop).
  - **Wall frame 75** (first payoff frame, same post): "In plain English" renders at the larger 38px label
    size (U03), payoff sentence ("There is only a certain amount of time given to you.") at ~81-88px, and
    **"Card 1 of 48" renders horizontally centred BELOW the payoff text**, not top-left (U02) — matches every
    documented acceptance criterion at once. A later payoff frame on the same post (second rest line, "If you
    don't use it to calm the troubles of your soul...") shows the counter still correctly centred below the
    new, differently-wrapped text, i.e. the per-line `computePayoffCounterBox` recomputation holds across
    multiple lines within one post, not just the first.
  - **A second Wall** (`wall-2026-09-05-slot2`), frame 75: same framing grammar, different payoff text ("Some
    angry people, as Sextius points out, have been helped by looking in a mirror.") and **no counter at all**
    — correct, since this post (`on-anger-02-100`) is a scored-pool Wall, not a read-through slot, and the
    counter only ever renders for read-through cards.
  - **A third Wall** (`wall-2026-09-06-slot1`, meditations-02-006), frame 0: different opening text from
    `meditations-02-001`'s frame 0 even though it's the same book/chapter — confirms T16's mid-chapter-entry
    variation is genuinely varying frame 0 across posts, not accidentally identical.
  - **Question** (`question-2026-09-02-slot2`, meditations-11-005): mid-archaic frame shows the identical
    tinted-plate running head treatment as Wall (U01 applies uniformly across formats); last frame (the
    answer, "Then I have gained from it.") shows the 38px payoff label with **no counter** — correct, since
    this Question slot is not a read-through card either.
  - **Objection**: week 1's actual schedule has **zero** Objection slots this run (a pool-weighting outcome
    of this seed, not a defect — `format_counts` reports `objection: 0`), so there is no in-week Objection
    frame to inspect here. U01/U02/U03's own verification already covered Objection directly against
    `discourses-53-011` (a week-02 fixture schedule), and nothing in this task's diff touches Objection's own
    code path, so this is not treated as a gap.
  - **Still** (`still-2026-09-02-slot1`, meditations-02-002): confirms U02's deliberate exception — "Card 2 of
    48" renders **top-left**, unmoved, while the tinted payoff-label plate sits in its usual top slot; visually
    this reads as acceptable rather than broken, because the full-passage Still text already runs from just
    under the plate to deep in the lower two-thirds of the frame, leaving no safe below-text position for any
    counter — exactly the reasoning U02 recorded for keeping this one exception.

  **Recommended sample to hand the user: `social/out/wall-2026-09-01-slot1.mp4`.** It is card 1 of the
  read-through (so the counter reads "Card 1 of 48," an intuitive starting point), a moderate 20.5s (not the
  38.5s outlier), and every frame/audio measurement above was captured directly against this exact file —
  tinted framing plate, no numeral, 38px payoff label, counter centred below text on two different payoff
  lines, and the full babble → true-silence → slow-bed-return audio arc, all in one post.

  Left all 14 rendered MP4s (plus their `-feed.jpg` and `.json` sidecars) in `social/out/` (gitignored), per
  instruction, for the user's own phone review. `content/social/render-exclusions.json` and
  `pilot-schedule-w01.json` needed no changes (both already matched what T08's prior regeneration produced —
  confirmed via `git diff`, zero delta).

- [x] U08 (DONE 2026-08-27): Make the scroll noise sound like PEOPLE TALKING — `social/src/audio/mix.ts` (user, 2026-08-27:
  "The noise over the wall should sound like people talking"). U04 shipped band-limited pink noise; replace
  its character with a crowd murmur / babble. Keep U04's architecture, seed determinism, levels, the
  frame-aligned hard cut, the 0.5s true-silence beat and the ~2.5s bed return EXACTLY as they are — this
  changes the noise's TIMBRE only.
  **Stay procedural** (the user's standing decision from earlier the same day: generated from a fixed seed,
  no new committed asset, reproducible renders). Technique: speech-shaped noise (LTAS-ish tilt, energy
  peaking low-mid and rolling off above ~1kHz), given vowel-like colour by formant-ish bandpass resonances
  (~500 / 1500 / 2500 Hz), then amplitude-modulated at SYLLABIC rates (~3-6 Hz) — several independent layers
  at different rates, offsets and slight formant shifts, summed. That is the standard babble-modulated-noise
  construction and reads as a room full of talking without any layer being a real voice.
  **UNINTELLIGIBLE BY DESIGN, and this is a requirement not a side effect.** No layer may be recognisable
  speech: intelligible words under the archaic text would compete with reading it, and would put words in the
  viewer's ear that are not the author's — the concern Constraint 6 exists to protect. Do NOT build this from
  the TTS fixtures (`polly-sample.mp3`, `elevenlabs-sample.wav`); they are test fixtures, single-voice, and
  would loop audibly.
  Sensory care still governs, per the user's original reason for the whole audio change: a murmur, not a
  shout — no piercing top end, no oppressive sub-bass drone.
  Acceptance: `volumedetect` on a real render still shows the U04 profile (noise across the scroll at a
  comparable level, floor across 2.55-3.0s, gradual rise to ~-15dB by 5.5s); the cut stays frame-aligned;
  the seed still produces byte-identical audio across two renders; and a human listening to the extracted
  scroll audio hears a crowd murmur rather than a hiss. Report the measured levels and describe what you hear.
  DONE: `renderNoiseTrack` in `social/src/audio/mix.ts` no longer generates one band-limited pink-noise
  source — it now builds the standard "babble-modulated noise" construction from `NOISE_LAYER_COUNT` (6)
  INDEPENDENT layers, each its own `anoisesrc` pink-noise source (fixed seed `NOISE_SEED + layer.seedOffset`,
  a literal `NOISE_LAYERS` table — never derived from date/post-index), individually shaped: three
  `NOISE_FORMANTS` peaking-EQ resonances (~500/1500/2500Hz, gains +9/+4/-3dB — falling off with frequency, on
  purpose, to reinforce pink noise's own low-mid-peaking tilt rather than fight it) for vowel-like colour,
  then `tremolo` amplitude modulation at that layer's own syllabic rate (3.1-6.0Hz, one rate per layer, plus a
  slight per-layer formant-frequency scale 0.92-1.08x) for speech-like rhythm, then band-limited
  (`highpass=150Hz`, `lowpass=3000Hz` cascaded twice for a steeper rolloff). All 6 layers sum via `amix`
  (`normalize=0`, since `NOISE_LAYER_AMPLITUDE`=0.17/layer was chosen for the SUM) into one filter_complex, one
  ffmpeg process — the overall on/off gating (`noiseEnvelope`'s hard-cut-both-edges shape) is applied ONCE, to
  the summed signal, via the same `asetnsamples`+`volume=eval=frame` pairing every other envelope-driven track
  in this file uses. Everything else — `MixInput.noiseSpans`/`wallNoiseSpans`/`wallSilentSpans`, the bed's
  floor-spans union and `BED_RETURN_FADE_MS` return, the frame-aligned hard cut, `SilentMixError` — untouched.
  Parameters were tuned against a standalone ffmpeg prototype (not committed) before touching the module: per-
  layer amplitude for a ~-26/-15dB raw mean/max match to U04's original single-layer figure; formant gains and
  a doubled lowpass stage specifically to pull the spectral centroid down from ~2.2-2.4kHz (naive equal-gain
  formants) to ~1.2kHz (measured, matching real running speech's LTAS centroid).
  Verified: `npx vitest run src/audio/__tests__/mix.test.ts src/audio/__tests__/narration.test.ts` 42/42 —
  including the U04 test that directly measures the real Wall shape (noise audible pre-cut, <-60dB in
  [2.55s,2.95s)) and the F02 `SilentMixError` regression, both unmodified and green against the new construction.
  `npx tsc --noEmit` clean. Root `npm test`: 819 pipeline + 95 web unit + 599 social, all green (U02 was
  editing `Counter.tsx`/layout files concurrently on this branch; no overlap with this task's files, no shared
  failures).
  MEASURED on a real render (`--date 2026-09-06 --slot 1`, `meditations-02-006`, 705 frames/23.5s): naive
  `ffmpeg -ss/-to volumedetect` directly against the muxed MP4 was MISLEADING here (AAC encoder priming/padding
  shifts short-window seeks by tens of ms, enough to blur a 450ms floor) — re-measured correctly by extracting
  the AAC track to PCM first (`ffmpeg -vn -acodec pcm_s16le`) and computing RMS dB directly in Python/numpy.
  Result: scroll (0-2.5s) **-20.8dB** mean (U04's own figure: -18.9dB — same order, the retimbred signal's
  different crest factor accounts for the gap); floor (2.55-3.0s) **-73.0dB** (U04: ~-73dB — matches almost
  exactly); rise -33.6 → -25.1 → -20.5 → -16.4 → -14.8dB across 3.0s→6.0s (U04's own rise: -47.5→-25.2→-18.0→
  -15.8dB — different sub-window boundaries, same shape and same converged steady-state level). Frame-level
  check confirms the cut is still frame-aligned: frame 74 (2.4667-2.5000s) full level (-20.6dB), frame 75
  (2.5000-2.5333s) mid-ramp (-31.6dB, `HARD_STOP_RAMP_MS`=5ms landing inside this frame), frame 76 already at
  floor (-72.7dB) — the cut lands exactly on frame 75/t=2.500s, unchanged from U04.
  DETERMINISM: rendered the same post twice; the extracted audio PCM is byte-identical (matching MD5) across
  both runs. (The two full MP4s differ by a few bytes in the H.264 `btrt` box — x264's own encoder-internal
  bitrate statistic, a video-track artifact unrelated to and pre-existing this change, not the audio.)
  THE HONEST LIMIT OF THIS VERIFICATION: an LLM agent has no ears — "listening" here means objective acoustic
  analysis (spectral centroid, band-energy distribution, envelope-modulation spectrum via FFT), not subjective
  perception, and that distinction matters for a claim about how something SOUNDS. Extracted the real render's
  scroll-phase audio to `u08-scroll-audio.wav` (in this task's scratchpad, not committed) and measured: spectral
  centroid **1225Hz** (in the range real running speech's long-term-average spectrum centroids fall in, not the
  ~2.2-4kHz a hiss or an under-tilted formant boost would produce); band energy **74.7% concentrated in
  200-1000Hz** (the low-mid "voice" band), only **2.5% in 2-4kHz** and **~0% above 4kHz** (no piercing top
  end — the sensory-care constraint holds), only **4.7% below 200Hz** (no sub-bass drone); envelope-modulation
  spectrum shows multiple close-magnitude peaks spread **2.8-6.0Hz** (the targeted syllabic-rate range) rather
  than one dominant frequency, consistent with several independently-modulated layers fusing rather than one
  layer rhythmically popping out. Every one of these objective measures is consistent with the babble-modulated-
  noise construction reading as an unintelligible crowd murmur rather than a hiss, by the same diagnostics
  hearing research uses to characterize exactly that distinction — but this is inference from measurement, not
  a first-person listening report, and a human pass (the user, or someone auditioning T14's voices) is the only
  way to close that gap with certainty. If a human listen concludes it still reads as textured hiss rather than
  babble, the likely next lever is MORE layers (8-10, the upper end of the hearing-research range) or slightly
  deeper `NOISE_TREMOLO_DEPTH`, not a different noise colour or a real multi-talker asset — the spectral/
  modulation profile measured here already sits where the construction is designed to land.

## Deprecation — one Wall a day (2026-08-27)

User decision, after reviewing the week-1 renders: "The wall format is getting close now, the question and
still format is not working, let's deprecate it to save processing time moving forward." Followed by two
scoping decisions in the same session: **also deprecate the read-through**, **delete the code outright**
(T17's precedent, not a scheduler-weight change), **one post per day, pool-drawn**, and **deprecate Objection
too** — it was the only non-Wall format left and drew zero slots in week 1.

**The channel becomes: one Wall per day, drawn from the 685-entry Wall pool.** Nothing else.

Recorded for the archaeology, without regret — this deliberately removes working code that landed earlier the
same day, and that is the correct trade when a format is not working: T13's framing layer on Question/
Objection/Still, T16/F04's narration timings for Question and Objection, R03's chapter block for Question,
R06's Objection motionless floor, and U02's counter centring. All recoverable from git history.

**Consequences accepted:** the "read a book card by card" framing goes with the read-through, and with it the
`Card N of 48` counter (which exists for nothing else), the sequential book-order walk, and T19's "never
reorder the read-through" constraint — sub-type spacing now applies freely across days.

- [x] D01: Delete the Question, Objection and Still formats OUTRIGHT — compositions (`Question.tsx`,
  `Objection.tsx`, `Still.tsx`), timings (`question-timing.ts`, `objection-timing.ts`, `still-timing.ts`),
  gates (`question-gate.ts`, `objection-gate.ts`, `still-gate.ts`), their `scripts/lib/premises.ts` ranking
  and gate functions, the `content/social/premises/{question,objection,still}.json` artifacts, and every test
  covering them. Unwire from `Root.tsx`, `entry.tsx`, `social/src/cli.ts`, `social/src/remotion/index.ts` and
  `social/src/render/post-metadata.ts`. Done as ONE task because all three share the same wiring files.
  Tests for deleted behaviour are DELETED, never skipped (T17's rule). Acceptance: no reference to any of the
  three survives outside doc comments and this plan; `npm test` green; the Wall renders unchanged.

  **Done (2026-08-27).** Deleted outright: the three compositions, their timing/gate modules and every test
  file for them (`social/src/remotion/{Question,Objection,Still}.tsx`, `{question,objection,still}-{timing,gate}.ts`
  and their `__tests__`, plus `framing-question-objection-still.test.ts`); `content/social/premises/
  {question,objection,still}.json`; `scripts/lib/premises.ts`'s Question section (T04, `findQuestionCandidate`
  through `buildQuestionDriftRequests`) and Objection section (T07a, `startsWithObjectionOpener` through
  `objectionGate`), plus `mechanicalGates`/`hasQuotedSpeech`/`lengthDelta` (fed only the deleted Still gate and
  an Objection precursor stat). `QuestionEntry`/`ObjectionEntry` interfaces survive, narrowed to a one-line doc
  comment explaining why: `wallAuthorWeights` still takes a Question/Objection pool as a correction input,
  now always `[]`. Unwired from `Root.tsx`/`entry.tsx`/`index.ts`/`cli.ts`/`post-metadata.ts` as specified.

  **Cascaded beyond the plan's own file list** (surveyed myself, per the plan's own instruction that its grep
  "may be incomplete"): `scripts/lib/premises-batch.ts` and `premises-scoring.ts` (Question/Objection batch
  orchestration and rubric prompts/parsers — Wall's own path is untouched); `scripts/score-premises.ts` and
  `scripts/lib/premises-cli.ts` (`--format` narrowed to `wall`/`all`); `scripts/generate-schedule.ts` (its
  `questionGate`/`objectionGate` calls replaced with `[]`, since nothing else produces those pools any more);
  `social/scripts/write-exclusions.ts` (trimmed to Wall + read-through, matching D04's future artifact shape,
  though it does not regenerate the committed file itself — that's D04's job).

  **Left for D02, per the plan's own instruction** ("do the minimum to keep the scheduler compiling ... do
  not restructure it"): `scripts/lib/schedule.ts`'s `tryReadThroughContent` still has "question"/"objection"
  branches, now hardcoded to `return null` (a one-line change each) rather than removed; `ScheduleFormat`,
  `SlotContent`, `FormatPools`, `RenderedFormat` and the whole weighted-draw/read-through machinery are
  untouched; `content/social/pilot-schedule-w01.json` still has real `question`/`still` slots from before this
  task (unrenderable via the CLI now — see below) until D04 regenerates it; `content/social/
  render-exclusions.json` still carries `question`/`objection`/`still` sections until D04 regenerates it.
  `social/src/cli.ts`'s `buildRenderPlan` throws a named error for any slot whose format is `"question"`/
  `"objection"`/`"still"` rather than silently doing nothing — this is the one place D01 had to reach past
  "unwire the four named files" to keep a stale schedule from producing a blank render.

  **Verification:** grep for every named symbol/file across the repo returns zero hits outside doc comments
  and this plan; `cd social && npx tsc --noEmit` clean; `npm test` from repo root — pipeline 630/630 (21
  files, was 186 in the CLAUDE.md estimate, now larger due to counting drift, all green), web unit 95/95 (7
  files), social 409/409 (24 files, down from 599/599 across 31 files pre-deletion — 190 tests removed).
  Rendered `--date 2026-09-01 --slot 1` (a real Wall slot): frame 0/74 show the dense moving chapter-sourced
  scroll under the fixed "MARCUS AURELIUS · MEDITATIONS, BOOK 2" running-head plate; frame 75 (the cut) and
  frame 120 show the payoff — "In plain English" label, the 44px landing line, "Card 1 of 48" counter below —
  pixel-identical in kind to pre-D01 renders. Social suite runtime: 78.4s before (599 tests) -> 28.0-32.0s
  after (409 tests) — roughly 2.7x faster, ~47-50s saved per run, which was the user's stated motivation.
- [x] D02 (DONE 2026-08-27): Delete the read-through from `scripts/lib/schedule.ts` (85 references) and collapse
  the day to a SINGLE pool-drawn Wall slot (82 slot references today). Remove `tryReadThroughContent`, the
  sequential book-order walk, and the `read_through` section of `content/social/render-exclusions.json` +
  `social/scripts/write-exclusions.ts`. T19's sub-type spacing survives but loses its "never reorder slot 1"
  constraint — it can now space freely, so simplify it accordingly rather than leaving dead conditionals.
  Acceptance: a generated week is 7 single-slot days, every one a Wall; no back-to-back sub-type repeat;
  `npm test` green.

  **Done.** `scripts/lib/schedule.ts` rewritten from scratch (1388 -> ~470 lines): `tryReadThroughContent`,
  `resolveReadThrough`, `readThroughContentOrThrow`, `buildReadThroughSequence`, `weightedFormatChoice`,
  `READ_THROUGH_FALLBACK_ORDER`, `DEFAULT_FORMAT_WEIGHTS`, `ScheduleFormat`, `RenderedFormat`, `FormatPools`,
  `SlotContent`'s Question/Objection/Still variants, `DEFAULT_READ_THROUGH_BOOK`/`_CHAPTERS`, and every
  `GenerateWeekOptions` field that existed only to parameterize the read-through are all GONE, not stubbed.
  `WeekSchedule` narrows to `{ week, seed, slots, author_mix, pool_source }`; `ScheduleSlot` narrows to
  `{ day, card_id, book_slug, author_slug, content: WallSlotContent }` — no `slot` number, no `read_through`/
  `read_through_counter` (D03 deletes the counter's own rendering machinery; this task only removes the
  scheduler's SUPPLY of a label, since there is no more sequence to count through). `generateWeek` is now a
  single 7-iteration loop, one Wall draw per day, straight from the (author-balanced, T21 strong-then-reserve)
  Wall pool. `loadFormatPools` -> renamed `loadWallPool` (Wall-only signature, `{ pool, source, exclusions }`);
  `loadPriorWeeks` drops `readThroughConsumed`. `WALL_STRONG_*`/`isStrongWallEntry`/`WallPoolEntry` (T21) and
  the `wallSubTypesIntersect` helper (T19) both survive unchanged in spirit.
  T19's sub-type spacing SIMPLIFIED, not left with dead conditionals: one piece of state
  (`previousWallSubTypes: WallSubType[] | null`, tracking the immediately preceding DAY, since day and slot are
  now the same thing), consulted once per day — no more "read-through slot 1 is fixed and read-only, slot 2 is
  where spacing can actually apply" split. Author balancing (`wallAuthorWeights`) is called as
  `wallAuthorWeights([], wallPool, 0)` — an empty Question pool and a 0 Question fraction, which makes that
  function's own existing "no readThrough" branch reduce ALGEBRAICALLY to targeting `BALANCED_AUTHOR_SHARE`
  (an even 1/3 per author) directly; this is a two-argument call-site change, not a rewrite of `premises.ts`'s
  T05/T17 mechanism, which stays untouched and independently tested by `premises.test.ts`.
  **Left for D03** (unchanged, per that task's own scope): `Counter.tsx`, `counter-layout.ts`,
  `computePayoffCounterBox`, `COUNTER_GAP_BELOW_TEXT_PX`, and the `counter` prop on `Wall.tsx`/`cli.ts`'s
  `RenderPlan`. What THIS task did remove is the counter's only LABEL SUPPLY: `cli.ts`'s `RenderPlan.counter`
  is now hardcoded `null` (doc-commented explaining why and pointing at D03), since `ScheduleSlot` no longer
  carries `read_through_counter` at all — `Wall.tsx` already renders nothing for a `null` counter (every
  non-read-through Wall slot always passed `null` before this task too), so this is a behavior no-op today.
  **`social/src/cli.ts`'s `--slot` flag: DROPPED, not defaulted to 1.** With one Wall slot per day, a slot
  number is pure noise — dropping it (`render --date <YYYY-MM-DD>`, no `--slot`) is more honest than keeping a
  vestigial always-`1` flag. Cascaded: `cli-plan.ts`'s `resolveSlot(schedule, day, slotNumber)` ->
  `resolveDay(schedule, day)`; `postIndexForSlot(date, slotNumber)` -> `postIndexForDay(date)` (`(week-1)*7 +
  (day-1)`, replacing `(week-1)*14 + (day-1)*2 + (slotNumber-1)`); `renderAssetPaths` drops its `slotNumber`
  parameter and the `-slotN` filename suffix (`wall-2026-09-01.mp4`, not `wall-2026-09-01-slot1.mp4`); the
  metadata sidecar's `narrationFields` drops its `slot` field. `social/src/schedule-types.ts` (the mirrored,
  hand-kept local type — `social/` never imports the root pipeline package) updated to match:
  `ScheduleFormat = 'wall'`, `SlotContent = WallSlotContent`, `ScheduleSlot` loses `slot`/`read_through`/
  `read_through_counter`.
  **`content/social/pilot-schedule-w01.json`'s SCHEMA changed** (this task's job, per the plan's own
  instruction) but the FILE ITSELF was deliberately left un-regenerated (D04's job) — it still has its pre-D02
  14-slot shape on disk (`slot`/`read_through`/`read_through_counter` fields, and `still`/`question` formats
  on some days, both dead formats since D01). `social/src/__tests__/cli.test.ts` was adapted to read this stale
  file only for days (1 and 6) that already resolve to a real Wall slot under the CURRENT data — `resolveDay`'s
  day-only lookup picks the array's first match for that day, which for those two days is already `slot 1`,
  format `wall` — so the suite is green against BOTH the stale file today and the D04-regenerated, truly
  single-slot file later, with no test changes needed when D04 lands.
  **`social/scripts/write-exclusions.ts`**: the read-through survey (`buildReadThroughSlice`,
  `resolveReadThroughSlice`, `surveyReadThrough`, the `--read-through-book`/`--read-through-chapters` flags)
  deleted outright; the script now surveys the Wall pool only and writes `{ meta: { generated_at,
  max_post_duration_frames, max_post_duration_seconds, wall }, wall }` — no `read_through` key at all. Verified
  by running it against a scratch `--out` path: emits `{"meta":{...,"wall":{...}},"wall":[...]}`, 685
  passed/211 rejected against the real 896-entry pool — same counts as before, since the Wall survey itself is
  unchanged, only the read-through section is gone. **The committed `content/social/render-exclusions.json`
  itself was NOT regenerated** (D04's job) — it still carries its pre-D02 `question`/`objection`/`read_through`/
  `still` sections; `scripts/lib/exclusions.ts`'s reader (`loadExclusions`/`LoadedExclusions`) narrows to
  `{ wall: Set<string> }` only and simply ignores whatever extra sections a stale file still has, so reading the
  old committed artifact continues to work unchanged.
  **`scripts/generate-schedule.ts`** rewritten: no more `--book`/`--read-through-chapters`/`--read-through-format`/
  `--wall-weight`/`--question-weight`/`--objection-weight`/`--max-objection-per-week` flags (nothing left to
  parameterize); calls `loadWallPool` instead of `loadFormatPools`; the review gate's weight-carrying step is
  gone (see `review.ts` below) — it is now purely "did you review retention before generating the next week".
  **`scripts/lib/review.ts`** simplified alongside: the review note's "Next week wall/question/objection
  weight" fields and `FormatWeights`/`ParsedReviewNote.nextWeekWeights` are gone (there is only one format left
  to weight — nothing), as is "Read-through position" (no read-through to report a position in); the per-post
  row drops "Slot N" (`- Day N — wall, <card_id>: <TODO> views`). `scripts/lib/__tests__/review.test.ts` and
  `scripts/lib/__tests__/generate-schedule-cli.test.ts` updated to match — one whole test
  (`"carries the review note's chosen weights forward as week 2's defaults"`) DELETED outright (T17's rule:
  tests for deleted behavior are deleted, never adapted to something weaker), since there is no weight left to
  carry forward.
  **`scripts/lib/__tests__/schedule.test.ts`** rewritten from scratch (3633 -> ~820 lines, 123 -> 41 tests):
  every test exercising read-through sequencing, book/chapter slicing, the STILL fallback, format weighting, or
  Question/Objection pool loading was DELETED (the behavior it tested no longer exists) — not skipped, not
  adapted to assert something weaker. KEPT and adapted: seeded determinism (single- and multi-week,
  disk-persisted 4-week chains), no-duplicate-card / no-cross-week-reuse, `loadWallPool`'s scored-vs-gate-only
  fallback and F05 exclusion gating (Wall-only now), `loadPriorWeeks`, T21's strong-before-reserve draw order,
  and T19's sub-type spacing — both a hand-built deterministic fixture (2 thou_wall + 6 cascade entries across 7
  days, deliberately imbalanced so at least one repeat is mathematically forced, proving the report mechanism
  fires) and a real-corpus multi-week sweep. MEASURED, and recorded honestly rather than papered over: the
  real-corpus sweep (8 weeks x 7 days = 56 draws against the real 685-entry scored pool) found ZERO actual
  back-to-back sub-type repeats and ZERO spacing warnings — at one Wall slot per day (down from two) and with
  the majority of the real pool carrying no sub-type at all (reserve entries never collide with anything), the
  scheduler in practice almost never needs to fall back to an unspaced pick. The test's assertion was adjusted
  to check the CORRESPONDENCE (warnings emitted == actual repeats, whatever that count is) rather than assert a
  nonzero count that the new, lower-cadence reality doesn't reliably produce; the synthetic fixture test is
  what proves the report mechanism itself still works under genuine scarcity.
  **Left as a disclosed, out-of-scope decision, not silently skipped:** `scripts/lib/premises.ts`'s
  `wallAuthorWeights`/`ReadThroughShareContext` (T17) still accept an optional `readThrough` context parameter
  that nothing calls anymore (`schedule.ts` always passes `undefined` for it now, via the 3-argument call
  described above) — D01's own note predicted this would be "restructured away by D02," but my actual task
  brief scoped D02 to `schedule.ts` + `write-exclusions.ts` + `generate-schedule.ts` + `cli.ts`, not a rewrite
  of `premises.ts`'s general-purpose, independently-tested (`premises.test.ts`) author-balancing utility for a
  parameter its one remaining caller happens not to use. Flagged here rather than touched, since removing it
  would mean deleting or rewriting `premises.test.ts`'s own T17 test block, which is out of this task's stated
  file list.
  **Verification:** grep for `read_through`/`readThrough`/`ReadThrough` across `scripts/` and `social/src/`
  returns hits only in doc comments (mostly D03's own `ReadThroughCounter` component, explicitly out of scope
  here, and historical references to the deleted `tryReadThroughContent`) — zero real code references survive.
  `npm test` from repo root: pipeline 551/551 (21 files, down from D01's own reported 630/630 — this task's
  test-file rewrites removed the bulk of that: `schedule.test.ts` 123 -> 41 tests, one weight-carrying test
  deleted from `generate-schedule-cli.test.ts`, `review.test.ts`'s weight/read-through assertions dropped),
  web unit 95/95 (7 files), social 408/408 (24 files, down 1 from 409 — `cli.test.ts`'s slot-2-specific tests
  collapsed into their day-only equivalents). `cd social && npx tsc
  --noEmit` clean. Generated a real week via the exact verify-block command, redirected to a scratch
  `--output`/existing `--exclusions content/social/render-exclusions.json` (deliberately NOT the default
  `content/social/pilot-schedule-w01.json` path, since regenerating that file is D04's job, not this one's):
  `npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force --output <scratch> --exclusions
  content/social/render-exclusions.json --premises-dir content/social/premises` — **7 single-slot days, every
  one Wall**: day 1 `meditations-05-029` (marcus-aurelius, thou_wall), day 2 `peace-of-mind-17-005` (seneca,
  reserve), day 3 `discourses-51-003` (epictetus, cascade), day 4 `discourses-58-003` (epictetus, reserve), day
  5 `happy-life-03-003` (seneca, reserve), day 6 `discourses-53-019` (epictetus, cascade), day 7
  `happy-life-20-005` (seneca, scene) — author mix epictetus 3/marcus-aurelius 1/seneca 3, no back-to-back
  sub-type repeat anywhere in the sequence (verified against `content/social/premises/wall.json`'s own
  `sub_types` field for each card). Ran the identical command a second time into a second scratch directory:
  byte-identical output (`diff` reports no difference), confirming determinism from `--seed` survives the
  rewrite. `content/social/pilot-schedule-w01.json`, `content/social/render-exclusions.json`, and
  `content/social/premises/wall.json` are BYTE-UNCHANGED by this task (confirmed via `git status`) — all three
  regenerations are D04's job.
- [x] D03 (DONE 2026-08-27): Delete the read-through counter — `Counter.tsx`, `counter-layout.ts`,
  `__tests__/counter.test.ts`, `__tests__/counter-corpus.test.ts`, `computePayoffCounterBox` and
  `COUNTER_GAP_BELOW_TEXT_PX` in `wall-timing.ts` (including the U02 import-time invariant that pinned the
  below-text counter box against the bottom chrome band — checked and confirmed it encoded nothing about the
  Wall's own geometry, only the counter's, so it went with the rest), and the `counter` prop from
  `Wall.tsx`/`cli.ts`/`PayoffLine`. `source-head-layout.ts`'s `SOURCE_HEAD_TOP_PX` no longer derives from
  `COUNTER_BOUNDING_BOX` — it and `SOURCE_HEAD_SAFE_INSET_PX` are now their own constants (both 64px, an
  ordinary top-left masthead inset, not a value borrowed from another overlay's geometry), carrying forward
  `counter-layout.ts`'s "why top-left" reasoning (the one corner none of TikTok/Reels/Shorts' chrome reliably
  overlaps) in its own doc comment. `SourceHead.tsx` gained its own `SOURCE_HEAD_FONT_STACK` literal (no longer
  aliased from `Counter.tsx`). `__tests__/pixel-proof.ts` kept, unchanged in substance (one doc-comment example
  updated to drop a dead `COUNTER_BOUNDING_BOX` reference) — `source-head.test.ts` still uses
  `renderFrameAsPng`/`assertIdenticalOutsideBoxes`/`assertBoxDiffers`/`assertBoxIdentical`. `source-head.test.ts`
  itself lost its counter-collision describe block (the "neither collides with the counter" claim no longer
  has a second overlay to prove non-collision against) but kept the still-valid "running head doesn't reflow
  the scrolling wall" case, renamed; its harness fixtures (`source-head-harness.tsx`, `source-head-entry.tsx`)
  dropped their own `counter` prop. **Verification:** grep for `ReadThroughCounter`/`COUNTER_BOUNDING_BOX`/
  `COUNTER_SAFE_INSET_PX`/`COUNTER_FONT_STACK`/`computeCounterBelowTextBox`/`computePayoffCounterBox`/
  `COUNTER_GAP_BELOW_TEXT_PX`/`COUNTER_BOTTOM_UNSAFE_ZONE_PX`/`COUNTER_BELOW_TEXT_BOX_*`/
  `SOURCE_HEAD_GAP_BELOW_COUNTER_PX` across `social/src/` returns hits only inside doc comments explaining the
  historical derivation — zero live code references survive. `cd social && npx tsc --noEmit` clean. `npm test`
  from repo root: pipeline 551/551 (21 files, ~16s), web unit 95/95 (7 files, <1s), social 387/387 (22 files,
  down from D02's 408 — the two deleted counter test files removed 21 tests net of the one new reflow-only
  test added; ~26s wall time, ~94s cumulative test time — the single flaky 120s timeout seen on one run of
  `wall-gate.test.ts` was resource contention from the whole-suite run, confirmed by re-running that file alone
  in 1.3s and the whole suite again clean). Rendered a real Wall (`npx tsx social/src/cli.ts render --date
  2026-09-01`, meditations-02 chapter, 615 frames/20.5s) and read frame 0, a mid-scroll frame (frame 36), and
  the first payoff frame (frame 80) as PNGs: no counter anywhere in any frame; the running head plate
  ("MARCUS AURELIUS · MEDITATIONS, BOOK 2") sits fixed in the top-left corner at `SOURCE_HEAD_TOP_PX` = 64px
  (measured via the real exported constant) — up from the pre-D03 264px (`64 + COUNTER_BOUNDING_BOX.height
  (160) + SOURCE_HEAD_GAP_BELOW_COUNTER_PX (40)`) it used to sit at, clearing a counter that never actually
  rendered there since D02; the payoff label ("In plain English") renders in the exact same plate/slot at 38px
  once the composition cuts to the still payoff, with the 81-88px payoff sentence centred below it and nothing
  overlapping or floating oddly now that the counter's old space is vacated.
- [x] D04 (DONE 2026-08-27): Regenerate and re-measure — `content/social/premises/wall.json`, `render-exclusions.json` and a
  fresh week 1 (now 7 posts, one per day). Render all 7, ffprobe the profile, confirm durations inside
  15s/59s and the 40s Wall ceiling, and confirm the U01/U03/U04/U08 work (tinted plate, 38px label, babble →
  cut → silence → slow return) all survive. Report the render-time and test-time saving versus the 14-post
  two-slot week, since saving processing time is the stated point. Acceptance: 7 Walls render; profile
  confirmed; suite green and measurably faster.

  **Done.** `content/social/premises/wall.json` checked, NOT regenerated: `git log` shows it was last written
  at T17 (commit `90a8451`), and a diff of `scripts/lib/premises.ts` between that commit and this task's start
  (`git show 0716f6f -- scripts/lib/premises.ts`, D01's own commit, the only one to touch the file since) shows
  D01 only deleted Question/Objection/Still-only functions (`hasQuotedSpeech`, `lengthDelta`,
  `MechanicalGates`, the Question and Objection sections) — `rankWall` and `selectWallBalanced`, the functions
  that actually produce `wall.json`'s entries, are byte-for-byte unchanged. Regenerating would mean a real,
  paid `ANTHROPIC_API_KEY` batch run for zero content change, so it was skipped; `git status` confirms the file
  is untouched by this task.

  `npx tsx social/scripts/write-exclusions.ts --date 2026-08-27`: Wall 685 passed / 211 rejected (duration
  only — the travel axis stays deleted per T08). The regenerated `render-exclusions.json` is now Wall-only
  (`{ meta: { generated_at, max_post_duration_frames, max_post_duration_seconds, wall }, wall }`) — no
  `question`/`objection`/`read_through`/`still` keys survive at all, matching D02's promised future shape
  (580 lines deleted, 2 inserted).

  `npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force`: **7 single-slot Wall days**,
  byte-identical to D02's own dry-run of the same command (confirming determinism survived D02/D03 untouched):

  | day | card | author | sub_type |
  |---|---|---|---|
  | 1 | meditations-05-029 | marcus-aurelius | thou_wall |
  | 2 | peace-of-mind-17-005 | seneca | (reserve) |
  | 3 | discourses-51-003 | epictetus | cascade |
  | 4 | discourses-58-003 | epictetus | (reserve) |
  | 5 | happy-life-03-003 | seneca | (reserve) |
  | 6 | discourses-53-019 | epictetus | cascade |
  | 7 | happy-life-20-005 | seneca | scene |

  Author mix epictetus 3 / marcus-aurelius 1 / seneca 3. Checked every adjacent pair against `wall.json`'s own
  `sub_types` field: **zero back-to-back sub-type repeats** (day 3→4 is cascade→reserve, day 4→5 is
  reserve→reserve but reserve carries no texture to collide with, day 5→6 is reserve→cascade, day 6→7 is
  cascade→scene — the two cascade days, 3 and 6, are not adjacent).

  **Rendered all 7** (`npx tsx social/src/cli.ts render --date 2026-09-0{1..7}`, no `--slot` — D02 dropped it
  outright). All 7 exited 0, no retries or fixes needed. Cleaned `social/out/` of stale pre-D02 artifacts first
  (`question-*`/`still-*`/`*-slot*` files left over from T20/U07's 14-post renders) so the directory holds
  exactly the 7 fresh Walls.

  **Durations (15s/59s bounds, 40s Wall ceiling):**

  | date | card | bed | duration |
  |---|---|---|---|
  | 2026-09-01 | meditations-05-029 | bed-01-c-major9 | 26.517s |
  | 2026-09-02 | peace-of-mind-17-005 | bed-02-d-minor9 | 35.520s |
  | 2026-09-03 | discourses-51-003 | bed-03-e-minor7 | 29.504s |
  | 2026-09-04 | discourses-58-003 | bed-04-f-major7 | 26.517s |
  | 2026-09-05 | happy-life-03-003 | bed-05-g-sus4 | 29.504s |
  | 2026-09-06 | discourses-53-019 | bed-06-a-minor | 35.520s |
  | 2026-09-07 | happy-life-20-005 | bed-01-c-major9 | 35.520s |

  All 7 sit inside **[15s, 59s]**; sorted, p50 29.504s, max 35.520s — comfortably under the **40s Wall
  ceiling** (4.48s of headroom on the longest).

  **ffprobe profile** (`ffprobe -v error -show_streams`, run per-file — a shell glob of 7 inputs makes ffprobe
  reject the 2nd+ as a duplicate `-i`, so the plan's own Verify block is corrected below to loop): all 7 report
  video `h264, profile=High, level=40, 1080x1920, yuv420p, 30/1 fps` and audio `aac, profile=LC, 48000Hz, 2
  channels` — the full house profile, zero violations.

  **Audio — U04/U08's babble → cut → true-silence → slow-return shape**, spot-checked on **three** different
  Walls with three different beds (`bed-01-c-major9`, `bed-02-d-minor9`, `bed-06-a-minor`), by extracting each
  MP4's audio to PCM (`ffmpeg -vn -acodec pcm_s16le -ar 48000 -ac 1`) and computing RMS-dB in fixed windows
  directly with a throwaway Python script (never `volumedetect` — U08 already found it misleading on the muxed
  MP4, since AAC priming blurs short-window seeks):

  | window | wall-2026-09-01 (bed-01) | wall-2026-09-02 (bed-02) | wall-2026-09-06 (bed-06) |
  |---|---|---|---|
  | scroll/babble (0-2.5s) | -19.0dB | -19.6dB | -20.8dB |
  | true silence floor (2.55-3.0s) | **-71.6dB** | **-73.2dB** | **-72.5dB** |
  | rise (3.0-4.0s) | -26.1dB | -28.5dB | -26.5dB |
  | rise (4.0-5.0s) | -17.8dB | -20.6dB | -19.1dB |
  | rise (5.0-6.0s) | -14.3dB | -17.3dB | -16.8dB |
  | steady-state (6-7s) | -14.2dB | -17.4dB | -17.6dB |

  All three: babble across the whole scroll at a comparable, non-silent level; a genuine floor (all three
  ≤-71.6dB, true silence, not just quiet) across 2.55-3.0s; a smooth, monotonic rise to the bed's own
  steady-state level by ~6s — U04/U08's documented shape, unchanged by the deprecation.

  **Frame observations** (`ffmpeg -vf "select='eq(n\,N)'"`, read directly as PNGs, not inferred):
  - **wall-2026-09-01 frame 0**: dense 44px Literata scroll under the running head "MARCUS AURELIUS ·
    MEDITATIONS, BOOK 5" on a visibly tinted plate. Pixel-sampled the plate interior at (239,236,230) against
    `theme.ts`'s `TAG_BACKGROUND = '#F0EDE8'` (240,237,232) and a hairline pixel just below the plate edge at
    (231,229,219) against `BORDER = '#E8E2D9'` (232,226,217) — both within normal antialiasing distance of the
    real constants, confirming the tinted plate + hairline rule render as designed, not just as claimed. No
    numeral anywhere in frame (T17's retirement holds).
  - **frame 40 (mid-scroll)**: different text than frame 0, same running head fixed in the same position —
    confirms the scroll actually moves and the head doesn't.
  - **frame 74 (last wall frame) / frame 75 (the cut)**: frame 74 is still dense archaic scroll; frame 75 cuts
    hard to the payoff — "In plain English" at the label size (measured earlier at T10/U03 as 38px) in the
    exact slot the running head occupied, with "Things with souls are better than things without souls." set
    dramatically larger (81-88px range) below it, centred, no counter anywhere (D03 holds).
  - **frame 120**: pixel-identical to frame 75 in every region that has ink — confirms the payoff is genuinely
    motionless (house rule), not merely similar.
  - **wall-2026-09-03 frame 0** (a second author/book, Epictetus/Discourses): running head reads "EPICTETUS ·
    DISCOURSES, TO THOSE WHO FALL …" — the long-chapter-title clamp (ellipsis) fires correctly, proving the
    framing layer generalizes past the one Meditations card checked above, not just cosmetically similar on a
    single fixture.

  **The processing-time saving, measured empirically, not estimated.** Built a disposable `git worktree` at
  `629e6d3` (the last commit before D01, still carrying the full 14-post/two-slot/four-format machinery and
  its own committed schedule/exclusions/premises files) with `node_modules` symlinked in from the main
  checkout (confirmed `package.json`/`package-lock.json` identical between the two commits, so no reinstall
  needed) — this measures the REAL pre-deprecation baseline, not a linear guess:
  - **Render time, 7 vs 14 posts:** this task's 7-Wall week (`for d in 01..07: cli.ts render --date
    2026-09-$d`, no `--slot`) took **150.58s** wall-clock (`2:30.58`, measured via `time` on a from-scratch
    re-run into a scratch `--out` dir, after deleting all stale pre-D02 output first). The pre-D01 worktree's
    14-post week (`for d in 01..07; for s in 1 2: cli.ts render --date 2026-09-$d --slot $s`, its own committed
    schedule/exclusions, both already on disk at that commit) took **227.09s** (`3:47.09`). **1.51x faster,
    ~76.5s (34%) saved per week's render batch** — less than the naive "half the posts, half the time" guess,
    because per-invocation overhead (CLI startup, Remotion bundling) doesn't scale down with post count and the
    deleted formats' fixed 15.018s Question/Still renders were cheaper per-post than a real Wall's
    chapter-scroll render.
  - **Test suite time:** the same worktree's `npm test` (all three suites): **pipeline 819/819** (21 files,
    19.14s), **web 95/95** (7 files, 0.32s), **social 599/599** (31 files, 78.19s — matches D01's own
    contemporaneous "78.4s" figure almost exactly) — full `npm test` wall time **98.95s** (`1:38.95`). This
    task's own state (below) runs the full suite in **44.25-49.89s** (measured twice) — **roughly 2x faster**.
  - **Test counts:** pre-D01 total 1,513 tests (819+95+599) across 59 files; post-D04 total **1,029** tests
    (551+95+383) across 50 files — a **32% reduction**, tracking the deleted Question/Objection/Still
    compositions, their timing/gate modules, the read-through, and the counter.
  - Cleaned up the worktree (`git worktree remove --force`) and its scratch output after measuring; nothing
    from it is committed.

  **Two stale tests broke once the schedule/exclusions were regenerated for real** (both were deliberately
  left stale by D02/D03 for exactly this reason — see their own notes) — fixed as part of this task, not
  deferred:
  - `social/src/__tests__/cli.test.ts` hardcoded day 1 = `meditations-02-001` and day 6 = `meditations-02-006`
    from the STALE pre-D02 committed schedule. The freshly regenerated schedule resolves those days to
    `meditations-05-029` (day 1) and `discourses-53-019` (day 6) instead (D02's rewritten scheduler draws from
    the whole Wall pool, not a fixed read-through book-order walk) — updated the three hardcoded assertions and
    the `loadOutputCard` call to match, plus the explanatory comment.
  - `social/src/remotion/__tests__/exclusions.test.ts` still carried a whole "the read-through slice (F06/M2)"
    describe block (4 tests) that read `committed.meta.read_through_book`/`read_through_chapters`/
    `read_through` — all fields the regenerated, Wall-only `render-exclusions.json` no longer writes at all, so
    the block failed with `TypeError: The "path" argument must be of type string. Received undefined`. Per
    T17's own rule ("tests for deleted behavior are deleted, never adapted to something weaker"), DELETED the
    whole block outright rather than patching around the missing fields — the read-through itself was deleted
    in D02, so there is nothing left for this block to prove. Narrowed the file's `ExclusionsFile` interface to
    the real, current shape (`meta.generated_at`/`max_post_duration_frames`/`max_post_duration_seconds`/`wall`
    + `wall` entries only) and dropped the now-unused `loadBookCards`/`computeWallPlainLines`/`gateWallCard`/
    `selectLandingLine` imports.

  Updated this plan's own **Verify** block (below) for the current single-slot shape: no `--slot` on either
  command, one render per day not two, and `ffprobe` looped per-file (a glob of multiple inputs makes it
  reject the 2nd+ as a duplicate `-i`, a tool limitation T20 already hit and documented).

  **Verified:** `cd social && npx tsc --noEmit` clean. `npm test` (repo root, all three suites): **pipeline
  551/551** (21 files, 15.65s), **web 95/95** (7 files, 0.33s), **social 383/383** (22 files, 33.34s — down 4
  from D03's 387 for the deleted read-through-slice describe block) — all green. Full `npm test` wall time
  44.25-49.89s across two measured runs.

  **Recommended sample to hand the user: `social/out/wall-2026-09-01.mp4`.** Marcus Aurelius, Meditations Book
  5, a moderate 26.5s (not the 35.5s outlier), `bed-01-c-major9`, and every frame/audio measurement above was
  captured directly against this exact file: tinted running-head plate with its hairline rule, dense 44px
  chapter-sourced scroll, an audible hard cut into true silence, a slow bed return, and a single large payoff
  sentence with the 38px "In plain English" label — no counter, no numeral, motionless payoff.

  Left all 7 rendered MP4s (plus `-feed.jpg` and `.json` sidecars) in `social/out/` (gitignored). Regenerated
  `content/social/pilot-schedule-w01.json` and `content/social/render-exclusions.json` are left in the working
  tree, uncommitted, per instruction.
