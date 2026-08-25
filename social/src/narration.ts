/**
 * The real-narration path (T18 item 4) — wired now, even though it can
 * never run in this environment: `audio/voices.ts`'s `VOICE_REGISTRY` is
 * unset (T14 is blocked — no `ELEVENLABS_API_KEY`, and T12 forbids live
 * provider calls in tests), so every call here is unreachable until T14
 * lands. When it does, `cli.ts`'s `render` command flips from music-only to
 * this path automatically (`!VOICES_ARE_UNSET`) with NO CODE CHANGE beyond
 * populating that registry — "only the voice lookup missing," per the plan.
 *
 * Uses the exact same tested plumbing every other narration-aware module in
 * this workspace does: `resolveVoice` (voices.ts), a real `TtsProvider`
 * (tts.ts, constructor-injected with the real ElevenLabs/Polly SDK clients),
 * `lineTimingsFromMarks` + `assertNarrationInSync` (timing.ts) — never a
 * reimplementation of any of them.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { ElevenLabsClient } from '@elevenlabs/elevenlabs-js';
import { PollyClient } from '@aws-sdk/client-polly';

import {
	ElevenLabsProvider,
	PollyProvider,
	resolveTtsConfig,
	withFallback,
	type TtsEnv,
	type TtsProvider,
	type TtsResult
} from './audio/tts.js';
import { resolveVoice } from './audio/voices.js';
import { lineTimingsFromMarks, assertNarrationInSync, type NarrationLineTiming } from './audio/timing.js';
import { FFMPEG_BIN, probe } from './render/encode.js';
import type { AuthorSlug } from './render/theme.js';

const execFileAsync = promisify(execFile);

/** Builds the real TTS provider (ElevenLabs primary, Polly fallback), reading credentials from `env`. */
export function buildTtsProvider(env: TtsEnv): TtsProvider {
	const config = resolveTtsConfig(env);
	const elevenLabs = new ElevenLabsProvider(new ElevenLabsClient({ apiKey: env.ELEVENLABS_API_KEY }));
	const polly = new PollyProvider(new PollyClient({ region: env.AWS_REGION }));
	return config.primary === 'elevenlabs' ? withFallback(elevenLabs, polly) : withFallback(polly, elevenLabs);
}

export interface NarrationResult {
	timings: NarrationLineTiming[];
	tts: TtsResult;
	/**
	 * The WRITTEN AUDIO FILE's own duration, in milliseconds, as measured by
	 * ffprobe (`render/encode.ts`'s `probe`) — never `tts.durationMs`. See
	 * this module's `synthesizeNarration` doc comment for why: `tts.durationMs`
	 * is derived from the provider's own marks, so comparing it against
	 * `timings` (also derived from those same marks) is circular and can
	 * never detect real drift. Callers (`cli.ts`) should use THIS value, not
	 * `tts.durationMs`, for anything measuring real audio length — e.g. the
	 * ducking span handed to `audio/mix.ts`.
	 */
	audioDurationMs: number;
}

/**
 * Synthesizes `lines` (spoken as one continuous clip, joined with spaces —
 * matching how `lineTimingsFromMarks` expects to match a provider's native
 * marks back onto per-line boundaries) for `author`'s fixed voice, and
 * derives + validates per-line timing. Throws (via `assertNarrationInSync`)
 * rather than shipping a drifted narration track.
 *
 * The drift gate is checked against the WRITTEN FILE's real duration
 * (probed with ffprobe), not `tts.durationMs`. `tts.durationMs` is read off
 * the SAME provider marks that `timings` is derived from (`lineTimingsFromMarks`
 * — see `audio/timing.ts`), so comparing `timings` against it is circular:
 * drift is structurally zero and the gate can never fire. It is also wrong
 * on Polly specifically — `parsePollySpeechMarks` (`audio/tts.ts`) sets the
 * FINAL word's `endMs` equal to its own `startMs` (Polly never reports a
 * duration for the last word), so `tts.durationMs` under-reports the actual
 * mp3 by the whole final word. Probing the file on disk sidesteps both
 * problems by measuring the one thing that is actually authoritative: the
 * audio a listener will hear.
 */
export async function synthesizeNarration(
	lines: string[],
	author: AuthorSlug,
	provider: TtsProvider,
	env: TtsEnv,
	outPath: string
): Promise<NarrationResult> {
	const voice = resolveVoice(author, resolveTtsConfig(env));
	const tts = await provider.synthesize(lines.join(' '), voice, outPath);
	const timings = lineTimingsFromMarks(lines, tts);

	const probed = await probe(outPath);
	if (probed.durationSec === null || !Number.isFinite(probed.durationSec)) {
		throw new Error(
			`synthesizeNarration: ffprobe could not determine a duration for the written narration file at ${outPath}.`
		);
	}
	const audioDurationMs = probed.durationSec * 1000;

	assertNarrationInSync(timings, audioDurationMs);
	return { timings, tts, audioDurationMs };
}

/**
 * Prepends `leadingMs` of silence to `inputPath`'s audio, writing the
 * result to `outPath` — needed because `mix()` always plays a supplied
 * `narrationPath` starting at t=0 of the whole mix, but The Wall's
 * narrated phase (the rest of the plain passage) starts partway through
 * the composition, right after the silent wall + landing-line phases. A
 * no-op copy when `leadingMs` is `0` (The Question/The Objection use this
 * too, and their narrated phase does not always start at t=0 either — see
 * `cli.ts`'s callers).
 */
export async function prependSilence(inputPath: string, leadingMs: number, outPath: string): Promise<void> {
	const delayMs = Math.max(0, Math.round(leadingMs));
	await execFileAsync(FFMPEG_BIN, ['-y', '-i', inputPath, '-af', `adelay=${delayMs}:all=true`, outPath]);
}
