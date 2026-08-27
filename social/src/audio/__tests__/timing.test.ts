import { describe, expect, it } from 'vitest';

import { splitPayoffLines } from '../timing.js';

// Pf39c2-social-pilot-02 N01 (2026-08-27) deleted the narration subsystem —
// this file used to also cover `lineTimingsFromMarks`, `assertNarrationInSync`
// and `toFrames` (LINE-LEVEL NARRATION TIMING, T13), all against fixtures
// replaying `tts.js`'s ElevenLabs/Polly providers. All three functions, and
// `tts.js` itself, are deleted along with the rest of narration — see
// `timing.ts`'s own module doc comment. `splitPayoffLines` is the one
// export that survives (it never touched narration at all) and its tests
// are unchanged below.

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
