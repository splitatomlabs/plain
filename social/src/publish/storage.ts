/**
 * R2 upload (Pf39c2-social-pilot-03 T02) — the one place that turns an
 * `R2Config` (see `env.ts`) into an S3-compatible client and does the
 * actual `PutObjectCommand` calls. R2 is S3-compatible, so this uses
 * `@aws-sdk/client-s3` pointed at R2's per-account endpoint rather than a
 * Cloudflare-specific SDK.
 *
 * Constraint from `plans/Pf39c2-social-pilot-03.md`: R2 objects MUST carry
 * an explicit `contentType` — Meta cURLs the media URL directly and a
 * missing/wrong content-type breaks container creation. To make that
 * structurally hard to violate, `contentType` is a REQUIRED field on both
 * `UploadObjectOptions` and `UploadFileOptions` (not optional, no default),
 * and is additionally checked at runtime in case a caller constructs the
 * options object dynamically and slips a blank string past the type
 * checker. `contentTypeFor` is offered as a convenience for callers who
 * want to derive it from a file extension, but it throws on an unknown
 * extension rather than silently falling back to `application/octet-stream`
 * — a silent fallback would defeat the whole point of the constraint.
 *
 * Determinism policy (see the header comments in `pilot-config.ts` and
 * `render/post-metadata.ts`): the key builders below are pure functions of
 * their inputs. Nothing here reads `Date.now()` or generates a random
 * suffix — the caller supplies the date (already the convention for every
 * date-taking function in this pipeline), so re-running an upload for the
 * same asset produces the same key, which is what makes "assets are
 * uploaded to R2 before any post is attempted" (this plan's Decision) safe
 * to retry.
 *
 * Keys are date-partitioned (`posts/<YYYY-MM-DD>/<basename>`) so that:
 *   - the 30-day lifecycle rule (`social/r2/lifecycle.json`, T01) prunes by
 *     age without needing per-object tagging, and
 *   - T07's weekly TikTok manual-staging folder is a natural sibling
 *     (`tiktokStagingKeyFor`, partitioned by the week's start date rather
 *     than a single day) — kept minimal here since T07 owns building out
 *     whatever else that manifest needs.
 *
 * Never logs or interpolates credentials into any error message (plan
 * Constraint) — every error thrown below names only the offending
 * key/path/extension, never anything from `R2Config`'s secret fields.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import type { R2Config } from './env.js';

/**
 * Builds the R2 client for a given config. `region: 'auto'` and the
 * account-scoped `endpoint` are what make the AWS S3 SDK talk to
 * Cloudflare R2 instead of real AWS — see Cloudflare's "S3 API
 * compatibility" docs (also referenced in `social/r2/README.md`).
 */
export function createR2Client(config: R2Config): S3Client {
	return new S3Client({
		region: 'auto',
		endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
		credentials: {
			accessKeyId: config.accessKeyId,
			secretAccessKey: config.secretAccessKey,
		},
	});
}

// ---------------------------------------------------------------------------
// Deterministic key builders
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
 * The key for a file staged for T07's weekly TikTok manual session:
 * `tiktok-staging/<weekStartDate>/<baseName>`, siblings to `postKeyFor`'s
 * `posts/<date>/` layout. `weekStartDate` is the ISO date the staging
 * week begins on. Kept intentionally minimal — T07 owns the manifest shape
 * and can build further structure under this prefix as needed.
 */
export function tiktokStagingKeyFor(weekStartDate: string, baseName: string): string {
	return `tiktok-staging/${weekStartDate}/${baseName}`;
}

/**
 * Joins `config.publicBaseUrl` and `key` into the object's public URL.
 * Tolerates a trailing slash on the base URL and/or a leading slash on the
 * key without producing a double slash or dropping the separator.
 */
export function publicUrlFor(config: R2Config, key: string): string {
	const base = config.publicBaseUrl.replace(/\/+$/, '');
	const trimmedKey = key.replace(/^\/+/, '');
	return `${base}/${trimmedKey}`;
}

// ---------------------------------------------------------------------------
// Content-type mapping
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
 * Derives a content-type from a file path's extension. Throws on an
 * unknown extension instead of falling back to `application/octet-stream`
 * — see this module's header comment for why a silent fallback here would
 * defeat the plan's Constraint.
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
			'Refusing to upload to R2 with a blank contentType — every R2 object must carry an explicit ' +
				'content-type (see this module\'s header comment and social/r2/README.md section 4).'
		);
	}
}

export interface UploadObjectOptions {
	client: S3Client;
	config: R2Config;
	key: string;
	body: Buffer | Uint8Array;
	/** REQUIRED — see this module's header comment. Throws if blank. */
	contentType: string;
}

/** Uploads an in-memory buffer to R2 and returns its public URL. */
export async function uploadObject(options: UploadObjectOptions): Promise<string> {
	const { client, config, key, body, contentType } = options;
	requireContentType(contentType);

	await client.send(
		new PutObjectCommand({
			Bucket: config.bucketName,
			Key: key,
			Body: body,
			ContentType: contentType,
		})
	);

	return publicUrlFor(config, key);
}

export interface UploadFileOptions {
	client: S3Client;
	config: R2Config;
	filePath: string;
	key: string;
	/** REQUIRED — see this module's header comment. Throws if blank. */
	contentType: string;
}

/** Reads `filePath` from disk and uploads it to R2, returning its public URL. */
export async function uploadFile(options: UploadFileOptions): Promise<string> {
	const { client, config, filePath, key, contentType } = options;
	const body = await readFile(filePath);
	return uploadObject({ client, config, key, body, contentType });
}
