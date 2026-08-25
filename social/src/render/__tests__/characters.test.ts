import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
	CHARACTER_NAMES,
	characterPortraitDataUri,
	characterPortraitPath
} from '../characters.js';
import type { AuthorSlug } from '../theme.js';

const PAPER = '#FAF7F2';

/**
 * Minimal well-formedness check for XML/SVG markup: walks every start/end/self-closing
 * tag and verifies a matching stack, without pulling in an XML parser dependency.
 * Not a full XML validator, but sufficient to catch unclosed or mismatched tags.
 */
function isWellFormedXml(source: string): boolean {
	const tagPattern = /<(\/?)([a-zA-Z][\w:-]*)([^>]*)>/g;
	const stack: string[] = [];
	let match: RegExpExecArray | null;

	while ((match = tagPattern.exec(source)) !== null) {
		const [, closingSlash, tagName, attrs] = match;
		if (tagName === 'xml' || tagName.startsWith('!') || tagName.startsWith('?')) continue;

		const selfClosing = attrs.trim().endsWith('/');
		if (closingSlash) {
			const expected = stack.pop();
			if (expected !== tagName) return false;
		} else if (!selfClosing) {
			stack.push(tagName);
		}
	}

	return stack.length === 0;
}

function extractViewBox(source: string): string | undefined {
	const rootMatch = source.match(/<svg\b[^>]*>/);
	if (!rootMatch) return undefined;
	const viewBoxMatch = rootMatch[0].match(/viewBox="([^"]*)"/);
	return viewBoxMatch?.[1];
}

const characters = [
	{ slug: 'epictetus', accent: '#B5704F', others: ['#5B6E8A', '#6B7F5E'] },
	{ slug: 'marcus-aurelius', accent: '#5B6E8A', others: ['#B5704F', '#6B7F5E'] },
	{ slug: 'seneca', accent: '#6B7F5E', others: ['#B5704F', '#5B6E8A'] },
];

function assetPath(slug: string): string {
	return fileURLToPath(new URL(`../../../assets/characters/${slug}.svg`, import.meta.url));
}

describe('character portraits', () => {
	for (const { slug, accent, others } of characters) {
		describe(slug, () => {
			it('exists as a file', () => {
				expect(existsSync(assetPath(slug))).toBe(true);
			});

			it('parses as well-formed XML with a 1000x1000 viewBox', () => {
				const svg = readFileSync(assetPath(slug), 'utf-8');

				expect(isWellFormedXml(svg)).toBe(true);
				expect(extractViewBox(svg)).toBe('0 0 1000 1000');
			});

			it('contains its own accent colour', () => {
				const svg = readFileSync(assetPath(slug), 'utf-8');
				expect(svg).toContain(accent);
			});

			it('contains the paper background colour', () => {
				const svg = readFileSync(assetPath(slug), 'utf-8');
				expect(svg).toContain(PAPER);
			});

			it('does not contain either of the other two accent colours', () => {
				const svg = readFileSync(assetPath(slug), 'utf-8');
				for (const other of others) {
					expect(svg).not.toContain(other);
				}
			});

			it('has no <image> element and no external href', () => {
				const svg = readFileSync(assetPath(slug), 'utf-8');
				expect(svg).not.toMatch(/<image[\s>]/i);
				expect(svg).not.toMatch(/href\s*=/i);
			});
		});
	}
});

describe('character loader', () => {
	const slugs = characters.map(({ slug }) => slug as AuthorSlug);

	for (const slug of slugs) {
		describe(slug, () => {
			it('resolves characterPortraitPath to an existing file', () => {
				const resolved = characterPortraitPath(slug);
				expect(existsSync(resolved)).toBe(true);
				expect(resolved).toBe(assetPath(slug));
			});

			it('produces a data URI with the expected prefix', () => {
				const dataUri = characterPortraitDataUri(slug);
				expect(dataUri.startsWith('data:image/svg+xml;base64,')).toBe(true);
			});

			it('decodes back to the exact bytes of the file on disk', () => {
				const dataUri = characterPortraitDataUri(slug);
				const base64 = dataUri.slice('data:image/svg+xml;base64,'.length);
				const decoded = Buffer.from(base64, 'base64');
				const onDisk = readFileSync(assetPath(slug));
				expect(decoded.equals(onDisk)).toBe(true);
			});

			it('caches the data URI across repeated calls', () => {
				expect(characterPortraitDataUri(slug)).toBe(characterPortraitDataUri(slug));
			});
		});
	}

	it('has three distinct character names', () => {
		const names = Object.values(CHARACTER_NAMES);
		expect(new Set(names).size).toBe(names.length);
		expect(names.length).toBe(3);
	});

	it('has a name for every author slug used by the portraits', () => {
		for (const slug of slugs) {
			expect(CHARACTER_NAMES[slug]).toBeTruthy();
		}
	});
});
