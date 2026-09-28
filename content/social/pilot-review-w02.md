# Week 2 Review — 2026-09-28

Pre-registered success criterion (`plans/complete/Pf39c2-social-pilot-index.md` — do NOT renegotiate after posting):
Viable requires at least one of A or B. A single 10x-median outlier is NOT sufficient; across 84 posts
(1 Wall post/day x 3 platforms x 28 days) one is expected from variance alone. Track maximum AND median AND
follow-conversion — the maximum alone is not the signal.
(84, not the ~168 this line said until 2026-09-21: that figure assumed 2 posts/day and predates
Pf39c2-social-pilot-02a D02, which collapsed the channel to one Wall post per day. docs/SOCIAL_PILOT.md
section 1 has the re-derivation. The argument is unchanged either way — a lone outlier among 84 posts is
still expected, just half as often.)

Filled in 2026-09-28, from all 21 week-2 rows under `content/social/metrics/` (read off each platform's per-post
screen late on 2026-09-27 ET). Reproduce with `npx tsx social/src/metrics/readout.ts`.

**Posts are read at different ages, and that is the same for both weeks.** Day 1 was ~6.7 days old when read, Day 7
~16 hours — week 1 was read on the same Sunday-night-after-the-week cadence, so week-to-week comparisons are like for
like. Week 4's readout has to keep that cadence (read on the evening of 2026-10-11 or the morning after): reading it
later would give its posts longer to accrue views and manufacture a criterion-B trend out of timing alone.

## Schedule
- Schedule file: content/social/pilot-schedule-w02.json
- Combined author mix: epictetus 3 (42.9%), marcus-aurelius 3 (42.9%), seneca 1 (14.3%)

## Per-post views
<!-- Fill in each post's total views below (sum across TikTok + Instagram + YouTube, or note per-platform if the split matters). -->
Per-platform breakdown on each line, as in week 1 — the platforms still differ by ~6x.
- Day 1 — wall, meditations-02-012: 346 (IG 27 / TT 134 / YT 185) views
- Day 2 — wall, on-anger-02-075: 684 (IG 26 / TT 213 / YT 445) views
- Day 3 — wall, enchiridion-50-001: 291 (IG 21 / TT 158 / YT 112) views
- Day 4 — wall, enchiridion-28-001: 816 (IG 115 / TT 201 / YT 500) views
- Day 5 — wall, meditations-03-024: 348 (IG 12 / TT 156 / YT 180) views
- Day 6 — wall, enchiridion-23-001: 351 (IG 66 / TT 216 / YT 69) views
- Day 7 — wall, meditations-09-030: 566 (IG 49 / TT 102 / YT 415) views

## Retention metrics
- Median views (this week): 134
- Maximum views (this week): 500
- Follows gained (this week): 4

Across all 21 posts, as the template asks. The per-platform figures, beside week 1's, are what criterion B is
measured on:

| Platform | Posts | Total views (w1 → w2) | Median (w1 → w2) | Max (w1 → w2) | Follows (w1 → w2) |
|---|---|---|---|---|---|
| Instagram | 7 | 390 → 316 | 65 → **27** | 107 → 115 | 0 → 0 |
| TikTok | 7 | 1,229 → 1,180 | 199 → **158** | 245 → 216 | 1 → 1 |
| YouTube | 7 | 1,414 → 1,906 | 212 → **185** | 398 → 500 | 0 → 3 |
| **All** | **21** | **3,033 → 3,402** | **145 → 134** | **398 → 500** | **1 → 4** |

Follow conversion is `exact` on all three platforms, 14/14 posts each across both weeks. A `0` is a real reading.

**Total views rose 12% while every platform's median fell.** The whole rise is YouTube, and on YouTube it is carried
by three posts (Days 2, 4 and 7, at 445 / 500 / 415) while its median dropped 13%. Instagram fell the most: its median
more than halved, and its seven posts drew **zero likes between them**.

## The week-1 cross-platform pattern did not hold
Week 1's review called the same card ranking similarly on all three platforms "the most interesting thing in the
week" (Spearman +0.64 to +0.86), while noting it was not significant at n=5 once the two confounded days were
dropped. Week 2 answers it: **IG–TT +0.25, IG–YT +0.32, TT–YT −0.14.** Week 2 has no cold-start day and no
anomalous post to explain that away. At n=7 neither week's figures are significant, but the reading that week 1's
consistency meant "some cards are simply better, everywhere" is not supported. Day 6 is the clearest case: TikTok's
best post of the week (216) was YouTube's worst (69).

## Criterion A — Breakout with conversion
<!-- Met when a single post clears ~10,000 views on any platform AND visibly converts to follows. -->
- Criterion A met (yes/no): no
- Criterion A evidence: the week's maximum on any platform is 500 views (YouTube, Day 4, `enchiridion-28-001`) against a ~10,000-view threshold — ~20x short. That same post is also the week's best converter, at 2 follows; the week's 4 follows came from YouTube Day 4 (2), YouTube Day 6 (1) and TikTok Day 2 (1). Four follows across 3,402 views is up from one, and still ~0.1%.

## Criterion B — Accumulating standing
<!-- Met when the account's median views trend upward from week 1 to week 4. Not assessable before week 2. -->
- Criterion B met (yes/no/not-yet-assessable): not-yet-assessable
- Criterion B evidence: criterion B compares week 1 against week 4, so week 2 cannot settle it. The direction is not encouraging: all three platforms' medians fell from week 1 (Instagram 65 → 27, TikTok 199 → 158, YouTube 212 → 185). For week 4 to show an upward trend, each platform would need to recover past its week-1 median, not just past week 2's. Week 1's Day 3 YouTube anomaly (1 view) is still inside the week-1 baseline; YouTube's week-1 median is 240 without it, which makes its bar higher, not lower.

## Decision for next week
<!-- Must be a deliberate choice made FROM the metrics above, not a hunch. -->
- Next week hook changes: none to format, timing or selection method. Week 3 (2026-09-28..10-04) was generated with seed 42 on 2026-09-28, before this note was filled, via `--skip-review-check` — Day 1 posted at 07:30 ET the same morning and TikTok cannot be scheduled more than 10 days out, the same constraint as week 2's sitting. One card was rejected by hand in that draw: `meditations-04-030` (landing line was a list of insults, the setup to the passage and not its payoff — logged in `rejected-cards.json`), which re-drew Days 5 and 7.
- Reason: nothing in week 2 points at a change that could be defended. The only candidate signal from week 1 — that some cards do well everywhere — did not replicate, so there is nothing to select harder for. Falling medians are a reason to watch, not a reason to change: criterion B is a week-1-to-week-4 median trend, and changing format, cards or posting time in week 3 would confound the very trend the pilot exists to measure. Two weeks of a flat-to-falling median on accounts this new is also exactly what the criterion anticipates for a NO. Let weeks 3-4 run unchanged.

## Carried into week 3 — operational, not experimental
1. **Site traffic for 2026-09-21..27: 5 visitors** (Umami, read 2026-09-28), against ~4 in week 1. 3,402 post
   views produced 5 visits — the week-1 shape holds: views, follows and site traffic all near zero. Runbook 8.2
   reports this beside the verdict.
2. **Week 1 Day 3 YouTube (`t_9C0SzdAks`, 1 view): closed.** Its Reach screen reads **3**, read 2026-09-28. Near-zero
   impressions means YouTube never put it into the Shorts feed at all, rather than showing it and having it ignored;
   why it was withheld is still unknown. It is the only such post among YouTube's 14 so far. The row stays as recorded.
3. **Week 1 Day 1 TikTok (0 views): closed.** Confirmed published. Recorded as a TikTok quirk with no cause
   established; the 0 stays in the week-1 baseline as a real reading.
4. **The render needed a fix on 2026-09-28, unrelated to the experiment.** `ffprobe-static`'s darwin/arm64 binary is
   actually x86_64 and had only ever run under Rosetta, which the macOS 27 machine no longer has; every render failed
   after encoding with `spawn Unknown system error -86`. `social/src/render/encode.ts` now uses the native `ffprobe`
   on PATH on Apple Silicon. Week 3's videos were rendered after the fix, and nothing about the encode changed.
5. **Week 4 must be scheduled by ~2026-10-02** so TikTok's 10-day window covers it, and its review note is due with
   week 3's numbers.
