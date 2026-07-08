import { describe, it, expect } from "vitest";
import { parsePs } from "../resource-stats";

describe("parsePs", () => {
  it("parses pid/ppid/cpu/rss and keeps commands with spaces", () => {
    const text = [
      "  7806  7725 186.6 2701632 next-server (v15.5.15)",
      " 7888     1   5.3   11824 tmux",
      "",
    ].join("\n");
    const map = parsePs(text);
    expect(map.size).toBe(2);
    expect(map.get(7806)).toEqual({
      pid: 7806,
      ppid: 7725,
      cpu: 186.6,
      rss: 2701632,
      comm: "next-server (v15.5.15)",
    });
    expect(map.get(7888)?.comm).toBe("tmux");
  });

  it("skips malformed lines", () => {
    expect(parsePs("garbage line\n   \n").size).toBe(0);
  });
});
