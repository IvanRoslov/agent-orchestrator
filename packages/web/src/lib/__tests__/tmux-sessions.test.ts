import { describe, it, expect } from "vitest";
import { buildTmuxSessions, exactSession } from "../tmux-sessions";

describe("buildTmuxSessions", () => {
  it("merges pane pids per session with created/activity times", () => {
    const panes = ["cle-2\t100", "cle-2\t101", "pla-orchestrator-83\t200"].join("\n");
    const sess = [
      "cle-2\t1783459006\t1783459900",
      "pla-orchestrator-83\t1783456535\t1783459950",
    ].join("\n");
    const out = buildTmuxSessions(panes, sess);
    expect(out).toHaveLength(2);
    const cle = out.find((s) => s.name === "cle-2");
    expect(cle?.panePids.sort()).toEqual([100, 101]);
    expect(cle?.createdEpoch).toBe(1783459006);
    expect(cle?.activityEpoch).toBe(1783459900);
  });

  it("includes sessions even if a session has no pane rows", () => {
    const out = buildTmuxSessions("", "solo\t10\t20");
    expect(out).toEqual([
      { name: "solo", panePids: [], createdEpoch: 10, activityEpoch: 20 },
    ]);
  });
});

describe("exactSession", () => {
  it("prefixes = for exact tmux targeting", () => {
    expect(exactSession("pla-orchestrator")).toBe("=pla-orchestrator");
  });
});
