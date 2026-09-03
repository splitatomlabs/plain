/**
 * Reads and validates the GCS configuration this pilot's publish path needs,
 * from the environment (Pf39c2-social-pilot-03 F11, superseding T01's R2
 * version of this file).
 *
 * DECISION CHANGE (`plans/Pf39c2-social-pilot-03.md`'s "Decision change — GCS
 * replaces R2", 2026-09-03): object storage moved from Cloudflare R2 to
 * Google Cloud Storage. Binding a custom domain to R2 needs the DNS zone
 * inside the Cloudflare account, and `thinkplain.ai` is on Google's
 * nameservers (via Squarespace) pointing at Vercel — R2 meant repointing the
 * live app's domain, plus a sixth vendor, before a single post existed. GCS
 * needs neither: objects are fetched from the stable
 * `https://storage.googleapis.com/<bucket>/<key>` URL, no DNS change, and
 * the pilot already needs a GCP project for Cloud Run Jobs, Firestore,
 * Secret Manager and Artifact Registry — storage just joins it.
 *
 * THE BIG WIN IS AUTHENTICATION, NOT JUST DNS: the Cloud Run Job already
 * authenticates to GCP via Application Default Credentials (ADC) — its
 * attached service account identity — exactly the way
 * `token-store-firestore.ts` and `pending-flips-store-firestore.ts` already
 * construct their Firestore clients with `new Firestore()` and no explicit
 * credentials. `storage.ts`'s `createGcsClient` does the same
 * (`new Storage()`, no key file, no env-var secret). That means there is NO
 * access-key material at all for this module to hold: R2's five `R2_*`
 * variables (`R2_ACCOUNT_ID`/`R2_BUCKET_NAME`/`R2_ACCESS_KEY_ID`/
 * `R2_SECRET_ACCESS_KEY`/`R2_PUBLIC_BASE_URL`) collapse to essentially just
 * the bucket name — and with the four dropped variables goes a whole
 * credential-leak surface (an R2 API token that could sit in a misconfigured
 * log, a leaked env dump, or a stray `console.log`).
 *
 * This module deliberately does ONLY parsing and validation — no GCS client
 * is constructed here. `storage.ts` is the one place that turns a
 * `GcsConfig` into an actual `Storage` client and does uploads. Keeping this
 * file small means the validation logic (and its tests) never need to touch
 * network code or a mocked client.
 *
 * `bucketName` is the one genuinely required field: the bucket
 * `social/gcs/README.md` walks through provisioning by hand (unlike R2,
 * a GCS bucket name must be GLOBALLY unique across all of GCS, not just this
 * project — see that runbook's own callout). `publicBaseUrl` is OPTIONAL: if
 * unset, `storage.ts`'s `publicUrlFor` defaults to
 * `https://storage.googleapis.com/<bucketName>`, which is exactly what a
 * plain GCS bucket (no custom domain) serves objects from. It exists purely
 * as an escape hatch for a future custom domain in front of the bucket —
 * nothing in this pilot's current design sets it.
 *
 * Constraint from the plan carried over unchanged: never log tokens/secrets.
 * This module holds itself to that bar for the values it handles too — every
 * error it throws names WHICH variable is missing or blank, but never echoes
 * back the value of that variable or of any other variable that happens to
 * be set. There is less secret material to leak now than in the R2 version
 * of this file (no access key, no secret key), but the discipline and its
 * test stay, since a bucket name or a public base URL landing in a crash
 * report is still not something to interpolate carelessly.
 */

export interface GcsConfig {
	bucketName: string;
	/**
	 * Optional override, e.g. a custom domain fronting the bucket. Unset by
	 * default — `storage.ts`'s `publicUrlFor` falls back to
	 * `https://storage.googleapis.com/<bucketName>` when this is absent. No
	 * trailing slash if set.
	 */
	publicBaseUrl?: string;
}

/**
 * Maps each `GcsConfig` field to the environment variable that supplies it.
 * Exported so a test (or a future caller building its own error message)
 * can enumerate the same names this module validates against without
 * duplicating the list. Only `bucketName` is required — `publicBaseUrl` is
 * read separately (see `GCS_PUBLIC_BASE_URL_ENV_VAR` below) since it is
 * optional and has no "missing variable" error of its own.
 */
export const GCS_ENV_VARS = {
	bucketName: 'GCS_BUCKET_NAME',
} as const satisfies Record<'bucketName', string>;

/** The optional public-base-URL override's environment variable name. */
export const GCS_PUBLIC_BASE_URL_ENV_VAR = 'GCS_PUBLIC_BASE_URL';

/**
 * Reads and validates the GCS configuration from `process.env` (or, in
 * tests, whatever env-like object is passed in). Throws a single `Error`
 * naming `GCS_BUCKET_NAME` if it is missing or blank — never a generic
 * "missing config" message, and never the value of any variable, present or
 * absent. `GCS_PUBLIC_BASE_URL` is optional and simply omitted from the
 * returned config when unset or blank.
 */
export function loadGcsConfig(env: NodeJS.ProcessEnv = process.env): GcsConfig {
	const bucketName = requireEnv(env, GCS_ENV_VARS.bucketName);
	const publicBaseUrl = env[GCS_PUBLIC_BASE_URL_ENV_VAR];

	return publicBaseUrl ? { bucketName, publicBaseUrl } : { bucketName };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (value === undefined || value === '') {
		throw new Error(
			`GCS configuration is missing the "${name}" environment variable. ` +
				'See social/gcs/README.md for how to provision the bucket and set it.'
		);
	}
	return value;
}
