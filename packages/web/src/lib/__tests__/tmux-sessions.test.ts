import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the child_process boundary so killTmuxSession's actual tmux invocation
// can be inspected. Hoisted so the mock is in place before tmux-sessions.ts
// binds execFileAsync = promisify(execFile) at import time.
const { execFileMock } = vi.hoisted(() => ({ execFileMock: vi.fn() }));
vi.mock("node:child_process", () => {
  // tmux-sessions.ts does `promisify(execFile)` at import, so the mock's
  // execFile must carry promisify.custom (the globally-registered symbol) —
  // otherwise promisify falls through and actually shells out to tmux.
  // Also expose `default` + no-op siblings so shared importers of this module
  // (e.g. @aoagents/ao-core's platform.ts) don't break on missing exports.
  const custom = Symbol.for("nodejs.util.promisify.custom");
  const execFile = Object.assign(
    (
      _cmd: string,
      _args: string[],
      cb: (e: Error | null, r: { stdout: string; stderr: string }) => void,
    ) => {
      execFileMock(_cmd, _args);
      cb(null, { stdout: "", stderr: "" });
    },
    {
      [custom]: (cmd: string, args: string[]) => {
        execFileMock(cmd, args);
        return Promise.resolve({ stdout: "", stderr: "" });
      },
    },
  );
  const noop = () => undefined;
  return {
    execFile,
    spawn: noop,
    exec: noop,
    execSync: noop,
    execFileSync: noop,
    default: { execFile, spawn: noop, exec: noop, execSync: noop, execFileSync: noop },
  };
});

import { buildTmuxSessions, exactSession, killTmuxSession } from "../tmux-sessions";

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

describe("killTmuxSession", () => {
  beforeEach(() => execFileMock.mockClear());

  it("issues an exact-match kill so it cannot hit a prefix-collision sibling", async () => {
    await killTmuxSession("pla-orchestrator");
    expect(execFileMock).toHaveBeenCalledTimes(1);
    const [cmd, args] = execFileMock.mock.calls[0];
    expect(cmd).toBe("tmux");
    // The "=" prefix is the whole point: killing "pla-orchestrator" must not
    // hit "pla-orchestrator-83" or any other prefix-matched sibling.
    expect(args).toEqual(["kill-session", "-t", "=pla-orchestrator"]);
  });
});
