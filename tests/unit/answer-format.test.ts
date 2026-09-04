import { describe, expect, it } from "vitest";

import {
  continueListOnEnter,
  countWords,
  shouldPreviewAnswer,
} from "@/lib/exam/answer-format";

describe("continueListOnEnter", () => {
  it("continues a bullet on Enter", () => {
    const value = "- point 1";
    const out = continueListOnEnter(value, value.length);
    expect(out).toEqual({ text: "- point 1\n- ", caret: "- point 1\n- ".length });
  });

  it("keeps indentation and asterisk markers", () => {
    const value = "  * indented";
    const out = continueListOnEnter(value, value.length);
    expect(out?.text).toBe("  * indented\n  * ");
    expect(out?.caret).toBe("  * indented\n  * ".length);
  });

  it("increments numbered markers", () => {
    const value = "1. first\n2. second";
    const out = continueListOnEnter(value, value.length);
    expect(out?.text).toBe("1. first\n2. second\n3. ");
  });

  it.each([
    ["999. item", "999. item\n1000. "],
    ["1000. item", "1000. item\n1001. "],
  ])("increments large numbered markers in %s", (value, expected) => {
    expect(continueListOnEnter(value, value.length)?.text).toBe(expected);
  });

  it("supports the 1) delimiter style", () => {
    const value = "1) first";
    const out = continueListOnEnter(value, value.length);
    expect(out?.text).toBe("1) first\n2) ");
  });

  it("exits the list on an empty bullet", () => {
    const out = continueListOnEnter("- point 1\n- ", "- point 1\n- ".length);
    expect(out).toEqual({ text: "- point 1\n", caret: "- point 1\n".length });
  });

  it("exits the list on an empty numbered item", () => {
    const out = continueListOnEnter("1. a\n2. ", "1. a\n2. ".length);
    expect(out?.text).toBe("1. a\n");
  });

  it("leaves plain paragraphs alone", () => {
    expect(continueListOnEnter("Just prose", 4)).toBeNull();
  });

  it("leaves dashed prose without trailing space alone", () => {
    expect(continueListOnEnter("-dash without space", 5)).toBeNull();
  });

  it("inserts at mid-line caret, not line end", () => {
    const value = "- ab";
    const out = continueListOnEnter(value, 3);
    expect(out?.text).toBe("- a\n- b");
    expect(out?.caret).toBe("- a\n- ".length);
  });
});

describe("shouldPreviewAnswer", () => {
  it("hides for empty and single plain lines", () => {
    expect(shouldPreviewAnswer("")).toBe(false);
    expect(shouldPreviewAnswer("   ")).toBe(false);
    expect(shouldPreviewAnswer("Photosynthesis releases oxygen")).toBe(false);
  });

  it("shows for lists, multiline text, and maths", () => {
    expect(shouldPreviewAnswer("- a\n- b")).toBe(true);
    expect(shouldPreviewAnswer("- single bullet")).toBe(true);
    expect(shouldPreviewAnswer("1. first")).toBe(true);
    expect(shouldPreviewAnswer("line one\nline two")).toBe(true);
    expect(shouldPreviewAnswer("Speed is $v = d/t$ here")).toBe(true);
  });
});

describe("countWords", () => {
  it("counts words and ignores blank input", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("  \n ")).toBe(0);
    expect(countWords("one two  three\nfour")).toBe(4);
  });
});
