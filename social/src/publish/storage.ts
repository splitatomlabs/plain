/**
 * GCS upload (Pf39c2-social-pilot-03 F11, superseding T02's R2 version of
 * this file) — the one place that turns a `GcsConfig` (see `env.ts`) into a
 * `@google-cloud/storage` client and does the actual object writes.
 *
 * DECISION CHANGE — see `env.ts`'s header for the full "why", summarized
 * here for anyone landing on this file directly: object storage moved from
 * Cloudflare R2 to Google Cloud Storage because binding a custom domain to
 * R2 needs the DNS zone inside a Cloudflare account, and `thinkplain.ai`'s
 * nameservers are Google's (pointing at Vercel) — GCS instead serves objects
 * from the stable `https://storage.googleapis.com/<bucket>/<key>` URL with
 * no DNS change, and the pilot already needs a GCP project for Cloud Run
 * Jobs/Firestore/Secret Manager/Artifact Registry. `createGcsClient` builds
 * the client with `new Storage()` and NO explicit credentials — Application
 * Default Credentials (ADC), the Cloud Run Job's own attached service
 * account identity in production, exactly as `token-store-firestore.ts` and
 * `pending-flips-store-firestore.ts` already do for Firestore. There is no
 * access key/secret key pair anywhere in this module.
 *
 * PUBLIC READABILITY IS A BUCKET-POLICY CONCERN, NOT SOMETHING THIS FILE
 * DOES: Meta/YouTube fetch these URLs unauthenticated, so the bucket must
 * grant `allUsers` the `roles/storage.objectViewer` IAM role (uniform
 * bucket-level access — see `social/gcs/README.md`). This module never sets
 * a per-object ACL (predefined ACLs fight uniform bucket-level access, which
 * is the modern GCS default and what the runbook provisions) — public
 * readability comes entirely from the bucket's IAM policy, provisioned once,
 * out of band. If a future object needs to be private, that is a bucket/
 * prefix-level IAM decision, not a per-`uploadObject`-call option.
 *
 * Constraint from `plans/Pf39c2-social-pilot-03.md`, unchanged by the GCS
 * move: uploaded objects MUST carry an explicit `contentType` — Meta cURLs
 * the media URL directly and a missing/wrong content-type breaks container
 * creation. To make that structurally hard to violate, `contentType` is a
 * REQUIRED field on both `UploadObjectOptions` and `UploadFileOptions` (not
 * optional, no default), and is additionally checked at runtime in case a
 * caller constructs the options object dynamically and slips a blank string
 * past the type checker. `contentTypeFor` is offered as a convenience for
 * callers who want to derive it from a file extension, but it throws on an
 * unknown extension rather than silently falling back to
 * `application/octet-stream` — a silent fallback would defeat the whole
 * point of the constraint. This is also why `uploadObject` passes
 * `contentType` explicitly to `File#save` rather than letting the
 * `@google-cloud/storage` SDK guess a content-type from the key's extension
 * (it can, via its own `contentType: 'auto'` option) — that guess is exactly
 * the kind of silent fallback this module refuses to allow.
 *
 * Determinism policy (see the header comments in `pilot-config.ts` and
 * `render/post-metadata.ts`): the key builders below are pure functions of
 * their inputs, UNCHANGED by the GCS move — keys are a pure function of
 * `--date`/a base name, never the storage backend. Nothing here reads
 * `Date.now()` or generates a random suffix — the caller supplies the date
 * (already the convention for every date-taking function in this pipeline),
 * so re-running an upload for the same asset produces the same key, which is
 * what makes "assets are uploaded before any post is attempted" (the plan's
 * Decision) safe to retry.
 *
 * Keys are date-partitioned (`posts/<YYYY-MM-DD>/<basename>`) so that:
 *   - the 30-day lifecycle rule (`social/gcs/lifecycle.json`) prunes by age
 *     without needing per-object tagging, and
 *   - the weekly TikTok manual-staging folder is a natural sibling
 *     (`tiktokStagingKeyFor`, partitioned by the week's start date rather
 *     than a single day).
 *
 * Never logs or interpolates credentials into any error message. There is
 * even less to leak than the R2 version of this file had (no access key, no
 * secret key — ADC needs neither), but every error thrown below still names
 * only the offending key/path/extension, never anything from `GcsConfig`.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { Storage } from '@google-cloud/storage';

import type { GcsConfig } from './env.js';

/**
 * Builds the GCS client. `new Storage()` with no explicit credentials uses
 * Application Default Credentials — see this module's header comment. No
 * `GcsConfig` is needed to construct the client itself (unlike R2's
 * account-scoped endpoint); the bucket name is supplied per-call via
 * `config.bucketName` in `uploadObject`/`uploadFile` below, matching how
 * every other GCS-touching call in this module works.
 */
export function createGcsClient(): Storage {
	return new Storage();
}

// ---------------------------------------------------------------------------
// Deterministic key builders — unchanged by the GCS move, see header comment.
// ---------------------------------------------------------------------------

/**
 * The key for a daily post asset: `posts/<date>/<baseName>`. `date` is
 * caller-supplied (e.g. the render CLI's `--date`, matching
 * `pilot-config.ts`'s convention) — never derived from the system clock.
 */
export function postKeyFor(date: string, baseName: string): string {
	return `posts/${date}/${baseName}`;
}

/**
 * The key for a file staged for the weekly TikTok manual session:
 * `tiktok-staging/<weekStartDate>/<baseName>`, siblings to `postKeyFor`'s
 * `posts/<date>/` layout. `weekStartDate` is the ISO date the staging week
 * begins on. Kept intentionally minimal — `tiktok-manual.ts` owns the
 * manifest shape and can build further structure under this prefix as
 * needed.
 */
export function tiktokStagingKeyFor(weekStartDate: string, baseName: string): string {
	return `tiktok-staging/${weekStartDate}/${baseName}`;
}

/**
 * Joins the object's public URL. Uses `config.publicBaseUrl` when set
 * (e.g. a future custom domain in front of the bucket); otherwise defaults
 * to GCS's own public object URL shape,
 * `https://storage.googleapis.com/<bucketName>`. Tolerates a trailing slash
 * on the base URL and/or a leading slash on the key without producing a
 * double slash or dropping the separator — unchanged behaviour from the R2
 * version of this function.
 */
export function publicUrlFor(config: GcsConfig, key: string): string {
	const rawBase = config.publicBaseUrl ?? `https://storage.googleapis.com/${config.bucketName}`;
	const base = rawBase.replace(/\/+$/, '');
	const trimmedKey = key.replace(/^\/+/, '');
	return `${base}/${trimmedKey}`;
}

// ---------------------------------------------------------------------------
// Content-type mapping — unchanged by the GCS move.
// ---------------------------------------------------------------------------

/**
 * The only extensions this pilot's render pipeline actually produces.
 * Deliberately NOT exhaustive — `contentTypeFor` throws on anything else
 * rather than guessing, per the module's header comment.
 */
const EXTENSION_CONTENT_TYPES: Record<string, string> = {
	'.mp4': 'video/mp4',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.json': 'application/json',
	'.txt': 'text/plain',
};

/**
 * Derives a content-type from a file path's extension. Throws on an unknown
 * extension instead of falling back to `application/octet-stream` — see this
 * module's header comment for why a silent fallback here would defeat the
 * plan's Constraint.
 */
export function contentTypeFor(filePath: string): string {
	const extension = path.extname(filePath).toLowerCase();
	const contentType = EXTENSION_CONTENT_TYPES[extension];
	if (!contentType) {
		throw new Error(
			`No known content-type for extension "${extension}" (from "${filePath}"). Add it to ` +
				'EXTENSION_CONTENT_TYPES in social/src/publish/storage.ts rather than falling back to a generic type.'
		);
	}
	return contentType;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

function requireContentType(contentType: string): void {
	if (contentType.trim() === '') {
		throw new Error(
			'Refusing to upload to GCS with a blank contentType — every uploaded object must carry an explicit ' +
				'content-type (see this module\'s header comment and social/gcs/README.md).'
		);
	}
}

export interface UploadObjectOptions {
	client: Storage;
	config: GcsConfig;
	key: string;
	body: Buffer | Uint8Array;
	/** REQUIRED — see this module's header comment. Throws if blank. */
	contentType: string;
}

/** Uploads an in-memory buffer to GCS and returns its public URL. */
export async function uploadObject(options: UploadObjectOptions): Promise<string> {
	const { client, config, key, body, contentType } = options;
	requireContentType(contentType);

	await client.bucket(config.bucketName).file(key).save(body, { contentType });

	return publicUrlFor(config, key);
}

export interface UploadFileOptions {
	client: Storage;
	config: GcsConfig;
	filePath: string;
	key: string;
	/** REQUIRED — see this module's header comment. Throws if blank. */
	contentType: string;
}

/** Reads `filePath` from disk and uploads it to GCS, returning its public URL. */
export async function uploadFile(options: UploadFileOptions): Promise<string> {
	const { client, config, filePath, key, contentType } = options;
	const body = await readFile(filePath);
	return uploadObject({ client, config, key, body, contentType });
}
