import { callClaudeJSON } from "./claude.js";
import { VALID_TAG_SLUGS, type BookConfig, type TagSlug } from "./constants.js";
import type { Chunk } from "./chunker.js";
import { buildTranslationSystem, buildTranslationUser } from "./prompt.js";

export interface MeaningCheck {
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  verification_notes?: string;
}

export interface TranslatedChunk {
  sectionNumber: number;
  originalText: string;
  plainEnglish: string;
  tags: TagSlug[];
  meaningCheck?: MeaningCheck;
}

interface TranslationResponse {
  plain_english: string;
  tags: string[];
  faithful: boolean;
  tone_preserved: boolean;
  ideas_changed: boolean;
  over_explains: boolean;
  verification_notes?: string | null;
}

function validateTags(tags: string[]): TagSlug[] {
  return tags.filter((t): t is TagSlug =>
    VALID_TAG_SLUGS.includes(t as TagSlug),
  );
}

export async function* translateChunks(
  chunks: Chunk[],
  config: BookConfig,
  chapterSlug: string,
): AsyncGenerator<TranslatedChunk> {
  const total = chunks.length;
  const system = buildTranslationSystem(config);

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    process.stderr.write(
      `Translating ${i + 1}/${total}: ${chapterSlug} section ${chunk.sectionNumber}...\n`,
    );

    const prompt = buildTranslationUser(chunk);
    let result = await callClaudeJSON<TranslationResponse>(prompt, undefined, { system });

    // Validate tags — re-prompt once if invalid
    let validTags = validateTags(result.tags);
    if (validTags.length === 0 && result.tags.length > 0) {
      process.stderr.write(
        `  Invalid tags [${result.tags.join(", ")}], re-prompting...\n`,
      );
      result = await callClaudeJSON<TranslationResponse>(
        prompt +
          `\n\nIMPORTANT: Tags must be from this exact list: ${VALID_TAG_SLUGS.join(", ")}. Your previous response used invalid tags. Try again.`,
        undefined,
        { system },
      );
      validTags = validateTags(result.tags);
    }

    if (validTags.length === 0) validTags = ["what-matters-most"];
    if (validTags.length > 3) validTags = validTags.slice(0, 3);

    // Report meaning check results
    const meaningCheck: MeaningCheck = {
      faithful: result.faithful,
      tone_preserved: result.tone_preserved,
      ideas_changed: result.ideas_changed,
      over_explains: result.over_explains,
      verification_notes: result.verification_notes ?? undefined,
    };

    if (!meaningCheck.faithful) {
      process.stderr.write(
        `  WARNING: Meaning not preserved. ${meaningCheck.verification_notes ?? ""}\n`,
      );
    }
    if (!meaningCheck.tone_preserved) {
      process.stderr.write(
        `  WARNING: Tone drift. ${meaningCheck.verification_notes ?? ""}\n`,
      );
    }
    if (meaningCheck.ideas_changed) {
      process.stderr.write(
        `  WARNING: Ideas changed. ${meaningCheck.verification_notes ?? ""}\n`,
      );
    }
    if (meaningCheck.over_explains) {
      process.stderr.write(
        `  INFO: Over-explains. ${meaningCheck.verification_notes ?? ""}\n`,
      );
    }

    yield {
      sectionNumber: chunk.sectionNumber,
      originalText: chunk.text,
      plainEnglish: result.plain_english,
      tags: validTags,
      meaningCheck,
    };
  }
}
