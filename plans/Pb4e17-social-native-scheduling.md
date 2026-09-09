# Social pilot — replace the publish pipeline with native scheduling + hand-entered metrics

## Objective

Delete the API publish pipeline. Post via each platform's own scheduler in one weekly desktop
session; record all metrics by hand. Render path unchanged.

## Why (decided 2026-09-09, do not re-litigate in execution)

- **The pilot's output is metrics, not posting automation.** Verified by grep against
  `social/src/metrics/readout.ts`: it references `views` (38×), `follows` (18×), `publishedAt`
  (11×), and `averagePercentWatched` / `likes` / `comments` / `shares` / `saves` **zero times**.
  Retention and engagement feed `scripts/review-week.ts` colour only, never the verdict.
- **YouTube was never going to be unattended.** `videos.insert` from an unaudited API project locks
  uploads private pending a 2-4 week compliance audit — which is why `publish/youtube.ts` hard-codes
  `privacyStatus: 'private'` and why runbook §5.3 exists. A human already had to open Studio weekly
  and flip all 7 videos. "Upload + schedule 7" replaces "flip 7" for ~8 min/week more.
- **Unattended YouTube posting needs code that does not exist.** `publish/youtube.ts` sends the
  stored value straight through as `Authorization: Bearer` and never refreshes; Google access tokens
  last ~1h; `job.ts` wires `notImplementedRefresh`, which throws.
- **Instagram automation is not worth its own cloud project once the other two are manual.** A
  weekly hand-entry session happens regardless. Only the DAILY follower snapshot differs, and that
  is one integer read off the phone.
- **YouTube follow-conversion survives hand entry exactly.** `metrics/youtube.ts:137` sourced
  `subscribersGained` per video; `computeFollowConversion` returns `method: 'exact'` reading
  `r.follows` off the row (`readout.ts:271`). Read it off Studio, type it in — criterion A's
  conversion half is unaffected.
- **Third-party schedulers were evaluated and rejected**: no free tier covers 84 video posts across
  3 platforms; none expose per-video `subscribersGained`; self-hosting (Postiz/Mixpost) still
  requires registering and getting audited for your own TikTok/Meta developer apps.

## Decisions

- Native schedulers only. Windows: Instagram ~75d, YouTube unbounded, **TikTok 10d** — TikTok is the
  binding constraint, so the weekly session cannot slip >3 days.
- Instagram follow-conversion degrades from `inferred` to `unavailable` on any day the follower
  count is not recorded. Accepted. Same state TikTok is already in by design.
- Keep `publish/caption.ts` — captions are still needed, now pasted by hand.
- Do NOT touch the render path (`cli.ts`, `cli-plan.ts`, `remotion/`, `render/`, `audio/`).
- Do NOT delete the `plain-social-pilot` GCP project or the Meta app/Page in this plan — leave them
  dormant for a week in case something surfaces. Code deletion is git-recoverable; that is not.

## Files

Keep, unchanged: `social/src/cli.ts`, `cli-plan.ts`, `pilot-config.ts`, `schedule-types.ts`,
`remotion/`, `render/`, `audio/`, `metrics/schema.ts`, `metrics/readout.ts`,
`scripts/generate-schedule.ts`, `scripts/review-week.ts`.

- `social/src/metrics/tiktok-manual.ts` (356) — generalise to all platforms; rename `hand-entry.ts`
- `social/src/publish/tiktok-manual.ts` (204) — rework `stageTikTokWeek` into local weekly prep, no GCS
- `social/src/publish/caption.ts` (161) — keep; used by the prep script for all 3 platforms
- DELETE `social/src/job.ts` (832), `job-plan.ts`
- DELETE `social/src/publish/`: `instagram.ts` (379), `youtube.ts` (491), `tokens.ts` (257),
  `storage.ts` (211), `env.ts` (107), `token-store-firestore.ts` (123), `token-store-local.ts` (141),
  `pending-flips-store-firestore.ts` (132), and their `__tests__/`
- DELETE `social/src/metrics/`: `collect.ts` (424), `instagram.ts` (391), `youtube.ts` (294),
  `tiktok-spike.ts` (278), and their `__tests__/`
- DELETE `social/Dockerfile`, `social/DOCKER.md`, `social/DEPLOY.md`, `social/cloud-run-job.yaml`,
  `social/gcs/`, `functions/src/socialTrigger.ts` (+ its test)
- `docs/SOCIAL_PILOT.md` — rewrite §3 and §5 around the weekly session
- `CLAUDE.md` — update the social suite test count in the Testing section

## Constraints

- Dependency check already done: `cli.ts` / `cli-plan.ts` import **nothing** from `publish/`. All
  cross-links among deleted modules are internal to the deleted set. `job-plan.ts` imports
  `caption.ts` (kept) plus type-only imports from `tokens.ts` / `publish/tiktok-manual.ts`.
- `MetricsRow` (`metrics/schema.ts`) is already platform-agnostic and `upsertMetricsRow` keys on
  `platform:postId`. Do not introduce a second row shape.
- Never fabricate a metric. Missing value = `null`, never `0`. (The bug this plan removes:
  `metrics/instagram.ts:263` did `views: values.get('plays') ?? 0` against a metric Meta deprecated
  on 2025-04-21 — it would have silently produced zeroes or zero rows.)
- Deletion tasks must leave `npm test` and `tsc --noEmit` green; no orphaned imports, no skipped tests.

## Tasks

- [x] T01: **PRE-FLIGHT, human, blocks nothing in code** — switch the pilot TikTok account from
      Personal to Creator (reportedly free/instant, unlike Business which needed verification) and
      confirm the schedule option appears. Confirm Meta Business Suite offers Reel scheduling and
      YouTube Studio offers scheduled publish. If TikTok scheduling is unavailable, STOP and
      reconsider — TikTok is the binding constraint. Record findings in `docs/SOCIAL_PILOT.md`.

- [x] T02: Failing tests for platform-agnostic hand entry —
      `social/src/metrics/__tests__/hand-entry.test.ts`. Cover: a row built for each of
      `instagram` / `youtube` / `tiktok`; `follows` accepted as an integer AND as `null`;
      `averagePercentWatched` optional and `null` when absent; validation rejects negative or
      non-integer counts; `upsertMetricsRow` replaces rather than duplicates on
      `platform:postId`. TDD — these must fail first.

- [x] T03: Generalise `metrics/tiktok-manual.ts` → `metrics/hand-entry.ts`. Replace the hardcoded
      `platform: 'tiktok'` (line 199) and forced `follows: null` with parameters. Keep the same
      `MetricsRow` output and the same `upsertMetricsRow` call. Add `--platform` and `--follows`
      flags to its CLI. T02 goes green.

- [~] T04: Daily follower-snapshot hand entry. Small CLI writing a `DailyFollowerSnapshot` via
      `metrics/schema.ts`'s existing `upsertFollowerSnapshot` — `--date` and `--followers`. Tests for
      upsert-not-duplicate on the same date. This is the ONE un-backfillable input; make the help
      text say so.

- [ ] T05: Rework `publish/tiktok-manual.ts`'s `stageTikTokWeek` into a local weekly prep function:
      drop the GCS upload entirely (MP4s are already on the machine that will upload them), emit one
      `captions.txt` covering all three platforms per day via `buildCaption({ slot, platform })` —
      it currently hardcodes `platform: 'tiktok'` at line 174. Update its tests.

- [ ] T06: Weekly prep CLI wrapper — renders the week and writes `captions.txt`. Gives §5.2 the
      runnable wrapper it never had. Acceptance: one command produces 7 MP4s + one captions file.

- [ ] T07: Delete the publish pipeline — `social/src/job.ts`, `job-plan.ts`,
      `publish/{instagram,youtube,tokens,storage,env,token-store-firestore,token-store-local,pending-flips-store-firestore}.ts`
      and their tests. `npm test` and `tsc --noEmit` green after.

- [ ] T08: Delete the API metrics collectors — `metrics/{collect,instagram,youtube,tiktok-spike}.ts`
      and their tests. Note in the commit that this removes the deprecated-`plays` bug rather than
      fixing it. `npm test` and `tsc --noEmit` green after.

- [ ] T09: Delete cloud infra — `social/Dockerfile`, `social/DOCKER.md`, `social/DEPLOY.md`,
      `social/cloud-run-job.yaml`, `social/gcs/`, `functions/src/socialTrigger.ts` and its test.
      Check whether the `functions/` workspace still has anything to test; if empty, say so rather
      than leaving a hollow suite.

- [ ] T10: Rewrite `docs/SOCIAL_PILOT.md` §3 — collapse 3.1-3.6 (GCS, Meta app, YouTube OAuth, token
      seeding, Docker, deploy) into a much shorter setup section: three accounts, TikTok on Creator,
      nothing else. Preserve §3.0's account hygiene and the corrected §2 rules. Keep the historical
      record of what was provisioned, marked as no longer required.

- [ ] T11: Rewrite `docs/SOCIAL_PILOT.md` §5 as the real weekly session: render week → upload and
      schedule in three browser tabs → hand-enter last week's numbers → daily follower integer.
      Include the TikTok 10-day window as a hard scheduling constraint and the no-delete-and-repost
      rule (scheduled TikToks cannot be edited, only deleted and re-uploaded — which §2 forbids
      after publish).

- [ ] T12: Correct the post-count arithmetic in the criterion. `plans/Pf39c2-social-pilot-index.md`
      reasons about "~168 posts"; the pilot is 1/day × 3 platforms × 28 days = **84**. The A-or-B
      rule is unchanged — annotate the variance argument, do not restate the criterion.

- [ ] T13: Update `CLAUDE.md`'s Testing section — the social suite count and description change
      substantially once the publish/metrics modules are gone.

## Verify

```bash
npm test                      # pipeline + web unit + social suites
npx tsc --noEmit --project social
```

Plus, for the deletion tasks specifically: `grep -rn "publish/instagram\|publish/youtube\|metrics/collect" --include='*.ts' social/src scripts` returns nothing outside deleted files.
