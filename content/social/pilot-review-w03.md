# Week 3 Review — 2026-10-06

Pre-registered success criterion (`plans/complete/Pf39c2-social-pilot-index.md` — do NOT renegotiate after posting):
Viable requires at least one of A or B. A single 10x-median outlier is NOT sufficient; across 84 posts
(1 Wall post/day x 3 platforms x 28 days) one is expected from variance alone. Track maximum AND median AND
follow-conversion — the maximum alone is not the signal.
(84, not the ~168 this line said until 2026-09-21: that figure assumed 2 posts/day and predates
Pf39c2-social-pilot-02a D02, which collapsed the channel to one Wall post per day. docs/SOCIAL_PILOT.md
section 1 has the re-derivation. The argument is unchanged either way — a lone outlier among 84 posts is
still expected, just half as often.)

Filled in 2026-10-06, from all 14 week-3 rows under `content/social/metrics/` (read off each platform's per-post
screen and entered 2026-10-05 ~18:30 ET). Reproduce with `npx tsx social/src/metrics/readout.ts`.

**This is the pilot's last review note. The pilot stopped after week 3 — decided 2026-10-06, before any week-4 post
(see "Decision" below).** Week 3 ran on TikTok and YouTube only; Instagram stopped after week 2.

**Read about a day later than weeks 1-2.** Those were read on the Sunday night after the week closed; week 3 was read
Monday evening ET, so Day 7 was ~31 hours old rather than ~16. That gives week 3's posts slightly longer to accrue
views — it can only flatter week 3, and week 3 still came in below week 1.

## Schedule
- Schedule file: content/social/pilot-schedule-w03.json
- Combined author mix: epictetus 3 (42.9%), marcus-aurelius 3 (42.9%), seneca 1 (14.3%)

## Per-post views
<!-- Fill in each post's total views below (sum across TikTok + Instagram + YouTube, or note per-platform if the split matters). -->
TikTok + YouTube only; per-platform breakdown on each line, as in weeks 1-2.
- Day 1 — wall, meditations-06-063: 302 (TT 189 / YT 113) views
- Day 2 — wall, peace-of-mind-15-005: 376 (TT 126 / YT 250) views
- Day 3 — wall, discourses-55-001: 376 (TT 174 / YT 202) views
- Day 4 — wall, enchiridion-01-001: 321 (TT 155 / YT 166) views
- Day 5 — wall, meditations-10-030: 378 (TT 154 / YT 224) views
- Day 6 — wall, discourses-46-005: 544 (TT 367 / YT 177) views
- Day 7 — wall, meditations-01-012: 313 (TT 197 / YT 116) views

## Retention metrics
- Median views (this week): 175.5
- Maximum views (this week): 367
- Follows gained (this week): 0

Across all 14 posts. Per platform, beside weeks 1-2 — criterion B is measured on these:

| Platform | Posts | Total views (w1 → w2 → w3) | Median (w1 → w2 → w3) | Max (w1 → w2 → w3) | Follows (w1 → w2 → w3) |
|---|---|---|---|---|---|
| TikTok | 7 | 1,229 → 1,180 → 1,362 | 199 → 158 → **174** | 245 → 216 → 367 | 1 → 1 → 0 |
| YouTube | 7 | 1,414 → 1,906 → 1,248 | 212 → 185 → **177** | 398 → 500 → 250 | 0 → 3 → 0 |
| **Both** | **14** | **2,643 → 3,086 → 2,610** | | | **1 → 4 → 0** |

Follow conversion is `exact` on both, 21/21 posts each across three weeks. Every `0` is a real reading.

**Flat views, falling or stalled medians, zero follows.** The two platforms' combined views are back at week 1's level.
TikTok's median recovered part of week 2's drop but sits below week 1; YouTube's has fallen three weeks running. The
week's best post, Day 6 on TikTok (`discourses-46-005`, 367), is TikTok's best of the pilot and still under 2x its
median. The cross-platform ranking went further the other way than in week 2: TT–YT Spearman **−0.68** (week 1
+0.64..+0.86, week 2 −0.14). Day 2 was YouTube's best and TikTok's worst; Day 6 the reverse.

## Criterion A — Breakout with conversion
<!-- Met when a single post clears ~10,000 views on any platform AND visibly converts to follows. -->
- Criterion A met (yes/no): no
- Criterion A evidence: the week's maximum on either platform is 367 views (TikTok, Day 6, `discourses-46-005`) against a ~10,000-view threshold — ~27x short — and it converted no one. No week-3 post on either platform drew a follow. Across all three weeks the maximum is 500 (YouTube, week 2) and the total is 5 follows in 9,045 views.

## Criterion B — Accumulating standing
<!-- Met when the account's median views trend upward from week 1 to week 4. Not assessable before week 2. -->
- Criterion B met (yes/no/not-yet-assessable): not assessed — the pilot stopped before week 4
- Criterion B evidence: criterion B compares week 1 against week 4, and week 4 was not run, so it gets no formal verdict. What three weeks show: TikTok 199 → 158 → 174, YouTube 212 → 185 → 177. For a YES, week 4 would have had to beat week 1 on a platform — above 199 on TikTok or 212 on YouTube — which neither has done since week 1.

## Decision for next week
<!-- Must be a deliberate choice made FROM the metrics above, not a hunch. -->
- Next week hook changes: none — **the pilot stops. Week 4 (2026-10-05..11) is not generated, rendered or posted.**
  Decided 2026-10-06, after reading the numbers above and before any week-4 post. The accounts stay up, untouched.
- Reason: no plausible week-4 outcome would change what happens next. Criterion A is ~20x out of reach on the best
  post of 56. Criterion B could at most be met on its letter: a week-4 median just above 199 or 212 would still mean
  ~200 views a post, five follows in four weeks, and ~3-5 site visitors a week — a "viable" that would not justify
  building around social. Week 4 was also already compromised: its first two days (10/5, 10/6) were missed, so it
  would have been at most five days, posted late, and read on a different cadence from weeks 1-3 — a weak result
  could be blamed on that, so it would not have been a clean reading either way. Against that, ~10 uploads and a
  readout session.
- What it costs: criterion B gets no formal verdict. Runbook section 8 records the outcome as **"stopped after week 3;
  criterion A not met, criterion B not formally assessed"**, not as a measured NO — the same treatment Instagram got
  after week 2. The readout's printed "NOT VIABLE" is quoted there, labelled as a three-week run.

## Site traffic — reported beside the verdict, not part of it
**2026-09-28..10-04: 3 unique visitors** (Umami, read 2026-10-06), against ~4 in week 1 and 5 in week 2. Over three
weeks: ~12 visitors from 9,045 post views.
