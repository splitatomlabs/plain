import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ElevenLabsProvider,
	PollyProvider,
	type ElevenLabsTimestampsResponse,
	type ElevenLabsTtsClient,
	type PollyClientLike,
	type TtsResult,
	type TtsVoice
} from '../tts.js';
import {
	NARRATION_DRIFT_TOLERANCE_MS,
	assertNarrationInSync,
	lineTimingsFromMarks,
	splitPayoffLines,
	toFrames,
	type NarrationLineTiming
} from '../timing.js';

// No live provider calls anywhere in this file — every `TtsResult` either
// comes from a fake client replaying a recorded fixture (proving the
// native-provider-data path for both providers' payload shapes) or is a
// hand-built literal used purely as pure-function input.

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const SAMPLE_TEXT = 'Duty is the way.';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-timing-'));
	try {
		await fn(dir);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
}

async function loadElevenLabsAlignment(): Promise<ElevenLabsTimestampsResponse['alignment']> {
	const raw = await readFile(path.join(fixturesDir, 'elevenlabs-alignment.json'), 'utf-8');
	return (JSON.parse(raw) as { alignment: ElevenLabsTimestampsResponse['alignment'] }).alignment;
}

async function loadElevenLabsAudioBase64(): Promise<string> {
	const bytes = await readFile(path.join(fixturesDir, 'elevenlabs-sample.wav'));
	return bytes.toString('base64');
}

/** A fake ElevenLabs client that replays the recorded fixture payload — never a live call. */
function fakeElevenLabsClient(): ElevenLabsTtsClient {
	return {
		textToSpeech: {
			async convertWithTimestamps() {
				const [alignment, audioBase64] = await Promise.all([
					loadElevenLabsAlignment(),
					loadElevenLabsAudioBase64()
				]);
				return { audioBase64, alignment };
			}
		}
	};
}

/** A fake Polly client that replays the recorded fixture payloads — never a live call. */
function fakePollyClient(): PollyClientLike {
	return {
		async send(command) {
			if (command.input.OutputFormat === 'json') {
				const marks = await readFile(path.join(fixturesDir, 'polly-speech-marks.ndjson'), 'utf-8');
				return {
					$metadata: {},
					AudioStream: {
						transformToString: async () => marks,
						transformToByteArray: async () => {
							throw new Error('marks stream should be read as a string, not bytes');
						}
					}
				} as unknown as Awaited<ReturnType<PollyClientLike['send']>>;
			}

			const audio = await readFile(path.join(fixturesDir, 'polly-sample.mp3'));
			return {
				$metadata: {},
				AudioStream: {
					transformToByteArray: async () => new Uint8Array(audio),
					transformToString: async () => {
						throw new Error('audio stream should be read as bytes, not a string');
					}
				}
			} as unknown as Awaited<ReturnType<PollyClientLike['send']>>;
		}
	};
}

const ELEVEN_LABS_VOICE: TtsVoice = {
	provider: 'elevenlabs',
	voiceId: 'fixture-elevenlabs-voice',
	label: 'Epictetus (the Slave)'
};

const POLLY_VOICE: TtsVoice = {
	provider: 'polly',
	voiceId: 'Matthew',
	label: 'Epictetus (the Slave)'
};

describe('lineTimingsFromMarks — recorded fixtures (both provider payload shapes)', () => {
	it('builds a line timing from ElevenLabs character-level alignment', async () => {
		await withTempDir(async (dir) => {
			const provider = new ElevenLabsProvider(fakeElevenLabsClient());
			const result: TtsResult = await provider.synthesize(
				SAMPLE_TEXT,
				ELEVEN_LABS_VOICE,
				path.join(dir, 'eleven.wav')
			);

			const timings = lineTimingsFromMarks([SAMPLE_TEXT], result);

			expect(timings).toHaveLength(1);
			// First mark's native start / last mark's native end, straight off
			// the fixture — not derived from word count.
			expect(timings[0].startSeconds).toBeCloseTo(0, 6);
			expect(timings[0].endSeconds).toBeCloseTo(result.durationMs / 1000, 6);
			expect(timings[0].endSeconds).toBeCloseTo(1.2, 6);
		});
	});

	it('builds a line timing from Polly word-level speech marks', async () => {
		await withTempDir(async (dir) => {
			const provider = new PollyProvider(fakePollyClient());
			const result: TtsResult = await provider.synthesize(SAMPLE_TEXT, POLLY_VOICE, path.join(dir, 'polly.mp3'));

			const timings = lineTimingsFromMarks([SAMPLE_TEXT], result);

			expect(timings).toHaveLength(1);
			expect(timings[0].startSeconds).toBeCloseTo(0, 6);
			expect(timings[0].endSeconds).toBeCloseTo(result.durationMs / 1000, 6);
			// From the fixture: last word "way." starts at 760ms (Polly has no
			// duration per word, only a start time — see tts.ts).
			expect(timings[0].endSeconds).toBeCloseTo(0.76, 6);
		});
	});
});

describe('lineTimingsFromMarks — multi-line matching and failure', () => {
	function wordMarks(words: { text: string; startMs: number; endMs: number }[]): TtsResult {
		return {
			audioPath: '/fake/audio.mp3',
			provider: 'polly',
			voiceId: 'fixture',
			durationMs: words.length > 0 ? words[words.length - 1].endMs : 0,
			marks: words
		};
	}

	it('maps marks spanning multiple lines onto each line in order', () => {
		const result = wordMarks([
			{ text: 'Duty', startMs: 0, endMs: 300 },
			{ text: 'is', startMs: 300, endMs: 450 },
			{ text: 'the', startMs: 450, endMs: 600 },
			{ text: 'way.', startMs: 600, endMs: 900 },
			{ text: 'Endurance', startMs: 1000, endMs: 1500 },
			{ text: 'is', startMs: 1500, endMs: 1650 },
			{ text: 'the', startMs: 1650, endMs: 1800 },
			{ text: 'art.', startMs: 1800, endMs: 2100 }
		]);

		const timings = lineTimingsFromMarks(['Duty is the way.', 'Endurance is the art.'], result);

		expect(timings).toEqual<NarrationLineTiming[]>([
			{ startSeconds: 0, endSeconds: 0.9 },
			{ startSeconds: 1.0, endSeconds: 2.1 }
		]);
	});

	it('throws, naming the line, when a line cannot be matched to the marks', () => {
		const result = wordMarks([
			{ text: 'Duty', startMs: 0, endMs: 300 },
			{ text: 'is', startMs: 300, endMs: 450 },
			{ text: 'the', startMs: 450, endMs: 600 },
			{ text: 'way.', startMs: 600, endMs: 900 }
		]);

		expect(() => lineTimingsFromMarks(['Duty is the way.', 'This line was never spoken.'], result)).toThrow(
			/line 1/i
		);
	});

	it('throws rather than estimating when the marks diverge from the very first line', () => {
		const result = wordMarks([
			{ text: 'Something', startMs: 0, endMs: 300 },
			{ text: 'else', startMs: 300, endMs: 600 }
		]);

		expect(() => lineTimingsFromMarks(['Duty is the way.'], result)).toThrow(/line 0/i);
	});
});

describe('assertNarrationInSync — the drift gate (acceptance test)', () => {
	const timings: NarrationLineTiming[] = [
		{ startSeconds: 0, endSeconds: 1.2 },
		{ startSeconds: 1.2, endSeconds: 2.5 }
	];

	it('passes when the last line ends exactly at the audio duration', () => {
		expect(() => assertNarrationInSync(timings, 2500)).not.toThrow();
	});

	it('passes at the exact 120ms boundary (long side)', () => {
		expect(() => assertNarrationInSync(timings, 2500 - NARRATION_DRIFT_TOLERANCE_MS)).not.toThrow();
	});

	it('passes at the exact 120ms boundary (short side)', () => {
		expect(() => assertNarrationInSync(timings, 2500 + NARRATION_DRIFT_TOLERANCE_MS)).not.toThrow();
	});

	it('rejects a synthetic timing set whose narration runs long of the audio (drift > 120ms)', () => {
		// Last line ends at 2500ms; audio is only 2000ms — narration overruns
		// the audio by 500ms, well past the 120ms gate.
		expect(() => assertNarrationInSync(timings, 2000)).toThrow(/drift/i);
	});

	it('rejects a synthetic timing set whose narration runs short of the audio (drift > 120ms)', () => {
		// Last line ends at 2500ms; audio runs on to 3200ms — narration
		// undershoots the audio by 700ms.
		expect(() => assertNarrationInSync(timings, 3200)).toThrow(/drift/i);
	});

	it('rejects one frame past the boundary in either direction', () => {
		expect(() => assertNarrationInSync(timings, 2500 - NARRATION_DRIFT_TOLERANCE_MS - 1)).toThrow(/drift/i);
		expect(() => assertNarrationInSync(timings, 2500 + NARRATION_DRIFT_TOLERANCE_MS + 1)).toThrow(/drift/i);
	});

	it('rejects overlapping line timings', () => {
		const overlapping: NarrationLineTiming[] = [
			{ startSeconds: 0, endSeconds: 1.5 },
			{ startSeconds: 1.0, endSeconds: 2.5 }
		];
		expect(() => assertNarrationInSync(overlapping, 2500)).toThrow(/overlap/i);
	});

	it('rejects non-monotonic line timings', () => {
		const nonMonotonic: NarrationLineTiming[] = [
			{ startSeconds: 1.0, endSeconds: 2.0 },
			{ startSeconds: 0.5, endSeconds: 1.5 }
		];
		expect(() => assertNarrationInSync(nonMonotonic, 2000)).toThrow(/overlap/i);
	});

	it('rejects a zero-length line', () => {
		const zeroLength: NarrationLineTiming[] = [{ startSeconds: 1.0, endSeconds: 1.0 }];
		expect(() => assertNarrationInSync(zeroLength, 1000)).toThrow(/duration/i);
	});

	it('rejects a negative-length line', () => {
		const negativeLength: NarrationLineTiming[] = [{ startSeconds: 1.0, endSeconds: 0.5 }];
		expect(() => assertNarrationInSync(negativeLength, 1000)).toThrow(/duration/i);
	});

	it('rejects a negative start time', () => {
		const negativeStart: NarrationLineTiming[] = [{ startSeconds: -0.1, endSeconds: 1.0 }];
		expect(() => assertNarrationInSync(negativeStart, 1000)).toThrow(/negative/i);
	});

	it('rejects an empty timing set', () => {
		expect(() => assertNarrationInSync([], 1000)).toThrow();
	});
});

describe('toFrames', () => {
	it('produces contiguous, non-overlapping frame ranges at 30fps', () => {
		const timings: NarrationLineTiming[] = [
			{ startSeconds: 0, endSeconds: 1.2 },
			{ startSeconds: 1.2, endSeconds: 2.53 },
			{ startSeconds: 2.53, endSeconds: 4.0 }
		];

		const frames = toFrames(timings, 30);

		expect(frames).toHaveLength(3);
		expect(frames[0].startFrame).toBe(0);
		for (let i = 1; i < frames.length; i++) {
			expect(frames[i].startFrame).toBe(frames[i - 1].endFrame);
			expect(frames[i].endFrame).toBeGreaterThan(frames[i].startFrame);
		}
	});

	it('round-trips each line within one frame of its true duration', () => {
		const fps = 30;
		const timings: NarrationLineTiming[] = [
			{ startSeconds: 0, endSeconds: 0.9 },
			{ startSeconds: 0.9, endSeconds: 1.0 }, // short line, still >= 1 frame
			{ startSeconds: 1.0, endSeconds: 3.333 }
		];

		const frames = toFrames(timings, fps);

		timings.forEach((timing, i) => {
			const trueDuration = timing.endSeconds - timing.startSeconds;
			const frameDuration = (frames[i].endFrame - frames[i].startFrame) / fps;
			expect(Math.abs(trueDuration - frameDuration)).toBeLessThanOrEqual(1 / fps);
			expect(frames[i].endFrame - frames[i].startFrame).toBeGreaterThanOrEqual(1);
		});
	});
});

describe('splitPayoffLines', () => {
	function collapseWhitespace(text: string): string {
		return text.trim().replace(/\s+/g, ' ');
	}

	it('splits one sentence per line', () => {
		const text = 'Duty is the way. Endurance is the art. Fear is the enemy.';
		expect(splitPayoffLines(text)).toEqual(['Duty is the way.', 'Endurance is the art.', 'Fear is the enemy.']);
	});

	it('keeps lines verbatim — joined output equals the input modulo whitespace', () => {
		const text = '  Duty is the way.   Endurance is the art.  Fear is the enemy.  ';
		const lines = splitPayoffLines(text);
		expect(collapseWhitespace(lines.join(' '))).toBe(collapseWhitespace(text));
	});

	it('does not split on common abbreviations', () => {
		const text = 'Dr. Smith arrived. He left.';
		expect(splitPayoffLines(text)).toEqual(['Dr. Smith arrived.', 'He left.']);
	});

	it('does not split on a single-letter initial', () => {
		const text = 'A. Vernon wrote the code. It compiled.';
		expect(splitPayoffLines(text)).toEqual(['A. Vernon wrote the code.', 'It compiled.']);
	});

	it('does not split a decimal number', () => {
		const text = 'The value is 3.14. It stays constant.';
		expect(splitPayoffLines(text)).toEqual(['The value is 3.14.', 'It stays constant.']);
	});

	it('splits after a quoted sentence end', () => {
		const text = 'He said, "Stop." Then he left.';
		expect(splitPayoffLines(text)).toEqual(['He said, "Stop."', 'Then he left.']);
	});

	it('handles a single sentence with no trailing terminator', () => {
		expect(splitPayoffLines('Duty is the way')).toEqual(['Duty is the way']);
	});

	it('returns an empty array for empty input', () => {
		expect(splitPayoffLines('')).toEqual([]);
		expect(splitPayoffLines('   ')).toEqual([]);
	});
});
