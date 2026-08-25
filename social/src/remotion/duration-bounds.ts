/**
 * The shared duration floor/ceiling every format's composition must land
 * inside (T18) — the MP4 encode profile requires 15s-59s (see
 * `social/src/render/encode.ts`'s `TARGET.minDurationSec`/`maxDurationSec`),
 * but two of the three formats' fixed-shape schedules land far short of the
 * floor on their own: The Question totals 195 frames (6.5s) and The
 * Objection 225 frames (7.5s); only The Wall (which grows with the card's
 * own plain-passage length) reliably clears it.
 *
 * `MIN_POST_DURATION_FRAMES`/`MAX_POST_DURATION_FRAMES` are exported from
 * this ONE place — every format's `compute*Timing` (`wall-timing.ts`,
 * `question-timing.ts`, `objection-timing.ts`) imports them, and
 * `padToMinimumDuration` below, rather than re-deriving the bound.
 *
 * Deliberately dependency-free (no import of `wall-timing.ts`'s `FPS`, even
 * though the two numbers below are FPS-derived): every one of those three
 * timing modules imports FROM this module, so importing `FPS` back out of
 * `wall-timing.ts` here would make this module part of a circular import
 * whose evaluation order breaks (`wall-timing.ts`'s `export const FPS = 30`
 * would not yet be initialized the first time `duration-bounds.ts`'s own
 * top-level `Math.round(...)` runs). `BOUNDS_FPS` below is kept in lock
 * step with `wall-timing.ts`'s `FPS` by a cross-module equality assertion
 * in `__tests__/duration-bounds.test.ts` instead of by import.
 *
 * Also being import-free is what keeps this module safe to bundle into
 * Remotion's browser-side webpack build (via `entry.tsx` -> `Root.tsx` ->
 * every format's timing module) — nothing here is Node-only.
 */

/** Must equal `wall-timing.ts`'s `FPS` — see the module doc comment above for why this isn't imported. */
const BOUNDS_FPS = 30;

/** Mirrors `encode.ts`'s `TARGET.minDurationSec`. */
export const MIN_POST_DURATION_SECONDS = 15;
/** Mirrors `encode.ts`'s `TARGET.maxDurationSec`. */
export const MAX_POST_DURATION_SECONDS = 59;

export const MIN_POST_DURATION_FRAMES = Math.round(MIN_POST_DURATION_SECONDS * BOUNDS_FPS);
export const MAX_POST_DURATION_FRAMES = Math.round(MAX_POST_DURATION_SECONDS * BOUNDS_FPS);

export interface PaddedDuration {
	/** The final, possibly-extended total frame count — always in `[MIN_POST_DURATION_FRAMES, MAX_POST_DURATION_FRAMES]`. */
	totalFrames: number;
	/** How many frames were added to reach the floor. `0` when no padding was needed. */
	padFrames: number;
}

/**
 * Resolves how much padding (if any) a composition's own natural
 * `rawTotalFrames` needs to clear `MIN_POST_DURATION_FRAMES`.
 *
 * This function only computes the NUMBER of frames to add — it never
 * decides WHERE those frames go. Each format's own `compute*Timing`
 * applies `padFrames` by extending its own final motionless payoff
 * phase's `endFrame` (never adding a new phase, never introducing motion,
 * exactly the same held frame repeated for longer) — see `wall-timing.ts`,
 * `question-timing.ts` and `objection-timing.ts` for where that happens.
 *
 * Refuses (throws) rather than shipping an over-long post when
 * `rawTotalFrames` is ALREADY over `MAX_POST_DURATION_FRAMES` before any
 * padding is even considered — padding only ever ADDS frames to a
 * composition that's too short; it is never used to decide whether a
 * naturally too-long composition (e.g. a Wall card with many plain-passage
 * lines) should be trimmed. `MIN_POST_DURATION_FRAMES` is always well
 * under `MAX_POST_DURATION_FRAMES`, so padding up to the floor can never
 * itself cross the ceiling.
 */
export function padToMinimumDuration(rawTotalFrames: number): PaddedDuration {
	if (rawTotalFrames > MAX_POST_DURATION_FRAMES) {
		throw new Error(
			`padToMinimumDuration: composition is already ${rawTotalFrames} frames ` +
				`(${(rawTotalFrames / BOUNDS_FPS).toFixed(1)}s), over the ${MAX_POST_DURATION_FRAMES}-frame ` +
				`(${MAX_POST_DURATION_SECONDS}s) ceiling — refusing to ship an over-long post rather than trim it.`
		);
	}
	if (rawTotalFrames >= MIN_POST_DURATION_FRAMES) {
		return { totalFrames: rawTotalFrames, padFrames: 0 };
	}
	const padFrames = MIN_POST_DURATION_FRAMES - rawTotalFrames;
	return { totalFrames: MIN_POST_DURATION_FRAMES, padFrames };
}
