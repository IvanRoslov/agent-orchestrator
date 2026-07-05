import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionDetailHeader } from "../SessionDetailHeader";
import type { DashboardSession } from "../../lib/types";

const baseSession = {
  id: "hub-1",
  projectId: "hub",
  status: "working",
  activity: "idle",
  branch: null,
  displayName: null,
  displayNameUserSet: false,
  lastActivityAt: new Date().toISOString(),
  pr: null,
  prs: [],
  metadata: { feature: "login" },
} as unknown as DashboardSession;

const baseProps = {
  session: baseSession,
  isOrchestrator: true,
  isFeatureOrchestrator: true,
  isMobile: false,
  terminalEnded: false,
  isRestorable: false,
  headline: "Login",
  projects: [],
  orchestratorHref: null,
  selectedPRIndex: 0,
  onSelectPR: () => {},
  onToggleSidebar: () => {},
  onRestore: () => {},
  onKill: () => {},
};

describe("SessionDetailHeader — Workers toggle", () => {
  it("renders the Workers button for a feature orchestrator and toggles", () => {
    const onToggleWorkers = vi.fn();
    render(
      <SessionDetailHeader {...baseProps} workersCollapsed={false} onToggleWorkers={onToggleWorkers} />,
    );
    const btn = screen.getByRole("button", { name: /toggle workers panel/i });
    fireEvent.click(btn);
    expect(onToggleWorkers).toHaveBeenCalledTimes(1);
  });

  it("does not render the Workers button when not a feature orchestrator", () => {
    render(<SessionDetailHeader {...baseProps} isFeatureOrchestrator={false} onToggleWorkers={() => {}} />);
    expect(screen.queryByRole("button", { name: /toggle workers panel/i })).not.toBeInTheDocument();
  });

  it("does not render the Workers button when isMobile is true", () => {
    render(
      <SessionDetailHeader {...baseProps} isMobile={true} onToggleWorkers={() => {}} />,
    );
    expect(screen.queryByRole("button", { name: /toggle workers panel/i })).not.toBeInTheDocument();
  });
});
