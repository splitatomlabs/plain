/**
 * File-backed `TokenStore` — the durable-enough implementation for a LOCAL
 * daily run, where there is no Cloud Run Job and no Firestore project.
 *
 * WHY THIS EXISTS: `tokens.ts`'s `createInMemoryTokenStore` is explicitly
 * dry-run-only — its `Map` dies with the process, so a real run would lose a
 * refreshed token the moment the job exits, which is precisely the
 * "orphaned account" failure `token-store-firestore.ts`'s header describes.
 * `job.ts` already offers the same local/durable split for pending YouTube
 * flips (`--pending-flips-store local`, `createLocalPendingFlipsStore`);
 * this is the token half of that same pattern, so a machine-local run needs
 * no GCP project at all.
 *
 * WHEN NOT TO USE IT: anything that can run concurrently with itself. There
 * is no cross-process locking here — `set` is a read-modify-write over one
 * JSON file, safe only because a locally-scheduled run is single-process and
 * has no concurrent writer to race against. A Cloud Run execution genuinely
 * can overlap with itself (a retried trigger, a manual refresh alongside the
 * daily job), which is why `token-store-firestore.ts` pays for a real
 * `runTransaction` with read-before-write conflict detection. Do not reach
 * for this file to avoid that cost in a deployed environment; a Cloud Run
 * execution's filesystem is throwaway besides, so writes here would be lost.
 *
 * ONE GUARANTEE IT DOES KEEP, mirroring the Firestore store: `set` refuses
 * to overwrite a stored record whose `obtainedAt` is NEWER than the one
 * being written, throwing a clear, platform-named error rather than
 * silently clobbering it. That turns "two processes were run by hand at once
 * and one token was silently orphaned" into a loud failure.
 *
 * FILE PERMISSIONS: the file holds live credentials, so it is created with
 * mode 0600 (owner read/write only) rather than the default 0644. Nothing
 * here ever logs a token value — see `StoredToken.value`'s own comment.
 */

import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { Platform, StoredToken, TokenStore } from './tokens.js';

/** Owner read/write only — this file holds live credentials. */
const TOKEN_FILE_MODE = 0o600;

/** The default path `job.ts`/`collect.ts` use when `--token-store local` is passed without `--token-file`. */
export const DEFAULT_LOCAL_TOKEN_PATH = 'content/social/tokens.local.json';

/**
 * Parses the on-disk shape: a plain object keyed by platform, each value a
 * `StoredToken`. Throws with the offending platform named — never with a
 * token value in the message — so a hand-edited file fails loudly rather
 * than yielding `undefined` and looking like "no token seeded yet".
 */
function parseTokenFile(raw: string): Map<Platform, StoredToken> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new Error(`Local token file is not valid JSON: ${(error as Error).message}`);
	}
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Local token file must contain a JSON object keyed by platform.');
	}

	const records = new Map<Platform, StoredToken>();
	for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw new Error(`Local token file entry "${key}" is not an object.`);
		}
		const record = value as Record<string, unknown>;
		for (const field of ['value', 'obtainedAt', 'expiresAt'] as const) {
			if (typeof record[field] !== 'string' || record[field] === '') {
				throw new Error(`Local token file entry "${key}" is missing a non-empty "${field}".`);
			}
		}
		records.set(key as Platform, {
			platform: key as Platform,
			value: record.value as string,
			obtainedAt: record.obtainedAt as string,
			expiresAt: record.expiresAt as string
		});
	}
	return records;
}

function serializeTokenFile(records: Map<Platform, StoredToken>): string {
	const out: Record<string, Omit<StoredToken, 'platform'>> = {};
	// Sorted so a hand-inspected file has a stable key order across writes.
	for (const platform of [...records.keys()].sort()) {
		const record = records.get(platform)!;
		out[platform] = {
			value: record.value,
			obtainedAt: record.obtainedAt,
			expiresAt: record.expiresAt
		};
	}
	return `${JSON.stringify(out, null, '\t')}\n`;
}

/**
 * A `TokenStore` backed by one JSON file at `filePath`. A missing file reads
 * as "no tokens seeded yet" (`get` returns `undefined`) rather than
 * throwing — `ensureFreshToken` already fails loudly and names the platform
 * in that case, and that is the error a first-run operator should see.
 */
export function createLocalTokenStore(filePath: string): TokenStore {
	async function readAll(): Promise<Map<Platform, StoredToken>> {
		try {
			return parseTokenFile(await readFile(filePath, 'utf-8'));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Map();
			throw error;
		}
	}

	return {
		async get(platform: Platform): Promise<StoredToken | undefined> {
			return (await readAll()).get(platform);
		},

		async set(platform: Platform, record: StoredToken): Promise<void> {
			const records = await readAll();

			// Same guard as the Firestore store's transaction: never overwrite a
			// record that was persisted more recently than the one being written.
			const existing = records.get(platform);
			if (existing && Date.parse(existing.obtainedAt) > Date.parse(record.obtainedAt)) {
				throw new Error(
					`Refusing to overwrite a newer stored ${platform} token ` +
						`(stored obtainedAt ${existing.obtainedAt} is newer than ${record.obtainedAt}).`
				);
			}

			records.set(platform, record);
			await mkdir(path.dirname(filePath), { recursive: true });
			await writeFile(filePath, serializeTokenFile(records), { encoding: 'utf-8', mode: TOKEN_FILE_MODE });
			// `writeFile`'s `mode` only applies when it CREATES the file, so an
			// existing 0644 file (or one created before this was added) would keep
			// its looser permissions without this.
			await chmod(filePath, TOKEN_FILE_MODE);
		}
	};
}
