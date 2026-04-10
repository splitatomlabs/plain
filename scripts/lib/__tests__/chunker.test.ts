import { describe, it, expect } from "vitest";
import { chunkSections } from "../chunker.js";
import type { Section } from "../parser.js";

describe("chunkSections", () => {
  it("strips Roman numeral prefix from section text", () => {
    const sections: Section[] = [
      { number: 1, text: "I. This is the first section about virtue and living a good life every day." },
      { number: 2, text: "II. This is the second section about duty and responsibility to others around you." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks[0].text).toBe("This is the first section about virtue and living a good life every day.");
    expect(chunks[1].text).toBe("This is the second section about duty and responsibility to others around you.");
  });

  it("preserves section numbers", () => {
    const sections: Section[] = [
      { number: 5, text: "V. Some text here about living well and finding peace within yourself daily." },
      { number: 6, text: "VI. More text about philosophy and life and the pursuit of wisdom and truth." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks[0].sectionNumber).toBe(5);
    expect(chunks[1].sectionNumber).toBe(6);
  });

  it("strips speaker labels when flag is set", () => {
    const sections: Section[] = [
      { number: 1, text: "I. [_Serenus._] When I examine myself, some vices appear on the surface." },
    ];
    const chunks = chunkSections(sections, true);
    expect(chunks[0].text).not.toContain("[_Serenus._]");
    expect(chunks[0].text).toContain("When I examine myself");
  });

  it("does not strip speaker labels when flag is false", () => {
    const sections: Section[] = [
      { number: 1, text: "I. [_Serenus._] When I examine myself, some vices appear on the surface." },
    ];
    const chunks = chunkSections(sections, false);
    expect(chunks[0].text).toContain("[_Serenus._]");
  });

  it("merges fragment sections under 50 chars with the next section", () => {
    const sections: Section[] = [
      { number: 1, text: "I. Short." },
      { number: 2, text: "II. This is a longer section with enough text to stand on its own as a card." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].sectionNumber).toBe(1);
    expect(chunks[0].text).toContain("Short.");
    expect(chunks[0].text).toContain("This is a longer section");
  });

  it("keeps sections at or above 50 chars as separate chunks", () => {
    const sections: Section[] = [
      { number: 1, text: "I. This section is definitely long enough to be its own card in the system." },
      { number: 2, text: "II. And this section is also long enough to stand alone as a separate card." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks).toHaveLength(2);
  });

  it("handles last section being a fragment", () => {
    const sections: Section[] = [
      { number: 1, text: "I. This is a full-length section with enough content to be meaningful." },
      { number: 2, text: "II. Tiny." },
    ];
    const chunks = chunkSections(sections);
    // Last fragment gets emitted on its own
    expect(chunks).toHaveLength(2);
  });

  it("removes page number artifacts like {289}", () => {
    const sections: Section[] = [
      { number: 1, text: "I. We have an ample portion, if we {289} do but arrange the whole of it aright." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks[0].text).not.toContain("{289}");
    expect(chunks[0].text).toContain("we do but arrange");
  });

  it("normalizes excessive whitespace", () => {
    const sections: Section[] = [
      { number: 1, text: "I. Too   many   spaces   and\n\n\n\ntoo many newlines in this passage here." },
    ];
    const chunks = chunkSections(sections);
    expect(chunks[0].text).not.toContain("   ");
    expect(chunks[0].text).not.toContain("\n\n\n");
  });
});
