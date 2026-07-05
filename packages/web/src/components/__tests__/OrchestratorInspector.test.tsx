import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrchestratorInspector } from "../OrchestratorInspector";
import type { DashboardSession } from "../../lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const session = { id: "hub-1", projectId: "hub", metadata: { feature: "login" } } as unknown as DashboardSession;

describe("OrchestratorInspector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the Workers header with a live count and lists workers", async () => {
    const worker = { id: "web-1", projectId: "web", status: "working", activity: "idle",
      branch: "feature/login/web-form", displayName: null, displayNameUserSet: false,
      lastActivityAt: new Date().toISOString(), pr: null, prs: [], metadata: {} } as unknown as DashboardSession;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [worker] }) }));
    render(<OrchestratorInspector session={session} onCollapse={() => {}} />);
    await waitFor(() => expect(screen.getByText("web-form")).toBeInTheDocument());
    expect(screen.getByText(/workers \(1\)/i)).toBeInTheDocument();
  });

  it("fires onCollapse when the collapse button is clicked", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) }));
    const onCollapse = vi.fn();
    render(<OrchestratorInspector session={session} onCollapse={onCollapse} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse workers/i }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
