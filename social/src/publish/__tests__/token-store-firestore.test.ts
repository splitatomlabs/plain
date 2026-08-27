/**
 * Regression tests for `../token-store-firestore.ts` (Pf39c2-social-pilot-03
 * T04, code-review fix M2).
 *
 * Code review found that `createFirestoreTokenStore`'s `set` ran a
 * `runTransaction` callback that only called `transaction.set(...)`, never
 * `transaction.get(...)`. Firestore's optimistic-concurrency conflict
 * detection only covers documents that were READ inside the transaction —
 * a write-only transaction has an empty read set, so it offers exactly the
 * same (zero) protection as a plain, non-transactional `.set()` would. Two
 * overlapping writers (e.g. a retried Cloud Run trigger racing the previous
 * run) could each refresh the same near-expiry token and then both commit
 * their write unconditionally, with the second silently clobbering the
 * first. Because Instagram invalidates the OLD token once a refresh
 * succeeds, the clobbered value is unrecoverable — the account is locked
 * out until a human re-authenticates it.
 *
 * These tests exercise the fix directly against a fake Firestore
 * client/transaction (no real database, no network):
 *   - `set` must call `transaction.get` BEFORE `transaction.set` — proving
 *     the document is actually in the transaction's read set, not just
 *     that some `get` happens somewhere unrelated to the transaction.
 *   - `set` must REJECT, rather than overwrite, when the document already
 *     stored has a newer `obtainedAt` than the record being persisted —
 *     the "a concurrent writer already won" case — and the naming error
 *     must identify the platform. The previously-stored (newer) record
 *     must be left untouched.
 *   - `set` still succeeds (and calls `transaction.set`) when there is no
 *     existing document, or the existing one is not newer than the record
 *     being persisted — the common, non-racing path must keep working.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Firestore } from '@google-cloud/firestore';

import { createFirestoreTokenStore } from '../token-store-firestore.js';
import type { Platform, StoredToken } from '../tokens.js';

/** A fake Firestore `DocumentReference` — identified only by its path. */
class FakeDocumentReference {
	constructor(public readonly path: string) {}
}

/**
 * A minimal fake of the slice of `@google-cloud/firestore`'s `Firestore`
 * client `createFirestoreTokenStore` actually calls: `.collection(x).doc(y)`
 * to build a document reference, and `.runTransaction(fn)` to run `fn`
 * against a fake `Transaction` whose `get`/`set` operate on an in-memory map
 * keyed by document path. `callOrder` records `'get'`/`'set'` in the order
 * the transaction callback invokes them, so tests can assert ordering, not
 * just that both were eventually called.
 */
function makeFakeFirestoreClient(initialDocuments: Partial<Record<Platform, StoredToken>> = {}) {
	const documents = new Map<string, StoredToken>();
	for (const [platform, record] of Object.entries(initialDocuments)) {
		if (record) documents.set(`social-pilot-tokens/${platform}`, record);
	}

	const callOrder: string[] = [];

	const transactionGet = vi.fn(async (ref: FakeDocumentReference) => {
		callOrder.push('get');
		const data = documents.get(ref.path);
		return {
			exists: data !== undefined,
			data: () => data,
		};
	});

	const transactionSet = vi.fn((ref: FakeDocumentReference, record: StoredToken) => {
		callOrder.push('set');
		documents.set(ref.path, record);
	});

	const client = {
		collection(name: string) {
			return {
				doc(id: string) {
					return new FakeDocumentReference(`${name}/${id}`);
				},
			};
		},
		async runTransaction(fn: (transaction: { get: typeof transactionGet; set: typeof transactionSet }) => Promise<void>) {
			return fn({ get: transactionGet, set: transactionSet });
		},
	};

	return {
		client: client as unknown as Firestore,
		documents,
		callOrder,
		transactionGet,
		transactionSet,
	};
}

function makeToken(overrides: Partial<StoredToken> = {}): StoredToken {
	return {
		platform: 'instagram',
		value: 'secret-token-do-not-log-abc123',
		obtainedAt: '2026-08-27T00:00:00.000Z',
		expiresAt: '2026-10-26T00:00:00.000Z',
		...overrides,
	};
}

describe('createFirestoreTokenStore — set (M2 regression: transaction must read before it writes)', () => {
	it('calls transaction.get before transaction.set on every write', async () => {
		const { client, callOrder, transactionGet, transactionSet } = makeFakeFirestoreClient();
		const store = createFirestoreTokenStore({ client });

		await store.set('instagram', makeToken());

		expect(transactionGet).toHaveBeenCalledTimes(1);
		expect(transactionSet).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(['get', 'set']);
	});

	it('rejects, naming the platform, when a newer token is already stored — and does not overwrite it', async () => {
		const newerStored = makeToken({
			value: 'winner-of-the-race',
			obtainedAt: '2026-08-27T12:00:00.000Z',
		});
		const { client, documents, transactionSet } = makeFakeFirestoreClient({ instagram: newerStored });
		const store = createFirestoreTokenStore({ client });

		const staleRefresh = makeToken({
			value: 'loser-of-the-race',
			obtainedAt: '2026-08-27T11:00:00.000Z', // older than what's already stored
		});

		await expect(store.set('instagram', staleRefresh)).rejects.toThrow(/instagram/);

		// The already-stored, newer record must survive untouched.
		expect(transactionSet).not.toHaveBeenCalled();
		expect(documents.get('social-pilot-tokens/instagram')).toEqual(newerStored);
	});

	it('succeeds when there is no existing document (first write for a platform)', async () => {
		const { client, documents } = makeFakeFirestoreClient();
		const store = createFirestoreTokenStore({ client });
		const record = makeToken();

		await store.set('instagram', record);

		expect(documents.get('social-pilot-tokens/instagram')).toEqual(record);
	});

	it('succeeds when the record being persisted is newer than (or as new as) what is already stored', async () => {
		const older = makeToken({ value: 'old', obtainedAt: '2026-08-27T00:00:00.000Z' });
		const { client, documents } = makeFakeFirestoreClient({ instagram: older });
		const store = createFirestoreTokenStore({ client });

		const newer = makeToken({ value: 'new', obtainedAt: '2026-08-27T01:00:00.000Z' });
		await store.set('instagram', newer);

		expect(documents.get('social-pilot-tokens/instagram')).toEqual(newer);
	});
});
