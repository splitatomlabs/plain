/**
 * Shared pixel-level no-reflow proof machinery — factored out of
 * `counter.test.ts` (social pilot 02a T11) so `source-head.test.ts` can
 * reuse the exact same mechanism rather than reimplementing a parallel
 * copy. This is the "retarget `counter.test.ts`'s pixel-level proof" the
 * T11 task calls for: the proof itself doesn't change (still "every pixel
 * OUTSIDE a small overlay's own bounding box must be byte-identical
 * between the with/without renders of the same frame"), it's just no
 * longer counter-specific — `assertIdenticalOutsideBoxes` takes a LIST of
 * boxes to exclude, so a test can prove one overlay (the running head)
 * doesn't reflow another (the counter) and vice versa, in the same render.
 *
 * Not a `.test.ts` file itself — no `describe`/`it` here, only the render
 * + comparison helpers both suites call.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { renderStill, selectComposition } from '@remotion/renderer';
import { PNG } from 'pngjs';

export interface PixelBox {
	top: number;
	left: number;
	width: number;
	height: number;
}

export interface DecodedFrame {
	png: PNG;
}

export async function renderFrameAsPng(
	bundleLocation: string,
	id: string,
	inputProps: Record<string, unknown>,
	frame: number
): Promise<DecodedFrame> {
	const composition = await selectComposition({ serveUrl: bundleLocation, id, inputProps });
	const outPath = path.join(os.tmpdir(), `plain-pixel-proof-${id}-${frame}-${Math.random().toString(36).slice(2)}.png`);
	await renderStill({
		composition,
		serveUrl: bundleLocation,
		output: outPath,
		frame,
		inputProps,
		imageFormat: 'png'
	});
	return { png: PNG.sync.read(readFileSync(outPath)) };
}

export function isInsideAnyBox(x: number, y: number, boxes: readonly PixelBox[]): boolean {
	return boxes.some((box) => x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height);
}

/**
 * The structural no-reflow proof: every pixel OUTSIDE every box in `boxes`
 * must be byte-identical between `a` and `b`. Pass every overlay's own
 * bounding box that legitimately differs between the two renders being
 * compared (e.g. `[COUNTER_BOUNDING_BOX]` when only the counter's presence
 * varies, or `[COUNTER_BOUNDING_BOX, SOURCE_HEAD_BOUNDING_BOX]` when both
 * overlays are in play) — anything belonging to the format's own content
 * sits entirely outside all of them, so if either overlay reflowed
 * anything, some such pixel would move or change and this fails.
 */
export function assertIdenticalOutsideBoxes(a: PNG, b: PNG, boxes: readonly PixelBox[]): void {
	if (a.width !== b.width) {
		throw new Error(`Width differs: ${a.width} vs ${b.width}`);
	}
	if (a.height !== b.height) {
		throw new Error(`Height differs: ${a.height} vs ${b.height}`);
	}

	const { width, height } = a;
	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (isInsideAnyBox(x, y, boxes)) continue;
			const idx = (width * y + x) << 2;
			for (let channel = 0; channel < 4; channel++) {
				const av = a.data[idx + channel];
				const bv = b.data[idx + channel];
				if (av !== bv) {
					throw new Error(
						`Pixel outside every excluded box changed at (${x}, ${y}) channel ${channel}: ` +
							`${av} (a) vs ${bv} (b). An overlay reflowed the composition.`
					);
				}
			}
		}
	}
}

/** Proof an overlay actually drew something — the inverse of `assertIdenticalOutsideBoxes`. */
export function assertBoxDiffers(a: PNG, b: PNG, box: PixelBox): void {
	const { width, height } = a;
	for (let y = box.top; y < Math.min(box.top + box.height, height); y++) {
		for (let x = box.left; x < Math.min(box.left + box.width, width); x++) {
			const idx = (width * y + x) << 2;
			for (let channel = 0; channel < 4; channel++) {
				if (a.data[idx + channel] !== b.data[idx + channel]) {
					return;
				}
			}
		}
	}
	throw new Error('Expected the box to draw something, but found no difference between the two renders.');
}

/** Proof a box is byte-identical between two renders — the inverse of `assertBoxDiffers`, scoped to just one box. */
export function assertBoxIdentical(a: PNG, b: PNG, box: PixelBox): void {
	const { width, height } = a;
	for (let y = box.top; y < Math.min(box.top + box.height, height); y++) {
		for (let x = box.left; x < Math.min(box.left + box.width, width); x++) {
			const idx = (width * y + x) << 2;
			for (let channel = 0; channel < 4; channel++) {
				const av = a.data[idx + channel];
				const bv = b.data[idx + channel];
				if (av !== bv) {
					throw new Error(
						`Pixel inside the box changed at (${x}, ${y}) channel ${channel}: ${av} (a) vs ${bv} (b).`
					);
				}
			}
		}
	}
}
