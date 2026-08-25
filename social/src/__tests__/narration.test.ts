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

import { synthesizeNarration } from '../narration.js';

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
// which is far short of the fixture clip's real (~1.25s) duration.
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
	it('throws when the written file is more than 120ms longer than the last mark\'s endMs', async () => {
		const dir = await makeTempDir();
		const outPath = path.join(dir, 'narration.mp3');
		const provider = fakeProvider(UNDER_REPORTING_POLLY_MARKS);

		// Sanity: the marks alone claim only 760ms, well outside tolerance of
		// the fixture's real 1200ms — this is the exact Polly under-report
		// class of bug named in the review (final word's endMs === startMs).
		const claimedMs = UNDER_REPORTING_POLLY_MARKS[UNDER_REPORTING_POLLY_MARKS.length - 1].endMs;
		expect(FIXTURE_AUDIO_DURATION_MS - claimedMs).toBeGreaterThan(NARRATION_DRIFT_TOLERANCE_MS);

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
