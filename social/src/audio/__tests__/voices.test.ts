import { describe, expect, it } from 'vitest';

import type { AuthorSlug } from '../../render/theme.js';
import { VOICE_REGISTRY, VOICES_ARE_UNSET, assertVoicesAssigned, resolveVoice } from '../voices.js';

// No live calls, no credentials, no network anywhere in this file — the
// registry is pure data and these are pure-function assertions against it.

const EXPECTED_AUTHORS: AuthorSlug[] = ['epictetus', 'marcus-aurelius', 'seneca'];

describe('VOICE_REGISTRY', () => {
	it('has exactly the three author slugs and no others', () => {
		expect(Object.keys(VOICE_REGISTRY).sort()).toEqual([...EXPECTED_AUTHORS].sort());
	});

	it('every entry has an elevenLabsVoiceId, pollyVoiceId and rationale field', () => {
		for (const author of EXPECTED_AUTHORS) {
			const entry = VOICE_REGISTRY[author];
			expect(entry).toHaveProperty('elevenLabsVoiceId');
			expect(entry).toHaveProperty('pollyVoiceId');
			expect(entry).toHaveProperty('rationale');
		}
	});
});

describe('assertVoicesAssigned', () => {
	it('throws while ids are unset, naming T14 so the failure is actionable', () => {
		expect(() => assertVoicesAssigned()).toThrow(/T14/);
	});

	it('throwing message points at the audition script and voices.ts', () => {
		try {
			assertVoicesAssigned();
			throw new Error('expected assertVoicesAssigned to throw');
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			expect(message).toMatch(/audition-voices/);
			expect(message).toMatch(/voices\.ts/);
		}
	});
});

describe('resolveVoice', () => {
	// This describe block is the load-bearing guard against shipping
	// placeholder/default voices: it must throw for every author TODAY
	// (registry unset), and it must flip — without editing this test file —
	// to asserting three real, DISTINCT ids the moment VOICE_REGISTRY is
	// populated and VOICES_ARE_UNSET is flipped to false. The `populated`
	// branch below is the REAL T14 acceptance test ("three IDs committed and
	// distinguishable from each other"); the `unset` branch just documents
	// today's blocked state.
	if (VOICES_ARE_UNSET) {
		it('throws for every author today, because no voice has been auditioned (T14 not done)', () => {
			for (const author of EXPECTED_AUTHORS) {
				expect(() => resolveVoice(author, { primary: 'elevenlabs' })).toThrow(/T14/);
				expect(() => resolveVoice(author, { primary: 'polly' })).toThrow(/T14/);
			}
		});
	} else {
		it('T14 acceptance: resolves a real, distinct ElevenLabs voice id per author', () => {
			const ids = EXPECTED_AUTHORS.map((author) => resolveVoice(author, { primary: 'elevenlabs' }).voiceId);
			for (const id of ids) {
				expect(typeof id).toBe('string');
				expect(id.length).toBeGreaterThan(0);
			}
			// The acceptance criterion: three voices, distinguishable from each other.
			expect(new Set(ids).size).toBe(ids.length);
		});

		it('T14 acceptance: resolves a real, distinct Polly fallback voice id per author', () => {
			const ids = EXPECTED_AUTHORS.map((author) => resolveVoice(author, { primary: 'polly' }).voiceId);
			for (const id of ids) {
				expect(typeof id).toBe('string');
				expect(id.length).toBeGreaterThan(0);
			}
			expect(new Set(ids).size).toBe(ids.length);
		});

		it('every registry entry carries a written rationale once populated', () => {
			for (const author of EXPECTED_AUTHORS) {
				expect(VOICE_REGISTRY[author].rationale.length).toBeGreaterThan(0);
			}
		});
	}
});
