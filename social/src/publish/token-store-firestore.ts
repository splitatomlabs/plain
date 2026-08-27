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
 * silently clobber a more-recently-persisted record. The failure mode this
 * guards against is the same shape as the crash-between-refresh-and-persist
 * case `tokens.test.ts` covers, but triggered by concurrency instead of a
 * process crash — if the scheduled Cloud Run Job ever overlaps with itself
 * (e.g. a retried trigger while the previous run is still finishing, or a
 * manually-run token refresh script executed alongside the daily job), TWO
 * writers could both read the same "near expiry" token, both successfully
 * refresh it against the platform's API, and then race to persist. Because
 * Instagram invalidates the OLD long-lived token once a refresh succeeds,
 * whichever of the two refreshed values does NOT end up persisted is an
 * orphaned, now-invalid token that nothing can recover: the account is
 * locked out until a human re-authenticates it by hand.
 *
 * A `runTransaction` call whose callback only WRITES — never reads a
 * document — does NOT protect against this: Firestore's optimistic
 * concurrency only detects a conflict against documents that were read
 * inside the transaction, so a write-only transaction has an empty read set
 * and two overlapping writers both commit unconditionally, exactly as if
 * `runTransaction` were not used at all. To actually close the window, `set`
 * below reads the document with `transaction.get` FIRST (establishing the
 * read set Firestore's conflict detection needs) and then refuses to
 * overwrite a stored record whose `obtainedAt` is newer than the one being
 * persisted, throwing a clear, platform-named error instead of clobbering
 * it silently.
 *
 * CREDENTIALS: this client is constructed with NO explicit credentials —
 * `new Firestore()` uses Application Default Credentials (ADC), which is
 * how the Cloud Run Job (T10) authenticates: the job's attached service
 * account identity, no key file or secret ever committed to this repo or
 * passed through an env var. Locally, `gcloud auth application-default
 * login` sets up the same ADC path for manual testing.
 *
 * This file's `set` conflict-detection logic (read-before-write, and the
 * refuse-to-overwrite-a-newer-record guard) has a dedicated unit test —
 * `__tests__/token-store-firestore.test.ts` — against a fake `Firestore`
 * client/transaction, since that behaviour is specific to this adapter and
 * not exercised by `__tests__/tokens.test.ts`'s in-memory fake. The
 * refresh/alert logic this store sits behind remains covered there.
 * This file is, in addition, type-checked as part of `tsc --noEmit`.
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
 * `set` reads the document inside a `runTransaction` call BEFORE writing it
 * — establishing the read set Firestore's optimistic concurrency needs — and
 * refuses to overwrite a record that is already newer than the one being
 * persisted. See this file's header comment for why a write-only
 * transaction would not have been enough.
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
			await client.runTransaction(async (transaction) => {
				const ref = docRef(platform);
				// MUST read inside the transaction, and BEFORE the write below: this
				// is what puts the document in the transaction's read set, which is
				// what lets Firestore detect a concurrent writer at all. A
				// transaction whose callback only calls `.set()` has an empty read
				// set and offers no protection whatsoever — see this file's header
				// comment.
				const existing = await transaction.get(ref);
				if (existing.exists) {
					const existingRecord = existing.data() as StoredToken;
					if (Date.parse(existingRecord.obtainedAt) > Date.parse(record.obtainedAt)) {
						// A concurrent writer already persisted a token newer than the one
						// we're about to write. Overwriting it would silently orphan that
						// newer (and, for Instagram, now the only valid) token. Refuse
						// instead of clobbering it — the caller's refresh attempt is
						// discarded, which is safe, since the currently-stored token is
						// already fresher than what this call was trying to persist.
						throw new Error(
							`Refusing to overwrite ${platform} token: a newer token (obtainedAt=${existingRecord.obtainedAt}) is already stored than the one being persisted (obtainedAt=${record.obtainedAt}). A concurrent writer likely already refreshed this token.`
						);
					}
				}
				transaction.set(ref, record);
			});
		},
	};
}
