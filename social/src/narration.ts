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
import {
	lineTimingsFromMarks,
	assertNarrationInSync,
	NARRATION_DRIFT_TOLERANCE_MS,
	type NarrationLineTiming
} from './audio/timing.js';
import { FFMPEG_BIN, probe } from './render/encode.js';
import type { AuthorSlug } from './render/theme.js';

const execFileAsync = promisify(execFile);

/**
 * How many multiples of the longest OTHER mark's own duration a collapsed
 * Polly final mark (see `synthesizeNarration`'s doc comment) is allowed to
 * imply for the final word's real length, before the repair below refuses
 * to guess and throws instead of silently stretching it (F13, re-review of
 * F09).
 *
 * F09's repair closed the collapsed final mark to the probed file duration
 * UNCONDITIONALLY, on the assumption that "audio duration minus the final
 * mark's `startMs`" is always a plausible final-word length. It isn't: that
 * quantity is also exactly what a genuinely desynchronized mark set (marks
 * that simply don't correspond to the audio at all) looks like, and Polly
 * collapses the final mark on every real result, so the repair applied —
 * and rewrote the last line's end to the file duration — on every single
 * Polly call, whether or not the marks actually matched the audio. That
 * makes the drift gate downstream of the repair permanently unable to fire
 * for Polly: it was reviewer-demonstrated with real-shaped marks
 * `[{Duty,0,100},{is,100,200},{the,200,300},{way.,300,300}]` replayed
 * against a real ~1254ms fixture file — four times longer than the marks
 * claim — which passed and reported `endSeconds: 1.253878` for a line the
 * marks say ends at 300ms.
 *
 * `POLLY_FINAL_WORD_MAX_STRETCH_FACTOR` bounds the repair instead: the
 * implied final-word duration may be at most this many times the longest
 * duration among the OTHER (non-final) marks in the same call, plus
 * `NARRATION_DRIFT_TOLERANCE_MS` of slack. 3x is deliberately generous, not
 * tight — final syllables commonly lengthen before a pause (terminal
 * lengthening), and a slow, deliberate closing word or a trailing "…" can
 * legitimately run noticeably longer than the words around it. 3x absorbs
 * that without requiring every word in the line to be similarly slow. What
 * it does NOT absorb is genuinely desynchronized marks, which imply a final
 * "word" many multiples longer than anything else in the line — the
 * reviewer's reproduction above implies ~954ms against a 100ms baseline,
 * over 9x, nowhere near the 3x bound — or a mark set that simply doesn't
 * belong to the audio file at all.
 *
 * Legitimately long final words are the one case this bound can reject a
 * true positive on: an author whose closing line ends on an unusually long
 * word AND whose other words in that line are all unusually short could, in
 * principle, exceed 3x. That failure mode throws loudly (naming the implied
 * and maximum-plausible durations) rather than silently mis-timing a
 * render, which is the correct tradeoff here — per this repo's existing
 * philosophy (`audio/timing.ts`'s `lineTimingsFromMarks`: "refuse to guess"
 * rather than fabricate a plausible-looking timing).
 */
export const POLLY_FINAL_WORD_MAX_STRETCH_FACTOR = 3;

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
 *
 * That Polly under-report has a second consequence this function must
 * correct BEFORE gating, not just avoid: `timings`' own last line also ends
 * at that same too-early `startMs`, because `lineTimingsFromMarks` reads
 * its `endSeconds` straight off the same collapsed final mark. Gating an
 * uncorrected `timings` against the probed (correct) file duration would
 * then mean drift is ALWAYS roughly "the final word's real duration plus
 * any trailing silence" — comfortably outside `NARRATION_DRIFT_TOLERANCE_MS`
 * on any real clip — so the gate would reject every genuine Polly render,
 * never just the actually-drifted ones. So: close the collapsed final mark
 * with the probed file duration first, and rebuild `timings` from THAT
 * corrected mark set, before calling `assertNarrationInSync`.
 *
 * The repair is deliberately gated on `tts.provider === 'polly'` AND the
 * collapsed shape (`endMs === startMs`), not on the shape alone. Polly's
 * "no duration for the final word" behavior is a documented, systematic
 * property of `parsePollySpeechMarks` — but it applies on EVERY real Polly
 * result, so gating on shape alone is not enough to keep the repair from
 * also swallowing a genuinely desynchronized mark set (F13, re-review of
 * F09): a collapsed final mark looks identical whether the marks are merely
 * under-reporting the last word or are simply wrong. So the repair is ALSO
 * bounded (see `POLLY_FINAL_WORD_MAX_STRETCH_FACTOR` above): it only closes
 * the final mark when doing so implies a plausible final-word length,
 * otherwise it throws rather than guess. ElevenLabs' marks are per-CHARACTER
 * timestamps read directly off its own response (`elevenLabsAlignmentToMarks`);
 * a zero-duration final character there isn't a known artifact of this
 * codebase's parsing (unlike Polly's, it isn't manufactured by our own
 * code) and could be a legitimate report — or a symptom of a genuinely
 * broken response worth surfacing as drift, not silently stretching to fit.
 * Repairing it the same way would risk masking a real ElevenLabs bug
 * instead of a known Polly quirk.
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

	const probed = await probe(outPath);
	if (probed.durationSec === null || !Number.isFinite(probed.durationSec)) {
		throw new Error(
			`synthesizeNarration: ffprobe could not determine a duration for the written narration file at ${outPath}.`
		);
	}
	const audioDurationMs = probed.durationSec * 1000;

	// Repair Polly's collapsed final-word mark (see doc comment above) with
	// the probed file duration BEFORE deriving timings, so the drift gate
	// measures real drift rather than the final word's own duration. Never
	// mutates `tts.marks` in place — `tts` is returned to the caller as-is.
	const marks = tts.marks;
	const lastMark = marks[marks.length - 1];
	const isCollapsedPollyFinalMark =
		tts.provider === 'polly' && lastMark !== undefined && lastMark.endMs === lastMark.startMs;

	let repairedMarks = marks;
	if (isCollapsedPollyFinalMark && audioDurationMs > lastMark.startMs) {
		// Bound the repair (F13, re-review of F09): only close the collapsed
		// mark when doing so implies a PLAUSIBLE final-word length, relative
		// to the other words actually spoken in this same call. See
		// `POLLY_FINAL_WORD_MAX_STRETCH_FACTOR`'s doc comment for the full
		// reasoning and the reviewer's reproduction this guards against, and
		// its second doc comment for why the check is skipped entirely below
		// when there's no baseline to measure against.
		const otherMarks = marks.slice(0, -1);
		const longestOtherMarkMs = otherMarks.reduce(
			(longest, mark) => Math.max(longest, mark.endMs - mark.startMs),
			0
		);

		// Degenerate case: no baseline to measure against — either a
		// single-mark narration (`otherMarks` is empty) or a mark set where
		// every OTHER mark also happens to be zero-length. In both,
		// `impliedFinalMs` below isn't really "how long the final word alone
		// took" — with nothing preceding it to anchor `lastMark.startMs`
		// away from 0, it collapses to roughly the whole clip's duration.
		// There's no comparison point in the data that could tell "a single
		// word that legitimately took the whole clip to say" apart from
		// "marks that don't correspond to this audio at all" — both look
		// identical here, so a bound could only ever reject the LEGITIMATE
		// case; it could never catch the desynced one, since desync is
		// exactly what a long lone word looks like too. So: skip the
		// plausibility check and repair unconditionally, same as before
		// F13. This keeps the F13 fix scoped to the case it was written
		// for — ordinary multi-word Polly lines, which is what every real
		// card line in this codebase is.
		if (longestOtherMarkMs > 0) {
			const maxPlausibleFinalMs =
				POLLY_FINAL_WORD_MAX_STRETCH_FACTOR * longestOtherMarkMs + NARRATION_DRIFT_TOLERANCE_MS;
			const impliedFinalMs = audioDurationMs - lastMark.startMs;

			if (impliedFinalMs > maxPlausibleFinalMs) {
				throw new Error(
					'synthesizeNarration: refusing to repair a collapsed Polly final mark — the implied final-word ' +
						`duration (${impliedFinalMs}ms, from audio duration ${audioDurationMs}ms minus the final ` +
						`mark's startMs ${lastMark.startMs}ms) exceeds the maximum plausible final-word duration ` +
						`(${maxPlausibleFinalMs}ms = ${POLLY_FINAL_WORD_MAX_STRETCH_FACTOR}x the longest other ` +
						`word's duration in this call, ${longestOtherMarkMs}ms, plus ` +
						`±${NARRATION_DRIFT_TOLERANCE_MS}ms tolerance). This almost always means the marks and ` +
						'the written audio file are desynchronized, not that the final word is unusually long.'
				);
			}
		}

		repairedMarks = [...marks.slice(0, -1), { ...lastMark, endMs: audioDurationMs }];
	}

	const timings = lineTimingsFromMarks(lines, { ...tts, marks: repairedMarks });

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
