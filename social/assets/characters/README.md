# Character portraits — asset contract

> **These are PLACEHOLDER portraits, not final art.** `epictetus.svg`,
> `marcus-aurelius.svg` and `seneca.svg` in this directory are hand-authored stand-ins
> committed so the renderer, tests and downstream pipeline can be built and exercised
> now. They will be replaced with real generated portraits later. Every file in this
> directory carries `<!-- PLACEHOLDER ART — not final. See README.md. -->` as its first
> line for exactly this reason. Do not treat their current appearance as approved
> brand art, and do not invest further effort refining them — they are being thrown
> away.

## File contract

Whatever replaces a placeholder — hand-authored, generated, or commissioned — must
satisfy this contract so it drops in without touching any other code:

- **Filenames** are exact and keyed to the repo's author slugs (see
  `social/src/render/theme.ts`'s `AuthorSlug` type): `epictetus.svg`,
  `marcus-aurelius.svg`, `seneca.svg`. No other names, no subdirectories.
- **Square, 1000x1000.** SVG: `viewBox="0 0 1000 1000"` (width/height attributes may
  also be set to `1000`). This is the resolution the automated tests check and the
  resolution templates composite at.
- **Self-contained.** No external references of any kind: no `<image>` elements, no
  `href`/`xlink:href` to files or URLs, no embedded raster data (no base64 `<image>`
  either — the whole file must be vector), no `@font-face` or text that depends on a
  font being installed on the render machine. The renderer must be able to load the
  file with zero network access and zero filesystem lookups beyond this one file.
- **Warm paper ground.** The file must draw Plain's paper background itself — a
  `<rect>` (or equivalent shape) filled `#FAF7F2` covering the full 1000x1000 canvas —
  so the portrait stands alone as a complete image and never depends on being
  composited over a background supplied elsewhere.
- **One accent per character**, present in the file: epictetus `#B5704F`,
  marcus-aurelius `#5B6E8A`, seneca `#6B7F5E`. A file must not contain either of the
  other two characters' accent colours (this is checked automatically — see below).
- **Readable at 100x100.** The portrait must still be identifiable — which character,
  roughly what's going on in the silhouette — when scaled down to a 100x100 thumbnail.
  This is the actual bar; if a design decision doesn't survive that scale-down, it's
  the wrong decision for this asset.

### PNG is an acceptable substitute — with changes

A **PNG at exactly 1000x1000px with a `#FAF7F2` (or visually equivalent warm paper)
background baked in** satisfies this contract as a substitute for SVG, since not every
generation path produces vector output. If a PNG is supplied instead of an SVG:

- Update `social/src/render/__tests__/characters.test.ts`: the well-formed-XML check,
  the `viewBox` check, and the "no external references" check are SVG-specific and
  must be replaced with PNG-appropriate checks (e.g. reading PNG `IHDR` dimensions to
  confirm 1000x1000, and dropping the markup/`href` checks entirely — a raster file has
  no such concept). The accent-colour and paper-colour checks would need to become
  pixel-sampling checks instead of substring checks, since colours are no longer
  literal text in the file.
- Update `social/src/render/characters.ts`: `characterPortraitPath` would resolve a
  `.png` path, and `characterPortraitDataUri` would emit a `data:image/png;base64,...`
  URI instead of `data:image/svg+xml;base64,...`. Everything downstream that consumes
  `characterPortraitDataUri` should keep working unchanged, since it already treats the
  return value as an opaque data URI.

## Art direction brief

This is the brief for whoever generates the real portraits. Keep it intact — it does
not expire when the placeholders are replaced; it's the standard the replacement is
judged against.

- **Non-photoreal, illustrative treatment.** Not a photograph, not a 3D render, not
  photoreal digital painting.
- **NOT grey marble bust on black.** This is the default, overused cliché of this
  entire content niche (Stoic quote accounts, philosophy meme pages) — a white/grey
  marble sculpture rendered against a black or near-black background. Whatever the
  final treatment is, it must be visibly, immediately not that.
- **Plain's warm paper palette.** Ground tone reads as warm paper (`#FAF7F2`), not
  black, not white, not stone-grey.
- **Single accent ink per character**, no gradients, no multi-colour rendering:
  epictetus `#B5704F` (terracotta), marcus-aurelius `#5B6E8A` (indigo),
  seneca `#6B7F5E` (olive). One character, one hue, so the three read as a matched set
  and each is instantly sortable by colour alone.
- **Per-character silhouette cues** — identity must survive as a silhouette/outline,
  since these get used small:
  - **Epictetus (The Slave)** — close-cropped hair, one bare shoulder, the plainest
    figure of the three. No jewellery, no wreath, no rich drapery.
  - **Marcus Aurelius (The Emperor)** — laurel wreath, full beard, draped toga closed
    with a shoulder fibula. The most adorned of the three.
  - **Seneca (The Senator)** — bald domed forehead, clean-shaven, broad latus clavus
    stripe running down the drapery (the mark of senatorial rank).

## Provenance

### Current placeholders (hand-authored SVG)

- **Tool:** Hand-authored SVG. No generative image model, no stock photography, no
  AI-generated assets of any kind. Each file was written directly as SVG markup
  (paths, patterns, strokes, transforms) and rendered/inspected with the Playwright
  browser already installed in this workspace (`social/node_modules/playwright`) to
  verify shape and legibility at both 1000x1000 and 100x100.
- **Date:** 2026-08-25.
- **Licence:** Original work. © Split Atom Labs. All rights reserved — same terms as
  the rest of this repository (no separate open-source licence file exists at the repo
  root; treat as proprietary to the project unless the repo root LICENSE says
  otherwise in the future).
- **Status:** Placeholder — pending replacement per T02 of
  `plans/Pf39c2-social-pilot-02.md`, which is BLOCKED on real portraits being generated
  externally and dropped in.

Construction detail on the current placeholders (silhouette geometry, hatching
pattern, per-character accent/shade values, and the frontal-vs-profile art direction
history) is preserved in git history for this file as of the commit that added this
contract — see `git log -- social/assets/characters/README.md` — since none of it
applies to the replacement art and this file's job is now the contract and the
disclosure trail, not a record of a discarded design.

### Replacement art (to be filled in before it ships)

**Whoever replaces a placeholder must add a new entry here, in this same shape, before
the replacement is merged.** The whole point of this file is the AI-disclosure and
licensing trail — a replacement portrait must not ship without one. Required fields:

- **Tool:** which generative model/service, or which artist/studio, produced the file.
- **Prompt:** the exact prompt(s) used (or a link/reference to a prompt log), if
  generated; or a description of the creative brief given, if commissioned.
- **Date:** when it was produced.
- **Licence:** what licence the output carries, and whether that licence is compatible
  with this repository's terms (see "Current placeholders" above for the repo's
  default terms).

Once a real entry exists here for a character, remove that character's
`<!-- PLACEHOLDER ART -->` comment from its SVG (or, for a PNG, drop the note from
wherever this contract says to record it) and flip
`PORTRAITS_ARE_PLACEHOLDER` to `false` in `social/src/render/characters.ts` once all
three are replaced.
