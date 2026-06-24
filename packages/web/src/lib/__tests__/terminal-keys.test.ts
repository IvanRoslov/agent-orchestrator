import { describe, expect, it } from "vitest";
import { TERMINAL_KEYS } from "../terminal-keys";

describe("TERMINAL_KEYS", () => {
  it("maps each special key to its raw PTY byte sequence", () => {
    expect(TERMINAL_KEYS.escape).toBe("\x1b");
    expect(TERMINAL_KEYS.enter).toBe("\r");
    expect(TERMINAL_KEYS.ctrlC).toBe("\x03");
    expect(TERMINAL_KEYS.tab).toBe("\t");
    expect(TERMINAL_KEYS.up).toBe("\x1b[A");
    expect(TERMINAL_KEYS.down).toBe("\x1b[B");
    expect(TERMINAL_KEYS.right).toBe("\x1b[C");
    expect(TERMINAL_KEYS.left).toBe("\x1b[D");
  });
});
