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
