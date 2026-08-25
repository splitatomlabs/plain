# Character System and Rendering

## Parent
`plans/Pf39c2-social-pilot-index.md`

## Depends on
- `plans/Pf39c2-social-pilot-01.md` — needs the premise pools and schedule as renderer input

## Objective
Build the three-Stoic visual identity and render each format to a 1080x1920 MP4, by the cheapest path that still
looks like Plain.

## Decisions
- **Three fixed portraits** — Slave, Emperor, Senator — generated ONCE and committed. Zero marginal cost, perfect
  consistency, no AI-disclosure burden because the treatment is non-photoreal.
- **Art direction must not be the default.** "Grey marble bust on black" is the cliché of this niche. Use Plain's
  warm paper palette and a deliberate illustrative treatment.
- **Playwright screenshot, not Satori** — Satori has no variable-font axis support, so Literata and DM Sans would
  flatten to discrete weights. A daily cron is not latency-sensitive. Leave
  `web/src/routes/api/og/[cardId]/+server.js` on Satori.
- **Remotion for video** (free for teams up to three). FFmpeg-only is the fallback.
- **Narration is in**, one fixed voice per Stoic. ElevenLabs primary (~$22/mo), Amazon Polly fallback.
- **5-8 music beds, generated once and reused.** One bed across 150 posts is audibly repetitive within a week.
  Generating once keeps an API call off the daily path; generated tracks also carry no Content ID fingerprint,
  unlike licensed royalty-free libraries.
- **Line-level timing only** — word-level sync is unnecessary here (see T13).

## Files
- `social/package.json` — new workspace: Remotion, Playwright, ffmpeg-static, ElevenLabs client
- `social/assets/characters/` — three portraits + provenance README
- `social/src/render/templates/` — one template per format
- `social/src/remotion/` — compositions
- `social/src/render/encode.ts`
- `social/src/audio/tts.ts`, `mix.ts`, `timing.ts`
- `social/assets/music/` — 5-8 beds with provenance
- `social/src/render/__tests__/`, `social/src/audio/__tests__/`

## Constraints
- **THE HOUSE RULE — the archaic side moves, the plain side does not.** Enforce the three checkable rules from the
  index: no overshoot easing anywhere; payoff frame motionless for >=2.5s; TTS pitch and rate never below default.
- Motion is otherwise unconstrained for social; only the tonal brand constraints apply.
- **No logo, URL or watermark in frame.**
- Palette from `docs/BRANDING.md`: bg `#FAF7F2`, text `#2C2520`, secondary `#736B62`; accents epictetus `#B5704F`,
  marcus-aurelius `#5B6E8A`, seneca `#6B7F5E`. Accents fail WCAG AA for normal text — use only at >=18px or >=14px bold.
- Fonts must be INSTALLED in the container, not merely referenced. Missing system fonts is the top
  Remotion-on-Cloud-Run failure.
- Encode: `-c:v libx264 -profile:v high -level:v 4.0 -pix_fmt yuv420p -vf "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=30" -crf 20 -maxrate 10M -bufsize 20M -g 60 -keyint_min 60 -sc_threshold 0 -bf 2 -c:a aac -b:a 128k -ar 48000 -ac 2 -movflags +faststart+negative_cts_offsets -map_metadata -1`
- **"Hook" means something different per format and they are NOT interchangeable:** The Wall — the archaic text must
  be ILLEGIBLE; do not shrink it to make it readable. The Question — one short second-person question, legible and
  answerable in under 1.5s. The Objection — the objection alone, reading as a thought the viewer has had.

## Tasks
- [x] T01: Scaffold the `social/` workspace. Acceptance: `npm install --prefix social` succeeds; empty test run passes.
  Self-contained npm project (own `package.json`/`node_modules`/`tsconfig.json`, not a root workspace member),
  mirroring root conventions (ESM, `tsx`, `vitest run`). All 17 required deps (playwright, remotion, @remotion/cli,
  @remotion/renderer, react, react-dom, ffmpeg-static, ffprobe-static, @elevenlabs/elevenlabs-js,
  @aws-sdk/client-polly, @fontsource-variable/literata, @fontsource-variable/dm-sans; dev: vitest, tsx, typescript,
  @types/node, @types/react, @types/react-dom) installed cleanly, none dropped. Created empty dir scaffold
  (`assets/characters/`, `assets/music/`, `src/render/templates/`, `src/remotion/`, `src/audio/__tests__/`) with
  `.gitkeep`, plus `src/render/__tests__/scaffold.test.ts` placeholder. Added `social/out/` to root `.gitignore`
  (`node_modules/` already covered globally). `npm install --prefix social` and `npm test --prefix social` both
  exit 0 (1 passed test). No renderer/encoder/audio/Remotion implementation code was added — left for T02+.
- [!] T02: Art-direct and generate the three portraits; commit them plus a README recording tool, prompt, date and
  licence. Acceptance: a reviewer can tell slave/emperor/senator apart at thumbnail size, and they are clearly not
  stock marble-on-black.
  BLOCKED (2026-08-25, user decision): no image-generation tool is available in this session. Two rounds of
  hand-authored SVG were reviewed and rejected — round 1 read as flat cartoon avatars, round 2 as uncanny carved
  profiles. The user will generate the real portraits externally. What IS committed: the three SVGs as clearly
  labelled PLACEHOLDER art, `social/assets/characters/README.md` as an asset contract (file contract, art-direction
  brief, provenance requirements), and `social/src/render/characters.ts` as the loader every downstream composition
  uses. Dropping three conforming files into `social/assets/characters/` completes this task with no code change;
  flip `PORTRAITS_ARE_PLACEHOLDER` when they land.
- [x] T03: Write renderer tests — output dimensions, JPEG for the IG feed size, long text shrinks rather than
  overflows, correct accent per author. Acceptance: tests fail against an empty implementation.
- [x] T04: Implement the Playwright card renderer, auto-fitting by binary-searching font size, mirroring
  `web/src/lib/utils/og.js`. Acceptance: T03 passes.
- [x] T05: Build **The Wall** — the flagship. Frame 0.0 is a screen packed edge to edge with 150+ words of
  small-set archaic text, already mid-push-in, no title card and no margins; a karaoke highlight races through at
  ~320wpm, past reading speed. **Silent.** At **2-3s: hard cut** — all motion stops, silence, one still plain
  sentence held a full 3 seconds. Then the rest of the plain passage, one still line at a time, quietly narrated.
  Acceptance: renders from a >=150-word card; the cut lands as a somatic drop when watched on a phone.
- [x] T06: Add the Wall layout gate — auto-fit to exactly one screen and REJECT any card that cannot be set at
  >=14px equivalent (396 cards run over 150 words). Acceptance: an over-long card is rejected, not rendered illegibly.
- [x] T07: Build **The Question**. Frame 0.0 is the question alone, still and readable. Then the archaic original
  arrives as the moving wall; then it drops away and the plain answer resolves in stillness. **There is no wrong
  answer** — it must never read as testing the viewer. Acceptance: renders from the validated pool; the question is
  legible and answerable within 1.5s.
- [x] T08: Build **The Objection**. Frame 0.0 is the objection alone in quotation marks in the author's accent
  colour. Lead with On Anger. Cap the reply at its first two sentences and REJECT rather than truncate mid-argument.
  Acceptance: renders from the gated pool; no reply is cut mid-sentence.
- [x] T09: Implement the **read-through counter overlay** — a "Card 1 of 72" label any composition can carry, not a
  format of its own. PLAIN TEXT in body ink, never a styled or accent-coloured progress bar: an animated accent bar
  becomes brand furniture, which is TikTok watermark-rule territory. Acceptance: the overlay composes over all three
  formats without reflowing them, and reads as a page number rather than branding.
- [x] T10: Implement the encoder. Acceptance: ffprobe confirms High/L4.0/yuv420p/1080x1920/30fps/AAC 48kHz and moov
  before mdat.
- [x] T11: Generate 5-8 calm ambient loopable instrumental beds, 60s each, no vocals. Run once, manually; commit the
  audio plus a README recording provider, licence and date. Acceptance: 5-8 tracks committed with provenance.
- [x] T12: Define the TTS provider interface — `synthesize(text, voice) -> audioPath`, satisfied by both ElevenLabs
  and Polly so swapping is config. Tests use recorded fixtures, never live calls. Acceptance: a simulated ElevenLabs
  failure produces Polly audio.
- [x] T13: Implement LINE-LEVEL narration timing — `social/src/audio/timing.ts`. Word-level sync is not needed: The
  Wall is silent (its highlight is a timed sweep) and every payoff is one still line at a time. Timings must come
  from native provider data, never estimated from word counts. Gate: reject any render where the last line's end
  timestamp differs from audio duration by more than 120ms. Acceptance: a synthetic drifted timing set is rejected.
- [!] T14: Audition and fix one voice per Stoic; commit the three voice IDs with written rationale. They never change
  after this. Acceptance: three IDs committed and distinguishable from each other.
  BLOCKED (2026-08-25): auditioning requires an `ELEVENLABS_API_KEY` and a human listening to real synthesis; T12
  forbids live provider calls in tests. Everything around the decision IS built: `social/src/audio/voices.ts` holds
  the three-slot registry with every id `null`, `assertVoicesAssigned()` fails loudly so placeholder voices cannot
  ship silently, `social/scripts/audition-voices.ts` runs the audition against a fixed verbatim passage per Stoic,
  and `social/assets/voices/README.md` is the decision record awaiting ids, rationale and audition date. The test
  already contains the real acceptance assertion behind a `VOICES_ARE_UNSET` branch, so populating the registry
  flips it on with no test edit.
- [x] T15: Implement the mixer — trim/loop a bed to length, duck it under narration with scripted (deterministic)
  volume envelopes, mix, then two-pass ffmpeg `loudnorm` (measure with `print_format=json`, then apply). Target
  ~-14 LUFS integrated, -1 dBTP as a NAMED CONSTANT, not a literal — it is an industry-standard figure, not a
  confirmed platform spec. Acceptance: measured loudness within tolerance; output is 48kHz stereo AAC.
- [x] T16: Automate the three house-rule checks across every format. Acceptance: the check fails a composition with
  overshoot easing or a moving payoff frame.
- [x] T17: Implement the three-way OPENING ROTATION for The Wall — standard, 190->97, Grade-14. Same pool, same
  reveal, different first 2s. Render the grade as a bare measurement, original only. Tag the chosen opening in post
  metadata so plan 03 can compare openings. Acceptance: three openings render from one card.
- [x] T18: Build the render CLI — `social/src/cli.ts render --date <YYYY-MM-DD> --slot <1|2>`, reading the schedule
  and writing to `social/out/`. Acceptance: produces correct assets for a given day.
- [~] T19: Render a full week and review all 14 posts together, with sound, on a phone. A judgement gate, not a test:
  if they do not look like one coherent channel, fix the art direction before going further.

## Follow-up
- [x] F01: The read-through counter collided with The Wall's packed archaic text (found while reviewing T17's
  openings). Fixed inside the T17 round: the counter no longer renders over a MOVING archaic wall in any format —
  it appears only on the still payoff frames, where a viewer actually reads it. `counter.test.ts`'s pixel-level
  no-reflow proof was retargeted, not weakened.
- [x] F02: Rendering week 1 end to end failed 3 of 14 posts. Two are `mix()` dying on ffmpeg's second loudnorm
  pass with `Value -inf for parameter 'measured_I' out of range` — the first pass measured DIGITAL SILENCE. Both
  failures used `bed-03-e-minor7`. Find the root cause (is bed-03 actually silent through the mix path, or does the
  envelope/silent-span handling zero the whole track?) and fix it, then make the mixer fail with a clear, named
  error when a first-pass measurement is non-finite instead of surfacing raw ffmpeg output.
- [x] F03: The third week-1 failure is a Wall card whose composition computes to 1845 frames (61.5s), over the
  59s ceiling, so `padToMinimumDuration` refuses it AT RENDER TIME. Refusing is correct; failing this late is not —
  the scheduler can hand the renderer a card that can never be rendered. Move the ceiling into the Wall gate
  (beside the legibility floor) so an over-long card is rejected when the pool is surveyed, and have `surveyWallPool`
  report how many cards the ceiling excludes.
- [ ] F04: The Question's and The Objection's timing modules do not accept `narrationTimings` — only The Wall does
  (flagged by T18). Once T14's voices land, real narration for those two formats can drift against their fixed
  holds. Blocked behind T14; do not build until voices exist.

## Deferred
**Three Voices** — only 15-37 usable triads exist. Revisit after a validated `pull_quote` field exists.

## Verify
```
npm test --prefix social
npx tsx social/src/cli.ts render --date 2026-09-01 --slot 1
ffprobe -v error -show_streams social/out/*.mp4
```
