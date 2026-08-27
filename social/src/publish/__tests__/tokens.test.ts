/**
 * Tests for `../tokens.ts` (Pf39c2-social-pilot-03 T03 — the RED half of a
 * TDD pair; T04 implements `tokens.ts` and makes these pass).
 *
 * These tests are written against the intended behaviour, not the current
 * (`Error('not implemented')`) bodies, so running them now is EXPECTED to
 * fail — every test either throws that explicit "not implemented" error or
 * fails its own assertion. A green run here would mean the test itself is
 * wrong, not that T04 is done early.
 *
 * Coverage, matching the plan's Constraints and this task's brief:
 *   - `needsRefresh` fires once a token is within the refresh window of
 *     expiry, and not before.
 *   - `ensureFreshToken` refreshes a token that is both near expiry AND at
 *     least `MIN_REFRESH_AGE_MS` old; it must NOT refresh a token that is
 *     near expiry but younger than that floor (Meta rejects that refresh),
 *     even though the two conditions conflict in that scenario.
 *   - THE CRITICAL CASE: `ensureFreshToken` persists the refreshed token
 *     (`store.set`, awaited to completion) BEFORE the refreshed value is
 *     returned to the caller. Proven by recording a call/resolution
 *     sequence in a fake store, not by inspecting the implementation's
 *     shape.
 *   - A crash between refresh and persist (a rejecting `store.set`) must
 *     propagate the error rather than ever handing the caller an
 *     unpersisted token, and must leave the OLD token as the one still
 *     readable back out of the store — the account is not orphaned.
 *   - `expiryAlert` fires once expiry is inside `EXPIRY_ALERT_WINDOW_MS`
 *     (30 days) of `now`, and not before.
 *   - No token value is ever passed to `console.*` or embedded in a thrown
 *     error's message.
 *
 * Every timestamp below is a fixed ISO 8601 string derived by plain
 * arithmetic from a single constant `NOW` — nothing here reads
 * `Date.now()`, matching this repo's determinism policy (see
 * `pilot-config.ts`'s header comment and `tokens.ts`'s own).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
	EXPIRY_ALERT_WINDOW_MS,
	MIN_REFRESH_AGE_MS,
	REFRESH_WINDOW_MS,
	ensureFreshToken,
	expiryAlert,
	needsRefresh,
	type Platform,
	type StoredToken,
	type TokenStore,
} from '../tokens.js';

const NOW = '2026-08-27T00:00:00.000Z';
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Adds `ms` (possibly negative) to an ISO 8601 instant, returning an ISO 8601 string. */
function offset(iso: string, ms: number): string {
	return new Date(Date.parse(iso) + ms).toISOString();
}

function makeToken(overrides: Partial<StoredToken> = {}): StoredToken {
	return {
		platform: 'instagram',
		value: 'secret-token-do-not-log-abc123',
		obtainedAt: offset(NOW, -40 * DAY_MS),
		expiresAt: offset(NOW, 20 * DAY_MS),
		...overrides,
	};
}

// ---------------------------------------------------------------------------
// An in-memory fake TokenStore. Tests configure `onSet` to observe ordering
// or to simulate a failed (crashed) persist, but the fake never itself
// decides refresh/alert behaviour — that stays entirely inside `tokens.ts`.
// ---------------------------------------------------------------------------

interface FakeStoreOptions {
	/** Called synchronously when `set` is invoked, before its own resolution/rejection logic runs. */
	onSet?: (platform: Platform, record: StoredToken) => void;
	/** If set, `set` awaits this many ms before resolving/rejecting — lets tests prove real awaiting, not fire-and-forget. */
	setDelayMs?: number;
	/** If set, `set` rejects with this error instead of committing the record. */
	setRejection?: Error;
}

function makeFakeStore(initial: StoredToken, options: FakeStoreOptions = {}) {
	const records = new Map<Platform, StoredToken>([[initial.platform, initial]]);

	const get = vi.fn(async (platform: Platform): Promise<StoredToken | undefined> => {
		return records.get(platform);
	});

	const set = vi.fn(async (platform: Platform, record: StoredToken): Promise<void> => {
		options.onSet?.(platform, record);
		if (options.setDelayMs) {
			await new Promise((resolve) => setTimeout(resolve, options.setDelayMs));
		}
		if (options.setRejection) {
			// Simulate an atomic write that never committed: the map is left untouched.
			throw options.setRejection;
		}
		records.set(platform, record);
	});

	const store: TokenStore = { get, set };
	return { store, get, set, records };
}

describe('needsRefresh', () => {
	it('is false when expiry is far beyond the refresh window', () => {
		const token = makeToken({ expiresAt: offset(NOW, REFRESH_WINDOW_MS + 30 * DAY_MS) });
		expect(needsRefresh(token, NOW)).toBe(false);
	});

	it('is true when expiry is inside the refresh window', () => {
		const token = makeToken({ expiresAt: offset(NOW, REFRESH_WINDOW_MS - HOUR_MS) });
		expect(needsRefresh(token, NOW)).toBe(true);
	});

	it('is true right at the refresh window boundary (inclusive)', () => {
		const token = makeToken({ expiresAt: offset(NOW, REFRESH_WINDOW_MS) });
		expect(needsRefresh(token, NOW)).toBe(true);
	});

	it('is false just outside the refresh window boundary', () => {
		const token = makeToken({ expiresAt: offset(NOW, REFRESH_WINDOW_MS + 1) });
		expect(needsRefresh(token, NOW)).toBe(false);
	});

	it('is true for a token that has already expired', () => {
		const token = makeToken({ expiresAt: offset(NOW, -HOUR_MS) });
		expect(needsRefresh(token, NOW)).toBe(true);
	});
});

describe('ensureFreshToken — refresh near expiry', () => {
	it('refreshes and persists a token that is near expiry and old enough', async () => {
		const oldToken = makeToken({
			obtainedAt: offset(NOW, -40 * DAY_MS),
			expiresAt: offset(NOW, 2 * DAY_MS),
		});
		const newToken = makeToken({
			value: 'secret-token-refreshed-xyz789',
			obtainedAt: NOW,
			expiresAt: offset(NOW, 60 * DAY_MS),
		});
		const { store, set } = makeFakeStore(oldToken);
		const refresh = vi.fn(async () => newToken);

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(refresh).toHaveBeenCalledWith(oldToken, NOW);
		expect(set).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledWith('instagram', newToken);
		expect(result).toEqual(newToken);
	});

	it('does not refresh or persist a token that is far from expiry', async () => {
		const farToken = makeToken({
			obtainedAt: offset(NOW, -40 * DAY_MS),
			expiresAt: offset(NOW, 40 * DAY_MS),
		});
		const { store, set } = makeFakeStore(farToken);
		const refresh = vi.fn(async () => makeToken({ value: 'should-never-be-used' }));

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		expect(refresh).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(result).toEqual(farToken);
	});
});

describe('ensureFreshToken — the >=24h minimum age rule', () => {
	it('does NOT refresh a token that is near expiry but younger than 24h, even though the two conditions conflict', async () => {
		// Near expiry (well inside the refresh window)...
		const youngToken = makeToken({
			obtainedAt: offset(NOW, -1 * HOUR_MS), // ...but obtained only an hour ago.
			expiresAt: offset(NOW, HOUR_MS),
		});
		expect(needsRefresh(youngToken, NOW)).toBe(true); // sanity: expiry proximity alone says "refresh".
		expect(Date.parse(NOW) - Date.parse(youngToken.obtainedAt)).toBeLessThan(MIN_REFRESH_AGE_MS);

		const { store, set } = makeFakeStore(youngToken);
		const refresh = vi.fn(async () => makeToken({ value: 'should-never-be-attempted' }));

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		// Meta would reject a refresh of a token this young — the age floor wins over imminent expiry.
		expect(refresh).not.toHaveBeenCalled();
		expect(set).not.toHaveBeenCalled();
		expect(result).toEqual(youngToken);
	});

	it('does refresh once the token crosses the 24h age floor, all else equal', async () => {
		const justOldEnough = makeToken({
			obtainedAt: offset(NOW, -MIN_REFRESH_AGE_MS),
			expiresAt: offset(NOW, HOUR_MS),
		});
		const newToken = makeToken({ value: 'refreshed-after-24h', obtainedAt: NOW });
		const { store, set } = makeFakeStore(justOldEnough);
		const refresh = vi.fn(async () => newToken);

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		expect(refresh).toHaveBeenCalledTimes(1);
		expect(set).toHaveBeenCalledTimes(1);
		expect(result).toEqual(newToken);
	});
});

describe('ensureFreshToken — persist before use (critical)', () => {
	it('awaits store.set to completion before returning the refreshed token to the caller', async () => {
		const oldToken = makeToken({ expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'persisted-before-use-token', obtainedAt: NOW });
		const events: string[] = [];

		const { store } = makeFakeStore(oldToken, {
			setDelayMs: 20,
			onSet: () => events.push('store.set called'),
		});
		const refresh = vi.fn(async () => {
			events.push('refresh resolved');
			return newToken;
		});

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });
		events.push('caller received result');

		// Ordering, not just "was called": store.set must have been invoked AFTER refresh resolved,
		// and the caller must not receive the result until AFTER store.set's own promise settles —
		// proven by the artificial delay inside store.set above.
		expect(events).toEqual(['refresh resolved', 'store.set called', 'caller received result']);
		expect(result).toEqual(newToken);

		// The persisted record really is the same value handed back to the caller.
		await expect(store.get('instagram')).resolves.toEqual(newToken);
	});

	it('never returns a token value that has not been handed to store.set', async () => {
		const oldToken = makeToken({ expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'set-must-see-this-exact-value', obtainedAt: NOW });
		let valueSeenBySet: string | undefined;

		const { store } = makeFakeStore(oldToken, {
			onSet: (_platform, record) => {
				valueSeenBySet = record.value;
			},
		});
		const refresh = vi.fn(async () => newToken);

		const result = await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		expect(valueSeenBySet).toBe(newToken.value);
		expect(result.value).toBe(valueSeenBySet);
	});
});

describe('ensureFreshToken — a crash between refresh and persist does not orphan the account', () => {
	it('propagates the persist failure and never returns the unpersisted token', async () => {
		const oldToken = makeToken({ expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'never-should-reach-caller', obtainedAt: NOW });
		const writeFailure = new Error('Firestore write failed: deadline exceeded');

		const { store } = makeFakeStore(oldToken, { setRejection: writeFailure });
		const refresh = vi.fn(async () => newToken);

		await expect(
			ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh })
		).rejects.toThrow(writeFailure);

		expect(refresh).toHaveBeenCalledTimes(1);
	});

	it('leaves the OLD token readable from the store after a failed persist', async () => {
		const oldToken = makeToken({ expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'lost-in-the-crash', obtainedAt: NOW });
		const writeFailure = new Error('Firestore write failed: deadline exceeded');

		const { store } = makeFakeStore(oldToken, { setRejection: writeFailure });
		const refresh = vi.fn(async () => newToken);

		await expect(
			ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh })
		).rejects.toThrow(writeFailure);

		// The account is not orphaned: the previously-valid token is still what the store returns.
		await expect(store.get('instagram')).resolves.toEqual(oldToken);
	});
});

describe('expiryAlert', () => {
	it('returns undefined when expiry is well outside the 30-day window', () => {
		const token = makeToken({ expiresAt: offset(NOW, 45 * DAY_MS) });
		expect(expiryAlert(token, NOW)).toBeUndefined();
	});

	it('returns undefined just outside the 30-day boundary', () => {
		const token = makeToken({ expiresAt: offset(NOW, EXPIRY_ALERT_WINDOW_MS + DAY_MS) });
		expect(expiryAlert(token, NOW)).toBeUndefined();
	});

	it('raises an alert right at the 30-day boundary (inclusive)', () => {
		const token = makeToken({ expiresAt: offset(NOW, EXPIRY_ALERT_WINDOW_MS), platform: 'youtube' });
		const alert = expiryAlert(token, NOW);

		expect(alert).toBeDefined();
		expect(alert?.platform).toBe('youtube');
		expect(alert?.expiresAt).toBe(token.expiresAt);
		expect(alert?.daysRemaining).toBeCloseTo(30, 0);
	});

	it('raises an alert when expiry is well inside the 30-day window', () => {
		const token = makeToken({ expiresAt: offset(NOW, 10 * DAY_MS) });
		const alert = expiryAlert(token, NOW);

		expect(alert).toBeDefined();
		expect(alert?.daysRemaining).toBeCloseTo(10, 0);
	});

	it('raises an alert (with non-positive days remaining) for a token that has already expired', () => {
		const token = makeToken({ expiresAt: offset(NOW, -2 * DAY_MS) });
		const alert = expiryAlert(token, NOW);

		expect(alert).toBeDefined();
		expect(alert?.daysRemaining).toBeLessThanOrEqual(0);
	});
});

describe('never logs tokens', () => {
	let consoleSpies: ReturnType<typeof vi.spyOn>[];

	beforeEach(() => {
		consoleSpies = [
			vi.spyOn(console, 'log').mockImplementation(() => {}),
			vi.spyOn(console, 'warn').mockImplementation(() => {}),
			vi.spyOn(console, 'error').mockImplementation(() => {}),
			vi.spyOn(console, 'info').mockImplementation(() => {}),
			vi.spyOn(console, 'debug').mockImplementation(() => {}),
		];
	});

	afterEach(() => {
		for (const spy of consoleSpies) spy.mockRestore();
	});

	function assertNoConsoleCallContains(needle: string) {
		for (const spy of consoleSpies) {
			for (const call of spy.mock.calls) {
				const serialized = call.map((arg) => String(arg)).join(' ');
				expect(serialized).not.toContain(needle);
			}
		}
	}

	it('never passes a token value to console.* during a successful refresh', async () => {
		const oldToken = makeToken({ value: 'old-secret-should-not-be-logged', expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'new-secret-should-not-be-logged', obtainedAt: NOW });
		const { store } = makeFakeStore(oldToken);
		const refresh = vi.fn(async () => newToken);

		await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });

		assertNoConsoleCallContains(oldToken.value);
		assertNoConsoleCallContains(newToken.value);
	});

	it('never embeds a token value in console output or the thrown error when the persist crashes', async () => {
		const oldToken = makeToken({ value: 'old-secret-crash-path', expiresAt: offset(NOW, HOUR_MS) });
		const newToken = makeToken({ value: 'new-secret-crash-path', obtainedAt: NOW });
		const writeFailure = new Error('Firestore write failed: deadline exceeded');
		const { store } = makeFakeStore(oldToken, { setRejection: writeFailure });
		const refresh = vi.fn(async () => newToken);

		let thrown: unknown;
		try {
			await ensureFreshToken({ store, platform: 'instagram', now: NOW, refresh });
		} catch (error) {
			thrown = error;
		}

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).message).toBe(writeFailure.message);
		expect((thrown as Error).message).not.toContain(oldToken.value);
		expect((thrown as Error).message).not.toContain(newToken.value);
		assertNoConsoleCallContains(oldToken.value);
		assertNoConsoleCallContains(newToken.value);
	});
});
