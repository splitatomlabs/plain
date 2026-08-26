/**
 * The Still's legibility gate (social pilot 02 F19).
 *
 * The Still has no tone/pool gate the way The Objection does (T08's
 * `viewer_position` classification) and no "answerable in N seconds"
 * acceptance clause the way The Question does — it is a universal
 * READ-THROUGH FALLBACK: any card's `plain_english`, verbatim, set
 * motionless on paper. The one thing that CAN make it un-renderable is the
 * same axis every other format guards against: the text cannot be set
 * legibly inside its box no matter how small the type goes.
 *
 * Reuses `wall-timing.ts`'s own `WALL_MIN_LEGIBLE_FONT_PX` — the SAME
 * viewport-derived body-text floor `objection-gate.ts` reuses for its reply
 * lines (`OBJECTION_REPLY_MIN_LEGIBLE_FONT_PX`) — rather than deriving a
 * fourth copy of the same 14px-CSS-on-a-390px-phone arithmetic. The Still
 * renders body-weight paragraph text, the same visual register as those
 * reply lines and every Wall/Question payoff line, so it belongs to the
 * same floor, not the ~28px HEADLINE floor `question-gate.ts`/
 * `objection-gate.ts` use for their own opening display type.
 *
 * Deliberately dependency-free (no `node:fs`, nothing Node-only), mirroring
 * `wall-gate.ts`/`question-gate.ts`/`objection-gate.ts` — both `Still.tsx`
 * and `Root.tsx`'s `calculateMetadata` import from this module directly, and
 * both get bundled by Remotion's browser-side webpack build.
 */

import { WALL_MIN_LEGIBLE_FONT_PX } from './wall-timing.js';
import { computeStillLayout, STILL_MIN_FONT, type StillLayout } from './still-timing.js';

/** Reused, not re-derived — see this module's doc comment. */
export const STILL_MIN_LEGIBLE_FONT_PX = WALL_MIN_LEGIBLE_FONT_PX;

if (STILL_MIN_FONT >= STILL_MIN_LEGIBLE_FONT_PX) {
	throw new Error(
		`invariant violated: STILL_MIN_FONT (${STILL_MIN_FONT}) must stay below ` +
			`STILL_MIN_LEGIBLE_FONT_PX (${STILL_MIN_LEGIBLE_FONT_PX}) — otherwise a card that fails to fit at ` +
			'all would report a fontSize the gate mistakes for a legible fit.'
	);
}

export type StillGateAxis = 'legibility';

export type StillGateResult =
	| { ok: true; layout: StillLayout }
	| { ok: false; reason: string; axis: StillGateAxis };

/**
 * Fits `text` (a card's verbatim `plain_english`) into the Still's box and
 * rejects it when the result falls under `STILL_MIN_LEGIBLE_FONT_PX`. Never
 * renders text this small — a rejection is a rejection, to be excluded
 * upstream (the render-exclusions.json `still` section — see
 * `social/scripts/write-exclusions.ts`) or to fail a render outright (see
 * `assertStillCardRenderable`).
 */
export function gateStillCard(text: string): StillGateResult {
	const layout = computeStillLayout(text);

	if (layout.fontSize < STILL_MIN_LEGIBLE_FONT_PX) {
		return {
			ok: false,
			axis: 'legibility',
			reason:
				`Still card rejected: text fits its box only at ${layout.fontSize}px, below the ` +
				`${STILL_MIN_LEGIBLE_FONT_PX}px legibility floor.`
		};
	}

	return { ok: true, layout };
}

/**
 * `gateStillCard`, but throws instead of returning a result — the shape a
 * render pipeline needs so a card too long to set legibly fails the render
 * outright rather than producing illegible text. Wired into `Root.tsx`'s
 * `calculateMetadata` and into `Still.tsx` itself, so both the
 * composition-selection path and a direct render of the component reject
 * the same cards.
 */
export function assertStillCardRenderable(text: string): StillLayout {
	const result = gateStillCard(text);
	if (!result.ok) {
		throw new Error(result.reason);
	}
	return result.layout;
}
