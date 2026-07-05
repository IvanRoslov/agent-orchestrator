import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrchestratorWorkersList, OrchestratorWorkersCard } from "../OrchestratorWorkersCard";
import type { WorkerHealth } from "../../lib/feature-sessions";
import type { DashboardSession } from "../../lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const w = (over: Partial<WorkerHealth>): WorkerHealth => ({
  id: "web-1", projectId: "web", task: "web-form", branch: "feature/login/web-form",
  activity: "idle", ageMs: 47 * 60_000, stale: true, pr: null, ...over,
});

describe("OrchestratorWorkersList", () => {
  it("renders the empty state when there are no workers", () => {
    render(<OrchestratorWorkersList workers={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no workers/i)).toBeInTheDocument();
  });

  it("renders a row per worker with task, state, age, and PR", () => {
    render(
      <OrchestratorWorkersList
        workers={[w({ pr: { number: 123 } as WorkerHealth["pr"] })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("web-form")).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
    expect(screen.getByText("47m")).toBeInTheDocument();
    expect(screen.getByText("#123")).toBeInTheDocument();
    expect(screen.getByText(/stalled/i)).toBeInTheDocument();
  });

  it("calls onOpen with projectId and id when a row is clicked", () => {
    const onOpen = vi.fn();
    render(<OrchestratorWorkersList workers={[w({})]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("web", "web-1");
  });
});

const ds = (over: Partial<DashboardSession>): DashboardSession =>
  ({
    id: "x", projectId: "p", status: "working", activity: "idle",
    branch: null, displayName: null, displayNameUserSet: false,
    lastActivityAt: new Date().toISOString(), pr: null, prs: [], metadata: {},
    ...over,
  }) as unknown as DashboardSession;

describe("OrchestratorWorkersCard", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("fetches /api/sessions and renders a worker row for the feature", async () => {
    const worker = ds({ id: "web-1", projectId: "web", branch: "feature/login/web-form" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [worker] }) }),
    );
    render(<OrchestratorWorkersCard session={ds({ id: "hub-1", metadata: { feature: "login" } })} />);
    await waitFor(() => expect(screen.getByText("web-form")).toBeInTheDocument());
  });
});
