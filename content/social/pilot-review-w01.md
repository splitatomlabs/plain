# Week 1 Review — 2026-09-20

Pre-registered success criterion (`plans/complete/Pf39c2-social-pilot-index.md` — do NOT renegotiate after posting):
Viable requires at least one of A or B. A single 10x-median outlier is NOT sufficient; across 84 posts one is
expected from variance alone. Track maximum AND median AND follow-conversion — the maximum alone is not the signal.

(The template this note was generated from said "~168 posts" here — a figure that predates
`Pf39c2-social-pilot-02a` D02, which collapsed the channel to one Wall post per day. Corrected to 84 by hand in this
note, and in `scripts/lib/review.ts` itself on 2026-09-21, so weeks 2-4's notes are generated correct rather than
needing the same hand-correction. The runbook's section 1 has the re-derivation.)

Filled in 2026-09-21, from all 21 week-1 rows under `content/social/metrics/`. Reproduce with
`npx tsx social/src/metrics/readout.ts`.

## Schedule
- Schedule file: content/social/pilot-schedule-w01.json
- Combined author mix: epictetus 3 (42.9%), marcus-aurelius 1 (14.3%), seneca 3 (42.9%)

## Per-post views
<!-- Fill in each post's total views below (sum across TikTok + Instagram + YouTube, or note per-platform if the split matters). -->
The split matters — the three platforms differ by ~4x — so each line carries the per-platform breakdown.
- Day 1 — wall, meditations-09-025: 41 (IG 25 / TT 0 / YT 16) views
- Day 2 — wall, on-anger-02-062: 718 (IG 75 / TT 245 / YT 398) views
- Day 3 — wall, discourses-60-001: 188 (IG 28 / TT 159 / YT 1) views
- Day 4 — wall, enchiridion-41-001: 352 (IG 21 / TT 186 / YT 145) views
- Day 5 — wall, shortness-of-life-02-003: 531 (IG 107 / TT 212 / YT 212) views
- Day 6 — wall, enchiridion-27-001: 641 (IG 69 / TT 199 / YT 373) views
- Day 7 — wall, happy-life-03-004: 562 (IG 65 / TT 228 / YT 269) views

## Retention metrics
- Median views (this week): 145
- Maximum views (this week): 398
- Follows gained (this week): 1

The three fields above are across all 21 posts, since the template carries one of each. The per-platform figures are
what criterion B will actually be measured on, and they are the numbers to compare week 4 against:

| Platform | Posts | Total views | Median | Max | Follows |
|---|---|---|---|---|---|
| Instagram | 7 | 390 | 65 | 107 | 0 |
| TikTok | 7 | 1,229 | 199 | 245 | 1 |
| YouTube | 7 | 1,414 | 212 | 398 | 0 |
| **All** | **21** | **3,033** | **145** | **398** | **1** |

Follow conversion is `exact` on all three platforms — every post's figure was read off the platform's own screen,
not inferred. A `0` here is a real reading, not a gap.

## Known anomaly — the Day 3 YouTube post, unexplained
The Day 3 YouTube post (`discourses-60-001`, video `t_9C0SzdAks`) drew **1 view**, while the same card took 159 on
TikTok and 28 on Instagram the same day. Checked and ruled out: visibility is Public with no restrictions shown in
Studio; the rendered file is structurally identical to Day 7's, which drew 269; the title is 95 characters, inside
the 100 limit, and Day 4's 100-character title drew 145 (title length against views across the week is Spearman
-0.21, i.e. no relationship). No cause was established.

**The row is left exactly as recorded.** The reading is accurate, and removing an inconvenient data point is the
post-hoc adjustment the pre-registered criterion exists to prevent. It does move the arithmetic, so the week-4
reader should know: YouTube's week-1 median is **212 with it and 240 without**, and criterion B measures week 1
against week 4, so that ~13% sits inside the baseline.

## Criterion A — Breakout with conversion
<!-- Met when a single post clears ~10,000 views on any platform AND visibly converts to follows. -->
- Criterion A met (yes/no): no
- Criterion A evidence: the week's maximum on any platform is 398 views (YouTube, Day 2) against a ~10,000-view threshold — not a near miss, ~25x short. Follow conversion across all 3,033 views is a single follow (TikTok, Day 7, 228 views); every other post on every platform converted zero, read exactly rather than inferred. Neither half of criterion A is close.

## Criterion B — Accumulating standing
<!-- Met when the account's median views trend upward from week 1 to week 4. Not assessable before week 2. -->
- Criterion B met (yes/no/not-yet-assessable): not-yet-assessable
- Criterion B evidence: criterion B is a week-1-to-week-4 median trend and there is only one week of data, so it cannot be evaluated yet by construction. This week establishes the baseline it will be measured against: medians of 65 (Instagram), 199 (TikTok), 212 (YouTube). Day 1 is a cold-start day (41 views total, TikTok 0) but does not meaningfully depress that baseline — excluding it moves the medians only to 67 / 206 / 240, since a median is robust to one low value. The baseline is sound as recorded.

## Decision for next week
<!-- Must be a deliberate choice made FROM the metrics above, not a hunch. -->
- Next week hook changes: none. Week 2 is already generated, rendered and scheduled, and it ships unchanged.
- Reason: there is no evidence here that could justify a content change, and making one would cost more than it could buy. On the data: the same cards rank similarly across all three platforms (Spearman +0.64 to +0.86 across seven days), which is the most interesting thing in the week — but two of those seven days are confounded (Day 1's cold start, Day 3's YouTube anomaly), and dropping them takes it to +0.40 to +0.70 at n=5, which is not significant. Nothing else correlates: not title length (-0.21), not video duration (+0.11). On method: criterion B is a week-1-to-week-4 median trend, so changing the cards, the format or the posting time mid-run confounds the exact signal the pilot exists to measure. The honest reading of week 1 is that it is one week of baseline, and the right action is to let weeks 2-4 run and see whether the cross-platform ranking consistency holds up.

## Carried into week 2 — operational, not experimental
None of these change what gets posted; they fix measurement plumbing that week 1 showed to be broken or unverified.

1. **Instagram and TikTok do not render caption URLs as clickable links**, so `/go/ig` and `/go/tt` in those
   captions are plain text, and TikTok has no bio link either (deferred pending Business verification — runbook
   3.0). Runbook 3.0's claim that caption attribution survives that deferral looks wrong. The `/go/` redirects
   themselves work — all three return 302 with the correct `utm_source`. **But see "Site traffic" below before
   acting on any of this: the missing links turn out not to be the bottleneck.**
2. ~~**Check Umami for `/go/` traffic.**~~ **Done 2026-09-21 — and it is the most important number week 1
   produced.** See "Site traffic" below.
3. **Day 3 YouTube: read Impressions** on `t_9C0SzdAks` (Analytics → Reach). Near-zero impressions means it never
   entered the Shorts feed; thousands with ~0% CTR means it was shown and ignored. Those have opposite implications
   and nothing else distinguishes them. Also worth confirming the video shows the right card — a duplicate file
   uploaded twice would be suppressed by duplicate detection while Studio showed nothing wrong.
4. **TikTok Day 1 drew 0 views.** Cold start explains low, not zero; confirm it actually published.

## Site traffic — 3,033 post views produced ~4 visitors
Checked in Umami on 2026-09-21, covering the 7 days of week 1: **~4 site visitors, all reported as direct, none
attributed to a `/go/` link.** The Umami tag is installed and working on the live site (verified the same day), and
is configured to honour Do Not Track, so it undercounts by an unknown but small amount — not remotely enough to
explain the ratio.

**The decisive detail is YouTube.** Its 1,414 views came with a working, clickable description link, and produced
no more traffic than Instagram and TikTok, where the caption URL is not clickable at all. So the missing links are
real but are NOT the bottleneck, and the earlier plan to buy a clickable path on TikTok (Business verification,
runbook 3.0) should be dropped unless something else changes — it buys exactly what YouTube already had and did not
benefit from. The plausible constraint is that short-form viewers do not leave the app, compounded on Shorts by the
description being collapsed behind a tap.

Two caveats against over-reading it. The 4 direct visits may themselves be social traffic — someone who cannot tap
a caption URL and types the domain by hand arrives as direct — so the true figure is not necessarily zero. And one
week at cold start, on accounts with no standing, is genuinely early.

**What this does NOT do is touch the verdict.** Criterion A is views plus follows; criterion B is a median-views
trend. Neither measures site traffic, so nothing here changes the pre-registered machinery, and nothing here may be
used to renegotiate it. What it exposes is a gap worth stating plainly: **the pilot can satisfy criterion B and
still deliver zero readers** — views trending up week 1 to week 4 would register as "viable" over an empty site,
and Plain's goal is people reading books. That is a reason for section 8.2 of the runbook to report site traffic
beside the verdict (added 2026-09-21), not a reason to change what counts as viable.

Three ways of asking whether anyone cared — 3,033 views, 1 follow, ~4 visits — give three answers near zero. Too
early to conclude at one week. If weeks 2-4 hold this shape, the verdict the criterion already anticipates is the
honest one.
