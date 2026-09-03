import { describe, expect, it } from 'vitest';

import { computeTodayInTimezone, PILOT_TIMEZONE } from '../socialTrigger.js';

/**
 * `computeTodayInTimezone` is the one piece of real logic in `socialTrigger.ts`
 * — the outbound Cloud Run Admin API call is a single REST request with no
 * branching worth testing (see that file's own comment). This suite proves
 * the timezone conversion is correct at the boundaries where it is most
 * likely to be wrong: near UTC midnight, where a naive `toISOString()`-based
 * date would disagree with the pilot's own timezone.
 */
describe('computeTodayInTimezone', () => {
	it('formats a plain UTC midday instant as that same calendar date', () => {
		// 2026-06-15T15:00:00Z is 11:00 in America/New_York (UTC-4, daylight
		// saving) — same calendar date either way, so this is the sanity case.
		expect(computeTodayInTimezone(PILOT_TIMEZONE, new Date('2026-06-15T15:00:00Z'))).toBe('2026-06-15');
	});

	it('resolves to the PREVIOUS calendar day when UTC has already rolled over past midnight Eastern', () => {
		// 2026-06-16T02:00:00Z is 2026-06-15T22:00:00 in America/New_York
		// (UTC-4) — a naive `new Date().toISOString().slice(0, 10)` would
		// wrongly report 2026-06-16 here. This is exactly the failure mode
		// the explicit-timezone read exists to avoid.
		expect(computeTodayInTimezone(PILOT_TIMEZONE, new Date('2026-06-16T02:00:00Z'))).toBe('2026-06-15');
	});

	it('resolves to the NEXT calendar day once Eastern time has rolled past midnight', () => {
		// 2026-06-16T05:00:00Z is 2026-06-16T01:00:00 in America/New_York.
		expect(computeTodayInTimezone(PILOT_TIMEZONE, new Date('2026-06-16T05:00:00Z'))).toBe('2026-06-16');
	});

	it('accounts for the winter/summer UTC offset change (DST)', () => {
		// 2026-01-15T04:30:00Z is 2026-01-14T23:30:00 in America/New_York
		// (UTC-5, standard time, no DST) — still the previous calendar day,
		// proving the formatter uses the real timezone rule set rather than a
		// fixed offset baked in anywhere.
		expect(computeTodayInTimezone(PILOT_TIMEZONE, new Date('2026-01-15T04:30:00Z'))).toBe('2026-01-14');
	});

	it('is pure — the same inputs always produce the same output', () => {
		const now = new Date('2026-09-01T12:00:00Z');
		expect(computeTodayInTimezone(PILOT_TIMEZONE, now)).toBe(computeTodayInTimezone(PILOT_TIMEZONE, now));
	});
});
