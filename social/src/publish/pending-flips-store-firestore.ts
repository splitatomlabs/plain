/**
 * Firestore-backed `PendingFlipsStore` (Pf39c2-social-pilot-03 code review,
 * M4 fix) — the durable home for the week's uploaded-YouTube-video-id list
 * that `job.ts`'s `recordPendingFlip` writes and `metrics/collect.ts`'s
 * YouTube collection reads back.
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
 * SHAPE: one document (not one per platform, and not one per date) holding
 * the whole list under a `flips` field. The list stays small (at most one
 * new entry per pilot day) and is read-modify-write on every write — a
 * single document keeps that atomic via `runTransaction`, exactly like
 * `token-store-firestore.ts`'s `set`, guarding the same overlapping-run race
 * (a retried Cloud Run execution racing the previous one) even though the
 * consequence of losing that race here is a dropped bookkeeping row, not an
 * orphaned OAuth token.
 *
 * CREDENTIALS: constructed with NO explicit credentials — `new Firestore()`
 * uses Application Default Credentials (ADC), identical to
 * `token-store-firestore.ts`; the Cloud Run Job's own service-account
 * identity already needs Firestore access for the token store, so no new
 * IAM grant should be required for this second collection (confirm against
 * the deployed service account's role bindings before relying on that).
 *
 * This file has no dedicated unit test — like `token-store-firestore.ts`, it
 * is a thin adapter over `@google-cloud/firestore`; the read-modify-write
 * logic it sits behind (`upsertPendingFlip`, `parsePendingFlips`,
 * `serializePendingFlips`) is already covered by `job-plan.test.ts` and
 * `job.test.ts` against an in-memory `PendingFlipsStore` fake. It is,
 * however, type-checked as part of `tsc --noEmit`.
 */

import { Firestore } from '@google-cloud/firestore';

import type { PendingFlipsStore } from '../job-plan.js';
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
 * Builds a `PendingFlipsStore` backed by Firestore. `write` is a
 * `runTransaction` write-back so two overlapping writers can never both
 * land — see this file's header comment for why that matters.
 */
export function createFirestorePendingFlipsStore(options: FirestorePendingFlipsStoreOptions = {}): PendingFlipsStore {
	const client = options.client ?? new Firestore();
	const collection = options.collection ?? DEFAULT_COLLECTION;
	const docRef = client.collection(collection).doc(DOC_ID);

	return {
		async read(): Promise<PendingYouTubeFlip[]> {
			const snapshot = await docRef.get();
			if (!snapshot.exists) {
				return [];
			}
			const data = snapshot.data() as { flips?: PendingYouTubeFlip[] } | undefined;
			return data?.flips ?? [];
		},

		async write(flips: PendingYouTubeFlip[]): Promise<void> {
			// A transaction, not a plain `.set()` — see this file's header comment
			// for why an unconditional write can silently drop another writer's
			// already-committed row under an overlapping run.
			await client.runTransaction(async (transaction) => {
				transaction.set(docRef, { flips });
			});
		}
	};
}
