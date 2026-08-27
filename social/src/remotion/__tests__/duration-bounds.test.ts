import { describe, expect, it } from 'vitest';

import { MAX_POST_DURATION_FRAMES, MAX_POST_DURATION_SECONDS } from '../duration-bounds.js';
import { FPS } from '../wall-timing.js';
import { TARGET } from '../../render/encode.js';

// social pilot 02a V17 (2026-08-27, user decision): the floor
// (`MIN_POST_DURATION_SECONDS`/`MIN_POST_DURATION_FRAMES`) and the
// `padToMinimumDuration` helper that padded a too-short composition up to
// it are both deleted — see `duration-bounds.ts`'s module doc comment for
// why. This file used to also cover: "MIN_POST_DURATION_SECONDS matches
// TARGET.minDurationSec", "the floor is comfortably below the ceiling", and
// a whole `padToMinimumDuration` describe block (pads up to the floor,
// leaves an already-clear composition alone, throws over the ceiling,
// never returns outside [MIN, MAX]). All of that asserted the FLOOR's
// existence/behavior, which is the exact property being removed, so it is
// deleted rather than weakened. The ceiling-throw coverage that used to
// live inside `padToMinimumDuration`'s tests is not lost: `wall-gate.ts`
// enforces `MAX_POST_DURATION_FRAMES` independently at survey time (see
// `wall-gate.test.ts`'s "the duration ceiling" suites), which is where a
// too-long composition was always meant to be turned into a graceful
// rejection rather than a render-time throw.
describe('duration bounds mirror encode.ts TARGET (never imported — see module doc comment)', () => {
	it('MAX_POST_DURATION_SECONDS matches TARGET.maxDurationSec', () => {
		expect(MAX_POST_DURATION_SECONDS).toBe(TARGET.maxDurationSec);
	});

	it("MAX_POST_DURATION_FRAMES is derived at wall-timing.ts's own FPS", () => {
		expect(MAX_POST_DURATION_FRAMES).toBe(Math.round(MAX_POST_DURATION_SECONDS * FPS));
	});
});
