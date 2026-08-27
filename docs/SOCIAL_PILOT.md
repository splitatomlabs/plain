# Social Pilot

This document is being built out incrementally by `plans/Pf39c2-social-pilot-03.md`.
T15 is the task that writes the full runbook (account creation hygiene, the
weekly session, the pre-registered criterion, what to do if the Meta account
is disabled). T16 adds the ~4-week findings.

This section — TikTok metrics collection — was written by T13, ahead of T15,
because T13's own acceptance criterion is "a written finding," and T15 was
told to expect this section already here rather than write it itself. If
you are T15: fold this section into the runbook's "weekly session" coverage
(it already documents what T13 left manual) rather than duplicating it.

## TikTok metrics collection (T13)

### The question this section answers

TikTok's **posting** API is unusable for this pilot (see the plan's own
Decision — TikTok posts go up through the app's native scheduler, by hand,
during the weekly session; see `social/src/publish/tiktok-manual.ts`). That
says nothing about TikTok's **read** path, though — posting and reading are
different APIs with different scopes. This section settles, or records that
it has not yet settled, whether TikTok's per-post metrics (views, likes,
comments, shares) can be collected automatically, the same way
`social/src/metrics/instagram.ts` and `social/src/metrics/youtube.ts`
already do for their platforms.

### The two candidate read paths

Per the plan's own Constraint (`plans/Pf39c2-social-pilot-03.md`, this
task's Constraint block):

1. **Display API, `video.list` scope.** Documented to return **per-video
   view/like/comment/share counts** — "enough for median, maximum and
   trend." Reachable with an **unaudited app** in TikTok's Sandbox mode,
   scoped to a target user the developer explicitly adds (i.e. the pilot's
   own account) — no App Review needed. This is the path this task's spike
   (`social/src/metrics/tiktok-spike.ts`) attempts.
2. **Business Account API.** Additionally returns **average watch time,
   profile views, and a follower series** — but needs a **Business
   account** and **app approval**. Strictly more setup than path 1, and
   nothing in this pilot's scope needs those extra fields badly enough to
   justify that setup on its own — see the decision rule below.

**Retention curves and traffic-source data are in-app only on TikTok,
regardless of which of these two paths is used.** Neither path exposes
them. This stays manual on TikTok no matter what the spike finds.

### The decision rule

- **If the spike shows `video.list` returns usable per-video view/like/
  comment/share counts** (all four present as real numbers on real
  videos): automate it. Build a real collector mirroring
  `social/src/metrics/instagram.ts`'s/`youtube.ts`'s shape — list this
  account's videos, filter to the 30-day polling window
  (`schema.ts`'s `isWithinPollingWindow`), map each to a `MetricsRow` with
  `platform: 'tiktok'`. `follows` and `saves` stay `null` on that row
  either way (see "Why `follows`/`saves` are null" below) —only the four
  counts change from hand-typed to fetched.
- **If it does not** (the call fails outright for an unaudited app, the
  scope isn't grantable without a review this pilot isn't pursuing, or the
  fields come back missing/empty): use the hand-entry fallback,
  `social/src/metrics/tiktok-manual.ts`, already fully built (see below).
  The Business Account API is **not** treated as a fallback-of-a-fallback —
  it needs strictly more setup (a Business account, app approval) than
  Display API `video.list` does, so if the lighter-weight path fails, hand
  entry is cheaper than the heavier-weight path, not the other way round.

This mirrors the task's own Timebox instruction: the manual fallback costs
about 7 rows a week inside a session (the weekly TikTok/YouTube staging
session, `social/src/publish/tiktok-manual.ts`'s own weekly cadence) that
already happens — not worth an open-ended integration effort to avoid.

**Note on "~14 rows a week":** the task brief that produced this section
says "~14 rows a week." That figure is stale, for the same reason
`social/src/publish/tiktok-manual.ts`'s own header flags it stale for T07's
"14 videos" acceptance wording: it predates `Pf39c2-social-pilot-02a` D02,
which collapsed the channel to a single Wall post per day. One TikTok post
a day is **7 rows a week**, not 14. Nothing built for T13 hard-codes either
number — `tiktok-manual.ts` processes one hand-entered post per invocation,
however many a real week's post count actually is.

### Status: the spike has NOT been run

**This is the load-bearing sentence in this section: nobody has run
`social/src/metrics/tiktok-spike.ts` against a real account yet, so the
finding is currently UNDETERMINED — the hand-entry fallback is in force by
default, not because the Display API is known not to work.** The session
that wrote this document had no TikTok account and no TikTok app
credentials to test with; running the spike needs a real pilot TikTok
account, a TikTok developer app (unaudited is fine — Sandbox mode), and an
OAuth access token with the `video.list` scope authorized against that
account. None of that exists yet in this repo or its secrets.

**What running the spike requires, step by step:**

1. Register a TikTok developer app at TikTok's developer portal (any
   unaudited/Sandbox app is sufficient for this spike — no App Review
   needed for path 1).
2. Add the pilot's own TikTok account as a Sandbox **target user** on that
   app (Sandbox mode restricts which accounts an unaudited app can act on
   behalf of — this step is required, not optional).
3. Complete TikTok's OAuth flow for that app with the `video.list` scope,
   authorizing the pilot account, to obtain an access token.
4. Post at least one video to the pilot TikTok account (a video-less
   account will make the spike report "zero videos," which is inconclusive
   — see the spike's own `deriveVerdict` for why this is handled as its own
   result, not silently folded into "not viable").
5. Run:
   ```
   npx tsx social/src/metrics/tiktok-spike.ts --access-token <token>
   ```
   from `social/`. (`--help` works without any of the above, to confirm the
   script itself runs before doing any of steps 1-4.)
6. Read the printed verdict and the raw response the script prints (the
   token itself is redacted from anything echoed back). Update THIS
   section's "Status" above with the actual result — replace "has NOT been
   run" with the date it was run and which of the two outcomes it found,
   and follow the decision rule above.

**Do not treat this document as claiming the Display API works, or does
not work, until that has actually happened.** The spike exists precisely
to answer that question; asserting an answer here without running it would
defeat the point of spiking at all.

### The hand-entry fallback (already built, works today regardless of the spike's outcome)

`social/src/metrics/tiktok-manual.ts` is fully built and tested (30 tests in
`social/src/metrics/__tests__/tiktok-manual.test.ts`) and does not depend on
the spike's outcome — it is the fallback path if the spike fails, AND it is
usable today, before the spike has even been run, since TikTok posting is
already manual and the weekly session already happens.

During the weekly session (the same session
`social/src/publish/tiktok-manual.ts` stages TikTok's posts for), for each
TikTok post still inside its 30-day polling window, read four numbers off
TikTok's own per-video analytics screen — **views, likes, comments,
shares** — and run:

```
npx tsx social/src/metrics/tiktok-manual.ts \
  --post-id <tiktok-video-id> \
  --published-at <ISO8601 publish instant, from the app> \
  --views <n> --likes <n> --comments <n> --shares <n>
```

This writes (or updates, if the post already has a row for that date — it
is idempotent, matching every other platform's collector) one `MetricsRow`
into the SAME dated file
(`content/social/metrics/metrics-<date>.json`) that
`social/src/metrics/collect.ts` already writes Instagram's and YouTube's
rows into — a TikTok row sits alongside them, same schema, same file, no
separate format to reconcile at readout time (T14).

**Why `follows` and `saves` are always `null` on a TikTok row, hand-entered
or (if the spike succeeds) automated:** per the plan's own Decision,
"per-post follow attribution exists only on YouTube" (`subscribersGained`,
scoped to one video). TikTok has no per-video follow count on either
candidate read path — the Business Account API's follower data is an
account-level series, the same shape problem Instagram already has (see
`schema.ts`'s `InstagramFollowerSnapshot`), and no TikTok equivalent
collector for that series exists. `saves` is not one of the four counts
either TikTok read path is documented to return, and is not on the app's
own per-video analytics screen either — so it, too, is always `null`, never
a fabricated number.

**Why `averagePercentWatched` is always `null` by default:** the plan's own
Constraint states plainly that "retention curves ... are in-app only on
TikTok regardless" — this is explicitly out of THIS schema's scope on
TikTok, not merely tedious to type in. `tiktok-manual.ts` accepts it only
as an optional override (`--avg-percent-watched`, validated 0-100) for the
rare case the app shows a clean percentage next to a video; nobody is
required to fill it in, and leaving it out records `null`, never a
fabricated `0` or guessed value.

**Validation, so a typo does not silently corrupt a row:** every hand-typed
number is checked — the four counts must be non-negative whole numbers, an
optional watch percentage must fall within 0-100, and both dates
(`--published-at`, `--collected-at`) must parse as real instants. Any
violation throws `TikTokHandEntryValidationError` naming the exact bad
field and value, before anything is written to disk — hand entry's
expected failure mode is a mistyped number, not a network error, so this
fails loudly rather than recording a bad row silently.
