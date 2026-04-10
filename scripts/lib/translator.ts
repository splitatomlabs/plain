import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { callClaudeJSON } from "./claude.js";
import { VALID_TAG_SLUGS, type BookConfig, type TagSlug } from "./constants.js";
import type { Chunk } from "./chunker.js";
import { buildTranslationPrompt } from "./prompt.js";

export interface TranslatedChunk {
  sectionNumber: number;
  originalText: string;
  plainEnglish: string;
  tags: TagSlug[];
}

interface TranslationResponse {
  plain_english: string;
  tags: string[];
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
    const stateKey = `${chapterSlug}:${chunk.sectionNumber}`;

    // Resume: skip already-translated chunks
    if (state.completed[stateKey]) {
      const cached = state.completed[stateKey];
      process.stderr.write(
        `Translating chunk ${i + 1}/${total}: ${chapterSlug} section ${chunk.sectionNumber} (cached)\n`,
      );
      yield cached;
      continue;
    }

    process.stderr.write(
      `Translating chunk ${i + 1}/${total}: ${config.slug} section ${chunk.sectionNumber}...\n`,
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

    // Fallback: assign at least one generic tag
    if (validTags.length === 0) {
      validTags = ["what-really-matters"];
    }

    // Cap at 3 tags
    if (validTags.length > 3) {
      validTags = validTags.slice(0, 3);
    }

    const translated: TranslatedChunk = {
      sectionNumber: chunk.sectionNumber,
      originalText: chunk.text,
      plainEnglish: result.plain_english,
      tags: validTags,
    };

    // Save progress
    state.completed[stateKey] = translated;
    await saveState(state);

    yield translated;
  }
}
