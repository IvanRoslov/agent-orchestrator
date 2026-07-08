import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectSidebar } from "../ProjectSidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
    setTheme: vi.fn(),
  }),
}));

describe("ProjectSidebar resources link", () => {
  it("renders a link to /resources", () => {
    // Minimal real props — ProjectSidebarProps requires projects, sessions,
    // activeProjectId, activeSessionId (all non-optional, though the latter
    // two accept undefined). With projects=[] the sidebar renders its
    // empty-state chrome, which still includes the nav header region.
    render(
      <ProjectSidebar
        projects={[]}
        sessions={[]}
        activeProjectId={undefined}
        activeSessionId={undefined}
      />,
    );
    const link = screen.getByRole("link", { name: /resources/i });
    expect(link).toHaveAttribute("href", "/resources");
  });
});
