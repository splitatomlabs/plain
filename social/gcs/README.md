# GCS provisioning runbook

Pf39c2-social-pilot-03 F11 ("Decision change — GCS replaces R2", 2026-09-03). This directory
(renamed from `social/r2/`) holds the checked-in, reproducible half of object-storage provisioning
— the config files and the exact commands to apply and verify them. The actual bucket, IAM
bindings, and lifecycle rule are provisioned **by hand**, outside of any agent session; nothing in
this repo runs `gcloud`/`gsutil` or creates a real cloud resource.

## Why GCS, not R2

See `plans/Pf39c2-social-pilot-03.md`'s "Decision change — GCS replaces R2" section for the full
reasoning. Short version: binding a custom domain to Cloudflare R2 requires the DNS zone to live
inside the Cloudflare account, and `thinkplain.ai`'s nameservers are Google's (via Squarespace),
pointing at Vercel — R2 meant repointing the live app's domain before a single pilot post existed.
The pilot already needs a GCP project for Cloud Run Jobs, Firestore, Secret Manager and Artifact
Registry, so object storage joins it instead. GCS objects are served from the stable
`https://storage.googleapis.com/<bucket>/<key>` URL — no custom domain, no DNS change — and the
Cloud Run Job authenticates to GCS the same way it already authenticates to Firestore: Application
Default Credentials (ADC), its own attached service account identity. **There is no access key or
secret key anywhere in this design** — unlike R2, which needed an S3-compatible API token
(`R2_ACCESS_KEY_ID`/`R2_SECRET_ACCESS_KEY`).

## The one real gotcha: bucket names are GLOBALLY unique in GCS

Unlike R2 (where a bucket name only has to be unique within your Cloudflare account), a GCS bucket
name must be unique across **all of Google Cloud Storage, for every GCP customer**. A name like
`plain-social-media` is very likely already taken by someone else's project. Pick something
namespaced to this project specifically — e.g. `<your-gcp-project-id>-social-media` or
`plain-social-pilot-<random-suffix>` — and expect `gcloud storage buckets create` to fail with a
clear "that name is not available" error if you guess a collision; that is normal, not a
misconfiguration, just retry with a more specific name. Whatever name you land on is what
`GCS_BUCKET_NAME` (see `social/src/publish/env.ts`) must be set to.

## Why there is no `cors.json`

CORS is a **browser** enforcement mechanism — it governs whether JavaScript running on a web page
in one origin may read a cross-origin response. Every consumer of the bucket's public URLs in this
plan is a server-side fetch, not a browser: Meta's container-creation API cURLs the media URL from
Meta's own infrastructure, and YouTube's resumable upload reads bytes streamed from the local
render into a Google server. Nobody loads these URLs from JavaScript in a browser tab. A missing
`Access-Control-Allow-Origin` header cannot block any of that, so no CORS configuration is
provisioned. If a future browser-side consumer shows up (e.g. an in-app preview player), add
`social/gcs/cors.json` and wire it up at that point — do not add it speculatively now.

## 1. Create the bucket

```bash
gcloud config set project PROJECT_ID

gcloud storage buckets create gs://BUCKET_NAME \
	--location=us-central1 \
	--uniform-bucket-level-access
```

(`BUCKET_NAME` is illustrative — use whatever globally-unique name you land on per the gotcha
above, and set `social/src/publish/env.ts`'s `GCS_BUCKET_NAME` to match. `us-central1` matches the
region used everywhere else in this pilot's GCP resources — see `social/DEPLOY.md` — keep them in
sync if this ever changes.)

**`--uniform-bucket-level-access` is not optional here.** It disables per-object ACLs in favor of a
single bucket-level IAM policy. Step 2 below grants public read access via that IAM policy — mixing
per-object ACLs with uniform bucket-level access is exactly the kind of fight the plan's Constraint
warns against (`storage.ts`'s header comment: "object publicity comes from the bucket policy, not
from anything the upload code does"). If the bucket already exists without this flag, enable it
after the fact with:

```bash
gcloud storage buckets update gs://BUCKET_NAME --uniform-bucket-level-access
```

## 2. Grant public read access

Meta's Graph API and YouTube's resumable upload both fetch object URLs unauthenticated, so every
object in this bucket needs to be publicly readable. The correct mechanism under uniform
bucket-level access is an IAM binding granting `allUsers` the `roles/storage.objectViewer` role —
**not** a per-object ACL (`gcloud storage objects update --add-acl-grant` and similar), which
uniform bucket-level access disables entirely:

```bash
gcloud storage buckets add-iam-policy-binding gs://BUCKET_NAME \
	--member=allUsers \
	--role=roles/storage.objectViewer
```

This makes **every** object in the bucket publicly readable, not just ones tagged individually —
correct here since every object this pilot writes (`posts/`, `tiktok-staging/`) is meant to be
fetched by Meta/YouTube or opened by a human during the weekly TikTok session anyway. Do not narrow
this to a prefix-level binding unless a future object genuinely needs to stay private — that would
be a deliberate design change, not a default.

Verify the binding stuck:

```bash
gcloud storage buckets get-iam-policy gs://BUCKET_NAME
```

Expect a binding with `role: roles/storage.objectViewer` and `members: [allUsers]` in the output.

## 3. Apply the 30-day lifecycle rule

`social/gcs/lifecycle.json` expresses the rule in the shape `gcloud storage buckets update
--lifecycle-file` actually expects — confirmed against `gcloud storage buckets update --help`'s own
printed example, not transliterated from R2/S3's `PutBucketLifecycleConfiguration` shape (which
differs: S3/R2 wraps rules in `{"Rules": [...]}` with capitalized keys and an `"Expiration"` object;
GCS's CLI flag expects a bare `{"rule": [{"action": {...}, "condition": {...}}]}`, lowercase, with
`condition.age` in days directly — no `"Expiration"` wrapper):

```bash
gcloud storage buckets update gs://BUCKET_NAME \
	--lifecycle-file=social/gcs/lifecycle.json
```

Verify the rule stuck:

```bash
gcloud storage buckets describe gs://BUCKET_NAME --format="json(lifecycle_config)"
```

Expect the `lifecycle_config` field to echo back the rule (a `Delete` action with `age: 30`).

## 4. Verify the acceptance criterion

Upload one throwaway test object with an explicit content-type (mirrors the Constraint that every
real upload in `storage.ts` sets one too):

```bash
echo 'gcs provisioning test' > /tmp/gcs-test-object.txt
gcloud storage cp /tmp/gcs-test-object.txt gs://BUCKET_NAME/gcs-test-object.txt \
	--content-type=text/plain
```

The acceptance criterion has three parts — check each explicitly:

**(a) HTTPS fetch succeeds:**

```bash
curl -sS -o /dev/null -w '%{http_code}\n' \
	https://storage.googleapis.com/BUCKET_NAME/gcs-test-object.txt
```

Expect `200`. A `403` here almost always means step 2's IAM binding did not stick — re-check
`gcloud storage buckets get-iam-policy gs://BUCKET_NAME`.

**(b) `content-type` header is correct:**

```bash
curl -sSI https://storage.googleapis.com/BUCKET_NAME/gcs-test-object.txt | grep -i '^content-type:'
```

Expect `content-type: text/plain` (or whatever content-type the object was uploaded with — for a
real rendered asset this would be `video/mp4`).

**(c) Range requests work:**

```bash
curl -sS -D - -o /dev/null -r 0-99 \
	https://storage.googleapis.com/BUCKET_NAME/gcs-test-object.txt
```

Expect a `206 Partial Content` status line and a `content-range:` response header (e.g.
`content-range: bytes 0-99/23`). GCS supports range requests on every object natively — if a `200`
with the full body comes back instead, something is proxying/caching the request unexpectedly;
investigate before moving on.

Once all three pass, delete the test object:

```bash
gcloud storage rm gs://BUCKET_NAME/gcs-test-object.txt
```
