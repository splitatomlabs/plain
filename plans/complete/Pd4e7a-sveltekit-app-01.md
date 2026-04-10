# Plan 01: Scaffolding & Design System

## Parent
`plans/Pd4e7a-sveltekit-app-index.md`

## Objective
Initialize the SvelteKit project with all dependencies, Vercel adapter, design tokens from BRANDING.md, font loading, light/dark theme toggle, and test tooling config.

## Decisions
- Use `npm create svelte@latest` with skeleton project (no demo app)
- JavaScript (not TypeScript) per ARCHITECTURE.md examples — `.js` files throughout
- CSS custom properties for all design tokens — no CSS framework, no Tailwind
- Self-host fonts via @fontsource (Literata variable + DM Sans variable)
- Theme toggle persists to localStorage key `plain-theme`
- Vitest for unit tests, Playwright for E2E + visual regression
- `prefers-color-scheme` and `prefers-reduced-motion` respected from first render

## Files
All paths relative to `web/`.
- `package.json` — SvelteKit, adapter-vercel, fontsource packages, vitest, playwright
- `svelte.config.js` — Vercel adapter with nodejs22.x, prerender entries
- `vite.config.js` — SvelteKit plugin + Vitest config
- `playwright.config.js` — Playwright setup for E2E and visual tests
- `src/app.html` — Root HTML shell with theme class on `<html>`
- `src/app.css` — All CSS custom properties (colors, typography, spacing) from BRANDING.md
- `src/routes/+layout.svelte` — Root layout: font imports, theme toggle, minimal nav shell
- `src/routes/+layout.js` — Prerender config
- `src/routes/+page.svelte` — Placeholder home page (replaced in Plan 02)
- `static/favicon.ico` — Placeholder or logo asset from `logos/`

## Constraints
- No UI framework or component library — custom CSS only
- All color values from BRANDING.md, never hardcoded in components
- Must pass `prefers-reduced-motion` check — no animations without media query guard
- Touch targets ≥44×44px for all interactive elements
- Fonts loaded with `font-display: swap` to avoid FOIT

## Tasks
- [x] T01: Initialize SvelteKit project in `web/` — Run `npm create svelte@latest web`, select skeleton project. `cd web` and install deps (`@sveltejs/adapter-vercel`, `@fontsource/literata`, `@fontsource-variable/literata`, `@fontsource/dm-sans`, `@fontsource-variable/dm-sans`). Configure `svelte.config.js` with Vercel adapter (nodejs22.x runtime) and prerender entries per ARCHITECTURE.md. Verify `npm run dev` starts cleanly from `web/`.
- [x] T02: Configure test tooling — Install `vitest`, `@testing-library/svelte`, `jsdom`, `@playwright/test`. Create `vite.config.js` with Vitest integration. Create `playwright.config.js` with projects for desktop (1280×720) and mobile (375×812). Add test scripts to `package.json`. Verify `npm run test:unit` and `npx playwright test` run (with no tests yet).
- [x] T03: Create CSS design tokens — Write `src/app.css` with all custom properties from BRANDING.md: light mode colors (background #FAF7F2, surface #FFFFFF, primary text #2C2520, secondary #736B62, tertiary #655F5A, border #E8E2D9, tag-bg #F0EDE8), dark mode colors via `[data-theme="dark"]` selector (background #1A1816, surface #252220, etc.), author accent colors (Epictetus terracotta, Marcus indigo, Seneca olive — both light and dark variants), typography scale (body 18-20px, UI 13-14px, line-height 1.6, max-width 65ch), spacing scale, transition tokens. Include `prefers-color-scheme` media query as fallback. Include `prefers-contrast: more` overrides.
- [x] T04: Set up font loading — Import `@fontsource-variable/literata` and `@fontsource-variable/dm-sans` in root layout. Define font-family custom properties: `--font-body: 'Literata Variable', 'Literata', Georgia, serif` and `--font-ui: 'DM Sans Variable', 'DM Sans', system-ui, sans-serif`. Verify fonts render in browser at correct weights (400 for body, 400/500 for UI).
- [x] T05: Build root layout with theme toggle — Create `src/routes/+layout.svelte`: imports app.css, renders `<header>` with site name "Plain" (in Literata), theme toggle button (sun/moon icon, toggles `data-theme` on `<html>`), `<main>` slot, minimal `<footer>`. Theme toggle reads/writes `plain-theme` in localStorage. On mount, check localStorage then `prefers-color-scheme` for initial theme. Include skip-to-content link for accessibility. All interactive elements have visible focus styles.
- [x] T06: Create `src/app.html` shell — Set `lang="en"`, include meta viewport, meta description, inline script in `<head>` that reads `plain-theme` from localStorage to set `data-theme` attribute before render (prevents flash of wrong theme). Include `%sveltekit.head%` and `%sveltekit.body%` placeholders.
- [x] T07: Add placeholder home page — Create `src/routes/+page.svelte` with the hero text "Three men. Three completely different lives. The same philosophy." styled per BRANDING.md. Create `src/routes/+layout.js` with `export const prerender = true` default. Verify the page renders correctly in both light and dark modes at mobile (375px) and desktop (1280px) widths.
- [x] T08: Smoke test — Run `npm run build` to confirm Vercel adapter produces valid output. Run `npm run preview` and verify the page loads, theme toggle works, fonts render, and no console errors. Manual check: resize between mobile and desktop widths, toggle theme, verify `prefers-reduced-motion` is respected (no transitions when enabled).

## Verify
```bash
cd web && npm run build && npm run preview
cd web && npm run test:unit
cd web && npx playwright test
```
