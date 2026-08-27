/**
 * The shared duration ceiling every format's composition must land inside
 * (T18) — the MP4 encode profile requires <=59s (see `social/src/render/
 * encode.ts`'s `TARGET.maxDurationSec`).
 *
 * social pilot 02a V17 (2026-08-27, user decision): this module used to also
 * define a 15s FLOOR (`MIN_POST_DURATION_SECONDS`/`MIN_POST_DURATION_FRAMES`)
 * and a `padToMinimumDuration` helper that extended a too-short composition's
 * final motionless payoff phase up to that floor. The floor was a house
 * convention — `plans/Pf39c2-social-pilot-index.md:203`'s "15-59s" profile
 * statement, mirrored here and in `encode.ts`'s `TARGET.minDurationSec` — with
 * NO recorded rationale anywhere in the repo (searched `docs/`, the index
 * plan, and every `Pf39c2-*` plan) and no external platform requiring it
 * (Reels/TikTok accept ~3s; Stories' 15s is a per-card MAXIMUM, not a
 * minimum). It also had a real cost: a 1-screen Wall card (no `plainLines`)
 * was padding its landing line's hold from 3.0s up to 12.5s to clear it. The
 * user decided to drop the floor entirely — duration is now a pure function
 * of screen count, and every payoff phase on every card holds exactly its own
 * constant length (`LANDING_LINE_FRAMES`/`DEFAULT_LINE_FRAMES` in
 * `wall-timing.ts`), never extended. `padToMinimumDuration` and the floor
 * constants are deleted outright — grepped at removal time and nothing else
 * called them (the doc comments elsewhere claiming The Question and The
 * Objection also used this helper were stale: both formats were deleted at
 * D01, so it was Wall-only by the time of this change).
 *
 * `MAX_POST_DURATION_FRAMES` is exported from this ONE place — `wall-timing.ts`
 * (the only format's `compute*Timing` left after D01) and `wall-gate.ts` both
 * import it rather than re-deriving the bound.
 *
 * Deliberately dependency-free (no import of `wall-timing.ts`'s `FPS`, even
 * though the number below is FPS-derived): `wall-timing.ts` imports FROM this
 * module, so importing `FPS` back out of `wall-timing.ts` here would make
 * this module part of a circular import whose evaluation order breaks
 * (`wall-timing.ts`'s `export const FPS = 30` would not yet be initialized
 * the first time `duration-bounds.ts`'s own top-level `Math.round(...)`
 * runs). `BOUNDS_FPS` below is kept in lock step with `wall-timing.ts`'s
 * `FPS` by a cross-module equality assertion in
 * `__tests__/duration-bounds.test.ts` instead of by import.
 *
 * Also being import-free is what keeps this module safe to bundle into
 * Remotion's browser-side webpack build (via `entry.tsx` -> `Root.tsx` ->
 * every format's timing module) — nothing here is Node-only.
 */

/** Must equal `wall-timing.ts`'s `FPS` — see the module doc comment above for why this isn't imported. */
const BOUNDS_FPS = 30;

/** Mirrors `encode.ts`'s `TARGET.maxDurationSec`. */
export const MAX_POST_DURATION_SECONDS = 59;

export const MAX_POST_DURATION_FRAMES = Math.round(MAX_POST_DURATION_SECONDS * BOUNDS_FPS);
