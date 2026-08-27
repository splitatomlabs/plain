/**
 * Payoff sentence splitting.
 *
 * Pf39c2-social-pilot-02 N01 (2026-08-27) deleted the narration subsystem —
 * this module used to also hold LINE-LEVEL NARRATION TIMING (T13):
 * `lineTimingsFromMarks`/`assertNarrationInSync`/`NARRATION_DRIFT_TOLERANCE_MS`
 * (matching a TTS provider's native marks onto payoff lines and gating
 * drift against the written audio file) and `toFrames`/`LineFrameRange`
 * (converting those timings into Remotion frame ranges). All of that
 * machinery existed only to serve real narration, which was never
 * activated (no voice was ever auditioned — T14 stayed blocked) and is now
 * deleted outright (see `plans/Pf39c2-social-pilot-02.md`'s "Narration
 * dropped" section for the reasoning). `splitPayoffLines` below is the one
 * export that survives: it is the canonical sentence splitter every payoff
 * phase uses regardless of whether the line is narrated or just displayed,
 * and it is still live — `cli-plan.ts` imports it directly, and
 * `scripts/lib/premises.ts` ports it verbatim for the Wall gate's screen
 * counter (see that file's own doc comment).
 */

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
 * Wall splits original/plain text into one-sentence-per-line (and, before
 * Pf39c2-social-pilot-02a D01 deleted them outright, The Question and The
 * Objection did too, so all three compositions split identically given the
 * same input). Every returned line is a VERBATIM substring of `text` (no
 * re-wrapping, no paraphrase, no punctuation added or removed); joining the
 * returned lines with a single space reproduces `text` modulo whitespace.
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
