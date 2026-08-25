/**
 * `narration.ts`'s `synthesizeNarration` was, until social pilot 02's F07
 * fix, unreachable at the assertion the drift gate depends on: it handed
 * `assertNarrationInSync` `tts.durationMs`, which is read off the SAME
 * provider marks `lineTimingsFromMarks` derives `timings` from — so drift
 * was structurally zero and T13's ±120ms gate could never fire against the
 * real audio file. This file proves the fix: `synthesizeNarration` now
 * probes the WRITTEN FILE (`social/src/audio/__tests__/fixtures/polly-sample.mp3`,
 * a real 1.2s clip) and uses ITS duration for the gate.
 *
 * F09 (re-review): the F07 fix as first written gated an UNREPAIRED
 * `timings` against the probed file duration. Because `parsePollySpeechMarks`
 * (`audio/tts.ts`) collapses the final word's `endMs` to its own `startMs`
 * (Polly never reports a duration for the last word), that meant drift was
 * ALWAYS roughly "the final word's real duration plus trailing silence" —
 * comfortably outside tolerance on any real clip — so the gate would have
 * thrown on every genuine Polly call, not just actually-drifted ones. This
 * file also proves THAT fix: `synthesizeNarration` now repairs a collapsed
 * Polly final mark with the probed duration before deriving `timings`, so a
 * merely under-reporting mark set passes, while a genuinely drifted one
 * still throws.
 *
 * F13 (final review, re-review of F09): the F09 repair was UNBOUNDED — it
 * closed ANY collapsed final mark to the probed duration, and Polly
 * collapses the final mark on every real result, so the repair always
 * applied and the drift gate downstream could never fire for Polly at all.
 * Demonstrated with real-shaped marks `[{Duty,0,100},{is,100,200},
 * {the,200,300},{way.,300,300}]` replayed against the real (~1.2s)
 * `polly-sample.mp3` fixture — audio far longer than the marks claim — which
 * passed under F09. This file also proves the F13 fix: the repair now only
 * closes the collapsed final mark when doing so implies a PLAUSIBLE
 * final-word length (bounded by `POLLY_FINAL_WORD_MAX_STRETCH_FACTOR`,
 * `narration.ts`), and throws otherwise — rejecting the reproduction above
 * while still passing an ordinary under-reporting final mark.
 *
 * `resolveVoice` (`audio/voices.js`) unconditionally throws while T14 is
 * blocked (`VOICES_ARE_UNSET` — see that module's doc comment), so it's
 * mocked here to return a fixed voice, matching the plan note that this
 * suite tests the module directly rather than through the CLI (narration
 * is unreachable end-to-end today).
 *
 * No live provider calls anywhere in this file — `synthesizeNarration` is
 * always given a fake `TtsProvider` replaying the recorded Polly fixtures.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ProviderMark, TtsProvider, TtsResult } from '../audio/tts.js';
import { NARRATION_DRIFT_TOLERANCE_MS } from '../audio/timing.js';
import { probe } from '../render/encode.js';

// `resolveVoice` (`audio/voices.js`) unconditionally throws while T14 is
// blocked (`VOICES_ARE_UNSET`); mock it to a fixed voice so this file can
// exercise `synthesizeNarration` directly, per the plan note that
// narration is untestable end-to-end until real voice ids land. `vi.mock`
// is hoisted above every import in this file (including the one below),
// so `narration.ts`'s own `import { resolveVoice } from './audio/voices.js'`
// resolves to this mock too.
vi.mock('../audio/voices.js', () => ({
	resolveVoice: () => ({ provider: 'polly' as const, voiceId: 'Matthew', label: 'test-voice' })
}));

import { synthesizeNarration, POLLY_FINAL_WORD_MAX_STRETCH_FACTOR } from '../narration.js';

const fixturesDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'..',
	'audio',
	'__tests__',
	'fixtures'
);

// The real, committed fixture clip. Its exact duration (as ffprobe reports
// it — an mp3's encoder priming/padding means this is NOT necessarily a
// round number) is measured once in `beforeAll` below via the same `probe`
// helper `synthesizeNarration` itself now uses, rather than hardcoded, so
// this test can't drift out of sync with a different ffprobe build. See
// social/src/audio/__tests__/fixtures/polly-speech-marks.ndjson for the
// matching Polly speech marks this file's fake provider replays.
const SAMPLE_LINES = ['Duty is the way.'];
let FIXTURE_AUDIO_DURATION_MS: number;

// The exact marks `polly-speech-marks.ndjson` parses to (asserted verbatim
// in `audio/__tests__/tts.test.ts`): the final word's `endMs` (760) equals
// its own `startMs` — Polly never reports a duration for the last word —
// which is far short of the fixture clip's real (~1.2s) duration. This is
// the collapsed shape `synthesizeNarration`'s F09 repair targets: under
// F07-only (pre-F09) behavior this made the gate throw on every real Polly
// call; after F09 it must be repaired and PASS.
const UNDER_REPORTING_POLLY_MARKS: ProviderMark[] = [
	{ text: 'Duty', startMs: 0, endMs: 330 },
	{ text: 'is', startMs: 330, endMs: 520 },
	{ text: 'the', startMs: 520, endMs: 760 },
	{ text: 'way.', startMs: 760, endMs: 760 }
];

// A synthetic mark set whose last mark ends close to the fixture clip's
// real duration (built in `beforeAll`, drift kept inside the ±120ms
// tolerance) — stands in for a provider (or a fixed Polly parser) that
// reports the final word's real duration instead of collapsing it to zero.
let IN_SYNC_MARKS: ProviderMark[];

// A genuinely drifted mark set (NOT the collapsed `endMs === startMs`
// shape F09 repairs) — the final word claims a real, non-zero duration,
// but one that lands far outside the fixture's actual length. Proves the
// gate remains capable of firing after the F09 repair, rather than the
// repair (or its `provider === 'polly'` condition) accidentally swallowing
// every Polly drift case.
const GENUINELY_DRIFTED_POLLY_MARKS: ProviderMark[] = [
	{ text: 'Duty', startMs: 0, endMs: 330 },
	{ text: 'is', startMs: 330, endMs: 520 },
	{ text: 'the', startMs: 520, endMs: 760 },
	{ text: 'way.', startMs: 760, endMs: 3000 }
];

// F13's reviewer reproduction, verbatim: a COLLAPSED final mark (the shape
// `parsePollySpeechMarks` actually emits on every real result — unlike
// `GENUINELY_DRIFTED_POLLY_MARKS` above, which is non-collapsed and so
// never reaches the F09 repair at all), with tight, plausible per-word
// spacing (100ms each). Under F09 (unbounded repair) this passed, silently
// stretching "way." from a claimed 0ms-long final word to whatever the
// probed file duration happened to be — the fixture is roughly 4x longer
// than these marks claim. F13 must reject it instead.
const COLLAPSED_REAL_SHAPED_REPRODUCTION_MARKS: ProviderMark[] = [
	{ text: 'Duty', startMs: 0, endMs: 100 },
	{ text: 'is', startMs: 100, endMs: 200 },
	{ text: 'the', startMs: 200, endMs: 300 },
	{ text: 'way.', startMs: 300, endMs: 300 }
];

// Boundary mark sets for F13's plausibility bound, built in `beforeAll`
// against the fixture's real (probed) duration. Both use the COLLAPSED
// shape, so the F09 repair's bound check applies. The three "other" marks
// fix `longestOtherMarkMs` at 200ms (the "the" mark), so
// `maxPlausibleFinalMs = POLLY_FINAL_WORD_MAX_STRETCH_FACTOR * 200 +
// NARRATION_DRIFT_TOLERANCE_MS`. The final mark's `startMs` is then chosen
// so the IMPLIED final-word duration (`audioDurationMs - startMs`) lands
// exactly at that bound (must pass — after repair the last line ends
// exactly at the probed duration, zero drift) or 1ms past it (must throw).
let AT_STRETCH_BOUND_MARKS: ProviderMark[];
let OVER_STRETCH_BOUND_MARKS: ProviderMark[];

// Boundary mark sets, built in `beforeAll` against the fixture's real
// (probed) duration: one whose drift is exactly `NARRATION_DRIFT_TOLERANCE_MS`
// (must pass — the gate only rejects drift strictly GREATER than tolerance)
// and one 1ms further out (must throw). Neither uses the collapsed
// `endMs === startMs` shape, so the F09 repair never applies to them —
// they test `assertNarrationInSync`'s own boundary through
// `synthesizeNarration`, independent of the repair.
let AT_TOLERANCE_MARKS: ProviderMark[];
let OVER_TOLERANCE_MARKS: ProviderMark[];

beforeAll(async () => {
	const probed = await probe(path.join(fixturesDir, 'polly-sample.mp3'));
	if (probed.durationSec === null) {
		throw new Error('ffprobe could not read a duration for the polly-sample.mp3 fixture');
	}
	FIXTURE_AUDIO_DURATION_MS = probed.durationSec * 1000;
	IN_SYNC_MARKS = [
		{ text: 'Duty', startMs: 0, endMs: 330 },
		{ text: 'is', startMs: 330, endMs: 520 },
		{ text: 'the', startMs: 520, endMs: 760 },
		{ text: 'way.', startMs: 760, endMs: Math.round(FIXTURE_AUDIO_DURATION_MS - 50) }
	];
	// Deliberately NOT `Math.round`ed: `FIXTURE_AUDIO_DURATION_MS` is a float
	// (mp3 encoder priming/padding), and `endSeconds * 1000` round-trips a
	// float `endMs` back exactly (division then multiplication by the same
	// 1000 introduces no error here), so subtracting the tolerance directly
	// keeps the boundary exact rather than off by a rounding fraction.
	AT_TOLERANCE_MARKS = [
		{ text: 'Duty', startMs: 0, endMs: 330 },
		{ text: 'is', startMs: 330, endMs: 520 },
		{ text: 'the', startMs: 520, endMs: 760 },
		{ text: 'way.', startMs: 760, endMs: FIXTURE_AUDIO_DURATION_MS - NARRATION_DRIFT_TOLERANCE_MS }
	];
	OVER_TOLERANCE_MARKS = [
		{ text: 'Duty', startMs: 0, endMs: 330 },
		{ text: 'is', startMs: 330, endMs: 520 },
		{ text: 'the', startMs: 520, endMs: 760 },
		{
			text: 'way.',
			startMs: 760,
			endMs: FIXTURE_AUDIO_DURATION_MS - NARRATION_DRIFT_TOLERANCE_MS - 1
		}
	];

	// F13's plausibility bound, at and just past its edge. `longestOtherMarkMs`
	// is fixed at 200ms via the "the" mark (0-20ms and 20-40ms for "Duty"/"is"
	// keep them well short of that, so they can't become the longest). The
	// final ("way.") mark is COLLAPSED (`endMs === startMs`) so the F09
	// repair's bound check applies; its `startMs` is chosen so the implied
	// final-word duration lands exactly on `maxPlausibleFinalMs` (passes) or
	// 1ms past it (throws), against the fixture's real probed duration.
	const longestOtherMarkMs = 200;
	const maxPlausibleFinalMs =
		POLLY_FINAL_WORD_MAX_STRETCH_FACTOR * longestOtherMarkMs + NARRATION_DRIFT_TOLERANCE_MS;
	AT_STRETCH_BOUND_MARKS = [
		{ text: 'Duty', startMs: 0, endMs: 20 },
		{ text: 'is', startMs: 20, endMs: 40 },
		{ text: 'the', startMs: 40, endMs: 40 + longestOtherMarkMs },
		{
			text: 'way.',
			startMs: FIXTURE_AUDIO_DURATION_MS - maxPlausibleFinalMs,
			endMs: FIXTURE_AUDIO_DURATION_MS - maxPlausibleFinalMs
		}
	];
	OVER_STRETCH_BOUND_MARKS = [
		{ text: 'Duty', startMs: 0, endMs: 20 },
		{ text: 'is', startMs: 20, endMs: 40 },
		{ text: 'the', startMs: 40, endMs: 40 + longestOtherMarkMs },
		{
			text: 'way.',
			startMs: FIXTURE_AUDIO_DURATION_MS - maxPlausibleFinalMs - 1,
			endMs: FIXTURE_AUDIO_DURATION_MS - maxPlausibleFinalMs - 1
		}
	];
});

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-narration-'));
	tempDirs.push(dir);
	return dir;
}

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fake `TtsProvider` that writes the real fixture mp3 (1.2s) to `outPath`
 * — so `synthesizeNarration`'s ffprobe call reads real, correct duration —
 * but reports `marks` (and the old, buggy `durationMs`) exactly as
 * supplied, independent of the file's actual length. This is what lets the
 * test drive `synthesizeNarration` into both the drift and in-sync cases
 * from the SAME real audio file.
 */
function fakeProvider(marks: ProviderMark[]): TtsProvider {
	return {
		name: 'polly',
		async synthesize(_text, _voice, outPath): Promise<TtsResult> {
			const audio = await readFile(path.join(fixturesDir, 'polly-sample.mp3'));
			await writeFile(outPath, audio);
			return {
				audioPath: outPath,
				provider: 'polly',
				voiceId: 'Matthew',
				// The pre-fix bug: this is exactly `marks[marks.length - 1].endMs`,
				// which `synthesizeNarration` must NOT use for the drift gate.
				durationMs: marks.length > 0 ? marks[marks.length - 1].endMs : 0,
				marks
			};
		}
	};
}

describe('synthesizeNarration — the drift gate is checked against the real audio file', () => {
	it('F09: repairs an under-reporting Polly final mark with the probed file duration and PASSES', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(UNDER_REPORTING_POLLY_MARKS);

		// Sanity: the marks alone claim only 760ms, well outside tolerance of
		// the fixture's real 1200ms — this is the exact Polly under-report
		// class of bug named in the review (final word's endMs === startMs).
		// Under F07-only (pre-F09) behavior this would have thrown; F09's
		// repair closes the collapsed final mark with the probed duration
		// BEFORE the gate runs, so it must now pass.
		const claimedMs = UNDER_REPORTING_POLLY_MARKS[UNDER_REPORTING_POLLY_MARKS.length - 1].endMs;
		expect(FIXTURE_AUDIO_DURATION_MS - claimedMs).toBeGreaterThan(NARRATION_DRIFT_TOLERANCE_MS);

		const result = await synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath);

		expect(result.timings).toHaveLength(1);
		// The repaired last line ends at the probed file duration, not at the
		// collapsed 760ms the provider originally claimed.
		expect(result.timings[0].endSeconds * 1000).toBe(FIXTURE_AUDIO_DURATION_MS);
		expect(result.audioDurationMs).toBe(FIXTURE_AUDIO_DURATION_MS);
	});

	it('F09: still throws on a genuinely drifted (non-collapsed) Polly mark set', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(GENUINELY_DRIFTED_POLLY_MARKS);

		// Sanity: this mark set is NOT the collapsed `endMs === startMs` shape
		// F09 repairs — its final word claims a real, non-zero duration
		// (3000ms) that is simply wrong, far outside tolerance of the
		// fixture's real ~1200ms. The repair must not swallow this case.
		const last = GENUINELY_DRIFTED_POLLY_MARKS[GENUINELY_DRIFTED_POLLY_MARKS.length - 1];
		expect(last.endMs).not.toBe(last.startMs);
		expect(Math.abs(last.endMs - FIXTURE_AUDIO_DURATION_MS)).toBeGreaterThan(NARRATION_DRIFT_TOLERANCE_MS);

		await expect(synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath)).rejects.toThrow(
			/narration drift exceeds tolerance/i
		);
	});

	it('F13: rejects the reviewer\'s reproduction — collapsed real-shaped marks against a real fixture whose audio is far longer than the marks claim', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(COLLAPSED_REAL_SHAPED_REPRODUCTION_MARKS);

		// Sanity: this IS the collapsed shape (`endMs === startMs` on the
		// final mark) `parsePollySpeechMarks` actually emits — unlike
		// `GENUINELY_DRIFTED_POLLY_MARKS` above — so under F09 (unbounded
		// repair) this would have silently PASSED, closing "way." to the
		// fixture's real duration regardless of how implausible that is.
		const last =
			COLLAPSED_REAL_SHAPED_REPRODUCTION_MARKS[COLLAPSED_REAL_SHAPED_REPRODUCTION_MARKS.length - 1];
		expect(last.endMs).toBe(last.startMs);
		expect(FIXTURE_AUDIO_DURATION_MS - last.startMs).toBeGreaterThan(
			POLLY_FINAL_WORD_MAX_STRETCH_FACTOR * 100 + NARRATION_DRIFT_TOLERANCE_MS
		);

		await expect(synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath)).rejects.toThrow(
			/refusing to repair a collapsed polly final mark/i
		);
	});

	it('F13: boundary — implied final-word duration exactly at the plausibility bound PASSES', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(AT_STRETCH_BOUND_MARKS);

		const last = AT_STRETCH_BOUND_MARKS[AT_STRETCH_BOUND_MARKS.length - 1];
		expect(last.endMs).toBe(last.startMs); // still the collapsed shape

		const result = await synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath);
		// Repaired: the last line ends at the probed file duration exactly.
		expect(result.timings[0].endSeconds * 1000).toBe(FIXTURE_AUDIO_DURATION_MS);
	});

	it('F13: boundary — implied final-word duration 1ms past the plausibility bound THROWS', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(OVER_STRETCH_BOUND_MARKS);

		const last = OVER_STRETCH_BOUND_MARKS[OVER_STRETCH_BOUND_MARKS.length - 1];
		expect(last.endMs).toBe(last.startMs); // still the collapsed shape

		await expect(synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath)).rejects.toThrow(
			/refusing to repair a collapsed polly final mark/i
		);
	});

	it('boundary: passes when drift is exactly NARRATION_DRIFT_TOLERANCE_MS (120ms)', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(AT_TOLERANCE_MARKS);

		const claimedMs = AT_TOLERANCE_MARKS[AT_TOLERANCE_MARKS.length - 1].endMs;
		expect(Math.abs(FIXTURE_AUDIO_DURATION_MS - claimedMs)).toBe(NARRATION_DRIFT_TOLERANCE_MS);

		const result = await synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath);
		expect(result.timings[0].endSeconds * 1000).toBe(claimedMs);
	});

	it('boundary: throws when drift is NARRATION_DRIFT_TOLERANCE_MS + 1ms (121ms)', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(OVER_TOLERANCE_MARKS);

		const claimedMs = OVER_TOLERANCE_MARKS[OVER_TOLERANCE_MARKS.length - 1].endMs;
		expect(Math.abs(FIXTURE_AUDIO_DURATION_MS - claimedMs)).toBe(NARRATION_DRIFT_TOLERANCE_MS + 1);

		await expect(synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath)).rejects.toThrow(
			/narration drift exceeds tolerance/i
		);
	});

	it('passes, and reports the real file duration, when the written file is within 120ms of the last mark\'s endMs', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(IN_SYNC_MARKS);

		const claimedMs = IN_SYNC_MARKS[IN_SYNC_MARKS.length - 1].endMs;
		expect(Math.abs(FIXTURE_AUDIO_DURATION_MS - claimedMs)).toBeLessThanOrEqual(NARRATION_DRIFT_TOLERANCE_MS);

		const result = await synthesizeNarration(SAMPLE_LINES, 'epictetus', provider, {}, outPath);

		expect(result.timings).toHaveLength(1);
		expect(result.timings[0].endSeconds * 1000).toBe(claimedMs);
		// The whole point of the fix: `audioDurationMs` comes from ffprobe on
		// the written file, not from the provider's (possibly wrong) marks.
		expect(result.audioDurationMs).toBe(FIXTURE_AUDIO_DURATION_MS);
		expect(result.audioDurationMs).not.toBe(result.tts.durationMs);
	});

	it('never throws on this fixture using the OLD (buggy) self-comparison, proving the gate is now live', async () => {
		// Documents the bug this file exists to catch: comparing the marks
		// against themselves (`tts.durationMs === marks[last].endMs` by
		// construction) always reports zero drift, regardless of the real
		// audio file's length.
		const provider = fakeProvider(UNDER_REPORTING_POLLY_MARKS);
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const result = await provider.synthesize(SAMPLE_LINES.join(' '), {
			provider: 'polly',
			voiceId: 'Matthew',
			label: 'test'
		}, outPath);

		expect(result.durationMs).toBe(UNDER_REPORTING_POLLY_MARKS[UNDER_REPORTING_POLLY_MARKS.length - 1].endMs);
	});
});
