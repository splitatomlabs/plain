/**
 * Token management for the pilot's OAuth-gated publish targets
 * (Pf39c2-social-pilot-03 T03/T04).
 *
 * THIS FILE IS THE RED HALF OF A TDD PAIR (T03). Every exported function
 * below has a real signature — so `__tests__/tokens.test.ts` compiles and
 * the type-checker holds callers to the intended shape — but a body that
 * throws `Error('not implemented')`. T04 fills the bodies in; nothing here
 * is expected to make the T03 tests pass. A green run of
 * `tokens.test.ts` against this file is a BUG in the test, not a sign T04
 * is done.
 *
 * Constraints from `plans/Pf39c2-social-pilot-03.md` this module exists to
 * encode:
 *   - Instagram long-lived tokens expire in 60 days and must be refreshed.
 *     Meta rejects a refresh attempt against a token that is not yet at
 *     least 24 hours old — `MIN_REFRESH_AGE_MS` below. When a token is both
 *     near expiry AND younger than 24h, `ensureFreshToken` must NOT attempt
 *     the refresh (it would be rejected anyway) and instead returns the
 *     existing token unchanged. Detecting that a token is stuck in that
 *     window before it actually expires is `expiryAlert`'s job, not
 *     `ensureFreshToken`'s — the daily job (T08) is expected to call both.
 *   - "Persist the refreshed value BEFORE using it — a crash between
 *     refresh and persist orphans the account." This is the single most
 *     important behaviour under test: `ensureFreshToken` must `await
 *     store.set(...)` to completion BEFORE returning the refreshed token to
 *     its caller. If the persist rejects, the refreshed token must never
 *     reach the caller — the error must propagate, and the OLD token must
 *     remain the one readable back out of the store.
 *   - Never log tokens. Store them in Secret Manager or Firestore, never
 *     env vars — this module holds itself to the "never log" half of that
 *     bar: no function here may pass a token value to `console.*`, and no
 *     error message it throws may interpolate one.
 *
 * Determinism policy (see `pilot-config.ts`'s header comment): nothing in
 * this module reads `Date.now()`. Every function that needs "now" takes it
 * as an explicit `now: string` (ISO 8601) parameter, exactly like every
 * other date-taking function in this pipeline. Callers (ultimately the
 * daily job) are responsible for supplying the real wall-clock time; tests
 * supply whatever fixed instant the scenario needs.
 *
 * `TokenStore` is deliberately just an interface here. T03 (this task) only
 * needs an in-memory fake to drive the tests above; T04 adds a
 * Firestore-backed implementation of the same interface behind an ATOMIC
 * write-back (`set` — a single document write, or a transaction if the
 * Firestore implementation ever needs read-modify-write semantics) without
 * this module's refresh/alert logic having to change at all.
 */

export type Platform = 'instagram' | 'youtube' | 'tiktok';

/**
 * A single stored OAuth/long-lived token. All timestamps are ISO 8601
 * strings, caller-supplied — nothing in this module stamps `obtainedAt` or
 * `expiresAt` from the system clock.
 */
export interface StoredToken {
	platform: Platform;
	/** The raw token/credential value. NEVER pass this to `console.*` or interpolate it into an Error message. */
	value: string;
	/** ISO 8601 instant this token was issued or last refreshed. */
	obtainedAt: string;
	/** ISO 8601 instant this token stops being valid. */
	expiresAt: string;
}

/**
 * Storage abstraction so the refresh/alert logic under test never touches a
 * real database. `set` is documented as an ATOMIC write-back: T04's
 * Firestore implementation must replace the stored record for `platform` in
 * a single write (or transaction) — never a partial/read-modify-write that
 * could observe or leave behind a half-updated record.
 */
export interface TokenStore {
	get(platform: Platform): Promise<StoredToken | undefined>;
	/** Atomically replaces the stored record for `platform` with `record`. */
	set(platform: Platform, record: StoredToken): Promise<void>;
}

/**
 * A token is refreshed once it is within this long of its expiry. Chosen
 * comfortably shorter than Instagram's 60-day token lifetime so a refresh
 * attempt has multiple daily job runs to succeed in before expiry, while
 * staying well clear of the `MIN_REFRESH_AGE_MS` floor below.
 */
export const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Meta rejects an Instagram long-lived-token refresh unless the CURRENT
 * token is at least this old. `ensureFreshToken` must not attempt a refresh
 * before this floor, even if the token is also within `REFRESH_WINDOW_MS`
 * of expiry.
 */
export const MIN_REFRESH_AGE_MS = 24 * 60 * 60 * 1000;

/** `expiryAlert` fires once a token's expiry is inside this many days. */
export const EXPIRY_ALERT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

/** Parses an ISO 8601 instant to epoch milliseconds, throwing on anything unparseable. */
function toEpochMs(iso: string): number {
	const ms = Date.parse(iso);
	if (Number.isNaN(ms)) {
		throw new Error(`Invalid ISO 8601 timestamp: "${iso}".`);
	}
	return ms;
}

/**
 * Whether `token` is close enough to `expiresAt` (within `REFRESH_WINDOW_MS`
 * of `now`) to warrant a refresh attempt. This is purely an expiry check —
 * it does NOT consider `MIN_REFRESH_AGE_MS`; that gate lives in
 * `ensureFreshToken`, which is the only function allowed to decide whether a
 * refresh is actually attempted.
 */
export function needsRefresh(token: StoredToken, now: string): boolean {
	throw new Error('not implemented');
}

/**
 * A function that calls the platform's refresh endpoint for `current` and
 * returns the new `StoredToken`. Injected so `ensureFreshToken` (and its
 * tests) never make a network call. Takes `now` for the same reason every
 * other function here does — so a real implementation can stamp
 * `obtainedAt` without reading the system clock itself.
 */
export type RefreshFn = (current: StoredToken, now: string) => Promise<StoredToken>;

export interface EnsureFreshTokenOptions {
	store: TokenStore;
	platform: Platform;
	now: string;
	refresh: RefreshFn;
}

/**
 * Returns a token for `platform` that is safe to use right now, refreshing
 * it first if needed and eligible.
 *
 * - If the stored token is not near expiry (`needsRefresh` is false),
 *   returns it unchanged. `refresh` and `store.set` are never called.
 * - If it IS near expiry but younger than `MIN_REFRESH_AGE_MS`, Meta would
 *   reject the refresh — returns the existing token unchanged rather than
 *   attempting it. `refresh` and `store.set` are never called.
 * - Otherwise, calls `refresh(current, now)`, then `await`s
 *   `store.set(platform, refreshed)` to COMPLETION before returning
 *   `refreshed` — the refreshed value is never handed to the caller until
 *   it is durably persisted. If `store.set` rejects, the rejection
 *   propagates out of `ensureFreshToken` and the refreshed token is never
 *   returned; the store's existing (old) record is left exactly as it was,
 *   so the account is not orphaned.
 *
 * Throws if there is no stored token for `platform` at all — there is
 * nothing to refresh or return.
 */
export async function ensureFreshToken(options: EnsureFreshTokenOptions): Promise<StoredToken> {
	throw new Error('not implemented');
}

/** Raised by `expiryAlert` when a token's expiry has entered the alert window. */
export interface TokenExpiryAlert {
	platform: Platform;
	expiresAt: string;
	/** May be zero or negative if the token has already expired by `now`. */
	daysRemaining: number;
}

/**
 * Returns an alert when `token` expires within `EXPIRY_ALERT_WINDOW_MS`
 * (inclusive) of `now`, so an operator can refresh or re-authenticate
 * before the account is cut off. Returns `undefined` when expiry is
 * further out than that.
 */
export function expiryAlert(token: StoredToken, now: string): TokenExpiryAlert | undefined {
	throw new Error('not implemented');
}
