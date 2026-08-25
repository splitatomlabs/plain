# Social experiment — research notes (2026-08-23, partial)

Status: 3 of ~15 research agents completed before session limit. Remaining: TikTok/YouTube/X/Pinterest/Bluesky APIs,
gen-AI video models, render/TTS/music tooling, scheduling infra, experiment design.

## Meta APIs (Instagram / Facebook Pages / Threads) — VERIFIED
- All free. No App Review or Business Verification needed to post to YOUR OWN account, provided the account holds an
  app role (Instagram Tester / Threads Tester / Page admin) and the app is a **Business**-type app.
- IG: container -> poll status -> publish. Reels `media_type=REELS` + `video_url`. Images JPEG only (no PNG), <=8MB.
  Reels: 3s-15min, <=300MB, 9:16, H.264, 23-60fps. 100 API posts/24h. Media MUST be at a public HTTPS URL (Meta cURLs it).
- IG has NO way to attach trending audio via API — music must be baked into the MP4.
- IG supports `is_ai_generated=true` on the container (self-disclosure AI label), added 2026-06-22. FB Reels too. Threads has none.
- Threads: text/image/video/carousel, <=500 chars, video <=300s, 250 posts/24h. Separate Threads app ID/secret.
- Analytics via API: IG `followers_count` (ungated) + per-media insights (views/reach/likes/shares/saves, 48h delay);
  IG account `follower_count` metric gated at 100 followers. Threads `followers_count` ungated + per-post views/likes/replies.
- TOKENS ARE THE #1 OPERATIONAL RISK: IG + Threads long-lived tokens expire in 60 days and must be refreshed
  (token must be >=24h old). Missing the window = manual re-auth. FB **Page** tokens do not expire — preferable.
- Facebook dev-mode caveat: in Development mode, posts with media are only visible to app devs/testers. Must go Live.

## Postiz (aggregator) — VERIFIED
- Cloud: Standard $29/mo (5 channels), Team $39/mo (10 channels). No free tier. Public REST API + CLI + MCP on all paid tiers.
- Self-hosted (AGPL-3.0, 35k stars) is unlimited BUT you must register your own developer app per platform — i.e. it does
  NOT solve the TikTok audit / Meta app setup problem. **Cloud does** (pre-registered apps, just click connect).
- API: `POST /posts` multi-platform in one request; `POST /upload` (video <=1GB) or `/upload-from-url`.
  Analytics endpoints exist: `GET /analytics/{integration}` (followers/impressions) and `/analytics/post/{postId}`.
  Analytics only covers 10 of 34 platforms (IG, FB Page, TikTok, YouTube, Pinterest, Threads, X, LinkedIn Page — NOT Bluesky).
- Reliability concerns: 156 open issues; open bug "TikTok Daily active user quota reached" on Cloud (#1854, no maintainer reply);
  FB/IG hardcoded Graph API v20.0 expiring Sept 2026 (#1807); AppSumo rating 2.2/5 citing unexplained post failures.
  => Treat any aggregator as a swappable adapter behind our own interface, not as the foundation.

## Attribution (Umami) — VERIFIED
- Umami auto-captures all 5 UTM params; dedicated UTM report. Cloud Hobby free = 100k events/mo, 3 sites, 6mo retention.
- Referrer is stripped by IG/TikTok/X in-app browsers -> visits look "Direct". UTMs survive because they're in the URL.
- RECOMMENDED: own the redirect. SvelteKit `web/src/routes/go/[slug]/+server.js` -> log a server-side click -> 302 to
  `https://thinkplain.ai/?utm_source=<platform>&utm_medium=organic-social&utm_campaign=stoic-daily&utm_content=<format>`.
  Bio link never changes; destination UTMs editable server-side; click counted before in-app browsers can block JS.
- IG's `website_clicks` insight was removed Apr 2025 — use `profile_links_taps`. YouTube has no link-click reporting.
- Site URL confirmed: https://thinkplain.ai

## Content facts (from repo)
- 1,615 cards total across 7 books. Word-count distribution of `plain_english`:
  <=40w: 105, 41-60w: 132, 61-80w: 214, 81-120w: 664, >120w: 500.
  => ~237 cards at <=60 words are natural "quote card" candidates; longer ones need an extracted pull-quote.
- Existing reusable infra: `@vercel/og` route at `web/src/routes/api/og/[cardId]/+server.js`, `calcOgFontSize()` in
  `web/src/lib/utils/og.js`, Anthropic Batch API helpers in `scripts/lib/claude.ts` (createMessageBatch, pollBatchUntilDone,
  streamBatchResults, callClaudeJSON, safeCustomId) — reuse for batch quote scoring.
- Brand: Literata (body) + DM Sans (UI); light #FAF7F2/#2C2520, dark #1A1816/#E8E2D9; author accents
  epictetus #B5704F, marcus-aurelius #5B6E8A, seneca #6B7F5E. Motion rules: ease-out only, no bounce, **text never moves**
  (no typing/word-by-word reveals) — this constrains the "animated text" formats to fades/holds, not kinetic typography.

## User decisions so far
- Same quote across all 4 accounts each day (format is the only variable).
- Budget: "whatever it takes".
- Fully autonomous posting, no approval gate.
- Platform choice: user asked "which is easiest and why?" — needs answering before the plan is finalised.

## Quote-selection analysis (local, 2026-08-23)
- Mechanical extraction is NOT enough. 1,614 of 1,615 cards yield at least one contiguous 1-3 sentence span of 8-45
  words (13,654 spans total), but sampled spans show most are context-dependent and unusable standalone, e.g.
  "And what's that? Their theories." / "Each one offers a way to escape slavery." / "Remember this: because of today's
  laziness, everything that comes after will be worse."
- 1,411 cards have a strong opening sentence (6-25 words); 1,388 have a strong closing sentence. Opening/closing
  sentences are the best mechanical prior, but still need judgement.
- => Quote selection must be an LLM batch pass over all 1,615 cards that BOTH extracts the best standalone pull-quote
  AND scores it (standalone comprehensibility, emotional punch, universality, no dangling pronouns/references,
  fits in ~40 words for a 1080x1080 card). Reuse `scripts/lib/claude.ts` batch helpers (createMessageBatch,
  pollBatchUntilDone, streamBatchResults, safeCustomId) — same pattern as the translate phase.
- Output should be a ranked, cached `content/social/quotes.json` pool, generated once and re-scored only when
  content changes. Daily cron just pops the next unused quote — no LLM call needed at post time (removes a failure mode).
- Platforms chosen by user: TikTok, Instagram, YouTube.

## TikTok Content Posting API — BLOCKED for DIY (VERIFIED 2026-08-23)
Two hard gates, both quoted from official docs:
1. **The use case is named as ineligible.** Content Sharing Guidelines, "Intended Use":
   "API Clients must not be limited to test applications and should be intended for a wide audience, not limited to
   internal groups/private use. **Not acceptable: A utility tool to help upload contents to the account(s) you or your
   team manages.**" App Review Guidelines: "Apps must not be for private or personal use."
   https://developers.tiktok.com/doc/content-sharing-guidelines/ , https://developers.tiktok.com/doc/app-review-guidelines/
2. **Unaudited clients are forced private AND the account must be private at post time.** "Unaudited API Clients can only
   post contents in SELF_ONLY viewership"; "All user accounts using the API client to post must be set to private at the
   time of posting." HTTP 403 `unaudited_client_can_only_post_to_private_accounts`. Manual unlock = account to public,
   then each post to Everyone. Audit also requires a public non-landing-page website, ToS + privacy policy, app-store
   listing for mobile, a demo video, and a mandated human-in-the-loop UI (privacy dropdown with NO default value,
   express consent before upload) that a cron cannot demonstrate. Review takes "several days to two weeks".
   Sandbox does NOT help: "Sandbox mode does not offer access to Content Posting API for public videos."
=> **WORKAROUND: post to TikTok through an already-audited third-party scheduler** (Postiz Cloud, Ayrshare, Blotato,
   Buffer, Later, Metricool). You inherit their audit. This is the only clean path. Note open Postiz bug #1854
   "TikTok Daily active user quota reached" on Cloud — verify TikTok posting works on any aggregator BEFORE committing.
Other TikTok facts: `video.publish` scope = direct post (the only unattended path); `video.upload` = draft to inbox,
   requires human tap. PULL_FROM_URL requires domain/URL-prefix ownership verification (DNS or prefix; HTTPS only,
   NO redirects, 1-hour download window); FILE_UPLOAD not supported for photos. Video: MP4/H.264, 23-60fps (hard floor
   at 23), 360-4096px both dims, <=10min, <=4GB. No documented min duration or aspect requirement.
   `is_aigc` bool field exists -> labels "Creator labeled as AI-generated". Mandatory only for realistic scenes/people;
   generic TTS is explicitly exempt. Set it true anyway.
   **Watermark rule:** "should not superimpose or otherwise include any brand name, logo, watermark... on or in any
   content which is shared to TikTok... may also lead to deleted content or disabled accounts."
   => KEEP THE PLAIN LOGO/URL OUT OF THE VIDEO FRAME. Branding goes in caption/bio only.
   Tokens: access 24h, refresh 365 days, **refresh token ROTATES** — must persist the new one atomically or the
   account is orphaned. Analytics: `user.info.stats` -> follower_count/likes_count/video_count; `video.list` ->
   view/like/comment/share counts. Same app review gates these.

## YouTube — VIABLE, gate is paperwork (VERIFIED 2026-08-23)
- **Uploads from unverified API projects are locked private, NO APPEAL** (videos.insert docs + answer/7300965).
  Fix = submit the YouTube API compliance audit form (separate from Google OAuth verification!).
  **Fallback if audit fails: upload private via API, flip visibility in Studio (~10s/day).** Far better than TikTok.
- Quota premises were OUT OF DATE: videos.insert cut from 1600 units to ~100 (Dec 2025), then moved to its own bucket
  (Jun 2026). **100 uploads/day**, 1 unit each. Quota is a non-issue.
- **7-day refresh-token expiry applies only in "Testing" publishing status. Click "Publish app" -> In production to
  remove it. No verification required.** Costs 1 of 100 lifetime user slots (never resets).
- Shorts classification (2026): **square or vertical, up to 3 minutes** — automatic, no API flag, no #Shorts needed.
- Encode: MP4 faststart (moov at front), H.264 High, closed GOP, 4:2:0, AAC-LC 48kHz, ~8Mbps, 1080x1920 (Shorts cap 1080p).
- Always set `notifySubscribers=false` (defaults TRUE — daily notification spam), `selfDeclaredMadeForKids=false`,
  `containsSyntheticMedia=true` ONLY if AI music or a real person's cloned voice is used (AI-generated MUSIC is on the
  must-disclose list; own-voice cloning and non-realistic AI visuals are exempt).
- Analytics: channels.list->subscriberCount (rounded to 3 sig figs); videos.batchGetStats (1 unit, own 10k bucket);
  **track `engagedViews` not `views`** — since Mar 2025 `views` counts every Short start with no min watch time.
  Thumbnail impressions only via the separate Reporting API. `thumbnails.set` likely 403s on Shorts (Studio-only).
- **Monetization risk:** policy renamed Jul 2025 to "inauthentic content". Not allowed: "Image slideshows, templated
  storylines, or scrolling text with minimal or no narrative, commentary, or educational value" and "AI-generated
  content made with generic or unoriginal templates giving the impression of mass production". Affects YPP eligibility
  only, not upload success. Mitigation the policy points at: materially vary substance per video, add original
  commentary — Plain's plain-English translation IS that original substance. Use it, don't post bare quotes.
- OAuth: Desktop-app client + 127.0.0.1 loopback (OOB flow removed). Service accounts do NOT work.

## Infra + experiment design — VERIFIED 2026-08-23

### Compute
- **GitHub Actions is viable to start, free.** Private repos: 2000 min/mo, **2 vCPU/8GB** (public gets 4/16 — Remotion is
  ~2x slower on private). 6-hour job limit. FFmpeg NOT preinstalled (apt-get, ~30-60s); Chrome 151 IS preinstalled.
  **The "60-day inactivity disables scheduled workflows" rule applies to PUBLIC repos only** — not us. No bot-commit hack needed.
  Cron jitter is real: "some queued jobs may be dropped". Schedule off the hour (e.g. `37 4 * * *`) + always add workflow_dispatch.
  Budget 20-40min/day = 600-1200 min/mo, fits in 2000. Caveat: ToS "any other activity unrelated to the production,
  testing, deployment, or publication of the software project" — a content pipeline is a strained fit, though promoting
  thinkplain.ai itself is defensible.
- **Recommended primary: Trigger.dev.** TypeScript-native, ffmpeg + puppeteer build extensions, and crucially
  **"a wait longer than 5 seconds does not count towards compute usage"** — so the 2-10min gen-AI video poll costs $0.
  $0/mo on free credit; $10/mo Hobby for 2 vCPU. Fallback: Railway cron (~$1.67/mo inside $5 credit; process MUST exit).
- **Vercel Cron is DEAD for this**: 300s function max even with Fluid, cron precision +/-59min, Hobby is
  "restricted to non-commercial personal use only". Inngest provides NO compute. Fly.io has no time-of-day cron.

### Media hosting: Cloudflare R2 + media.thinkplain.ai — $0/mo
- R2 free tier 10GB, **zero egress at any volume**. MUST use a custom domain: "Public access through r2.dev subdomains
  is rate-limited and should only be used for development purposes."
- Bonus: one TikTok DNS signature TXT record on thinkplain.ai verifies the domain AND all subdomains, unlocking
  PULL_FROM_URL (mandatory for TikTok photo posts).
- **GitHub raw/releases RULED OUT by direct test**: raw.githubusercontent serves `content-type: application/octet-stream`
  with `x-content-type-options: nosniff`. Release assets do two 302s to a time-limited signed URL on a different host
  with Content-Disposition: attachment. Unusable for TikTok verification and for Meta's cURL fetcher.
- Set contentType explicitly on every PutObject. Lifecycle-delete after 30 days.

### The one MP4 that satisfies TikTok + IG Reels + YouTube Shorts
Binding intersection: **duration 3s-180s; target 15-59s** (TikTok's per-creator `max_video_post_duration_sec` can be 60s).
Size ceiling is IG's 300MB — irrelevant, a 12s quote card encodes to ~46KB.
```
ffmpeg -y -i input.mov \
  -c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p \
  -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30" \
  -crf 20 -maxrate 10M -bufsize 20M -g 60 -keyint_min 60 -sc_threshold 0 -bf 2 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -movflags +faststart+negative_cts_offsets -map_metadata -1 output.mp4
```
- **Do NOT go 60fps at Level 4.0** — 1080x1920@30 uses 8160 of 8192 max macroblocks; 60fps needs L4.2.
- ALWAYS include an audio track even for the static format (silent-video handling is inconsistent).
- Known limitation: ffmpeg always writes an `elst` edit-list atom despite IG's "no edit lists" spec. In practice fine.
- IG feed image: **JPEG only**, 8MB max, AR 4:5 to 1.91:1 -> use **1080x1350**.
- **YouTube cannot take a static image.** Workaround verified: render the still as a 7s MP4 with music (28KB).
  NOTE this makes the static-image format nearly identical to animated-text+music ON YOUTUBE — a real confound.

### Experiment design — the most important finding
- **90 days minimum, not 30.** Metricool 2026 study (799,718 videos): only **11% of accounts under 10K followers grew**
  year over year. Socialinsider (2M videos): the 1-5K tier's avg views/post **fell 59%** (860 -> 350) while posting
  frequency rose 33%.
- Benchmarks for 1-5K follower accounts (i.e. already past zero): TikTok 350 views/post; IG Reels 580; IG carousels 993;
  IG static 417. Realistic zero-follower expectation: 50-300 views/post month 1, 200-600 by month 3, with rare outliers.
- **NEVER compare view counts across platforms** — each defines "view" differently. Compare the four accounts only
  against each other WITHIN a platform.
- **n=1 per format means account and format are perfectly confounded.** This is an identification problem, not a power
  problem — more posts will NOT fix it. Compounded by power-law view distributions (breaks means/t-tests),
  autocorrelation (daily posts from one account aren't independent), and per-account algorithmic state.
- **THE FIX — within-account crossover (Latin square). Costs nothing, highest-value change to the design:**
  two 45-day phases, rotate formats between accounts at the midpoint, so every format is run by two different accounts
  and every account runs two formats. Discard the first 14 days of each phase as washout.
  | | Days 1-45 | Days 46-90 |
  | A | static image | animated + narration |
  | B | animated + music | gen-AI + narration |
  | C | animated + narration | static image |
  | D | gen-AI + narration | animated + music |
- **Primary metric: median average-%-watched (retention).** It is the closest thing to a pure format-quality signal
  because it is independent of how much distribution the algorithm granted — exactly the confound that ruins view counts.
  Score = 0.40*view index + 0.25*retention + 0.15*engagement-per-view + 0.20*follows-per-post, normalised within platform.
  Use medians and Wilcoxon signed-rank on within-account pairs; bootstrap CIs. Pre-register the primary metric.
- Honest limit: conclusions are directional/hypothesis-generating. No p-values, and no ranking is meaningful when the
  top two formats are within ~30%.
- Posting time: Buffer (52M posts) — "sharing your posts at the 'right' time is not the secret sauce". Hold time
  CONSTANT per account (else it confounds format); stagger BETWEEN accounts.
- Hashtags: IG's own ranking explainer does not list hashtags as a Reels signal at all. Use 3-5 on IG/TikTok, 2-3 on
  YouTube. #Shorts not required. Put the quote itself in the caption — searchable text, and philosophy is search-driven.

### Account-restriction risk
- **TikTok Community Guidelines NOT ALLOWED: "Using automation to run many accounts or send repetitive content"** and
  "Spreading violative content across multiple accounts". Two-clause hit on a 4-account same-quote design.
- **Meta: account plurality is fine; the violation is concealed common operatorship + automation + repetitive content.**
  Critically, Account Integrity makes co-owned accounts mutually enforceable — Meta may act on accounts "Owned by the
  same person or entity as an account that has been disabled". **One bad account can take the other three.**
  => If one Meta account is disabled, PAUSE THE OTHER THREE IMMEDIATELY.
- **This kills the "same quote across all 4 accounts" decision.** Give each account its own lane (e.g. Marcus /
  Epictetus / Seneca / practical application), non-identical captions, distinct bios, handles, profile pics and visual
  templates. Four visually interchangeable accounts are exactly the inauthenticity signal Meta names.
- No platform documents a warm-up period — that advice is folklore, though harmless. Create each account manually on a
  real device with a separate email + phone verification. Zero follow/like/comment automation. No delete-and-repost.
- AI disclosure costs nothing on YouTube: "Disclosing AI content won't limit a video's audience or impact its
  eligibility to earn money." TTS narration needs NO disclosure on either platform (generic TTS is explicitly exempt);
  the gen-AI video does.

## Render / TTS / music toolchain — 2026-08-23
- **Image: use Playwright headless Chromium screenshot, NOT Satori/@vercel/og.** Satori is "not a complete CSS
  implementation" (no z-index, calc(), 3D transforms) and has no documented variable-font AXIS support — it expects
  discrete weights, so Literata/DM Sans variable axes flatten. A daily cron is not latency-sensitive, so the heavier
  browser is free. Keep Satori only for the existing OG-preview route.
- **Video: Remotion primary, FFmpeg-only fallback.** Remotion licence verified at remotion.pro/license AND repo
  LICENSE.md: **free for individuals and companies up to three people**. Company Licence needed above that;
  "Remotion for Automators" (headless/programmatic) is $0.01/render with a $100/mo minimum. **Solo dev = free.**
  Remotion fits the brand rule cleanly: interpolate() ease-out on `opacity` ONLY, never on x/y/scale — text never moves.
  FFmpeg fallback: xfade for crossfades, zoompan for slow background motion, trimmed stills for holds. No licence
  question at any scale, no headless Chromium dependency.
  Hosted APIs rejected: Shotstack $0.30/render-min PAYG or $39/mo at $0.20/min; Creatomate pricing UNVERIFIED.
  Self-hosting wins at 1 video/day.
- **TTS: ElevenLabs primary, Amazon Polly fallback.** At 60 clips x 600 chars = 36k chars/mo:
  ElevenLabs needs Creator $22/mo (Starter's 30k credits is just short); OpenAI tts-1 ~$0.54/mo; Polly Neural ~$0.58/mo.
  **Timestamps:** ElevenLabs gives CHARACTER-level via convert-with-timestamps (word boundaries derivable by matching
  whitespace) — sufficient. **Amazon Polly gives NATIVE WORD-LEVEL Speech Marks** — the better raw fit for fade timing.
  **OpenAI TTS returns NO timing data at all** — would need a separate Whisper forced-alignment pass. Rules it out as
  the primary. ElevenLabs commercial licence included from Starter up.
- **Music: generate ~10 tracks ONCE with a generative API, reuse via ffmpeg loop/trim. Do NOT use royalty-free
  libraries and do NOT generate per post.** Rationale: shared royalty-free tracks have existing Content ID / Rights
  Manager fingerprints and can trigger matches even when correctly licensed; a generated track is unique so there is no
  fingerprint to collide with. Generating once (vs per post) keeps a daily external API call off the cron path and
  shrinks the compliance surface from 30 tracks/month to 10 vetted once. ElevenLabs Music shares the TTS credit pool,
  commercial use permitted on self-serve plans.
- **Audio mix:** all three platforms converge on ~**-14 LUFS integrated, -1 dBTP** ceiling (INDUSTRY-STANDARD FIGURE,
  not confirmed against a live official platform spec — verify before hard-coding).
  Two-pass ffmpeg `loudnorm=I=-14:TP=-1:LRA=11` (measure with print_format=json, then apply measured values).
  Ducking: scripted `volume` envelopes timed to narration start/stop are preferred over `sidechaincompress` —
  deterministic, no adaptive surprises, better fit for the brand's "no dynamic surprises" rule.

## Gen-AI video — 2026-08-23 (some items UNVERIFIED, flagged)
- **Recommendation: Veo 3.1 Standard, NO AUDIO, 1080p, via fal.ai.** $0.20/s no-audio vs $0.40/s with audio — always
  request no-audio since we overlay our own narration. 8s per generation, native `extend-video` endpoint.
  Mandatory invisible SynthID watermark, cannot be disabled, survives re-encoding. Commercial use OK.
- **Fallback: Wan 2.5 via fal.ai, $0.05/s, Apache 2.0** — fully unrestricted commercial use, no watermark, self-hostable
  escape hatch. Mid option: Kling 2.5 Turbo Pro $0.07/s.
- **fal.ai over Replicate.** fal hosts Wan, Kling, Veo 3.1, MiniMax, Seedance, LTX. fal does NOT host Runway or Sora
  (verified by searching its catalogue) — those stay first-party-only. One SDK (@fal-ai/client) to swap models.
- **REACHING ~28s: generate 4 independent ~7s clips and CROSS-DISSOLVE. Do NOT chain via last-frame continuation.**
  Rationale for an unattended cron: chaining compounds risk — each step depends on the previous both succeeding AND
  looking clean enough to seed the next; one bad frame propagates with no reviewer to catch it, and a single failed
  extend-step kills the whole video. Independent clips isolate failure to one segment (regenerate just that clip), and
  dissolves forgive continuity mismatches, reading as intentional scene-cutting rather than error.
- **Style consistency across 30 days** (in order of leverage): (1) fixed prompt template with locked lexicon — only
  SUBJECT/CAMERA_MOVE/LIGHT slots vary; (2) a canonical reference still fed as the I2V seed image, more reliable than
  prompt text alone; (3) rotate a small fixed seed pool where the model exposes seeds (Wan/Kling do; Veo/Sora
  reportedly do not); (4) **a uniform LUT/grade + vignette/grain applied in the ffmpeg step after generation — this is
  what actually unifies output**, equalising variance no prompt strategy removes.
- Prompt template (slots in CAPS):
  "A slow, continuous [CAMERA_MOVE] over [SUBJECT], [LIGHT], muted desaturated color palette, cinematic anamorphic
   depth of field, soft atmospheric haze, contemplative and calm mood, 9:16 vertical, seamless loopable motion,
   shot on 35mm film emulation."
  Negative: "no text, no titles, no captions, no watermarks, no logos, no people, no faces, no hands, no human figures,
   no modern objects, no flickering, no harsh camera shake."
- **Cost/month at 30 posts x ~28s: Veo 3.1 $168 | Kling 2.5 $59 | Wan 2.5 $42.** Generation only.
- **BUILD A VALIDATION STEP.** No provider publishes failure/refusal rates. Content-policy refusals and text/face
  leakage are known failure modes for T2V generally. Run a cheap vision-model check on each output for faces and
  on-screen text before posting — especially since TikTok's watermark rule bans text/logos in frame.
- UNVERIFIED, confirm before relying: Runway API pricing/extend (pages blocked); Sora 2 max duration, watermark policy,
  commercial terms (OpenAI docs 403/404'd); whether Kling's Extend is exposed at API level or consumer-app only.

## TikTok aggregators — 2026-08-23
- **Ranked: 1) Ayrshare (Premium $149/mo, 1 profile, API on every tier, POST https://api.ayrshare.com/api/post).
  2) Upload-Post ($24/mo, 5 profiles, docs say "no TikTok developer app or audited-client review needed", hints at
  direct file upload). 3) Blotato (tier that unlocks API is ambiguous). 4) Post Bridge (API is a $5/mo bolt-on,
  analytics "beta").**
  Ayrshare wins on maturity: it is embedded social infrastructure sold to other SaaS companies, not a consumer
  scheduler with an API bolted on. Media = public HTTPS URL ending in a real extension (.mp4) — fits our R2 setup.
- **DISQUALIFIED (no accessible public REST API for programmatic posting):** Later, SocialBee, Metricool (only an MCP
  server), Publer (docs redirect-loop). **Buffer unconfirmed** on the two things that matter — whether TikTok is a
  supported publish channel and whether new self-serve API keys are still granted.
- **CRITICAL CAVEAT: no vendor states in words "our TikTok app is audited, posts go public."** All four imply it
  through product design. **Do a live test post to a real TikTok account and confirm it is NOT SelfOnly before
  trusting an unattended cron.** This is the single go/no-go test for the TikTok leg.
- Also unverified for all four: ToS clauses on automated/AI-assisted posting; status pages; TikTok analytics field
  coverage. Fetch the ToS before relying on it.
- **ROUTING DECISION: aggregator for TikTok ONLY. Instagram and YouTube go direct via their own free APIs.**
  Reasons: (1) blast radius — an aggregator outage, or TikTok re-reviewing the aggregator's app, would otherwise take
  down all three platforms at once; (2) no cost saving from bundling — every vendor charges the same tier price
  whether or not you use IG/YouTube; (3) Meta Graph and YouTube Data APIs are more stable and better documented than
  any third-party layer; (4) unambiguous failure diagnosis — IG/YT failure means our integration, TikTok failure means
  the aggregator.
- Optional cheap redundancy given budget: Ayrshare primary + Upload-Post as cold standby for the TikTok leg.

## Firebase as the job runner — VERIFIED 2026-08-23 (viable, with one trap)
- **TRAP: Firebase Scheduled Functions (`onSchedule`) are Pub/Sub event-driven, so they inherit the 540s / 9-MINUTE cap,
  NOT the 60-min HTTP cap.** A render-plus-poll job will NOT fit. (docs.cloud.google.com/functions/quotas)
- **CORRECT SHAPE: thin `onSchedule` function (well under 9 min) that just triggers a Cloud Run JOB.**
  Cloud Run Jobs max task timeout = **168 hours**; 32 GiB memory; up to 8 vCPU. This is the right primitive.
  (docs.cloud.google.com/run/docs/create-jobs). Cloud Run *services* cap at 60 min request timeout.
- Cloud Functions gen2: 60 min HTTP / 540s event-driven; 32 GiB; 8 vCPU. Cloud Run services: 60 min; 32 GiB; 8 vCPU.
- FFmpeg: bundle `ffmpeg-static` npm, or `apt-get install ffmpeg` in a custom Dockerfile on Cloud Run Jobs (cleaner).
- Remotion/headless Chromium: well-trodden — **Remotion's own docs recommend Cloud Run for server-side rendering.**
  Needs 2-4 GiB minimum. Gotchas: missing system fonts/libs in slim base images (matters for Literata/DM Sans!),
  Chromium cold-start latency.
- Cost at 30 runs/mo x 20 min x 2 vCPU / 4 GiB: 72,000 vCPU-s (free tier 180,000) and 144,000 GiB-s (free tier 400,000)
  => **effectively $0/mo, inside the Blaze free allotment.** (Cloud Run Jobs is technically a distinct SKU — confirm.)
- Billing gotcha: a poll-and-sleep loop bills wall-clock as compute for the whole wait. Negligible at 30 runs/mo but
  note it. (This is the one thing Trigger.dev does better — waits >5s are free there.)
- **=> Firebase/GCP is a good choice and reuses infra the user already has. Use onSchedule -> Cloud Run Job.**

## TikTok native scheduling — UNVERIFIED, must check in TikTok Studio UI
Agent could not confirm live (TikTok support pages 404'd / CAPTCHA). Last officially-confirmed baseline:
- Native scheduling exists via web (tiktok.com/tiktokstudio) and in-app. **10 days advance** was the 2022 launch cap;
  may have been extended — the scheduler UI shows the max selectable date, so check there.
- **Business/Pro account NOT required.** No published cap on pending scheduled posts.
- **No true bulk-schedule flow** — you can select multiple files in one session but each is configured and scheduled
  individually. TikTok Studio has a content calendar view, but batch-scheduling as one action is unconfirmed.
- **No official statement that scheduled / third-party / API-posted content gets less reach.** That claim is creator
  folklore; TikTok reps have pushed back on it in the past. No citable 2026 source either way.
=> Viable zero-cost fallback: a weekly manual session scheduling ~7-10 videos, ~15-30 min. Generation stays automated;
   only the publish leg is manual.
