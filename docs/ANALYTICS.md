# Plain — Analytics Approach

## Principles

- Privacy first: no cookies, no user IDs, no cross-site tracking
- Aggregate only: never reconstructable to an individual
- Respect `navigator.doNotTrack`
- Every metric must map to a decision you'd actually make

## Tools

- **Primary:** Umami Cloud (free tier: 100k events/mo; cookieless; custom events included at every tier; GDPR/ePrivacy-friendly — no consent banner required)
- **Never:** Google Analytics, Mixpanel, Segment, Hotjar, session recording tools

## Events

All events are anonymous. Fire from the localStorage progress layer, not UI components.

| Event | Fired when | Properties |
|---|---|---|
| `book_landing_viewed` | Reader views a book's landing page | `book_id` |
| `book_started` | Reader advances past the first card of a book | `book_id`, `is_first_book` (boolean) |
| `first_engagement` | Reader completes 2 cards in their first-ever session (fires once, ever) | none |
| `milestone_reached` | Reader crosses 25%, 50%, 75%, or 100% of a book | `book_id`, `milestone` |
| `book_completed` | Reader reaches 100% of a book | `book_id` |
| `share_clicked` | Reader taps any share button | `type` (`card`/`completion`/`gift`), `book_id` |
| `return_visit` | Reader opens app with existing progress, last visit >24h ago | none |
| `tag_explored` | Reader taps a tag pill | `tag_id` |

## First-Session Funnel

The core measurement. Segment every stage by traffic source.

1. Landing viewed (automatic page view)
2. `book_landing_viewed`
3. `book_started`
4. `first_engagement`
5. `milestone_reached` at 25%
6. `book_completed`

## Key Metrics

- **Funnel drop-off by stage, segmented by traffic source** — the most important view
- **Engagement rate:** `first_engagement` ÷ `book_started` (tests whether card 1 earns card 2)
- **Completion rate per book:** `book_completed` ÷ `book_started`
- **Milestone drop-off curve per book** (identifies problem sections)
- **Return rate:** `return_visit` ÷ unique visitors
- **Share rate:** `share_clicked` per session

## Do Not Track

- Individual card reads or time-on-card
- Scroll depth
- IP addresses or sub-country geolocation
- Any user identifier, hashed or otherwise
- Third-party pixels (Facebook, LinkedIn, Twitter)
- Heatmaps or session recordings

## Implementation Notes

1. Umami script tag injected in `web/src/routes/+layout.svelte` via `<svelte:head>`, gated on `PUBLIC_UMAMI_WEBSITE_ID` (from `$env/static/public`) and `!dev`. Set the env var in Vercel → Settings → Environment Variables for Production + Preview.
2. `web/src/lib/analytics.js` exposes a `trackEvent(name, properties)` wrapper that calls `window.umami?.track(name, properties)`.
3. Fire events from the progress layer when state crosses milestone boundaries.
4. Track first-engagement state in localStorage: `plain:first_engagement_fired` flag (absent until fired, then `'true'`) + `plain:session_card_count` (sessionStorage). Fire `first_engagement` when count reaches 2 and the flag is not yet set; then set the flag to `'true'` permanently.
5. Track `plain:books_started` array for `is_first_book` property.
6. DNT is honoured at the script tag via `data-do-not-track="true"` — Umami drops tracking for visitors with DNT set; no JS-level check needed.
7. `analyticsEnabled = browser && !dev` gates `trackEvent` to exclude local dev; the script tag itself is also omitted in dev.

## Review Cadence

Weekly for the first three months. Fifteen minutes. Check funnel shape and completion rates. Any more frequent is noise.
