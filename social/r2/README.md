# R2 provisioning runbook

Pf39c2-social-pilot-03 T01. This directory holds the checked-in, reproducible half of R2 provisioning
— the config files and the exact commands to apply and verify them. The actual bucket, custom domain
binding, and DNS record are provisioned **by hand**, outside of any agent session; nothing in this repo
runs `wrangler`, touches Cloudflare's API, or creates a real cloud resource.

## Why a custom domain, not `r2.dev`

Per the plan's Decisions: every R2 bucket gets a free `<bucket>.<account>.r2.dev` subdomain, but it is
**rate-limited and explicitly documented by Cloudflare as development-only** — not suitable for
production traffic such as Meta and YouTube fetching rendered assets on a schedule. `media.thinkplain.ai`,
a custom domain bound to the bucket, has no such rate limit and is the one used everywhere else in this
plan (`social/src/publish/env.ts`'s `R2_PUBLIC_BASE_URL`, `storage.ts`'s uploaded object URLs, etc).

## Why there is no `cors.json`

CORS is a **browser** enforcement mechanism — it governs whether JavaScript running on a web page in
one origin may read a cross-origin response. Every consumer of `media.thinkplain.ai` in this plan is a
server-side fetch, not a browser: Meta's container-creation API cURLs the media URL from Meta's own
infrastructure, and YouTube's resumable upload reads bytes we stream from R2 into a Google server. Nobody
loads these URLs from JavaScript in a browser tab. A missing `Access-Control-Allow-Origin` header cannot
block any of that, so no CORS configuration is provisioned. If a future browser-side consumer shows up
(e.g. an in-app preview player), add `social/r2/cors.json` and wire it up at that point — do not add it
speculatively now.

## 1. Create the bucket

```
wrangler r2 bucket create plain-social-media
```

(Bucket name is illustrative — use whatever name `social/src/publish/env.ts`'s `R2_BUCKET_NAME` is
configured with.)

## 2. Bind the custom domain

In the Cloudflare dashboard: **R2 → plain-social-media → Settings → Custom Domains → Connect Domain**,
enter `media.thinkplain.ai`. This requires the `thinkplain.ai` zone to already be on this Cloudflare
account — Cloudflare creates the CNAME automatically once the domain is connected. Confirm the DNS record
appears (`media` → the R2 endpoint) and that the domain's status flips to "Active" before moving on; it
can take a few minutes to propagate.

## 3. Apply the 30-day lifecycle rule

`social/r2/lifecycle.json` expresses the rule in the shape the S3-compatible `PutBucketLifecycleConfiguration`
API accepts (R2 implements this API directly, so it also works via the AWS CLI pointed at R2's S3
endpoint):

```
aws s3api put-bucket-lifecycle-configuration \
	--bucket plain-social-media \
	--lifecycle-configuration file://social/r2/lifecycle.json \
	--endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

(Requires an R2 API token with bucket-lifecycle permissions configured as the AWS CLI's access key
ID/secret — see Cloudflare's R2 "S3 API compatibility" docs for the credential setup; do not reuse the
Cloudflare account's global API key for this.)

Equivalently, via wrangler's own lifecycle subcommand (check `wrangler r2 bucket lifecycle --help` for the
exact flags on whatever wrangler version is installed at provisioning time — the subcommand's shape has
changed across wrangler releases):

```
wrangler r2 bucket lifecycle add plain-social-media \
	--name expire-after-30-days \
	--prefix "" \
	--expire-days 30
```

Verify the rule stuck:

```
aws s3api get-bucket-lifecycle-configuration \
	--bucket plain-social-media \
	--endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

or

```
wrangler r2 bucket lifecycle list plain-social-media
```

## 4. Verify the acceptance criterion

Upload one throwaway test object with an explicit content-type (mirrors the Constraint that every real
upload in `storage.ts` sets one too):

```
echo 'r2 provisioning test' > /tmp/r2-test-object.txt
aws s3 cp /tmp/r2-test-object.txt s3://plain-social-media/r2-test-object.txt \
	--content-type text/plain \
	--endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```

The acceptance criterion has three parts — check each explicitly:

**(a) HTTPS fetch succeeds:**

```
curl -sS -o /dev/null -w '%{http_code}\n' https://media.thinkplain.ai/r2-test-object.txt
```

Expect `200`.

**(b) `content-type` header is correct:**

```
curl -sSI https://media.thinkplain.ai/r2-test-object.txt | grep -i '^content-type:'
```

Expect `content-type: text/plain` (or whatever content-type the object was uploaded with — for a real
rendered asset this would be `video/mp4`).

**(c) Range requests work:**

```
curl -sS -D - -o /dev/null -r 0-99 https://media.thinkplain.ai/r2-test-object.txt
```

Expect a `206 Partial Content` status line and a `content-range:` response header (e.g.
`content-range: bytes 0-99/22`). If instead a `200` with the full body comes back, range support is not
working and the custom domain / bucket configuration needs investigation before moving on to T02.

Once all three pass, delete the test object:

```
aws s3 rm s3://plain-social-media/r2-test-object.txt \
	--endpoint-url https://<ACCOUNT_ID>.r2.cloudflarestorage.com
```
