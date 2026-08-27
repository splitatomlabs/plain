/**
 * Reads and validates the R2 configuration this pilot's publish path needs,
 * from the environment (Pf39c2-social-pilot-03 T01).
 *
 * This module deliberately does ONLY parsing and validation — no R2 client
 * is constructed here. T02 (`storage.ts`) is the one place that turns an
 * `R2Config` into an actual S3-compatible client and does uploads. Keeping
 * this file small means the validation logic (and its tests) never need to
 * touch network code or a mocked client.
 *
 * Every field here corresponds to something `social/r2/README.md` walks
 * through provisioning by hand: `R2_ACCOUNT_ID`/`R2_BUCKET_NAME` identify
 * the bucket created in that runbook's step 1, `R2_ACCESS_KEY_ID`/
 * `R2_SECRET_ACCESS_KEY` are an R2 API token's credentials (see the
 * runbook's step 3 note about NOT reusing the account's global API key),
 * and `R2_PUBLIC_BASE_URL` is `https://media.thinkplain.ai` — the custom
 * domain bound in the runbook's step 2, per the plan's Decision that the
 * default `r2.dev` subdomain is rate-limited and development-only.
 *
 * Constraint from the plan: never log tokens. This module holds itself to
 * that bar for the values it handles too — every error it throws names
 * WHICH variable is missing or blank, but never echoes back the value of
 * that variable or of any other variable that happens to be set. A config
 * error is a very ordinary way for a secret to end up captured in a log
 * aggregator or crash report, so the validation below never interpolates
 * an env value into a message, only a variable NAME.
 */

export interface R2Config {
	accountId: string;
	bucketName: string;
	accessKeyId: string;
	secretAccessKey: string;
	/** e.g. `"https://media.thinkplain.ai"` — no trailing slash. */
	publicBaseUrl: string;
}

/**
 * Maps each `R2Config` field to the environment variable that supplies it.
 * Exported so a test (or a future caller building its own error message)
 * can enumerate the same names this module validates against without
 * duplicating the list.
 */
export const R2_ENV_VARS = {
	accountId: 'R2_ACCOUNT_ID',
	bucketName: 'R2_BUCKET_NAME',
	accessKeyId: 'R2_ACCESS_KEY_ID',
	secretAccessKey: 'R2_SECRET_ACCESS_KEY',
	publicBaseUrl: 'R2_PUBLIC_BASE_URL',
} as const satisfies Record<keyof R2Config, string>;

/**
 * Reads and validates the R2 configuration from `process.env` (or, in
 * tests, whatever env-like object is passed in). Throws a single `Error`
 * naming the FIRST missing or blank variable it finds, in the field order
 * `R2Config` declares them — never a generic "missing config" message, and
 * never the value of any variable, present or absent.
 */
export function loadR2Config(env: NodeJS.ProcessEnv = process.env): R2Config {
	const accountId = requireEnv(env, R2_ENV_VARS.accountId);
	const bucketName = requireEnv(env, R2_ENV_VARS.bucketName);
	const accessKeyId = requireEnv(env, R2_ENV_VARS.accessKeyId);
	const secretAccessKey = requireEnv(env, R2_ENV_VARS.secretAccessKey);
	const publicBaseUrl = requireEnv(env, R2_ENV_VARS.publicBaseUrl);

	return { accountId, bucketName, accessKeyId, secretAccessKey, publicBaseUrl };
}

function requireEnv(env: NodeJS.ProcessEnv, name: string): string {
	const value = env[name];
	if (value === undefined || value === '') {
		throw new Error(
			`R2 configuration is missing the "${name}" environment variable. ` +
				'See social/r2/README.md for how to provision R2 and set it.'
		);
	}
	return value;
}
