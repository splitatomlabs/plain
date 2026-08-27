/**
 * Firestore-backed `TokenStore` (Pf39c2-social-pilot-03 T04) — the durable
 * implementation of the `TokenStore` interface defined in `tokens.ts`, used
 * by the Cloud Run Job (T10) in production. `tokens.ts` itself stays
 * dependency-free and unit-testable against an in-memory fake; this file is
 * the one place that talks to a real database.
 *
 * WHY ATOMICITY MATTERS HERE: the plan's Constraint is "persist the
 * refreshed value BEFORE using it — a crash between refresh and persist
 * orphans the account." `ensureFreshToken` (in `tokens.ts`) already
 * guarantees the ordering half of that on the calling side (it awaits
 * `store.set` to completion before returning the refreshed token). This
 * file's job is to guarantee the OTHER half: that the write itself can never
 * partially land or be silently clobbered. The failure mode this guards
 * against is the same shape as the crash-between-refresh-and-persist case
 * `tokens.test.ts` covers, but triggered by concurrency instead of a
 * process crash — if the scheduled Cloud Run Job ever overlaps with itself
 * (e.g. a retried trigger while the previous run is still finishing, or a
 * manually-run token refresh script executed alongside the daily job), TWO
 * writers could both read the same "near expiry" token, both successfully
 * refresh it against the platform's API, and then race to persist. A plain
 * unconditional `set()` from each would let the second writer's document
 * silently overwrite the first's — and because Instagram invalidates the
 * OLD long-lived token once a refresh succeeds, whichever of the two
 * refreshed values does NOT end up persisted is an orphaned, now-invalid
 * token that nothing can recover: the account is locked out until a human
 * re-authenticates it by hand. Using a Firestore transaction (`runTransaction`)
 * to read-then-write the document closes that window: the transaction that
 * commits second observes the first transaction's write and Firestore
 * aborts one of the two, rather than letting either blindly stomp the other.
 *
 * CREDENTIALS: this client is constructed with NO explicit credentials —
 * `new Firestore()` uses Application Default Credentials (ADC), which is
 * how the Cloud Run Job (T10) authenticates: the job's attached service
 * account identity, no key file or secret ever committed to this repo or
 * passed through an env var. Locally, `gcloud auth application-default
 * login` sets up the same ADC path for manual testing.
 *
 * This file has no dedicated unit test — it is a thin adapter over
 * `@google-cloud/firestore`, and the refresh/alert logic it sits behind is
 * already covered by `__tests__/tokens.test.ts` against the in-memory fake.
 * It is, however, type-checked as part of `tsc --noEmit`.
 */

import { Firestore } from '@google-cloud/firestore';

import type { Platform, StoredToken, TokenStore } from './tokens.js';

/** The Firestore collection tokens are stored in, one document per platform. */
const DEFAULT_COLLECTION = 'social-pilot-tokens';

export interface FirestoreTokenStoreOptions {
	/** An existing `Firestore` client to reuse, or omit to construct one with ADC. */
	client?: Firestore;
	/** Overrides the collection name — mainly for isolating a staging/pilot project. */
	collection?: string;
}

/**
 * Builds a `TokenStore` backed by Firestore, one document per `Platform`
 * keyed by its name (`instagram`, `youtube`, `tiktok`) in `collection`.
 * `set` is a `runTransaction` write-back so two overlapping writers can
 * never both land — see this file's header comment for why that matters.
 */
export function createFirestoreTokenStore(options: FirestoreTokenStoreOptions = {}): TokenStore {
	const client = options.client ?? new Firestore();
	const collection = options.collection ?? DEFAULT_COLLECTION;

	function docRef(platform: Platform) {
		return client.collection(collection).doc(platform);
	}

	return {
		async get(platform: Platform): Promise<StoredToken | undefined> {
			const snapshot = await docRef(platform).get();
			if (!snapshot.exists) {
				return undefined;
			}
			return snapshot.data() as StoredToken;
		},

		async set(platform: Platform, record: StoredToken): Promise<void> {
			// A transaction, not a plain `.set()`: see this file's header comment
			// for why an unconditional write can orphan a token under overlapping
			// runs. Firestore aborts and retries the losing transaction rather than
			// letting it silently clobber the winner's already-committed write.
			await client.runTransaction(async (transaction) => {
				transaction.set(docRef(platform), record);
			});
		},
	};
}
