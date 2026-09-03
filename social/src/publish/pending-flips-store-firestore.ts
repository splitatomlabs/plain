/**
 * Firestore-backed `PendingFlipsStore` (Pf39c2-social-pilot-03 code review,
 * M4 fix; corrected again in a follow-up review — see "WHY `append`, NOT
 * `read`/`write`" below) — the durable home for the week's
 * uploaded-YouTube-video-id list that `job.ts`'s `recordPendingFlip` writes
 * and `metrics/collect.ts`'s YouTube collection reads back.
 *
 * WHY THIS EXISTS: the list used to be a plain JSON file
 * (`content/social/pending-youtube-flips.json`) written under Cloud Run,
 * whose container filesystem is THROWAWAY — every execution starts from the
 * image's baked-in copy and every write vanishes when the container exits.
 * That meant no upload was ever durably recorded, `metrics/collect.ts`'s
 * `collectYouTubeRows` had nothing to read and always returned `[]`, and
 * `recordPendingFlip`'s failure was swallowed as a warning on an otherwise-
 * `ok` outcome — the readout's YouTube half (its ONLY source of exact
 * per-post follow attribution, per the plan's Decision) was silently empty
 * for the whole pilot. Firestore already holds the OAuth tokens for exactly
 * this "durable, read by more than one process, written by the one daily
 * job" shape — see `token-store-firestore.ts`'s header — so this file mirrors
 * that pattern rather than inventing a second cloud dependency.
 *
 * WHY `append`, NOT `read`/`write` (follow-up code review — this store's
 * FIRST fix repeated the exact defect M2 was about, in a worse form): the
 * original version of this file's `write` ran
 *   `client.runTransaction(async (t) => { t.set(docRef, { flips }); })`
 * — a transaction whose callback never calls `transaction.get` has an EMPTY
 * read set, so Firestore's optimistic concurrency detects nothing and this
 * offers exactly the same (zero) protection as a plain `.set()` would. That
 * is the identical write-only-transaction mistake `token-store-firestore.ts`
 * was fixed for in M2. It was WORSE here, because the caller
 * (`job.ts`'s `recordPendingFlip`) did the read-modify-write ACROSS two
 * separate store calls: `read()`, append the day's flip in memory, then
 * `write(merged)` — with the `read()` happening entirely OUTSIDE any
 * transaction. Two overlapping runs (a retried Cloud Run execution racing
 * the previous one — the same scenario M4 already worried about) could both
 * `read()` the same starting list, both append their own day, and whichever
 * called `write()` second would silently discard the other's
 * already-committed video id, with no error raised anywhere. The fix is not
 * "make `write` read before it writes" (option (b) — reading a caller-
 * supplied FULL list inside a transaction still can't tell which entries in
 * that list are new versus stale, since the caller computed it from a
 * possibly-outdated `read()`); it is to stop exposing a `write(fullList)`
 * call at all. `append(flip)` takes exactly ONE new flip and does the
 * ENTIRE read-modify-write inside a single `runTransaction` call below:
 * `transaction.get` first (establishing the read set), merge via
 * `upsertPendingFlip`, then `transaction.set`. There is no window between a
 * read and a write for another writer to land in, because there is no
 * separate "read" step for a caller to split its own call across.
 *
 * SHAPE: one document (not one per platform, and not one per date) holding
 * the whole list under a `flips` field. The list stays small (at most one
 * new entry per pilot day).
 *
 * CREDENTIALS: constructed with NO explicit credentials — `new Firestore()`
 * uses Application Default Credentials (ADC), identical to
 * `token-store-firestore.ts`; the Cloud Run Job's own service-account
 * identity already needs Firestore access for the token store, so no new
 * IAM grant should be required for this second collection (confirm against
 * the deployed service account's role bindings before relying on that).
 *
 * This file's `append` has a dedicated unit test —
 * `__tests__/pending-flips-store-firestore.test.ts` — against a fake
 * `Firestore` client/transaction, mirroring
 * `__tests__/token-store-firestore.test.ts`'s approach, since the
 * read-inside-transaction behaviour is specific to this adapter and is
 * exactly the thing the follow-up review found broken. The merge logic it
 * sits behind (`upsertPendingFlip`, `parsePendingFlips`,
 * `serializePendingFlips`) is already covered by `job-plan.test.ts` and
 * `job.test.ts` against an in-memory `PendingFlipsStore` fake. It is,
 * in addition, type-checked as part of `tsc --noEmit`.
 */

import { Firestore } from '@google-cloud/firestore';

import { upsertPendingFlip, type PendingFlipsStore } from '../job-plan.js';
import type { PendingYouTubeFlip } from './tiktok-manual.js';

/** The Firestore collection the pending-flips list is stored in. */
const DEFAULT_COLLECTION = 'social-pilot-pending-youtube-flips';
/** The single document (within `DEFAULT_COLLECTION`) holding the whole list. */
const DOC_ID = 'flips';

export interface FirestorePendingFlipsStoreOptions {
	/** An existing `Firestore` client to reuse, or omit to construct one with ADC. */
	client?: Firestore;
	/** Overrides the collection name — mainly for isolating a staging/pilot project. */
	collection?: string;
}

/**
 * Builds a `PendingFlipsStore` backed by Firestore. `append` reads the
 * document inside a `runTransaction` call BEFORE writing it back —
 * establishing the read set Firestore's optimistic concurrency needs —
 * merges the new flip via `upsertPendingFlip`, and persists the merged list
 * in the SAME transaction. See this file's header comment ("WHY `append`,
 * NOT `read`/`write`") for why a write-only transaction, or a `write` that
 * takes a caller-assembled full list, would not have been enough.
 */
export function createFirestorePendingFlipsStore(options: FirestorePendingFlipsStoreOptions = {}): PendingFlipsStore {
	const client = options.client ?? new Firestore();
	const collection = options.collection ?? DEFAULT_COLLECTION;
	const docRef = client.collection(collection).doc(DOC_ID);

	async function readCurrent(): Promise<PendingYouTubeFlip[]> {
		const snapshot = await docRef.get();
		if (!snapshot.exists) {
			return [];
		}
		const data = snapshot.data() as { flips?: PendingYouTubeFlip[] } | undefined;
		return data?.flips ?? [];
	}

	return {
		read: readCurrent,

		async append(flip: PendingYouTubeFlip): Promise<void> {
			await client.runTransaction(async (transaction) => {
				// MUST read inside the transaction, and BEFORE the write below: this
				// is what puts the document in the transaction's read set, which is
				// what lets Firestore detect a concurrent writer at all. A
				// transaction whose callback only calls `.set()` has an empty read
				// set and offers no protection whatsoever — see this file's header
				// comment ("WHY `append`, NOT `read`/`write`").
				const snapshot = await transaction.get(docRef);
				const data = snapshot.exists ? (snapshot.data() as { flips?: PendingYouTubeFlip[] } | undefined) : undefined;
				const existing = data?.flips ?? [];
				const updated = upsertPendingFlip(existing, flip);
				transaction.set(docRef, { flips: updated });
			});
		}
	};
}
