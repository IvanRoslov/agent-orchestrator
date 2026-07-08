import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();
const killMock = vi.fn();
const killTmuxMock = vi.fn();

vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    sessionManager: { get: getMock, kill: killMock },
  })),
}));
vi.mock("@/lib/tmux-sessions", () => ({ killTmuxSession: (name: string) => killTmuxMock(name) }));

import { POST } from "@/app/api/resources/kill/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/resources/kill", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/resources/kill", () => {
  beforeEach(() => {
    getMock.mockReset();
    killMock.mockReset();
    killTmuxMock.mockReset();
  });

  it("rejects a malformed session name", async () => {
    const res = await POST(post({ tmuxSession: "bad name!" }) as never);
    expect(res.status).toBe(400);
    expect(killMock).not.toHaveBeenCalled();
    expect(killTmuxMock).not.toHaveBeenCalled();
  });

  it("kills a known active session via the lifecycle path", async () => {
    getMock.mockResolvedValue({ id: "pla-orchestrator-83", status: "working" });
    const res = await POST(post({ tmuxSession: "pla-orchestrator-83" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "lifecycle" });
    expect(killMock).toHaveBeenCalledWith("pla-orchestrator-83");
    expect(killTmuxMock).not.toHaveBeenCalled();
  });

  it("kills an untracked orphan directly via tmux", async () => {
    getMock.mockResolvedValue(null);
    const res = await POST(post({ tmuxSession: "pla-orchestrator" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "tmux" });
    expect(killTmuxMock).toHaveBeenCalledWith("pla-orchestrator");
    expect(killMock).not.toHaveBeenCalled();
  });

  it("kills a tracked-but-terminal session via tmux (dashboard can't reach it)", async () => {
    getMock.mockResolvedValue({ id: "eg-29", status: "cleanup" });
    const res = await POST(post({ tmuxSession: "eg-29" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "tmux" });
    expect(killTmuxMock).toHaveBeenCalledWith("eg-29");
    expect(killMock).not.toHaveBeenCalled();
  });
});
