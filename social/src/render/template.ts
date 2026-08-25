import { ACCENTS, INK, PAPER, type AuthorSlug } from './theme.js';

export interface CardTemplateInput {
	text: string;
	author: AuthorSlug;
	width: number;
	height: number;
	fontSize?: number;
	label?: string;
	/**
	 * Optional `@font-face` CSS (with base64-inlined `src` data URLs) to
	 * inject into the document `<head>`. Kept separate from the template so
	 * `buildCardHtml` itself stays pure and disk/network-free — `card.ts`
	 * reads the font files and passes the resulting CSS in.
	 */
	fontCss?: string;
}

// Outer margin between the frame edge and the content. Exported so `card.ts`
// can derive the same `maxWidth`/`maxHeight` box it hands to `fitFontSize`,
// keeping the estimate and the actual layout in sync.
export const FRAME_PADDING_X = 96;
export const FRAME_PADDING_Y = 140;

// Space reserved above the text box for the label/accent element (its own
// height plus the gap below it). The label always renders (falling back to
// the author's display name), so this is never conditional.
export const LABEL_BLOCK_HEIGHT = 64;

const DEFAULT_FONT_SIZE = 48;
const LINE_HEIGHT_RATIO = 1.45;

export function textBoxWidth(width: number): number {
	return width - FRAME_PADDING_X * 2;
}

export function textBoxHeight(height: number): number {
	return height - FRAME_PADDING_Y * 2 - LABEL_BLOCK_HEIGHT;
}

const AUTHOR_DISPLAY_NAMES: Record<AuthorSlug, string> = {
	epictetus: 'Epictetus',
	'marcus-aurelius': 'Marcus Aurelius',
	seneca: 'Seneca'
};

function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * Pure function returning a self-contained HTML document string for the
 * Playwright renderer to screenshot. No network references (fonts, images,
 * etc. must be inlined or loaded from disk) — any font `@font-face` CSS must
 * be passed in via `input.fontCss` rather than fetched here.
 */
export function buildCardHtml(input: CardTemplateInput): string {
	const { text, author, width, height, fontSize = DEFAULT_FONT_SIZE, label, fontCss = '' } = input;

	const accent = ACCENTS[author];
	const displayLabel = label ?? AUTHOR_DISPLAY_NAMES[author];
	const boxWidth = textBoxWidth(width);
	const boxHeight = textBoxHeight(height);

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
${fontCss}
* {
	margin: 0;
	padding: 0;
	box-sizing: border-box;
}
html, body {
	width: ${width}px;
	height: ${height}px;
	overflow: hidden;
}
body {
	background: ${PAPER};
	-webkit-font-smoothing: antialiased;
	text-rendering: optimizeLegibility;
}
.frame {
	width: ${width}px;
	height: ${height}px;
	background: ${PAPER};
	display: flex;
	flex-direction: column;
	justify-content: center;
	padding: ${FRAME_PADDING_Y}px ${FRAME_PADDING_X}px;
}
.label {
	font-family: 'DM Sans Variable', 'DM Sans', sans-serif;
	font-weight: 700;
	font-size: 20px;
	line-height: 1;
	letter-spacing: 0.08em;
	text-transform: uppercase;
	color: ${accent};
	margin-bottom: ${LABEL_BLOCK_HEIGHT - 20}px;
}
.text-box {
	width: ${boxWidth}px;
	height: ${boxHeight}px;
	overflow: hidden;
	position: relative;
}
.text-content {
	font-family: 'Literata Variable', 'Literata', Georgia, serif;
	font-weight: 400;
	font-size: ${fontSize}px;
	line-height: ${LINE_HEIGHT_RATIO};
	color: ${INK};
	white-space: pre-wrap;
	word-wrap: break-word;
}
</style>
</head>
<body>
<div class="frame">
	<div class="label" id="card-label">${escapeHtml(displayLabel)}</div>
	<div class="text-box" id="text-box">
		<div class="text-content" id="text-content">${escapeHtml(text)}</div>
	</div>
</div>
</body>
</html>
`;
}
