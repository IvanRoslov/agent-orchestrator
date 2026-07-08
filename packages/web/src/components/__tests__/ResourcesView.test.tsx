import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResourcesView } from "../ResourcesView";
import type { ResourceSnapshot } from "@/lib/resource-types";

const snapshot: ResourceSnapshot = {
  capturedAt: "2026-07-08T00:00:00.000Z",
  platformSupported: true,
  sessions: [
    {
      tmuxSession: "pla-orchestrator",
      sessionId: null,
      projectId: null,
      known: false,
      orphan: true,
      aoStatus: null,
      cpuPercent: 0.1,
      rssMb: 672,
      procCount: 4,
      topCommand: "node",
      ageMinutes: 324,
      idleMinutes: 300,
    },
    {
      tmuxSession: "pla-orchestrator-83",
      sessionId: "pla-orchestrator-83",
      projectId: "platform",
      known: true,
      orphan: false,
      aoStatus: "working",
      cpuPercent: 1.3,
      rssMb: 974,
      procCount: 4,
      topCommand: "node",
      ageMinutes: 57,
      idleMinutes: 1,
    },
  ],
  totals: { cpuPercent: 1.4, rssMb: 1646, procCount: 8, sessionCount: 2 },
};

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body } as Response);
}

describe("ResourcesView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOnce(snapshot));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a row per session with an orphan badge", async () => {
    render(<ResourcesView />);
    expect(await screen.findByText("pla-orchestrator")).toBeInTheDocument();
    expect(screen.getByText("pla-orchestrator-83")).toBeInTheDocument();
    // one orphan badge for the untracked session
    expect(screen.getAllByText(/orphan/i)).toHaveLength(1);
  });

  it("kills a session through a confirmation step", async () => {
    const fetchMock = mockFetchOnce(snapshot);
    // first call = initial snapshot; second = kill; third = refetch
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ killed: true, path: "tmux" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ResourcesView />);
    const killButton = (await screen.findAllByRole("button", { name: /kill/i }))[0];
    fireEvent.click(killButton);
    // confirmation modal appears with a unique Confirm button
    const confirm = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/resources/kill",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("keeps the modal open and shows an error when the kill fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot } as Response)
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "boom" }) } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ResourcesView />);
    const killButton = (await screen.findAllByRole("button", { name: /kill/i }))[0];
    fireEvent.click(killButton);
    const confirm = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirm);

    expect(await screen.findByText(/kill failed/i)).toBeInTheDocument();
    // refresh() must NOT run on failure → exactly 2 fetches (initial snapshot + failed kill)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  });

  it("shows a Windows note when resource stats are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ...snapshot, platformSupported: false }),
    );
    render(<ResourcesView />);
    expect(await screen.findByText(/unavailable on windows/i)).toBeInTheDocument();
  });
});
