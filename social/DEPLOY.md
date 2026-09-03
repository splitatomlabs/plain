# Deploying the Cloud Run Job and Firebase trigger

`plans/Pf39c2-social-pilot-03.md` T10: deploy `social/cloud-run-job.yaml` (the daily publish job,
built from `social/Dockerfile`) and `functions/src/socialTrigger.ts` (the thin Firebase
`onSchedule` trigger that starts it), on a schedule off the hour.

**Status: NOT deployed.** Every command below is written for a human to run by hand. No
`gcloud`, `firebase`, `docker push`, or any other cloud-provisioning command has been run by any
session that wrote this file, and none was run to produce this doc — per this task's own
constraint. Read `social/DOCKER.md` first for the local build/run walkthrough (it covers the
`docker build`/`docker run` half of this in more depth); this doc picks up from "the image works
locally" and covers everything needed to make it run on a schedule in the cloud.

**A real prerequisite this doc cannot satisfy for you:** `social/src/publish/tokens.ts`'s
`ensureFreshToken` throws if no token document exists yet for a platform (see `token-store-
firestore.ts`), and there is no OAuth **authorization** flow built anywhere in this codebase yet
(T05/T06 built publish/upload only — see their DEFERRED notes in the plan). Before a scheduled run
can succeed end to end, a human must obtain an Instagram long-lived token and a YouTube OAuth
refresh+access token pair by hand (through each platform's own consent flow) and write the initial
`StoredToken` documents into the `social-pilot-tokens` Firestore collection (`instagram` and
`youtube` docs, shape: `{ value, expiresAt }` per `tokens.ts`) before attempting a real (non-`--dry-run`)
scheduled run. This is a one-time bootstrap, not part of T10's own deploy — noted here because "a
scheduled run executes end to end" (T10's acceptance) cannot happen without it.

**Object storage is GCS, not R2** (`plans/Pf39c2-social-pilot-03.md`'s "Decision change — GCS
replaces R2", 2026-09-03, and F11) — step 2 below provisions the bucket. See
`social/gcs/README.md` for the full reasoning and the bucket's own IAM/lifecycle setup in detail;
this doc only covers what's needed to wire it into the Cloud Run Job.

## 0. Prerequisites

- A GCP project with billing enabled (Cloud Run Jobs and Cloud Functions gen 2 both require it).
- `gcloud` and `firebase-tools` CLIs installed and authenticated (`gcloud auth login`, `gcloud auth
  application-default login`, `firebase login`) — by the person actually running this deploy, not
  by any automated session.
- Docker (see `social/DOCKER.md`'s own prerequisites) to build and push the image.
- Replace every `PROJECT_ID` placeholder below (and in `social/cloud-run-job.yaml`) with the real
  project id, and set the real project id in `.firebaserc` (currently a placeholder,
  `REPLACE_WITH_FIREBASE_PROJECT_ID`) — either edit that file directly or run `firebase use --add`.

Throughout, `us-central1` is used for both the Cloud Run Job and the Firebase Function/Cloud
Scheduler — matching `CLOUD_RUN_REGION` in `functions/src/socialTrigger.ts` and
`social/cloud-run-job.yaml`'s `metadata.labels`. Keep all three in sync if this ever changes.

## 1. Enable the required APIs

```bash
gcloud config set project PROJECT_ID

gcloud services enable \
  run.googleapis.com \
  storage.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  eventarc.googleapis.com \
  pubsub.googleapis.com
```

`cloudfunctions.googleapis.com`/`cloudbuild.googleapis.com`/`eventarc.googleapis.com`/
`pubsub.googleapis.com` are what a 2nd-gen `onSchedule` function is actually built on under the
hood (Cloud Scheduler creates a Pub/Sub-triggered Cloud Function via Eventarc) — the Firebase CLI
needs all of them enabled even though `socialTrigger.ts` never calls them directly.
`storage.googleapis.com` is usually enabled by default on a new project, but list it explicitly —
this deploy fails on step 2 below without it.

## 2. Provision the GCS bucket

Full detail (bucket creation, uniform bucket-level access, the public-read IAM binding, the 30-day
lifecycle rule, and the three-part HTTPS/content-type/range-request verification) lives in
`social/gcs/README.md` — run that runbook's sections 1-4 now. In short:

```bash
gcloud storage buckets create gs://BUCKET_NAME \
  --location=us-central1 \
  --uniform-bucket-level-access

gcloud storage buckets add-iam-policy-binding gs://BUCKET_NAME \
  --member=allUsers \
  --role=roles/storage.objectViewer

gcloud storage buckets update gs://BUCKET_NAME \
  --lifecycle-file=social/gcs/lifecycle.json
```

**Bucket names are globally unique across all of GCS** (not just this project) — see
`social/gcs/README.md`'s own callout on this. Whatever name you land on is what
`GCS_BUCKET_NAME` (`social/cloud-run-job.yaml`'s env var, step 6 below) must be set to.

## 3. Create the Firestore database (if this project does not already have one)

The token store (`social/src/publish/token-store-firestore.ts`) needs a Native-mode Firestore
database. Skip this if the project already has one (e.g. because `web/` already provisioned it —
check `docs/ARCHITECTURE.md` first; this pilot's plan itself says "no database" for the main app,
so this is likely the first Firestore use in this project):

```bash
gcloud firestore databases create --location=us-central1 --type=firestore-native
```

## 4. Create the service accounts (least privilege — no broad "Editor" role anywhere)

Two distinct identities, because they need different permissions:

- **`plain-social-job`** — the Cloud Run Job's own runtime identity. Needs to read/write its
  Firestore token documents, read/write objects in the GCS bucket from step 2 (via Application
  Default Credentials — no key file, no access-key secret, see `social/src/publish/env.ts`'s header
  comment), and read the Secret Manager secret(s) `cloud-run-job.yaml` references. It does NOT need
  permission to start Cloud Run executions (it never calls the Admin API — the Firebase trigger
  does that).
- **`plain-social-trigger`** — the Firebase Function's runtime identity. Needs ONLY permission to
  start an execution of the one specific Cloud Run Job. It does NOT need Firestore, Secret Manager,
  or GCS access — `socialTrigger.ts` never touches any of them.

```bash
gcloud iam service-accounts create plain-social-job \
  --display-name="Plain social pilot — Cloud Run Job runtime identity"

gcloud iam service-accounts create plain-social-trigger \
  --display-name="Plain social pilot — Firebase trigger runtime identity"
```

Grant `plain-social-job` Firestore access (`roles/datastore.user` — read/write documents, not
`roles/datastore.owner`, which also grants index/database administration this job never needs):

```bash
gcloud projects add-iam-policy-binding PROJECT_ID \
  --member="serviceAccount:plain-social-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/datastore.user"
```

Grant `plain-social-job` write access to the GCS bucket from step 2
(`roles/storage.objectAdmin`, scoped to the bucket, not the whole project — the job only ever
touches this one bucket):

```bash
gcloud storage buckets add-iam-policy-binding gs://BUCKET_NAME \
  --member="serviceAccount:plain-social-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/storage.objectAdmin"
```

(This is a separate binding from step 2's `allUsers` -> `roles/storage.objectViewer` grant — that
one makes objects publicly *readable* for Meta/YouTube to fetch; this one lets the job's own
identity *write* new objects in the first place.)

Secret Manager access for `plain-social-job` is granted per-secret in step 5 below, not at project
level — narrower than a single project-wide `roles/secretmanager.secretAccessor` binding.

`plain-social-trigger`'s permission to run the job is granted in step 7, after the job exists (the
IAM binding is on the job resource itself).

## 5. Create the Secret Manager secrets

**This list is shorter than it used to be.** Object storage moved from R2 to GCS
(`plans/Pf39c2-social-pilot-03.md`'s "Decision change — GCS replaces R2", F11): R2 needed five
secret `R2_*` values because it authenticated with an S3-compatible access-key pair; GCS
authenticates the job's own service account via Application Default Credentials (step 4 above), so
there is no storage secret at all. `GCS_BUCKET_NAME` is a plain env var in `cloud-run-job.yaml`
(not sensitive — see that file's own "SECRETS" comment), so it does not need a Secret Manager
entry either. The only secret left in this list is `IG_USER_ID`:

```bash
gcloud secrets create social-pilot-ig-user-id --replication-policy=automatic

# Add its actual value as the first version — the Instagram business account's IG_USER_ID:
printf '%s' 'YOUR_IG_USER_ID' | gcloud secrets versions add social-pilot-ig-user-id --data-file=-
```

Grant `plain-social-job` read access to it (least privilege — this deliberately does NOT use a
project-wide Secret Manager role):

```bash
gcloud secrets add-iam-policy-binding social-pilot-ig-user-id \
  --member="serviceAccount:plain-social-job@PROJECT_ID.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6. Build and push the image to Artifact Registry

```bash
gcloud artifacts repositories create plain-social \
  --repository-format=docker \
  --location=us-central1 \
  --description="Social pilot daily job image"

gcloud auth configure-docker us-central1-docker.pkg.dev

# From the repo root — see social/DOCKER.md for why the build context must be
# the repo root and why --platform linux/amd64 is required.
docker build --platform linux/amd64 -f social/Dockerfile \
  -t us-central1-docker.pkg.dev/PROJECT_ID/plain-social/plain-social:latest .

docker push us-central1-docker.pkg.dev/PROJECT_ID/plain-social/plain-social:latest
```

## 7. Create the Cloud Run Job

Edit `social/cloud-run-job.yaml`, replacing both `PROJECT_ID` placeholders (the image URL and the
service account email) and the `GCS_BUCKET_NAME` value's `PLACEHOLDER_BUCKET_NAME` with the real
bucket name from step 2, then:

```bash
gcloud run jobs replace social/cloud-run-job.yaml --region=us-central1
```

(`replace` creates the job if it does not exist yet, or updates it in place if it does — the same
command works for both the first deploy and every later config change, so this is the one command
to remember.)

Now grant `plain-social-trigger` permission to start executions of THIS job specifically. There is
no built-in predefined role scoped to exactly "start a job execution" (`roles/run.developer` and
`roles/run.admin` both include it, but both are far broader than this trigger needs — full
control over Cloud Run services and jobs, not just running one). Create a narrow custom role
instead:

```bash
gcloud iam roles create cloudRunJobRunner --project=PROJECT_ID \
  --title="Cloud Run Job Runner" \
  --description="Start executions of a specific Cloud Run Job — nothing else." \
  --permissions=run.jobs.run,run.jobs.get \
  --stage=GA

gcloud run jobs add-iam-policy-binding plain-social-daily \
  --region=us-central1 \
  --member="serviceAccount:plain-social-trigger@PROJECT_ID.iam.gserviceaccount.com" \
  --role="projects/PROJECT_ID/roles/cloudRunJobRunner"
```

## 8. Deploy the Firebase Function

Before deploying, replace the `PROJECT_ID` placeholder in `TRIGGER_SERVICE_ACCOUNT`
(`functions/src/socialTrigger.ts`) with the real project id — this is what makes the function run
under the least-privilege `plain-social-trigger` identity from step 4 rather than the project's
default (broader) compute service account, which is what 2nd-gen Firebase Functions use if
`serviceAccount` is left unset:

```bash
npm install --prefix functions
firebase deploy --only functions --project PROJECT_ID
```

## 9. Verify a scheduled run executed end to end (T10's acceptance criterion)

Do not wait for the next scheduled 07:53 America/New_York firing to find out if this works — force
one immediately:

```bash
firebase functions:shell --project PROJECT_ID
# then, inside the shell:
socialTrigger()
```

Or, without the CLI shell, trigger the underlying Cloud Scheduler job directly (Firebase creates
one job per `onSchedule` function, named after it):

```bash
gcloud scheduler jobs list --location=us-central1
gcloud scheduler jobs run firebase-schedule-socialTrigger-us-central1 --location=us-central1
```

**What success looks like, and exactly which logs to check:**

1. **The function's own log** — Cloud Logging, filtered to the function:
   ```bash
   gcloud functions logs read socialTrigger --region=us-central1 --limit=20
   ```
   Success: a line `Starting Cloud Run Job "plain-social-daily" for <date>.` followed by
   `Cloud Run Job "plain-social-daily" started for <date>.`, with no error in between. If this step
   fails, it is almost always the IAM binding from step 7 (the trigger's service account cannot
   call `jobs.run`) or a wrong region/job-name constant in `socialTrigger.ts` — the error message
   from the Cloud Run Admin API (surfaced verbatim in the thrown error, per that file's own
   comment) names which.

2. **The Cloud Run Job's execution** — confirm one actually started and finished:
   ```bash
   gcloud run jobs executions list --job=plain-social-daily --region=us-central1 --limit=5
   ```
   Success: a new execution appears with `STATUS: Succeeded` (not `Failed` or stuck `Running`),
   timestamped right after the trigger fired. `Failed` means the container ran but `job.ts` exited
   non-zero — see the next step for why.

3. **The job's own structured log lines**, inside that execution's logs:
   ```bash
   gcloud run jobs executions logs EXECUTION_ID --region=us-central1
   ```
   (or the Cloud Console -> Cloud Run -> Jobs -> `plain-social-daily` -> Executions -> the specific
   execution -> Logs tab). Cloud Run Jobs capture container stdout/stderr into Cloud Logging
   automatically — `job.ts`'s own file-based log (`content/social/job-logs/job-<date>.log`, see
   its header comment) still gets written INSIDE the container, but is ephemeral once the execution
   ends unless a volume is mounted; Cloud Logging is the durable copy to read here. Success:
   `=== Daily job for <date> ===`, then `[instagram] ok — published Reel, media id ...` and
   `[youtube] ok — uploaded private video, id ...` (the exact format from `job-plan.ts`'s
   `formatOutcomeLine`). A `[platform] failed — ...` line for one platform is a partial success at
   best — see `job.ts`'s own platform-isolation design: the OTHER platform still completing is
   expected and correct, but T10's "executes end to end" acceptance means both should read `ok` on
   a clean run.
4. **The actual post**, as a final human check: the Instagram account's feed/Reels tab shows a new
   post, and YouTube Studio's Content tab shows a new private video ready to flip (per T06's own
   note on this).

If step 3 shows `[instagram] failed` / `[youtube] failed` with a message naming a missing or
expired token, that is very likely the bootstrap prerequisite at the top of this doc (no token
document exists yet in Firestore) — not a bug in this deploy.

## Troubleshooting

- **`PERMISSION_DENIED` calling `jobs.run`** — the custom role binding from step 7 either wasn't
  applied, or was applied to the wrong service account. Re-run
  `gcloud run jobs get-iam-policy plain-social-daily --region=us-central1` and confirm
  `plain-social-trigger@PROJECT_ID.iam.gserviceaccount.com` is listed with
  `projects/PROJECT_ID/roles/cloudRunJobRunner`.
- **The Cloud Run execution fails immediately with a missing-secret error** — confirm the
  `social-pilot-ig-user-id` secret from step 5 has at least one version
  (`gcloud secrets versions list social-pilot-ig-user-id`) and that `plain-social-job`'s
  per-secret IAM binding was applied.
- **The Cloud Run execution fails uploading to GCS with a permission error** — confirm step 4's
  `roles/storage.objectAdmin` binding on the bucket was applied to `plain-social-job`, and that
  `GCS_BUCKET_NAME` in `social/cloud-run-job.yaml` matches the real bucket name from step 2 exactly
  (a typo here fails with a "bucket does not exist" or permission error that looks identical to a
  missing IAM binding — check the bucket name first, it's the more common mistake).
- **Meta/YouTube can't fetch an uploaded object (403 on the public URL)** — confirm step 2's
  `allUsers` -> `roles/storage.objectViewer` binding was applied; see `social/gcs/README.md`'s own
  verification section for the exact `curl` checks.
- **A Chromium sandbox error inside the execution logs** — see `social/Dockerfile`'s "Non-root
  user" comment and `social/DOCKER.md`'s troubleshooting section; this is a known Cloud Run gVisor
  issue independent of this deploy, with a documented one-line code fix if it occurs.
- **The scheduled Cloud Scheduler job never appears** — 2nd-gen `onSchedule` functions provision
  their own Cloud Scheduler job automatically on `firebase deploy`; if it's missing, re-check that
  every API in step 1 (especially `cloudscheduler.googleapis.com` and `eventarc.googleapis.com`)
  was enabled BEFORE the deploy, then redeploy.
