import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { StartFeatureButton } from "../StartFeatureButton";
import { projectSessionPath } from "@/lib/routes";

describe("StartFeatureButton", () => {
  beforeEach(() => {
    push.mockReset();
    vi.unstubAllGlobals();
  });

  it("starts a feature and navigates to the orchestrator terminal", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ orchestrator: { id: "hub-orchestrator", projectId: "hub" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StartFeatureButton projectId="hub" projectName="Hub" />);
    fireEvent.click(screen.getByRole("button", { name: "Start feature" }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/feature/start",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ projectId: "hub" });
    expect(push).toHaveBeenCalledWith(projectSessionPath("hub", "hub-orchestrator"));
  });

  it("shows a retry state and does not navigate on error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Project is not a feature hub" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StartFeatureButton projectId="solo" projectName="Solo" />);
    fireEvent.click(screen.getByRole("button", { name: "Start feature" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start feature" })).toHaveTextContent(
        "Retry feature",
      ),
    );
    expect(push).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Start feature" })).toHaveAttribute(
      "title",
      "Project is not a feature hub",
    );
  });
});
