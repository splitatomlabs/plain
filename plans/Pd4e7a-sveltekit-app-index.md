# Plain SvelteKit App — Index

## Objective
Implement the full Plain web app as specified in ARCHITECTURE.md, BRANDING.md, CONTENT_STRATEGY.md, and ANALYTICS.md. Responsive mobile-first design, deployed to Vercel free tier.

## Plans
1. `plans/Pd4e7a-sveltekit-app-01.md` — Scaffolding & Design System
   - Status: [x]
2. `plans/Pd4e7a-sveltekit-app-02.md` — Content Layer & Static Pages
   - Status: [x]
   - Depends on: 01
3. `plans/Pd4e7a-sveltekit-app-03.md` — Card Reading Experience
   - Status: [x]
   - Depends on: 02
4. `plans/Pd4e7a-sveltekit-app-04.md` — Progress, Sharing & Analytics
   - Status: [x]
   - Depends on: 03
5. `plans/Pd4e7a-sveltekit-app-05.md` — Accessibility, Visual Regression & Deployment
   - Status: [ ]
   - Depends on: 04

## Notes
- Mobile-first responsive design throughout — swipe nav on mobile, keyboard/click on desktop
- Content: Meditations Books 1–2 have real plain translations in `output/chunks/`. Other books use placeholder cards until content pipeline catches up.
- The SvelteKit app lives in `web/` (e.g., `web/src/`, `web/package.json`) to allow other frontends in sibling folders
- Each plan produces a working, deployable state — no plan leaves the app broken
- All CSS uses custom properties from BRANDING.md design tokens — no hardcoded colors
