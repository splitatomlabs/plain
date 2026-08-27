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
- [-] T02 (OBSOLETE 2026-08-27, superseded by Pf39c2-social-pilot-02a D01): the three portraits were for The
  Question, The Objection and The Still, all of which D01 DELETED outright — the channel is one Wall a day and
  `Wall.tsx` renders no portrait at all. `social/src/render/characters.ts` survives but is now imported by
  nothing except its own test; it and the placeholder SVGs should be deleted with the rest of the character
  system if nothing revives it. Original task text, kept for the record: Art-direct and generate the three portraits; commit them plus a README recording tool, prompt, date and
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
- [!] T14 (STILL LIVE, re-confirmed 2026-08-27): the ONLY genuinely outstanding task in this plan. Unlike T02,
  the voice system survived D01 — `social/src/audio/voices.ts` is imported live by `cli.ts` and `narration.ts`,
  and every render to date records `narration: false`, so the channel is still music-only. Blocked on an
  `ELEVENLABS_API_KEY` and a human listening, not on code. Original task text: Audition and fix one voice per Stoic; commit the three voice IDs with written rationale. They never change
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
- [-] T19 (SUPERSEDED 2026-08-27 by Pf39c2-social-pilot-02a): the week is no longer 14 posts across four
  formats — D02 collapsed it to 7 single-slot Wall days — and the judgement gate this task describes was
  carried out twice during 02a's user feedback rounds (U07 and the round-2 review), each time on real renders
  with sound, each time producing concrete fixes. Original task text: Render a full week and review all 14 posts together, with sound, on a phone. A judgement gate, not a test:
  if they do not look like one coherent channel, fix the art direction before going further.
  RENDERS DONE, JUDGEMENT PENDING (2026-08-25). All 14 week-1 posts render to spec into `social/out/` (53MB):
  8 Wall (3 standard, 3 grade, 2 countdown), 4 Question, 0 Objection — the read-through walks Meditations
  02-001..007 in slot 1. Rendering the week is what surfaced F02, F03 and F05, which are fixed. The review itself
  is the user's call and cannot be delegated: it must be watched WITH SOUND ON A PHONE. Two caveats to weigh while
  watching — the portraits are placeholder art (T02) and there is no narration (T14), so the music bed is the whole
  soundtrack. Re-render any time with:
  `for d in 01 02 03 04 05 06 07; do for s in 1 2; do npx tsx social/src/cli.ts render --date 2026-09-$d --slot $s; done; done`

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
- [x] F05: F03 surfaced the real gap behind it: the SCHEDULER never consults the renderer's gate. 59 of the 896
  Wall pool entries exceed the 59s ceiling, and `scripts/lib/schedule.ts` can schedule any of them — which is how
  week 1 ended up with an un-renderable slot. `tryReadThroughContent`'s wall branch is worse: it never gates at all
  ("wall always renders"), so the read-through cascade cannot route around an un-renderable card. Publish a
  renderer-derived exclusion list the scheduler reads, so an impossible slot is never scheduled in the first place.
- [x] F06: (review M1+M2) The renderer-derived exclusion artifact covers The Wall's POOL only. The Question and
  Objection pools are ungated, so a schedule can contain a card their gates reject at render time
  (`discourses-50-008` is 13 words, over the 12-word floor). And the read-through walks the book slice regardless of
  pool membership, so Wall exclusions can never apply to it — plus the survey derives the landing line differently
  from the read-through render, so even a surveyed card's verdict can be wrong. Extend the artifact to all three
  formats and to the read-through slice, using the read-through's own landing-line derivation.
- [x] F07: (review M3+M4+M5) Three defects around the render path: every Remotion `bundle()` leaks a ~21MB temp dir
  (412 dirs / 8.5GB on this machine); `assertNarrationInSync` is handed `marks[last].endMs` as the audio duration,
  so T13's drift gate compares marks against themselves and can never fire — and on Polly it under-reports by the
  final word, un-ducking the bed mid-word; and the root `npm test` never runs the 437-test `social/` suite.
- [x] F08: (review M6) No end-to-end render coverage for The Objection — week 1 contains no Objection slot, so its
  whole render path has never executed. Blocked behind F06, which changes which cards can be scheduled.
- [x] F09: (re-review R1) The F07 drift-gate fix swapped a gate that could never fire for one that can never pass.
  Polly reports no duration for the final word (`endMs === startMs`), so gating the last line's end against the
  probed file duration always drifts by the final word plus trailing silence — ~490ms on the committed fixture,
  against a 120ms tolerance. Repair the under-reporting mark before building timings, then gate.
- [x] F10: (re-review R2+R4) `content/social/pilot-schedule-w02.json` is a TEST FIXTURE committed as real pipeline
  state — generated with `--objection-weight 20 --skip-review-check`, it bypasses plan 01's review gate and would
  become week 3's `loadPriorWeeks` input. Add a `--schedule-dir` override to the CLI, move it under
  `social/src/__tests__/fixtures/`, and delete it from `content/social/`. Also fix the confirmed mkdtemp-parent leak
  in `cli.test.ts`'s dry-run tests.
- [x] F11: (re-review R3) `loadExclusions`'s two throw paths are untested — they are the only thing between a
  truncated or hand-edited artifact and a silently ungated schedule.
- [x] F13: (final review R5) The F09 Polly repair is UNBOUNDED, so the drift gate still cannot fire. Polly collapses
  the final mark on every real result, so the repair always applies and always rewrites the last line's end to the
  probed duration — demonstrated by passing marks claiming 300ms against a 1254ms file. Bound the stretch to a
  plausible final word and throw otherwise, and test with the mark SHAPE `parsePollySpeechMarks` actually emits.
- [x] F14: (verification review R6) The `longestOtherMarkMs === 0` escape hatch in the F13 bound was load-bearing
  and untested — deleting the guard left the suite green while breaking every single-word Polly narration. Covered
  both reachable shapes, and proved the tests catch it by removing the guard and watching them fail.
- [x] F15 (DONE 2026-08-27, implemented in Pf39c2-social-pilot-02a as T08/T09): all three decisions landed —
  (a) `WALL_SCROLL_RATE_PX_PER_SEC` is a fixed rate identical on every card with the cut landing mid-passage
  (the never-finishes invariant, re-guaranteed for short chapters by 02a R02's lap repetition); (b) the block
  is sourced from the surrounding CHAPTER at a fixed 44px so it genuinely travels; (c) the karaoke highlight
  is gone. The countdown numeral this task said must be re-derived was instead DELETED outright by 02a T17.
  Original task text: CHANGE OF INTENT (user, 2026-08-26), not a defect. T05 as written specifies "already mid-push-in" plus a
  320wpm karaoke highlight, and that is what was built — but the intended mechanic is that the archaic text SCROLLS
  past faster than anyone can read, then the plain version lands. The built version has nothing travel: a 1.02->1.05
  zoom over 2.5s and a highlight reaching ~14 of 150 words, so it reads as a dense page sitting still. Rebuild the
  wall phase as a scroll. Decisions taken with the user: (a) FIXED scroll rate, identical on every card, with the
  hard cut landing MID-PASSAGE so it visibly never finishes; (b) LARGER type so the block runs 2-3 screen-heights
  and genuinely travels — illegibility comes from speed, not from squinting; (c) DROP the karaoke highlight, the
  scroll is the motion. The countdown opening currently derives its numeral from the karaoke sweep, so it must be
  re-derived from scroll progress.
- [x] F17: The Remotion compositions render in GEORGIA, not Literata. `SERIF_STACK` names 'Literata Variable' but
  no `@font-face` is registered anywhere in the bundle, so every MP4 falls back — while the Playwright feed still
  DOES embed the fonts, so the JPEG and the MP4 of the same post are set in different typefaces. On a Linux
  container there is no Georgia either. This is the plan's own named top failure mode ("Fonts must be INSTALLED in
  the container, not merely referenced"). Must land BEFORE F16: F15's line-count calibration was measured against
  Georgia's metrics, so the geometry has to be re-derived once the real face is in.
- [x] F16: Set the agreed scroll geometry and re-derive the Wall gate around it (depends on F15 and F17). User chose
  the middle setting: 76px type at ~500px/s (denser than F15's 86px/720px/s, still visibly outrunning the reader). The current gate's objective is "auto-fit to
  exactly ONE screen" — the opposite of what a scroll needs. New axes: the block must be tall enough to travel, the
  type must clear the legibility floor, and the scroll must NOT finish before the cut. Then regenerate
  `content/social/render-exclusions.json` and week 1, since the pass/reject split will move.
- [x] F18: The fixed 76px setting from F16 costs 76% of the Wall pool (219/896), 86% of Question (12/88), and
  breaks the read-through outright (11/48 renderable, needing 7 CONSECUTIVE; longest run anywhere is 4), so week 1
  cannot be generated and only 4/14 slots render. Cause is arithmetic, not a bug: "never finishes" needs a block
  over 3,170px, and a FIXED font size only reaches that above ~130 words. Fix: stop fixing the font size, fix the
  BLOCK HEIGHT — fit each card's type to land near a target block height, so short passages get larger type and
  long ones smaller. Fixed rate and the never-finishes invariant both hold, and supply returns.
- [x] F19: The read-through cannot be a no-skip sequence under the Wall gate — it needs 28 consecutive renderable
  cards over a 4-week pilot and the longest run anywhere in the corpus is 17 (measured per chapter; Meditations
  book-02+03 manages 5, book-11 manages 12, on-anger book-1 manages 17). User's decision: give the read-through a
  STILL fallback so nothing is ever skipped and "Card N of 48" stays literally true. A card too short to be a Wall
  renders as plain text on warm paper, motionless, over the music bed. The index plan already wants one still
  running deliberately as a pattern interrupt, so this uses an asset it asked for rather than inventing a format.
  The slice stays Meditations book-02+03 — with a universal fallback the original rationale holds.
- [-] F12 (OBSOLETE 2026-08-27): the read-through was deleted by Pf39c2-social-pilot-02a D02 and the Question
  and Objection formats by D01, so the branches this describes no longer exist in `scripts/lib/schedule.ts`.
  Original task text: (re-review, noted not blocking) The read-through's question/objection branches in `scripts/lib/schedule.ts`
  re-derive content via their own gates and are still ungated by `render-exclusions.json`. The current Meditations
  book-02/03 slice passes both gates with 0 rejections, so there is no live defect — recorded, not fixed.
- [-] F04 (OBSOLETE 2026-08-27): 02a T16 did implement this, and then D01 deleted both formats outright —
  `question-timing.ts` and `objection-timing.ts` no longer exist. Only The Wall remains, and it has accepted
  `narrationTimings` since T13. Original task text: The Question's and The Objection's timing modules do not accept `narrationTimings` — only The Wall does
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

## CURRENT STATE — handoff for refining The Wall (2026-08-26)

Written for a fresh context. Everything below is committed on `social-pilot-02` (PR #40). The user's verdict on the
renders so far: **not moving toward the right end result.** The Wall is the format to refine; the rest of the
pipeline works and should not need re-litigating.

### What The Wall does right now

Frame 0 is the archaic passage set large, top of block flush with the frame top, ALREADY at full scroll velocity —
no ease-in. It scrolls up linearly at a fixed rate for 2.5s, the cut lands mid-passage so it visibly never
finishes, then all motion stops: the landing line alone, motionless, 3s, in silence, then the rest of the plain
passage one still line at a time.

| Constant | Value | Where |
|---|---|---|
| `WALL_SECONDS` | 2.5 (bounds 2-3) | `social/src/remotion/wall-timing.ts` |
| `WALL_SCROLL_RATE_PX_PER_SEC` | 500 (~4x reading pace) | same |
| `WALL_TARGET_BLOCK_HEIGHT_PX` | 3400 | same |
| `WALL_FONT_FLOOR_PX` / `WALL_FONT_CAP_PX` | 39 / 92 | same |
| fitted size across the real pool | 65-91px, mean 80.6, median 81 | measured |
| `WALL_LINE_HEIGHT_RATIO` | 1.25 | same |
| `WALL_INSET_PX` | 80 | same |
| `WALL_LINE_ESTIMATE_OVERSHOOT` | 1.14 | calibrated against real Literata renders |
| `WALL_MIN_TRAVEL_BLOCK_HEIGHT_PX` | 3170 = `FRAME_HEIGHT + rate * seconds` | `wall-gate.ts` |

Font size is fitted PER CARD to land the block near 3400px — short passages get larger type, long ones smaller.
Files: `Wall.tsx`, `wall-timing.ts`, `wall-gate.ts`, `wall-pool.ts`, `wall-openings.ts`.

### Three geometry attempts, and why each was rejected

1. **Push-in + karaoke highlight** (T05, as the plan literally specified). A 1.02->1.05 zoom over 2.5s and an
   accent highlight advancing at 320wpm. At that rate the highlight reached ~14 of 150 words. NOTHING TRAVELLED —
   on a phone it read as a dense page sitting still. Rejected by the user, who said the intent was always that the
   text scrolls past faster than it can be read.
2. **Fixed 86px, 720px/s** (F15). Genuinely travelled and the cut landed mid-passage. Rejected on look: four or
   five words a line, ~68 words on screen — large-print, not a wall.
3. **Fixed 76px, 500px/s** (F16). Denser, but a fixed size collapsed supply: Wall 219/896, Question 12/88,
   read-through 11/48, week 1 could not generate at all and only 4 of 14 slots rendered.
4. **Per-card fit to block height** (F18, current). Recovered supply to 662/896. This is where it stands, and it
   is still not landing for the user.

### The arithmetic that binds any future attempt

- **"Never finishes" is the expensive constraint.** It requires `blockHeight > FRAME_HEIGHT + rate * seconds`.
  At 500px/s over 2.5s that is 3170px, i.e. ~1.65 screens of text MINIMUM.
- **Block height scales with the SQUARE of font size**, so density is bought at a steep price: dropping 86px to
  76px shrinks every block ~22%.
- **The corpus cannot produce a true "wall".** The longest original excerpt in the entire corpus is 201 words;
  1,326 cards are >=80 words, 816 >=120, 396 >=150. At any legible size a 150-word passage is roughly 1.8-2
  screens, not an intimidating dense page. A real wall-of-text would need several times more text than exists.
  **This is the deepest tension in the format and no geometry tweak resolves it.**
- **The plan's own wording is ambiguous** and worth settling before building again: "the archaic text must be
  ILLEGIBLE; do not shrink it to make it readable." Attempts 2-4 read that as "illegibility comes from speed";
  attempt 1 read it as "illegibility comes from density". They pull in opposite directions.
- Duration floor 15s / ceiling 59s (`duration-bounds.ts`) applies to every post. The Wall clears the floor
  naturally; 44 pool cards breach the ceiling and are excluded.

### Measured corpus numbers (from `content/social/render-exclusions.json`, regenerate with
`npx tsx social/scripts/write-exclusions.ts --date <YYYY-MM-DD>`)

| Pool | Renderable |
|---|---|
| Wall | 662 / 896 |
| Question | 37 / 88 |
| Objection | 27 / 59 |
| Read-through slice (Meditations book-02+03) | 26 / 48 |
| Still (fallback, same slice) | 48 / 48 |

Longest run of CONSECUTIVE Wall-renderable cards, by chapter — the read-through's binding constraint, since it
walks a slice in order and needs 7 per week:

| Slice | Consecutive | Renderable |
|---|---|---|
| on-anger/book-1 | 17 | 56/69 |
| on-anger/book-3 | 15 | 101/121 |
| meditations/book-11 | 12 | 24/45 |
| meditations/book-10 | 9 | 32/57 |
| meditations/book-02+03 (current slice) | 5 | 26/48 |

A no-skip 4-week read-through needs 28 consecutive. **No slice in the corpus supports that**, which is why the
Still fallback exists.

### Consequence the user has NOT yet accepted

Week 1 is **6 Wall, 4 Question, 0 Objection, 4 Still**, and all four Stills are read-through days (1, 3, 4, 7).
Across the whole Book 2-3 slice, 22 of 48 cards cannot be a Wall, so **~46% of read-through posts will be static
cards**. The index plan wanted ONE still running deliberately as a pattern interrupt. Options if that reads as
filler: move the slice (Book 11 is a similar ratio), loosen "never finishes" for short cards only (converts most
Stills back to Walls, softens the mechanic on those days), or accept it as rhythm.

### Open judgements, none of them code problems

- Does the hard cut land somatically on a phone with sound? Never verified — that is T19.
- Are the long Walls too long? Durations run 15s to 51s; a 51s Wall is one still line at a time for nearly a
  minute. The lever would be a maximum line count on the pool, not a trim.
- The Question and Objection are always exactly 15.0s because the floor pads them, so their final line holds ~8
  of those seconds. May read as stillness, may read as dead air.
- The music beds are ffmpeg-synthesized drones — clean, loopable, Content-ID-free, but drones.

### What is deliberately NOT the Wall's problem

Fonts are now embedded and correct (every MP4 rendered in Georgia until F17). The encoder, the mixer, the
scheduler gating, the counter overlay, the CLI and the house-rule checks all work and are covered by 491 social
tests plus 822 pipeline and 95 web tests. Blocked on the user: portraits (T02), voices (T14), the week review
(T19). Deferred by decision: F04, F12.

### Running things

```
npm test                                                    # all three suites
npx tsx social/src/cli.ts render --date 2026-09-01 --slot 1  # one post -> social/out/
npx tsx scripts/generate-schedule.ts --week 1 --seed 42 --first-week --force
npx tsx social/scripts/write-exclusions.ts --date 2026-08-26
```
Week 1 maps to 2026-09-01 (day 1) through 2026-09-07, slots 1 and 2; slot 1 is the read-through.

## Narration dropped (2026-08-27, user)

User, asked whether narration is still valuable given the Wall's current shape: decided to **drop it and delete
the subsystem**.

Reasoning, recorded because this reverses a headline decision of this plan ("**Narration is in**, one fixed
voice per Stoic. ElevenLabs primary (~$22/mo), Amazon Polly fallback"):

1. **It would reverse 02a V17.** That task made post duration a pure function of payoff screen count, with every
   payoff frame held exactly `DEFAULT_LINE_SECONDS` (3.0s) — the user's own ask ("constant hold time for each
   screen and vary the video length"). Narration overrides that: `restLineFrameCounts`
   (`social/src/remotion/wall-timing.ts`) uses `narrationTimings[index]` in preference to
   `DEFAULT_LINE_FRAMES`, so each line runs as long as its spoken audio and the constant-hold property is lost.
2. **It fills the silence 02a U04/U08 built and V06 doubled.** The payoff's force is a hard cut into 1s of true
   silence. A voice entering after the drop occupies the space the drop opens.
3. **It narrates text that is already large and legible.** The premise is visual — illegible becomes legible.
   The payoff sets one sentence at 52-88px, motionless, on an empty frame.
4. **The rationale for three distinct voices died with 02a D01.** One voice per Stoic was designed to pair with
   three portraits across four formats. The portraits are gone (T02, obsolete), the formats are gone, and the
   author is now named by `SourceHead`'s running head.

Weighed against: no data either way on whether spoken audio helps reach or watch-time on these platforms
(a real unknown, not a settled point); and a voice does serve low-vision viewers, though large on-screen type
covers most of that. Reversible from git history if the channel later wants it.

- [x] N01 (DONE 2026-08-27): Delete the narration subsystem. Removed `social/src/narration.ts`,
  `social/src/audio/tts.ts`, `social/src/audio/voices.ts`, `social/scripts/audition-voices.ts`,
  `social/assets/voices/`, their tests (`tts.test.ts`, `voices.test.ts`, both `narration.test.ts` files, and the
  narration-specific fixtures under `audio/__tests__/fixtures/`), and the `@elevenlabs/elevenlabs-js` +
  `@aws-sdk/client-polly` dependencies. `narrationTimings` is unwired from `cli.ts`, `wall-timing.ts` (the
  `WallTimingInput`/`WallGateContentInput` field and the `NarrationLineTiming` type are gone, not just
  optional), `Wall.tsx`, `Root.tsx` and `wall-gate.ts`, so `DEFAULT_LINE_FRAMES` is unconditionally the only
  source of a payoff line's duration. `--require-narration` and the `VOICES_ARE_UNSET`/T14 warning path are gone
  from `cli.ts`.
  Original task text: Remove `social/src/narration.ts`, `social/src/audio/tts.ts`,
  `social/src/audio/voices.ts`, `social/scripts/audition-voices.ts`, `social/assets/voices/`, their tests
  (`tts.test.ts`, `narration.test.ts`, and the narration-specific parts of `timing.test.ts`), and the
  `@elevenlabs/elevenlabs-js` + `@aws-sdk/client-polly` dependencies. Unwire `narrationTimings` from `cli.ts`,
  `wall-timing.ts`, `Wall.tsx`, `Root.tsx` and `wall-gate.ts` so `DEFAULT_LINE_FRAMES` is the only source of
  payoff line duration, and drop the `--require-narration` flag and the `VOICES_ARE_UNSET` warning path.
  **DO NOT delete `social/src/audio/timing.ts` wholesale** — it holds `splitPayoffLines`, which is live
  (`cli-plan.ts` imports it, and 02a V02 ported it into `scripts/lib/premises.ts` as the Wall gate's screen
  counter); keep that and anything else still reachable, delete only the narration-timing machinery. Decide
  deliberately what happens to the metadata sidecar's `narration: false` field — with narration gone it is
  either meaningless (remove it, and say what that does to `post-metadata.ts`'s shape and its tests) or worth
  keeping as an explicit statement for downstream publishers; state the choice. Keep `mix.ts` and `beds.ts`
  entirely — the music bed and the babble bed stay. Acceptance: both suites green; `npm install --prefix
  social` succeeds with the two deps gone; a re-render of week 1 produces byte-identical decoded PCM to the
  current renders (narration was never active, so nothing audible may change — verify by hashing PCM, not the
  MP4 container, which is not bit-reproducible here).
  DECISIONS AND FINDINGS (2026-08-27):
  - **`timing.ts`**: kept `splitPayoffLines` and its private helpers (`ABBREVIATIONS`,
    `endsWithAbbreviation`) verbatim. Deleted `normalizeForMatch`, `lineTimingsFromMarks`,
    `NARRATION_DRIFT_TOLERANCE_MS`, `assertNarrationInSync`, `LineFrameRange` and `toFrames` — all
    narration-timing machinery with no caller left once `narrationTimings` is gone from `wall-timing.ts`
    (`toFrames` in particular had ZERO callers outside its own test even before this task; it was built for
    T13 but `wall-timing.ts` always computed frames directly via its own `restLineFrameCounts`, never through
    `toFrames`).
  - **The `narration: false` sidecar field**: REMOVED, not kept. It was always `false` — no code path ever set
    it to `true` even before this task (T14 was blocked). With the whole narration subsystem deleted, no code
    path could EVER set it to `true` again, so it's a permanently-constant field carrying no information a
    reader could act on. `post-metadata.ts`'s own `PostMetadata` shape is untouched either way — the field
    lived in `cli.ts`'s additive `narrationFields` helper (renamed `additionalMetadataFields`), never in
    `post-metadata.ts` itself, so no shape or test change was needed there. `cli.test.ts`'s e2e test now
    asserts `metadata.narration` is `undefined`.
  - **Rule 3 of the house rule ("TTS pitch and rate never below default") — a gap the task didn't name**:
    `render/house-rules.ts` imported `assertVoiceSettingsWithinHouseRule`/`VoiceSettingsInput` from
    `audio/tts.ts`, which is deleted. Moved both into `house-rules.ts` itself rather than deleting them — rule
    3 is still one of the plan's three named, permanent house rules, and this module is where the plan says
    all three belong. It is genuinely unreachable from any real render today (no TTS call-site exists
    anywhere in the workspace), kept only as a standing constraint and its existing test coverage, same
    "reversible from git history" logic N01 applies to narration itself. Flagged here since this wasn't named
    in the task text and the fix required judgment.
  - **`mix.ts`'s ducking (`narrationSpans`/`DUCK` level)**: kept whole, per the task. `cli.ts` now always
    calls `mix()` with `narrationPath: undefined` and `narrationSpans: []`, so the `DUCK` envelope level is
    unreachable from any real render (only `NOMINAL`/`FLOOR` are reachable via the noise/silence spans) — but
    `mix.test.ts` still exercises it directly against synthetic `narrationSpans`, and it may still serve a
    future babble-bed-adjacent use. Reported per the task's instruction, not deleted.
  - **`audio/__tests__/narration.test.ts`**: this file mixed narration-specific tests (`narrationPlan`, framing
    text never reaching a TTS provider) with tests of `wallSilentSpans`/`wallNoiseSpans` and the F02
    non-silent-mix edge case, neither of which is narration machinery (they're the noise/silence spans
    `cli.ts` hands to `mix()` unconditionally). Deleted the narration-specific describe blocks and moved the
    surviving two into a new `audio/__tests__/wall-spans.test.ts`, rather than deleting the whole file, so
    that coverage isn't lost.
  - **`src/__tests__/narration.test.ts`** (the F07/F09/F13 drift-gate/Polly-repair suite): deleted wholesale —
    100% about `synthesizeNarration`'s Polly-mark-repair and drift-gate behavior, both gone with
    `narration.ts`.
  - Verification: rendered week 1 (2026-09-01..07) before and after the deletion, decoded each MP4's audio to
    PCM (`ffmpeg -vn -acodec pcm_s16le -ar 48000 -ac 1 -f s16le`) and hashed it — all 7 days byte-identical
    before/after. `npm install --prefix social` removed 32 packages with the two deps gone; `package-lock.json`
    has zero remaining references to either. All three suites green (574 pipeline + 95 web + 330 social).

- [ ] N02: Delete the character/portrait system, dead since 02a D01 for the same reason. Remove
  `social/src/render/characters.ts` (imported by nothing but its own test), its test, and
  `social/assets/characters/` including the placeholder SVGs and the asset-contract README. Grep first and
  report anything still referencing them; if `PORTRAITS_ARE_PLACEHOLDER` or the loader is reachable from any
  live composition, STOP and report rather than deleting. Separate commit from N01 so either can be reverted
  independently. Acceptance: both suites green; no dangling import; `Wall.tsx` unaffected.
