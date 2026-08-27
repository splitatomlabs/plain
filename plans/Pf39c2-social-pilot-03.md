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
