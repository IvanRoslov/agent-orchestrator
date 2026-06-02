import { describe, expect, it } from "vitest";
import type { DashboardSession } from "../types";
import {
  featureSlugFromBranch,
  isFeatureCoordinator,
  listFeatureSessions,
} from "../feature-sessions";

function session(id: string, projectId: string, branch: string | null): DashboardSession {
  return { id, projectId, branch } as unknown as DashboardSession;
}

describe("isFeatureCoordinator", () => {
  it("matches feature-orchestrator/<slug> branches", () => {
    expect(isFeatureCoordinator({ branch: "feature-orchestrator/add-sso" })).toBe(true);
  });

  it("does not match worker or other branches", () => {
    expect(isFeatureCoordinator({ branch: "feature/add-sso/web-repo" })).toBe(false);
    expect(isFeatureCoordinator({ branch: "main" })).toBe(false);
    expect(isFeatureCoordinator({ branch: null })).toBe(false);
  });
});

describe("featureSlugFromBranch", () => {
  it("returns the slug for a coordinator branch", () => {
    expect(featureSlugFromBranch("feature-orchestrator/add-sso")).toBe("add-sso");
  });

  it("returns null for non-coordinator branches", () => {
    expect(featureSlugFromBranch("feature/add-sso/web-repo")).toBeNull();
    expect(featureSlugFromBranch(null)).toBeNull();
  });
});

describe("listFeatureSessions", () => {
  const sessions = [
    session("a", "hub", "feature-orchestrator/add-sso"),
    session("b", "hub", "feature/add-sso/web-repo"),
    session("c", "other", "feature-orchestrator/billing"),
    session("d", "hub", "main"),
  ];

  it("returns only coordinator sessions", () => {
    expect(listFeatureSessions(sessions).map((s) => s.id)).toEqual(["a", "c"]);
  });

  it("scopes to a project when given", () => {
    expect(listFeatureSessions(sessions, "hub").map((s) => s.id)).toEqual(["a"]);
  });

  it("handles null", () => {
    expect(listFeatureSessions(null)).toEqual([]);
  });
});
