/**
 * Minimal, dependency-free pixel-dimension readers for PNG and JPEG files.
 *
 * These parse the file headers directly rather than pulling in an
 * image-decoding library, per the test task constraints. Used only by
 * `renderer.test.ts` to independently verify what Playwright/sharp wrote to
 * disk, instead of trusting `RenderCardResult.width`/`height` alone.
 */
import { readFileSync } from 'node:fs';

export interface ImageDimensions {
	width: number;
	height: number;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Reads width/height from a PNG's IHDR chunk.
 *
 * Layout: 8-byte signature, then a 4-byte chunk length, 4-byte chunk type
 * ("IHDR"), 4-byte width (offset 16), 4-byte height (offset 20) — all
 * big-endian, per the PNG spec. IHDR is always the first chunk.
 */
export function readPngDimensions(filePath: string): ImageDimensions {
	const buf = readFileSync(filePath);

	if (buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
		throw new Error(`Not a PNG file: ${filePath}`);
	}

	const chunkType = buf.toString('ascii', 12, 16);
	if (chunkType !== 'IHDR') {
		throw new Error(`Expected IHDR as the first chunk in ${filePath}, got "${chunkType}"`);
	}

	const width = buf.readUInt32BE(16);
	const height = buf.readUInt32BE(20);
	return { width, height };
}

// Start-of-frame markers that carry width/height. Excludes 0xC4 (DHT),
// 0xC8 (reserved/JPG extension), and 0xCC (DAC) which share the 0xC0-0xCF
// range but are not SOF markers.
const SOF_MARKERS = new Set([
	0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

// Markers with no payload (length field) following them.
const STANDALONE_MARKERS = new Set([0xd8, 0xd9, 0x01]);
const isRestartMarker = (marker: number) => marker >= 0xd0 && marker <= 0xd7;

/**
 * Reads width/height by walking JPEG markers until it finds an SOF
 * (start-of-frame) segment, per the JFIF/JPEG spec.
 */
export function readJpegDimensions(filePath: string): ImageDimensions {
	const buf = readFileSync(filePath);

	if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) {
		throw new Error(`Not a JPEG file (missing SOI marker): ${filePath}`);
	}

	let offset = 2;
	while (offset < buf.length - 1) {
		if (buf[offset] !== 0xff) {
			offset++;
			continue;
		}

		// Skip 0xFF fill-byte padding before the real marker byte.
		let markerOffset = offset + 1;
		while (buf[markerOffset] === 0xff) {
			markerOffset++;
		}
		const marker = buf[markerOffset];
		offset = markerOffset + 1;

		if (STANDALONE_MARKERS.has(marker) || isRestartMarker(marker)) {
			continue;
		}

		if (marker === 0xda) {
			// Start of scan: compressed data follows, no more markers to read.
			break;
		}

		const segmentLength = buf.readUInt16BE(offset);

		if (SOF_MARKERS.has(marker)) {
			const height = buf.readUInt16BE(offset + 3);
			const width = buf.readUInt16BE(offset + 5);
			return { width, height };
		}

		offset += segmentLength;
	}

	throw new Error(`Could not find an SOF marker in JPEG: ${filePath}`);
}
