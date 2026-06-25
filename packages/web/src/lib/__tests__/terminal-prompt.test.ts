import { describe, expect, it } from "vitest";
import { parsePrompt } from "../terminal-prompt";

describe("parsePrompt", () => {
  it("parses a numbered permission prompt with the question above the options", () => {
    const captured = [
      "  Bash command",
      "  npm run deploy",
      "",
      "Do you want to proceed?",
      "❯ 1. Yes",
      "  2. Yes, and don't ask again for npm commands",
      "  3. No, and tell Claude what to do differently (esc)",
      "",
    ].join("\n");
    const prompt = parsePrompt(captured);
    expect(prompt?.question).toBe("Do you want to proceed?");
    expect(prompt?.options).toEqual([
      { index: 1, label: "Yes" },
      { index: 2, label: "Yes, and don't ask again for npm commands" },
      { index: 3, label: "No, and tell Claude what to do differently (esc)" },
    ]);
    expect(prompt?.raw).toContain("Do you want to proceed?");
  });

  it("returns null with no numbered options (caller falls back to raw text)", () => {
    expect(parsePrompt("just some output\nno options here")).toBeNull();
    expect(parsePrompt("")).toBeNull();
  });

  it("returns null for a plain numbered list with no cursor glyph (no false positive)", () => {
    // Claude often prints ordinary numbered lists in its output. Without a
    // cursor (❯) these must NOT be mistaken for an interactive prompt.
    const list = ["Here are the steps:", "1. clone the repo", "2. run install", "3. start dev"].join("\n");
    expect(parsePrompt(list)).toBeNull();
  });

  it("includes sibling plain-numbered options once a cursor anchor is present", () => {
    const prompt = parsePrompt("Pick one\n❯ 1. Alpha\n  2. Beta");
    expect(prompt?.options).toEqual([
      { index: 1, label: "Alpha" },
      { index: 2, label: "Beta" },
    ]);
  });
});
