import { describe, it, expect } from "vitest";
import { BOOK_CONFIGS } from "../constants.js";
import {
  buildTranslationPrompt,
  buildTranslationSystem,
  buildTranslationUser,
} from "../prompt.js";

const enchiridion = BOOK_CONFIGS.find((b) => b.slug === "enchiridion")!;
const meditations = BOOK_CONFIGS.find((b) => b.slug === "meditations")!;
const senecaBook = BOOK_CONFIGS.find((b) => b.slug === "shortness-of-life")!;

const sampleChunk = { sectionNumber: 5, text: "Some original text here." };

describe("buildTranslationSystem", () => {
  it("includes voice guidance for the author", () => {
    const system = buildTranslationSystem(enchiridion);
    expect(system).toContain("Epictetus");
    expect(system).toContain("direct, instructional, and blunt");
  });

  it("includes rules and tag list", () => {
    const system = buildTranslationSystem(enchiridion);
    expect(system).toContain("Flesch-Kincaid Grade Level 7-8");
    expect(system).toContain("calm-your-mind");
    expect(system).toContain("what-really-matters");
  });

  it("includes author-specific examples", () => {
    const system = buildTranslationSystem(enchiridion);
    expect(system).toContain("EXAMPLE 1:");
    expect(system).toContain("There are things which are within our power");
  });

  it("includes JSON response schema", () => {
    const system = buildTranslationSystem(enchiridion);
    expect(system).toContain('"plain_english"');
    expect(system).toContain('"tags"');
    expect(system).toContain('"faithful"');
  });

  it("does not include per-chunk original text", () => {
    const system = buildTranslationSystem(enchiridion);
    expect(system).not.toContain("Some original text here");
  });

  it("varies by author", () => {
    const epictetus = buildTranslationSystem(enchiridion);
    const marcus = buildTranslationSystem(meditations);
    const seneca = buildTranslationSystem(senecaBook);

    expect(epictetus).toContain("Epictetus");
    expect(marcus).toContain("Marcus Aurelius");
    expect(seneca).toContain("Seneca");

    expect(epictetus).not.toContain("Marcus Aurelius");
    expect(marcus).not.toContain("Epictetus");
  });
});

describe("buildTranslationUser", () => {
  it("contains only the original text", () => {
    const user = buildTranslationUser(sampleChunk);
    expect(user).toContain("ORIGINAL:");
    expect(user).toContain("Some original text here.");
  });

  it("does not include rules or voice guidance", () => {
    const user = buildTranslationUser(sampleChunk);
    expect(user).not.toContain("Flesch-Kincaid");
    expect(user).not.toContain("VOICE GUIDANCE");
    expect(user).not.toContain("TAG ASSIGNMENT");
  });
});

describe("buildTranslationPrompt", () => {
  it("is the concatenation of system + user", () => {
    const system = buildTranslationSystem(enchiridion);
    const user = buildTranslationUser(sampleChunk);
    const full = buildTranslationPrompt(sampleChunk, enchiridion);

    expect(full).toBe(`${system}\n\n${user}`);
  });
});
