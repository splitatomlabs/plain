/**
 * F06 (M2): the read-through's OWN landing-line derivation for The Wall —
 * `selectLandingLine(card) ?? plain_english`, byte-for-byte ported from the
 * root content pipeline's `scripts/lib/premises.ts`.
 *
 * DUPLICATED, NEVER IMPORTED — `social/` is a self-contained npm project
 * (see T01) that does not depend on the root `scripts/` package. This is
 * the one piece of that pipeline's logic the read-through render path
 * actually needs on this side of the boundary:
 * `scripts/lib/schedule.ts`'s read-through wall branch
 * (`tryReadThroughContent`) calls `selectLandingLine(card) ?? card.plain_english`
 * to choose what's shown, and `social/scripts/write-exclusions.ts` needs the
 * EXACT same derivation to survey the read-through slice against the
 * renderer's gate — using a different derivation (e.g. a scored pool's
 * `rubric.chosen_landing_line`) would produce a wrong verdict for some
 * cards (M2's own finding: 5 pool entries compute different frame totals
 * under the two derivations).
 *
 * Keep this file byte-identical in BEHAVIOUR to
 * `scripts/lib/premises.ts`'s `wordCount`/`isSelfContainedOpening`/
 * `sentences`/`hasUnresolvedReference`/`findLandingLines`/`selectLandingLine`
 * (and their private helpers) whenever that file changes — there is no
 * automated check that keeps the two in sync.
 */

// ---------------------------------------------------------------------------
// wordCount / isSelfContainedOpening / sentences
// ---------------------------------------------------------------------------

const SELF_CONTAINED_OPENING_REJECTS = ['But', 'So', 'This', 'It', 'And'] as const;
const OPENER_RE = new RegExp(`^(${SELF_CONTAINED_OPENING_REJECTS.join('|')})\\b`, 'i');

function wordCount(text: string): number {
	return text.trim().split(/\s+/).filter(Boolean).length;
}

function isSelfContainedOpening(text: string): boolean {
	return !OPENER_RE.test(text.trim());
}

function sentences(text: string): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];

	const results: string[] = [];
	let current = '';
	let quoteOpen = false;

	for (let i = 0; i < trimmed.length; i++) {
		const ch = trimmed[i];
		current += ch;

		if (ch === '"') {
			quoteOpen = !quoteOpen;
			continue;
		}

		if (ch === '.' || ch === '!' || ch === '?') {
			const nextChar = trimmed[i + 1];
			if (quoteOpen && nextChar !== '"') {
				continue;
			}
			let j = i + 1;
			while (j < trimmed.length && (trimmed[j] === '"' || trimmed[j] === '.' || trimmed[j] === '!' || trimmed[j] === '?')) {
				if (trimmed[j] === '"') quoteOpen = !quoteOpen;
				current += trimmed[j];
				j++;
			}
			i = j - 1;
			results.push(current.trim());
			current = '';
		}
	}

	if (current.trim()) results.push(current.trim());
	return results.filter(Boolean);
}

// ---------------------------------------------------------------------------
// Landing-line word-count bounds
// ---------------------------------------------------------------------------

const LANDING_LINE_MIN_WORDS = 5;
const LANDING_LINE_MAX_WORDS = 18;

// ---------------------------------------------------------------------------
// hasUnresolvedReference and its helpers
// ---------------------------------------------------------------------------

const LANDING_LINE_REFERENCE_REJECTS = [
	'He',
	'She',
	'They',
	'It',
	'Him',
	'Her',
	'Them',
	'His',
	'Hers',
	'Their',
	'Theirs',
	'Its',
	'Itself',
	'Himself',
	'Herself',
	'Themselves',
	'This',
	'These',
	'Those',
	'That',
	'Such',
	'Who',
	'Whom',
	'Whose',
	'Which'
] as const;

const REFERENCE_WORDS = new Set(LANDING_LINE_REFERENCE_REJECTS.map((w) => w.toLowerCase()));
const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those', 'such']);

const PERSONAL_SINGULAR_PRONOUNS = new Set(['he', 'him', 'his', 'himself', 'she', 'her', 'hers', 'herself', 'it', 'its', 'itself']);
const PERSONAL_PLURAL_PRONOUNS = new Set(['they', 'them', 'their', 'theirs', 'themselves']);
const PERSONAL_PRONOUNS = new Set([...PERSONAL_SINGULAR_PRONOUNS, ...PERSONAL_PLURAL_PRONOUNS]);

const NON_REFERENTIAL_THAT_VERBS = new Set([
	'is',
	'was',
	'are',
	'were',
	'be',
	'been',
	'being',
	'know',
	'knew',
	'knows',
	'think',
	'thought',
	'thinks',
	'believe',
	'believed',
	'believes',
	'say',
	'said',
	'says',
	'feel',
	'felt',
	'feels',
	'hope',
	'hoped',
	'hopes',
	'remember',
	'remembered',
	'remembers',
	'understand',
	'understood',
	'understands',
	'realize',
	'realized',
	'realizes',
	'notice',
	'noticed',
	'notices',
	'admit',
	'admitted',
	'admits',
	'argue',
	'argued',
	'argues',
	'insist',
	'insisted',
	'insists',
	'suppose',
	'supposed',
	'supposes',
	'imagine',
	'imagined',
	'imagines',
	'doubt',
	'doubted',
	'doubts',
	'agree',
	'agreed',
	'agrees',
	'prove',
	'proved',
	'proves',
	'show',
	'showed',
	'shows',
	'claim',
	'claimed',
	'claims',
	'state',
	'stated',
	'states',
	'add',
	'added',
	'adds',
	'note',
	'noted',
	'notes',
	'learn',
	'learned',
	'learns',
	'discover',
	'discovered',
	'discovers',
	'find',
	'found',
	'finds',
	'tell',
	'told',
	'tells',
	'explain',
	'explained',
	'explains',
	'ask',
	'asked',
	'asks',
	'reply',
	'replied',
	'replies',
	'answer',
	'answered',
	'answers',
	'decide',
	'decided',
	'decides',
	'determine',
	'determined',
	'determines',
	'see',
	'saw',
	'sees',
	'hear',
	'heard',
	'hears',
	'mean',
	'meant',
	'means'
]);

const NOT_A_NOUN = new Set([
	...REFERENCE_WORDS,
	'a',
	'an',
	'the',
	'and',
	'or',
	'but',
	'if',
	'when',
	'while',
	'because',
	'as',
	'is',
	'was',
	'are',
	'were',
	'be',
	'been',
	'being',
	'has',
	'have',
	'had',
	'do',
	'does',
	'did',
	'will',
	'would',
	'can',
	'could',
	'should',
	'must',
	'may',
	'might',
	'not',
	'no',
	'yes',
	'to',
	'of',
	'in',
	'on',
	'at',
	'by',
	'for',
	'with',
	'from',
	'about',
	'into',
	'than',
	'then',
	'there',
	'here',
	'you',
	'your',
	'yours',
	'i',
	'me',
	'my',
	'mine',
	'we',
	'us',
	'our',
	'ours'
]);

function stripPunctuation(word: string): string {
	const trimmed = word.replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '');
	return trimmed.replace(/'(s|re|ll|ve|d)$/i, '');
}

function looksLikeNoun(word: string): boolean {
	const clean = stripPunctuation(word);
	if (clean.length < 3) return false;
	return !NOT_A_NOUN.has(clean.toLowerCase());
}

const KNOWN_PLURAL_PROPER_NOUNS = new Set([
	'stoics',
	'cynics',
	'epicureans',
	'peripatetics',
	'romans',
	'greeks',
	'athenians',
	'spartans',
	'persians',
	'trojans',
	'christians',
	'gods'
]);

function isPluralNoun(word: string): boolean {
	const clean = stripPunctuation(word).toLowerCase();
	if (/^[A-Z]/.test(stripPunctuation(word))) {
		return KNOWN_PLURAL_PROPER_NOUNS.has(clean);
	}
	return clean.length >= 4 && clean.endsWith('s') && !clean.endsWith('ss');
}

function looksLikeProperNoun(word: string): boolean {
	const stripped = stripPunctuation(word);
	return stripped.length >= 2 && /^[A-Z]/.test(stripped) && looksLikeNoun(stripped);
}

function isNonReferentialThat(words: string[], index: number): boolean {
	if (index === 0) return false;
	const prevClean = stripPunctuation(words[index - 1]).toLowerCase();
	return NON_REFERENTIAL_THAT_VERBS.has(prevClean);
}

function hasUnresolvedReference(text: string): boolean {
	// Em/en dashes are frequently used with no surrounding whitespace
	// ("love—this is true") as a parenthetical break, not as a hyphen
	// joining a compound word — normalize them to whitespace first so a
	// reference word glued to the previous word by a dash is still seen as
	// its own token.
	const words = text.trim().replace(/[—–]/g, ' ').split(/\s+/);

	for (let i = 0; i < words.length; i++) {
		const clean = stripPunctuation(words[i]).toLowerCase();
		if (!REFERENCE_WORDS.has(clean)) continue;

		if (DEMONSTRATIVES.has(clean)) {
			if (clean === 'that' && isNonReferentialThat(words, i)) continue;
			return true;
		}

		if (PERSONAL_PRONOUNS.has(clean)) {
			const requiredPlural = PERSONAL_PLURAL_PRONOUNS.has(clean);
			const hasAgreeingAntecedent = words
				.slice(1, i) // exclude index 0: sentence-initial capitalization isn't proper-noun evidence
				.some((w) => looksLikeProperNoun(w) && isPluralNoun(w) === requiredPlural);
			if (hasAgreeingAntecedent) continue;
			return true;
		}

		// Relative pronouns (who/whom/whose/which): unchanged behavior — no
		// number-agreement requirement.
		const hasEarlierProperNounAntecedent = words
			.slice(1, i) // exclude index 0: sentence-initial capitalization isn't proper-noun evidence
			.some((w) => looksLikeProperNoun(w));
		if (hasEarlierProperNounAntecedent) continue;

		return true;
	}

	return false;
}

// ---------------------------------------------------------------------------
// findLandingLines / selectLandingLine
// ---------------------------------------------------------------------------

function isCompleteNonQuestion(sentence: string): boolean {
	return /[.!]$/.test(sentence.trim());
}

function hasBalancedQuotes(sentence: string): boolean {
	return (sentence.match(/"/g) ?? []).length % 2 === 0;
}

/**
 * Every sentence of `plainEnglish` that qualifies as a Wall landing line, in
 * document order — see `scripts/lib/premises.ts`'s `findLandingLines` for
 * the full rule set this ports verbatim.
 */
export function findLandingLines(plainEnglish: string): string[] {
	return sentences(plainEnglish).filter((sentence) => {
		if (!isCompleteNonQuestion(sentence)) return false;
		if (sentence.startsWith('"')) return false;
		if (!hasBalancedQuotes(sentence)) return false;
		const wc = wordCount(sentence);
		if (wc < LANDING_LINE_MIN_WORDS || wc > LANDING_LINE_MAX_WORDS) return false;
		if (!isSelfContainedOpening(sentence)) return false;
		if (hasUnresolvedReference(sentence)) return false;
		return true;
	});
}

/**
 * `scripts/lib/premises.ts`'s `selectLandingLine`, ported: the LAST
 * qualifying sentence of `plainEnglish`, or `null` when none qualifies.
 * Callers apply the same `?? plainEnglish` fallback the read-through does
 * (`scripts/lib/schedule.ts`'s `tryReadThroughContent`) — this function
 * deliberately mirrors `selectLandingLine(card)`'s own `string | null`
 * return, not the fallback, so a caller (e.g. a test comparing against the
 * mechanical `null` case) can tell the two apart.
 */
export function selectLandingLine(plainEnglish: string): string | null {
	const candidates = findLandingLines(plainEnglish);
	return candidates.length ? candidates[candidates.length - 1] : null;
}
