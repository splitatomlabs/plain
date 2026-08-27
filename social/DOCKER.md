# Running the social pilot daily job in Docker

`social/Dockerfile` packages `social/src/job.ts` (the daily publish job — see its own header
comment and `plans/Pf39c2-social-pilot-03.md` T08) into a container Node/ffmpeg/Chromium image,
for the Cloud Run Job T10 deploys. This doc is the exact build/run walkthrough for T09's
acceptance criterion: "the image renders a video via `docker run`."

**Status:** this build has not been run yet. It was written and verified by reading the source it
depends on (see the Dockerfile's own comments for the reasoning), not by a live `docker build`/
`docker run` — Docker was unavailable in the session that wrote it. Run the commands below to
actually close the acceptance criterion.

## Build

Run from the **repo root**, not `social/` — `social/Dockerfile` needs `content/output/` and
`content/social/`, which sit outside `social/`, so the build context must be the repo root (see
the Dockerfile's own "DIRECTORY LAYOUT" comment and `.dockerignore`'s header for why).

```bash
docker build --platform linux/amd64 -f social/Dockerfile -t plain-social:latest .
```

`--platform linux/amd64` matters: `ffmpeg-static`/`ffprobe-static` (see `render/encode.ts`) and
both browsers (Playwright's Chromium, Remotion's Chrome Headless Shell) are downloaded at build
time for whatever platform the build runs on. Cloud Run Jobs run amd64, so pin the build to that
even when building on an Apple Silicon (arm64) dev machine — otherwise the image would work
locally via QEMU emulation but need rebuilding before it could actually deploy.

Expect this build to take several minutes and pull down a few hundred MB (Chromium x2, ffmpeg
binaries, the full `social/node_modules`) — most of that is unavoidable given headless-Chrome
rendering is the whole point of this pipeline.

## Run — a real render, end to end

The job needs a `--date` that resolves to a real committed schedule slot. As of this writing only
`content/social/pilot-schedule-w01.json` (week 1) is committed — pick a date inside that week (see
`social/src/pilot-config.ts`'s `PILOT_WEEK_1_START` anchor for how dates map to weeks/days).

**`--dry-run` is the safest first check** — it renders for real (exercising every browser/ffmpeg
path this task cares about) but performs no uploads and no posts, so it needs zero credentials:

```bash
docker run --rm plain-social:latest --date <YYYY-MM-DD> --dry-run
```

A successful run prints `[instagram] DRY-RUN` / `[youtube] DRY-RUN` lines naming what each
platform would have done, and exits 0. This alone is enough to prove the image can render — the
video/feed-still files land at `/app/social/out/` inside the (now-stopped) container; add
`-v "$(pwd)/social/out:/app/social/out"` to a run if you want them on the host afterward.

**A no-args run** (`docker run --rm plain-social:latest`) prints `job.ts`'s own `--help` text
(the image's `CMD` default) and exits 0 — a safe way to confirm the entrypoint resolves at all
before trying a real date.

## Run — a real publish (needs credentials)

The full (non-dry-run) job also uploads to R2 and publishes to Instagram/YouTube. None of this is
live-tested yet (see `plans/Pf39c2-social-pilot-03.md` T01/T05/T06's DEFERRED notes) — this is
here for when it is.

Pass R2 credentials as environment variables (`social/src/publish/env.ts`'s `loadR2Config`):

```bash
docker run --rm \
  -e R2_ACCOUNT_ID=... \
  -e R2_BUCKET_NAME=... \
  -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... \
  -e R2_PUBLIC_BASE_URL=https://media.thinkplain.ai \
  -e IG_USER_ID=... \
  plain-social:latest --date <YYYY-MM-DD>
```

Token storage (`social/src/publish/token-store-firestore.ts`) uses **Application Default
Credentials**, never an env var with a secret in it (per the plan's "never log tokens... never env
vars" Constraint) — mount a service account key or a gcloud ADC file into the container and point
`GOOGLE_APPLICATION_CREDENTIALS` at it:

```bash
docker run --rm \
  -v "$HOME/.config/gcloud/application_default_credentials.json:/adc.json:ro" \
  -e GOOGLE_APPLICATION_CREDENTIALS=/adc.json \
  -e R2_ACCOUNT_ID=... -e R2_BUCKET_NAME=... -e R2_ACCESS_KEY_ID=... \
  -e R2_SECRET_ACCESS_KEY=... -e R2_PUBLIC_BASE_URL=https://media.thinkplain.ai \
  -e IG_USER_ID=... \
  plain-social:latest --date <YYYY-MM-DD>
```

On Cloud Run itself (T10), skip the mounted-file approach entirely — a Cloud Run Job's attached
service account IS its Application Default Credentials automatically, with no file or env var
needed for that part.

There is no real OAuth **refresh** implementation yet (`job.ts`'s `notImplementedRefresh` — see
its header comment): a run that reaches a token needing refresh will fail loudly by design until
that exists.

## Troubleshooting

- **A Chromium sandbox/namespace error from the Playwright render step** (the Instagram feed
  still, `render/card.ts`): see the Dockerfile's own "Non-root user" comment for the tradeoff this
  image took and the one-line follow-up fix if Cloud Run's gVisor sandbox turns out not to support
  it (this is a known Cloud Run + headless-Chrome gotcha independent of this image).
- **A "no browser found" error from Remotion's render step**: means the cwd Remotion resolved its
  browser cache path from at runtime didn't match where `remotion browser ensure` downloaded it at
  build time — see the Dockerfile's header comment on why WORKDIR must stay `/app` for both.
- **A missing schedule/card error**: `content/social/pilot-schedule-w<NN>.json` or
  `content/output/<book_slug>/*.json` wasn't baked into the image — confirm the build ran from the
  repo root (not `social/`) so those directories were in the build context at all.
