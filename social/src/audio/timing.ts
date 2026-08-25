/**
 * LINE-LEVEL narration timing (T13).
 *
 * Word-level sync is available from both TTS providers (`tts.ts`'s
 * `ProviderMark[]` is character-level for ElevenLabs, word-level for Polly)
 * but this module deliberately never exposes it. It is unnecessary for
 * every composition that consumes narration in this pilot:
 *   - The Wall is silent. Its karaoke highlight is a fixed-rate sweep timed
 *     off `KARAOKE_WPM` (see `remotion/wall-timing.ts`), independent of any
 *     audio — there is nothing to word-sync it TO.
 *   - Every payoff (the landing line, the rest of the plain passage, The
 *     Question, The Objection) shows exactly one still line of text at a
 *     time, motionless, for the whole time it is narrated. A line either is
 *     or is not on screen; there is no sub-line highlight to drive.
 * So the whole timing requirement is: know when each LINE starts and ends.
 * This module maps a provider's native marks onto the caller's lines and
 * refuses to guess when it can't.
 *
 * `NarrationLineTiming` is `remotion/wall-timing.ts`'s type, re-exported
 * here rather than duplicated — that module already accepts an optional
 * `narrationTimings: NarrationLineTiming[]` for the payoff lines and falls
 * back to a fixed per-line duration when absent. This module is what
 * produces that array for real narration.
 */

import type { NarrationLineTiming } from '../remotion/wall-timing.js';
import type { TtsResult } from './tts.js';

export type { NarrationLineTiming } from '../remotion/wall-timing.js';

// ---------------------------------------------------------------------------
// Matching provider marks onto caller-supplied lines
// ---------------------------------------------------------------------------

/**
 * Normalizes text for MATCHING PURPOSES ONLY — lowercased, every character
 * that isn't a letter or digit stripped out. This absorbs whitespace and
 * punctuation differences between the provider's mark text (e.g. Polly's
 * per-word marks, ElevenLabs' per-character marks, either of which may
 * split or join differently than the caller's line breaks) and the line
 * text the caller passed in. It is NEVER used to alter what's returned —
 * `lineTimingsFromMarks` matches against this normalized form but always
 * reads its timestamps back from the ORIGINAL, verbatim marks, and never
 * returns anything derived from the normalized text itself.
 */
function normalizeForMatch(text: string): string {
	return text.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Maps a TTS provider's native marks onto `lines`, in order, producing one
 * `NarrationLineTiming` per line. A line's `startSeconds` comes from its
 * FIRST matched mark's native `startMs`; its `endSeconds` from its LAST
 * matched mark's native `endMs`. Both are read directly off `result.marks`
 * — nothing here is estimated from word counts, character counts, or a
 * words-per-minute rate. That prohibition is the entire point of T13: if
 * `lines` and `result.marks` cannot be lined up (wrong text was sent to the
 * TTS provider, a provider truncated its marks, lines were reordered,
 * etc.), this THROWS, naming the offending line, rather than fabricating a
 * plausible-looking timing.
 *
 * Implementation: every mark's normalized text is flattened into one long
 * character stream, each character tagged with the index of the mark it
 * came from. Marks that normalize to nothing (pure whitespace or
 * punctuation — an ElevenLabs space character, a Polly punctuation mark)
 * contribute no characters and are transparently skipped; they can never
 * be chosen as a line's boundary. Each line is then matched against the
 * next run of stream characters at the current cursor position — the
 * marks and the lines must both be in the same order the text was spoken
 * in, which is guaranteed by how `tts.ts` synthesizes and how callers of
 * this function build `lines` from the same source text.
 */
export function lineTimingsFromMarks(lines: string[], result: TtsResult): NarrationLineTiming[] {
	const marks = result.marks;

	const streamChars: string[] = [];
	const streamMarkIndex: number[] = [];
	marks.forEach((mark, markIndex) => {
		const normalized = normalizeForMatch(mark.text);
		for (const ch of normalized) {
			streamChars.push(ch);
			streamMarkIndex.push(markIndex);
		}
	});

	const timings: NarrationLineTiming[] = [];
	let cursor = 0;

	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex];
		const normalizedLine = normalizeForMatch(line);

		if (normalizedLine.length === 0) {
			throw new Error(
				`lineTimingsFromMarks: line ${lineIndex} ("${line}") has no matchable text after normalization — cannot derive a timing.`
			);
		}

		const candidate = streamChars.slice(cursor, cursor + normalizedLine.length).join('');
		if (candidate !== normalizedLine) {
			// The whole point of T13: no word-count or characters-per-second
			// fallback. If the marks don't literally spell out this line at
			// this position, refuse to guess.
			throw new Error(
				`lineTimingsFromMarks: could not match line ${lineIndex} ("${line}") to narration marks from ${result.provider} — ` +
					'the provider marks diverge from the line text at this position. Refusing to estimate a timing from word/character counts.'
			);
		}

		const startMarkIndex = streamMarkIndex[cursor];
		let endMarkIndex = streamMarkIndex[cursor + normalizedLine.length - 1];

		// Extend through any ATTACHED trailing punctuation immediately
		// following the last matched character — e.g. the sentence-ending
		// "." mark that comes right after the last letter, with nothing in
		// between. Punctuation normalizes to zero characters (see
		// `normalizeForMatch`) so it was never part of the match itself, but
		// it's still part of THIS line's own verbatim text and its audio —
		// without this, a trailing period's brief native duration would be
		// silently dropped from `endMs`, and the line would visually cut off
		// a beat before its own audio finishes. Stop at the first mark that
		// is pure whitespace (a real gap before the next line) or that
		// contributes matchable characters (content this line doesn't own).
		let probe = endMarkIndex + 1;
		while (probe < marks.length) {
			const probeText = marks[probe].text;
			if (normalizeForMatch(probeText).length > 0) {
				break;
			}
			if (probeText.trim().length === 0) {
				break;
			}
			endMarkIndex = probe;
			probe++;
		}

		const startMs = marks[startMarkIndex].startMs;
		const endMs = marks[endMarkIndex].endMs;

		timings.push({ startSeconds: startMs / 1000, endSeconds: endMs / 1000 });
		cursor += normalizedLine.length;
	}

	return timings;
}

// ---------------------------------------------------------------------------
// The drift gate
// ---------------------------------------------------------------------------

/**
 * The plan's gate (plans/Pf39c2-social-pilot-02.md, T13): reject any render
 * where the last narration line's end timestamp differs from the audio's
 * actual duration by more than this many milliseconds.
 */
export const NARRATION_DRIFT_TOLERANCE_MS = 120;

/**
 * Rejects a set of line timings before they're allowed anywhere near a
 * render. Two independent classes of failure, both fatal:
 *
 *   1. Internal inconsistency — any line with a non-positive duration
 *      (zero or negative length), or whose start precedes the previous
 *      line's end (non-monotonic ordering or an outright overlap). A
 *      drifted total is not the only way a timing set can be wrong.
 *   2. Drift against the audio — the LAST line's `endSeconds` must be
 *      within `NARRATION_DRIFT_TOLERANCE_MS` of `audioDurationMs`, in
 *      either direction. This is the plan's named gate: a synthetic
 *      timing set whose narration runs long or short of the actual audio
 *      must be rejected before it ever reaches a render.
 */
export function assertNarrationInSync(timings: NarrationLineTiming[], audioDurationMs: number): void {
	if (timings.length === 0) {
		throw new Error('assertNarrationInSync: no line timings supplied — nothing to check against the audio.');
	}

	for (let i = 0; i < timings.length; i++) {
		const timing = timings[i];

		if (timing.startSeconds < 0) {
			throw new Error(`assertNarrationInSync: line ${i} has a negative start time (${timing.startSeconds}s).`);
		}

		if (timing.endSeconds <= timing.startSeconds) {
			throw new Error(
				`assertNarrationInSync: line ${i} has a non-positive duration ` +
					`(start=${timing.startSeconds}s, end=${timing.endSeconds}s).`
			);
		}

		if (i > 0) {
			const previous = timings[i - 1];
			if (timing.startSeconds < previous.endSeconds) {
				throw new Error(
					`assertNarrationInSync: line ${i} overlaps line ${i - 1} — ` +
						`line ${i - 1} ends at ${previous.endSeconds}s but line ${i} starts at ${timing.startSeconds}s.`
				);
			}
		}
	}

	const last = timings[timings.length - 1];
	const lastEndMs = last.endSeconds * 1000;
	const driftMs = lastEndMs - audioDurationMs;

	if (Math.abs(driftMs) > NARRATION_DRIFT_TOLERANCE_MS) {
		throw new Error(
			`assertNarrationInSync: narration drift exceeds tolerance — last line ends at ${lastEndMs}ms ` +
				`but audio duration is ${audioDurationMs}ms (drift ${driftMs}ms, tolerance ±${NARRATION_DRIFT_TOLERANCE_MS}ms).`
		);
	}
}

// ---------------------------------------------------------------------------
// Frame conversion
// ---------------------------------------------------------------------------

export interface LineFrameRange {
	/** Inclusive. */
	startFrame: number;
	/** Exclusive. */
	endFrame: number;
}

/**
 * Converts narration line timings into contiguous per-line frame ranges
 * for Remotion. Mirrors exactly how `remotion/wall-timing.ts`'s
 * `computeWallTiming` already consumes `narrationTimings`: only each
 * line's DURATION (`endSeconds - startSeconds`) is used, never its
 * absolute position on the timeline.
 *
 * Rounding rule: each line's duration is independently rounded to the
 * nearest frame (`Math.round(durationSeconds * fps)`), floored at 1 frame
 * so a very short line never vanishes. Frame boundaries are then assigned
 * by a running cursor — line i's `startFrame` is always line i-1's
 * `endFrame` — rather than by independently rounding each line's
 * absolute start and end. That guarantees the output is gap-free and
 * overlap-free BY CONSTRUCTION: rounding each line's duration can make it
 * a fraction of a frame longer or shorter than its true duration, but it
 * can never create a hole or a collision between two consecutive frame
 * ranges, because each range starts exactly where the previous one ended.
 */
export function toFrames(timings: NarrationLineTiming[], fps: number): LineFrameRange[] {
	let cursor = 0;
	return timings.map((timing) => {
		const durationSeconds = timing.endSeconds - timing.startSeconds;
		const frames = Math.max(1, Math.round(durationSeconds * fps));
		const startFrame = cursor;
		const endFrame = startFrame + frames;
		cursor = endFrame;
		return { startFrame, endFrame };
	});
}

// ---------------------------------------------------------------------------
// Payoff sentence splitting
// ---------------------------------------------------------------------------

/**
 * Word (or word-like token) immediately preceding a `.` that should NOT be
 * treated as a sentence boundary. Lower-cased, no trailing period. A
 * single letter (e.g. the "T" in "T. S. Eliot") is also never a boundary —
 * handled separately below, not via this list.
 */
const ABBREVIATIONS = new Set([
	'mr',
	'mrs',
	'ms',
	'dr',
	'prof',
	'sr',
	'jr',
	'st',
	'vs',
	'etc',
	'eg',
	'ie',
	'no',
	'vol',
	'fig',
	'al',
	'cf',
	'ca',
	'approx',
	'gen',
	'rev',
	'co',
	'inc',
	'ltd'
]);

function endsWithAbbreviation(precedingText: string): boolean {
	const wordMatch = precedingText.match(/([A-Za-z]+)\s*$/);
	if (!wordMatch) {
		return false;
	}
	const word = wordMatch[1];
	// A single capital (or lowercase) letter — an initial, e.g. "A." in
	// "A. Vernon" — is never a sentence boundary.
	if (word.length === 1) {
		return true;
	}
	return ABBREVIATIONS.has(word.toLowerCase());
}

/**
 * The canonical sentence splitter for payoff lines — the ONE place The
 * Wall, The Question, and The Objection all split original/plain text
 * into one-sentence-per-line, so all three compositions split identically
 * given the same input. Every returned line is a VERBATIM substring of
 * `text` (no re-wrapping, no paraphrase, no punctuation added or removed);
 * joining the returned lines with a single space reproduces `text` modulo
 * whitespace.
 *
 * Boundary rule: a run of `.`/`!`/`?` (optionally followed immediately by
 * a closing quote or bracket) is a sentence boundary only when it is
 * followed by whitespace or the end of the text. A `.` boundary is
 * additionally suppressed — conservatively, per "when in doubt, do not
 * split" — when the word immediately before it is a known abbreviation
 * (`Mr.`, `etc.`, ...) or a single letter (an initial). `!` and `?` are
 * never suppressed this way; they don't have an abbreviation problem.
 */
export function splitPayoffLines(text: string): string[] {
	const trimmed = text.trim();
	if (trimmed.length === 0) {
		return [];
	}

	const sentences: string[] = [];
	let cursor = 0;
	const n = trimmed.length;

	for (let i = 0; i < n; i++) {
		const ch = trimmed[i];
		if (ch !== '.' && ch !== '!' && ch !== '?') {
			continue;
		}

		// Consume a run of terminal punctuation, e.g. "?!" or "...".
		let j = i;
		while (j < n && (trimmed[j] === '.' || trimmed[j] === '!' || trimmed[j] === '?')) {
			j++;
		}
		// Consume closing quotes/brackets immediately after the punctuation.
		let k = j;
		while (k < n && /["'”’)\]]/.test(trimmed[k])) {
			k++;
		}

		const atEnd = k >= n;
		const followedByWhitespace = !atEnd && /\s/.test(trimmed[k]);
		if (!atEnd && !followedByWhitespace) {
			// Not a boundary — e.g. a decimal number or an ellipsis glued to
			// the next word with no space. Leave `i` to advance normally.
			continue;
		}

		if (ch === '.' && endsWithAbbreviation(trimmed.slice(cursor, i))) {
			continue;
		}

		sentences.push(trimmed.slice(cursor, k));

		let end = k;
		while (end < n && /\s/.test(trimmed[end])) {
			end++;
		}
		cursor = end;
		i = k - 1; // loop's i++ resumes scanning right after the consumed punctuation/quotes
	}

	if (cursor < n) {
		sentences.push(trimmed.slice(cursor));
	}

	return sentences;
}
