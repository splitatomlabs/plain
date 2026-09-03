import { error, redirect } from '@sveltejs/kit';

// Never prerendered. This route has a side effect on every hit (the click
// log below) and must resolve fresh each request, not be baked in at build
// time — the root `+layout.js` defaults `prerender` to true, so this needs
// an explicit override, the same way `completed/[book]/+layout.js` and
// `[book]/[chapter]/[card]/+layout.js` opt dynamic routes out.
export const prerender = false;

const DESTINATION = 'https://thinkplain.ai/';

// The short public slug (the one that actually appears in a bio link or a
// caption, via `social/src/publish/caption.ts`'s ATTRIBUTION_URLS) mapped to
// the `utm_source` value analytics need. An explicit allowlist rather than a
// passthrough — see the 404 branch below for why.
const PLATFORM_BY_SLUG = {
	ig: 'instagram',
	tt: 'tiktok',
	yt: 'youtube'
};

// The only formats this pilot can produce (`social/src/render/post-metadata.ts`'s
// `PostFormat`). `?f=` may override the default but only to a value on this
// list — never reflected into the redirect URL unchecked, so this endpoint
// can't be used to smuggle an arbitrary `utm_content` value onto a
// thinkplain.ai click.
const KNOWN_FORMATS = ['wall'];
const DEFAULT_FORMAT = 'wall';

export function GET({ params, url }) {
	const platform = PLATFORM_BY_SLUG[params.slug];

	// An unknown slug isn't a real attribution link: every real one is
	// hard-coded to `ig`/`tt`/`yt` in `caption.ts`. Redirecting it anyway would
	// mean either omitting utm_source (silently mixing untracked traffic into
	// the aggregate numbers) or inventing one (actively wrong data) — both are
	// worse than the honest answer, a 404, which also fails loudly if a slug
	// ever gets mistyped in a caption before it ships.
	if (!platform) {
		throw error(404, `Unknown attribution slug: ${params.slug}`);
	}

	const requestedFormat = url.searchParams.get('f');
	const format = KNOWN_FORMATS.includes(requestedFormat) ? requestedFormat : DEFAULT_FORMAT;

	const destination = new URL(DESTINATION);
	destination.searchParams.set('utm_source', platform);
	destination.searchParams.set('utm_medium', 'organic-social');
	destination.searchParams.set('utm_campaign', 'stoic-pilot');
	destination.searchParams.set('utm_content', format);

	// Aggregate-only click log, per docs/ANALYTICS.md: no IP, no user agent, no
	// referer (in-app browsers strip it anyway), no cookie or user identifier
	// of any kind — just which platform's link fired, which format it pointed
	// at, and when. A structured console.log is enough weight for this: Vercel
	// captures function stdout as searchable logs on its own, so no separate
	// logging service or store is needed for a pilot.
	console.log(
		JSON.stringify({
			event: 'attribution_click',
			platform,
			format,
			at: new Date().toISOString()
		})
	);

	// 302, never 301/308: a permanent redirect gets cached by browsers and
	// intermediaries indefinitely, so the destination could never be changed
	// again. `redirect()` from @sveltejs/kit throws rather than returning —
	// `return redirect(...)` would be silently wrong here.
	throw redirect(302, destination.toString());
}
