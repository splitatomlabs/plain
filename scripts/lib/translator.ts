import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { callClaudeJSON } from "./claude.js";
import { VALID_TAG_SLUGS, type BookConfig, type TagSlug } from "./constants.js";
import type { Chunk } from "./chunker.js";
import { buildTranslationPrompt } from "./prompt.js";

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

interface GenerateState {
  bookSlug: string;
  /** Keyed by "chapterSlug:sectionNumber" to avoid collisions when section numbers restart per chapter */
  completed: Record<string, TranslatedChunk>;
}

const STATE_DIR = "output";
const STATE_FILE = (bookSlug: string) =>
  `${STATE_DIR}/generate-state-${bookSlug}.json`;

async function loadState(bookSlug: string): Promise<GenerateState> {
  const file = STATE_FILE(bookSlug);
  if (existsSync(file)) {
    const data = await readFile(file, "utf-8");
    return JSON.parse(data) as GenerateState;
  }
  return { bookSlug, completed: {} };
}

async function saveState(state: GenerateState): Promise<void> {
  await mkdir(STATE_DIR, { recursive: true });
  await writeFile(STATE_FILE(state.bookSlug), JSON.stringify(state, null, 2));
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
  const state = await loadState(config.slug);
  const total = chunks.length;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const textHash = createHash("sha256").update(chunk.text).digest("hex").slice(0, 8);
    const stateKey = `${chapterSlug}:${chunk.sectionNumber}:${textHash}`;

    // Resume: skip already-translated chunks
    if (state.completed[stateKey]) {
      const cached = state.completed[stateKey];
      process.stderr.write(
        `Translating ${i + 1}/${total}: ${chapterSlug} section ${chunk.sectionNumber} (cached)\n`,
      );
      yield cached;
      continue;
    }

    process.stderr.write(
      `Translating ${i + 1}/${total}: ${chapterSlug} section ${chunk.sectionNumber}...\n`,
    );

    const prompt = buildTranslationPrompt(chunk, config);
    let result = await callClaudeJSON<TranslationResponse>(prompt);

    // Validate tags — re-prompt once if invalid
    let validTags = validateTags(result.tags);
    if (validTags.length === 0 && result.tags.length > 0) {
      process.stderr.write(
        `  Invalid tags [${result.tags.join(", ")}], re-prompting...\n`,
      );
      result = await callClaudeJSON<TranslationResponse>(
        prompt +
          `\n\nIMPORTANT: Tags must be from this exact list: ${VALID_TAG_SLUGS.join(", ")}. Your previous response used invalid tags. Try again.`,
      );
      validTags = validateTags(result.tags);
    }

    if (validTags.length === 0) validTags = ["what-really-matters"];
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

    const translated: TranslatedChunk = {
      sectionNumber: chunk.sectionNumber,
      originalText: chunk.text,
      plainEnglish: result.plain_english,
      tags: validTags,
      meaningCheck,
    };

    // Save progress
    state.completed[stateKey] = translated;
    await saveState(state);

    yield translated;
  }
}
