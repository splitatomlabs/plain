# Test fixtures

## `pilot-schedule-w01.json` — REMOVED (social pilot 02 F19, 2026-08-26)

This fixture existed only because a real week-1 schedule could not be
generated (see the F16/F18 history below, preserved for context). F19 fixed
the underlying structural gap it was standing in for: the read-through now
has a STILL fallback (`social/src/remotion/Still.tsx` — the card's own
`plain_english`, verbatim, motionless, over the music bed), reached whenever
a read-through card can render none of Wall/Question/Objection. With that
fallback in place, `npx tsx scripts/generate-schedule.ts --week 1 --seed 42
--first-week --force` succeeds and produces a REAL
`content/social/pilot-schedule-w01.json` — day 1, 3, 4 and 7 of the
read-through resolve to `still` (their sequential cards,
`meditations-02-001/-003/-004/-007`, are all too short for the Wall gate's
travel target and this slice has no Question/Objection candidate for any
card), day 2, 5 and 6 resolve to `wall`. `cli.test.ts`'s end-to-end render
tests (`render — end-to-end: a real MP4...`, `render — end-to-end: The
Question`) now read the real committed week-1 file directly again, and a new
`render — end-to-end: The Still (F19)` test exercises the fallback itself
through the real render path, using `meditations-02-003` — one of the exact
cards this whole investigation was about.

**Preserved history (F16/F18, superseded by F19):** F16 briefly moved the
Wall to a single FIXED font size, which cost most of the corpus's renderable
supply; F18 replaced the fixed size with a per-card fit
(`wall-timing.ts`'s `fitWallFontSize`), which recovered most of it but still
left the read-through's default Meditations book-02/03 slice without seven
consecutive Wall-renderable cards from its very start (the longest real run
anywhere in that slice is 5) — and a fresh `questionGate`/`objectionGate`
run found ZERO Question/Objection candidates anywhere in the slice, so
every card had to clear Wall or the week failed. That gap — not the Wall
geometry — is what F19's Still fallback closes.

## `pilot-schedule-w02.json`

This is a **test fixture**, not real pipeline state — it must never live under
`content/social/` and must never be read by `loadPriorWeeks` (`scripts/lib/
schedule.ts`) or fed to a real week-3 generation.

**How it was generated:**

```
npx tsx scripts/generate-schedule.ts --week 2 --seed 42 --objection-weight 20 --skip-review-check
```

**Why those flags, and why that makes it a fixture:**

- `--objection-weight 20` is wildly higher than the pilot's real default
  (`1`). It exists purely to reliably land an Objection slot in the draw —
  week 1 (`content/social/pilot-schedule-w01.json`) has none, so
  `cli.test.ts`'s F08 end-to-end Objection test (`render — end-to-end: The
  Objection`) had no real schedule to exercise the format against.
- `--skip-review-check` deliberately bypasses plan 01's review gate
  (`scripts/generate-schedule.ts`, see `--skip-review-check`'s own doc
  comment), which normally refuses to generate week N+1 until week N's
  review note is filled in. A real week 2 also carries week 1's REVIEWED
  weights forward (`scripts/generate-schedule.ts:266`); this fixture does
  neither.

Because of both, this file cannot stand in for a real week 2: regenerating a
real week 2 later requires going through the review gate and weight
carry-forward, and would very likely draw a different schedule than this
fixture. Keep it out of `content/social/` so `loadPriorWeeks` never sees it,
and point only test code at it via `cli.ts`'s `--schedule-dir` override.
