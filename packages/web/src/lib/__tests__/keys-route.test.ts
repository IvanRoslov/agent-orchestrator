import { describe, expect, it } from "vitest";

import { validateKeyTokens } from "../key-allowlist";

describe("validateKeyTokens", () => {
  it("accepts allowlisted tokens", () => {
    expect(validateKeyTokens(["1", "Enter"])).toEqual(["1", "Enter"]);
    expect(validateKeyTokens(["Escape"])).toEqual(["Escape"]);
    expect(validateKeyTokens(["Up", "Enter"])).toEqual(["Up", "Enter"]);
    expect(validateKeyTokens(["Space"])).toEqual(["Space"]);
    expect(validateKeyTokens(["C-c"])).toEqual(["C-c"]);
  });

  it("rejects anything not allowlisted", () => {
    expect(validateKeyTokens(["rm -rf /"])).toBeNull();
    expect(validateKeyTokens([])).toBeNull();
    expect(validateKeyTokens(["Enter", "ls"])).toBeNull();
    expect(validateKeyTokens("Enter" as unknown as string[])).toBeNull();
    expect(validateKeyTokens(["1", "2", "3", "4", "5", "6", "7", "8", "9"])).toBeNull();
  });
});
