/**
 * Regression tests for `../pending-flips-store-firestore.ts`
 * (Pf39c2-social-pilot-03, M4 fix; follow-up code review after M4).
 *
 * A follow-up code review found that the FIRST fix for M4 repeated the
 * exact defect M2 was about, in a worse form: `createFirestorePendingFlipsStore`'s
 * `write` ran `client.runTransaction(async (t) => { t.set(docRef, { flips });
 * })` — a transaction whose callback never calls `transaction.get` has an
 * empty read set, so Firestore's optimistic concurrency detects nothing and
 * this offers exactly the same (zero) protection as a plain `.set()`. It was
 * WORSE than the M2 case because `job.ts`'s `recordPendingFlip` did the
 * read-modify-write ACROSS two separate calls — `read()`, append the day's
 * flip in memory, `write(merged)` — with the `read()` entirely OUTSIDE any
 * transaction. Two overlapping runs could each read the same starting list,
 * each append their own day, and whichever wrote second would silently drop
 * the other's already-committed video id.
 *
 * The fix replaces the separate `read`/`write` pair with one atomic
 * `append(flip)` call that does the WHOLE read-modify-write — `transaction.get`
 * first, merge via `upsertPendingFlip`, then `transaction.set` — inside a
 * single `runTransaction` call, so there is no longer a caller-visible window
 * between reading and writing for another writer to land in.
 *
 * These tests exercise the fix directly against a fake Firestore
 * client/transaction (no real database, no network), mirroring
 * `__tests__/token-store-firestore.test.ts`'s approach:
 *   - `append` must call `transaction.get` BEFORE `transaction.set`, on the
 *     SAME document reference — proving the document is actually in the
 *     transaction's read set, not just that some unrelated `get` happens.
 *   - THE ACTUAL BUG: a concurrent writer's already-committed entry must not
 *     be dropped by a second writer's `append` — writer A's entry must
 *     survive writer B's write.
 *   - The non-racing path still works (a fresh append with no existing
 *     document, and an append against an existing, non-conflicting list).
 *   - An empty/missing document reads back as `[]`, not an error.
 */

import { describe, expect, it, vi } from 'vitest';

import type { Firestore } from '@google-cloud/firestore';

import { createFirestorePendingFlipsStore } from '../pending-flips-store-firestore.js';
import type { PendingYouTubeFlip } from '../tiktok-manual.js';

/**
 * A fake Firestore `DocumentReference` — identified only by its path. `get`
 * (the standalone, non-transactional read `read()` uses) reads directly from
 * `documents`; `transaction.get`/`transaction.set` (below) are the ones
 * exercised inside `runTransaction`.
 */
class FakeDocumentReference {
	constructor(
		public readonly path: string,
		private readonly documents: Map<string, { flips: PendingYouTubeFlip[] }>
	) {}

	async get() {
		const data = this.documents.get(this.path);
		return {
			exists: data !== undefined,
			data: () => data
		};
	}
}

/**
 * A minimal fake of the slice of `@google-cloud/firestore`'s `Firestore`
 * client `createFirestorePendingFlipsStore` actually calls: `.collection(x).doc(y)`
 * to build a document reference, `.get()` for the standalone `read()` method,
 * and `.runTransaction(fn)` to run `fn` against a fake `Transaction` whose
 * `get`/`set` operate on an in-memory map keyed by document path.
 * `callOrder` records `'get'`/`'set'` in the order the transaction callback
 * invokes them, so tests can assert ordering, not just that both were
 * eventually called.
 */
function makeFakeFirestoreClient(initialFlips?: PendingYouTubeFlip[]) {
	const documents = new Map<string, { flips: PendingYouTubeFlip[] }>();
	if (initialFlips) {
		documents.set('social-pilot-pending-youtube-flips/flips', { flips: initialFlips });
	}

	const callOrder: string[] = [];

	const transactionGet = vi.fn(async (ref: FakeDocumentReference) => {
		callOrder.push('get');
		const data = documents.get(ref.path);
		return {
			exists: data !== undefined,
			data: () => data
		};
	});

	const transactionSet = vi.fn((ref: FakeDocumentReference, record: { flips: PendingYouTubeFlip[] }) => {
		callOrder.push('set');
		documents.set(ref.path, record);
	});

	const client = {
		collection(name: string) {
			return {
				doc(id: string) {
					return new FakeDocumentReference(`${name}/${id}`, documents);
				}
			};
		},
		async runTransaction(fn: (transaction: { get: typeof transactionGet; set: typeof transactionSet }) => Promise<void>) {
			return fn({ get: transactionGet, set: transactionSet });
		}
	};

	return {
		client: client as unknown as Firestore,
		documents,
		callOrder,
		transactionGet,
		transactionSet
	};
}

function makeFlip(overrides: Partial<PendingYouTubeFlip> = {}): PendingYouTubeFlip {
	return {
		date: '2026-08-27',
		cardId: 'meditations-08-020',
		videoId: 'yt-video-1',
		...overrides
	};
}

describe('createFirestorePendingFlipsStore — append (follow-up code review: transaction must read before it writes)', () => {
	it('calls transaction.get before transaction.set, on the same document, on every append', async () => {
		const { client, callOrder, transactionGet, transactionSet } = makeFakeFirestoreClient();
		const store = createFirestorePendingFlipsStore({ client });

		await store.append(makeFlip());

		expect(transactionGet).toHaveBeenCalledTimes(1);
		expect(transactionSet).toHaveBeenCalledTimes(1);
		expect(callOrder).toEqual(['get', 'set']);
		const getRef = transactionGet.mock.calls[0][0] as FakeDocumentReference;
		const setRef = transactionSet.mock.calls[0][0] as FakeDocumentReference;
		expect(setRef.path).toBe(getRef.path);
	});

	// THE ACTUAL BUG: two overlapping writers, modelled as writer A's append
	// committing before writer B's append begins. Under the original defect
	// (a write-only transaction fed a caller-assembled full list) B's write
	// would have been built from a `read()` taken before A ever wrote,
	// silently overwriting A's entry. `append`'s in-transaction read must
	// see A's already-committed entry and preserve it.
	it("writer A's already-committed entry survives writer B's append — the concurrent-writer scenario the defect was about", async () => {
		const { client, documents } = makeFakeFirestoreClient();
		const store = createFirestorePendingFlipsStore({ client });

		const flipA = makeFlip({ date: '2026-08-26', cardId: 'meditations-08-019', videoId: 'yt-video-a' });
		const flipB = makeFlip({ date: '2026-08-27', cardId: 'meditations-08-020', videoId: 'yt-video-b' });

		await store.append(flipA); // writer A commits first.
		await store.append(flipB); // writer B's append must read A's commit, not clobber it.

		expect(documents.get('social-pilot-pending-youtube-flips/flips')).toEqual({ flips: [flipA, flipB] });
		await expect(store.read()).resolves.toEqual([flipA, flipB]);
	});

	it('replaces an existing entry for the same date rather than duplicating it (upsert, not append-only)', async () => {
		const original = makeFlip({ videoId: 'yt-video-original' });
		const { client, documents } = makeFakeFirestoreClient([original]);
		const store = createFirestorePendingFlipsStore({ client });

		const rerun = makeFlip({ videoId: 'yt-video-rerun' });
		await store.append(rerun);

		expect(documents.get('social-pilot-pending-youtube-flips/flips')).toEqual({ flips: [rerun] });
	});

	it('succeeds when there is no existing document (first-ever flip)', async () => {
		const { client, documents } = makeFakeFirestoreClient();
		const store = createFirestorePendingFlipsStore({ client });

		const flip = makeFlip();
		await store.append(flip);

		expect(documents.get('social-pilot-pending-youtube-flips/flips')).toEqual({ flips: [flip] });
	});
});

describe('createFirestorePendingFlipsStore — read', () => {
	it('returns [] when the document does not exist', async () => {
		const { client } = makeFakeFirestoreClient();
		const store = createFirestorePendingFlipsStore({ client });

		await expect(store.read()).resolves.toEqual([]);
	});

	it('returns the stored list when the document exists', async () => {
		const flips = [makeFlip(), makeFlip({ date: '2026-08-28', videoId: 'yt-video-2' })];
		const { client } = makeFakeFirestoreClient(flips);
		const store = createFirestorePendingFlipsStore({ client });

		await expect(store.read()).resolves.toEqual(flips);
	});
});
