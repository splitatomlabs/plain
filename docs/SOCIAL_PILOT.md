# Social Pilot — Runbook

This is the operating manual for the social viability pilot (`plans/complete/Pf39c2-social-pilot-index.md`
and its three sub-plans, `Pf39c2-social-pilot-01/02/02a/03.md`). It is written so someone who was
not involved in building this system can run the pilot day to day and week to week from this
document alone — every command below is real, copy-pasteable, and checked against the actual
source files as of 2026-09-09, not paraphrased.

**Read the "Current status" section (near the bottom) before doing anything else.** The pilot is
LIVE: week 1 (2026-09-14..20) published on all three platforms and is measured, and week 2 is
scheduled. Section 8's verdict is due after week 4 closes on 2026-10-11.

## 1. What the pilot is, and the pre-registered criterion

**The question:** is social media viable at all for Plain? Not which format performs best — that
cannot be answered at n=1 (one Instagram account, one TikTok account, one YouTube channel, 84
posts over four weeks — 1 Wall post/day x 3 platforms x 28 days).

**Success criterion, copied verbatim from `plans/complete/Pf39c2-social-pilot-index.md` — do not renegotiate
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
(`computeReadout`/`computeVerdict`), labels follow-conversion `'exact'` — the platform's own
per-post attribution, which all three report: YouTube's `subscribersGained`, Instagram's per-Reel
Follows, TikTok's per-video Follows — or `'unavailable'` for a platform none of whose posts carried
a recorded figure, and its summary text literally contains the "outlier with no conversion and no
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
- ~~**Already unavailable anyway — TikTok follow-conversion.**~~ **Obsolete as of 2026-09-21:**
  TikTok reports Follows per video, read during the weekly session (5.4), so its conversion is
  `exact` like every other platform's. This bullet argued the signal was out of scope because
  nothing collected a TikTok follower series — a conclusion that rested on the same wrong premise
  section 5.5 records, not on the deferral it was justifying.

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

### 3.1 What was provisioned, and its teardown

Before this plan replaced the API publish pipeline with native scheduling, the following was built
and verified live against real accounts. On 2026-09-10 it was actually torn down. This section is a
record of what existed and what happened to it, not a description of anything still live or dormant.

- **The GCP project `plain-social-pilot`, and its GCS bucket `gs://plain-social-pilot-media`, were
  deleted on 2026-09-10.** (The bucket existed to give Meta and YouTube a public URL to fetch
  rendered video from, before the weekly session switched to uploading from local disk.)
  `gcloud projects describe plain-social-pilot` now reports `lifecycleState: DELETE_REQUESTED` —
  Google holds a deleted project in this pending state for 30 days, recoverable with
  `gcloud projects undelete plain-social-pilot` until then, after which the deletion becomes
  permanent around **2026-10-10**. Before deletion, the bucket was confirmed to hold 0 objects, so no
  rendered media or test artefacts were lost.
- **The Meta app** (`developers.facebook.com`, Development mode, never published) **was deleted on
  2026-09-10** by hand at `developers.facebook.com` — there is no API for this. The long-lived Page
  access token it held died with the app; there was nothing separate left to revoke. Worth
  remembering if this pilot, or another one against Meta's API, is ever revisited: Meta has two
  non-interchangeable Instagram API families — Facebook Login (`graph.facebook.com`, requires a
  Page, `instagram_content_publish`) and Instagram Login (`graph.instagram.com`, no Page,
  `instagram_business_*` permissions). This pilot built against the Facebook Login family; getting
  that wrong the first time cost about an hour to discover.
- **The Facebook Page (`1268933229644482`, "Think Plain") was deliberately NOT deleted, and must not
  be.** Unlike everything else in this section, it is not leftover pipeline infrastructure — see 3.0
  and 3.0a: Meta Business Suite manages Instagram content through this Page, so it is load-bearing
  for section 5.3's weekly Instagram scheduling and remains in active use.
- **A YouTube OAuth app was planned** (Google Cloud console, requesting `youtube.upload` and
  `yt-analytics.readonly` scopes, to be published to "In production" so refresh tokens wouldn't
  expire every 7 days) **but, per this document's own prior "Current status" tracking, was never
  actually created** — no live YouTube upload was ever completed through it. There was nothing to
  tear down here.

None of this blocks anything above: 3.0/3.0a describe the complete, current setup, and — apart from
the Facebook Page, kept for exactly the reason stated above — it uses nothing on this list.

## 4. The daily loop

**There is no daily loop any more.** The Firebase trigger, the Cloud Run Job, and everything else
that used to fire unattended once a day were deleted along with the rest of the API publish
pipeline (`Pb4e17-social-native-scheduling` T07-T09) — posting is a manual, weekly act now (section
5), not a daily one.

**Nothing happens every day any more, either.** A daily follower-count reading used to be the one
genuine exception; it was deleted on 2026-09-21 once all three platforms turned out to report
follows per post, which the weekly session records instead (5.4, and 5.5 for why). The pilot is now
a purely weekly operation.

**The posting time — DECIDED 2026-09-10: `07:30 America/New_York`, every day, all three
platforms, unchanged for the full 28 days.** This replaces the deleted daily trigger's placeholder
(`America/New_York`, `07:53`), which was chosen only to land off the top of the hour and for no
audience or distribution reason. Type this value into each platform's scheduler at section 5.3's
"set the scheduled time" step.

Two reasons, in order of weight:

1. **Constancy matters far more than the hour itself.** `plans/research/social-experiment-notes.md`
   records Buffer's 52M-post finding — "sharing your posts at the 'right' time is not the secret
   sauce" — alongside the rule that actually binds here: *hold the time CONSTANT per account.*
   Criterion B (section 1) is a week-1-to-week-4 median trend, so a posting time that drifts
   mid-pilot confounds the exact signal that trend exists to measure. **Do not "try an evening slot"
   in week 3.** If the time must change, the pilot restarts; it does not continue with a note.
2. ~~**An early post protects Instagram's follow-conversion — see 5.5.**~~ **Obsolete as of
   2026-09-21.** This argued that 07:30 mattered because conversion was inferred from a daily
   follower delta whose window depended on when the count was read. All three platforms report
   follows per post, that inference is gone (5.5), and the posting hour no longer couples to
   conversion measurement at all. **The 07:30 time still does not change** — reason 1 above is the
   binding one, and holding it constant is what criterion B's week-1-to-week-4 trend requires.

**A caveat this document should not overstate:** no daily-delta scheme is clean. Some of each post's
follows always spill into the next day's window, which is exactly why section 1 labels the method
`'inferred'` and not `'exact'`. 07:30 minimises that error; it does not eliminate it. YouTube is
unaffected either way — its `subscribersGained` is per-video and exact.

## 5. The weekly session — the most important part of this document

There is no automated posting behind this section any more (section 3.1) — it **is** the pilot now.
Once a week, at a desk: render the week's videos, open three browser tabs (TikTok, Meta Business
Suite, YouTube Studio) and manually upload, caption, and schedule seven days of posts on each, then
hand-enter last week's numbers. **Everything in this pilot now happens in this one weekly sitting**
— the daily follower reading that used to run on its own rhythm was deleted on 2026-09-21 (5.5).

No real session has been run yet (see "Current status" below), so there is no measured time cost —
only the arithmetic: 21 uploads a week (3 platforms x 7 days), each needing a file, a caption paste,
and a scheduled time set by hand, plus up to 21 `hand-entry.ts` runs for last week's numbers. Budget the whole sitting at over an hour once real posts exist
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
ready to render and post. Week 1 is anchored at `2026-09-14` (`social/src/pilot-config.ts`'s
`PILOT_WEEK_1_START`, reset from `2026-09-01` and then `2026-09-09` — see "Current status"
below); every later week reads every prior `pilot-schedule-w<NN>.json` so a card is never
reused, and (for week > 1) requires that the *prior* week's review note exists and is filled in:

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

**If you reject a card, write it into `content/social/rejected-cards.json` in the same sitting —
editing the schedule alone does not stick.** Some drawn cards are unpostable on content grounds
even though they render fine: the usual case is a landing line that reads as a fragment of a longer
passage rather than a payoff, which the pool's own rubric does not reliably catch (it scored the
worked example below a 4 and called it "self-contained"). A card swapped out of a week's schedule
is then in no schedule at all, and `loadPriorWeeks` builds later weeks' exclusion sets from what
the schedules *contain* — so the rejected card goes back in the pool and can be drawn again. That
is not hypothetical: `on-anger-02-054` ("A boy was raised in Plato's household.") was pulled from
week 1 day 2 by commit `ee25b4f` (#46) and the week 2 draw handed back the same card.

The list is hand-maintained and committed — there is deliberately no CLI that appends to it, since
writing the reason by hand is the point. Add an entry with `card_id`, `book_slug`, `reason`,
`rejected_on` (and `rejected_in`/`replaced_by` when they apply); every field but the last two is
required and validated, and a `card_id` matching no real card fails generation loudly rather than
silently protecting nothing. `generate-schedule.ts` reads it by default and prints what it
excluded:

```
Excluded: 0 un-renderable, 1 content-rejected
```

**This is not `render-exclusions.json`.** That file is renderer-derived, regenerated wholesale by
`social/scripts/write-exclusions.ts`, and means "this card cannot be rendered"; entries added there
by hand would both misstate the reason and be lost on the next regeneration. See
`scripts/lib/rejections.ts`.

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

The MP4s land in `social/out/`, one per day, each alongside a `wall-<date>-cover.jpg` (the upload
cover — see 5.3) and a `wall-<date>.json` metadata sidecar that is never uploaded. With them sits a
single `captions.txt` — one block per day, each carrying all three platforms' captions clearly
labelled `[tiktok]`, `[instagram]`, `[youtube title]`/`[youtube description]`, separated by a rule,
meant to be read top to bottom during the next step, not parsed as JSON mid-session.

### 5.3 Upload and schedule — three browser tabs

For each of the week's 7 days, in each of three places — TikTok's own upload flow, Meta Business
Suite (for Instagram Reels), and YouTube Studio — upload that day's MP4 from `social/out/`, paste
that day's caption for *that specific platform* from `captions.txt`, and set the scheduled time —
**`07:30 America/New_York`, the same on every platform and every day** (section 4; it is held
constant for the whole pilot, so this value should never differ between two uploads).
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
  scheduling in Studio does its job outright. **YouTube is the one platform that needs TWO fields**,
  and `captions.txt` supplies both, adjacent: `[youtube title]` goes in Studio's title box and
  `[youtube description]` in its description box. The title is `<landing line> — <Author>, <Book>`
  (`caption.ts`'s `buildYouTubeTitle`) — hook first, because the Shorts player truncates a title at
  roughly 40 characters, while the attribution stays indexed for search in full. Do not retype or
  improvise it: the generator applies YouTube's 100-character limit, dropping the book and then the
  author if a line is long, and never trimming the quote itself (a trimmed quote is a misquote —
  Constraint 6). Week 1 day 4 already lands on exactly 100 characters, so the margin is real.
- **Covers, on every platform that asks for one: upload `wall-<date>-cover.jpg`.** The render writes
  it next to the MP4. It is the composition's own landing-line frame at 1080x1920 — the same image
  the viewer sees when the video cuts from the wall — so the cover, the YouTube title and all three
  captions all lead with the same sentence.

  **Do not pick a frame from the platform's own suggestions.** YouTube samples its suggested covers
  across the video and they land in the scrolling archaic block, never on the landing line. Scrubbing
  by hand has a subtler trap: the payoff is NOT one hold. The landing line holds for its own window
  right after the cut, and then every remaining sentence of the passage holds in turn, so the END of
  the video is the passage's closing sentence — on 2026-09-14 that is "In all of this, there is no
  harm.", not "Every action has an end." Scrubbing to the end gets the wrong line. The generated
  cover is taken from the middle of the landing-line window (`cli.ts`'s `coverFrame`, pinned against
  `computeWallTiming` by test) precisely so nobody has to know that.

  Skip TikTok's own cover-text overlay — the payoff line is already the text. Keep this identical for
  all 28 days, the same way the posting time is held constant: a coherent grid is part of what
  converts a breakout into follows.

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

**`--follows` is the flag that matters most, and every one of the three platforms reports it per
post.** YouTube Studio shows subscribers gained per video, Meta Business Suite shows Follows per
Reel, and TikTok shows Follows per video. Read all three and pass them as `--follows`; that is what
lets `readout.ts`'s `computeFollowConversion` record a post as `'exact'` (section 1), which is half
of criterion A. Omitting the flag records `null` ("not read"), never a fabricated `0`, and that
post falls back to the inferred daily-delta path instead. An explicit `--follows 0` is a real
reading meaning that post converted nobody: it is recorded as data, and it does not satisfy
criterion A, which requires visible conversion.

**Corrected 2026-09-21 — this section previously said `--follows` "only means something on
YouTube" and that "Instagram and TikTok have no per-post follow attribution on any read path."
That claim was wrong about both.** It was corrected in two steps, as each platform's screen was
actually checked rather than reasoned about. The error was not harmless while it stood: it pushed
two platforms' conversion through the weaker daily-delta inference even though an exact per-post
number was on the same screen the operator was already reading, and `hand-entry.ts` actively
REJECTED that real number if it was typed in, calling it a fabrication. There is no per-platform
rejection left; what remains is the non-negative-integer check, which catches hand entry's actual
failure mode — a mistyped number. **Never estimate this figure. Read it or omit it.**

**A post whose number was read and one whose was not can sit in the same week**, so the platform
label reports what the data actually holds: `exact` when every post carries a per-post figure,
`inferred` when none do and the follower series covers them, `mixed` when both, and `unavailable`
when there is no number of either kind — including on a platform that simply had no figure
entered, since naming a method while holding no data would imply conversion evidence that does not
exist.

**`--post-id` and `--published-at` are both required and neither is redundant, but nothing
cross-checks them — so a mistyped `--post-id` is guarded.** The two do different jobs: `--post-id`
alone is the row's identity (`schema.ts`'s `metricsRowKey`, `platform:postId`), while
`--published-at` alone drives the dated filename, the criterion-B week bucket, and the criterion-A
follower alignment. A platform's id carries no date and a date names no post, so both have to be
typed. The failure that creates: a typo'd id on a correction re-run does *not* replace the row it
was meant to fix — it writes a second row, `readout.ts` dedupes by `platform:postId` and keeps
both, and the phantom post's views land in the median criterion B is measured on, with no error and
no symptom until the week-4 readout is quietly wrong. `hand-entry.ts` therefore refuses a second,
different `--post-id` for a platform that already has a post on that published date, naming both
ids, and writes nothing. The pilot posts once per platform per day, so this only fires on a
mistake; `--allow-second-post` is the escape hatch for a day that genuinely carried two posts on
one platform.

`--avg-percent-watched` stays optional and `null` unless a platform's analytics screen shows a clean
percentage worth typing in — TikTok's retention data in particular is in-app only, with no automated
read path at all, on either candidate API path (see the TikTok metrics section below).

### 5.5 The daily follower integer — REMOVED 2026-09-21

**There is no daily task in this pilot any more.** This section described a follower count to be
read off Instagram and TikTok every single day, late in the evening, via
`social/src/metrics/follower-snapshot.ts`, warning that it was un-backfillable and that a skipped
day broke two posts' conversion readings.

It existed for one reason: the belief that Instagram and TikTok reported follower counts only at
the account level, so criterion A's conversion half had to be *inferred* from day-over-day deltas.
**That belief was wrong about both platforms.** Meta Business Suite reports Follows per Reel and
TikTok reports Follows per video, the same way YouTube Studio reports subscribers gained — all
three are exact, per-post, and read during the weekly session (5.4) off screens the operator is
already looking at.

So the CLI, the two `<platform>-followers.json` series, and the delta inference in `readout.ts`
were all deleted rather than kept as a fallback. What replaces it is one more number per post in
5.4. `git log` has the removed code and the two recorded readings if the premise ever needs
revisiting.

**The cost while it stood is worth remembering when a measurement plan is being designed from
assumptions about an external system rather than from its screens:** the pilot carried a daily,
un-backfillable manual chore for weaker data than was freely available — and it was in fact missed
for every day of week 1, which is what surfaced the question in the first place.

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
   videos, covers, or captions.
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
run — the only metrics artifact there is. (Two `<platform>-followers.json` series used to sit
beside them; see 5.5 for what they were and why they are gone.)

At week 4, produce the verdict:

```bash
npx tsx social/src/metrics/readout.ts
# or with an explicit evaluation instant and/or a non-default breakout threshold:
npx tsx social/src/metrics/readout.ts --now 2026-10-07T00:00:00.000Z --breakout-threshold 10000
```

This reads every `metrics-<date>.json` under `content/social/metrics/` (deduping to the latest
`collectedAt` per post — a safety net for a corrected re-entry of the same post under a different
date, not a polling flow) and prints, per platform: the median,
the maximum, the max/median ratio, the week-1-vs-week-4 median trend, follow conversion (`exact`
from the platform's own per-post attribution, with a count of how many of its posts carried a
recorded figure, or `unavailable` when none did), and the top 5 posts with their format. It then
states plainly whether the pre-registered criterion (section 1) was met, quoting the same "outlier
with no conversion and no trend is explicitly a NO" language the criterion itself uses.

**Posts are named by CARD, not just by platform id.** A `MetricsRow` stores the platform's own id
(an Instagram media id, a YouTube video id) because that is the only stored pointer back to the
real post, but `ler2U2CFzHs` does not tell you which premise a post was built from — and criterion
A's payoff is "rebuild around whatever premise did it." So the readout resolves each post's card
from its publish date against the committed `pilot-schedule-w<NN>.json` files
(`social/src/metrics/card-index.ts`, inverting `pilot-config.ts`'s own week/day anchor) and prints
both:

```
Top 1 post(s):
  - meditations-09-025 [ler2U2CFzHs] (wall): 16 views
```

The criterion-A verdict sentence names the card the same way. `--schedule-dir` overrides where the
schedules are read from (default `content/social/`); a date no schedule covers, or a missing
directory, falls back to the platform id alone rather than guessing a card, and never fails the
run.

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

## Current status — the pilot is LIVE

**Week 1 is published and measured; week 2 is scheduled and starts 2026-09-21.** Updated 2026-09-21.
This section spent a long time saying the opposite and was not updated on the day posting began —
read the dates below, not the prose, if the two ever disagree again.

| | Status |
|---|---|
| Week 1 (2026-09-14..20) | **Published on all three platforms, all 21 posts.** Metrics hand-entered and committed; review note filled (`content/social/pilot-review-w01.md`) |
| Week 2 (2026-09-21..27) | Generated, rendered, scheduled. First post 07:30 ET on 2026-09-21 |
| Week 3 (2026-09-28..10-04) | Not generated — gated on week 2's review note (5.1) |
| Week 4 (2026-10-05..11) | Not generated. The verdict (section 8) is due after it closes |

**Week 1 result, for orientation only — it decides nothing:** 3,033 views across 21 posts; medians
65 (Instagram), 199 (TikTok), 212 (YouTube); maximum 398; **one** follow in total. Criterion A is
not met and is not close (398 against a ~10,000 threshold). Criterion B is not assessable until
week 4 by construction. The full reading, including a Day 3 YouTube post that drew 1 view for
reasons never established, is in the week 1 review note.

**Account setup (3.0), 2026-09-09: done.** The Google/YouTube (Brand Account), Instagram
(Business), and TikTok accounts all exist, phone-verified, on the shared pilot email, each with the
avatar, display name, and bio copy from 3.0; Facebook uses an existing personal profile plus the
`Plain` Page. Bio links are set on YouTube (`/go/yt`) and Instagram (`/go/ig`) — **TikTok has no
bio link yet**, deferred pending TikTok business verification (see 3.0's cost breakdown); this does
not block posting, only the bio-link conversion path on TikTok specifically.

**Native scheduling, verified 2026-09-09 (3.0a): done.** Confirmed by hand that TikTok's own
scheduler, Instagram's (via Meta Business Suite), and YouTube Studio's are all usable for the
weekly session (section 5) this pilot now runs on.

**Pilot anchor date reset again, 2026-09-10:** `PILOT_WEEK_1_START`
(`social/src/pilot-config.ts`) moved from `2026-09-09` to **`2026-09-14`** (a Monday). The
2026-09-09 anchor had itself already begun with nothing published, so week 1 would have started
mid-week and short. **Week 1 is now 2026-09-14..20 and week 4 is 2026-10-05..11.** This is still
free to change right up until the first real render ships (a render embeds its `--date` in both its
filename and its metadata sidecar); after that it is fixed for the life of the pilot. Note the
anchor is asserted directly in `social/src/__tests__/cli.test.ts`, and several tests there use week-1
dates — moving it again means updating those too.

**Exercised for real, 2026-09-14..21:** the render pipeline (`social/src/cli.ts`,
`social/src/prepare-week.ts`) has produced two weeks of MP4s; the schedule generator and weekly
reviewer (`scripts/generate-schedule.ts`, `scripts/review-week.ts`) have produced weeks 1-2 and
week 1's filled review note; and both metrics tools (`social/src/metrics/hand-entry.ts`,
`social/src/metrics/readout.ts`) have taken all 21 of week 1's rows and produced a real readout.
The first real weekly session (section 5) happened on 2026-09-21.

**What genuinely remains before the pilot can start:**

- ~~**The `/go/[slug]` attribution redirects still 404 in production.**~~ **Closed — verified live
  2026-09-21.** All three return a 302 with the correct `utm_source`
  (`curl -sI https://thinkplain.ai/go/ig`, `/yt`, `/tt`). **What is NOT verified is whether anything
  reaches them:** Instagram and TikTok do not render caption URLs as clickable links, so the
  attribution URL in those captions is plain text, and TikTok has no bio link either (3.0) — which
  leaves the platform carrying 40% of week 1's views with no clickable route to the site at all.
  3.0's claim that caption attribution survives the TikTok deferral looks wrong and should be
  checked on a live post. Check Umami for `/go/` traffic before concluding anything about
  conversion.
- ~~No posting time has been deliberately chosen.~~ **Closed 2026-09-10: `07:30 America/New_York`,
  all three platforms, held constant for the full 28 days** (section 4 gives the reasoning and the
  reason it must not be changed mid-pilot). The paired rule about reading a daily follower count
  late in the evening is gone with section 5.5 — conversion is now read per post, so the posting
  hour no longer affects how it is measured.
- ~~**Zero posts have been published to any platform.**~~ **Closed 2026-09-14**, when week 1 day 1
  went out on all three platforms. 21 posts published as of 2026-09-20.

**Two open questions carried out of week 1**, both operational rather than experimental — neither
changes what gets posted:

- **Day 3's YouTube post (`t_9C0SzdAks`) drew 1 view** while the same card took 159 on TikTok.
  Visibility is Public with no restrictions, the rendered file is sound, and title length does not
  predict views across the week. Read its **Impressions** (Analytics → Reach): near-zero means it
  never entered the Shorts feed; thousands at ~0% CTR means it was shown and ignored. Nothing else
  distinguishes those.
- **TikTok's day 1 post drew 0 views.** Cold start explains low, not zero — confirm it published.

## 8. Findings (week 4) — TEMPLATE, NOT YET FILLED IN

**This section is still empty on purpose, but no longer because the pilot has not run.** Updated
2026-09-21: week 1 IS published and measured (21 posts, metrics under `content/social/metrics/`,
review note filled). What is missing is weeks 2-4 — and the verdict below is a WEEK 4 verdict by
construction, because criterion B is a week-1-to-week-4 median trend that cannot be evaluated with
one week of data. **Do not fill this in early.** Week 4 closes 2026-10-11.

Nothing below this line is a result. It is the exact procedure and the exact blanks whoever closes
`Pf39c2-social-pilot-03` T16 must fill in once four real weeks exist — written ahead of time so that
person fills in a pre-built skeleton with real numbers rather than inventing the report's shape
under pressure to produce a verdict.

**Week 1's numbers are in `content/social/pilot-review-w01.md`, not here.** They are a baseline, not
a finding: criterion A is not met and not close (maximum 398 views against ~10,000; one follow
across 3,033 views), and criterion B is not assessable yet.

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
| Follow conversion method | **exact** (per-Reel Follows) — TO BE CONFIRMED AT WEEK 4 | **exact** (`subscribersGained`) — TO BE CONFIRMED AT WEEK 4 | **exact** (per-video Follows) — TO BE CONFIRMED AT WEEK 4 |
| Follow conversion value(s) | `<follows>` — TO BE FILLED AT WEEK 4 | `<follows>` — TO BE FILLED AT WEEK 4 | `<follows>` — TO BE FILLED AT WEEK 4 |

Do not relabel a platform's follow-conversion method by hand. All three rows above say `exact`
because all three platforms report follows per post — but copy whatever `readout.ts` actually
printed, not the expectation. A platform reads `unavailable` when no post of its own carried a
recorded figure, which is a gap in the entry, not a property of the platform.

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
The Scene** (see `plans/complete/Pf39c2-social-pilot-index.md`'s "The Wall — sub-types" table) — if the
weekly schedules tagged posts by sub-type and the data supports it, report which sub-type(s) the top
posts in 8.2 actually were here; otherwise say plainly that sub-type was not tracked and this
question also cannot be answered. TO BE FILLED AT WEEK 4.

### 8.4 The decision rule — copied verbatim, do not renegotiate it here

From `plans/complete/Pf39c2-social-pilot-index.md`'s "Success criterion (pre-registered — do not renegotiate
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
