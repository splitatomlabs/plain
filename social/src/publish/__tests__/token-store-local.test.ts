/**
 * Tests for `../token-store-local.ts` — the file-backed `TokenStore` used by
 * a LOCAL daily run (no Cloud Run Job, no Firestore project).
 *
 * These run against a real temp directory rather than a mocked `fs`: the
 * whole point of this store is its on-disk behaviour (a missing file reading
 * as "nothing seeded yet", a hand-edited file failing loudly, credentials
 * not being left world-readable), and mocking the filesystem would test the
 * mock rather than any of that.
 *
 * The `set`-refuses-a-newer-record case mirrors
 * `token-store-firestore.test.ts`'s equivalent: the failure it guards
 * against is the same orphaned-token lockout, just triggered by two hand-run
 * processes rather than two overlapping Cloud Run executions.
 *
 * NOTE ON TOKEN VALUES: the fixtures below use obviously-fake strings. No
 * assertion ever puts a token value into a message, matching
 * `StoredToken.value`'s "NEVER log this" contract.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createLocalTokenStore } from '../token-store-local.js';
import type { StoredToken } from '../tokens.js';

let dir: string;
let filePath: string;

beforeEach(async () => {
	dir = await mkdtemp(path.join(tmpdir(), 'plain-token-store-'));
	filePath = path.join(dir, 'nested', 'tokens.local.json');
});

afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

function token(overrides: Partial<StoredToken> = {}): StoredToken {
	return {
		platform: 'instagram',
		value: 'fake-token-value',
		obtainedAt: '2026-09-09T00:00:00.000Z',
		expiresAt: '2026-11-08T00:00:00.000Z',
		...overrides
	};
}

describe('createLocalTokenStore', () => {
	it('reads a missing file as "nothing seeded yet" rather than throwing', async () => {
		const store = createLocalTokenStore(filePath);
		await expect(store.get('instagram')).resolves.toBeUndefined();
	});

	it('round-trips a record through the file, creating parent directories', async () => {
		const store = createLocalTokenStore(filePath);
		await store.set('instagram', token());

		// A fresh store instance, so this reads from disk rather than any cache.
		await expect(createLocalTokenStore(filePath).get('instagram')).resolves.toEqual(token());
	});

	it('preserves other platforms’ records when one is written', async () => {
		const store = createLocalTokenStore(filePath);
		await store.set('instagram', token());
		await store.set('youtube', token({ platform: 'youtube', value: 'fake-yt-value' }));

		await expect(store.get('instagram')).resolves.toEqual(token());
		await expect(store.get('youtube')).resolves.toEqual(
			token({ platform: 'youtube', value: 'fake-yt-value' })
		);
	});

	it('overwrites a record whose stored obtainedAt is OLDER (the normal refresh case)', async () => {
		const store = createLocalTokenStore(filePath);
		await store.set('instagram', token({ obtainedAt: '2026-09-09T00:00:00.000Z' }));

		const refreshed = token({ obtainedAt: '2026-10-01T00:00:00.000Z', value: 'fake-refreshed' });
		await store.set('instagram', refreshed);

		await expect(store.get('instagram')).resolves.toEqual(refreshed);
	});

	it('REFUSES to overwrite a record whose stored obtainedAt is NEWER, naming the platform', async () => {
		const store = createLocalTokenStore(filePath);
		await store.set('instagram', token({ obtainedAt: '2026-10-01T00:00:00.000Z' }));

		const stale = token({ obtainedAt: '2026-09-09T00:00:00.000Z', value: 'fake-stale' });
		await expect(store.set('instagram', stale)).rejects.toThrow(/instagram/);

		// The newer record must still be intact — the point of the guard.
		const stored = await store.get('instagram');
		expect(stored?.obtainedAt).toBe('2026-10-01T00:00:00.000Z');
	});

	it('creates the file owner-read/write only, since it holds live credentials', async () => {
		await createLocalTokenStore(filePath).set('instagram', token());
		const mode = (await stat(filePath)).mode & 0o777;
		expect(mode).toBe(0o600);
	});

	it('tightens permissions on an already-loose existing file', async () => {
		const loosePath = path.join(dir, 'tokens.local.json');
		await writeFile(loosePath, '{}\n', { encoding: 'utf-8', mode: 0o644 });

		await createLocalTokenStore(loosePath).set('instagram', token());

		expect((await stat(loosePath)).mode & 0o777).toBe(0o600);
	});

	it('never writes the platform field redundantly inside each entry', async () => {
		await createLocalTokenStore(filePath).set('instagram', token());
		const parsed = JSON.parse(await readFile(filePath, 'utf-8'));
		expect(Object.keys(parsed)).toEqual(['instagram']);
		expect(parsed.instagram).not.toHaveProperty('platform');
	});

	describe('a hand-edited file fails loudly rather than reading as empty', () => {
		it('rejects invalid JSON', async () => {
			await writeFile(filePath.replace('/nested', ''), 'not json', 'utf-8');
			const store = createLocalTokenStore(filePath.replace('/nested', ''));
			await expect(store.get('instagram')).rejects.toThrow(/not valid JSON/i);
		});

		it('rejects a top-level array', async () => {
			const p = path.join(dir, 'tokens.local.json');
			await writeFile(p, '[]', 'utf-8');
			await expect(createLocalTokenStore(p).get('instagram')).rejects.toThrow(/object keyed by platform/i);
		});

		it('rejects an entry missing expiresAt, naming the entry', async () => {
			const p = path.join(dir, 'tokens.local.json');
			await writeFile(p, JSON.stringify({ instagram: { value: 'x', obtainedAt: '2026-09-09T00:00:00.000Z' } }), 'utf-8');
			await expect(createLocalTokenStore(p).get('instagram')).rejects.toThrow(/instagram.*expiresAt/i);
		});

		it('rejects an entry with a blank value', async () => {
			const p = path.join(dir, 'tokens.local.json');
			await writeFile(
				p,
				JSON.stringify({ youtube: { value: '', obtainedAt: '2026-09-09T00:00:00.000Z', expiresAt: '2026-11-08T00:00:00.000Z' } }),
				'utf-8'
			);
			await expect(createLocalTokenStore(p).get('youtube')).rejects.toThrow(/youtube.*value/i);
		});
	});
});
