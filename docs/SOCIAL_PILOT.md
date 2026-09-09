# Social Pilot — Runbook

This is the operating manual for the social viability pilot (`plans/Pf39c2-social-pilot-index.md`
and its three sub-plans, `Pf39c2-social-pilot-01/02/02a/03.md`). It is written so someone who was
not involved in building this system can run the pilot day to day and week to week from this
document alone — every command below is real, copy-pasteable, and checked against the actual
source files as of 2026-09-09, not paraphrased.

**Read the "Current status" section (near the bottom) before doing anything else.** Account setup
and tooling are complete, but zero posts have ever been published on any platform. This document
describes the system as designed and built; it does not claim the pilot has actually started.

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
  against. This pilot now enforces that more strongly than a publish pipeline ever could: the
  publish pipeline was deleted entirely (all posting happens by hand through each platform's own
  native scheduler — section 3.0a), so there is no posting or engagement API code anywhere in this
  repo at all, let alone code that follows, likes, or comments on anyone else's content. Keep it
  that way by hand, too — no third-party growth tool, no engagement pod, no "follow back" bot.
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

**There is no daily loop any more.** The Firebase trigger, the Cloud Run Job, and everything else
that used to fire unattended once a day were deleted along with the rest of the API publish
pipeline (`Pb4e17-social-native-scheduling` T07-T09) — posting is a manual, weekly act now (section
5), not a daily one.

**Exactly one thing genuinely still happens every day, and it is not posting: recording that day's
Instagram follower count.** Section 5.5 covers the command (`follower-snapshot.ts`) and why it
can't be folded into the weekly cadence like everything else — Instagram's app shows only *today's*
total, never a historical series, so a day this is skipped for is gone for good, unlike a missed
weekly upload which can just run late.

**One open question the old daily-trigger design carried and never resolved: what time of day to
schedule posts for.** The deleted trigger fired at a placeholder time (`America/New_York`, `07:53`)
chosen only to land off the top of the hour, not for any audience or distribution reason. That
question hasn't gone away with the trigger — section 5.3's "set the scheduled time" step still
needs an actual time typed into each platform's scheduler, and nothing in this plan or its research
notes has chosen one deliberately yet. Decide on a real value (audience timezone, a time chosen for
a reason) before or shortly after go-live, and use it consistently across all three platforms'
weekly schedules.

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
3. **What survives independently of the disabled account:** nothing needs to be regenerated to
   resume once the account issue is resolved or a decision is made to stop that platform. Every
   week's schedule (`content/social/pilot-schedule-w<NN>.json`) is checked into this repo, and
   rendering it is deterministic (`social/src/cli.ts`'s render path, reused by `prepare-week.ts`) —
   so even though the rendered MP4s themselves only live locally in `social/out/` and are not
   separately backed up, any of them can be reproduced from source at any time. Losing the
   Instagram account loses that account's reach and history, not the ability to re-render its
   videos, feed stills, or captions.
4. **Deciding whether to continue on the remaining two platforms or stop entirely:** this depends on
   how far into the pilot the disabling happens and what the other two platforms' data already show.
   Concretely:
   - If Instagram is disabled **before** four weeks of data have accumulated on TikTok and YouTube,
     continue the weekly session (section 5) for those two platforms only — skip Instagram's tab in
     5.3, skip Instagram in the hand-entry pass in 5.4 — and reach the readout (section 7) with
     whatever those two platforms show. The pre-registered criterion (section 1) only requires
     **one** platform to clear criterion A or B — it was never contingent on all three surviving to
     the end.
   - If the disabling happens **after** the readout window has already produced a verdict on
     Instagram specifically (e.g. Instagram was the platform showing the trend or the breakout),
     treat that data as already collected and valid up to the disabling — the readout doesn't need
     a live account to report on data already gathered into `content/social/metrics/`.
   - If Instagram disabling happens very early (before any real signal) AND it happened because of
     something structural to this pilot's approach (not an isolated fluke), reconsider whether the
     same structural issue risks the other two accounts before continuing — re-read section 2's
     hygiene rules and this section's appeal guidance before resuming posting on any platform.

## 7. Metrics and the readout

Collection is hand-entered for all three platforms (section 5.4) — nothing polls a platform on any
schedule, and no code enforces a window. For each post, read that platform's own per-post analytics
screen and run `social/src/metrics/hand-entry.ts` (section 5.4 has the exact flags), normally once,
during the weekly session that reaches that post's platform tab. Because a post's numbers keep
accruing on the platform after publication, *when* the operator does that read is a real decision
with nothing in code to enforce it — section 5.4's weekly cadence is the default answer, but a post
read too early can understate what it eventually earns, so the operator can deliberately read it
again later if that matters more than staying on the default schedule. Re-running `hand-entry.ts`
for the same `platform:postId` is a correction, not a second reading on a schedule: each run is
idempotent (`upsertMetricsRow` replaces a same-`platform:postId` row rather than duplicating it), so
a mid-week fix or a deliberate later re-read both simply replace that row with the latest values.
Results land in `content/social/metrics/metrics-<date>.json`, one dated file per `hand-entry.ts`
run, plus `content/social/metrics/instagram-followers.json` (a daily account-level follower
snapshot, hand-entered by `follower-snapshot.ts` per section 5.5, since Instagram only exposes
follower counts at the account level, not per-post — see the readout's `'inferred'` conversion
labeling below).

At week 4, produce the verdict:

```bash
npx tsx social/src/metrics/readout.ts
# or with an explicit evaluation instant and/or a non-default breakout threshold:
npx tsx social/src/metrics/readout.ts --now 2026-09-29T00:00:00.000Z --breakout-threshold 10000
```

This reads every `metrics-<date>.json` under `content/social/metrics/` (deduping to the latest
`collectedAt` per post — a safety net for a corrected re-entry of the same post under a different
date, not a polling flow) plus `instagram-followers.json`, and prints, per platform: the median,
the maximum, the max/median ratio, the week-1-vs-week-4 median trend, follow conversion (labeled
`exact` for YouTube, `inferred` for Instagram/TikTok — from daily follower deltas aligned to
`publishedAt`, since per-post follow attribution only exists on YouTube — or `unavailable` when no
follower-snapshot series exists for that platform), and the top 5 posts with their format. It then
states plainly whether the pre-registered criterion (section 1) was met, quoting the same "outlier
with no conversion and no trend is explicitly a NO" language the criterion itself uses.

`social/src/metrics/readout.ts`'s own tests (`social/src/metrics/__tests__/readout.test.ts`) prove
this against synthetic data with an injected outlier both ways: an outlier that also converts
reports a breakout (criterion A met); an outlier with no conversion and no week-1-to-4 trend
reports NOT VIABLE, in those words — so a big single number alone can never produce a false
"viable."

## TikTok metrics collection — historical note (T13, superseded by T14)

T13 investigated whether TikTok per-post metrics (views, likes, comments, shares) could be
collected automatically — the same way the now-deleted `metrics/instagram.ts`/`metrics/youtube.ts`
collectors did for their platforms — instead of by hand. Two candidate read paths existed:
TikTok's **Display API `video.list` scope**, reachable from an unaudited app in Sandbox mode with
no App Review needed, documented to return per-video view/like/comment/share counts; and the
**Business Account API**, which additionally exposes average watch time, profile views, and a
follower series, but requires both a Business account and app approval. A spike
(`social/src/metrics/tiktok-spike.ts`, since deleted) was built to test the Display API path
against a real account, but was never run — no TikTok account or app credentials existed at the
time — so the question was never resolved by evidence.

**It is now closed by decision instead.** This pilot hand-enters metrics for all three platforms
(`social/src/metrics/hand-entry.ts`, section 5.4), including TikTok, so whether TikTok's read API
could have been automated is moot regardless of which way the spike would have gone.

Three facts worth keeping so nobody has to re-discover them by trial and error if TikTok
automation is ever revisited:

- Sandbox mode's `video.list` requires the target TikTok account to be added explicitly as a
  Sandbox **target user** on the developer app — a required step, not optional.
- **Retention curves and traffic-source data are in-app only on TikTok on *either* read path** —
  even the heavier Business Account API doesn't expose them, so that data stays manual regardless
  of automation.
- TikTok exposes no per-post follow count on either path — the Business Account API's follower
  data is account-level only, the same shape problem Instagram's follower count already has (see
  `schema.ts`'s `InstagramFollowerSnapshot`) — so TikTok follow-conversion stays `unavailable`
  (no per-post or daily-snapshot series is collected for it) regardless of which read path, if
  either, was ever automated.

## Current status — what is NOT done

**Account setup (3.0), 2026-09-09: done.** The Google/YouTube (Brand Account), Instagram
(Business), and TikTok accounts all exist, phone-verified, on the shared pilot email, each with the
avatar, display name, and bio copy from 3.0; Facebook uses an existing personal profile plus the
`Plain` Page. Bio links are set on YouTube (`/go/yt`) and Instagram (`/go/ig`) — **TikTok has no
bio link yet**, deferred pending TikTok business verification (see 3.0's cost breakdown); this does
not block posting, only the bio-link conversion path on TikTok specifically.

**Native scheduling, verified 2026-09-09 (3.0a): done.** Confirmed by hand that TikTok's own
scheduler, Instagram's (via Meta Business Suite), and YouTube Studio's are all usable for the
weekly session (section 5) this pilot now runs on.

**Pilot anchor date reset, 2026-09-09:** `PILOT_WEEK_1_START` (`social/src/pilot-config.ts`) was
moved from `2026-09-01` to `2026-09-09`, since the original anchor had passed with nothing
published. Week 1 is now 2026-09-09..15 and week 4 is 2026-09-30..10-06. This is free to change
again right up until the first real render ships (a render embeds its `--date` in both its filename
and its metadata sidecar); after that it is fixed for the life of the pilot.

**Built and unit-tested, not yet exercised for real:** the render pipeline (`social/src/cli.ts`,
`social/src/prepare-week.ts`), the schedule generator and weekly reviewer
(`scripts/generate-schedule.ts`, `scripts/review-week.ts` — week 1's schedule,
`content/social/pilot-schedule-w01.json`, already exists), and all three metrics tools
(`social/src/metrics/hand-entry.ts`, `social/src/metrics/follower-snapshot.ts`,
`social/src/metrics/readout.ts`). Every one of these has tests against real fixtures, but none has
been run end to end against the real accounts yet — the first real weekly session (section 5) has
not happened.

**What genuinely remains before the pilot can start:**

- **The `/go/[slug]` attribution redirects still 404 in production.** They exist on this branch
  (`web/src/routes/go/[slug]/+server.js`) but have not merged to `main` or deployed. The bio links
  above already point at them; once that branch ships, verify each one actually redirects —
  `curl -sI https://thinkplain.ai/go/ig` (and `/yt`) should return a 302 to a
  `thinkplain.ai/?utm_source=...` URL — before relying on the attribution data it produces.
- **No posting time has been deliberately chosen.** Per section 4: nothing in this plan or its
  research notes has picked a specific time of day (or audience timezone) to schedule each week's
  posts for. Decide on one before the first real weekly session and use it consistently.
- **Zero posts have been published to any platform.** The first live post through this system, on
  any platform, has not happened yet.

Do not read the presence of thorough tests and a verified native-scheduling path as evidence this
pilot is live: account setup and tooling are complete, but as of this writing, **zero posts have
ever been published to any platform.**

## 8. Findings (week 4) — TEMPLATE, NOT YET FILLED IN

**As of 2026-08-27, this section is empty on purpose.** The pilot has not run. Zero posts have been
published on any platform (see "Current status" immediately above) — there is no week 1, no week 4,
no metrics file under `content/social/metrics/`, and therefore no finding. Nothing below this line is
a result. It is the exact procedure and the exact blanks whoever closes `Pf39c2-social-pilot-03` T16
must fill in once four real weeks of posts and metrics exist — written now, ahead of time, so that
person is filling in a pre-built skeleton with real numbers, not inventing the report's shape under
pressure to produce a verdict. If you are reading this and the date above is more than a few weeks
old relative to when go-live actually happened, treat that staleness itself as a signal that the
three items listed under "What genuinely remains before the pilot can start" in "Current status"
have not been closed yet either.

### 8.1 Procedure — run this at ~week 4, not before

1. Confirm four full pilot weeks of posts have metrics that are settled, not still climbing.
   Metrics are hand-entered, not polled on a schedule (section 7), so this is a judgement call, not
   a code-enforced wait: for each post, look at whether enough time has passed since it published
   that its view count on the platform looks stable rather than still rising, and if it doesn't,
   re-read that post's numbers later before trusting them in this readout.
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
