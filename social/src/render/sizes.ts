/**
 * Output dimensions for each render target.
 *
 * Instagram FEED media must be JPEG (<=8MB); the 1080x1920 story/video frame
 * is PNG (it also serves as the still frame for the Remotion video pipeline).
 */
export const SIZES = {
	story: { width: 1080, height: 1920 },
	igFeed: { width: 1080, height: 1350 }
} as const;

export type SizeName = keyof typeof SIZES;

/**
 * The output image format for a given render size.
 *
 * Instagram's feed endpoint only accepts JPEG (and must stay <=8MB); every
 * other target (the 1080x1920 story/video frame) is PNG.
 */
export function formatForSize(size: SizeName): 'png' | 'jpeg' {
	return size === 'igFeed' ? 'jpeg' : 'png';
}
