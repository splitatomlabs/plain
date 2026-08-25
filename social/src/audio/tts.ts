/**
 * TTS provider interface.
 *
 * `synthesize(text, voice, outPath) -> TtsResult` is satisfied by both
 * ElevenLabs (primary, ~$22/mo) and Amazon Polly (fallback), so swapping
 * providers is config (`resolveTtsConfig`), never code. Both providers
 * return the SAME normalized `TtsResult` shape from their very different
 * native payloads.
 *
 * Timing: `TtsResult.marks` carries the provider's OWN timing data through
 * unchanged (unit-converted and reshaped, never estimated from word
 * counts). ElevenLabs returns character-level alignment; Polly returns
 * newline-delimited speech-mark events. Building line-level timing out of
 * these marks is T13's job, not this module's.
 *
 * THE HOUSE RULE: TTS pitch and rate must never go below the provider
 * default. `assertVoiceSettingsWithinHouseRule` enforces this before either
 * provider synthesizes anything.
 */

import { mkdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type { SynthesizeSpeechCommandOutput } from '@aws-sdk/client-polly';
import { SynthesizeSpeechCommand } from '@aws-sdk/client-polly';

export type ProviderName = 'elevenlabs' | 'polly';

/** Multipliers relative to the provider default. 1.0 = default. */
export interface VoiceSettingsInput {
	pitch?: number;
	rate?: number;
}

export interface TtsVoice {
	provider: ProviderName;
	voiceId: string;
	label: string;
	/** Optional overrides; validated against the house rule before synthesis. */
	settings?: VoiceSettingsInput;
}

/** Normalized native timing, carried through from the provider's own payload. */
export interface ProviderMark {
	text: string;
	startMs: number;
	endMs: number;
}

export interface TtsResult {
	audioPath: string;
	provider: ProviderName;
	voiceId: string;
	durationMs: number;
	marks: ProviderMark[];
}

export interface TtsProvider {
	readonly name: ProviderName;
	synthesize(text: string, voice: TtsVoice, outPath: string): Promise<TtsResult>;
}

// ---------------------------------------------------------------------------
// House rule: pitch and rate never below default.
// ---------------------------------------------------------------------------

const HOUSE_RULE =
	'the house rule (plans/Pf39c2-social-pilot-02.md): TTS pitch and rate never below default — no "wise deep voice"';

const DEFAULT_SETTING = 1;

/**
 * Rejects any synthesis request whose pitch or rate is below the provider
 * default (1.0). Default-or-above only. Called by both providers before
 * they synthesize anything.
 */
export function assertVoiceSettingsWithinHouseRule(settings: VoiceSettingsInput | undefined): void {
	const pitch = settings?.pitch ?? DEFAULT_SETTING;
	const rate = settings?.rate ?? DEFAULT_SETTING;

	if (pitch < DEFAULT_SETTING) {
		throw new Error(
			`Voice pitch ${pitch} is below the provider default (${DEFAULT_SETTING}) — this violates ${HOUSE_RULE}.`
		);
	}
	if (rate < DEFAULT_SETTING) {
		throw new Error(
			`Voice rate ${rate} is below the provider default (${DEFAULT_SETTING}) — this violates ${HOUSE_RULE}.`
		);
	}
}

async function writeAudioFile(outPath: string, bytes: Uint8Array): Promise<void> {
	if (bytes.length === 0) {
		throw new Error('Refusing to write an empty audio file');
	}
	await mkdir(path.dirname(outPath), { recursive: true });
	await writeFile(outPath, bytes);
}

// ---------------------------------------------------------------------------
// ElevenLabs
// ---------------------------------------------------------------------------

export interface ElevenLabsAlignment {
	characters: string[];
	characterStartTimesSeconds: number[];
	characterEndTimesSeconds: number[];
}

export interface ElevenLabsTimestampsResponse {
	/** Base64-encoded audio data. */
	audioBase64: string;
	alignment?: ElevenLabsAlignment;
	normalizedAlignment?: ElevenLabsAlignment;
}

export interface ElevenLabsVoiceSettingsParam {
	stability?: number;
	similarityBoost?: number;
	style?: number;
	speed?: number;
	useSpeakerBoost?: boolean;
}

/**
 * The slice of `@elevenlabs/elevenlabs-js`'s `ElevenLabsClient` this module
 * depends on. A real `ElevenLabsClient` instance satisfies this
 * structurally; tests inject a fake.
 */
export interface ElevenLabsTtsClient {
	textToSpeech: {
		convertWithTimestamps(
			voiceId: string,
			params: {
				text: string;
				modelId?: string;
				voiceSettings?: ElevenLabsVoiceSettingsParam;
			}
		): Promise<ElevenLabsTimestampsResponse>;
	};
}

function elevenLabsAlignmentToMarks(alignment: ElevenLabsAlignment | undefined): ProviderMark[] {
	if (!alignment) {
		return [];
	}
	const { characters, characterStartTimesSeconds, characterEndTimesSeconds } = alignment;
	return characters.map((text, i) => ({
		text,
		startMs: Math.round((characterStartTimesSeconds[i] ?? 0) * 1000),
		endMs: Math.round((characterEndTimesSeconds[i] ?? 0) * 1000)
	}));
}

export class ElevenLabsProvider implements TtsProvider {
	readonly name: ProviderName = 'elevenlabs';

	/** Client is constructor-injected — never constructed here, so tests can pass a fake. */
	constructor(private readonly client: ElevenLabsTtsClient) {}

	async synthesize(text: string, voice: TtsVoice, outPath: string): Promise<TtsResult> {
		assertVoiceSettingsWithinHouseRule(voice.settings);

		const response = await this.client.textToSpeech.convertWithTimestamps(voice.voiceId, {
			text,
			voiceSettings: { speed: voice.settings?.rate ?? DEFAULT_SETTING }
		});

		if (!response || typeof response.audioBase64 !== 'string' || response.audioBase64.length === 0) {
			throw new Error('ElevenLabs returned an empty response');
		}

		const audioBytes = Buffer.from(response.audioBase64, 'base64');
		await writeAudioFile(outPath, audioBytes);

		const marks = elevenLabsAlignmentToMarks(response.alignment ?? response.normalizedAlignment);

		return {
			audioPath: outPath,
			provider: this.name,
			voiceId: voice.voiceId,
			durationMs: marks.length > 0 ? marks[marks.length - 1].endMs : 0,
			marks
		};
	}
}

// ---------------------------------------------------------------------------
// Polly
// ---------------------------------------------------------------------------

/**
 * The slice of `@aws-sdk/client-polly`'s `PollyClient` this module depends
 * on. A real `PollyClient` instance satisfies this structurally; tests
 * inject a fake.
 */
export interface PollyClientLike {
	send(command: SynthesizeSpeechCommand): Promise<SynthesizeSpeechCommandOutput>;
}

interface PollySpeechMarkEvent {
	time: number;
	type: string;
	start?: number;
	end?: number;
	value?: string;
}

/**
 * Parses Polly's newline-delimited-JSON speech marks into normalized marks.
 * Polly only carries a start `time` per word — never a duration — so a
 * word's end is taken from the NEXT word's native start time. The final
 * word has no successor to read an end time from, so its end is left equal
 * to its own start; estimating one from word length would violate the
 * "never estimate from word counts" rule.
 */
function parsePollySpeechMarks(ndjson: string): ProviderMark[] {
	const events: PollySpeechMarkEvent[] = ndjson
		.split('\n')
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => JSON.parse(line) as PollySpeechMarkEvent);

	const words = events.filter(
		(event): event is PollySpeechMarkEvent & { value: string } =>
			event.type === 'word' && typeof event.value === 'string'
	);

	return words.map((word, i) => ({
		text: word.value,
		startMs: word.time,
		endMs: i + 1 < words.length ? words[i + 1].time : word.time
	}));
}

export class PollyProvider implements TtsProvider {
	readonly name: ProviderName = 'polly';

	/** Client is constructor-injected — never constructed here, so tests can pass a fake. */
	constructor(private readonly client: PollyClientLike) {}

	async synthesize(text: string, voice: TtsVoice, outPath: string): Promise<TtsResult> {
		assertVoiceSettingsWithinHouseRule(voice.settings);

		// Polly can't return audio and speech marks from a single call — marks
		// are only available for `OutputFormat: 'json'`, mutually exclusive
		// with an audio format. Two calls, same text and voice.
		const marksResponse = await this.client.send(
			new SynthesizeSpeechCommand({
				Text: text,
				OutputFormat: 'json',
				SpeechMarkTypes: ['word'],
				VoiceId: voice.voiceId as SynthesizeSpeechCommand['input']['VoiceId']
			})
		);
		if (!marksResponse.AudioStream) {
			throw new Error('Polly returned no speech-marks stream');
		}
		const marksNdjson = await marksResponse.AudioStream.transformToString();

		const audioResponse = await this.client.send(
			new SynthesizeSpeechCommand({
				Text: text,
				OutputFormat: 'mp3',
				VoiceId: voice.voiceId as SynthesizeSpeechCommand['input']['VoiceId']
			})
		);
		if (!audioResponse.AudioStream) {
			throw new Error('Polly returned no audio stream');
		}
		const audioBytes = await audioResponse.AudioStream.transformToByteArray();
		await writeAudioFile(outPath, audioBytes);

		const marks = parsePollySpeechMarks(marksNdjson);

		return {
			audioPath: outPath,
			provider: this.name,
			voiceId: voice.voiceId,
			durationMs: marks.length > 0 ? marks[marks.length - 1].endMs : 0,
			marks
		};
	}
}

// ---------------------------------------------------------------------------
// Failover
// ---------------------------------------------------------------------------

export interface FallbackEvent {
	primaryProvider: ProviderName;
	fallbackProvider: ProviderName;
	reason: string;
}

/**
 * Wraps `primary` with `fallback`. Falls back when `primary` throws, or
 * when it resolves without producing a non-empty audio file (the
 * "non-2xx/empty response" case — both providers already throw on an empty
 * provider response, but this is a second line of defense against a
 * provider that resolves successfully yet writes nothing).
 *
 * Reports which provider actually served the audio via `console` and the
 * optional `onFallback` callback. Never swallows the fallback's own
 * failure — if `fallback` also throws, that error propagates.
 */
export function withFallback(
	primary: TtsProvider,
	fallback: TtsProvider,
	onFallback?: (event: FallbackEvent) => void
): TtsProvider {
	return {
		name: primary.name,
		async synthesize(text, voice, outPath) {
			try {
				const result = await primary.synthesize(text, voice, outPath);
				const info = await stat(result.audioPath).catch(() => null);
				if (!info || info.size === 0) {
					throw new Error(`${primary.name} produced no audio (empty or missing file)`);
				}
				console.info(`[tts] served by ${result.provider}`);
				return result;
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				console.warn(`[tts] ${primary.name} failed (${reason}); falling back to ${fallback.name}`);
				onFallback?.({ primaryProvider: primary.name, fallbackProvider: fallback.name, reason });

				// Deliberately not wrapped in try/catch — a fallback failure must
				// propagate, never be swallowed.
				const result = await fallback.synthesize(text, voice, outPath);
				console.info(`[tts] served by ${result.provider} (fallback from ${primary.name})`);
				return result;
			}
		}
	};
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export interface TtsEnv {
	TTS_PRIMARY_PROVIDER?: string;
	ELEVENLABS_API_KEY?: string;
	AWS_ACCESS_KEY_ID?: string;
	AWS_SECRET_ACCESS_KEY?: string;
	AWS_REGION?: string;
	[key: string]: string | undefined;
}

export interface TtsConfig {
	primary: ProviderName;
	fallback: ProviderName;
	hasElevenLabsCredentials: boolean;
	hasPollyCredentials: boolean;
}

/**
 * Pure config resolution — which provider is primary, and whether each
 * provider's credentials are present — taking an env object as an
 * argument. Nothing in this module reads `process.env` directly, so
 * swapping providers is config, not code. Never throws, even when
 * credentials are missing; callers decide what to do about that.
 */
export function resolveTtsConfig(env: TtsEnv): TtsConfig {
	const primary: ProviderName = env.TTS_PRIMARY_PROVIDER === 'polly' ? 'polly' : 'elevenlabs';
	const fallback: ProviderName = primary === 'elevenlabs' ? 'polly' : 'elevenlabs';

	return {
		primary,
		fallback,
		hasElevenLabsCredentials: Boolean(env.ELEVENLABS_API_KEY),
		hasPollyCredentials: Boolean(env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY)
	};
}
