# Social Pilot — Runbook

This is the operating manual for the social viability pilot (`plans/Pf39c2-social-pilot-index.md`
and its three sub-plans, `Pf39c2-social-pilot-01/02/02a/03.md`). It is written so someone who was
not involved in building this system can run the pilot day to day and week to week from this
document alone — every command below is real, copy-pasteable, and checked against the actual
source files as of 2026-08-27, not paraphrased.

**Read the "Current status" section (near the bottom) before doing anything else.** Six live steps
this pilot depends on have never been run. This document describes the system as designed and
built; it does not claim the system has been switched on.

## 1. What the pilot is, and the pre-registered criterion

**The question:** is social media viable at all for Plain? Not which format performs best — that
cannot be answered at n=1 (one Instagram account, one TikTok account, one YouTube channel, 84
posts over four weeks — 1 Wall post/day x 3 platforms x 28 days).

**Success criterion, copied verbatim from `plans/Pf39c2-social-pilot-index.md` — do not renegotiate
this after posting starts:**

> A single 10x-median outlier is NOT sufficient; across 84 posts (1 Wall post/day x 3 platforms x 28
> days) one is still expected from variance alone. (Re-derived 2026-09-09: an earlier ~168 here — 2
> posts/day x 3 platforms x 28 days — predates `Pf39c2-social-pilot-02a` D02, which collapsed the
> channel to a single Wall post per day; nobody re-derived the post count after that decision. 84 is
> half of 168, so a lone outlier is expected roughly half as often as the stale figure implied — but
> "half as often" is still "expected," so the argument's point survives unchanged: one 10x spike
> among 84 posts is not evidence of anything by itself.)
>
> Viable requires at least one of:
> - **A. Breakout with conversion** — a post clearing ~10,000 views on any platform AND converting
>   visibly to follows.
> - **B. Accumulating standing** — the account's median views trend upward from week 1 to week 4.
>
> Either met -> social is viable; rebuild around whatever premise did it.
> Neither met -> stop. **An outlier with no conversion and no trend is explicitly a NO.**
>
> Track maximum AND median AND follow-conversion. The maximum alone is not the signal.

The reason this is written down and quoted, not summarized: the whole point of pre-registering a
criterion is that nobody gets to argue it into a "win" after seeing an exciting number. If week 3
produces one post at 40,000 views on an account that otherwise gets 400, that is the "10x outlier"
the criterion explicitly anticipates and rules insufficient on its own — check whether it converted
to follows (criterion A) or whether the *median* also moved (criterion B) before calling anything.

`social/src/metrics/readout.ts` is the code that actually computes this verdict — not a spreadsheet,
not a judgment call. It implements criterion A and criterion B exactly as quoted above
(`computeReadout`/`computeVerdict`), labels follow-conversion as `'exact'` (YouTube,
`subscribersGained` per video) or `'inferred'` (Instagram/TikTok, from day-over-day follower deltas)
or `'unavailable'`, and its summary text literally contains the "outlier with no conversion and no
trend is explicitly a NO" wording so a raw max/median ratio can never flip the verdict by itself.
Section 7 below covers running it.

## 2. Account creation hygiene

These rules exist to avoid getting the accounts banned before the four weeks are up — not general
best practice, but specific mitigations against specific enforcement mechanisms documented in
`plans/research/social-experiment-notes.md`. Follow every one of them for all four accounts
(YouTube/Google, Instagram, TikTok, Facebook — see 3.0 on why Facebook is in this list).

- **One dedicated email for the pilot, not an address used for anything else.** **Decision
  (2026-09-09): all four pilot accounts share ONE dedicated Google account,
  `thinkplain.ai@gmail.com` — not one email each.** An earlier version of this rule said "separate
  email per account"; that was inherited from the original four-Instagram-account design. The threat
  actually being guarded against is linkage to your real identity — a flagged pilot account should
  not be traceable to accounts you care about. It is NOT about isolating the pilot accounts from
  each other: Meta's co-ownership clause (`plans/research/social-experiment-notes.md`) only enforces
  across Meta properties, so accounts on three different platforms cannot be mutually enforced
  through a shared signup email. Two consequences that matter: (a) that mailbox is the recovery path
  for every pilot account — 2FA and a recovery phone go on it before anything depends on it; (b)
  Google ignores dots in Gmail addresses, so `thinkplain.ai@gmail.com` and `thinkplainai@gmail.com`
  are one mailbox — use a single spelling verbatim everywhere so the accounts stay consistent.
- **Create the account manually on a real device, not scripted, not in a headless browser, not
  through an API.** Automated account creation is itself a violation signal on every platform
  named here — no platform documents a "warm-up period" requirement, but every one of them
  detects and penalizes non-human signup patterns.
- **Phone-verify the account.** Phone verification is one of the strongest anti-bot signals a
  platform has; skipping it makes the account look exactly like the automated spam accounts these
  platforms are built to catch, independent of anything you actually post.
- **The SAME handle on every platform, plus real per-platform bio copy.** **Decision (2026-09-09):
  the pilot is `@thinkplainai` on YouTube, Instagram, and TikTok.** An earlier version of this rule
  said "distinct handle and bio ... across accounts" — also inherited from the four-account design,
  where four sibling accounts on the SAME platform looking interchangeable was the Meta
  inauthenticity signal. This pilot runs one account per platform, where a consistent handle is what
  every real brand does and reads as legitimacy rather than spam. What survives of the rule: write
  real, specific bio copy per platform (3.0 has the exact strings used) — generic or
  placeholder-looking branding is itself a low-effort/spam signal reviewers and automated systems
  are tuned to catch.
- **No follow/like/comment automation, ever.** TikTok's Community Guidelines explicitly name "using
  automation to run ... accounts or send repetitive content" as a violation. Meta's Account
  Integrity policy names automation as one of the concealed-operatorship signals it enforces
  against. This pilot's own publish pipeline never does this — `social/src/publish/instagram.ts`
  and `social/src/publish/youtube.ts` only ever POST/upload content the account itself created; there
  is no code anywhere in this repo that follows, likes, or comments on anyone else's content. Keep
  it that way by hand, too — no third-party growth tool, no engagement pod, no "follow back" bot.
- **No delete-and-repost.** Deleting a post and reposting it (to "reset" its distribution, chase a
  trend, or fix a typo) reads to these platforms' spam detection as repetitive/duplicate content —
  the same clause TikTok's guidelines use to describe "sending repetitive content" and something
  Meta's own enforcement explicitly watches for. If a post has a real error, leave it up and correct
  it in a comment/caption edit where the platform supports it, or simply let it stand — do not pull
  it down and re-publish the same asset.

None of this is enforced by code — it is entirely process discipline for whoever is doing the
weekly session and any live troubleshooting. Read it again before the first post goes up.

## 3. One-time setup

There is no cloud project, API app, OAuth flow, or deployment to do any more (3.1 below records what
an earlier version of this plan built for that, and why none of it is needed now). The whole setup
is: create three accounts plus the Facebook account Meta Business Suite needs (3.0, following
section 2's hygiene rules), then confirm each platform's own scheduler actually works (3.0a).

### 3.0 Create the accounts

Create the pilot's YouTube/Google, Instagram, and TikTok accounts — **plus a Facebook account**,
which Meta Business Suite (3.0a) needs to schedule Instagram Reels — before touching anything else
here. Follow section 2's hygiene rules for all of them (one shared pilot email, real device, phone
verification, same handle everywhere, real bio copy, no automation) — that section is not repeated
here.

**Facebook is required, and it is probably not a new account.** Meta Business Suite is reached
through a Facebook login. **If you already have a personal Facebook profile, use it** — Facebook
prohibits maintaining more than one personal profile, and a second profile in your own name is the
misrepresentation signal that gets accounts disabled, which under Meta's co-ownership clause can
then reach the linked Instagram account. Only if you have no Facebook profile at all should you
create one, under your real name, with the pilot email, and then leave it completely alone (no
photo, no friends, no posts — it exists solely to hold the Page below).

**You also need a Facebook Page.** Meta Business Suite manages Instagram content through a Page
connected to the Instagram account, not the Instagram account by itself. Create a Page named
`Plain`, give it the same avatar, leave it published but empty (no posts), and **connect it to the
Instagram professional account** — Page -> Settings -> Linked accounts, or from Instagram ->
Settings -> Account type and tools -> Linked accounts. Note that connecting accounts in Accounts
Centre (personal profile <-> Instagram) is a DIFFERENT thing and does not satisfy this. Put the Page
in whichever business portfolio the pilot uses. The Page created for this pilot is `1268933229644482`
("Think Plain").

**Which Meta business portfolio the Page lands in is a real decision.** Meta's Account Integrity
clause lets Meta act on accounts "owned by the same person or entity as an account that has been
disabled," and assets inside one business portfolio are co-owned by the same entity by definition.
Putting a brand-new account that posts video daily into a portfolio holding real company assets
shares fate with them. Owning multiple portfolios is normal and allowed — it is not the "concealed
common operatorship" Meta enforces against. Caveat, so this is not oversold: the same personal
profile admins both portfolios, so person-level linkage exists regardless; a separate portfolio
limits asset-level blast radius, not linkage. Rule of thumb: if the existing portfolio holds ad
accounts, client assets, or a Page/IG you would mind losing, use a separate portfolio for the pilot;
if it is a dormant shell, either is fine.

#### Status and concrete values (2026-09-09)

| Account | Status | Notes |
|---|---|---|
| Google / YouTube | **Done** | `thinkplain.ai@gmail.com`; channel is a **Brand Account** (Studio -> Settings -> Permissions offers Invite, which a personal channel does not); avatar, description, and `/go/yt` link set |
| Instagram | **Done** | `@thinkplainai`, phone-verified, switched to **Business**, avatar + bio + `/go/ig` link set |
| Facebook | Existing personal profile — no new account created | Used to log into Meta Business Suite and to hold the `Plain` Page |
| TikTok | **Done for scheduling** | `@thinkplainai`, phone-verified, switched to **Creator** (3.0a) — enough for the native scheduler. **NOT switched to Business — deferred, see below** (that switch is only about the bio link, not scheduling) |

Shared across all of them: avatar is `logos/profile/plain-bmc-profile.png` (512x512, the fading-card
icon — `logos/README.md` designates that variant for social profile avatars); display name `Plain`.

Bio copy actually used:

- **YouTube channel description** (link title "Read it plain", matching `caption.ts`'s
  `Read it plain: <url>` line so the channel and the captions read identically):

  ```
  Classic Stoic philosophy in plain English.

  One card a day from Marcus Aurelius, Epictetus, and Seneca — the emperor,
  the slave, and the senator. Three completely different lives, the same
  answers. No philosophy degree required.

  Read the full books, free: https://thinkplain.ai/go/yt
  ```

- **Instagram** (150-char limit):

  ```
  Classic Stoic philosophy in plain English.
  One card a day — Marcus Aurelius, Epictetus, Seneca.
  No philosophy degree required.
  ```

- **TikTok** (80-char limit):

  ```
  Stoic philosophy in plain English.
  One card a day. Marcus · Epictetus · Seneca
  ```

The author names and "Stoic philosophy" are deliberate: channel/profile text is indexed, and
`plans/research/social-experiment-notes.md` found philosophy is search-driven.

**Create the YouTube channel as a Brand Account, not the account's default personal channel.** Use
[youtube.com/channel_switcher](https://www.youtube.com/channel_switcher) -> "Create a channel" and
give it a name that DIFFERS from the Google account's own profile name — that difference is what
makes YouTube house it in a Brand Account. Clicking "Create channel" from the avatar menu and
accepting the pre-filled default name yields a *personal* channel instead. Verify at
[myaccount.google.com/brandaccounts](https://myaccount.google.com/brandaccounts), or by Studio ->
Settings -> Permissions offering to invite people. Why it matters: the Brand Account gives the
channel its own name/handle and a revocable manager list, so access can be granted without sharing
the Gmail password.

**TikTok: the bio link needs a Business account, and that needs business verification — DEFERRED
(2026-09-09).** This is separate from the Creator switch above, which was only about unlocking the
native scheduler (3.0a) and needed no verification. A *personal* TikTok account generally needs
1,000 followers before the Website field appears in Edit Profile, so a zero-follower pilot account
cannot set the `/go/tt` bio link at all. The fix is a Business account — but in practice the switch
required business verification, which was declined for now as disproportionate before the concept
is proven. **What this costs, precisely:**

- **Lost:** the profile-visit conversion path on TikTok only.
- **NOT lost — caption attribution.** `social/src/publish/caption.ts`'s `ATTRIBUTION_URLS` puts
  `https://thinkplain.ai/go/tt` into every TikTok caption automatically, so `utm_source=tiktok`
  clicks are logged from the first post regardless of account type.
- **NOT lost — criterion B.** The week-1-to-week-4 median trend is pure view data (hand-entered per
  5.4), so TikTok can still independently prove viability.
- **NOT lost — criterion A's breakout half.** A post clearing ~10,000 views still registers.
- **Already unavailable anyway — TikTok follow-conversion.** `social/src/metrics/readout.ts`'s
  `computeFollowConversion` returns `method: 'unavailable'` with `follows: null` when no follower
  snapshots exist for TikTok — nothing collects one. `readout.ts`'s own comment says this is
  "exactly TikTok's current state until a follower-snapshot collector is built for it" — a signal
  that was already out of scope, not one this deferral degrades.

Revisit the switch if TikTok turns out to be the platform that performs; the Website field can be
added at any time, including after posting starts.

Two things to do at account-creation time specifically, because both are cheapest to fix now rather
than after the fact:

- **Convert the Instagram account to Business or Creator, not Personal.** Meta Business Suite (3.0a)
  does not manage a Personal Instagram account at all. Do this from Instagram's own app: Settings ->
  Account type (or the equivalent "switch to professional account" flow Meta currently surfaces
  there) -> Business or Creator. Either type works for this pilot; Business is the more common
  choice.
- **Set each account's bio/profile link to its own `/go/<slug>` attribution URL, not a shared plain
  link:**

  | Platform | Bio / channel link |
  |---|---|
  | Instagram | `https://thinkplain.ai/go/ig` |
  | TikTok | `https://thinkplain.ai/go/tt` |
  | YouTube (channel link) | `https://thinkplain.ai/go/yt` |

  These three URLs are handled by `web/src/routes/go/[slug]/+server.js`: each one 302-redirects to
  `https://thinkplain.ai/` with a **different** `utm_source` baked in (`instagram`/`tiktok`/
  `youtube`) before the redirect fires, and `social/src/publish/caption.ts`'s `ATTRIBUTION_URLS`
  already puts the matching one into every post's caption. The bio link and the caption link exist
  for different traffic: the caption link is what shows under a post; the bio link is what a profile
  visit converts through, which is why it needs to be set once, by hand, at account-creation time —
  no code sets an account's bio.

  **Use a different link per platform, not the same plain `https://thinkplain.ai` link on all
  three.** In-app browsers on Instagram/TikTok/YouTube strip the HTTP referer, so `utm_source` in
  the URL is the *only* signal that tells a click apart from organic traffic once it lands on the
  site. Using the same bare link on all three (or a link with no `utm_source` at all) does not just
  weaken attribution — it makes criterion A's follow-conversion half (section 1) permanently
  unmeasurable for that traffic, silently, with no error anywhere: the click still redirects and
  works fine, it just cannot be told apart from any other visit. There is no symptom until the
  readout (week 4) shows unattributed traffic and it is too late to have collected the difference.

  **These three `/go/` routes 404 until the branch that adds them is merged and deployed to
  production.** It is fine to set the bio links before that happens — Instagram/TikTok/YouTube do
  not validate a bio link's destination at save time — but verify each one actually redirects
  (`curl -sI https://thinkplain.ai/go/ig` etc., expect a `302` to a
  `thinkplain.ai/?utm_source=...` URL) once that branch has shipped, before relying on the numbers
  it produces.

### 3.0a Native scheduling pre-flight (verified 2026-09-09)

Confirmed, by hand, that each platform's own scheduler is usable for the weekly session this plan
now depends on:

- **TikTok:** switched the pilot account from Personal to Creator (Business was not needed for
  this). The schedule option is present in the native upload flow. Scheduling window: **10 days** —
  this is the binding constraint on the whole weekly session, since it means the session cannot slip
  more than 3 days without a gap opening in what's scheduled.
- **Instagram:** Meta Business Suite offers Reel scheduling. Window: ~75 days.
- **YouTube:** YouTube Studio offers scheduled publish. Window: effectively unbounded.

This is the finding that makes native scheduling viable at all in place of the API publish pipeline
— if TikTok's scheduler had been unavailable, it would have been the binding constraint in the other
direction and this approach would not work.

### 3.1 What was provisioned and is no longer required

Before this plan replaced the API publish pipeline with native scheduling, the following was built
against real accounts. **None of it is used by this repo any more, and none of the code that used to
call it exists in this branch.** It is dormant, not deleted — tearing it down (deleting the GCP
project, revoking the Meta app) is a separate decision this plan deliberately deferred for a week in
case something about the pilot needs revisiting. The Facebook Page itself is a separate matter —
it stays, see below.

- **A GCP project, `plain-social-pilot` (billing account `01AA73-8FF54D-C7C23F`), and a GCS bucket,
  `gs://plain-social-pilot-media` (`US-CENTRAL1`, public read via `allUsers` ->
  `roles/storage.objectViewer`, 30-day lifecycle rule)** — provisioned and verified live 2026-09-09
  (an unauthenticated fetch returned `200` with the right `content-type`, and a range request
  returned `206`). Existed to give Meta and YouTube a public URL to fetch rendered video from; the
  weekly session now uploads from local disk instead.
- **A Meta app** (`developers.facebook.com`, Development mode, deliberately never published), a
  Facebook Page (`1268933229644482`, "Think Plain"), and a long-lived Page access token for
  `IG_USER_ID` `17841423977412035` — verified live 2026-09-09 by creating (and deliberately not
  publishing) media container `18114024736799248`, which proved the token, the Page, and
  `instagram_content_publish` all worked end to end. Worth remembering if this is ever revisited:
  Meta has two non-interchangeable Instagram API families — Facebook Login (`graph.facebook.com`,
  requires a Page, `instagram_content_publish`) and Instagram Login (`graph.instagram.com`, no Page,
  `instagram_business_*` permissions). This pilot built against the Facebook Login family; getting
  that wrong the first time cost about an hour to discover. The Facebook Page itself is NOT dormant
  — see 3.0, it is still needed for Meta Business Suite.
- **A YouTube OAuth app was planned** (Google Cloud console, requesting `youtube.upload` and
  `yt-analytics.readonly` scopes, to be published to "In production" so refresh tokens wouldn't
  expire every 7 days) **but, per this document's own prior "Current status" tracking, was never
  actually created** — no live YouTube upload was ever completed through it. There is nothing live
  to leave dormant here.

None of this blocks anything above: 3.0/3.0a describe the complete, current setup, and it uses
nothing on this list.

## 4. The daily loop

Once deployed, this runs unattended:

1. Firebase's `onSchedule` trigger (`functions/src/socialTrigger.ts`) fires daily at **07:53
   America/New_York** (`SCHEDULE_CRON = '53 7 * * *'`, `PILOT_TIMEZONE = 'America/New_York'`). It
   computes "today" in that timezone (`computeTodayInTimezone`) and starts one execution of the
   `plain-social-daily` Cloud Run Job with `containerOverrides.args: ['--date', <today>]`.

   **`America/New_York` and `07:53` are placeholder values, not a deliberate posting-time
   decision.** Nothing in this plan or its research notes chose this timezone/time for audience or
   distribution reasons — the constant exists so the trigger fires off the top of the hour (see the
   file's own "SCHEDULED OFF THE HOUR" comment: cron jobs that fire on `:00` pile into the same
   minute as every other tenant on the platform). Treat `PILOT_TIMEZONE`/`SCHEDULE_CRON` in
   `functions/src/socialTrigger.ts` as something to set deliberately (audience timezone, a posting
   time chosen for a real reason) before or shortly after go-live, not as a considered choice
   already made.

2. That Cloud Run Job execution runs `social/src/job.ts --date <today>` inside the container: it
   resolves the schedule slot for that date, renders the video + Instagram feed still (reusing
   `cli.ts`'s render path), uploads every rendered asset to GCS (before any post is attempted — a
   posting failure never loses a render), then publishes independently to Instagram and YouTube.
   A failure on one platform never stops the other (`Promise.allSettled`, not `Promise.all`). A GCS
   upload failure is a **per-platform** precondition, not a whole-run abort (code review M7 fix):
   it makes only Instagram's outcome `failed` (Instagram needs the video's public GCS URL for Meta's
   Graph API), while YouTube still uploads straight from the local rendered file and is unaffected
   by a GCS outage.

3. `job.ts` appends a structured log to both stdout (captured by Cloud Logging) and
   `content/social/job-logs/job-<date>.log` inside the container (ephemeral once the execution
   ends — Cloud Logging is the durable copy). A healthy run's log looks like:

   ```
   === Daily job for 2026-09-05 ===
   [instagram] ok — published Reel, media id ...
   [youtube] ok — uploaded private video, id ...
   ```

   A YouTube upload always lands **private** by design (`REQUIRED_STATUS` in
   `social/src/publish/youtube.ts` — a caller cannot override this even accidentally). It stays
   private until the weekly session flips it (section 5). A successful YouTube publish also durably
   records the new video's id into the week's pending-flip list — by default the
   `social-pilot-pending-youtube-flips` Firestore collection (single document `flips`,
   `social/src/publish/pending-flips-store-firestore.ts`'s `createFirestorePendingFlipsStore`), the
   same GCP project the OAuth tokens already live in (both use ADC — no extra credential to
   configure). Pass `job.ts --pending-flips-store local` to write to a plain JSON file instead
   (`--pending-flips-file`, default `content/social/pending-youtube-flips.json`) — for local runs
   and manual testing only: a Cloud Run execution's filesystem is throwaway, so `local` there
   silently loses every video id.

   If the upload itself succeeds but this durable record fails to write, the run reports
   `[youtube] partial — ...` instead of `ok`, and the job's own exit code reflects a failure
   (`exitCodeForOutcomes` treats `partial` the same as `failed`, per the M4 code-review fix) even
   though the video did land on YouTube. Treat a `partial` line as needing the same follow-up as a
   `failed` one — the video is unreachable to the weekly flip session (section 5.3) and to metrics
   collection (section 7) until someone finds it by hand and re-adds it to the pending-flip list.

4. Check for a healthy run the same way `social/DEPLOY.md`'s step 8 describes:
   ```bash
   gcloud run jobs executions list --job=plain-social-daily --region=us-central1 --limit=5
   gcloud run jobs executions logs EXECUTION_ID --region=us-central1
   ```
   `STATUS: Succeeded` plus both `[instagram] ok` and `[youtube] ok` lines is a clean day. A single
   `[platform] failed — ...` line — or a `[youtube] partial — ...` line (the upload itself succeeded
   but its pending-flip record did not persist, point 3 above) — means the *other* platform
   completing on its own is expected behavior, not a bug, but it still needs a human to look at why
   the failing/partial platform did not come back clean (most commonly: an expired/missing token per
   section 3.4; for `partial` specifically, read the log line's own message for the Firestore
   write failure).

## 5. The weekly session — the most important part of this document

There is no automated posting behind this section any more (section 3.1) — it **is** the pilot now.
Once a week, at a desk: render the week's videos, open three browser tabs (TikTok, Meta Business
Suite, YouTube Studio) and manually upload, caption, and schedule seven days of posts on each, then
hand-enter last week's numbers. Separately, **every single day**, not part of this weekly sitting,
read off and record that day's Instagram follower count (section 5.5) — the one input on a different
rhythm from everything else in this section.

No real session has been run yet (see "Current status" below), so there is no measured time cost —
only the arithmetic: 21 uploads a week (3 platforms x 7 days), each needing a file, a caption paste,
and a scheduled time set by hand, plus up to 21 `hand-entry.ts` runs for last week's numbers and one
`follower-snapshot.ts` run every day. Budget the whole sitting at over an hour once real posts exist
to schedule and measure; do not plan around the old, now-obsolete "20 minutes for TikTok" estimate
this section used to cite, which covered a single platform's manual step when the other two were
still automated.

**Two hard constraints govern this whole section — read both before doing anything else:**

- **TikTok's native scheduler only reaches 10 days out (section 3.0a).** Instagram's reaches roughly
  75 days and YouTube Studio's is effectively unbounded — TikTok alone is the binding constraint on
  the whole pilot. This session cannot slip more than 3 days late without a gap opening in what's
  already scheduled: run it on the same day every week, and if it does slip, closing the TikTok gap
  is the first priority, not an afterthought.
- **A scheduled TikTok post cannot be edited once it publishes — only deleted and re-uploaded — and
  section 2 already forbids that.** Section 2's rule, quoted verbatim: "Deleting a post and
  reposting it (to 'reset' its distribution, chase a trend, or fix a typo) reads to these platforms'
  spam detection as repetitive/duplicate content ... If a post has a real error, leave it up and
  correct it in a comment/caption edit where the platform supports it, or simply let it stand — do
  not pull it down and re-publish the same asset." The practical consequence: get the caption and
  the scheduled time right *before* confirming a TikTok schedule in section 5.3 below — once a post
  is live, this pilot's own rules leave no way to fix a mistake, only to live with it.

Checklist, in order:

### 5.1 Generate next week's schedule (if not already done)

Before this week's posts run out, generate the following week's schedule so there is always a slot
ready to render and post. Week 1 is anchored at `2026-09-09` (`social/src/pilot-config.ts`'s
`PILOT_WEEK_1_START`, reset from `2026-09-01` — see "Current status" below); every later week reads
every prior `pilot-schedule-w<NN>.json` so a card is never reused, and (for week > 1) requires that
the *prior* week's review note exists and is filled in:

```bash
# Write the prior week's review note first (retention notes, hook/format-mix adjustments):
npx tsx scripts/review-week.ts --week <N-1> --date <YYYY-MM-DD>

# Then generate the next week:
npx tsx scripts/generate-schedule.ts --week <N> --seed <n>
```

(Week 1 only: pass `--first-week` instead of relying on a prior review note, since there is no week
0.) This is plan 01's own scheduling cadence ("review retention, adjust hooks and format mix, then
generate the next week") — it is not new to this document, just listed here so the weekly session's
full scope is in one place.

### 5.2 Render the week

One command renders every day of the week that isn't already on disk and writes the single
`captions.txt` the next step reads from:

```bash
npx tsx social/src/prepare-week.ts --week <N>
```

It loads `content/social/pilot-schedule-w<NN>.json` — the schedule 5.1 wrote, normally in a *prior*
session (the only time this week number matches 5.1's own is the very first session ever run, before
any backlog of pre-generated schedules exists) — renders each scheduled day that isn't already
rendered (reusing `cli.ts`'s render path, never a second implementation of it), and skips any day
whose MP4 already exists on disk, printing that it was skipped. That makes it safe to re-run after
fixing one day's schedule entry without re-rendering the other six. `--force` re-renders every day
regardless; `--dry-run` prints the resolved plan (which days would render, which would be skipped,
where `captions.txt` would land) and writes nothing. `--out <dir>` and `--schedule-dir <dir>`
override the defaults (`social/out/` and `content/social/`) — a testing/override affordance, not
something a real weekly run needs to touch.

The MP4s land in `social/out/`, one per day, alongside `captions.txt` — one block per day, each
carrying all three platforms' captions clearly labelled `[tiktok]`, `[instagram]`, `[youtube]`,
separated by a rule, meant to be read top to bottom during the next step, not parsed as JSON
mid-session.

### 5.3 Upload and schedule — three browser tabs

For each of the week's 7 days, in each of three places — TikTok's own upload flow, Meta Business
Suite (for Instagram Reels), and YouTube Studio — upload that day's MP4 from `social/out/`, paste
that day's caption for *that specific platform* from `captions.txt`, and set the scheduled time.
That's 21 uploads a week (3 platforms x 7 days); work through `captions.txt` top to bottom so each
video is matched to the right caption by date and card id.

**Match the caption to the platform, every time — this is the step most likely to silently corrupt
the pilot's own data.** The three captions for a given day are not interchangeable text: each one
carries a different attribution URL (`caption.ts`'s `ATTRIBUTION_URLS`, `utm_source=tiktok` /
`instagram` / `youtube`). Pasting Instagram's caption into the TikTok upload does not just read
wrong — it silently ships the wrong `utm_source` on that post, corrupting the follow-conversion data
this whole pilot exists to measure (section 1), with no error and no visible symptom until the
readout tries to attribute traffic that was actually labeled for a different platform.

Per platform:

- **TikTok:** upload and schedule from the app's own native scheduler (section 3.0a) — reread the
  two hard constraints above before confirming the time.
- **Instagram:** schedule the Reel from Meta Business Suite, which manages the account through the
  `Plain` Page (section 3.0) — not from the Instagram app itself.
- **YouTube:** upload directly into YouTube Studio and use its own scheduled-publish option. There is
  no more private-upload-then-flip step (section 3.1 — that whole step is gone, not replaced);
  scheduling in Studio does its job outright.

### 5.4 Hand-enter last week's numbers

For every post from last week, on whichever of the three platforms it published to, read the numbers
off that platform's own per-post analytics screen and run, once per post, from the repo root:

```bash
npx tsx social/src/metrics/hand-entry.ts \
  --platform <instagram|youtube|tiktok> \
  --post-id <the platform's own id for this post> \
  --published-at <ISO 8601 publish instant, from the app> \
  --views <n> --likes <n> --comments <n> --shares <n> \
  [--follows <n>] [--avg-percent-watched <n>] [--collected-at <ISO 8601>] [--out-dir <path>]
```

Required: `--platform`, `--post-id`, `--published-at`, `--views`, `--likes`, `--comments`,
`--shares`. Optional: `--follows`, `--avg-percent-watched` (0-100), `--collected-at` (defaults to
the real wall-clock time this command runs), `--out-dir` (defaults to `content/social/metrics/`).
Every count is validated as a non-negative whole number — a bad value throws a
`HandEntryValidationError` naming the exact field rather than writing a bad row. Re-running with the
same `--platform`/`--post-id` replaces that row instead of duplicating it, so a mid-session
correction is safe. All three platforms' rows land in the same dated file,
`content/social/metrics/metrics-<date>.json` (dated by `--published-at`) — one schema, no
reconciliation step at readout time regardless of which platform or which entry produced a row.

**`--follows` is the flag that matters most, and it only means something on YouTube.** YouTube
Studio shows subscribers gained per video — read it and pass it as `--follows`; that is exactly what
lets `readout.ts`'s `computeFollowConversion` report `method: 'exact'` for that row (section 1),
which is half of criterion A. Instagram and TikTok have no per-post follow attribution on any read
path, automated or in-app — leave `--follows` off entirely on those two. Omitting it records `null`,
never a fabricated `0`; passing `0` would claim a real zero-follow reading that was never actually
taken.

`--avg-percent-watched` stays optional and `null` unless a platform's analytics screen shows a clean
percentage worth typing in — TikTok's retention data in particular is in-app only, with no automated
read path at all, on either candidate API path (see the TikTok metrics section below).

### 5.5 The daily follower integer — not weekly, and gone forever if skipped

**This is the one input in the entire pilot that does not run on the weekly rhythm above, and the
one most likely to go quietly missing if this section is only opened once a week.** Every day, read
Instagram's current follower total off the app and run:

```bash
npx tsx social/src/metrics/follower-snapshot.ts --date <YYYY-MM-DD> --followers <n>
```

`--date` and `--followers` are both required; `--out-dir` (default `content/social/metrics/`)
overrides where `instagram-followers.json` is written. Re-running for the same `--date` replaces
that date's entry rather than duplicating it. `0` is a valid, real reading (an empty account) and is
recorded as `0`, never treated as missing.

Instagram's own app shows only *today's* follower total — never a historical series — so a day this
isn't run for is unrecoverable; there is no catching up next week. Skipping a day has a specific,
measurable cost, too: Instagram's follow-conversion (section 1) is *inferred* from day-over-day
follower deltas aligned to `publishedAt`, so a day with no recorded count permanently degrades that
day's conversion reading from `inferred` to `unavailable`. There is no equivalent CLI for TikTok or
YouTube — no per-post follow path exists to infer a TikTok series from, and YouTube's follow number
already arrives for free, per post, in section 5.4 above.

## 6. What to do if the Meta (Instagram) account is disabled

Per `plans/research/social-experiment-notes.md`'s account-restriction research, act as follows if
Instagram disables the pilot's account:

1. **Do not create a replacement Instagram account from the same device, IP, or email.** Meta's
   Account Integrity enforcement is explicitly designed to catch and act on accounts it judges to
   be "owned by the same person or entity as an account that has been disabled" — creating a
   look-alike replacement from the same signals is very likely to get the new account disabled too,
   compounding the ban rather than working around it. If a new Instagram presence is ever
   attempted, it needs a genuinely distinct device/network/email and enough time and distinct
   identity that it does not read as ban evasion.
2. **File Meta's actual appeal**, through the in-app "Request Review" / "Disagree with decision"
   flow (or business.facebook.com's Account Quality section if the account had a Business
   presence). This is the only sanctioned path back — do not attempt any workaround in place of it.
3. **What survives independently of the disabled account:** every asset this pilot has ever posted
   already lives in GCS, uploaded *before* any post is attempted
   (`storage.ts`'s upload calls run ahead of every publish call in `job.ts`, and the plan's own
   Decision states this ordering exists partly so a posting failure — or, here, an account-level
   failure — never loses a render). Losing the Instagram account loses that account's reach and
   history, not the rendered videos, feed stills, or captions — nothing needs to be regenerated to
   resume once the account issue is resolved or a decision is made to stop that platform.
4. **Deciding whether to continue on the remaining two platforms or stop entirely:** this depends on
   how far into the pilot the disabling happens and what the other two platforms' data already show.
   Concretely:
   - If Instagram is disabled **before** four weeks of data have accumulated on TikTok and YouTube,
     continue running the daily job for those two platforms only (Instagram's publish step will
     start failing — that's expected and does not block YouTube's, per `job.ts`'s platform
     isolation) and reach the readout (section 7) with whatever those two platforms show. The
     pre-registered criterion (section 1) only requires **one** platform to clear criterion A or B —
     it was never contingent on all three surviving to the end.
   - If the disabling happens **after** the readout window has already produced a verdict on
     Instagram specifically (e.g. Instagram was the platform showing the trend or the breakout),
     treat that data as already collected and valid up to the disabling — the readout doesn't need
     a live account to report on data already gathered into `content/social/metrics/`.
   - If Instagram disabling happens very early (before any real signal) AND it happened because of
     something structural to this pilot's approach (not an isolated fluke), reconsider whether the
     same structural issue risks the other two accounts before continuing — re-read section 2's
     hygiene rules and this section's appeal guidance before resuming anything automated.

## 7. Metrics and the readout

Collection is automated for Instagram and YouTube, manual for TikTok (section 5.4). Run collection
regularly (daily is reasonable, since it's idempotent and cheap) from `social/`:

```bash
npx tsx social/src/metrics/collect.ts
# or, to pin the collection instant for a reproducible manual re-run:
npx tsx social/src/metrics/collect.ts --now 2026-09-05T00:00:00.000Z
```

This reads the Instagram/YouTube tokens already stored in Firestore (the same store `job.ts` uses;
this collector does not refresh tokens itself, only reads whatever is currently stored — token
freshness stays `job.ts`'s job), lists that platform's posts (Instagram via `GET /{ig-user-id}/media`;
YouTube via the same durable `social-pilot-pending-youtube-flips` Firestore store `job.ts` writes to,
not a local file — `collect.ts`'s own `createDefaultPendingFlipsReader` reads it via
`createFirestorePendingFlipsStore().read()`), and fetches per-post metrics for anything
still inside its **30-day polling window** (inclusive at exactly 30 days) — metrics keep accruing
after publication, so a post is re-polled on every run until it ages out of the window, and each run
is idempotent (`upsertMetricsRow` replaces a same-`platform:postId` row rather than duplicating it).
Results land in `content/social/metrics/metrics-<date>.json`, one dated file per collection run, plus
`content/social/metrics/instagram-followers.json` (a daily account-level follower snapshot, since
Instagram only exposes follower counts at the account level, not per-post — see the readout's
`'inferred'` conversion labeling below).

At week 4, produce the verdict:

```bash
npx tsx social/src/metrics/readout.ts
# or with an explicit evaluation instant and/or a non-default breakout threshold:
npx tsx social/src/metrics/readout.ts --now 2026-09-29T00:00:00.000Z --breakout-threshold 10000
```

This reads every `metrics-<date>.json` under `content/social/metrics/` (deduping to the latest
`collectedAt` per post across the polling window's repeated snapshots) plus
`instagram-followers.json`, and prints, per platform: the median, the maximum, the max/median
ratio, the week-1-vs-week-4 median trend, follow conversion (labeled `exact` for YouTube,
`inferred` for Instagram/TikTok — from daily follower deltas aligned to `publishedAt`, since
per-post follow attribution only exists on YouTube — or `unavailable` when no follower-snapshot
series exists for that platform), and the top 5 posts with their format. It then states plainly
whether the pre-registered criterion (section 1) was met, quoting the same "outlier with no
conversion and no trend is explicitly a NO" language the criterion itself uses.

`social/src/metrics/readout.ts`'s own tests (`social/src/metrics/__tests__/readout.test.ts`) prove
this against synthetic data with an injected outlier both ways: an outlier that also converts
reports a breakout (criterion A met); an outlier with no conversion and no week-1-to-4 trend
reports NOT VIABLE, in those words — so a big single number alone can never produce a false
"viable."

## TikTok metrics collection (T13)

*(Carried over verbatim from the version T13 wrote — still the authoritative section on TikTok's
read side; the "weekly session" coverage above (5.4) is the operational checklist, this is the
underlying reasoning and the spike itself.)*

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
  `social/src/metrics/hand-entry.ts`, already fully built (see below).
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

`social/src/metrics/hand-entry.ts` (generalised from the platform-specific
`tiktok-manual.ts`, `Pb4e17-social-native-scheduling` T03 — see
`social/src/metrics/__tests__/hand-entry.test.ts`, 48 tests as of that task)
is fully built and tested and does not depend on the spike's outcome — it is
the fallback path if the spike fails, AND it is usable today, before the
spike has even been run, since TikTok posting is already manual and the
weekly session already happens.

During the weekly session (the same session
`social/src/publish/tiktok-manual.ts` stages TikTok's posts for), for each
TikTok post still inside its 30-day polling window, read four numbers off
TikTok's own per-video analytics screen — **views, likes, comments,
shares** — and run:

```
npx tsx social/src/metrics/hand-entry.ts \
  --platform tiktok \
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

## Current status — what is NOT done

**Account setup (3.0) progress, 2026-09-09:** the Google/YouTube (Brand Account), Instagram
(Business), and TikTok accounts all now exist, phone-verified, on the shared pilot email, each with
the avatar, display name, and bio copy in 3.0; Facebook uses an existing personal profile. Bio links
are set on YouTube (`/go/yt`) and Instagram (`/go/ig`) only — **TikTok has NO bio link**, because it
is not on a Business account (see 3.0 — business verification deferred) and the Website field is
therefore unavailable. **Everything below this paragraph is still true: none of the six live steps
has been run, and zero posts have been published.** Note also that both `/go/` links set so far 404
until this branch ships — they are live on the profiles but unverified; run
`curl -sI https://thinkplain.ai/go/ig` (and `/yt`), expecting a 302 to a
`thinkplain.ai/?utm_source=...` URL, once PR #42 is merged and deployed.

**Pilot anchor date reset, 2026-09-09:** `PILOT_WEEK_1_START` (`social/src/pilot-config.ts`) was
moved from `2026-09-01` to `2026-09-09`, since the original anchor had passed with nothing
published. Week 1 is now 2026-09-09..15 and week 4 is 2026-09-30..10-06. This is free to change
again right up until the first real render ships (a render embeds its `--date` in both its filename
and its metadata sidecar); after that it is fixed for the life of the pilot.

Be honest with yourself before assuming this pilot is ready to run: **six live steps described
above have never actually been executed.** Every one of them was built and unit-tested against
mocked APIs/clients in this session's work, but none was run against a real account, a real cloud
project, or real hardware. Specifically, per the plan's own task notes:

- ~~**GCS provisioning**~~ — **DONE 2026-09-09.** `gs://plain-social-pilot-media` in project
  `plain-social-pilot`; all three parts of `social/gcs/README.md` section 4's acceptance criterion
  pass. See 3.1's "Provisioned" table.
- **A live Instagram post (T05)** — STILL NOT DONE, but no longer blocked. The Meta app, Page
  token and `IG_USER_ID` are all live and **verified against the real account** by creating (and
  deliberately not publishing) media container `18114024736799248` — see 3.2. That proves GCS public
  read, the token, and `instagram_content_publish` all work. What remains is one real
  `publishToInstagram` call confirmed publicly visible.
- **A live YouTube upload (T06)** — same situation: `social/src/publish/youtube.ts` is built and
  unit-tested against a mocked `fetch`, no real upload has happened. Closing this requires the
  YouTube OAuth app (section 3.3, published to "In production") and channel credentials, then one
  real `uploadVideoToYouTube` call confirmed to appear in Studio ready to flip.
- **The Docker build (T09)** — `social/Dockerfile` was written and verified by reading every module
  it depends on, not by a live `docker build`. No container has ever actually been built or run.
  Closing this is section 3.5 above.
- **The cloud deploy (T10)** — no `gcloud`/`firebase` command has ever been run against a real GCP
  project; no Cloud Run Job, Firestore database, service account, secret, or Firebase Function
  exists yet anywhere. Closing this is section 3.6 above, and it is the step that also requires
  section 3.4 (seeding Firestore tokens by hand) before its own acceptance criterion (a scheduled
  run executing end to end) can be met.
- **The TikTok Display API spike (T13)** — `social/src/metrics/tiktok-spike.ts` exists and is
  unit-tested, but has never been run against a real TikTok account or app. The finding is
  genuinely undetermined; do not treat the "decision rule" above as already resolved in either
  direction. See the "Status: the spike has NOT been run" subsection above for the exact steps.

**Deploy target decided (2026-09-09): local scheduled run, NOT Cloud Run** — see 3.4a for the
reasoning and the exact commands. This removes the Docker build (T09) and the cloud deploy (T10)
from the critical path entirely; both remain unrun, and are now deliberately out of scope rather
than pending. It required one new module, `social/src/publish/token-store-local.ts`, plus
`--token-store`/`--token-file` flags on `job.ts` and `metrics/collect.ts`.

Additionally, **no OAuth authorization flow exists anywhere in this codebase** (section 3.4) — this
is a permanent gap in the current design, not a step waiting to be run once; every future token
renewal (Instagram's 60-day expiry, YouTube's refresh-token lifecycle) currently requires a human to
re-run each platform's manual consent flow and hand-write the result into Firestore. And the
**posting time in `functions/src/socialTrigger.ts` (`America/New_York`, `07:53`) is a placeholder**
(section 4) chosen only to avoid an on-the-hour cron pile-up, not a deliberately chosen audience
timezone or time — decide on a real value before or shortly after go-live.

Do not read the presence of thorough tests, Dockerfiles, and deploy runbooks as evidence that this
pilot is live. As of this writing, **zero posts have ever been published to any platform by this
system.**

## 8. Findings (week 4) — TEMPLATE, NOT YET FILLED IN

**As of 2026-08-27, this section is empty on purpose.** The pilot has not run. Zero posts have been
published on any platform (see "Current status" immediately above) — there is no week 1, no week 4,
no metrics file under `content/social/metrics/`, and therefore no finding. Nothing below this line is
a result. It is the exact procedure and the exact blanks whoever closes `Pf39c2-social-pilot-03` T16
must fill in once four real weeks of posts and metrics exist — written now, ahead of time, so that
person is filling in a pre-built skeleton with real numbers, not inventing the report's shape under
pressure to produce a verdict. If you are reading this and the date above is more than a few weeks
old relative to when go-live actually happened, treat that staleness itself as a signal that the
six DEFERRED live steps in "Current status" have not been closed yet either.

### 8.1 Procedure — run this at ~week 4, not before

1. Confirm four full pilot weeks of posts have actually accrued metrics (each post needs to have
   aged fully through, or far enough into, its 30-day polling window — see section 7 — so its view
   count is not still climbing when you snapshot it).
2. Run the readout from `social/`:
   ```bash
   npx tsx social/src/metrics/readout.ts --now <ISO 8601 evaluation instant>
   # optionally pin --metrics-dir <path> if not using the default content/social/metrics/,
   # or --breakout-threshold <n> to override the default 10,000-view criterion-A threshold
   ```
   (Flags confirmed against `readout.ts`'s own `printHelp()`: `--metrics-dir`, `--now`,
   `--breakout-threshold`, `--help`. Do not guess at flags not listed there.)
3. Copy the printed report's numbers into section 8.2 below verbatim — do not round, do not
   summarize away a platform with no data, and do not silently drop TikTok's `UNAVAILABLE`
   follow-conversion label if that is what the run actually printed.
4. Fill in section 8.3 by applying the decision rule in section 8.4 to the numbers in 8.2 — not to a
   vibe, not to "but the video really seemed to land." If the numbers do not clear the bar, the
   answer is stop, per section 8.4's own verbatim warning.

### 8.2 The numbers — fill in per platform, copied straight from the readout's output

For each platform (`instagram`, `youtube`, `tiktok`) that has at least one post:

| Metric | Instagram | YouTube | TikTok |
|---|---|---|---|
| Post count | `<n>` — TO BE FILLED AT WEEK 4 | `<n>` — TO BE FILLED AT WEEK 4 | `<n>` — TO BE FILLED AT WEEK 4 |
| Median views | `<median>` — TO BE FILLED AT WEEK 4 | `<median>` — TO BE FILLED AT WEEK 4 | `<median>` — TO BE FILLED AT WEEK 4 |
| Maximum views | `<max>` — TO BE FILLED AT WEEK 4 | `<max>` — TO BE FILLED AT WEEK 4 | `<max>` — TO BE FILLED AT WEEK 4 |
| Max/median ratio | `<ratio>x` — TO BE FILLED AT WEEK 4 | `<ratio>x` — TO BE FILLED AT WEEK 4 | `<ratio>x` — TO BE FILLED AT WEEK 4 |
| Week 1 median -> week 4 median | `<w1> -> <w4>` — TO BE FILLED AT WEEK 4 | `<w1> -> <w4>` — TO BE FILLED AT WEEK 4 | `<w1> -> <w4>` — TO BE FILLED AT WEEK 4 |
| Trend direction | `<up/down/flat/insufficient-data>` — TO BE FILLED AT WEEK 4 | `<up/down/flat/insufficient-data>` — TO BE FILLED AT WEEK 4 | `<up/down/flat/insufficient-data>` — TO BE FILLED AT WEEK 4 |
| Follow conversion method | inferred (per plan Decision) — TO BE CONFIRMED AT WEEK 4 | **exact** (per plan Decision — `subscribersGained`) — TO BE CONFIRMED AT WEEK 4 | inferred, or unavailable if no TikTok follower-snapshot series was ever collected — TO BE CONFIRMED AT WEEK 4 |
| Follow conversion value(s) | `<follows>` — TO BE FILLED AT WEEK 4 | `<follows>` — TO BE FILLED AT WEEK 4 | `<follows>` — TO BE FILLED AT WEEK 4 |

Do not relabel a platform's follow-conversion method by hand. The table's default labels above are
what the plan's Decision predicts each platform will report (YouTube exact, Instagram/TikTok
inferred-or-unavailable) — but copy whatever `readout.ts` actually printed, not the prediction, in
case the on-the-ground implementation ended up different (e.g. TikTok's follower-snapshot collector
was never built, in which case its row is `unavailable`, not `inferred`).

**Top 5 posts overall** (across all platforms, richest-first — pull the `topPosts` list per platform
from the printed report and merge/re-sort by views):

| Rank | Post ID | Platform | Format | Views |
|---|---|---|---|---|
| 1 | `<postId>` | `<platform>` | `<format — The Wall / The Question / The Objection>` | `<views>` — TO BE FILLED AT WEEK 4 |
| 2 | `<postId>` | `<platform>` | `<format>` | `<views>` — TO BE FILLED AT WEEK 4 |
| 3 | `<postId>` | `<platform>` | `<format>` | `<views>` — TO BE FILLED AT WEEK 4 |
| 4 | `<postId>` | `<platform>` | `<format>` | `<views>` — TO BE FILLED AT WEEK 4 |
| 5 | `<postId>` | `<platform>` | `<format>` | `<views>` — TO BE FILLED AT WEEK 4 |

Paste `readout.ts`'s printed verdict summary line here verbatim, unedited:

> `<paste the exact "VIABLE (criterion A met) — ..." / "VIABLE (criterion B met) — ..." /
> "NOT VIABLE — ..." line the tool printed>` — TO BE FILLED AT WEEK 4

### 8.3 The recommendation — fill in only after 8.2, and only using 8.4's rule

**Verdict: `<YES, social is viable / NO, stop>` — TO BE FILLED AT WEEK 4.**

**Which criterion, if any, was met:** `<A / B / neither>` — TO BE FILLED AT WEEK 4.

**If YES:** name the specific post/platform/format combination that met the criterion, and state
what "rebuild around whatever premise did it" concretely means here — TO BE FILLED AT WEEK 4.

**If NO:** state that plainly, with no hedge (no "promising but," no "worth one more month") — the
pre-registered rule in 8.4 does not have a maybe. TO BE FILLED AT WEEK 4.

**On format:** the format question this task's own wording asks ("which format broke out") is
**degenerate for this pilot** — `Pf39c2-social-pilot-02a` D01/D02 collapsed the channel to a single
format, The Wall, one post a day, before any post went out. There is exactly one format this pilot
can answer "The Wall" for; there is no cross-format comparison to report, and pretending otherwise
would fabricate a comparison this pilot's own scope decisions killed before go-live. The only
within-format axis that COULD differ is The Wall's three sub-types — **The Thou Wall, The Cascade,
The Scene** (see `plans/Pf39c2-social-pilot-index.md`'s "The Wall — sub-types" table) — if the
weekly schedules tagged posts by sub-type and the data supports it, report which sub-type(s) the top
posts in 8.2 actually were here; otherwise say plainly that sub-type was not tracked and this
question also cannot be answered. TO BE FILLED AT WEEK 4.

### 8.4 The decision rule — copied verbatim, do not renegotiate it here

From `plans/Pf39c2-social-pilot-index.md`'s "Success criterion (pre-registered — do not renegotiate
after posting)":

> A single 10x-median outlier is NOT sufficient; across 84 posts (1 Wall post/day x 3 platforms x 28
> days) one is still expected from variance alone. (Re-derived 2026-09-09: an earlier ~168 here — 2
> posts/day x 3 platforms x 28 days — predates `Pf39c2-social-pilot-02a` D02, which collapsed the
> channel to a single Wall post per day; nobody re-derived the post count after that decision. 84 is
> half of 168, so a lone outlier is expected roughly half as often as the stale figure implied — but
> "half as often" is still "expected," so the argument's point survives unchanged: one 10x spike
> among 84 posts is not evidence of anything by itself.)
>
> Viable requires at least one of:
> - **A. Breakout with conversion** — a post clearing ~10,000 views on any platform AND converting
>   visibly to follows.
> - **B. Accumulating standing** — the account's median views trend upward from week 1 to week 4.
>
> Either met -> social is viable; rebuild around whatever premise did it.
> Neither met -> stop. **An outlier with no conversion and no trend is explicitly a NO.**
>
> Track maximum AND median AND follow-conversion. The maximum alone is not the signal.

This is quoted here for the same reason section 1 quotes it: the whole point of pre-registering a
criterion is that nobody gets to argue it into a "win" after seeing an exciting number. If a single
post posted an outsized number and neither converted to follows nor came with an upward median
trend, section 8.3's verdict is NO, full stop — that exact shape (an impressive outlier, nothing
else) is the one case the criterion was written specifically to rule insufficient. Do not edit this
quoted rule, and do not write a verdict in 8.3 that contradicts it.
