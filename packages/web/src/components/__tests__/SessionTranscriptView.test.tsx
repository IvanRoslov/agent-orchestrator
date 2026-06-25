import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useSpeechRecognition", () => ({
  useSpeechRecognition: () => ({ supported: false, listening: false, start: vi.fn(), stop: vi.fn() }),
}));

import { SessionTranscriptView } from "../SessionTranscriptView";

const transcript = {
  entries: [{ kind: "message", role: "assistant", text: "hello from agent" }],
  status: "idle",
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => transcript }),
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("SessionTranscriptView", () => {
  it("fetches and renders the transcript with a status badge", async () => {
    render(<SessionTranscriptView sessionId="app-1" projectId="proj" />);
    await waitFor(() => expect(screen.getByText("hello from agent")).toBeInTheDocument());
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
  });

  it("does not drop the last message when a poll returns a transiently shorter list", async () => {
    vi.useFakeTimers();
    try {
      const full = {
        entries: [
          { kind: "message", role: "user", text: "first" },
          { kind: "message", role: "assistant", text: "second" },
        ],
        status: "working",
      };
      const shrunk = { entries: [{ kind: "message", role: "user", text: "first" }], status: "working" };
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce({ ok: true, json: async () => full })
        .mockResolvedValue({ ok: true, json: async () => shrunk });
      vi.stubGlobal("fetch", fetchMock);

      render(<SessionTranscriptView sessionId="app-1" projectId="proj" />);
      await vi.waitFor(() => expect(screen.getByText("second")).toBeInTheDocument());

      // Next poll returns the shrunk list (last message momentarily unparseable).
      await vi.advanceTimersByTimeAsync(4000);
      // The last message must NOT disappear.
      expect(screen.getByText("second")).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
