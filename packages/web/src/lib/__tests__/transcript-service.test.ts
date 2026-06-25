import { describe, expect, it, vi } from "vitest";
import { buildTranscript } from "../transcript-service";

const baseSession = {
  id: "app-1",
  projectId: "proj",
  workspacePath: "/tmp/ws",
  metadata: { claudeSessionUuid: "uuid-1", tmuxName: "app-1" },
} as never;

function deps(over: Partial<Parameters<typeof buildTranscript>[1]> = {}) {
  return {
    readTranscriptText: vi.fn().mockResolvedValue(
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "hi" } }),
    ),
    readActivity: vi.fn().mockResolvedValue({ state: "idle" as const, trigger: undefined }),
    capturePane: vi.fn().mockResolvedValue(""),
    ...over,
  };
}

describe("buildTranscript", () => {
  it("returns parsed entries and idle status", async () => {
    const res = await buildTranscript(baseSession, deps());
    expect(res.entries).toEqual([{ kind: "message", role: "assistant", text: "hi" }]);
    expect(res.status).toBe("idle");
    expect(res.prompt).toBeUndefined();
  });

  it("captures + parses the prompt when waiting_input", async () => {
    const res = await buildTranscript(
      baseSession,
      deps({
        readActivity: vi.fn().mockResolvedValue({ state: "waiting_input", trigger: "Bash" }),
        capturePane: vi.fn().mockResolvedValue("Proceed?\n❯ 1. Yes\n  2. No"),
      }),
    );
    expect(res.status).toBe("waiting_input");
    expect(res.trigger).toBe("Bash");
    expect(res.prompt?.options).toHaveLength(2);
  });

  it("does not capture the pane when not waiting", async () => {
    const d = deps();
    await buildTranscript(baseSession, d);
    expect(d.capturePane).not.toHaveBeenCalled();
  });

  it("does NOT set a prompt when waiting but the screen has no real prompt", async () => {
    // Stale waiting_input + ordinary output (a numbered list, no cursor) must
    // not produce a phantom prompt card.
    const res = await buildTranscript(
      baseSession,
      deps({
        readActivity: vi.fn().mockResolvedValue({ state: "waiting_input", trigger: "Bash" }),
        capturePane: vi.fn().mockResolvedValue("Here are the steps:\n1. one\n2. two"),
      }),
    );
    expect(res.status).toBe("waiting_input");
    expect(res.prompt).toBeUndefined();
  });
});
