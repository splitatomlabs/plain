# Plain — Logo Kit

## Font Dependency

All logos use **Literata** (Google Fonts). The font must be installed locally or loaded via Google Fonts for SVGs to render correctly. If unavailable, the logos fall back to Georgia.

Download Literata: https://fonts.google.com/specimen/Literata

---

## Logo Variants

### A. Wordmark (`/wordmark/`)

The primary logo. Just the word "Plain" in Literata.

**Files:**
- `plain-wordmark-light.svg` — dark text for light backgrounds
- `plain-wordmark-dark.svg` — light text for dark backgrounds

**When to use:**
- Navigation bar
- Shared card OG images (small, bottom corner)
- Footer
- Anywhere the logo needs to be present but invisible — the reader's eye should be on the content, not the brand

**When not to use:**
- Hero sections (use D instead)
- Favicon or app icon (too small — use C icon instead)

---

### B. Editorial Rule (`/editorial/`)

The wordmark in spaced capitals with a vertical rule to the left, like a margin line in a printed book.

**Files:**
- `plain-editorial-light.svg` — dark text for light backgrounds
- `plain-editorial-dark.svg` — light text for dark backgrounds

**When to use:**
- Book landing pages (top of page)
- About page
- Print or PDF contexts where the wordmark alone feels too light
- Email headers

**When not to use:**
- Small sizes (the rule becomes invisible below ~24px height)
- Alongside dense content (the spaced caps compete with body text)

---

### C. Fading Card (`/card/`)

A card icon with three text lines that fade from solid to invisible, representing simplification. Paired with the wordmark or used standalone as an icon.

**Files:**
- `plain-card-light.svg` — full logo (icon + wordmark), dark, for light backgrounds
- `plain-card-dark.svg` — full logo (icon + wordmark), light, for dark backgrounds
- `plain-icon-light.svg` — icon only (48×48), dark, for light backgrounds
- `plain-icon-dark.svg` — icon only (48×48), light, for dark backgrounds

**When to use the full logo (icon + wordmark):**
- Contexts where visual recognition matters alongside text (partnerships, press)
- Loading screens
- Empty states ("No books started yet")

**When to use the icon only:**
- Favicon (browser tab)
- Future app icon
- Social media profile avatar
- Anywhere the logo must work at very small sizes without text

---

### D. Struck Through (`/struck/`)

P[hilosoph]lain — the word "philosophy" with everything except "Plain" struck through and faded. The brand story told in a single mark.

**Files:**
- `plain-struck-light.svg` — dark text for light backgrounds
- `plain-struck-dark.svg` — light text for dark backgrounds

**When to use:**
- Homepage hero section
- Marketing materials (LinkedIn posts, social banners)
- Completion share images ("I just read all of Meditations — in plain English")
- Any context where you want to tell the brand story visually
- Presentation slides

**When not to use:**
- Navigation or footer (too complex, too loud)
- Small sizes below ~200px wide (the struck text becomes illegible)
- On top of card content (violates brand rule #1)

---

## Choosing a Variant: Quick Reference

| Context | Variant | Version |
|---|---|---|
| Nav bar | A (Wordmark) | Match current theme |
| Favicon / app icon | C (Icon only) | Match current theme |
| Homepage hero | D (Struck through) | Match current theme |
| Shared card OG image | A (Wordmark) | Light |
| Completion share image | D (Struck through) | Light |
| Book landing page header | B (Editorial) | Match current theme |
| Social media avatar | C (Icon only) | Light |
| Email header | B (Editorial) | Light |
| Loading / empty state | C (Full logo) | Match current theme |
| LinkedIn / marketing | D (Struck through) | Match current theme |

---

## Color Versions

Every variant comes in two versions:

- **Light** (`-light.svg`) — dark marks (#2C2520) for use on light/cream backgrounds
- **Dark** (`-dark.svg`) — light marks (#E8E2D9) for use on dark backgrounds

Never place a light logo on a light background or a dark logo on a dark background. When in doubt, match the user's current theme.

---

## Clear Space

Maintain a minimum clear space around any logo variant equal to the cap height of the letter "P" in the wordmark. No other visual elements should intrude into this space.

---

## What Not to Do

1. Don't change the font. Literata is the brand.
2. Don't add colour to the wordmark. It's always monochrome — warm charcoal or warm cream.
3. Don't add effects (shadows, glows, outlines, gradients).
4. Don't rotate, stretch, or distort.
5. Don't place the logo inside a coloured box or badge.
6. Don't pair with the author accent colours. The logo is neutral — it belongs to the reader, not to any single author.
7. Don't animate the logo. It's still. Like the words on a page.
