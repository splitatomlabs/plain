/**
 * Builds a post caption for a scheduled slot (Pf39c2-social-pilot-03 T07).
 *
 * Cross-cutting constraint (index plan): **"No logo, URL or watermark inside
 * any video frame — branding is caption-and-bio only."** The video itself
 * (see `Wall.tsx`/`SourceHead.tsx`) never renders a URL, so the caption is
 * the ONLY place the attribution link can live. `buildCaption` below is that
 * place, for all three platforms this pilot posts to.
 *
 * Tone constraint (index plan, "Cross-cutting constraints"): "calm, direct,
 * warm-not-soft, second person, never clickbait." That rules out hype copy,
 * emoji-stacking, and engagement-bait ("you won't BELIEVE what Marcus said
 * about..."). The caption below is deliberately plain: the card's own
 * landing line (never rewritten — Constraint 6 in the index plan requires
 * anything presented as the author's words to be verbatim from the card),
 * a factual attribution line naming the author and book (framing text, not
 * attributed to the author, per Constraint 6's ruling), the link, and a
 * small fixed hashtag set. No caption ever calls the reader to action beyond
 * the plain "read it plain" line — no "link in bio!!", no "you need to see
 * this".
 *
 * `#Shorts` is deliberately NOT in `HASHTAGS` — the plan's Constraint says
 * YouTube classifies Shorts automatically from aspect ratio and duration, so
 * a manual `#Shorts` tag in the caption buys nothing.
 *
 * Pure function, no I/O, no `Date.now()`: same `ScheduleSlot` + `platform`
 * always produces the same caption string, matching this workspace's
 * determinism policy (`pilot-config.ts`).
 */

import type { ScheduleSlot } from '../schedule-types.js';

// ---------------------------------------------------------------------------
// Attribution links — T11's redirect slugs (`web/src/routes/go/[slug]/+server.js`)
// ---------------------------------------------------------------------------

export type CaptionPlatform = 'tiktok' | 'instagram' | 'youtube';

/**
 * The T11 attribution redirect for each platform. `/go/<slug>` 302s to
 * `thinkplain.ai` with a `utm_source=<platform>` query string appended
 * server-side — this module only needs to know the slug, never the UTM
 * shape, since the redirect route owns that.
 */
export const ATTRIBUTION_URLS: Record<CaptionPlatform, string> = {
	tiktok: 'https://thinkplain.ai/go/tt',
	instagram: 'https://thinkplain.ai/go/ig',
	youtube: 'https://thinkplain.ai/go/yt'
};

// ---------------------------------------------------------------------------
// Author / book display names
// ---------------------------------------------------------------------------

/**
 * The three authors the pilot's Wall pool ever draws from — kept in sync
 * with `render/theme.ts`'s `ACCENTS` keys (the only other place `AuthorSlug`
 * is enumerated in this workspace). Sentence case, not the all-caps
 * `formatRunningHead` (`remotion/SourceHead.tsx`) uses for its on-screen
 * masthead — a caption is body text, not a book-page header, and shouting
 * caps in a caption reads as hype, which the tone constraint above forbids.
 */
const AUTHOR_DISPLAY_NAMES: Record<string, string> = {
	epictetus: 'Epictetus',
	'marcus-aurelius': 'Marcus Aurelius',
	seneca: 'Seneca'
};

/**
 * Every book slug `scripts/lib/constants.ts`'s `BOOK_CONFIGS` defines, so
 * this stays correct even for a book the pilot hasn't scheduled yet. Not
 * imported from there directly — `social/` is a self-contained npm project
 * (see `schedule-types.ts`'s own header comment for why) — so this is a
 * small, deliberately duplicated mirror of just the titles.
 */
const BOOK_DISPLAY_NAMES: Record<string, string> = {
	enchiridion: 'The Enchiridion',
	meditations: 'Meditations',
	'shortness-of-life': 'On the Shortness of Life',
	'happy-life': 'On the Happy Life',
	'peace-of-mind': 'On Peace of Mind',
	discourses: 'Discourses',
	'on-anger': 'On Anger'
};

/**
 * Falls back to a humanized slug (hyphens to spaces, each word capitalized)
 * for any slug not in the lookup above, rather than throwing — a caption is
 * cosmetic copy, not a correctness-critical path, so an unrecognized future
 * slug should still produce a readable (if slightly awkward) caption instead
 * of failing an entire week's staging run over a missing display-name entry.
 */
function humanizeSlug(slug: string): string {
	return slug
		.split('-')
		.filter(Boolean)
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(' ');
}

function displayAuthorName(authorSlug: string): string {
	return AUTHOR_DISPLAY_NAMES[authorSlug] ?? humanizeSlug(authorSlug);
}

function displayBookTitle(bookSlug: string): string {
	return BOOK_DISPLAY_NAMES[bookSlug] ?? humanizeSlug(bookSlug);
}

// ---------------------------------------------------------------------------
// Hashtags
// ---------------------------------------------------------------------------

/**
 * A small, fixed set — not a trending-tag chase. Deliberately excludes
 * `#Shorts` (see this module's header comment) and anything platform-
 * specific, so the same set is correct on all three platforms.
 */
export const HASHTAGS = '#Stoicism #Philosophy #PlainEnglish';

// ---------------------------------------------------------------------------
// Caption
// ---------------------------------------------------------------------------

export interface BuildCaptionInput {
	slot: ScheduleSlot;
	platform: CaptionPlatform;
}

/**
 * Builds the caption for one scheduled slot on one platform. Body:
 *
 *   <landing line, verbatim from the card>
 *
 *   — <Author>, <Book>
 *
 *   Read it plain: <attribution URL for this platform>
 *
 *   <HASHTAGS>
 *
 * The landing line is the only quoted content and is never altered (it is
 * already the card's own verbatim payoff sentence — see `cli-plan.ts`'s
 * `computeWallPlainLines` doc comment for how the render pipeline treats it
 * the same way). Everything else is framing text: factual, unattributed to
 * the author, per Constraint 6's ruling in the index plan.
 */
/**
 * YouTube's hard limit on a video title. A title over this is rejected by
 * the upload form outright, so `buildYouTubeTitle` degrades below it rather
 * than handing the weekly session a value that cannot be pasted.
 */
export const YOUTUBE_TITLE_MAX_LENGTH = 100;

/**
 * The title for a YouTube Short — a field `buildCaption` does NOT cover,
 * because on YouTube the caption is the DESCRIPTION and the title is a
 * separate required input. Before this existed, `docs/SOCIAL_PILOT.md` 5.3
 * asked for a title with no source at all, leaving it to per-day judgement
 * at upload time.
 *
 *   <landing line, verbatim> — <Author>, <Book>
 *
 * Hook first because the Shorts player truncates a title at roughly 40
 * characters, so the landing line is what a viewer actually reads; the
 * attribution is still indexed for search in full, and search is where a
 * title earns its keep for philosophy (the author's name is the term people
 * actually type).
 *
 * OVERFLOW DEGRADES THE FRAMING, NEVER THE QUOTE. Week 1 day 4 already lands
 * on exactly 100 characters, so the full form does not always fit. When it
 * does not, the book is dropped first, then the author — the landing line is
 * returned verbatim and alone rather than trimmed, because it is the card's
 * own words and Constraint 6 (index plan) requires anything presented as the
 * author's words to be verbatim. A truncated quote would be a misquote.
 *
 * A landing line longer than the limit on its own is returned in full and
 * over the limit, deliberately: silently truncating it here would produce
 * exactly the misquote this function refuses to make, and an over-long value
 * fails loudly and visibly in the upload form where a human can fix it. No
 * scheduled card is anywhere near this — the longest in week 1 is 70
 * characters — and `assertFaithful` (`scripts/lib/schedule.ts`) already
 * governs what a landing line may be.
 */
export function buildYouTubeTitle(slot: ScheduleSlot): string {
	const line = slot.content.landing_line;
	const authorName = displayAuthorName(slot.author_slug);
	const bookTitle = displayBookTitle(slot.book_slug);

	const withBook = `${line} — ${authorName}, ${bookTitle}`;
	if (withBook.length <= YOUTUBE_TITLE_MAX_LENGTH) return withBook;

	const withAuthor = `${line} — ${authorName}`;
	if (withAuthor.length <= YOUTUBE_TITLE_MAX_LENGTH) return withAuthor;

	return line;
}

export function buildCaption({ slot, platform }: BuildCaptionInput): string {
	const authorName = displayAuthorName(slot.author_slug);
	const bookTitle = displayBookTitle(slot.book_slug);
	const attributionUrl = ATTRIBUTION_URLS[platform];

	return [
		slot.content.landing_line,
		'',
		`— ${authorName}, ${bookTitle}`,
		'',
		`Read it plain: ${attributionUrl}`,
		'',
		HASHTAGS
	].join('\n');
}
