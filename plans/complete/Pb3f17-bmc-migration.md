# Migrate Ko-fi → Buy Me a Coffee

## Objective
Replace Ko-fi links and copy across the web app with Buy Me a Coffee, and provide profile copy + cover image guidance for buymeacoffee.com/splitatomlabs.plain.

## Decisions
- Rename constant `KOFI_URL` → `BMC_URL` (clearer than leaving a misleading name).
- New URL: `https://buymeacoffee.com/splitatomlabs.plain`
- CTA label: "Buy me a coffee →" (matches platform vernacular; "Donate" is fine too — pick one and stay consistent).
- Cover image: reuse Plain's existing brand assets. Recommend a 1500×500 banner showing a single card on Plain's signature paper background with the wordmark — same visual language as the site so visitors recognise it. If no banner asset exists, this becomes a Split Atom Labs design task tracked separately.
- BMC profile about copy: tighten the user's draft to fit BMC's shorter-form context (no "passion project" filler, lead with what Plain *is*, end with the ask implicitly).

## Files
- `web/src/lib/config.js` — rename `KOFI_URL` → `BMC_URL`, update value.
- `web/src/routes/support/+page.svelte` — update import, meta description, body copy, CTA label.
- `plans/complete/Pc4d8a-menu-about-support.md` — leave (historical record).
- Grep for any other "ko-fi" / "Ko-fi" references and update.

## Constraints
- Don't touch the `complete/` archive content.
- E2e tests may reference the support page CTA text — check before editing.
- Keep tone consistent with `docs/BRANDING.md`.

## Tasks
- [x] T01: Grep for all `ko-fi`, `Ko-fi`, `kofi`, `KOFI` references. Only live files: `web/src/lib/config.js`, `web/src/routes/support/+page.svelte`. Archived plans left untouched.
- [x] T02: E2e tests checked — no "Ko-fi" selectors or text assertions. Completion page links to internal `/support`, not the external URL, so it needs no edit.
- [x] T03: `web/src/lib/config.js` — `KOFI_URL` → `BMC_URL = 'https://buymeacoffee.com/splitatomlabs.plain'`.
- [x] T04: `web/src/routes/support/+page.svelte` — import, meta description, body line, CTA label and href all updated.
- [x] T05: No other live files to update.
- [x] T06: No e2e changes needed.
- [x] T07: `npm test` (208 passing) + `npm run build --prefix web && npm run test:e2e --prefix web` (184 passing).
- [x] T08: BMC about copy + cover image (`/tmp/plain-bmc-cover.png`) delivered above.

## Deliverables (for the BMC profile, not the repo)

### Suggested about copy (BMC profile)

> Plain turns classic works of ancient philosophy into short cards written in plain English. The kind you can actually read, finish, and take something from. It starts with the Stoics: Epictetus, Marcus Aurelius, Seneca. People who faced plagues, political collapse, exile, and the basic problem of how to live a good life in a world they didn't control. They had answers. Those answers still work.
>
> The problem isn't the philosophy. It's the language. The English translations most people pick up are 100+ years old, dense with Victorian phrasing, and full of references that meant something in Rome and mean nothing now. If you've ever opened Marcus Aurelius and put it down twenty pages in, you're not alone.
>
> Plain strips that language away. One idea per card, in plain modern English at roughly an 8th-grade reading level. The original source translation is always one tap away if you want to check it.
>
> I'm Aaron. I run Split Atom Labs with my co-founder, and Plain is a project I felt compelled to build in these chaotic times. How AI gets used is up to the people building with it, and I wanted to point it at something that lifts people up. Something that takes the calm and clarity in these old books and makes them genuinely accessible. I build the pipeline that turns the source texts into cards and shape how it all reads.
>
> Plain is free. No ads, no paywalls, no premium tier, no early access for donors. Every reader gets the same thing. Democratising this knowledge is the whole point. A coffee here covers hosting and the API costs of adding new books. That's it. Thank you for reading.

Why this version:
- Leads with what Plain *is* and the names readers will recognise (Epictetus, Marcus Aurelius, Seneca) before who built it — BMC visitors often arrive cold.
- Pulls in the "philosophy isn't the problem, the language is" framing from the about page — it's the sharpest articulation of why Plain exists.
- Keeps the "felt compelled to build in these turbulent times" line the user wrote, sandwiched between the problem and the donation ask so the motivation lands in context.
- Preserves "every reader gets the same thing" + "democratising this knowledge" from the support page — the most distinctive thing about Plain's stance.
- Ends with the concrete use of funds (hosting + API costs), which is what donors actually want to know, then "thank you for reading" — same sign-off as both site pages, so the voice is consistent.
- Length: ~250 words. BMC profiles can handle this; if it feels long, the third paragraph (the "Plain strips that language away" mechanic paragraph) is the one to cut.

### Cover image brief (1500×500, BMC's banner spec)

Best option: a banner that visually matches the app so returning visitors recognise it instantly.
- **Background:** Plain's signature paper/cream background (same `--color-bg` used on cards).
- **Foreground:** a single mocked-up card — title in serif, one short plain-English line beneath it (e.g. an Epictetus card the user already likes). Card sits left or centre.
- **Wordmark:** "Plain" wordmark in the top-left or right of the banner, small.
- **No stock photography, no marble busts, no Greek columns.** Plain's whole point is that it isn't trying to look ancient.
- **Safe area:** BMC overlays the profile avatar bottom-left, so keep that corner empty.

Fallback if no banner asset exists yet: a flat cream rectangle with just the Plain wordmark centred and a single line beneath — "Classic philosophy in plain English." Quiet, on-brand, ships today.

## Verify
```bash
npm test
npm run build --prefix web && npm run test:e2e --prefix web
```
