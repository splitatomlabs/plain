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
- [x] T04: Implement token management in Firestore with atomic write-back. Acceptance: T03 passes.
  Done: filled in `social/src/publish/tokens.ts`'s three stubbed bodies. `needsRefresh` is a pure expiry-window
  check (`expiresAt - now <= REFRESH_WINDOW_MS`, inclusive). `ensureFreshToken` loads the current token (throwing
  by platform name, never by value, if none exists), returns it unchanged when `needsRefresh` is false OR when the
  token is near expiry but younger than `MIN_REFRESH_AGE_MS` (the age floor wins over imminent expiry, matching the
  plan's Instagram refresh-eligibility rule), and otherwise calls `refresh(current, now)` then `await`s
  `store.set(platform, refreshed)` to completion BEFORE returning the refreshed value — a rejecting `set` propagates
  unchanged and the refreshed token never reaches the caller, leaving the old record as whatever the store still
  holds. `expiryAlert` fires inclusively at the 30-day `EXPIRY_ALERT_WINDOW_MS` boundary. No `Date.now()` anywhere;
  no token value is ever interpolated into a log or thrown error (both already held true before T04 and stayed that
  way — the only string interpolated into a new error is the platform name in the "no stored token" case). Also
  added `createInMemoryTokenStore` to `tokens.ts` (a plain `Map`-backed `TokenStore`, same `get`/`set` shape as the
  test file's local fake) for T08's dry-run job, per this task's brief, rather than inventing a second shape.
  Added `social/src/publish/token-store-firestore.ts` — `createFirestoreTokenStore` (constructs a `Firestore` client
  with NO explicit credentials, relying on Application Default Credentials — the same identity the Cloud Run Job,
  T10, will run under — or accepts an injected client/collection override), one document per `Platform` keyed by
  its name. `set` uses `client.runTransaction` rather than a plain `.set()`: the header comment documents why —
  two overlapping runs (a retried trigger racing the previous run, or a manual refresh script alongside the daily
  job) could both refresh the same near-expiry token and race to persist; because Instagram invalidates the OLD
  token once a refresh succeeds server-side, an unconditional last-write-wins `set()` would silently orphan
  whichever of the two refreshed values loses the race — the same failure shape as the crash-between-refresh-and-
  persist case `tokens.test.ts` covers, just triggered by concurrency instead of a process crash. Added
  `@google-cloud/firestore` to `social/package.json` and installed it. `token-store-firestore.ts` has no dedicated
  unit test (thin adapter over a third-party client; the logic under test already lives in `tokens.ts`) but
  type-checks cleanly. `npx vitest run src/publish` (from `social/`): 53/53 green (12 `env.test.ts` + 20
  `tokens.test.ts`, unmodified from T03 + 21 `storage.test.ts`). `tsc --noEmit -p social/tsconfig.json`: clean.
  T05 (Instagram adapter) is next and is the first real consumer of `ensureFreshToken`/`createFirestoreTokenStore`.
- [!] T05: Implement the Instagram adapter — container, poll, publish; retry on error 2207052 media-fetch failures.
  Acceptance: a live test post succeeds and is publicly visible.
  DEFERRED — the live half of the acceptance (a real post, publicly visible) needs an Instagram account and Meta
  app credentials this session does not have. Built and unit-tested the adapter itself; the by-hand live post is
  left for the user once T01's live R2 provisioning and a Meta app/account exist.
  Done: added `social/src/publish/instagram.ts` — `publishToInstagram(config, mediaUrl, caption, mediaKind,
  fetchFn?, sleep?)` runs container -> poll `status_code` -> publish against the Graph API
  (`DEFAULT_GRAPH_API_BASE_URL = 'https://graph.facebook.com/v21.0'`, overridable per-call for tests). `mediaKind:
  'reel'` sends `video_url` + `media_type: 'REELS'`; `'image'` sends `image_url` with no `media_type` (Graph API
  default). Polling (`pollContainerUntilFinished`) checks `status_code` once a minute (`POLL_INTERVAL_MS`) up to
  `POLL_MAX_ATTEMPTS = 5` ("max 5 minutes" per the plan Constraint), returning on `FINISHED`, throwing immediately
  (surfacing Meta's `status_msg`) on `ERROR`/`EXPIRED`, and throwing a distinct timeout error rather than looping
  forever if it never reaches a terminal state within the bound. `sleep` is an injected `SleepFn` (default
  `realSleep`, a real timer) so tests run the whole 5-poll loop with zero real waiting. Error `2207052` (transient
  media-fetch failure) is retried at CONTAINER CREATION ONLY, with doubling backoff, bounded at
  `CONTAINER_CREATE_MAX_ATTEMPTS = 4` total attempts — polling and publish are never retried on this code, since a
  failed fetch means no container exists yet to poll or publish. Error code `4` (rate limit) is deliberately NOT
  retried at all — wrapped in a distinctly-worded `InstagramApiError` that names it a rate limit and says it is
  giving up for this run, quoting the plan's "4800 x Number of Impressions" Constraint in the message, so a caller
  backs off instead of retry-storming a brand-new account. Every other Graph-API error code fails immediately, no
  retry. Never logs `config.accessToken`: every Graph API call goes through `access_token` as a query parameter
  (Meta's own convention for both GET and POST), and any function that might mention "the URL it called" in an
  error goes through `redactUrl` first, which replaces `access_token`'s value before the URL can reach a log line
  or thrown error. Noted in the header that a finished-but-unpublished container expires after 24h and a caller
  persisting a bare container id across restarts must not resume publishing against one older than that — it
  should call `publishToInstagram` fresh instead. `fetchFn` defaults to `globalThis.fetch`, fully injectable.
  Added `social/src/publish/__tests__/instagram.test.ts` (13 tests, mocked `fetchFn`/`sleep`, no real network call
  anywhere): happy path asserts the exact 4-call container/poll/poll/publish sequence and endpoint/param shape for
  both `'reel'` and `'image'`; polling is covered for `FINISHED`, `ERROR`, `EXPIRED`, and the 5-attempt bound
  (asserting the exact call count so a 6th poll or a stray publish call would fail the test); `2207052` is covered
  both for a later-attempt success and for exhausting `CONTAINER_CREATE_MAX_ATTEMPTS`; rate-limit code `4` is
  covered for a single-call, zero-sleep, zero-retry failure and for the message's wording; a dedicated
  console-spy suite asserts the access token never appears in a thrown error's message or any `console.*` call
  across a generic error, a non-JSON/non-OK HTTP failure, the rate-limit path, and the polling-timeout path.
  `npx vitest run src/publish` (from `social/`): 66/66 green (12 `env.test.ts` + 20 `tokens.test.ts` + 21
  `storage.test.ts`, all unmodified, + 13 new `instagram.test.ts`). `tsc --noEmit -p social/tsconfig.json`: clean.
  T06 (YouTube adapter) is next. Follow-up for whoever closes T05's live half: once a Meta app/account exists,
  run one real `publishToInstagram` call against a test R2 asset and confirm the post is publicly visible before
  T08 (the daily job) depends on this in production.
- [!] T06: Implement the YouTube adapter — resumable upload with exponential backoff on 5xx and 308-resume support,
  `privacyStatus: private`, plus the required status fields. Acceptance: a live test upload appears in Studio ready
  to flip.
  DEFERRED — the live half of the acceptance (a real upload appearing in Studio) needs YouTube/Google OAuth
  credentials this session does not have. Built and unit-tested the adapter itself; the by-hand live upload is left
  for the user once a Google Cloud OAuth app (published to "In production" — see the header note below) and channel
  credentials exist.
  Done: added `social/src/publish/youtube.ts` — `uploadVideoToYouTube(options)` runs the two-step resumable-upload
  protocol end to end: (1) POST to `DEFAULT_UPLOAD_BASE_URL` (`https://www.googleapis.com/upload/youtube/v3/videos`)
  with `uploadType=resumable&part=snippet,status&notifySubscribers=false` and the metadata JSON body
  (`X-Upload-Content-Length`/`X-Upload-Content-Type` headers), reading the session URI from the `Location` response
  header (never the body); (2) PUTs the bytes to that session URI. `privacyStatus: 'private'` and
  `selfDeclaredMadeForKids: false` come from a private `REQUIRED_STATUS` constant, never a caller-supplied option —
  `UploadVideoOptions` exposes NO privacy field at all, so a caller cannot accidentally publish public even via an
  `as any` cast (proved by a dedicated test). `notifySubscribers=false` is sent as a QUERY PARAMETER on the
  initiate call, not a body field, per the plan Constraint that it defaults to TRUE. 308 Resume Incomplete is
  handled by `bytesReceivedFromRangeHeader` (exported, independently unit-tested): parses the inclusive end byte
  from `Range: bytes=0-262143` and returns 262144 (the off-by-one the task called out explicitly), or 0 when the
  header is absent. A 308 that reports forward progress resumes immediately with a correct
  `Content-Range: bytes <start>-<end>/<total>` header and no sleep; a 308 reporting NO progress backs off
  exponentially (`RETRY_BASE_DELAY_MS` doubling) before retrying the same offset, bounded at `UPLOAD_MAX_ATTEMPTS`
  (5) total PUT attempts. A 5xx during the PUT also backs off, then queries status per the protocol (PUT
  `Content-Range: bytes */<total>` with an empty body) to learn how many bytes actually landed before resuming; if
  that status probe is itself inconclusive (e.g. also 5xx), the probe's failure is swallowed and the same offset is
  retried on the next bounded attempt rather than treated as fatal. A 4xx at either step fails immediately, no
  retry, no probe. `video` accepts either an in-memory `Buffer` or `{ filePath }` (read via `node:fs/promises`).
  Never logs `config.accessToken`: it is sent only as an `Authorization: Bearer` header (never a URL query
  parameter, unlike Instagram, so there is no URL to redact), and no thrown error interpolates a token, header, or
  full request — only HTTP status codes and whatever body YouTube itself returned. The header comment carries an
  "OPERATOR NOTE" quoting the plan Constraint that the OAuth app must be published to "In production" or refresh
  tokens expire every 7 days and the weekly cron dies — placed there so whoever debugs a dead weekly cron finds it
  in the file they're already looking at. Also notes `#Shorts` is not required (Shorts classification is automatic
  from aspect ratio/duration) so this module adds no such tag. `fetchFn`/`sleep` both injectable, defaulting to the
  real global `fetch` and a real timer. Added `social/src/publish/__tests__/youtube.test.ts` (24 tests, mocked
  `fetchFn`/`sleep`, no real network call anywhere): happy path asserts the exact initiate-then-PUT sequence,
  header/body shape, and the file-path video-source case; a dedicated suite proves `notifySubscribers=false`,
  `privacyStatus: 'private'`, and `selfDeclaredMadeForKids: false` are always sent and cannot be overridden even by
  smuggling extra fields into the options object; `bytesReceivedFromRangeHeader` is covered directly for the exact
  262143->262144 boundary, a missing header, a non-zero-start range, and an unparseable header; 308-resume is
  covered for a mid-file boundary (asserting the exact `Content-Range` of the follow-up PUT), a missing-Range-header
  case (resumes at 0), a no-progress case (asserts increasing backoff via `sleep` call arguments), and exhausting
  `UPLOAD_MAX_ATTEMPTS` on persistent no-progress; 5xx is covered for session initiation (retry-then-succeed and
  exhaustion), for byte upload (retry-via-status-probe-then-succeed, a probe revealing the upload actually finished,
  and exhaustion when both the PUT and the probe keep failing); 4xx is covered at both steps with an exact
  zero-retry call count; a console-spy suite asserts the token never appears in a thrown error's message or any
  `console.*` call across a 4xx, an exhausted-5xx, and an exhausted-no-progress-308 path. `npx vitest run
  src/publish` (from `social/`): 90/90 green (12 `env.test.ts` + 20 `tokens.test.ts` + 21 `storage.test.ts` + 13
  `instagram.test.ts`, all unmodified, + 24 new `youtube.test.ts`). `tsc --noEmit -p social/tsconfig.json`: clean
  (required one accommodation unrelated to this module's logic: casting a `Buffer` PUT body to `BodyInit`, since
  lib.dom's `BodyInit` type loaded alongside `@types/node`'s `Buffer` type does not structurally recognize it — the
  same cast any Node+DOM-typed `fetch` body needs). T07 (TikTok manual staging) is next. Follow-up for whoever
  closes T06's live half: once a Google Cloud OAuth app (published to "In production") and channel credentials
  exist, run one real `uploadVideoToYouTube` call against a test asset and confirm it appears in Studio ready to
  flip before T08 (the daily job) depends on this in production.
- [x] T07: Implement TikTok manual staging — write the week's MP4s and a captions file to a dated R2 folder and send
  a manifest with direct links, plus that week's YouTube video IDs awaiting a flip, so one session covers both
  platforms. Acceptance: a run produces 14 videos, their captions, and the pending flip list.
  Done: the task's own wording carries two discrepancies, both documented in `tiktok-manual.ts`'s header and
  handled as follows. (1) "14 videos" is STALE — it predates `Pf39c2-social-pilot-02a` D02, which collapsed the
  channel to a single Wall post per day, so a week is 7 videos, not 14; `stageTikTokWeek` derives the day count
  from `schedule.slots.length` rather than hard-coding either number (a 3-slot fixture schedule in the test proves
  this — it stages exactly 3, not 7 or 14). (2) No caption generator existed anywhere in this repo — built one.
  Added `social/src/publish/caption.ts` — `buildCaption({ slot, platform })`, pure, no I/O, no `Date.now()`.
  Exports `ATTRIBUTION_URLS` (the T11 slugs: `https://thinkplain.ai/go/tt`/`/go/ig`/`/go/yt` for
  tiktok/instagram/youtube) and `HASHTAGS` (a small fixed set, `#Stoicism #Philosophy #PlainEnglish`, deliberately
  excluding `#Shorts` since the plan Constraint says YouTube classifies Shorts automatically from aspect ratio and
  duration). The caption body is the card's own verbatim `landing_line`, a factual "— Author, Book" attribution
  line (framing text, never attributed to the author, per Constraint 6's ruling), the platform's attribution link
  under a plain "Read it plain:" lead-in, then the hashtags — no hype copy, no emoji-stacking, matching the index
  plan's tone constraint ("calm, direct, warm-not-soft, second person, never clickbait"). Author/book display names
  come from small local lookup tables (`AUTHOR_DISPLAY_NAMES`, mirroring `render/theme.ts`'s three `ACCENTS` keys;
  `BOOK_DISPLAY_NAMES`, mirroring `scripts/lib/constants.ts`'s `BOOK_CONFIGS` titles) with a humanized-slug
  fallback for anything not yet in the table, rather than throwing — a caption is cosmetic copy, not a
  correctness-critical path. Added `social/src/publish/tiktok-manual.ts` — `stageTikTokWeek({ client, config,
  schedule, outDir, pendingYouTubeFlips })` resolves every slot in an already-loaded `WeekSchedule` to its rendered
  MP4 via `renderAssetPaths` (`cli-plan.ts`) and `weekDayToDate` (`pilot-config.ts`), checks every day's MP4 exists
  on disk (via `existsSync`, mirroring `cli.ts`'s own use of it) BEFORE uploading anything — a run either stages
  the whole week or nothing, and the thrown error names every missing date plus its expected path. Uploads each
  MP4 to `tiktokStagingKeyFor(weekStartDate, baseName)` and a single `captions.txt` (human-readable, one block per
  day separated by a rule — chosen over `.json` because the weekly session is a person reading captions off a
  screen while manually pasting them into TikTok's app, per the plan's "~20 min/week, manual" Decision; the
  structured version of the same data is still available via the returned manifest's `days[].caption`). Every
  upload goes through `contentTypeFor` (never a hand-picked type) and only ever touches `config`/`client` through
  `storage.ts`'s already-audited `uploadFile`/`uploadObject` — nothing in this module reads `accessKeyId`/
  `secretAccessKey` directly. `pendingYouTubeFlips` (a new exported `PendingYouTubeFlip[]` type: date, card id,
  YouTube video id) is accepted as a plain input parameter, not read from Firestore or any other store — T08 (the
  daily job) is the one place that uploads to YouTube and learns a real video id, and is expected to accumulate the
  week's ids and pass them in once a week; this module just carries them through onto the returned
  `TikTokWeekManifest`. Added `social/src/publish/__tests__/caption.test.ts` (13 tests: landing line verbatim,
  author/book present, the correct `/go/<platform>` link per platform and never another platform's, the fixed
  hashtag set present and `#Shorts` absent, no hype punctuation/emoji, determinism, the humanized-fallback path,
  and distinct captions for distinct slots) and `social/src/publish/__tests__/tiktok-manual.test.ts` (11 tests,
  mocked `S3Client` per `storage.test.ts`'s convention plus `node:fs`/`node:fs/promises` mocked for the existence
  check and the underlying `uploadFile` read: a real 7-slot week schedule stages exactly 7 videos/7 captions/the
  passed-through pending-flip list; a 3-slot fixture schedule proves the count comes from the schedule, not 7 or
  14 hard-coded; each day resolves to the exact `renderAssetPaths`/`weekDayToDate` path and its manifest URL
  matches `publicUrlFor`; a missing day's MP4 fails naming that exact date, and zero uploads happen in that case
  (proving the whole-week-or-nothing ordering); every uploaded object carries an explicit content-type
  (`video/mp4` x7, `text/plain` x1); the captions link matches `publicUrlFor`; every key lands under the same
  `tiktok-staging/<weekStartDate>/` folder; and a console-spy suite over the failure path asserts neither
  `accessKeyId` nor `secretAccessKey` ever appears in a logged or thrown value). `npx vitest run src/publish` (from
  `social/`): 114/114 green (90 pre-existing, unmodified + 13 `caption.test.ts` + 11 `tiktok-manual.test.ts`). Full
  `npx vitest run` (social/): 412/412 green. `tsc --noEmit -p social/tsconfig.json`: clean. T08 (the daily job) is
  next and is the first real caller of `buildCaption`'s other two platforms and the producer of
  `PendingYouTubeFlip[]` this module consumes.
- [x] T08: Build the daily job — read schedule, render, upload, publish, log, alert. A failure on one platform must
  not stop the other. Acceptance: a dry-run completes and logs per-platform outcomes.
  Done: added `social/src/job.ts` (orchestration) and `social/src/job-plan.ts` (pure decision logic, mirroring the
  `cli.ts`/`cli-plan.ts` split). `runJob` resolves `--date` -> schedule slot -> render -> upload every rendered
  asset to R2 -> publish independently to Instagram and YouTube. REUSES `cli.ts`'s render path rather than
  duplicating it: `renderCommand` and `loadWeekSchedule` are now `export`ed from `cli.ts` (the only change to that
  file — everything else is untouched and its own 16-test suite, including the real end-to-end render test, stays
  green), and `job.ts`'s default `render`/`loadSchedule` dependencies import them via a DYNAMIC `await
  import('./cli.js')` rather than a top-level import, specifically so importing `job.ts` (as `job.test.ts` does,
  with `render` itself injected) never pulls in `@remotion/bundler`/`@remotion/renderer` — confirmed by `job.test.ts`
  running in ~10ms rather than the 10s+ a real Remotion bundle takes. The plan's Decision ("assets are uploaded to
  R2 before any post is attempted") is enforced structurally: both the video and the Instagram feed still finish
  uploading before either publish call starts — no code path publishes first — and a dedicated ordering test asserts
  this via a recorded call sequence, not by inspecting the implementation's shape.
  PLATFORM ISOLATION (the acceptance criterion): each platform's whole sequence (token refresh -> publish ->
  bookkeeping) is wrapped in its own try/catch that always resolves to a `PlatformOutcome`, never rejects, and both
  are run under `Promise.allSettled` rather than a bare `Promise.all` over the raw publish calls — the header comment
  explains why that distinction matters (a bare `Promise.all` can abandon the still-in-flight other platform's
  promise on the first rejection). Two tests prove both directions (Instagram failing does not stop YouTube, and
  vice versa) by asserting the OTHER platform's publish mock was still called and its outcome still reported, with
  the job's own exit code reflecting failure only once both were attempted.
  TOKENS: `ensureFreshToken`/`expiryAlert` (`tokens.ts`, unmodified) are called per platform before publishing, with
  the alert (if any) logged as a `WARN` line. No real OAuth refresh endpoint exists anywhere in this codebase yet —
  T05/T06 deliberately scoped to publish/upload only — so `notImplementedRefresh` is the default `JobDeps.refresh`,
  throwing a clearly-named error rather than silently no-op'ing; a real implementation is a documented follow-up, not
  guessed here. Never logs a token: every log line and `PlatformOutcome.message` is built from a fixed string, a
  card id/date, or `errorMessage(error)` — and every error this file can catch already comes from a module
  independently audited (T03-T06) to never put a token value in a thrown message. A dedicated test forces both
  publish calls to fail and asserts neither token value appears in any log line or outcome message.
  PENDING YOUTUBE FLIPS: recorded to a plain JSON file, `content/social/pending-youtube-flips.json` (NOT Firestore —
  the header comment justifies this: Firestore already holds the one genuine secret needing atomic, access-
  controlled storage, but a `{date, cardId, videoId}` list is neither secret nor concurrently written, and a
  committed-JSON file stays `git diff`-able during the weekly session the same way `pilot-schedule-w<NN>.json`
  already is). Reuses T07's own `PendingYouTubeFlip` type from `tiktok-manual.ts` rather than redefining it.
  `upsertPendingFlip` (`job-plan.ts`) replaces same-date entries instead of duplicating them on a re-run.
  `--dry-run`: renders for REAL (the task's own wording, "does everything up to and including render") but performs
  NO uploads, NO token operations, and NO posts — `runJob` returns immediately after logging one `'dry-run'`
  `PlatformOutcome` per platform. Every default dependency that would need a credential
  (`createDefaultUploadAsset`/`createDefaultTokenStore`/`createDefaultInstagramAccountConfigLoader`) is a closure
  that defers its `loadR2Config()`/`new Firestore()`/`process.env` read until first ACTUALLY called — never at
  `JobDeps` construction — so building the whole dependency set at the top of `main()` never throws even with zero
  credentials set, and the dry-run path never calls any of them at all. Verified live: `npx tsx social/src/job.ts
  --date 2026-09-01 --dry-run` with every R2/Instagram/YouTube env var explicitly unset completes with exit code 0,
  performs a real Remotion render, and logs `[instagram] DRY-RUN` / `[youtube] DRY-RUN` lines naming exactly what
  each platform would have done.
  Determinism: `--date` is the only source of scheduling decisions (`dateToWeekDay`/`resolveDay`, both pure). The ONE
  wall-clock read in the whole file (`new Date().toISOString()` in `main()`) is used only for token-freshness
  decisions and reused verbatim for that run's log-line timestamps — clearly commented at its single call site, per
  this task's own requirement.
  Logging: structured `[platform] STATUS — message` lines (`job-plan.ts`'s `formatOutcomeLine`) plus INFO/WARN/ERROR
  lines, written to both the console and a per-day append-only file, `content/social/job-logs/job-<date>.log`, in
  the spirit of `content/pipeline/<slug>/pipeline.log` (CLAUDE.md's "Pipeline logs" section) — `*.log` is already
  gitignored, so these never land in version control.
  `--help` documents `--date`/`--out`/`--schedule-dir`/`--pending-flips-file`/`--dry-run`, matching `cli.ts`'s style.
  Tests: `social/src/__tests__/job.test.ts` (13 tests, every collaborator injected — no network, no Firestore, no
  Remotion render, no credentials) covering platform isolation (both directions, the single most important test),
  upload-before-publish ordering, dry-run's zero-uploads/zero-posts/two-outcomes behavior, token refresh + expiry
  alert surfacing, the no-token-leak guarantee (including on the failure path), and pending-flip recording/non-
  recording. `social/src/__tests__/job-plan.test.ts` (17 tests) covers the pure helpers directly: YouTube title
  truncation at the exact boundary, caption/description delegation to `caption.ts`, exit-code combination, outcome/
  alert line formatting, and pending-flip parse/serialize/upsert (including the same-date replacement rule).
  `npx vitest run` (social/): 442/442 green (412 pre-existing, unmodified + 13 `job.test.ts` + 17 `job-plan.test.ts`).
  `tsc --noEmit -p social/tsconfig.json`: clean. T09 (the Dockerfile) is next — the first task this render pipeline
  needs a container for at all.
- [!] T09: Write the Dockerfile — Node, ffmpeg, Chromium deps, and Literata + DM Sans installed system-wide.
  Acceptance: the image renders a video via `docker run`.
  DEFERRED — the live half of the acceptance (a real `docker run` rendering a video) needs Docker,
  which this session did not have available; live builds/deploys were also out of scope per the
  session's own instructions. Wrote and verified `social/Dockerfile` by reading every module it
  depends on (`render/fonts.ts`, `render/card.ts`, `remotion/register-fonts.ts`, `render/encode.ts`,
  `job.ts`, `cli.ts`, `remotion/wall-pool.ts`, `audio/beds.ts`), not by a live build. The by-hand
  `docker build`/`docker run` is left for the user — exact commands in `social/DOCKER.md`.
  Done: `node:24-bookworm-slim` (Debian, matching the dev machine's Node 24 and CLAUDE.md's
  guidance to prefer glibc over Alpine for Remotion/Chromium/`ffmpeg-static`). Build context is the
  REPO ROOT, not `social/` — `content/output/` and `content/social/` sit outside `social/` and
  Docker `COPY` cannot reach outside its context — documented in both the Dockerfile header and
  `social/DOCKER.md`. KEY FINDING acted on: per `render/fonts.ts`'s own header comment, this
  workspace does NOT depend on system fonts — Literata/DM Sans are base64-inlined from
  `@fontsource-variable/*` npm packages for both the Playwright still renderer and the Remotion
  bundle, so the real dependency is an un-pruned `social/node_modules` (`npm ci`, full install, no
  `--omit=dev` — `tsx`, the entrypoint interpreter, is itself a devDependency, so an omit-dev
  install would break the entrypoint; documented loudly in-line to stop a future edit from adding
  `NODE_ENV=production`). The system-wide font install is still done (per this task's own ask) but
  explicitly as belt-and-braces: `fc-cache`-registers the SAME two `.woff2` files `npm ci` already
  fetched (no Debian package exists for either family, so this is a `cp` + `fc-cache`, not `apt`).
  BROWSERS: two separate ones, handled separately. Playwright's own Chromium
  (`render/card.ts`'s feed-still renderer) via `npx playwright install --with-deps chromium`
  (`--with-deps` installs the exact Debian shared-library set for whatever Chromium build Playwright
  is pinned to, rather than a hand-maintained apt list that would drift), into a fixed
  `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` (user-independent, since build runs as root but the
  final image runs as non-root). Remotion's SEPARATE "Chrome Headless Shell" via
  `remotion browser ensure` at BUILD time (not left to download on first render, per this task's
  explicit instruction) — this one resolves its cache directory from `process.cwd()` at call time
  (a real `getDownloadsCacheDir()` walk-up to the nearest `package.json`), not from any file's disk
  location, so the Dockerfile copies the repo ROOT `package.json` into `/app` (existence only,
  content irrelevant) and runs both the build-time `ensure` and the runtime entrypoint from WORKDIR
  `/app` — same cwd, same resolved path, both times. Documented as the one genuine footgun in this
  file's header comment (get the cwd wrong and every cold start re-downloads a browser).
  FFMPEG: deliberately NOT installed via apt — `render/encode.ts` already resolves `ffmpeg-static`/
  `ffprobe-static`'s platform-matched STATIC binaries via `createRequire`, which `npm ci` fetches
  correctly as long as the image is built for the right platform/arch (`social/DOCKER.md` pins
  `--platform linux/amd64`, matching Cloud Run); a system ffmpeg would be unreached dead weight,
  justified in-line rather than installed "to be safe" per this task's own instruction not to.
  NON-ROOT USER: `appuser`, chosen over root — not just "least privilege by preference" but load-
  bearing here: Chromium refuses to initialize its own sandbox as EUID 0, and
  `render/card.ts`'s `chromium.launch()` call passes no args to disable it, so root would hard-crash
  the feed-still render without an out-of-scope code change. Remotion's own browser launch is
  unaffected either way — `open-browser.js` unconditionally passes `--no-sandbox` itself already
  (confirmed by reading it), root or not. Flagged a known follow-up rather than guessing: Cloud
  Run's gVisor sandbox is documented to not fully support the namespace syscalls Chromium's sandbox
  needs even for non-root — if T10 hits this live, the fix is a one-line `args: ['--no-sandbox']`
  addition to `card.ts`'s launch call, deliberately not made pre-emptively here since it's unverified
  whether Cloud Run actually hits it. `--date` stays a pure runtime argument
  (`ENTRYPOINT ["npx","tsx","social/src/job.ts"]`, `CMD ["--help"]` as a safe no-args default) —
  never baked in, so T10's Cloud Run Job can vary it per scheduled invocation.
  Added `social/.dockerignore` (this task's named deliverable) plus a REPO-ROOT `.dockerignore`
  with a header explaining why: Docker resolves `.dockerignore` relative to the build CONTEXT root
  (the repo root, per the directory-layout constraint above), not the Dockerfile's own directory, so
  the root file is the one actually consulted for `docker build -f social/Dockerfile .`; both are
  kept in sync by hand and both exclude `node_modules/`, `social/out/`, and
  `content/social/job-logs/` (a stray real log file from an earlier dry-run in this session
  confirmed this exclusion is not hypothetical) while deliberately NOT excluding
  `content/social/*.json` (the schedules/exclusions `cli.ts`/`job.ts` read at runtime) or
  `content/output/`. Added `social/DOCKER.md` — exact `docker build`/`docker run` commands for the
  dry-run check, a real render, and a real publish (env vars for R2, a mounted ADC file or
  `GOOGLE_APPLICATION_CREDENTIALS` for Firestore token storage, `--date`), plus a troubleshooting
  section cross-referencing the Dockerfile's own comments.
  Verification actually run this session (no docker): `npm test --prefix social` — 442/442 green,
  unmodified by this task. `tsc --noEmit -p social/tsconfig.json` — clean. Neither Dockerfile nor
  `.dockerignore` nor `DOCKER.md` touch any `.ts`/`.tsx` file. Follow-up for whoever closes this
  task's live half: run `social/DOCKER.md`'s build + `--dry-run` command first (needs no
  credentials) before attempting a real publish; if Playwright's Chromium fails under Cloud Run's
  gVisor sandbox specifically (not under a plain local `docker run`), see the Dockerfile's
  "Non-root user" comment for the documented one-line fix. T10 (deploying the Cloud Run Job and
  Firebase trigger) is next and is the first real consumer of this image.
- [!] T10: Deploy the Cloud Run Job and the Firebase trigger, scheduled off the hour. Acceptance: a scheduled run
  executes end to end in the cloud.
  DEFERRED — the live half of the acceptance (a scheduled run actually executing in the cloud)
  needs real GCP/Firebase project access to provision, plus real Instagram/YouTube OAuth tokens
  seeded into Firestore, none of which this session has or was permitted to create (no `gcloud`/
  `firebase`/`vercel`/`wrangler` command was run, no cloud resource was provisioned). Wrote and
  type-checked/tested every reproducible piece; the by-hand deploy is left for the user via
  `social/DEPLOY.md`.
  Done: created the `functions/` Firebase Functions workspace (did not exist before this task) —
  `functions/package.json` (Node 20 runtime target, ESM, `firebase-functions`/`google-auth-library`
  only — no `firebase-admin`, since this trigger never touches Firestore/Auth/anything else
  `firebase-admin` would provide), `functions/tsconfig.json`, `functions/vitest.config.ts`,
  `functions/src/index.ts` (re-exports `socialTrigger`), and `functions/src/socialTrigger.ts` — a
  v2 `onSchedule` function whose header comment quotes the plan's Decision verbatim ("Firebase
  `onSchedule` is a THIN TRIGGER ONLY...") and explains why it does exactly one thing: call the
  Cloud Run Admin API's `jobs.run` REST method (via `google-auth-library`'s `GoogleAuth`, not the
  heavier `@google-cloud/run` client — this function makes exactly one outbound call) to start an
  execution of `plain-social-daily`, with a `containerOverrides.args: ['--date', <date>]` override,
  then returns — no render/upload/publish logic lives here or ever should. `computeTodayInTimezone`
  (exported, pure, takes `now: Date` and `timeZone` explicitly) is the ONE wall-clock read in this
  whole system outside `job.ts`'s own documented one — commented as such, pinned to an explicit
  `PILOT_TIMEZONE = 'America/New_York'` rather than the Cloud Functions runtime's default UTC, so
  "today" always means the pilot audience's calendar day regardless of where the function executes.
  Scheduled at `53 7 * * *` (07:53 America/New_York, i.e. NOT `0 8 * * *`) — commented why: every
  cron on a shared platform that fires on the hour piles into the same minute, which is exactly
  when Cloud Scheduler dispatch latency and the Cloud Run Admin API's own rate limits are worst;
  an off-the-hour minute avoids that thundering herd, per this task's own instruction. `retryCount:
  0` is deliberate, not a default left alone: starting a Cloud Run Job execution is NOT idempotent
  from this system's viewpoint (`job.ts`'s publish steps are not idempotent — a second successful
  `jobs.run` call for the same day would re-render and re-attempt Instagram/YouTube publish,
  risking a duplicate live post), so an automatic retry on a transient trigger failure is the wrong
  tradeoff; a failed start needs a human, per `DEPLOY.md`'s verification section. `timeoutSeconds:
  60`/`memory: '256MiB'` are generous for a function that makes one REST call and returns — nowhere
  near the 540s cap this whole design exists to respect. The trigger runs under its own named
  least-privilege identity (`TRIGGER_SERVICE_ACCOUNT`, a `PROJECT_ID` placeholder matching
  `cloud-run-job.yaml`'s own placeholder convention), never the project's default (broader) compute
  service account. Never logs the access token `GoogleAuth` mints: it is used only as a request
  header value; a non-OK response's body (Cloud Run execution/error metadata, not a credential) is
  surfaced verbatim in the thrown error for debugging.
  Added `functions/src/__tests__/socialTrigger.test.ts` (5 tests, no mocking of the system clock —
  every case passes an explicit `now: Date`): a plain UTC-midday sanity case; the two boundary cases
  that actually justify this file's existence (UTC has rolled past midnight but Eastern time hasn't
  yet, and vice versa — a naive `toISOString().slice(0, 10)` would get the first one wrong); a DST
  case (winter/no-DST offset still resolves the correct previous day); and a determinism check. Did
  NOT add a test for `triggerCloudRunJob` (the REST call itself) — per this task's own instruction,
  it has no branching logic worth testing, only a single outbound request. `npm install --prefix
  functions` (a local install, not a cloud command): 293 packages, clean. `npx tsc --noEmit -p
  functions/tsconfig.json`: clean. `npm test --prefix functions`: 5/5 green.
  Added `social/cloud-run-job.yaml` — the declarative Cloud Run Job config (`gcloud run jobs
  replace social/cloud-run-job.yaml`, not a pile of remembered `gcloud run jobs create` flags).
  Resources are justified in-line rather than maxed out against the plan's 168h/32GiB/8vCPU
  ceiling: `cpu: "2"` / `memory: 4Gi` (comfortably above what one ~59s 1080x1920 render — one
  Playwright Chromium instance for the IG feed still, one Remotion Chrome Headless Shell instance
  for the video, sequential never concurrent per `job.ts`, plus one ffmpeg encode — actually needs,
  without being wasteful spend on a pilot whose point is cheapness), `timeoutSeconds: 900` (15
  minutes — comfortably over the realistic worst case, a full 5-minute Instagram container-poll per
  the plan's own Constraint plus render/upload time, without leaving a stuck run silently billing
  for hours), `maxRetries: 0` (same non-idempotent-publish reasoning as the trigger's
  `retryCount: 0` above — a failed execution needs a human, not an automatic re-post risk). No
  `args:` baked in (falls back to the image's own `CMD ["--help"]` safe default, per
  `social/Dockerfile`) — `--date` arrives only via the trigger's per-execution
  `containerOverrides`, so this file stays date-agnostic. Every credential-shaped env var (the five
  R2 values plus `IG_USER_ID`) is a Secret Manager `secretKeyRef`, never a literal, per the plan's
  Constraint — and the header comment explains why Instagram/YouTube OAuth TOKENS are conspicuously
  absent from this list entirely: they live in Firestore (T04), read via the job's own service-
  account ADC identity, never as an env var of any kind.
  Added `firebase.json` and `.firebaserc` at the repo root (neither existed before — confirmed by
  checking first) — `firebase.json` points `functions.source` at `functions/` with a `predeploy`
  build step; `.firebaserc` has a placeholder project id, clearly named
  `REPLACE_WITH_FIREBASE_PROJECT_ID`, for the user to fill in with `firebase use --add` or a direct
  edit. Extended `.gitignore` with `functions/lib/`, `.firebase/`, and `firebase-debug*.log`.
  Added `social/DEPLOY.md` — the full runbook this task's deliverable C calls for, cross-linked
  from `social/DOCKER.md`: enabling every required API (including the Cloud Scheduler/Eventarc/
  Pub/Sub/Cloud Build APIs a 2nd-gen `onSchedule` function needs under the hood, not just the
  obvious `run.googleapis.com`), creating Firestore if the project doesn't have it yet, creating
  BOTH service accounts with named least-privilege roles (`plain-social-job` gets
  `roles/datastore.user` plus a PER-SECRET `roles/secretmanager.secretAccessor` binding, never a
  project-wide one; `plain-social-trigger` gets a hand-created custom IAM role
  scoped to exactly `run.jobs.run`/`run.jobs.get` on the one job resource, since no predefined role
  is scoped that narrowly — the built-in alternatives, `roles/run.developer`/`roles/run.admin`, are
  both explicitly called out as broader than this trigger needs), creating the six Secret Manager
  secrets, building/pushing the image to Artifact Registry, creating/updating the job from
  `cloud-run-job.yaml`, deploying the function, and — the acceptance criterion itself — exactly
  which logs prove a scheduled run executed end to end: the function's own Cloud Logging output
  (`Starting Cloud Run Job... for <date>` / `...started for <date>`), the Cloud Run execution list
  showing `STATUS: Succeeded`, the execution's own captured stdout showing `job.ts`'s structured
  `[instagram] ok — ...` / `[youtube] ok — ...` lines, and finally the human check that the post is
  actually live on both platforms. Flagged loudly, both at the top of the doc and again at the
  bottom's troubleshooting section, the one real (non-deploy-config) blocker this task cannot
  resolve: no OAuth authorization flow exists anywhere in this codebase yet (T05/T06 scope), so the
  Firestore token documents `ensureFreshToken` requires must be seeded by hand before a real
  (non-`--dry-run`) scheduled run can succeed — a scheduled run failing on `[instagram]
  failed`/`[youtube] failed` naming a missing/expired token is this prerequisite, not a bug in this
  deploy.
  Verification actually run this session (no `gcloud`/`firebase`/`docker`/cloud command of any
  kind): `npm install --prefix functions` (local install only); `npx tsc --noEmit -p
  functions/tsconfig.json` clean; `npm test --prefix functions` 5/5 green; `npm test --prefix
  social` 442/442 green, unmodified by this task; `npx tsc --noEmit -p social/tsconfig.json` clean.
  Follow-up for whoever runs the live deploy: run `social/DEPLOY.md` steps 0-7 in order, seed the
  Instagram/YouTube Firestore token documents by hand (the doc's own top-of-file callout) before
  attempting a non-dry-run scheduled execution, then use step 8 to force one run immediately rather
  than waiting for 07:53 America/New_York to roll around, and confirm both platforms report `ok`
  in the execution logs before considering T10 closed. T11 (the attribution redirect) has no
  dependency on this task and can proceed in parallel.
- [x] T11: Build the attribution redirect — `web/src/routes/go/[slug]/+server.js`, slugs `/go/ig`, `/go/tt`,
  `/go/yt`. Log the click server-side, then 302 (never 308, so destinations stay changeable) to
  `https://thinkplain.ai/?utm_source=<platform>&utm_medium=organic-social&utm_campaign=stoic-pilot&utm_content=<format>`.
  In-app browsers strip referrers, so the UTM is the only reliable signal. Acceptance: an e2e test asserts a 302 with
  the correct Location and a recorded click.
  Done: added `web/src/routes/go/[slug]/+server.js` — a plain-JS `GET` handler (matching this workspace's house
  style, no TypeScript) mapping `ig`/`tt`/`yt` to `instagram`/`tiktok`/`youtube` via an explicit allowlist object,
  never a passthrough. An unknown slug throws `error(404, ...)` rather than redirecting with a missing or
  fabricated `utm_source` — the header comment justifies this against the alternative (silently corrupting the
  aggregate click numbers) and notes every real link is hard-coded in `caption.ts`'s `ATTRIBUTION_URLS`, so a 404
  here only ever means a typo, not a real visitor being turned away. `utm_content` defaults to `wall` (the only
  `PostFormat` left per `render/post-metadata.ts`) and accepts a `?f=` override validated against a local
  `KNOWN_FORMATS` allowlist rather than reflected straight into the redirect URL. Always `throw redirect(302, ...)`
  — never 301/308 — with a comment quoting the plan's reasoning (a permanent redirect gets cached forever, making
  the destination unchangeable) and a second comment flagging that `redirect()` throws rather than returns, per
  this task's own callout. `export const prerender = false` is explicit, matching the pattern in
  `completed/[book]/+layout.js` and `[book]/[chapter]/[card]/+layout.js` — needed because the root `+layout.js`
  defaults `prerender` to `true`, and this route's side effect (the click log) and its per-request unknown-slug
  behavior must never be baked in at build time. The click log is a single structured `console.log(JSON.stringify(...))`
  line with exactly `event`/`platform`/`format`/`at` (an ISO timestamp) — no IP, user agent, referer, or any
  identifier, checked directly against `docs/ANALYTICS.md`'s "aggregate only, nothing identifying a viewer" rule in
  an in-line comment; Vercel captures function stdout as searchable logs on its own, so no separate logging
  service is warranted for a pilot. Added `web/tests/unit/go-redirect.test.js` (9 tests: all three slugs' UTM
  params including `utm_content=wall`, the `?f=` default and an `?f=` injection attempt asserting the value is
  never reflected unchecked, the unknown-slug 404, the exact shape of the logged click including timestamp
  validity, an explicit key-set assertion that nothing beyond `event`/`platform`/`format`/`at` is ever logged, and
  that an unknown slug logs nothing at all) — this suite asserts the URL-building and click-logging logic directly
  by importing `GET` and catching the thrown `Redirect`/`HttpError` objects, since `redirect()`/`error()` throw
  rather than return. Added `web/tests/e2e/attribution-redirect.spec.js` (8 tests across both Playwright projects:
  a 302 with the exact Location for each of the three slugs, plus the unknown-slug 404) using
  `request.get(path, { maxRedirects: 0 })` so the 302 itself is observed rather than followed. Per this task's own
  instruction to say plainly what could not be asserted rather than pretend: the e2e suite does NOT assert the
  click log, because `playwright.config.js`'s `webServer` (`npm run build && npm run preview`) runs as a detached
  child process with no wiring back to an individual test's stdout — the acceptance criterion's "a recorded click"
  is instead covered by the unit suite's direct `console.log` spy, which is the reliable, precise way to assert it
  in this setup; the spec's own header comment says so. `npx vitest run --prefix web` (repeated as `npx vitest run`
  from `web/`): 104/104 green (95 pre-existing, unmodified + 9 new). `npm run build --prefix web`: succeeds,
  `.svelte-kit/output/server/entries/endpoints/go/_slug_/_server.js` present in the output. `npm run test:e2e
  --prefix web`: 196/196 green (188 pre-existing, unmodified + 8 new), both `desktop-chrome` and `mobile-chrome`
  projects. T12 (metrics collection) is next and has no dependency on this task.
- [!] T12: Implement automated collection for Instagram and YouTube against one shared row schema — platform,
  format, publish time, views, average percent watched, likes, comments, shares, saves, follows. (No opening
  variant column — the opening comparison was CANCELLED outright, social pilot 02a T17.)
  Instagram: per-media insights plus a daily account-level follower series. YouTube: Data API `statistics` for
  counts, Analytics API `reports.query` for `engagedViews`, `averageViewPercentage` and `subscribersGained` per
  video, reusing the upload OAuth with the analytics read scope added. Poll for 30 days after publication, since
  metrics keep accruing. Acceptance: a run appends a dated file with one row per live post, and re-running is
  idempotent rather than duplicating rows.
  DEFERRED — the live half (an actual run against real Instagram/YouTube accounts and OAuth tokens) needs
  credentials this session does not have, same status as T05/T06/T09/T10. Built and unit-tested the collector
  itself against mocked APIs; the by-hand live run is left for the user once T05/T06's live halves are closed and
  the YouTube OAuth token has the analytics read scope added (see below).
  Done: added `social/src/metrics/schema.ts` (the one shared row schema — `MetricsRow`: platform, postId, format,
  publishedAt, views, averagePercentWatched, likes, comments, shares, saves, follows, collectedAt — NO `opening`
  field, per the plan's CANCELLED decision), `instagram.ts`, `youtube.ts`, and `collect.ts` (the run entry point),
  plus `__tests__/{schema,instagram,youtube,collect}.test.ts` (47 tests). `content/social/metrics/*.json` is where
  a real run writes (`metrics-<date>.json` plus `instagram-followers.json`) — no fixture files were pre-created
  there, mirroring `job.ts`'s own `content/social/pending-youtube-flips.json`, which also does not exist until a
  real run happens.
  AVAILABLE VS. ZERO: every field that isn't universally available is `number | null`, `null` meaning "not
  available on this platform," never a fabricated `0` — `schema.ts`'s header spells out each case (`saves`:
  Instagram-only; `follows`: YouTube-only per-post, since per-post follow attribution does not exist on Instagram
  per the plan's Decision; `shares`: real on Instagram, `null` on YouTube because pulling it would be scope creep
  beyond the three Analytics metrics this task names; `averagePercentWatched`: `null` on Instagram when a media's
  video duration is unknown, e.g. a still image). Tested explicitly in `schema.test.ts` via a round trip through
  `serializeMetricsRows`/`parseMetricsRows` that a real `0` and a `null` never collapse into each other.
  SOURCE OF "WHICH POSTS EXIST": `collect.ts`'s header works through this at length, since the task named two
  candidates (job.ts's pending-flips file and the metadata sidecars) and asked for a justified pick. For
  YouTube, `content/social/pending-youtube-flips.json` (parsed via `job-plan.ts`'s own `parsePendingFlips`, reused
  not reimplemented) is exactly right — `job.ts`'s own header says it exists because the daily job is "the only
  place that learns a real video id." For Instagram, NEITHER candidate fits: `job.ts` never persists an Instagram
  media id anywhere (only logs it in a `PlatformOutcome.message` string), and extending `job.ts` to do so is
  outside this task's own Files scope; the metadata sidecar is doubly unusable even if it were in scope — it
  lives in the ephemeral, gitignored `--out` render directory, and records only `card_id`/`format`/`rendered_at`,
  never a platform post id for either platform. Given that, `metrics/instagram.ts`'s `listInstagramMedia` treats
  Instagram's own `GET /{ig-user-id}/media` list as authoritative for which Instagram posts exist and when
  (each item already carries its own `timestamp`) — the platform is definitionally never wrong about its own
  publish instant, unlike a local record that could drift.
  INSTAGRAM <100-FOLLOWER GRACEFUL HANDLING: per `plans/research/social-experiment-notes.md` ("IG follower_count
  metric gated at 100 followers" vs. "followers_count (ungated)"), `fetchInstagramFollowerSnapshot` attempts the
  richer, gated `follower_count` Insights metric first and falls back to the ungated `followers_count` field on
  ANY error from that call — this IS the "handle it gracefully rather than failing the run" behaviour the task
  calls for, and it still returns a real, usable number on a brand-new account instead of skipping the day
  entirely. Only re-throws if BOTH calls fail (a genuine outage, e.g. a bad token) — tested directly in
  `instagram.test.ts`, plus an end-to-end version in `collect.test.ts` proving a total follower-snapshot failure
  still leaves that run's per-post rows written.
  YOUTUBE `engagedViews`, NEVER `views`: `youtube.ts`'s `fetchYouTubeVideoInfo` (the Data API call) deliberately
  never reads `statistics.viewCount` at all, not even to discard it — the only view-count-shaped field in the
  whole module is `YouTubeEngagementMetrics.engagedViews`, fetched from the Analytics API. Tested directly: a
  fixture with a deliberately huge, misleading `viewCount` (5,000,000) alongside a small `engagedViews` (300)
  proves the built `MetricsRow.views` is 300, not 5,000,000. `fetchYouTubeEngagementMetrics` matches
  `columnHeaders` by name rather than assuming a fixed column order, and returns real zeros (not an error) when a
  video is too new to have any Analytics data yet. Scope note: `shares` is `null` on every YouTube row, on
  purpose — Analytics does expose a real `shares` metric, but this task's own Constraint names exactly
  `engagedViews`/`averageViewPercentage`/`subscribersGained`, and adding a fourth was treated as scope creep
  rather than a free improvement.
  OAUTH SCOPE (operator note, in `youtube.ts`'s header): the collector reuses the SAME token
  `publish/youtube.ts` refreshes for uploads, with `https://www.googleapis.com/auth/yt-analytics.readonly` added
  alongside the existing `https://www.googleapis.com/auth/youtube.upload` scope on the same OAuth consent — no
  separate OAuth flow.
  30-DAY POLLING WINDOW: `schema.ts`'s `isWithinPollingWindow` (inclusive at exactly 30 days, exclusive one
  millisecond past — matching `tokens.ts`'s own inclusive-boundary convention), tested at the exact boundary in
  both `schema.test.ts` (pure) and `youtube.test.ts`/`instagram.test.ts` (via each collector). YouTube adds a
  cheap COARSE pre-filter on the pending-flip's calendar date (widened by one day) before making any network call
  — `pending-youtube-flips.json` only grows over the pilot's life, so this avoids re-fetching every video ever
  uploaded on every run — then applies the PRECISE filter using the video's real `snippet.publishedAt` once
  fetched; tested with a fixture chosen so the coarse filter passes but the precise one excludes, proving the
  exclusion is keyed on the real timestamp, not the coarse one.
  IDEMPOTENCY — THE ACCEPTANCE CRITERION: `collect.ts`'s `runMetricsCollection` reads the collection date's
  existing dated file, upserts each freshly-fetched row by `platform:postId` (`schema.ts`'s `upsertMetricsRow`,
  which replaces rather than appends a same-key row), and writes the merged result back — never a second row for
  a post already in the file. `collect.test.ts`'s primary test runs the same collection twice against the same
  mocked APIs and asserts the row count stays at 2 (not 4), plus a second test with CHANGED mocked metrics on the
  re-run proving the row's numbers update in place rather than a stale row surviving alongside a fresh one. The
  Instagram follower-snapshot file follows the identical discipline, keyed by calendar date.
  PLATFORM ISOLATION: mirrors `job.ts`'s own reasoning — each platform's whole collection sequence is wrapped in
  its own try/catch inside `runMetricsCollection`, logged via an injected `logger.warn` rather than thrown, so an
  Instagram outage never prevents YouTube's rows from being written and vice versa; tested both directions plus a
  both-fail case that still resolves (empty rows, no throw) rather than rejecting.
  DETERMINISM: `now` (the collection instant) is an explicit parameter throughout every function in
  `schema.ts`/`instagram.ts`/`youtube.ts`/`collect.ts` — nothing calls `Date.now()`/`new Date()`. `collect.ts`
  also carries a real CLI entry point (`npx tsx social/src/metrics/collect.ts [--now <ISO>] [--help]`, guarded by
  the same process-entry-point check as `job.ts`'s own bottom-of-file `main()`), with the ONE wall-clock read
  (`new Date().toISOString()`, overridable via `--now` for a manual re-run) clearly commented at its single call
  site. It reads the Instagram/YouTube tokens `job.ts` already refreshes via the same `createFirestoreTokenStore`
  — token FRESHNESS stays `job.ts`'s job (documented in `collect.ts`'s header); this collector only reads
  whatever is currently stored. Verified live (no credentials, no network beyond the one expected Firestore
  auth-detection error): `npx tsx social/src/metrics/collect.ts --now 2026-09-05T00:00:00.000Z` with every env
  var unset completes with exit code 0, logs `[instagram] skipped...`/`[youtube] skipped...` naming exactly what
  was missing, and writes an empty dated file — deleted afterward, not committed, since it is smoke-test debris
  rather than a real run's output.
  Never logs a token: both `instagram.ts` and `youtube.ts` mirror `publish/instagram.ts`'s/`publish/youtube.ts`'s
  own discipline exactly (query-parameter redaction for Instagram, header-only for YouTube); `collect.ts` never
  logs a whole config object, only fixed strings, dates, ids, and `errorMessage(error)`.
  `npx vitest run src/metrics` (from `social/`): 47/47 green. Full `npx vitest run` (social/): 489/489 green (442
  pre-existing, unmodified + 47 new). `npx tsc --noEmit -p social/tsconfig.json`: clean. T13 (TikTok collection
  spike) is next and has no dependency on this task; T14 (the viability readout) is the first real consumer of
  the `MetricsRow`/`InstagramFollowerSnapshot` shapes this task defines.
- [!] T13: Settle TikTok collection with a SPIKE before building it — attempt the Display API `video.list` against
  the pilot account with an unaudited app and record what it actually returns. Automate it if it works; fall back to
  hand entry in the same schema during the weekly session if it does not. Either way, retention stays manual.
  Timebox this — the manual fallback is ~14 rows a week inside a session that already happens, so it is not worth an
  open-ended integration. Acceptance: a written finding, and either a working collector or a documented fallback.
  DEFERRED (partial) — the spike itself needs a real TikTok account and app credentials, which this session does not
  have; running it is left for the user. Split into the reproducible half (done here in full) and the live spike
  (by-hand, not run). Also: the "~14 rows a week" figure is STALE, same issue T07 already flagged for its own "14
  videos" wording — `Pf39c2-social-pilot-02a` D02 collapsed the channel to one Wall post a day, so it is 7 rows a
  week, not 14; nothing built here hard-codes either number.
  Done: `social/src/metrics/schema.ts` — added `'tiktok'` to `MetricsPlatform` (additive; `'instagram' | 'youtube'`
  unchanged) and extended the header's AVAILABLE VS. ZERO section to state TikTok's per-field convention (`follows`
  and `saves` always `null` — no TikTok read path attributes either per-video; `averagePercentWatched` `null` by
  default — retention stays manual per this task's own Constraint; `shares` real, since both candidate read paths
  and the app's own analytics screen report it). Added `social/src/metrics/tiktok-manual.ts` — the documented
  hand-entry fallback, fully built and usable today regardless of the spike's outcome: `buildTikTokMetricsRow`/
  `recordTikTokHandEntry` validate then build a `MetricsRow` with `platform: 'tiktok'` and upsert it via `schema.ts`'s
  own `upsertMetricsRow` (the same helper `collect.ts` uses for Instagram/YouTube), so a TikTok row lands in the
  identical dated `metrics-<date>.json` file. Input is deliberately narrow — `postId`, `publishedAt`, `views`,
  `likes`, `comments`, `shares`, an optional `averagePercentWatched` override, `collectedAt` — mirroring exactly the
  four counts the plan's Constraint says `video.list` would have returned automated, i.e. what a human can actually
  read off TikTok's per-video analytics screen; `follows`/`saves` are not inputs at all, only ever `null` on the
  built row, so nothing invites a fabricated number. `validateHandEnteredTikTokMetrics` throws
  `TikTokHandEntryValidationError` naming the exact bad field on a negative or non-integer count, an out-of-range
  percentage, or an unparseable `publishedAt`/`collectedAt` — hand entry's expected failure mode is a typo, so this
  fails loudly rather than silently recording a bad row. A thin CLI (`main()`, reusing `collect.ts`'s exported
  `DEFAULT_METRICS_DIR` and its own read/write-dated-file conventions) makes the weekly session's low-friction path a
  single `npx tsx social/src/metrics/tiktok-manual.ts --post-id ... --views ...` call per post; verified by hand
  end-to-end (a real run against a scratch `--out-dir` produced the exact expected JSON row, and a negative count
  failed loudly with the exact field named). Added `social/src/metrics/tiktok-spike.ts` — the small, runnable,
  clearly-labelled SPIKE the user runs once with real credentials: makes exactly one `POST /v2/video/list/` call
  (Display API, `video.list` scope), prints the raw response with the token redacted (`redactToken`, defense in
  depth — the token is sent only as a Bearer header, never a URL parameter, so there is nothing to redact from the
  URL itself), and prints a verdict via the pure, unit-tested `deriveVerdict` (automate only if EVERY returned video
  carries all four of `view_count`/`like_count`/`comment_count`/`share_count` as real numbers; otherwise names which
  are missing and points at the fallback). `--help` runs with no token and no network call (verified by hand); the
  script throws immediately, before any network call, when no token is supplied and `--help` was not passed. Wrote
  `docs/SOCIAL_PILOT.md` (new file — T15 does not exist yet; this section is written so T15 can fold it into the
  runbook it writes rather than duplicating it) with a "TikTok metrics collection" section: both candidate read paths
  and what each returns per the Constraint, that retention/traffic-source stay manual either way, the decision rule
  verbatim, the exact by-hand steps to run the spike (register a Sandbox app, add the pilot account as a Sandbox
  target user, complete OAuth for the `video.list` scope, post at least one video, run the script, record the
  result), and a plainly-stated current status: **the spike has not been run — the finding is undetermined, and the
  hand-entry fallback is in force by default, not because the Display API is known not to work.** Tests: added
  `social/src/metrics/__tests__/tiktok-manual.test.ts` (30 tests — valid hand entry builds the exact expected row;
  `follows`/`saves` always `null`, distinct from a real `0` on the four counts; every validation rejection case
  named in this task's brief; idempotent upsert alongside pre-existing Instagram/YouTube rows in the same array,
  including a same-`postId` correction replacing in place and two distinct TikTok posts both persisting) and
  `social/src/metrics/__tests__/tiktok-spike.test.ts` (10 tests — `deriveVerdict`'s decision rule over synthetic
  `video.list`-shaped bodies: viable, request-failed, zero-videos, a field missing on one of two videos, a field
  present but non-numeric, and a malformed/null body; `redactToken`'s scrubbing). `npx vitest run src/metrics` (from
  `social/`): 87/87 green. Full `npx vitest run` (`social/`): 529/529 green (489 pre-existing, unmodified + 40 new).
  `npx tsc --noEmit -p social/tsconfig.json`: clean. Did NOT attempt any live TikTok API call, per this task's own
  instruction. T14 (the viability readout) is next; when it reads TikTok rows it will see the same `MetricsRow`
  shape as Instagram/YouTube, with `follows`/`saves` `null` on every TikTok row regardless of whether the spike ever
  gets automated.
- [x] T14: Implement the viability readout — per platform, the median, the maximum, the max/median ratio, the
  week-1-vs-week-4 median trend, follow conversion (exact on YouTube, inferred from daily deltas on Instagram and
  TikTok — label which is which), and the top 5 posts with their format. State plainly whether the
  pre-registered criterion was met. Acceptance: over synthetic data with an injected outlier, the readout correctly
  reports a breakout — and correctly reports NO for an outlier with no conversion and no trend.
  Done: `social/src/metrics/readout.ts` — pure computation (`median`, `maxToMedianRatio`, `medianViewsByWeek`,
  `computeWeekTrend`, `computeFollowConversion`, `computeReadout`, `computeVerdict`) fully separated from formatting
  (`formatReadout`) and IO (the CLI's `readLatestMetricsRows`/`main`), matching this plan's own `job-plan.ts`/`job.ts`
  split. Implements the index plan's pre-registered criterion verbatim: criterion A checked first (any platform's
  breakout post, `views >= breakoutViewThreshold` (default ~10,000), with `follows !== null && follows > 0`), then
  criterion B (any platform's week-1-to-week-4 median trend `'up'`, via `pilot-config.ts`'s own `dateToWeekDay`
  anchor — no second week-numbering scheme invented); neither met produces `viable: false` with the plan's own
  "outlier with no conversion and no trend is explicitly a NO" wording baked into the summary string, so a raw
  max/median ratio can never flip the verdict alone (covered by its own test: a ~109x ratio with no breakout-
  threshold post and no trend still reports NOT VIABLE). Follow conversion is labelled per platform, never
  silently upgraded: YouTube's `follows` is passed through as `'exact'`; Instagram/TikTok are `'inferred'` from a new
  `DailyFollowerSnapshot[]` (same `{date, followerCount}` shape as `schema.ts`'s `InstagramFollowerSnapshot`, reused
  rather than growing `schema.ts` a TikTok-specific type for a collector — T13 — that doesn't exist yet) via a
  day-over-day delta aligned to `publishedAt`, or `'unavailable'` (never a fabricated `0`) when no snapshot series is
  supplied, which is TikTok's real state today. `follows: null` is threaded through untouched everywhere (its own
  test: a YouTube breakout post with `follows: null` does not satisfy criterion A). `computeWeekTrend` requires BOTH
  week 1 and week 4 to have at least one post, else `'insufficient-data'` naming the weeks actually observed, never a
  two-point trend. A CLI entry point (`main()`, matching `collect.ts`'s own guard/`--now`/`--help` conventions) reads
  every `metrics-<date>.json` under `content/social/metrics/` (`readLatestMetricsRows`, deduping to the latest
  `collectedAt` per `platform:postId` across the polling-window's repeated daily snapshots) plus
  `instagram-followers.json`, and prints `formatReadout`'s report — verified against a real scratch directory,
  producing the expected `VIABLE (criterion A met)` line end-to-end. Tests:
  `social/src/metrics/__tests__/readout.test.ts` (21 tests, all passing), covering the task's acceptance criterion
  exactly (an injected outlier that converts -> criterion A; an outlier with no conversion and no trend -> NOT
  VIABLE, with the exact wording asserted) plus a criterion-B-only case, even/odd/single-value medians, a zero-median
  ratio, null-never-a-zero on both YouTube and inferred platforms, insufficient-week-data, and top-5
  ordering/truncation. `npm test --prefix social` is green at 550/550 (529 prior + these 21); `tsc --noEmit` clean.
- [x] T15: Write `docs/SOCIAL_PILOT.md` — the runbook. Must cover account creation hygiene (separate email, created
  manually on a real device, phone verified, distinct handle and bio, no follow/like/comment automation, no
  delete-and-repost); the weekly session covering TikTok scheduling, the YouTube flip and any metrics T13 left
  manual; the pre-registered
  criterion; and what to do if the Meta account is disabled. Acceptance: someone else could run the pilot from this
  document alone.
  Done: rewrote `docs/SOCIAL_PILOT.md` around T13's existing TikTok-metrics section (kept verbatim, folded into a
  "weekly session" checklist rather than duplicated) into the full runbook: (1) the pre-registered criterion quoted
  verbatim from the index plan, with the "outlier with no conversion and no trend is explicitly a NO" warning and a
  pointer at `social/src/metrics/readout.ts` as the thing that actually computes the verdict, not a spreadsheet;
  (2) account creation hygiene — every item the task names (separate email, manual creation on a real device, phone
  verification, distinct handle/bio, zero follow/like/comment automation, no delete-and-repost), each with the
  specific enforcement mechanism it defends against, sourced from `plans/research/social-experiment-notes.md`'s
  "Account-restriction risk" section (TikTok's automation clause, Meta's Account Integrity mutual-enforcement
  policy); (3) one-time setup in dependency order — R2 (`social/r2/README.md`), the Meta app/Instagram token
  (Standard Access only, no App Review), the YouTube OAuth app (flagged loudly that it MUST be published to "In
  production" or refresh tokens die weekly), and explicitly flagged that NO OAuth authorization flow exists
  anywhere in this codebase — tokens must be hand-written into the `social-pilot-tokens` Firestore collection in
  the exact `StoredToken` shape (`{value, expiresAt}`) `token-store-firestore.ts` reads, before the Docker build
  (`social/DOCKER.md`) and the Cloud Run Job/Firebase trigger deploy (`social/DEPLOY.md`); (4) the daily loop —
  what the `onSchedule` trigger does, what a healthy Cloud Run execution's log lines look like
  (`[instagram] ok — ...` / `[youtube] ok — ...`), and how to check it via `gcloud run jobs executions list/logs`;
  (5) the weekly session as a checklist — schedule generation (`scripts/review-week.ts` + `generate-schedule.ts`),
  staging TikTok (documented the real gap found while verifying commands: `stageTikTokWeek` in
  `social/src/publish/tiktok-manual.ts` has NO CLI wrapper anywhere in this repo, only unit tests call it — gave a
  runnable one-off `tsx` script as the concrete workaround rather than pretending a command exists), the YouTube
  visibility flip from `content/social/pending-youtube-flips.json`, and TikTok metrics hand entry
  (`npx tsx social/src/metrics/tiktok-manual.ts --post-id ... --views ...`, flags verified against the file's own
  `printHelp`) plus retention being in-app-only regardless of automation; (6) what to do if the Meta account is
  disabled — do not create a replacement from the same device/IP/email (Meta's mutual-enforcement policy would
  likely catch it too), the actual in-app appeal path, that R2 assets survive independently because uploads happen
  before any post per the plan's own Decision, and a concrete decision tree for continuing on the remaining two
  platforms vs. stopping, tied back to the criterion only needing one platform to clear; (7) metrics and the
  readout — `collect.ts`'s `--now` flag, the 30-day polling window, and the exact `readout.ts` invocation and flags
  (`--metrics-dir`, `--now`, `--breakout-threshold`), all checked against `printHelp()` in each file, not assumed;
  (8) a "Current status" section naming every task this plan left `[!]` DEFERRED (T01 R2, T05 Instagram live post,
  T06 YouTube live upload, T09 Docker build, T10 cloud deploy, T13 TikTok spike) and exactly what closing each one
  requires, plus a dedicated callout that `functions/src/socialTrigger.ts`'s `PILOT_TIMEZONE`/`SCHEDULE_CRON`
  (`America/New_York`, `53 7 * * *`) is an off-the-hour-cron placeholder, not a deliberately chosen audience
  timezone/time, and a closing line that zero posts have ever been published by this system — so the document
  cannot be mistaken for evidence the pilot is live.
  Verification: every command/flag cited was checked against the real source rather than assumed — `job.ts`,
  `cli.ts`, `metrics/collect.ts`, `metrics/readout.ts`, `metrics/tiktok-manual.ts`, `metrics/tiktok-spike.ts`,
  `scripts/generate-schedule.ts`, `scripts/review-week.ts`, `publish/tiktok-manual.ts`,
  `publish/token-store-firestore.ts`, `publish/tokens.ts`, `publish/env.ts`, `pilot-config.ts`, and
  `functions/src/socialTrigger.ts` were all read directly; confirmed `stageTikTokWeek` has no CLI entry point by
  grepping for its call sites (only `job-plan.ts`/`job.ts` reference the `PendingYouTubeFlip` type it shares, never
  the function itself, and no script anywhere calls it). `npm test --prefix social`: 550/550 green, unchanged — no
  `.ts`/`.tsx` file was touched by this task, only `docs/SOCIAL_PILOT.md`. T16 (the ~4-week findings) is next and
  depends on real data existing in `content/social/metrics/`, which in turn depends on this document's "Current
  status" section's six DEFERRED live steps actually being closed first.
- [!] T16: At ~4 weeks, write the findings into the same doc: did anything break out, which format, and the
  recommendation — build on what worked, or stop. Acceptance: a stated yes-or-no with the numbers behind it.
  DEFERRED — cannot be completed. The pilot has published zero posts (see `docs/SOCIAL_PILOT.md`'s "Current
  status" section — all six live steps T01/T05/T06/T09/T10/T13 are still DEFERRED). There is no week 1, no week 4,
  no `content/social/metrics/*.json`, and therefore no finding to write. A yes-or-no verdict here would have to be
  fabricated — the single most consequential output of this whole project — so none was written.
  Done (the only thing this task's own acceptance criterion permits ahead of real data): added
  `docs/SOCIAL_PILOT.md` section 8, "Findings (week 4) — TEMPLATE, NOT YET FILLED IN," dated 2026-08-27 at the top
  so a reader can tell how stale the emptiness is. It gives (8.1) the exact `readout.ts` invocation and flags,
  checked against the file's own `printHelp()` rather than guessed (`--metrics-dir`, `--now`,
  `--breakout-threshold`, `--help`); (8.2) a fill-in-the-blanks table per platform (median, maximum, max/median
  ratio, week-1-vs-week-4 trend, follow conversion labeled exact/YouTube vs inferred-or-unavailable/Instagram+
  TikTok) plus a top-5-posts table with format, every cell an obvious placeholder (`<median>`,
  "TO BE FILLED AT WEEK 4") that cannot be mistaken for a real result; (8.3) the recommendation skeleton, headed
  blank, with an explicit note that the format-comparison half of this task's own wording is now degenerate —
  `Pf39c2-social-pilot-02a` D01/D02 collapsed the channel to one format (The Wall, one post/day) before any post
  went out, so "which format broke out" has exactly one possible answer, and points the future author at The
  Wall's three sub-types (Thou Wall / Cascade / Scene, per the index plan's table) as the only within-format axis
  that could actually differ; (8.4) the decision rule quoted verbatim from `plans/Pf39c2-social-pilot-index.md`
  (criterion A breakout+conversion, criterion B trend, neither -> stop, outlier-with-no-conversion-is-a-NO) with an
  explicit instruction not to renegotiate it. Only `docs/SOCIAL_PILOT.md` was touched — no code, no test, no
  invented number anywhere in the new section. `npm test --prefix social`: 550/550 green, unchanged (doc-only
  edit). This task stays open until real data exists; whoever closes the six DEFERRED live steps above and reaches
  real week-4 metrics is the one who fills in section 8 and flips this task to `[x]`.

## Verify
```
npm test --prefix social
npm test
npm run test:e2e --prefix web
npx tsx social/src/job.ts --date 2026-09-01 --dry-run
```

## Review fixes (PR #42 code review, 2026-08-27)

Nine must-fix defects found by the code-reviewer on the full `main...social-pilot-03` diff. None were
dismissed as false positives. Posted to PR #42 before any fix was applied. M4, M6 and M7 are cases
where the mocked suite passes but the real integration would fail.

- [x] F01: Fix `readout.ts` `medianViewsByWeek`/`computeWeekTrend` throwing on a `publishedAt` before
  `PILOT_WEEK_1_START` (M1); validate `--breakout-threshold` instead of letting `NaN` silently make
  criterion A unsatisfiable (M8); require a minimum sample in both endpoint weeks so criterion B
  cannot fire from two single-post weeks (M9). Regression test for each.
- [x] F02: Fix `token-store-firestore.ts` to read inside `runTransaction` so the read set is non-empty
  and a concurrent writer genuinely conflicts (M2), refusing to overwrite a newer `obtainedAt`. Make
  `tokens.ts`'s 24h minimum-refresh-age per-platform so it stops gating YouTube, whose access tokens
  live ~1h (M3). Regression test for each.
- [x] F03: Fix `job.ts` so pending-YouTube-flips persist somewhere durable rather than the container's
  ephemeral filesystem, and so `metrics/collect.ts` reads them from the same place (M4); make the R2
  upload a per-platform precondition rather than a whole-run one, so an R2 failure cannot stop the
  YouTube upload that does not use R2 (M7). Regression test for each.
- [x] F04: Fix `metrics/instagram.ts` to skip non-video media rather than requesting Reels-only
  metrics for every item, and wrap each item so one bad post cannot discard the whole day's Instagram
  rows (M5). Fix the `collect.test.ts` fixture that masks this. Regression test.
- [x] F05: Fix `publish/youtube.ts` to send `Authorization: Bearer` on the byte-upload PUT and the
  wildcard status-query PUT, not just on session initiation (M6). Regression test.

## Follow-up code review (2026-08-27): F03's M4 fix repeated M2's defect

- [x] F10: `pending-flips-store-firestore.ts` (added by F03) repeated M2's exact defect: `write` ran a
  `runTransaction` whose callback never called `transaction.get`, so its read set was empty and it
  offered zero protection — worse than the M2 case, because `job.ts`'s `recordPendingFlip` did the
  read-modify-write ACROSS two separate calls (`read()` then `write(merged)`), with the read entirely
  outside any transaction, so two overlapping runs could each read the same list, each append their
  own day, and whichever wrote second would silently drop the other's already-committed YouTube video
  id. Fixed by replacing `PendingFlipsStore`'s `read`/`write` pair with a single atomic `append(flip)`
  that does the whole read-modify-write (`transaction.get`, merge via `upsertPendingFlip`,
  `transaction.set`) inside one `runTransaction` call — the unsafe two-call pattern is no longer
  representable, not just patched for this one caller. `job.ts`'s `recordPendingFlip` and both
  `PendingFlipsStore` implementations (Firestore and local-file) updated to match; header/inline
  comments claiming atomicity corrected to describe what the code actually does. Regression test
  (`publish/__tests__/pending-flips-store-firestore.test.ts`) mirrors `token-store-firestore.test.ts`:
  asserts `transaction.get` runs before `transaction.set` on the same doc, and that a concurrent
  writer's already-committed entry survives a second writer's `append`.

## Follow-up (beyond the review's must-fix set)

- [ ] F06: `job.ts` never persists the Instagram media id, so `metrics/instagram.ts` discovers posts
  from Instagram's own media list and cannot distinguish a pipeline post from one made by hand.
  Record the media id at publish time and key collection off it.
- [ ] F07: `stageTikTokWeek` has no CLI wrapper, so the weekly session — the pilot's most important
  recurring manual step — requires hand-writing a one-off `tsx` script (documented as a workaround in
  `docs/SOCIAL_PILOT.md` 5.2). Add a real CLI entry point.
- [ ] F09: A feed-still-only R2 upload failure is logged as an error but does not affect any
  `PlatformOutcome` or the exit code, because nothing in the current pipeline consumes the feed
  still's R2 URL. Decide whether the feed still is still needed at all (02a D01 left one Wall video
  a day) — and if it is, make its upload failure visible; if it is not, stop rendering it.
- [ ] F08: Set a deliberate posting timezone and time in `functions/src/socialTrigger.ts` — the
  current `America/New_York` / `07:53` is a placeholder chosen only to avoid an on-the-hour cron
  pile-up, not an audience decision.
