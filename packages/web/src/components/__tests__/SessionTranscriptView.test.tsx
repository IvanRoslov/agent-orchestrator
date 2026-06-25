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
});
