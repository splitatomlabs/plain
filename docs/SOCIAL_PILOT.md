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
cannot be answered at n=1 (one Instagram account, one TikTok account, one YouTube channel, ~168
posts over four weeks).

**Success criterion, copied verbatim from `plans/Pf39c2-social-pilot-index.md` — do not renegotiate
this after posting starts:**

> A single 10x-median outlier is NOT sufficient; across ~168 posts one is expected from variance
> alone.
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
`plans/research/social-experiment-notes.md`. Follow every one of them for all three accounts
(Instagram, TikTok, YouTube/Google).

- **Separate email per account, not reused from anything else.** Protects against automated
  cross-account linkage — platforms correlate accounts sharing signup emails, and a flagged
  signal on one account should not be traceable to another identity you use for anything else.
- **Create the account manually on a real device, not scripted, not in a headless browser, not
  through an API.** Automated account creation is itself a violation signal on every platform
  named here — no platform documents a "warm-up period" requirement, but every one of them
  detects and penalizes non-human signup patterns.
- **Phone-verify the account.** Phone verification is one of the strongest anti-bot signals a
  platform has; skipping it makes the account look exactly like the automated spam accounts these
  platforms are built to catch, independent of anything you actually post.
- **Distinct handle and bio, not templated or copy-pasted across accounts.** Even though this
  pilot only runs one account per platform (so there is no sibling account to look "interchangeable"
  with on the SAME platform), the handle and bio should still read as a real, specific account —
  generic or placeholder-looking branding is itself a low-effort/spam signal reviewers and automated
  systems are tuned to catch.
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

## 3. One-time setup (dependency order)

Do these once, in this order, before the daily loop can run for real. Each step links to the doc
that actually walks through it in detail rather than duplicating that detail here.

### 3.1 Provision R2

Follow `social/r2/README.md` in full: create the `plain-social-media` bucket, bind the
`media.thinkplain.ai` custom domain (the default `r2.dev` subdomain is rate-limited and
development-only — see that doc's own "Why a custom domain" section), apply the 30-day lifecycle
rule, and run its section 4 verification (`curl` checks for a 200, the right `content-type` header,
and a working range request). This produces the five `R2_*` values `social/src/publish/env.ts`'s
`loadR2Config` reads: `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` (`https://media.thinkplain.ai`).

### 3.2 Create the Meta app and get an Instagram token

Per the plan's Decision: Instagram needs no App Review. Create a Meta Business-type app, give the
pilot's Instagram account a role on it, and use Standard Access — it covers
`instagram_business_content_publish`. Do **not** request Advanced Access; it buys nothing here and
invites more scrutiny than this pilot needs. Obtain the account's `IG_USER_ID` (the Instagram
Business Account id) and a long-lived Instagram access token through Meta's own token-exchange flow.

**Long-lived Instagram tokens expire in 60 days and must be refreshed** (the token must be at least
24 hours old before a refresh is eligible — see `social/src/publish/tokens.ts`'s
`MIN_REFRESH_AGE_MS`). Section 4 below covers where this token has to be seeded by hand.

### 3.3 Create the YouTube OAuth app

Create a Google Cloud OAuth app and complete Google's consent flow for the pilot's YouTube channel,
requesting both `https://www.googleapis.com/auth/youtube.upload` (for publishing,
`social/src/publish/youtube.ts`) and `https://www.googleapis.com/auth/yt-analytics.readonly` (for
metrics, `social/src/metrics/youtube.ts`) on the **same** consent — there is only one OAuth flow for
this account, not two.

**This OAuth app MUST be published to "In production" in the Google Cloud console, not left in
"Testing."** This is a plan Constraint, not a nice-to-have: an app left in Testing mode issues
refresh tokens that expire every 7 days, which silently kills the daily cron a week after whoever
set it up stops manually re-authorizing it. Publishing to production costs one of Google's 100
lifetime OAuth user-consent slots and needs no Google verification review for this app's scopes.

### 3.4 No OAuth authorization flow exists in this codebase — seed tokens by hand

**Flag this clearly, because it is the gap most likely to trip up a first run:** nothing in this
repository performs an OAuth authorization exchange for either platform. `social/src/publish/
instagram.ts` and `social/src/publish/youtube.ts` only *use* an already-issued token
(`ensureFreshToken`, `social/src/publish/tokens.ts`) — they never obtain one. The token you get from
sections 3.2/3.3's manual consent flows must be written directly into Firestore before the daily job
can publish anything.

Tokens live in the `social-pilot-tokens` Firestore collection (one document per platform, keyed by
platform name — `social/src/publish/token-store-firestore.ts`'s `DEFAULT_COLLECTION`), each document
shaped exactly like `StoredToken` (`social/src/publish/tokens.ts`):

```json
{
  "value": "<the long-lived Instagram token, or the YouTube refresh+access token pair as your own encoding>",
  "expiresAt": "2026-10-27T00:00:00.000Z"
}
```

Write these two documents (`instagram`, `youtube`) into that collection by hand — e.g. via the
Firebase console's Firestore data viewer, or a one-off `gcloud`/Firestore-client script — before
attempting a real (non-`--dry-run`) run. A run that reaches a missing token document fails loudly by
design (`ensureFreshToken` throws, naming the platform, never the token value) rather than silently
skipping that platform.

There is also no real OAuth **refresh** implementation yet: `job.ts`'s default `refresh` dependency
(`notImplementedRefresh`) throws a clearly-named error rather than silently no-op'ing. In practice
this means: once the seeded token approaches its expiry window, the daily job will start failing
that platform (loudly, in its logs) until a human re-runs the manual consent flow and re-seeds the
Firestore document. Watch for `WARN` expiry-alert lines in the job logs (section 4) inside the
30-day window before a token expires, per `tokens.ts`'s `expiryAlert`.

### 3.5 Build the Docker image

Follow `social/DOCKER.md` in full. In short, from the **repo root** (not `social/` — the Dockerfile
needs `content/output/` and `content/social/`, which live outside `social/`):

```bash
docker build --platform linux/amd64 -f social/Dockerfile -t plain-social:latest .
```

Then run the zero-credential smoke test before anything else:

```bash
docker run --rm plain-social:latest --date <YYYY-MM-DD> --dry-run
```

A successful run prints `[instagram] DRY-RUN` / `[youtube] DRY-RUN` lines and exits 0 — this proves
the image can actually render (headless Chromium x2, ffmpeg) before any credential is involved. See
`social/DOCKER.md`'s troubleshooting section for the two known gotchas (a Chromium sandbox error
under gVisor, and a "no browser found" error if the container's working directory is wrong).

### 3.6 Deploy the Cloud Run Job and the Firebase trigger

Follow `social/DEPLOY.md` in full — it is a numbered, copy-pasteable sequence: enable the required
GCP APIs, create the Firestore database (if the project doesn't have one), create the two
least-privilege service accounts, create the Secret Manager secrets for the R2 values and
`IG_USER_ID`, push the image to Artifact Registry, create the Cloud Run Job from
`social/cloud-run-job.yaml`, deploy the Firebase Function (`functions/src/socialTrigger.ts`), and
force one immediate run to verify the whole chain actually executes end to end (that doc's step 8).

Complete section 3.4 (seed the Firestore tokens) **before** attempting a non-dry-run forced run at
the end of `DEPLOY.md`'s step 8 — otherwise it will fail on both platforms with a missing-token
error, which is expected in that state, not a deploy bug.

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
   `cli.ts`'s render path), uploads every rendered asset to R2 (before any post is attempted — a
   posting failure never loses a render), then publishes independently to Instagram and YouTube.
   A failure on one platform never stops the other (`Promise.allSettled`, not `Promise.all`). An R2
   upload failure is a **per-platform** precondition, not a whole-run abort (code review M7 fix):
   it makes only Instagram's outcome `failed` (Instagram needs the video's public R2 URL for Meta's
   Graph API), while YouTube still uploads straight from the local rendered file and is unaffected
   by an R2 outage.

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

This is the one recurring piece of manual work the whole pilot depends on. Budget roughly
**30-40 minutes**: about 20 minutes for TikTok scheduling (per the plan's own estimate) plus 10-15
minutes for the YouTube flips and TikTok metrics entry, depending on how many posts accumulated that
week. Do this on the same day each week, ideally right after a week's schedule has fully posted.

Checklist, in order:

### 5.1 Generate next week's schedule (if not already done)

Before this week's posts run out, generate the following week's schedule so the daily job always has
a slot to resolve. Week 1 is anchored at `2026-09-01` (`social/src/pilot-config.ts`'s
`PILOT_WEEK_1_START`); every later week reads every prior `pilot-schedule-w<NN>.json` so a card is
never reused, and (for week > 1) requires that the *prior* week's review note exists and is filled
in:

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

### 5.2 Stage the week's TikTok videos and captions

**No CLI command exists for this yet** — `social/src/publish/tiktok-manual.ts`'s `stageTikTokWeek`
is a fully-built, fully-tested function (`social/src/publish/__tests__/tiktok-manual.test.ts`, 11
tests) but nothing in this repo wraps it in a runnable script. Until that wrapper is written, invoke
it directly with `tsx` via a short one-off script, e.g.:

```ts
// scratch-stage-tiktok.ts — run once per week with: npx tsx scratch-stage-tiktok.ts
import { createR2Client } from './social/src/publish/storage.js';
import { loadR2Config } from './social/src/publish/env.js';
import { stageTikTokWeek } from './social/src/publish/tiktok-manual.js';
import { createFirestorePendingFlipsStore } from './social/src/publish/pending-flips-store-firestore.js';
import { readFile } from 'node:fs/promises';

const config = loadR2Config(); // reads R2_* from process.env — see section 3.1
const client = createR2Client(config);
const schedule = JSON.parse(await readFile('content/social/pilot-schedule-w<NN>.json', 'utf-8'));
// Reads the same durable Firestore store job.ts wrote the week's uploaded video ids into
// (`social-pilot-pending-youtube-flips` collection) — via Application Default Credentials, so run
// this with the same GCP project's credentials active as the Cloud Run Job's service account
// (e.g. `gcloud auth application-default login`, or from wherever that identity is available).
const pendingYouTubeFlips = await createFirestorePendingFlipsStore().read();

const manifest = await stageTikTokWeek({
  client, config, schedule,
  outDir: 'social/out', // wherever that week's videos were actually rendered to
  pendingYouTubeFlips
});
console.log(JSON.stringify(manifest, null, 2));
```

Run it with the week's R2 credentials set in the environment. It uploads every rendered day's MP4
plus a single `captions.txt` to `tiktok-staging/<weekStartDate>/` in R2, and prints a manifest with
each day's direct video URL and its caption, plus that week's pending YouTube flips (see 5.3 — one
manifest covers both platforms' weekly work, by design).

For each day in the manifest, in TikTok's app:
1. Open the day's `videoUrl` (a direct HTTPS link to the MP4 in R2) and download it to the device
   posting to TikTok, or otherwise get it onto that device.
2. Upload it in TikTok's app, using its **native scheduler** — per the plan's Decision, TikTok's
   posting API is unusable here, so every TikTok post goes up through the app by a human, not code.
3. Paste the matching caption from `captions.txt` (or the manifest's `days[].caption`) — the file is
   deliberately plain text, one block per day separated by a rule, meant to be read top to bottom
   and matched to each video by date and card id, not parsed as JSON mid-session.

### 5.3 Flip the week's YouTube uploads from private to public

Every YouTube upload from the daily job lands **private** on purpose (section 4, point 3). Flip each
one to public in YouTube Studio:

1. The list of videos awaiting a flip lives in Firestore, not a git-diffable file (code review M4
   fix) — the `social-pilot-pending-youtube-flips` collection's single `flips` document (the same
   store the previous step's script already reads via `createFirestorePendingFlipsStore().read()`).
   Read it standalone, without staging TikTok, with:
   ```bash
   npx tsx -e "
     import('./social/src/publish/pending-flips-store-firestore.js').then(async (m) => {
       console.log(JSON.stringify(await m.createFirestorePendingFlipsStore().read(), null, 2));
     });
   "
   ```
   (same ADC requirement as section 5.2's script), or open it directly in the Firestore console:
   Firestore Database -> the `social-pilot-pending-youtube-flips` collection -> the `flips`
   document -> its `flips` array field. Each entry is `{ date, cardId, videoId }`
   (`PendingYouTubeFlip`, `social/src/publish/tiktok-manual.ts`).
2. In YouTube Studio -> Content, find each `videoId` (or search by upload date) and change its
   visibility from Private to Public. This is quick — the plan's own estimate is ~10 seconds per
   video.
3. There is no code that removes an entry from the pending-flips document once flipped — treat it
   as an append-only weekly log for now (`upsertPendingFlip` only replaces a same-date entry on a
   re-run of that date's job, it does not prune flipped entries). Cross off or note which ones you
   flipped by hand if this list's growth becomes hard to scan (it is no longer a local file you can
   `git diff`, so track flipped-vs-not some other way — e.g. a scratch note alongside this session's
   TikTok staging notes).
4. Separately, the compliance audit YouTube offers for automated-upload workflows was meant to be
   submitted in parallel with this pilot (plan Decision) — if/when it's approved, this manual flip
   step goes away and uploads can go straight to public. Nothing in this pilot currently tracks the
   audit's status; check on it independently.

### 5.4 TikTok metrics — hand entry, plus retention (always manual)

TikTok metrics collection is **not automated as of this writing** (see the TikTok metrics section
below, carried over from T13) — the hand-entry fallback is in force by default. For each TikTok post
still inside its 30-day polling window, read four numbers off TikTok's own per-video analytics
screen — **views, likes, comments, shares** — and run, from `social/`:

```bash
npx tsx social/src/metrics/tiktok-manual.ts \
  --post-id <tiktok-video-id> \
  --published-at <ISO8601 publish instant, from the app> \
  --views <n> --likes <n> --comments <n> --shares <n>
```

This is idempotent — re-running it for the same `--post-id` on the same collection day updates that
row in place rather than duplicating it, and writes into the same dated file
(`content/social/metrics/metrics-<date>.json`) Instagram's and YouTube's automated rows already
land in.

**TikTok retention (average percent watched) and traffic-source breakdowns are in-app only on
TikTok, regardless of whether the Display API spike below ever gets automated** — no read path,
automated or manual, exposes them outside TikTok's own app. If you want to track retention
qualitatively, read it off the app's per-video analytics screen and note it separately; there is no
field for it to flow into automatically (`averagePercentWatched` stays `null` on every TikTok row
unless you pass `--avg-percent-watched <n>` by hand for a specific post).

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
   already lives in R2, under `media.thinkplain.ai`, uploaded *before* any post is attempted
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

## Current status — what is NOT done

Be honest with yourself before assuming this pilot is ready to run: **six live steps described
above have never actually been executed.** Every one of them was built and unit-tested against
mocked APIs/clients in this session's work, but none was run against a real account, a real cloud
project, or real hardware. Specifically, per the plan's own task notes:

- **R2 provisioning (T01)** — no bucket has been created, no custom domain bound, no lifecycle rule
  applied. Closing this requires Cloudflare account access and running `social/r2/README.md`'s
  numbered steps by hand (create bucket, bind `media.thinkplain.ai`, apply the 30-day lifecycle
  rule, run its section 4 `curl` verification).
- **A live Instagram post (T05)** — the adapter (`social/src/publish/instagram.ts`) is built and
  unit-tested against a mocked `fetch`, but no real post has ever been made. Closing this requires a
  Meta app/account (section 3.2 above) and R2 already live, then one real `publishToInstagram` call
  confirmed publicly visible.
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

> A single 10x-median outlier is NOT sufficient; across ~168 posts one is expected from variance
> alone.
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
