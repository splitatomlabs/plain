/**
 * Fixed per-Stoic voice registry (T14).
 *
 * `resolveTtsConfig` (`tts.ts`) decides WHICH provider is primary; this
 * module decides WHICH VOICE, on that provider, speaks for each Stoic. One
 * voice per author, fixed for the life of the channel — auditioned once by
 * a human, never algorithmically chosen, never swapped after being set.
 *
 * STATUS: UNSET. Auditioning requires listening to real ElevenLabs/Polly
 * synthesis, which cannot happen in this environment (no
 * `ELEVENLABS_API_KEY`, and T12 forbids live provider calls in tests). The
 * three `voiceId` fields below are `null` until a human runs
 * `social/scripts/audition-voices.ts`, listens to the candidates in
 * `social/out/audition/`, and pastes the winning ids in here alongside a
 * written rationale.
 *
 * `assertVoicesAssigned` is the guard against shipping placeholder voices:
 * every render path that reaches TTS must call it (directly, or via
 * `resolveVoice`, which calls it internally) before synthesizing anything.
 * T18's render CLI (`social/src/cli.ts`, not yet built) MUST call
 * `resolveVoice` — never construct a `TtsVoice` by hand from this
 * registry's raw (possibly-null) ids — so an unset registry fails loudly
 * instead of silently synthesizing with some default voice.
 */

import type { AuthorSlug } from '../render/theme.js';
import type { ProviderName, TtsVoice } from './tts.js';

/**
 * One Stoic's fixed voice, once auditioned. `elevenLabsVoiceId` and
 * `pollyVoiceId` are `null` until T14's audition is complete — see the
 * module doc above and `social/assets/voices/README.md` for the decision
 * record and procedure.
 */
export interface VoiceAssignment {
	/** ElevenLabs voice id (primary provider). `null` while unset. */
	elevenLabsVoiceId: string | null;
	/** Amazon Polly `VoiceId` (fallback provider). `null` while unset. */
	pollyVoiceId: string | null;
	/**
	 * Written rationale for why this voice was chosen for this Stoic —
	 * required before an id is filled in. Explains how it satisfies the
	 * house rule (default-or-above pitch/rate) and how it reads as
	 * distinguishable from the other two Stoics' voices. Empty until the
	 * audition happens.
	 */
	rationale: string;
}

/**
 * True until all three voices in `VOICE_REGISTRY` have real, non-null ids.
 * Downstream code should prefer `assertVoicesAssigned()` (which throws)
 * over branching on this flag directly, but the flag is exported so tests
 * can assert on registry state without relying on a thrown error's message
 * shape, and so `resolveVoice`'s doc comment can point at a single source
 * of truth.
 */
export const VOICES_ARE_UNSET = true;

/**
 * One entry per Stoic, keyed by `AuthorSlug`. All three ids are `null`
 * today — see the module doc for why, and `social/assets/voices/README.md`
 * for the audition procedure and the record to fill in once it's run.
 */
export const VOICE_REGISTRY: Record<AuthorSlug, VoiceAssignment> = {
	epictetus: {
		elevenLabsVoiceId: null,
		pollyVoiceId: null,
		rationale: ''
	},
	'marcus-aurelius': {
		elevenLabsVoiceId: null,
		pollyVoiceId: null,
		rationale: ''
	},
	seneca: {
		elevenLabsVoiceId: null,
		pollyVoiceId: null,
		rationale: ''
	}
};

const T14_GUIDANCE =
	'T14 (plans/Pf39c2-social-pilot-02.md) is not done — no voice has been auditioned yet. ' +
	'Run `npx tsx social/scripts/audition-voices.ts` with ELEVENLABS_API_KEY set, listen to the ' +
	'candidates written to social/out/audition/, then paste the winning ElevenLabs id (and a Polly ' +
	'fallback id) plus a written rationale into VOICE_REGISTRY in social/src/audio/voices.ts. See ' +
	'social/assets/voices/README.md for the full procedure.';

/**
 * Throws unless every author in `VOICE_REGISTRY` has both a non-null
 * ElevenLabs id and a non-null Polly id. This is the guard that stops a
 * render from silently synthesizing narration with a default/unset voice:
 * every narration entry point must call this (directly, or via
 * `resolveVoice`) before it reaches a `TtsProvider.synthesize` call.
 */
export function assertVoicesAssigned(): void {
	const unassigned = (Object.keys(VOICE_REGISTRY) as AuthorSlug[]).filter((author) => {
		const assignment = VOICE_REGISTRY[author];
		return !assignment.elevenLabsVoiceId || !assignment.pollyVoiceId;
	});

	if (unassigned.length > 0) {
		throw new Error(
			`Voice(s) not yet assigned for: ${unassigned.join(', ')}. ${T14_GUIDANCE}`
		);
	}
}

/** The subset of `TtsConfig` (`tts.ts`) that `resolveVoice` needs. */
export interface VoiceResolutionConfig {
	primary: ProviderName;
}

/**
 * Returns the fixed `TtsVoice` for `author` under `config.primary`'s
 * provider. Throws via `assertVoicesAssigned` while the registry is
 * unset — there is no default voice to fall back to; an unset voice is a
 * configuration error, not a runtime condition to route around.
 */
export function resolveVoice(author: AuthorSlug, config: VoiceResolutionConfig): TtsVoice {
	assertVoicesAssigned();

	const assignment = VOICE_REGISTRY[author];
	const voiceId = config.primary === 'polly' ? assignment.pollyVoiceId : assignment.elevenLabsVoiceId;

	// assertVoicesAssigned already guarantees both ids are non-null, but
	// keep this narrowing explicit rather than a non-null assertion.
	if (!voiceId) {
		throw new Error(`No ${config.primary} voice id for "${author}" despite assertVoicesAssigned passing.`);
	}

	return {
		provider: config.primary,
		voiceId,
		label: author
	};
}
