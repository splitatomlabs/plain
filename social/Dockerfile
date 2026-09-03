# syntax=docker/dockerfile:1
#
# Pf39c2-social-pilot-03 T09: the container `social/src/job.ts` (the daily
# publish job) runs in as a Cloud Run Job (T10, not built yet).
#
# BUILD CONTEXT MUST BE THE REPO ROOT, not `social/` — see this file's
# "directory layout" note below for why (`content/output/` and
# `content/social/` live outside `social/` and Docker's COPY cannot reach
# outside the build context). From the repo root:
#
#   docker build --platform linux/amd64 -f social/Dockerfile -t plain-social .
#
# See `social/DOCKER.md` for the full build/run walkthrough (credentials,
# --date, etc). THIS BUILD HAS NOT BEEN RUN in the session that wrote this
# file — Docker was not available and running docker build/run was out of
# scope for that session. Everything below was verified by reading the
# actual source it depends on (`render/fonts.ts`, `render/card.ts`,
# `remotion/register-fonts.ts`, `render/encode.ts`, `job.ts`, `cli.ts`,
# `remotion/wall-pool.ts`, `audio/beds.ts`) rather than by a live build —
# closing this task's acceptance criterion (a real `docker run`) is left to
# whoever runs the commands in DOCKER.md.
#
# ---------------------------------------------------------------------------
# DIRECTORY LAYOUT — this image reproduces the monorepo's relative layout
# under /app, because several modules resolve paths relative to their own
# file location (via `import.meta.url`), not the process cwd:
#   - `remotion/wall-pool.ts`  -> ../../../content/output   (3 levels above social/src)
#   - `audio/beds.ts`          -> ../../assets/music         (2 levels above social/src)
#   - `render/fonts.ts`        -> node_modules/@fontsource-variable/* under `social/`
#   - `job.ts`/`cli.ts`        -> ../../content/social       (schedules, exclusions,
#                                 pending-youtube-flips.json, job-logs/)
# So /app plays the role of "repo root": /app/social/... and /app/content/...
# sit exactly where they do in this repo, and every one of those relative
# resolutions lands on the same file it would on a dev machine.
#
# ONE EXCEPTION that is NOT file-location-relative: `@remotion/renderer`
# resolves where to download/look for its own headless-Chrome binary
# ("Chrome Headless Shell") from `process.cwd()` at the moment it needs it
# (`getDownloadsCacheDir()` walks up from cwd to the nearest `package.json`
# and uses `<that dir>/node_modules/.remotion`) — NOT from any module's disk
# location. That is why this Dockerfile (a) copies the repo ROOT
# `package.json` into `/app` (its content is irrelevant; only its
# *existence* matters, so the walk-up stops at `/app` and lands on
# `/app/node_modules/.remotion`) and (b) runs both `remotion browser ensure`
# at build time and the job itself at runtime with WORKDIR `/app` — so the
# path Remotion resolves at build time (where the browser gets downloaded to)
# is the exact same path it resolves at runtime (where it looks for it).
# Get this cwd wrong and the container will try to download a browser fresh
# on every cold Cloud Run Job start, which is exactly what this task's
# acceptance criterion exists to prevent.
# ---------------------------------------------------------------------------

FROM node:24-bookworm-slim

# Fixed, user-independent path for Playwright's own browser cache (used by
# `render/card.ts`'s `chromium.launch()` — the IG feed-still renderer).
# Playwright's default cache location is under the CURRENT USER's home
# directory (`~/.cache/ms-playwright`), which would differ between the root
# user active during `npm ci`/`playwright install` below and the non-root
# `appuser` this image runs as at the bottom of this file — pinning an
# absolute path sidesteps that mismatch entirely. This is Playwright's own
# documented approach for custom Docker images.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# ---------------------------------------------------------------------------
# System packages
# ---------------------------------------------------------------------------
#
# ca-certificates: HTTPS for `npm ci`'s registry/postinstall fetches (incl.
#   ffmpeg-static/ffprobe-static's binary download, see the ffmpeg note
#   below) and for the job's own runtime calls to R2/Graph API/YouTube API.
# fontconfig: required for the system-wide Literata/DM Sans install further
#   below (`fc-cache`) AND because headless Chromium wants a working
#   fontconfig present even when a page's own CSS supplies every font it
#   needs via `data:` URLs (Chromium still probes the system font
#   configuration on startup) — this is the "insurance" this task's own
#   instructions call for, not the primary font-loading mechanism (see the
#   "SYSTEM FONT INSTALL" section below for what actually is).
#
# Chromium's OWN shared-library dependencies (libnss3, libatk*, libgtk-3-0,
# etc. — the long list Puppeteer/Playwright docs enumerate) are installed
# below via `playwright install --with-deps`, not hand-listed here: that
# flag detects the exact Debian release and the exact Chromium build
# Playwright is pinned to, and installs precisely the packages that build
# needs. Hand-maintaining that list here would silently drift out of sync
# with whatever Chromium version a future `playwright` bump pulls in.
RUN apt-get update && apt-get install -y --no-install-recommends \
		ca-certificates \
		fontconfig \
	&& rm -rf /var/lib/apt/lists/*

# ---------------------------------------------------------------------------
# Node dependencies
# ---------------------------------------------------------------------------

WORKDIR /app

# Copied for ONE reason only — see the "DIRECTORY LAYOUT" note above: its
# mere existence at /app is what makes `@remotion/renderer`'s cwd-relative
# browser-cache lookup land on /app/node_modules/.remotion, both at build
# time (below) and at container runtime. Nothing in this image runs `npm`
# against this file; it is never installed against.
COPY package.json ./package.json

COPY social/package.json social/package-lock.json ./social/
WORKDIR /app/social

# Full install — DO NOT add `--omit=dev` or set `NODE_ENV=production` here.
# `tsx` (this image's entrypoint interpreter, see the bottom of this file)
# and `typescript`/`vitest` are devDependencies in `social/package.json`; an
# omit-dev install would remove `tsx` and break the entrypoint outright.
# There is no separate "build" step for this TypeScript workspace to make a
# dev/prod split meaningful — `job.ts` and everything it imports are run
# directly by `tsx`, exactly as `plans/Pf39c2-social-pilot-03.md`'s own
# `## Verify` block and CLAUDE.md's examples do on a dev machine.
RUN npm ci

# Playwright's OWN Chromium (`render/card.ts`'s IG feed-still renderer) plus
# the Debian packages that specific build needs — see the "System packages"
# comment above for why `--with-deps` is preferred over a hand-listed apt
# set. Downloads into $PLAYWRIGHT_BROWSERS_PATH (set above), which is a
# fixed absolute path independent of which user is active.
RUN npx playwright install --with-deps chromium

WORKDIR /app

# Remotion's OWN browser ("Chrome Headless Shell") — a SEPARATE download
# from Playwright's Chromium above; `@remotion/renderer` never uses
# Playwright's copy. Run from /app (not /app/social) so the cwd-relative
# cache path this resolves to at build time
# (/app/node_modules/.remotion — see the header comment) is the exact path
# the running job will look in later, in the SAME WORKDIR (see the bottom of
# this file). This is what makes a cold Cloud Run Job start use the
# already-downloaded browser instead of fetching one on first render.
RUN node social/node_modules/@remotion/cli/remotion-cli.js browser ensure

# ---------------------------------------------------------------------------
# ffmpeg / ffprobe — deliberately NOT installed via apt.
# ---------------------------------------------------------------------------
#
# `render/encode.ts` resolves its ffmpeg/ffprobe binaries from the
# `ffmpeg-static`/`ffprobe-static` npm packages (`resolveFfmpegBinary`/
# `resolveFfprobeBinary`, via `createRequire`), falling back to a bare
# `ffmpeg`/`ffprobe` on PATH only if that package resolution itself fails
# for the current platform/arch. Those two packages are already regular
# `dependencies` in `social/package.json`, so `npm ci` above already fetched
# platform-matched STATIC (self-contained, no shared-library dependency)
# binaries for whatever platform/arch this image is built on — as long as
# that build platform is `linux/amd64` (see `social/DOCKER.md`'s documented
# build command; Cloud Run Jobs, this image's actual deploy target per T10,
# run amd64). A system `ffmpeg` package would be redundant weight: it would
# never be reached by `encode.ts`'s resolution order unless the npm
# packages' own resolution broke, and "install both to be safe" is exactly
# the kind of unjustified redundancy this task's instructions warned against.
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# SYSTEM FONT INSTALL — belt-and-braces, NOT the real mechanism.
# ---------------------------------------------------------------------------
#
# Read `render/fonts.ts`'s header comment first: this workspace does NOT
# depend on system-installed fonts at all. Both the Playwright still
# renderer (`render/card.ts`, via `getFontCss()`) and the Remotion bundle
# (`remotion/register-fonts.ts`, via the committed
# `remotion/fonts.generated.css`) get Literata and DM Sans by base64-inlining
# the exact `.woff2` files shipped in the `@fontsource-variable/literata` and
# `@fontsource-variable/dm-sans` npm packages directly into `@font-face` CSS
# — no network fetch, no filesystem lookup outside `node_modules`, and
# critically no dependency on ANY system font at render time. The real
# "font dependency" this image has is simply that `social/node_modules`
# (installed above, in full, un-pruned) is present — that alone is
# sufficient for both renderers to produce the correct typefaces.
#
# The two `cp`s below install the SAME two files system-wide anyway, purely
# as cheap insurance for any fallback code path and because Chromium wants a
# working fontconfig regardless (see the apt comment above) — never because
# this image's correctness depends on it. There is no Debian/apt package
# for Literata or DM Sans (they are Google Fonts, not in the default Debian
# archive), so "installing system-wide" here means placing the files
# fontconfig can already see and re-indexing, rather than `apt-get install
# fonts-literata` (which does not exist). Reusing the exact files already
# fetched by `npm ci` (rather than a fresh download) means there is no
# second, potentially-differing copy of either font in this image.
RUN mkdir -p /usr/share/fonts/truetype/plain-social \
	&& cp social/node_modules/@fontsource-variable/literata/files/literata-latin-wght-normal.woff2 \
		/usr/share/fonts/truetype/plain-social/ \
	&& cp social/node_modules/@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2 \
		/usr/share/fonts/truetype/plain-social/ \
	&& fc-cache -f /usr/share/fonts/truetype/plain-social

# ---------------------------------------------------------------------------
# Application source + the data the job reads at runtime
# ---------------------------------------------------------------------------
#
# `social/node_modules` and `social/out` are excluded from the build context
# by `social/.dockerignore` (node_modules was already installed fresh above,
# against THIS image's platform — copying a host-built node_modules in would
# reintroduce exactly the cross-platform native-binary problem `npm ci`
# above exists to avoid).
COPY social/ ./social/

# `content/output/` (the card corpus `remotion/wall-pool.ts` reads) and
# `content/social/` (the committed weekly schedules, `render-exclusions.json`,
# and `pending-youtube-flips.json` that `cli.ts`/`job.ts` read — see
# `job.ts`'s own header comment on why the pending-flips file is plain
# committed JSON, not Firestore) — both required at runtime, per this task's
# own instructions. `content/social/job-logs/` and stray `.DS_Store`s are
# excluded via `.dockerignore` (see that file's comments) so a previous local
# run's log files never get baked into the image.
COPY content/output ./content/output
COPY content/social ./content/social

# ---------------------------------------------------------------------------
# Non-root user
# ---------------------------------------------------------------------------
#
# Cloud Run Jobs run as root by default unless told otherwise; this image
# opts into a dedicated non-root user instead, for the usual least-privilege
# reasons AND because it is what makes Playwright's Chromium sandbox work at
# all: Chromium refuses to initialize its sandbox as EUID 0 ("Running as
# root without --no-sandbox is not supported") and `render/card.ts`'s
# `chromium.launch({ headless: true })` call passes no args to disable it —
# so running this image as root would need a code change to `card.ts`
# (out of scope for a Dockerfile-only task) to avoid a hard crash on first
# feed-still render. Running as non-root avoids that entirely: a normal
# Docker daemon (unlike gVisor — see the note below) supports the
# unprivileged user-namespace syscalls Chromium's sandbox needs for a
# non-root process, which is exactly why Playwright's own official Docker
# images run as a non-root user by the same reasoning.
#
# `@remotion/renderer`'s OWN browser launch (`open-browser.js`) is
# unaffected either way: it unconditionally passes `--no-sandbox
# --disable-setuid-sandbox` itself, root or not.
#
# KNOWN FOLLOW-UP for whoever deploys this to Cloud Run Jobs (T10): Cloud
# Run's execution sandbox is gVisor, which is documented to NOT fully
# support the user-namespace syscalls Chromium's sandbox needs even for a
# non-root process — this is a widely reported issue for headless
# Chrome/Puppeteer/Playwright specifically on Cloud Run (independent of this
# image's own user setup). If T10's real Cloud Run run fails with a
# sandbox/namespace error from Playwright's Chromium (Remotion's is already
# unaffected, see above), the fix is a one-line code change to
# `social/src/render/card.ts`'s `chromium.launch()` call
# (`args: ['--no-sandbox']`), not a Dockerfile change — deliberately not
# made preemptively here since it is unverified whether Cloud Run Jobs hits
# this in practice, and disabling a working sandbox pre-emptively for a
# problem that may not occur is its own tradeoff.
RUN groupadd --system appuser \
	&& useradd --system --gid appuser --home-dir /app --shell /usr/sbin/nologin appuser \
	&& mkdir -p /app/social/out /app/content/social/job-logs \
	&& chown -R appuser:appuser /app /ms-playwright

USER appuser

# ---------------------------------------------------------------------------
# Entrypoint
# ---------------------------------------------------------------------------
#
# WORKDIR stays /app (not /app/social) — see the header comment: this is
# what makes Remotion's cwd-relative browser-cache lookup at runtime match
# where `remotion browser ensure` downloaded it during the build above.
#
# `--date` is a RUNTIME argument, not baked in here, so the Cloud Run Job
# (T10) can pass a different one on every scheduled invocation:
#
#   docker run --rm plain-social --date 2026-09-01
#
# CMD supplies a friendly no-args default (prints job.ts's own --help) rather
# than baking in any date — `docker run plain-social` alone is a safe,
# read-only "what would this do" check; any arguments given on `docker run`
# replace CMD entirely, per normal ENTRYPOINT/CMD semantics.
ENTRYPOINT ["npx", "tsx", "social/src/job.ts"]
CMD ["--help"]
