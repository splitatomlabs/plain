/**
 * Builds the wall's SCROLLING BLOCK from the surrounding CHAPTER, not just
 * the single card — social pilot 02a's central geometry fix (see
 * `plans/Pf39c2-social-pilot-02a.md`, "the wall is sourced from the
 * CHAPTER, not the card" and its "CONSTRAINT 6 AMENDMENT").
 *
 * The block starts at the target card's own verbatim `original_excerpt`,
 * continues with the FOLLOWING cards of the same chapter (same `book_slug`
 * AND `chapter_slug`) in `card_number` order, and wraps to the chapter's own
 * first card once it reaches the chapter's end — one full lap of the
 * chapter, reordered to start at the target card, never crossing into
 * another chapter or book. Every word in the block is a verbatim substring
 * of some card's `original_excerpt` — no fabrication, no paraphrase, no
 * reordering WITHIN an excerpt.
 *
 * social pilot 02a REVIEW R02 (2026-08-26): T08's own justification for
 * deleting the travel-floor gate ("chapters hold 2,196-3,305 words, the
 * constraint stops binding entirely") was measured against Meditations
 * ONLY — the read-through slice every T05-T09 test used. Across the real
 * corpus, chapter length varies by two orders of magnitude: Enchiridion's
 * 51 chapters median just 94 words (min 24), a fraction of the ~412 words
 * the wall's fixed 44px/4.5-lines-per-second scroll needs to outrun its
 * 2.5s hard cut (`wall-timing.ts`'s `WALL_SCROLL_RATE_PX_PER_SEC` doc
 * comment). A SINGLE lap of a short chapter (this function's pre-R02
 * behaviour) left 53 of 685 non-excluded Wall pool entries finishing their
 * scroll before the cut at offset 0, 25 more at T18's own worst-case
 * mid-chapter offset — the wall goes still, showing blank paper under a
 * floating running head, for 11% of the real pool.
 *
 * THE FIX: repeat the one-lap sequence above, in its entirety, as many
 * times as needed for the block to clear the travel floor even after T18's
 * worst-case offset (`excerptWordCount - 1` words trimmed off the very
 * front) — see `repeatLapUntilTravelFloorClears` below. This was chosen
 * over restoring a gate axis fed the chapter block (the plan's other
 * option) because that alternative's cost was measured directly and found
 * severe: Enchiridion's median chapter (94 words) doesn't clear the floor
 * even at ONE lap, so gating on a single lap would have rejected roughly
 * that book's whole Wall pool outright, not just its short tail. Repeating
 * is cheap by comparison — measured across the whole non-excluded pool
 * (685 entries), the worst case needs only 6 laps (median 1, i.e. most
 * chapters already clear the floor unmodified) even at T18's worst-case
 * offset, and repeating a verbatim chapter is not a new KIND of thing this
 * function does — the pre-R02 code already wraps from the chapter's last
 * card back to its first once per lap; this only continues wrapping past
 * that same seam instead of stopping after one revolution. The text stays
 * exactly as verbatim as before: the block is still nothing but
 * `original_excerpt` fields, in chapter order, repeated whole — no
 * fabrication, no padding, no truncation.
 *
 * On the visibility of the repeat: at the wall's scroll rate (~1,900wpm,
 * ~7.5x normal reading pace), nobody reads far enough into a 2.5s wall to
 * consciously notice a chapter looping back on itself — the repeat is only
 * ever inspectable by pausing the render frame by frame, the same way the
 * chapter's own single-lap wrap-around seam (already present pre-R02) is.
 * A short chapter's wall necessarily shows the same short passage's texture
 * more than once in that case; it never shows a blank frame instead.
 */
import { loadBookCards } from '../remotion/wall-pool.js';
import { computeWallLayout, FRAME_HEIGHT, WALL_SCROLL_RATE_PX_PER_SEC, WALL_SECONDS, splitWords } from '../remotion/wall-timing.js';

/**
 * The subset of `wall-pool.ts`'s `OutputCard` this module actually needs,
 * named separately so a synthetic test fixture (`chapter-text.test.ts`'s own
 * wrap-around cases) doesn't have to fabricate every field `OutputCard`'s
 * index signature allows.
 */
export interface ChapterTextCard {
	id: string;
	book_slug: string;
	chapter_slug: string;
	card_number: number;
	original_excerpt: string;
}

/**
 * The never-finishes travel floor, in px — the block's wrapped height must
 * exceed this for the wall's scroll to still be travelling (not have
 * reached its own bottom edge) when `WALL_SECONDS`' hard cut lands.
 * Re-derived here from `wall-timing.ts`'s own constants (not imported as a
 * single value) so this module and `wall-timing.test.ts`/
 * `chapter-text.test.ts` can never silently disagree about what the floor
 * IS, only ever about whether a given block clears it — mirrors
 * `chapter-text.test.ts`'s own independent re-derivation (`TRAVEL_FLOOR_PX`).
 */
const WALL_TRAVEL_FLOOR_PX = FRAME_HEIGHT + WALL_SCROLL_RATE_PX_PER_SEC * WALL_SECONDS;

/**
 * Defensive-only cap on lap repeats. Mathematically, repeating always
 * converges: `removeWorstCaseOffset` below only ever trims words off the
 * FIRST lap (by construction, at most `excerptWordCount - 1` of them,
 * leaving at least one word of that first lap's own text), so every
 * SUBSEQUENT full lap appended keeps adding its whole, untrimmed height —
 * for any chapter with at least one non-empty excerpt, some finite number
 * of laps clears the floor. Measured directly across the whole real,
 * non-excluded Wall pool (685 entries, R02): worst case needs 6 laps. 100
 * is not a "just in case" tuning knob but a loud failure mode should some
 * future corpus edit produce a chapter this can't converge for (e.g. an
 * accidentally-empty `original_excerpt`) — `buildChapterTextBlock` throws
 * rather than silently shipping a block that still doesn't clear the floor.
 */
const MAX_LAP_REPEATS = 100;

/**
 * Returns `text` with the first `wordCount` whitespace-delimited words
 * removed — the same word-boundary-only trimming `applyChapterEntryOffset`
 * (below) performs on a real block, factored out so both that function and
 * `repeatLapUntilTravelFloorClears`'s worst-case simulation use identical
 * word-boundary semantics rather than two regexes that could drift apart.
 */
function removeLeadingWords(text: string, wordCount: number): string {
	if (wordCount <= 0) {
		return text;
	}
	const words = [...text.matchAll(/\S+/g)];
	const startIndex = words[wordCount]?.index;
	return startIndex === undefined ? '' : text.slice(startIndex);
}

/**
 * Repeats `lapText` (already one full, chapter-ordered lap starting at the
 * target card) whole-lap by whole-lap until the result clears
 * `WALL_TRAVEL_FLOOR_PX` even after T18's worst-case mid-chapter offset —
 * up to `worstCaseOffsetWords` (`excerptWordCount - 1`) words trimmed off
 * the very front, simulated here with `removeLeadingWords` rather than
 * `applyChapterEntryOffset` itself (that function operates on a whole block
 * string and doesn't know about repeats-in-progress; the trimming semantics
 * are identical either way since the offset never exceeds the target
 * excerpt's own length, which is always the block's first paragraph
 * regardless of how many laps follow it).
 */
function repeatLapUntilTravelFloorClears(lapText: string, worstCaseOffsetWords: number): string {
	const clears = (block: string) =>
		computeWallLayout(removeLeadingWords(block, worstCaseOffsetWords)).blockHeight > WALL_TRAVEL_FLOOR_PX;

	let repeats = 1;
	let block = lapText;
	while (!clears(block) && repeats < MAX_LAP_REPEATS) {
		repeats++;
		block = Array.from({ length: repeats }, () => lapText).join('\n\n');
	}

	if (!clears(block)) {
		throw new Error(
			`buildChapterTextBlock: still short of the ${WALL_TRAVEL_FLOOR_PX.toFixed(1)}px travel floor after ` +
				`${MAX_LAP_REPEATS} repeated laps — this chapter cannot be made to clear the never-finishes ` +
				'invariant by repetition alone (likely an empty or near-empty original_excerpt somewhere in the ' +
				'chapter); investigate before rendering this card as a Wall.'
		);
	}

	return block;
}

/**
 * Builds the verbatim scrolling block for `targetCardId`. `bookCards` may
 * contain cards from other chapters or even other books (e.g. a whole
 * book's cards, as `wall-pool.ts`'s `loadBookCards` returns) — this function
 * is responsible for filtering to the target card's own chapter internally
 * (`content/output/`'s `book_slug` + `chapter_slug`), never drawing text
 * from anywhere else.
 *
 * R02: the returned block always clears `WALL_TRAVEL_FLOOR_PX` — see the
 * module-level doc comment above for why (a short chapter's one-lap
 * sequence is repeated whole as many times as needed, never padded,
 * fabricated, or truncated).
 */
export function buildChapterTextBlock(targetCardId: string, bookCards: ChapterTextCard[]): string {
	const targetCard = bookCards.find((c) => c.id === targetCardId);
	if (!targetCard) {
		throw new Error(`buildChapterTextBlock: no card with id "${targetCardId}" in the given cards.`);
	}

	const chapterCards = bookCards
		.filter((c) => c.book_slug === targetCard.book_slug && c.chapter_slug === targetCard.chapter_slug)
		.sort((a, b) => a.card_number - b.card_number);

	const targetIndex = chapterCards.findIndex((c) => c.id === targetCardId);
	const lap = [...chapterCards.slice(targetIndex), ...chapterCards.slice(0, targetIndex)];
	const lapText = lap.map((c) => c.original_excerpt).join('\n\n');

	// T18's mid-chapter entry (`applyChapterEntryOffset`, below) can trim at
	// most `excerptWordCount - 1` words off the target card's own excerpt —
	// the block's own first "paragraph" — regardless of how many laps
	// follow it. Simulate that worst case here so the block this function
	// RETURNS already clears the floor under it, not just at offset 0.
	const worstCaseOffsetWords = Math.max(0, splitWords(targetCard.original_excerpt).length - 1);

	return repeatLapUntilTravelFloorClears(lapText, worstCaseOffsetWords);
}

/**
 * Disk-backed convenience: loads every card of `bookSlug` from
 * `content/output/` (via `wall-pool.ts`'s `loadBookCards`) and hands them to
 * `buildChapterTextBlock` for `cardId`.
 */
export function loadChapterTextBlock(bookSlug: string, cardId: string, outputDir?: string): string {
	const bookCards = loadBookCards(bookSlug, outputDir);
	return buildChapterTextBlock(cardId, bookCards);
}

// ---------------------------------------------------------------------------
// Mid-chapter entry (social pilot 02a T18) — varying frame 0's start point
// within the chapter block so consecutive posts don't open on the same beat.
//
// DESIGN DECISION (T18 was left open by the plan on exactly this point): the
// block above still ALWAYS starts at the target card's own `original_excerpt`
// (T05/T06 unchanged, not reopened here) — what varies is where WITHIN that
// same block a given post's render starts READING from. Concretely, the
// offset is bounded to the target card's own excerpt (never past it, into
// the following cards' text) — the entry point moves to a different WORD of
// the card's own passage, never past it. Two things this buys, both required
// by the plan's own "IMPORTANT TENSION" framing:
//   1. Honesty: whatever a given post's frame 0 shows is still, word for
//      word, drawn from the target card's OWN excerpt — never another
//      card's — so the wall stays recognisably "this card's passage",
//      exactly as its plain-English payoff is about to claim.
//   2. The never-finishes invariant becomes trivial to hold at every offset:
//      the offset can consume at most `excerptWordCount - 1` words off the
//      FRONT of a chapter block that's already an order of magnitude longer
//      than the ~412-word travel floor (`wall-timing.ts`'s
//      `WALL_SCROLL_RATE_PX_PER_SEC` doc comment) — the remaining block after
//      the offset is shortened by, at most, one card's own excerpt length,
//      never by a meaningful fraction of the chapter. (Verified directly,
//      not just argued, in `chapter-text.test.ts`'s "every slice card clears
//      the travel requirement at its own worst-case offset" case.)
//
// The alternative this rejects — starting the BLOCK itself somewhere else in
// the chapter (a different card's excerpt at the very front) — was rejected
// because it can skip the target card's own excerpt out of the visible wall
// entirely, breaking the "the viewer sees the card's own passage during the
// wall" requirement outright, not just weakening it.
// ---------------------------------------------------------------------------

/**
 * The deterministic word offset (into the target card's own excerpt — see
 * the module-level "mid-chapter entry" comment above) for a given
 * `postIndex` (`cli-plan.ts`'s `postIndexForDay` — the same deterministic,
 * date-derived integer already used to seed the music bed, NEVER
 * `Date.now()` or `Math.random()`). Pure arithmetic, no I/O, so it's cheap to
 * exhaustively test.
 *
 * `postIndex` increments by exactly 1 per scheduled day (Pf39c2-social-pilot-
 * 02a D02 collapsed each day to a single Wall slot — `postIndexForDay` =
 * `(week-1)*7 + (day-1)`), so consecutive posts get consecutive offsets
 * modulo `excerptWordCount` — a different word almost every time, cycling
 * back only once `excerptWordCount` posts have gone by.
 * `((postIndex % excerptWordCount) + excerptWordCount) % excerptWordCount`
 * rather than a bare `%` so a hypothetical negative `postIndex` (not
 * produced by `postIndexForDay` today, but this function makes no
 * assumption about its caller) still lands in range rather than returning a
 * negative array index to `applyChapterEntryOffset` below.
 *
 * Returns 0 (no offset — frame 0 opens exactly at the excerpt's own first
 * word, the pre-T18 behaviour) for any excerpt with fewer than 2 words:
 * there is no interior word boundary to enter on, and offsetting by 0 words
 * is never wrong, just not varied.
 */
export function chapterEntryOffsetWords(postIndex: number, excerptWordCount: number): number {
	if (excerptWordCount < 2) {
		return 0;
	}
	return ((postIndex % excerptWordCount) + excerptWordCount) % excerptWordCount;
}

/**
 * Applies T18's mid-chapter entry to a chapter block already built by
 * `buildChapterTextBlock`/`loadChapterTextBlock`: returns the SUFFIX of
 * `chapterBlock` starting at the `chapterEntryOffsetWords(postIndex, ...)`-th
 * word of the target card's own excerpt (the block's own first "paragraph" —
 * see `buildChapterTextBlock`'s `\n\n`-joined shape, and the guard below for
 * the single-card-chapter case where there is no `\n\n` at all). Never
 * mutates the text itself — no fabrication, no reordering, no truncation of
 * words — it only moves WHERE the returned string starts, always exactly on
 * a word boundary (`\S+` token starts), so a caller can never open on half a
 * word.
 *
 * `Wall.tsx` itself is unchanged by this: it still renders whatever string
 * `chapterBlock` prop it's given starting at scroll offset 0 (frame 0's
 * scroll offset is exactly 0 by construction — see `wallScrollOffsetAtFrame`
 * in `wall-timing.ts`), so the "frame 0 shows this string's own first words
 * at the top of the frame" contract T09 established stays literally true —
 * this function only changes WHICH string that is, one layer up
 * (`cli.ts`'s `buildRenderPlan`), never how the Wall composition scrolls.
 */
export function applyChapterEntryOffset(chapterBlock: string, postIndex: number): string {
	const paragraphBreak = chapterBlock.indexOf('\n\n');
	const targetExcerpt = paragraphBreak === -1 ? chapterBlock : chapterBlock.slice(0, paragraphBreak);

	const words = [...targetExcerpt.matchAll(/\S+/g)];
	const offsetWords = chapterEntryOffsetWords(postIndex, words.length);
	if (offsetWords === 0) {
		return chapterBlock;
	}

	const startIndex = words[offsetWords]?.index;
	if (startIndex === undefined) {
		// Defensive only — chapterEntryOffsetWords is bounded to
		// [0, words.length - 1] by construction, so this can't happen for any
		// real caller. Falling back to the unmodified block (rather than
		// throwing) keeps this function total.
		return chapterBlock;
	}
	return chapterBlock.slice(startIndex);
}
