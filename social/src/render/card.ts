import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, type Browser, type Page } from 'playwright';

import type { AuthorSlug } from './theme.js';
import { SIZES, formatForSize, type SizeName } from './sizes.js';
import { fitFontSize } from './fit.js';
import { buildCardHtml, textBoxHeight, textBoxWidth } from './template.js';

export interface RenderCardRequest {
	text: string;
	author: AuthorSlug;
	size: SizeName;
	outPath: string;
	label?: string;
}

export interface RenderCardResult {
	path: string;
	width: number;
	height: number;
	format: 'png' | 'jpeg';
	fontSize: number;
	bytes: number;
}

const MIN_FONT = 20;
const MAX_FONT = 96;

// Keeps a 1080x1350 IG feed frame comfortably under the 8MB cap Instagram
// enforces on feed media, without a visible quality hit at this resolution.
const JPEG_QUALITY = 90;

const moduleDir = path.dirname(fileURLToPath(import.meta.url));

let browserPromise: Promise<Browser> | null = null;

/** Lazily launches a single shared Chromium instance, reused across calls. */
async function getBrowser(): Promise<Browser> {
	if (!browserPromise) {
		browserPromise = chromium.launch({ headless: true });
	}
	return browserPromise;
}

/**
 * Shuts down the shared Chromium instance, if one was launched. Call this
 * when a process (test run, CLI invocation) is done rendering, so it doesn't
 * leave a chromium process running.
 */
export async function closeRenderer(): Promise<void> {
	if (!browserPromise) {
		return;
	}
	const browser = await browserPromise;
	browserPromise = null;
	await browser.close();
}

async function loadFontFileBase64(relativeToNodeModules: string): Promise<string> {
	const absolutePath = path.join(moduleDir, '..', '..', 'node_modules', relativeToNodeModules);
	const buf = await readFile(absolutePath);
	return buf.toString('base64');
}

let fontCssPromise: Promise<string> | null = null;

/**
 * Builds `@font-face` CSS with the Literata and DM Sans variable-font files
 * inlined as base64 data URLs, so the rendered document makes no network
 * requests. Read from disk once per process and cached in module scope.
 */
function getFontCss(): Promise<string> {
	if (!fontCssPromise) {
		fontCssPromise = (async () => {
			const [literataBase64, dmSansBase64] = await Promise.all([
				loadFontFileBase64('@fontsource-variable/literata/files/literata-latin-wght-normal.woff2'),
				loadFontFileBase64('@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2')
			]);

			return `
@font-face {
	font-family: 'Literata Variable';
	font-style: normal;
	font-weight: 100 900;
	src: url(data:font/woff2;base64,${literataBase64}) format('woff2');
}
@font-face {
	font-family: 'DM Sans Variable';
	font-style: normal;
	font-weight: 100 900;
	src: url(data:font/woff2;base64,${dmSansBase64}) format('woff2');
}
`;
		})();
	}
	return fontCssPromise;
}

/** True if the rendered text overflows the visible text box. */
async function textOverflows(page: Page): Promise<boolean> {
	return page.evaluate(() => {
		const box = document.getElementById('text-box');
		const content = document.getElementById('text-content');
		if (!box || !content) {
			return true;
		}
		return content.scrollHeight > box.clientHeight;
	});
}

/**
 * Renders a card to `req.outPath` using Playwright, auto-fitting the font
 * size. `fitFontSize` (see `fit.ts`) supplies a fast starting estimate; this
 * function then measures the real rendered DOM (`scrollHeight` vs the text
 * box's `clientHeight`) and steps the size down until it actually fits, or
 * `minFont` is reached — the estimate is a starting point, not the answer.
 */
export async function renderCard(req: RenderCardRequest): Promise<RenderCardResult> {
	const { text, author, size, outPath, label } = req;
	const { width, height } = SIZES[size];
	const format = formatForSize(size);

	const fontCss = await getFontCss();

	const estimate = fitFontSize(text, {
		maxWidth: textBoxWidth(width),
		maxHeight: textBoxHeight(height),
		minFont: MIN_FONT,
		maxFont: MAX_FONT
	});

	const browser = await getBrowser();
	const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });

	let fontSize = estimate.fontSize;

	try {
		while (true) {
			const html = buildCardHtml({ text, author, width, height, fontSize, label, fontCss });
			await page.setContent(html);
			await page.evaluate(() => document.fonts.ready);

			const overflowing = await textOverflows(page);
			if (!overflowing || fontSize <= MIN_FONT) {
				break;
			}
			fontSize -= 1;
		}
		fontSize = Math.max(fontSize, MIN_FONT);

		const screenshotOptions: Parameters<Page['screenshot']>[0] = {
			path: outPath,
			type: format
		};
		if (format === 'jpeg') {
			screenshotOptions.quality = JPEG_QUALITY;
		}
		await page.screenshot(screenshotOptions);
	} finally {
		await page.close();
	}

	const fileStat = await stat(outPath);

	return {
		path: outPath,
		width,
		height,
		format,
		fontSize,
		bytes: fileStat.size
	};
}
