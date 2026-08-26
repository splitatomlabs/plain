/**
 * The minimal per-post metadata sidecar — a machine-readable record written
 * beside every rendered asset so it can correlate a rendered file back to
 * the card/format that produced it without re-parsing filenames.
 *
 * This is deliberately the SMALLEST writer that satisfies that need: one
 * shape, one write function. T18's render CLI is the first real caller —
 * it decides the output path and passes a caller-supplied `rendered_at`.
 */

import { writeFile } from 'node:fs/promises';

/**
 * Mirrors `scripts/lib/schedule.ts`'s `RenderedFormat` union
 * (`"wall" | "question" | "objection" | "still"`) — kept as a local literal
 * type rather than an import, since `social/` is a self-contained npm
 * project (see T01) and does not depend on the root content-pipeline
 * package. `"still"` (F19) is the read-through's fallback format — see
 * `../remotion/Still.tsx`.
 */
export type PostFormat = 'wall' | 'question' | 'objection' | 'still';

export interface PostMetadata {
	card_id: string;
	format: PostFormat;
	/**
	 * ISO 8601, e.g. `"2026-09-01T00:00:00.000Z"`. ALWAYS caller-supplied —
	 * NEVER read from the system clock at write time — because this
	 * pipeline is deterministic by policy (see
	 * `scripts/generate-schedule.ts` and `scripts/review-week.ts --date`):
	 * re-running a render for the same day must reproduce the same
	 * metadata, not a fresh wall-clock timestamp.
	 */
	rendered_at: string;
}

/**
 * The conventional metadata sidecar path for a rendered asset:
 * `.../wall-2026-09-01-slot1.mp4` -> `.../wall-2026-09-01-slot1.json`.
 * Swaps only the extension, so the sidecar always sits BESIDE the asset it
 * describes.
 */
export function postMetadataPathFor(assetPath: string): string {
	return assetPath.replace(/\.[^./\\]+$/, '.json');
}

/**
 * Writes `metadata` as JSON to `outPath` — normally
 * `postMetadataPathFor(<the rendered asset's path>)`. Pure serialization;
 * this function does not derive, default, or validate any field — the
 * caller (T18's CLI) is the one place that knows the real card id, format
 * and render date.
 */
export async function writePostMetadata(outPath: string, metadata: PostMetadata): Promise<void> {
	await writeFile(outPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf-8');
}
