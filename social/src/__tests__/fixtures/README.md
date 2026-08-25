# Test fixtures

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
