# Plain — Analytics Approach

## Principles

- Privacy first: no cookies, no user IDs, no cross-site tracking
- Aggregate only: never reconstructable to an individual
- Respect `navigator.doNotTrack`
- Every metric must map to a decision you'd actually make

## Tools

- **Primary:** Vercel Analytics (free, no cookies, integrated with hosting, supports custom events)
- **Optional backup:** Cloudflare Web Analytics (free, unlimited, for basic traffic data)
- **Never:** Google Analytics, Mixpanel, Segment, Hotjar, session recording tools

## Events

All events are anonymous. Fire from the localStorage progress layer, not UI components.

| Event | Fired when | Properties |
|---|---|---|
| `book_landing_viewed` | Reader views a book's landing page | `book_id` |
| `book_started` | Reader advances past the first card of a book | `book_id`, `is_first_book` (boolean) |
| `engaged_session` | Reader completes 2 cards in their first-ever session (fires once, ever) | none |
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
4. `engaged_session`
5. `milestone_reached` at 25%
6. `book_completed`

## Key Metrics

- **Funnel drop-off by stage, segmented by traffic source** — the most important view
- **Engagement rate:** `engaged_session` ÷ `book_started` (tests whether card 1 earns card 2)
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

1. Install `@vercel/analytics`, inject at root layout
2. Create `src/lib/analytics.ts` with a `trackEvent(name, properties)` wrapper
3. Fire events from the progress layer when state crosses milestone boundaries
4. Track first-session state in localStorage: `plain:first_session` flag + `plain:session_card_count`. Fire `engaged_session` when count reaches 2, then flip the flag false permanently
5. Track `plain:books_started` array for `is_first_book` property
6. Skip all tracking if `navigator.doNotTrack === '1'`
7. Gate tracking behind environment check to exclude local dev

## Review Cadence

Weekly for the first three months. Fifteen minutes. Check funnel shape and completion rates. Any more frequent is noise.
