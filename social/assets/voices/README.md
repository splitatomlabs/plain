# Narration voices — decision record (T14)

> **STATUS: UNSET.** No voice has been auditioned yet. `social/src/audio/voices.ts`'s
> `VOICE_REGISTRY` has `elevenLabsVoiceId: null` and `pollyVoiceId: null` for all three
> Stoics, and `VOICES_ARE_UNSET = true`. `assertVoicesAssigned()` throws until this
> file's three slots below are filled in and the registry is updated to match — this is
> deliberate: it is the guard that stops a render from silently shipping with a
> default/placeholder voice. See `social/src/audio/voices.ts`'s module doc for how the
> guard is wired in.

## Why this is blocked

Auditioning requires listening to real synthesized speech. There is no
`ELEVENLABS_API_KEY` available in the environment that authored this pipeline, and T12
(`social/src/audio/tts.ts`) deliberately forbids live provider calls anywhere in the
automated test suite. So the actual listen-and-choose step can only happen when a human
with API access runs it locally. Everything else — the registry shape, the guard, the
audition script, this record's structure — is built now so filling in three ids and
three rationales is the ONLY thing left to do.

## What each voice must sound like

- **Within the house rule.** Per `plans/Pf39c2-social-pilot-02.md`: *"TTS pitch and
  rate never below default — no 'wise deep voice'."* Pitch and rate multipliers of 1.0
  (provider default) or above only, enforced in code by
  `assertVoiceSettingsWithinHouseRule` in `tts.ts` — but the audition itself must also
  reject any candidate that only sounds distinctive by being pitched down or slowed
  down. If a candidate voice needs settings below default to sound "right," it is the
  wrong candidate, not a settings problem.
- **Distinguishable from the other two, by ear alone, with no visual cue.** This is the
  acceptance criterion for T14 ("three IDs committed and distinguishable from each
  other"). A listener hearing 5-10 seconds of narration with no on-screen character name
  must be able to tell which of the three Stoics is speaking. Differences in age,
  register, pacing, and accent all count; differences that only show up as pitch/rate
  settings do not (see above).
- **Matched to the character**, per `docs/BRANDING.md` and
  `social/assets/characters/README.md`'s art-direction brief:
  - **Epictetus (The Slave)** — plainest of the three. Younger or unadorned register; no
    theatrical gravitas.
  - **Marcus Aurelius (The Emperor)** — most measured/reflective. This is a private
    journal, not a speech — should not read as oratory or command.
  - **Seneca (The Senator)** — most rhetorical/persuasive of the three; he is a trained
    orator addressing a friend in his letters.
- **Never changes after being fixed.** Once an id is committed here and in
  `voices.ts`, it is permanent for the life of the channel — consistency across every
  post matters more than any later "better" find. Re-auditioning is a deliberate,
  separate decision, not something that happens by editing this file casually.

## Running the audition

```
ELEVENLABS_API_KEY=... npx tsx social/scripts/audition-voices.ts \
  --epictetus voiceIdA,voiceIdB,voiceIdC \
  --marcus-aurelius voiceIdD,voiceIdE \
  --seneca voiceIdF,voiceIdG
```

- Supply candidate ElevenLabs voice ids per author as a comma-separated list (any
  subset of the three `--<author>` flags may be given in one run; re-run per author as
  candidates are narrowed down).
- The script synthesizes the SAME fixed passage per Stoic (see below) for every
  candidate for that author, so what a listener hears differs only in the voice, never
  the text.
- Output lands in `social/out/audition/<author>--<voiceId>.wav` (gitignored — this
  directory is scratch space, never committed).
- The script prints a table of candidate ids and output paths at the end. Listen to
  each file, pick a winner per Stoic, and fill in the slots below.
- This script is manual and one-off. It must never be called from the daily render
  path (`social/src/cli.ts`, T18) — that path only ever reads the fixed ids out of
  `VOICE_REGISTRY` via `resolveVoice()`.

### The fixed audition passage

One short, verbatim, unedited opening sentence per Stoic, taken directly from a real
card's `plain_english` field in `content/output/` (not written for this purpose) —
using real shipped copy means the audition hears exactly what listeners will hear on
launch day. Recorded here (and in `social/scripts/audition-voices.ts`'s
`FIXED_PASSAGES`) so the audition is reproducible and traceable back to source:

| Stoic | Card id | Source | Passage |
|---|---|---|---|
| Epictetus | `enchiridion-02-001` | `content/output/enchiridion/section-02.json` | "Remember what desire and aversion really mean." |
| Marcus Aurelius | `meditations-02-004` | `content/output/meditations/book-02.json` | "Why do these outside events distract you so much?" |
| Seneca | `peace-of-mind-14-001` | `content/output/peace-of-mind/section-14.json` | "We should develop an easy-going attitude." |

## Decision record

Fill in each Stoic's slot below when its voice is chosen, then mirror the same ids and
rationale into `VOICE_REGISTRY` in `social/src/audio/voices.ts`, and flip
`VOICES_ARE_UNSET` to `false` there once all three are filled in.

### Epictetus (The Slave)

- **ElevenLabs voice id:** UNSET
- **Polly fallback voice id:** UNSET
- **Rationale:** UNSET — must explain how this voice satisfies the house rule and reads
  as distinguishable from Marcus Aurelius's and Seneca's voices (see "What each voice
  must sound like" above).
- **Audition date:** UNSET
- **Candidates considered:** UNSET

### Marcus Aurelius (The Emperor)

- **ElevenLabs voice id:** UNSET
- **Polly fallback voice id:** UNSET
- **Rationale:** UNSET
- **Audition date:** UNSET
- **Candidates considered:** UNSET

### Seneca (The Senator)

- **ElevenLabs voice id:** UNSET
- **Polly fallback voice id:** UNSET
- **Rationale:** UNSET
- **Audition date:** UNSET
- **Candidates considered:** UNSET

## After this is filled in

1. Update `VOICE_REGISTRY` in `social/src/audio/voices.ts` with the three
   `elevenLabsVoiceId` / `pollyVoiceId` / `rationale` values recorded above.
2. Flip `VOICES_ARE_UNSET` to `false` in that same file.
3. `social/src/audio/__tests__/voices.test.ts`'s `resolveVoice` tests flip automatically
   from "throws for every author" to the real T14 acceptance assertions (three distinct
   ElevenLabs ids, three distinct Polly ids, every rationale non-empty) — no test-file
   edits needed.
4. Remove the "STATUS: UNSET" banner at the top of this file.
