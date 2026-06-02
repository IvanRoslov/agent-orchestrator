import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

import { StartFeatureButton } from "../StartFeatureButton";
import { projectSessionPath } from "@/lib/routes";

function openModalAndType(name: string) {
  fireEvent.click(screen.getByRole("button", { name: "Start feature" }));
  const dialog = screen.getByRole("dialog", { name: "Start feature" });
  fireEvent.change(within(dialog).getByLabelText("Feature name"), { target: { value: name } });
  return dialog;
}

describe("StartFeatureButton", () => {
  beforeEach(() => {
    push.mockReset();
    vi.unstubAllGlobals();
  });

  it("opens a modal, starts the feature, and navigates to the new session", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ feature: { sessionId: "hub-3", projectId: "hub" } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StartFeatureButton projectId="hub" projectName="Hub" />);
    const dialog = openModalAndType("SSO login");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start feature" }));

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/feature/start",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body).toEqual({ projectId: "hub", name: "SSO login" });
    expect(push).toHaveBeenCalledWith(projectSessionPath("hub", "hub-3"));
  });

  it("shows an error and does not navigate when the API rejects", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Project is not a feature hub" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<StartFeatureButton projectId="solo" projectName="Solo" />);
    const dialog = openModalAndType("anything");
    fireEvent.click(within(dialog).getByRole("button", { name: "Start feature" }));

    await waitFor(() =>
      expect(within(dialog).getByRole("alert")).toHaveTextContent("Project is not a feature hub"),
    );
    expect(push).not.toHaveBeenCalled();
  });

  it("disables submit until a name is entered", () => {
    render(<StartFeatureButton projectId="hub" projectName="Hub" />);
    fireEvent.click(screen.getByRole("button", { name: "Start feature" }));
    const dialog = screen.getByRole("dialog", { name: "Start feature" });
    expect(within(dialog).getByRole("button", { name: "Start feature" })).toBeDisabled();
  });
});
