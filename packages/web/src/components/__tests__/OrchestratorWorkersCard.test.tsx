import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrchestratorWorkersList } from "../OrchestratorWorkersCard";
import type { WorkerHealth } from "../../lib/feature-sessions";

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
