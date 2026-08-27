/**
 * The narration contract (social pilot 02a T14): what The Wall's audio is
 * SUPPOSED to look like once the framing layer (T11-T13) and the payoff fix
 * (T02-T09) have landed. Four things asserted here, straight from the plan:
 *
 *   1. `wallSilentSpans()` covers the LANDING LINE ALONE — the moving-wall
 *      scroll is no longer silenced; it carries the music bed instead.
 *   2. Rest lines (`narrationPlan`'s `lines` for a `'wall'` plan) are the
 *      ONLY narrated set — never the landing line, never the original
 *      excerpt, never the chapter scroll block.
 *   3. Framing text (the running head, the payoff label, the read-through
 *      counter — `SourceHead.tsx`/`Counter.tsx`) never reaches
 *      `TtsProvider.synthesize`, for any of the four compositions.
 *   4. A Wall whose `plain_english` is a single sentence — no rest lines,
 *      hence NOTHING narrated at all — still produces a valid, non-silent
 *      mix (the F02 edge case: ffmpeg's `loudnorm` measuring a mix as
 *      digital silence on its first pass).
 *
 * ORDERING (per the plan): T15, not this task, is what actually shrinks
 * `wallSilentSpans()` down to the landing line alone and moves the bed
 * under the scroll. Assertion 1 below is therefore RED against today's
 * implementation (`wallSilentSpans()` still spans the full
 * `WALL_FRAMES + LANDING_LINE_FRAMES` window, starting at 0) and is
 * EXPECTED to fail until T15 lands — see that test's own comment.
 * Assertions 2-4 hold already, against the current (pre-T15) code, and are
 * pinned here as regression protection before T15 touches `wallSilentSpans`/
 * `mix.ts` at all.
 *
 * No live provider calls anywhere in this file. `synthesizeNarration` is
 * always given a fake `TtsProvider` that writes the recorded
 * `polly-sample.mp3` fixture and reports whatever marks the test hands it —
 * same pattern `social/src/__tests__/narration.test.ts` (F07/F09/F13) uses.
 * `resolveVoice` (`audio/voices.js`) is mocked to a fixed voice because
 * `VOICES_ARE_UNSET` (T14 in the OLDER plan 02 — no `ELEVENLABS_API_KEY`,
 * and live provider calls are forbidden in tests) unconditionally throws
 * otherwise.
 *
 * `cli.ts`'s `wallSilentSpans`/`narrationPlan` are private implementation
 * of the render CLI, exported here (visibility only, no behavior change) so
 * this file can assert on them directly. Importing `cli.ts` at all is only
 * safe because of the entry-point guard added alongside those exports —
 * without it, `main()` runs at import time and calls `process.exit()`. See
 * that guard's own comment in `cli.ts`.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AuthorSlug } from '../../render/theme.js';
import type { WallPlan, QuestionPlan, ObjectionPlan, StillPlan } from '../../cli.js';
import { wallSilentSpans, wallNoiseSpans, narrationPlan } from '../../cli.js';
import { FPS, WALL_FRAMES, computeWallTiming } from '../../remotion/wall-timing.js';
import { computeQuestionTiming, ANSWER_FRAMES } from '../../remotion/question-timing.js';
import { computeObjectionTiming, OBJECTION_REPLY_LINE_COUNT, OBJECTION_REPLY_LINE_FRAMES } from '../../remotion/objection-timing.js';
import { formatRunningHead, PAYOFF_LABEL_TEXT } from '../../remotion/SourceHead.js';
import { splitPayoffLines, lineTimingsFromMarks, assertNarrationInSync } from '../timing.js';
import { bedPath } from '../beds.js';
import { LOUDNESS_TOLERANCE_LU, TARGET_LUFS, mix } from '../mix.js';
import type { ProviderMark, TtsProvider, TtsResult } from '../tts.js';

const MIX_TIMEOUT_MS = 30_000;

// `resolveVoice` (`audio/voices.js`) unconditionally throws while T14 (plan
// 02) is blocked — mocked to a fixed voice so `synthesizeNarration` below is
// reachable at all. `vi.mock` is hoisted above every import in this file
// (including the one below), so `narration.js`'s own
// `import { resolveVoice } from './audio/voices.js'` resolves to this mock
// too — same pattern as `social/src/__tests__/narration.test.ts`.
vi.mock('../voices.js', () => ({
	resolveVoice: () => ({ provider: 'polly' as const, voiceId: 'test-voice', label: 'test' })
}));

import { synthesizeNarration } from '../../narration.js';

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(moduleDir, 'fixtures');

// ---------------------------------------------------------------------------
// Shared fixtures — real card-shaped WallPlan/QuestionPlan/ObjectionPlan/
// StillPlan literals, never live pipeline output (this file's whole point is
// to be independent of any real render), but shaped exactly like `cli.ts`'s
// `buildRenderPlan` produces them.
// ---------------------------------------------------------------------------

const WALL_PLAN: WallPlan = {
	format: 'wall',
	originalExcerpt: 'Thys is ye archaick excerpte that scrolles by, never itself narrated.',
	chapterBlock: 'Thys is ye archaick excerpte that scrolles by, never itself narrated, plus the surrounding chapter.',
	sourceReference: 'Meditations, Book 7, Section 3',
	landingLine: 'This is the landing line, held in silence.',
	plainLines: ['This is the first rest line.', 'This is the second rest line.']
};

const QUESTION_PLAN: QuestionPlan = {
	format: 'question',
	question: 'Is this bare question ever narrated?',
	answer: 'No — only this plain answer is ever narrated.',
	originalExcerpt: 'Thys is ye archaick excerpte for the question wall phase.',
	chapterBlock: 'Thys is ye archaick excerpte for the question wall phase, plus the surrounding chapter.',
	sourceReference: 'Discourses, Book 3, Section 1'
};

const OBJECTION_PLAN: ObjectionPlan = {
	format: 'objection',
	objection: 'But surely the bare objection quote is narrated?',
	reply: 'No, it is not. Only the reply is narrated. A third sentence here is dropped by OBJECTION_REPLY_LINE_COUNT.',
	sourceReference: 'On Anger, Book 1, Section 9'
};

const STILL_PLAN: StillPlan = {
	format: 'still',
	text: 'This still passage is narrated in full. Every sentence of it.',
	sourceReference: 'Meditations, Book 2, Section 1'
};

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(path.join(tmpdir(), 'plain-social-narration-contract-'));
	tempDirs.push(dir);
	return dir;
}

afterAll(async () => {
	await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/**
 * A fake `TtsProvider` that records the EXACT `text` argument every call to
 * `synthesize` receives (in `calls`, in order) and writes the real,
 * committed `polly-sample.mp3` fixture to `outPath` so any downstream
 * `ffprobe` call in `synthesizeNarration` sees a real, playable file. The
 * `marks` it reports are irrelevant to this file's assertions — nothing here
 * needs `synthesizeNarration`'s drift gate to actually PASS, only that
 * `synthesize` is REACHED with the right (or wrong) text; a failure past
 * that point is caught and ignored (see `capturedSynthesizeText`).
 */
function recordingProvider(calls: string[]): TtsProvider {
	return {
		name: 'polly',
		async synthesize(text, _voice, outPath): Promise<TtsResult> {
			calls.push(text);
			const audio = await readFile(path.join(fixturesDir, 'polly-sample.mp3'));
			await writeFile(outPath, audio);
			const marks: ProviderMark[] = [];
			return { audioPath: outPath, provider: 'polly', voiceId: 'test-voice', durationMs: 0, marks };
		}
	};
}

/**
 * Runs `synthesizeNarration(lines, ...)` against a recording fake provider
 * and returns the exact text it handed to `synthesize` — regardless of
 * whether `synthesizeNarration` itself went on to succeed or throw (an
 * empty/mismatched `marks` array from `recordingProvider` will usually make
 * it throw past the `synthesize` call, in `lineTimingsFromMarks` or
 * `assertNarrationInSync` — irrelevant here, since by then `synthesize` has
 * already been called with whatever text it was going to get).
 */
async function capturedSynthesizeText(lines: string[]): Promise<string> {
	const calls: string[] = [];
	const provider = recordingProvider(calls);
	const dir = await makeTempDir();
	const outPath = path.join(dir, 'narration.mp3');
	try {
		await synthesizeNarration(lines, 'epictetus' as AuthorSlug, provider, {}, outPath);
	} catch {
		// See doc comment above — downstream timing failures are expected
		// and irrelevant to what text reached `synthesize`.
	}
	expect(calls).toHaveLength(1);
	return calls[0];
}

/** Mean volume (dBFS) of `filePath` over [startSec, endSec), via ffmpeg's `volumedetect`. */
function meanVolumeDb(filePath: string, startSec: number, endSec: number): number {
	const result = spawnSync(
		'ffmpeg',
		['-y', '-i', filePath, '-af', `atrim=start=${startSec}:end=${endSec},volumedetect`, '-f', 'null', '-'],
		{ encoding: 'utf-8' }
	);
	const match = result.stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
	if (!match) {
		throw new Error(`Could not find mean_volume in ffmpeg output:\n${result.stderr}`);
	}
	return Number(match[1]);
}

// ---------------------------------------------------------------------------
// 1. wallSilentSpans/wallNoiseSpans — U04's "noise, then 0.5s of true
//    silence, then the bed's own slow return" shape
// ---------------------------------------------------------------------------

describe('wallSilentSpans / wallNoiseSpans', () => {
	const wallEndMs = (WALL_FRAMES / FPS) * 1000;

	/**
	 * U04 (`plans/Pf39c2-social-pilot-02a.md`) narrowed this from T15's "the
	 * landing line ALONE" (2.5s -> 5.5s) down to just the 0.5s of TRUE
	 * silence right after the cut — the rest of the old landing-line-hold
	 * window is no longer silent: `wallNoiseSpans` carries the scroll instead
	 * of the bed, and the bed's own slow `BED_RETURN_FADE_MS` fade-in
	 * (`audio/mix.ts`'s `bedEnvelope`) fills the back end, landing at nominal
	 * exactly when the landing line ends.
	 */
	it('wallSilentSpans: covers only 0.5s of TRUE silence, starting where the wall scroll ends', () => {
		expect(wallSilentSpans()).toEqual([{ startMs: wallEndMs, endMs: wallEndMs + 500 }]);
	});

	it('sanity: the silent span never starts after it ends, whatever its current bounds are', () => {
		const [span] = wallSilentSpans();
		expect(span.endMs).toBeGreaterThan(span.startMs);
	});

	/**
	 * U04: the moving-wall SCROLL phase (`[0, wallEndMs)`) is where the dense,
	 * procedural noise track plays instead of the bed — see `audio/mix.ts`'s
	 * `MixInput.noiseSpans`.
	 */
	it('wallNoiseSpans: covers the whole scroll phase, from 0 to where wallSilentSpans begins', () => {
		expect(wallNoiseSpans()).toEqual([{ startMs: 0, endMs: wallEndMs }]);
		expect(wallNoiseSpans()[0].endMs).toBe(wallSilentSpans()[0].startMs);
	});
});

// ---------------------------------------------------------------------------
// 2. Rest lines are the only narrated set
// ---------------------------------------------------------------------------

describe('narrationPlan — the Wall narrates the rest lines, and only the rest lines', () => {
	it('lines is exactly plainLines, in order — never the landing line', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		expect(lines).toEqual(WALL_PLAN.plainLines);
		expect(lines).not.toContain(WALL_PLAN.landingLine);
	});

	it('lines never contains the original excerpt or the chapter scroll block', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		const joined = lines.join(' ');
		expect(joined).not.toContain(WALL_PLAN.originalExcerpt);
		expect(joined).not.toContain(WALL_PLAN.chapterBlock);
	});

	it('offsetMs lands exactly at the landing line\'s end frame — narration starts right after the silent phase, whatever its current bounds are', () => {
		const timing = computeWallTiming({ originalExcerpt: WALL_PLAN.originalExcerpt, plainLines: WALL_PLAN.plainLines });
		const { offsetMs } = narrationPlan(WALL_PLAN);
		expect(offsetMs).toBe((timing.landingLine.endFrame / FPS) * 1000);
	});

	it('a Wall with no rest lines (single-sentence plain_english) narrates nothing at all', () => {
		const singleSentencePlan: WallPlan = { ...WALL_PLAN, plainLines: [] };
		const { lines } = narrationPlan(singleSentencePlan);
		expect(lines).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// 3. Framing text never reaches `synthesize`
// ---------------------------------------------------------------------------

describe('framing text (running head, payoff label) never reaches TtsProvider.synthesize', () => {
	const wallRunningHead = formatRunningHead({ author_slug: 'marcus-aurelius', source_reference: WALL_PLAN.sourceReference });

	it('Wall: narrationPlan\'s own lines exclude the running head and the payoff label', () => {
		const { lines } = narrationPlan(WALL_PLAN);
		const joined = lines.join(' ');
		expect(joined).not.toContain(wallRunningHead);
		expect(joined).not.toContain(PAYOFF_LABEL_TEXT);
		expect(joined).not.toContain(WALL_PLAN.sourceReference);
	});

	it(
		'Wall: the text handed to TtsProvider.synthesize is exactly the joined rest lines — no framing text mixed in',
		async () => {
			const { lines } = narrationPlan(WALL_PLAN);
			const text = await capturedSynthesizeText(lines);
			expect(text).toBe(lines.join(' '));
			expect(text).not.toContain(wallRunningHead);
			expect(text).not.toContain(PAYOFF_LABEL_TEXT);
			expect(text).not.toContain(WALL_PLAN.sourceReference);
		},
		MIX_TIMEOUT_MS
	);

	it(
		'Question: only the answer reaches synthesize — never the bare question, the running head, or the payoff label',
		async () => {
			const { lines } = narrationPlan(QUESTION_PLAN);
			expect(lines).toEqual([QUESTION_PLAN.answer]);
			const text = await capturedSynthesizeText(lines);
			expect(text).toBe(QUESTION_PLAN.answer);
			expect(text).not.toContain(QUESTION_PLAN.question);
			expect(text).not.toContain(PAYOFF_LABEL_TEXT);
			expect(text).not.toContain(QUESTION_PLAN.sourceReference);
		},
		MIX_TIMEOUT_MS
	);

	it(
		'Objection: only the capped reply sentences reach synthesize — never the bare objection or the payoff label',
		async () => {
			const { lines } = narrationPlan(OBJECTION_PLAN);
			expect(lines).toEqual(splitPayoffLines(OBJECTION_PLAN.reply).slice(0, OBJECTION_REPLY_LINE_COUNT));
			const text = await capturedSynthesizeText(lines);
			expect(text).not.toContain(OBJECTION_PLAN.objection);
			expect(text).not.toContain(PAYOFF_LABEL_TEXT);
			expect(text).not.toContain(OBJECTION_PLAN.sourceReference);
		},
		MIX_TIMEOUT_MS
	);

	it(
		'Still: the full passage reaches synthesize — never the payoff label or the source reference',
		async () => {
			const { lines } = narrationPlan(STILL_PLAN);
			expect(lines).toEqual(splitPayoffLines(STILL_PLAN.text));
			const text = await capturedSynthesizeText(lines);
			expect(text).not.toContain(PAYOFF_LABEL_TEXT);
			expect(text).not.toContain(STILL_PLAN.sourceReference);
		},
		MIX_TIMEOUT_MS
	);

	it('computeObjectionTiming (fixed shape) never accepts framing text as an input — it takes no card data at all', () => {
		// Documents the structural guarantee: The Objection's timing schedule
		// is a FIXED shape (see objection-timing.ts), not derived from any
		// card field, so there is no path by which framing text could leak
		// into it even indirectly.
		expect(computeObjectionTiming).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// 4. F02 edge case — a single-sentence Wall still produces a valid, non-
//    silent mix
// ---------------------------------------------------------------------------

describe('a Wall whose plain_english is a single sentence (no rest lines) still produces a valid, non-silent mix', () => {
	const originalExcerpt = 'Thys is ye archaick excerpte, the only text scrolling in this card.';
	const noRestLinesPlan: WallPlan = { ...WALL_PLAN, plainLines: [] };

	let workDir: string;

	beforeAll(async () => {
		workDir = await mkdtemp(path.join(tmpdir(), 'plain-social-narration-f02-'));
	});

	afterAll(async () => {
		await rm(workDir, { recursive: true, force: true });
	});

	it('narrationPlan agrees: nothing is narrated for this card', () => {
		const { lines } = narrationPlan(noRestLinesPlan);
		expect(lines).toEqual([]);
	});

	it(
		'mix() succeeds — no SilentMixError, measured loudness within tolerance, audible after the silent span',
		async () => {
			const timing = computeWallTiming({ originalExcerpt, plainLines: [] });
			const durationMs = (timing.totalFrames / FPS) * 1000;
			const outPath = path.join(workDir, 'f02-single-sentence-mix.m4a');

			const result = await mix({
				bedPath: bedPath('bed-03-e-minor7'),
				narrationPath: undefined,
				durationMs,
				narrationSpans: [],
				silentSpans: wallSilentSpans(),
				// U04: matches cli.ts's real call for a Wall exactly — noise
				// under the scroll, true silence after the cut.
				noiseSpans: wallNoiseSpans(),
				outPath
			});

			// Not `-Infinity`/`NaN` — a real, finite loudness measurement is
			// exactly what `SilentMixError` exists to have prevented reaching.
			expect(Number.isFinite(result.measured.integratedLufs)).toBe(true);
			expect(Math.abs(result.measured.integratedLufs - TARGET_LUFS)).toBeLessThanOrEqual(LOUDNESS_TOLERANCE_LU);

			// Audible somewhere after the (possibly-shrunk, post-T15) silent
			// span — proves the mix isn't silently silent end-to-end despite
			// passing loudnorm's non-finite check.
			const [silentSpan] = wallSilentSpans();
			const durationSec = durationMs / 1000;
			const checkStartSec = Math.min(durationSec, silentSpan.endMs / 1000 + 0.5);
			const checkEndSec = Math.min(durationSec, checkStartSec + 6);
			const afterSilenceDb = meanVolumeDb(outPath, checkStartSec, checkEndSec);
			expect(afterSilenceDb).toBeGreaterThan(-45);
		},
		MIX_TIMEOUT_MS
	);
});

// ---------------------------------------------------------------------------
// 5. social pilot 02a T16 (F04) — The Question and The Objection now accept
//    narrationTimings, matching computeWallTiming's own contract. Proves the
//    FULL real-narration pipeline this task's acceptance criterion asks for:
//    provider marks -> lineTimingsFromMarks -> assertNarrationInSync (the
//    drift gate) -> compute{Question,Objection}Timing. No live provider call
//    (hand-built marks, same `wordMarks`-style pattern
//    `audio/__tests__/timing.test.ts` already uses) — only the pure timing
//    math, matching this file's own "no live provider calls anywhere" rule.
// ---------------------------------------------------------------------------

/**
 * Builds a `ProviderMark[]` for `lines` (joined with a single space, exactly
 * how `synthesizeNarration` sends text to a provider — see `narrationPlan`),
 * evenly distributing each LINE's own words across that line's own entry in
 * `durationsMs` — i.e. line `i` occupies exactly `durationsMs[i]`
 * milliseconds of the mark stream, back to back, matching how a real
 * multi-sentence narration clip is laid out. Never a live provider call —
 * purely synthetic marks for exercising `lineTimingsFromMarks` and
 * `assertNarrationInSync` against real card text.
 */
function multiLineWordMarks(lines: string[], durationsMs: number[]): { marks: ProviderMark[]; totalDurationMs: number } {
	const marks: ProviderMark[] = [];
	let cursor = 0;
	lines.forEach((line, lineIndex) => {
		const words = line.split(/\s+/).filter((w) => w.length > 0);
		const lineDurationMs = durationsMs[lineIndex];
		const perWordMs = lineDurationMs / words.length;
		words.forEach((word, wordIndex) => {
			marks.push({
				text: word,
				startMs: Math.round(cursor + wordIndex * perWordMs),
				endMs: Math.round(cursor + (wordIndex + 1) * perWordMs)
			});
		});
		cursor += lineDurationMs;
	});
	return { marks, totalDurationMs: cursor };
}

describe('social pilot 02a T16 (F04) — Question narrationTimings, end to end', () => {
	it('a real (fixture-derived) narration timing set passes assertNarrationInSync and moves the on-screen answer boundary away from the fixed default', () => {
		// 14s, deliberately far from the fixed ANSWER_SECONDS (2.5s) fallback —
		// and, per question-timing.test.ts's own T16 coverage, comfortably
		// clear of the 15s-floor pad point too, so the drift is real and not
		// masked by padding.
		const { marks, totalDurationMs } = multiLineWordMarks([QUESTION_PLAN.answer], [14_000]);
		const timings = lineTimingsFromMarks([QUESTION_PLAN.answer], {
			audioPath: '/fake/question-answer.mp3',
			provider: 'polly',
			voiceId: 'test-voice',
			durationMs: totalDurationMs,
			marks
		});

		// The drift gate — untouched by T16 — passes for a genuinely in-sync
		// timing set derived straight from the (fake) provider's own marks.
		expect(() => assertNarrationInSync(timings, totalDurationMs)).not.toThrow();

		const fixedSchedule = computeQuestionTiming({ question: QUESTION_PLAN.question });
		const narratedSchedule = computeQuestionTiming({ question: QUESTION_PLAN.question, narrationTimings: timings });

		expect(narratedSchedule.answer.startFrame).toBe(fixedSchedule.answer.startFrame);
		expect(narratedSchedule.answer.endFrame).not.toBe(fixedSchedule.answer.endFrame);
		expect(narratedSchedule.answer.endFrame - narratedSchedule.answer.startFrame).toBe(Math.round(14 * FPS));
		expect(narratedSchedule.answer.endFrame - narratedSchedule.answer.startFrame).not.toBe(ANSWER_FRAMES);
	});

	it('assertNarrationInSync STILL GATES — a drifted (desynced) timing set for this exact answer text is still rejected before it could ever reach computeQuestionTiming', () => {
		const { marks, totalDurationMs } = multiLineWordMarks([QUESTION_PLAN.answer], [14_000]);
		const timings = lineTimingsFromMarks([QUESTION_PLAN.answer], {
			audioPath: '/fake/question-answer.mp3',
			provider: 'polly',
			voiceId: 'test-voice',
			durationMs: totalDurationMs,
			marks
		});

		// The real written audio file measured 2s longer than the marks claim
		// (a genuinely desynced case, e.g. a provider bug or a truncated
		// write) — `synthesizeNarration` would probe this real duration and
		// hand it to `assertNarrationInSync` exactly like this.
		const desyncedAudioDurationMs = totalDurationMs + 2000;
		expect(() => assertNarrationInSync(timings, desyncedAudioDurationMs)).toThrow(/drift/i);
	});
});

describe('social pilot 02a T16 (F04) — Objection narrationTimings, end to end', () => {
	const replyLines = splitPayoffLines(OBJECTION_PLAN.reply).slice(0, OBJECTION_REPLY_LINE_COUNT);

	it('a real (fixture-derived) narration timing set passes assertNarrationInSync and moves both on-screen reply-line boundaries away from the fixed default', () => {
		// 4s / 10s, deliberately far from the fixed OBJECTION_REPLY_LINE_FRAMES
		// (2.5s each) fallback, and (per objection-timing.test.ts's own T16
		// coverage) large enough that the combined raw total clears the
		// 15s-floor pad point, so neither boundary is masked by padding.
		const { marks, totalDurationMs } = multiLineWordMarks(replyLines, [4_000, 10_000]);
		const timings = lineTimingsFromMarks(replyLines, {
			audioPath: '/fake/objection-reply.mp3',
			provider: 'polly',
			voiceId: 'test-voice',
			durationMs: totalDurationMs,
			marks
		});

		expect(() => assertNarrationInSync(timings, totalDurationMs)).not.toThrow();

		const fixedSchedule = computeObjectionTiming();
		const narratedSchedule = computeObjectionTiming({ narrationTimings: timings });

		expect(narratedSchedule.replyLines[0].startFrame).toBe(fixedSchedule.replyLines[0].startFrame);
		expect(narratedSchedule.replyLines[0].endFrame).not.toBe(fixedSchedule.replyLines[0].endFrame);
		expect(narratedSchedule.replyLines[1].startFrame).not.toBe(fixedSchedule.replyLines[1].startFrame);
		expect(narratedSchedule.replyLines[1].endFrame).not.toBe(fixedSchedule.replyLines[1].endFrame);

		expect(narratedSchedule.replyLines[0].endFrame - narratedSchedule.replyLines[0].startFrame).toBe(
			Math.round(4 * FPS)
		);
		expect(narratedSchedule.replyLines[1].endFrame - narratedSchedule.replyLines[1].startFrame).toBe(
			Math.round(10 * FPS)
		);
		expect(narratedSchedule.replyLines[0].endFrame - narratedSchedule.replyLines[0].startFrame).not.toBe(
			OBJECTION_REPLY_LINE_FRAMES
		);
	});

	it('assertNarrationInSync STILL GATES — an overlapping (corrupted) timing set for this exact reply text is still rejected before it could ever reach computeObjectionTiming', () => {
		const { marks, totalDurationMs } = multiLineWordMarks(replyLines, [4_000, 10_000]);
		const timings = lineTimingsFromMarks(replyLines, {
			audioPath: '/fake/objection-reply.mp3',
			provider: 'polly',
			voiceId: 'test-voice',
			durationMs: totalDurationMs,
			marks
		});

		// Corrupt the second line's start so it overlaps the first — the same
		// class of internal-consistency failure `assertNarrationInSync`
		// already rejects for The Wall (see `timing.test.ts`), exercised here
		// against real Objection reply text to prove T16 introduced no
		// bypass.
		const corrupted = [timings[0], { ...timings[1], startSeconds: timings[0].startSeconds }];
		expect(() => assertNarrationInSync(corrupted, totalDurationMs)).toThrow(/overlaps/i);
	});
});
