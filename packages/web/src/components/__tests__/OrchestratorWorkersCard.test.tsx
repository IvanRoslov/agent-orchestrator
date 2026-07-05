import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrchestratorWorkersList, useFeatureWorkers } from "../OrchestratorWorkersCard";
import type { WorkerHealth } from "../../lib/feature-sessions";
import type { DashboardSession } from "../../lib/types";

const NOW = Date.now();
const w = (over: Partial<WorkerHealth>): WorkerHealth => ({
  id: "web-1", projectId: "web", task: "web-form", branch: "feature/login/web-form",
  activity: "idle", ageMs: 47 * 60_000, stale: true, pr: null,
  lastActivityAt: new Date(NOW - 47 * 60_000).toISOString(), ...over,
});

describe("OrchestratorWorkersList", () => {
  it("empty state", () => {
    render(<OrchestratorWorkersList workers={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no workers/i)).toBeInTheDocument();
  });

  it("shows status label, full branch, relative time, PR chip, and stalled marker", () => {
    render(
      <OrchestratorWorkersList
        workers={[w({ pr: { number: 123, state: "open", ciStatus: "passing", enriched: true } as WorkerHealth["pr"] })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("web-form")).toBeInTheDocument();
    expect(screen.getByText("feature/login/web-form")).toBeInTheDocument(); // full branch
    expect(screen.getByText(/ago/i)).toBeInTheDocument();                    // relative time
    expect(screen.getByText("#123")).toBeInTheDocument();
    expect(screen.getByText(/stalled/i)).toBeInTheDocument();
  });

  it("shows an active worker without a stalled marker", () => {
    render(<OrchestratorWorkersList workers={[w({ activity: "active", stale: false, ageMs: 5000 })]} onOpen={() => {}} />);
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText(/stalled/i)).not.toBeInTheDocument();
  });

  it("calls onOpen with projectId and id on row click", () => {
    const onOpen = vi.fn();
    render(<OrchestratorWorkersList workers={[w({})]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("web", "web-1");
  });
});

describe("useFeatureWorkers", () => {
  afterEach(() => vi.unstubAllGlobals());
  function Probe({ session }: { session: DashboardSession }) {
    const workers = useFeatureWorkers(session);
    return <div>{workers.map((x) => <span key={x.id}>{x.task}</span>)}</div>;
  }
  it("fetches /api/sessions and returns workers for the feature slug", async () => {
    const worker = { id: "web-1", projectId: "web", status: "working", activity: "idle",
      branch: "feature/login/web-form", displayName: null, displayNameUserSet: false,
      lastActivityAt: new Date().toISOString(), pr: null, prs: [], metadata: {} } as unknown as DashboardSession;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [worker] }) }));
    const session = { id: "hub-1", metadata: { feature: "login" } } as unknown as DashboardSession;
    render(<Probe session={session} />);
    await waitFor(() => expect(screen.getByText("web-form")).toBeInTheDocument());
  });
});
