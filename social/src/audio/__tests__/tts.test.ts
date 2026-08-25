import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
	ElevenLabsProvider,
	PollyProvider,
	assertVoiceSettingsWithinHouseRule,
	resolveTtsConfig,
	withFallback,
	type ElevenLabsTtsClient,
	type ElevenLabsTimestampsResponse,
	type FallbackEvent,
	type PollyClientLike,
	type TtsProvider,
	type TtsVoice
} from '../tts.js';

const fixturesDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

const SAMPLE_TEXT = 'Duty is the way.';

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-tts-'));
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

/** A fake ElevenLabs client that returns the recorded fixture payload — never a live call. */
function fakeElevenLabsClient(overrides?: {
	fail?: boolean;
}): ElevenLabsTtsClient {
	return {
		textToSpeech: {
			async convertWithTimestamps() {
				if (overrides?.fail) {
					throw new Error('simulated ElevenLabs outage');
				}
				const [alignment, audioBase64] = await Promise.all([
					loadElevenLabsAlignment(),
					loadElevenLabsAudioBase64()
				]);
				return { audioBase64, alignment };
			}
		}
	};
}

/** A fake Polly client that returns the recorded fixture payloads — never a live call. */
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

describe('ElevenLabsProvider', () => {
	it('produces a normalized TtsResult from the ElevenLabs alignment fixture', async () => {
		await withTempDir(async (dir) => {
			const provider = new ElevenLabsProvider(fakeElevenLabsClient());
			const outPath = path.join(dir, 'eleven.wav');

			const result = await provider.synthesize(SAMPLE_TEXT, ELEVEN_LABS_VOICE, outPath);

			expect(result.provider).toBe('elevenlabs');
			expect(result.audioPath).toBe(outPath);
			expect(result.voiceId).toBe(ELEVEN_LABS_VOICE.voiceId);

			const fileStat = await stat(outPath);
			expect(fileStat.size).toBeGreaterThan(0);

			expect(result.marks.length).toBe(SAMPLE_TEXT.length);
			expect(result.marks[0]).toEqual({ text: 'D', startMs: 0, endMs: 75 });
			expect(result.durationMs).toBe(result.marks[result.marks.length - 1].endMs);
		});
	});

	it('rejects synthesis when the requested pitch is below the provider default', async () => {
		const provider = new ElevenLabsProvider(fakeElevenLabsClient());
		await withTempDir(async (dir) => {
			await expect(
				provider.synthesize(
					SAMPLE_TEXT,
					{ ...ELEVEN_LABS_VOICE, settings: { pitch: 0.8 } },
					path.join(dir, 'eleven.wav')
				)
			).rejects.toThrow(/house rule/i);
		});
	});
});

describe('PollyProvider', () => {
	it('produces the same normalized TtsResult shape from the Polly speech-marks fixture', async () => {
		await withTempDir(async (dir) => {
			const provider = new PollyProvider(fakePollyClient());
			const outPath = path.join(dir, 'polly.mp3');

			const result = await provider.synthesize(SAMPLE_TEXT, POLLY_VOICE, outPath);

			expect(result.provider).toBe('polly');
			expect(result.audioPath).toBe(outPath);
			expect(result.voiceId).toBe(POLLY_VOICE.voiceId);

			const fileStat = await stat(outPath);
			expect(fileStat.size).toBeGreaterThan(0);

			expect(result.marks).toEqual([
				{ text: 'Duty', startMs: 0, endMs: 330 },
				{ text: 'is', startMs: 330, endMs: 520 },
				{ text: 'the', startMs: 520, endMs: 760 },
				{ text: 'way.', startMs: 760, endMs: 760 }
			]);

			// Same shape as the ElevenLabs result, despite a completely
			// different native payload — this is the "swapping is config" claim.
			expect(Object.keys(result).sort()).toEqual(
				['audioPath', 'durationMs', 'marks', 'provider', 'voiceId'].sort()
			);
		});
	});

	it('rejects synthesis when the requested rate is below the provider default', async () => {
		const provider = new PollyProvider(fakePollyClient());
		await withTempDir(async (dir) => {
			await expect(
				provider.synthesize(
					SAMPLE_TEXT,
					{ ...POLLY_VOICE, settings: { rate: 0.5 } },
					path.join(dir, 'polly.mp3')
				)
			).rejects.toThrow(/house rule/i);
		});
	});
});

describe('cross-provider normalized shape', () => {
	it('marks are carried through in order with monotonic timestamps for both providers', async () => {
		await withTempDir(async (dir) => {
			const elevenResult = await new ElevenLabsProvider(fakeElevenLabsClient()).synthesize(
				SAMPLE_TEXT,
				ELEVEN_LABS_VOICE,
				path.join(dir, 'eleven.wav')
			);
			const pollyResult = await new PollyProvider(fakePollyClient()).synthesize(
				SAMPLE_TEXT,
				POLLY_VOICE,
				path.join(dir, 'polly.mp3')
			);

			for (const result of [elevenResult, pollyResult]) {
				expect(result.marks.length).toBeGreaterThan(0);
				for (const mark of result.marks) {
					expect(mark.startMs).toBeLessThanOrEqual(mark.endMs);
				}
				for (let i = 1; i < result.marks.length; i++) {
					expect(result.marks[i].startMs).toBeGreaterThanOrEqual(result.marks[i - 1].startMs);
				}
			}

			// Same ordered text reconstructs the source for both providers.
			expect(elevenResult.marks.map((m) => m.text).join('')).toBe(SAMPLE_TEXT);
			expect(pollyResult.marks.map((m) => m.text).join(' ')).toBe(SAMPLE_TEXT);
		});
	});
});

describe('house-rule voice-settings guard', () => {
	it('throws for below-default pitch', () => {
		expect(() => assertVoiceSettingsWithinHouseRule({ pitch: 0.9 })).toThrow(/house rule/i);
	});

	it('throws for below-default rate', () => {
		expect(() => assertVoiceSettingsWithinHouseRule({ rate: 0.99 })).toThrow(/house rule/i);
	});

	it('passes at default settings', () => {
		expect(() => assertVoiceSettingsWithinHouseRule(undefined)).not.toThrow();
		expect(() => assertVoiceSettingsWithinHouseRule({ pitch: 1, rate: 1 })).not.toThrow();
	});

	it('passes above default settings', () => {
		expect(() => assertVoiceSettingsWithinHouseRule({ pitch: 1.2, rate: 1.1 })).not.toThrow();
	});
});

describe('withFallback — the acceptance test', () => {
	it('produces Polly audio when ElevenLabs fails', async () => {
		await withTempDir(async (dir) => {
			const failingElevenLabs = new ElevenLabsProvider(fakeElevenLabsClient({ fail: true }));
			const workingPolly = new PollyProvider(fakePollyClient());

			const events: FallbackEvent[] = [];
			const provider: TtsProvider = withFallback(failingElevenLabs, workingPolly, (event) =>
				events.push(event)
			);

			const outPath = path.join(dir, 'narration.mp3');
			const result = await provider.synthesize(SAMPLE_TEXT, POLLY_VOICE, outPath);

			expect(result.provider).toBe('polly');
			expect(result.audioPath).toBe(outPath);

			const fileStat = await stat(outPath);
			expect(fileStat.size).toBeGreaterThan(0);

			expect(events).toHaveLength(1);
			expect(events[0].primaryProvider).toBe('elevenlabs');
			expect(events[0].fallbackProvider).toBe('polly');
			expect(events[0].reason).toMatch(/simulated ElevenLabs outage/);
		});
	});

	it('reports which provider served the audio, even when the primary succeeds', async () => {
		await withTempDir(async (dir) => {
			const workingElevenLabs = new ElevenLabsProvider(fakeElevenLabsClient());
			const unusedPolly = new PollyProvider(fakePollyClient());
			const onFallback = vi.fn();

			const provider = withFallback(workingElevenLabs, unusedPolly, onFallback);
			const result = await provider.synthesize(
				SAMPLE_TEXT,
				ELEVEN_LABS_VOICE,
				path.join(dir, 'narration.wav')
			);

			expect(result.provider).toBe('elevenlabs');
			expect(onFallback).not.toHaveBeenCalled();
		});
	});

	it('never swallows the fallback provider failing too', async () => {
		await withTempDir(async (dir) => {
			const failingElevenLabs = new ElevenLabsProvider(fakeElevenLabsClient({ fail: true }));
			const failingPolly: TtsProvider = {
				name: 'polly',
				async synthesize() {
					throw new Error('simulated Polly outage');
				}
			};

			const provider = withFallback(failingElevenLabs, failingPolly);

			await expect(
				provider.synthesize(SAMPLE_TEXT, POLLY_VOICE, path.join(dir, 'narration.mp3'))
			).rejects.toThrow(/simulated Polly outage/);
		});
	});
});

describe('resolveTtsConfig', () => {
	it('defaults to ElevenLabs primary, Polly fallback', () => {
		const config = resolveTtsConfig({});
		expect(config.primary).toBe('elevenlabs');
		expect(config.fallback).toBe('polly');
	});

	it('picks Polly as primary when configured, without throwing', () => {
		const config = resolveTtsConfig({ TTS_PRIMARY_PROVIDER: 'polly' });
		expect(config.primary).toBe('polly');
		expect(config.fallback).toBe('elevenlabs');
	});

	it('reports missing credentials without throwing at import time', () => {
		const config = resolveTtsConfig({});
		expect(config.hasElevenLabsCredentials).toBe(false);
		expect(config.hasPollyCredentials).toBe(false);
	});

	it('reports credentials present when supplied', () => {
		const config = resolveTtsConfig({
			ELEVENLABS_API_KEY: 'fake-key',
			AWS_ACCESS_KEY_ID: 'fake-id',
			AWS_SECRET_ACCESS_KEY: 'fake-secret'
		});
		expect(config.hasElevenLabsCredentials).toBe(true);
		expect(config.hasPollyCredentials).toBe(true);
	});
});
