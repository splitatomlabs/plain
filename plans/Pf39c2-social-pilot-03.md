# Publish and Measure

## Parent
`plans/Pf39c2-social-pilot-index.md`

## Depends on
- `plans/Pf39c2-social-pilot-02.md` — needs renderable assets

## Objective
Publish to Instagram unattended, upload to YouTube (private, flipped weekly), stage TikTok for the weekly manual
session, collect metrics, and produce a yes-or-no answer to the viability question.

## Decisions
- **Cloudflare R2 behind `media.thinkplain.ai`.** Free tier, zero egress. The default `r2.dev` subdomain is
  rate-limited and development-only, so a custom domain is required.
- **Instagram needs no App Review.** Give the account a role on your own Meta Business-type app; Standard Access
  covers `instagram_business_content_publish`. Do not request Advanced Access — it buys nothing and invites scrutiny.
- **Firebase `onSchedule` is a THIN TRIGGER ONLY** — scheduled functions are capped at 540s. It starts a **Cloud Run
  Job**, which allows a 168-hour timeout, 32 GiB and 8 vCPU.
- **YouTube uploads land private and are flipped by hand** in Studio during the weekly session. Submit the
  compliance audit in parallel; if it lands, the flip disappears and nothing else changes.
- **Tag every post with its format.** ~~and, for The Wall, its opening variant (standard / 190->97 / grade) —
  openings are the only variable moving within a constant format~~ — **CANCELLED, not deferred** (social pilot 02a
  T17): the opening comparison this decision existed to run is gone because the thing it would have compared is
  gone. Both numeric openings were retired outright and nothing replaces them — see the index plan's
  "opening rotation for The Wall" paragraph for why (a reading-grade number nobody finds compelling, and "190 -> 97"
  selling compression, which the product's own rule 4 forbids). `post-metadata.ts`'s `opening` field, which existed
  specifically so this plan could compare openings, was deleted along with it.
- **Metrics collection is automated on all three platforms; only TikTok retention stays manual.** TikTok's posting
  API being unusable says nothing about its READ path — they are different APIs with different scopes. Instagram and
  YouTube insights ride on the OAuth already needed for publishing, so they are near-free to add.
- **Per-post follow attribution exists only on YouTube** (`subscribersGained` per video). Instagram reports follower
  counts at the ACCOUNT level only, so criterion A's conversion half must be inferred from daily follower deltas
  aligned to post times — with two posts a day, attribution is directional, not exact. Say so in the readout rather
  than implying precision.
- Assets are uploaded to R2 before any post is attempted, so a posting failure never loses a render.

## Files
- `social/src/publish/storage.ts`, `instagram.ts`, `youtube.ts`, `tiktok-manual.ts`, `tokens.ts`
- `social/src/job.ts` — daily orchestration
- `social/Dockerfile`
- `functions/src/socialTrigger.ts`
- `social/src/metrics/` — collection and the viability readout
- `content/social/metrics/*.json`
- `web/src/routes/go/[slug]/+server.js` — attribution redirect
- `docs/SOCIAL_PILOT.md` — runbook and findings

## Constraints
- R2 objects MUST carry an explicit `contentType` — Meta cURLs the URL and content-type matters.
- Instagram: JPEG only for feed, <=8MB; Reels 3s-15min, <=300MB. Container -> poll `status_code` (once a minute,
  max 5 minutes) -> publish. Containers expire after 24h.
- Instagram's rate limit is "4800 x Number of Impressions" per 24h, which computes to near zero on a brand-new
  account. Expect error code 4 and back off rather than retry-storm.
- Instagram long-lived tokens expire in 60 days and must be refreshed (token must be >=24h old). Persist the
  refreshed value BEFORE using it — a crash between refresh and persist orphans the account.
- Never log tokens. Store them in Secret Manager or Firestore, never env vars.
- YouTube: always set `notifySubscribers=false` (it defaults to TRUE) and `selfDeclaredMadeForKids=false`. Shorts
  classification is automatic from aspect ratio and duration; `#Shorts` is not required.
- The YouTube OAuth app MUST be published to "In production", or refresh tokens expire every 7 days and the cron
  dies weekly. Costs 1 of 100 lifetime user slots, needs no verification.
- Track YouTube `engagedViews`, not `views` — since March 2025 `views` counts every Short start with no minimum
  watch time.
- **TikTok has two candidate read paths, and which one is available decides how much is automated** (T13 settles
  this): the **Display API** (`video.list` scope) returns per-video view/like/comment/share counts, which is enough
  for median, maximum and trend; the **Business Account API** additionally returns average watch time, profile views
  and follower series, but needs a Business account and app approval. Retention curves and traffic-source data are
  in-app only on TikTok regardless — those stay manual.
- Instagram account-level insights are unreliable on a brand-new account: demographic breakdowns require >=100
  followers and return errors or empty below that. Per-media insights work from day one.
- `docs/ANALYTICS.md` rules apply: aggregate only, nothing identifying a viewer.

## Tasks
- [!] T01: Provision R2, bind `media.thinkplain.ai`, add a 30-day lifecycle rule. Acceptance: a test object is
  fetchable over HTTPS with the correct content-type and supports range requests.
  DEFERRED — live acceptance (a real object fetched over HTTPS) needs Cloudflare account access, which
  this session does not have. Run `social/r2/README.md` section 4 by hand to close it.
  Done: split into the reproducible/checked-in half (done here) and the by-hand live provisioning (left for the
  user — no `wrangler`/cloud command was run). Added `social/r2/lifecycle.json` (S3 `PutBucketLifecycleConfiguration`
  shape, 30-day expiry on all objects) and `social/r2/README.md` — the runbook covering bucket creation, binding
  the `media.thinkplain.ai` custom domain (noting `r2.dev` is rate-limited/dev-only per this plan's Decision, so
  the custom domain is required), applying the lifecycle rule (both `aws s3api` and `wrangler r2 bucket lifecycle`
  paths), and copy-pasteable `curl` verification for all three acceptance parts (HTTPS 200, `content-type` header,
  `curl -r 0-99` returning 206 with `content-range`). No `cors.json`: every consumer (Meta container fetch,
  YouTube resumable upload) is server-side, so browser-only CORS enforcement is irrelevant — documented in the
  README rather than added speculatively. Also added `social/src/publish/env.ts` (`loadR2Config`/`R2Config`,
  validates `R2_ACCOUNT_ID`/`R2_BUCKET_NAME`/`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`/`R2_PUBLIC_BASE_URL`,
  throws naming the missing variable, never interpolates a value into an error) and
  `social/src/publish/__tests__/env.test.ts` (12 tests: all-present, each variable missing/blank, and a
  no-secret-leak assertion). `npx vitest run src/publish` from `social/`: 12/12 green. `npx tsc --noEmit`
  clean. T02 (`storage.ts`) is next and will construct the actual R2 client from this config.
- [x] T02: Implement R2 upload with explicit contentType and deterministic keys. Acceptance: a unit test with a
  mocked client asserts contentType is always set.
  Done: added `social/src/publish/storage.ts` — `createR2Client` (builds an `S3Client` with `region: 'auto'` and
  the `https://<accountId>.r2.cloudflarestorage.com` endpoint from `R2Config`), deterministic key builders
  `postKeyFor(date, baseName)` -> `posts/<date>/<baseName>` and `tiktokStagingKeyFor(weekStartDate, baseName)` ->
  `tiktok-staging/<weekStartDate>/<baseName>` as a sibling for T07 to extend, `publicUrlFor` (trims exactly one
  slash on each side of the join, so it tolerates a trailing slash on `publicBaseUrl` and/or a leading slash on
  `key` without doubling or dropping the separator), `contentTypeFor` (maps `.mp4`/`.jpg`/`.jpeg`/`.json`/`.txt`,
  throws by name on anything else rather than falling back to `application/octet-stream`), and `uploadObject`/
  `uploadFile`, both of which declare `contentType` as a required field (not optional-with-default) and also
  check it at runtime, throwing on blank/whitespace-only before ever calling `client.send`. Added
  `@aws-sdk/client-s3` to `social/package.json` (R2 is S3-compatible; no Cloudflare-specific SDK needed).
  No error message anywhere interpolates a credential — only key/path/extension. Tests in
  `social/src/publish/__tests__/storage.test.ts` (21 tests, dependency-injected fake `S3Client`, `node:fs/promises`
  mocked for `uploadFile`): every `uploadObject`/`uploadFile` call asserts `ContentType` is present on the
  `PutObjectCommand` input, blank/whitespace contentType throws before `send` is called, `contentTypeFor` covers
  each known extension plus an unknown-extension throw, key builders are asserted pure/deterministic across
  repeated and varying inputs, and `publicUrlFor` is covered for trailing-slash-base / leading-slash-key / both /
  neither. `npx vitest run src/publish`: 33/33 green (12 pre-existing `env.test.ts` + 21 new). `tsc --noEmit`
  clean. T03/T04 (token management) are next and are the first callers likely to need a real (non-mocked) R2
  round-trip once T01's live provisioning happens.
- [x] T03: Write token tests — refresh near expiry; persist before use; a crash between the two does not orphan the
  account; expiry inside 30 days raises an alert. Acceptance: tests fail against an empty implementation.
  Done: added `social/src/publish/tokens.ts` — real exported signatures (`Platform`, `StoredToken`, `TokenStore`
  with `get`/`set` where `set` is documented as an atomic write-back for T04's Firestore implementation to honor,
  `needsRefresh(token, now)`, `RefreshFn`, `ensureFreshToken({ store, platform, now, refresh })`,
  `expiryAlert(token, now)`, plus exported threshold constants `REFRESH_WINDOW_MS` (7 days),
  `MIN_REFRESH_AGE_MS` (24h, the Instagram refresh-eligibility floor from the plan Constraint), and
  `EXPIRY_ALERT_WINDOW_MS` (30 days, per the plan Constraint)) — every body throws `Error('not implemented')` so
  T04 fills them in. No `Date.now()` anywhere; every function takes `now: string` (ISO 8601) explicitly, matching
  `pilot-config.ts`'s determinism policy. Added `social/src/publish/__tests__/tokens.test.ts` (20 tests, in-memory
  fake `TokenStore` with injectable `onSet`/`setDelayMs`/`setRejection` hooks, no network/no live API): refresh
  fires inside `REFRESH_WINDOW_MS` of expiry and not outside it (with boundary cases); the >=24h age floor wins
  over imminent expiry (a token near expiry but younger than 24h is asserted NOT refreshed, and the conflicting
  case is asserted explicitly) while a token exactly at the 24h floor IS refreshed; the critical persist-before-use
  case is proven by recording an event sequence (`refresh resolved` -> `store.set called` -> `caller received
  result`) through an artificially delayed fake `store.set`, so the test fails a real fire-and-forget
  implementation, not just a missing call; the crash case rejects `store.set` after a successful `refresh` and
  asserts both that the specific write-failure error propagates unchanged to the caller (not a token) and that
  `store.get` still returns the OLD token afterward, i.e. the account is not orphaned; `expiryAlert` is covered at,
  just inside, and just outside the 30-day boundary and for an already-expired token; a dedicated `console.*`-spy
  suite asserts no token value is ever passed to `console.log/warn/error/info/debug` or embedded in a thrown
  error's message, across both the successful-refresh and crash paths. `npx vitest run
  src/publish/__tests__/tokens.test.ts`: 20/20 FAIL (every failure is either the explicit "not implemented" throw
  or an assertion mismatch caused by it — no TypeScript/module-resolution errors), which is the correct RED state
  for this task. `npx tsc --noEmit -p social/tsconfig.json`: clean. T04 is next: implement the bodies in
  `tokens.ts` plus a Firestore-backed `TokenStore` per the plan's Files list, and get this suite to 20/20 green
  without changing its assertions.
- [ ] T04: Implement token management in Firestore with atomic write-back. Acceptance: T03 passes.
- [ ] T05: Implement the Instagram adapter — container, poll, publish; retry on error 2207052 media-fetch failures.
  Acceptance: a live test post succeeds and is publicly visible.
- [ ] T06: Implement the YouTube adapter — resumable upload with exponential backoff on 5xx and 308-resume support,
  `privacyStatus: private`, plus the required status fields. Acceptance: a live test upload appears in Studio ready
  to flip.
- [ ] T07: Implement TikTok manual staging — write the week's MP4s and a captions file to a dated R2 folder and send
  a manifest with direct links, plus that week's YouTube video IDs awaiting a flip, so one session covers both
  platforms. Acceptance: a run produces 14 videos, their captions, and the pending flip list.
- [ ] T08: Build the daily job — read schedule, render, upload, publish, log, alert. A failure on one platform must
  not stop the other. Acceptance: a dry-run completes and logs per-platform outcomes.
- [ ] T09: Write the Dockerfile — Node, ffmpeg, Chromium deps, and Literata + DM Sans installed system-wide.
  Acceptance: the image renders a video via `docker run`.
- [ ] T10: Deploy the Cloud Run Job and the Firebase trigger, scheduled off the hour. Acceptance: a scheduled run
  executes end to end in the cloud.
- [ ] T11: Build the attribution redirect — `web/src/routes/go/[slug]/+server.js`, slugs `/go/ig`, `/go/tt`,
  `/go/yt`. Log the click server-side, then 302 (never 308, so destinations stay changeable) to
  `https://thinkplain.ai/?utm_source=<platform>&utm_medium=organic-social&utm_campaign=stoic-pilot&utm_content=<format>`.
  In-app browsers strip referrers, so the UTM is the only reliable signal. Acceptance: an e2e test asserts a 302 with
  the correct Location and a recorded click.
- [ ] T12: Implement automated collection for Instagram and YouTube against one shared row schema — platform,
  format, publish time, views, average percent watched, likes, comments, shares, saves, follows. (No opening
  variant column — the opening comparison was CANCELLED outright, social pilot 02a T17.)
  Instagram: per-media insights plus a daily account-level follower series. YouTube: Data API `statistics` for
  counts, Analytics API `reports.query` for `engagedViews`, `averageViewPercentage` and `subscribersGained` per
  video, reusing the upload OAuth with the analytics read scope added. Poll for 30 days after publication, since
  metrics keep accruing. Acceptance: a run appends a dated file with one row per live post, and re-running is
  idempotent rather than duplicating rows.
- [ ] T13: Settle TikTok collection with a SPIKE before building it — attempt the Display API `video.list` against
  the pilot account with an unaudited app and record what it actually returns. Automate it if it works; fall back to
  hand entry in the same schema during the weekly session if it does not. Either way, retention stays manual.
  Timebox this — the manual fallback is ~14 rows a week inside a session that already happens, so it is not worth an
  open-ended integration. Acceptance: a written finding, and either a working collector or a documented fallback.
- [ ] T14: Implement the viability readout — per platform, the median, the maximum, the max/median ratio, the
  week-1-vs-week-4 median trend, follow conversion (exact on YouTube, inferred from daily deltas on Instagram and
  TikTok — label which is which), and the top 5 posts with their format. State plainly whether the
  pre-registered criterion was met. Acceptance: over synthetic data with an injected outlier, the readout correctly
  reports a breakout — and correctly reports NO for an outlier with no conversion and no trend.
- [ ] T15: Write `docs/SOCIAL_PILOT.md` — the runbook. Must cover account creation hygiene (separate email, created
  manually on a real device, phone verified, distinct handle and bio, no follow/like/comment automation, no
  delete-and-repost); the weekly session covering TikTok scheduling, the YouTube flip and any metrics T13 left
  manual; the pre-registered
  criterion; and what to do if the Meta account is disabled. Acceptance: someone else could run the pilot from this
  document alone.
- [ ] T16: At ~4 weeks, write the findings into the same doc: did anything break out, which format, and the
  recommendation — build on what worked, or stop. Acceptance: a stated yes-or-no with the numbers behind it.

## Verify
```
npm test --prefix social
npm test
npm run test:e2e --prefix web
npx tsx social/src/job.ts --date 2026-09-01 --dry-run
```
