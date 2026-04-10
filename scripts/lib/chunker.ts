import type { Section } from "./parser.js";

export interface Chunk {
  /** Original section number from the source text */
  sectionNumber: number;
  /** Cleaned original text (Roman numerals stripped, whitespace normalized) */
  text: string;
}

/**
 * Strip leading Roman numeral prefix from section text.
 * Handles patterns like "I. text...", "XIV. text...", etc.
 */
function stripRomanPrefix(text: string): string {
  return text.replace(/^[IVXLCDMivxlcdm]+\.\s*/, "");
}

/**
 * Strip speaker labels like [_Serenus._] from text.
 */
function stripSpeakerLabels(text: string): string {
  return text.replace(/\[_[A-Za-z]+\._\]\s*/g, "");
}

/**
 * Normalize whitespace: collapse multiple newlines, trim lines, remove
 * page number artifacts like {289}.
 */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\{[\d]+\}/g, "") // Remove page number references like {289}
    .replace(/\n{3,}/g, "\n\n") // Collapse excessive newlines
    .replace(/[ \t]+/g, " ") // Collapse horizontal whitespace
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .trim();
}

/**
 * Process parsed sections into chunks.
 * - Strips Roman numeral prefixes
 * - Strips speaker labels (for Peace of Mind)
 * - Merges fragment sections (< 50 chars) with the next section
 * - Normalizes whitespace
 * - One section = one chunk (no sentence splitting)
 */
export function chunkSections(
  sections: Section[],
  stripSpeakers: boolean = false,
): Chunk[] {
  // First pass: clean text
  const cleaned = sections.map((s) => {
    let text = stripRomanPrefix(s.text);
    if (stripSpeakers) {
      text = stripSpeakerLabels(text);
    }
    text = normalizeWhitespace(text);
    return { sectionNumber: s.number, text };
  });

  // Second pass: merge fragments (< 50 chars) with the following section
  const merged: Chunk[] = [];
  let pendingFragment: Chunk | null = null;

  for (const chunk of cleaned) {
    if (pendingFragment) {
      // Merge pending fragment with this chunk
      merged.push({
        sectionNumber: pendingFragment.sectionNumber,
        text: pendingFragment.text + "\n\n" + chunk.text,
      });
      pendingFragment = null;
    } else if (chunk.text.length < 50) {
      pendingFragment = chunk;
    } else {
      merged.push(chunk);
    }
  }

  // If the last section was a fragment, just add it
  if (pendingFragment) {
    merged.push(pendingFragment);
  }

  return merged;
}
