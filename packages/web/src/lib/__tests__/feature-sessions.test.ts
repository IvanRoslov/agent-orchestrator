import { describe, expect, it } from "vitest";
import type { DashboardSession } from "../types";
import { featureLabel, isFeatureCoordinator, listFeatureSessions } from "../feature-sessions";

function session(
  id: string,
  projectId: string,
  metadata?: Record<string, string>,
  displayName?: string | null,
): DashboardSession {
  return { id, projectId, metadata: metadata ?? {}, displayName } as unknown as DashboardSession;
}

describe("isFeatureCoordinator", () => {
  it("matches sessions tagged with metadata.feature", () => {
    expect(isFeatureCoordinator({ metadata: { feature: "sso-login" } })).toBe(true);
  });

  it("does not match regular orchestrators or workers", () => {
    expect(isFeatureCoordinator({ metadata: { role: "orchestrator" } })).toBe(false);
    expect(isFeatureCoordinator({ metadata: {} })).toBe(false);
    expect(isFeatureCoordinator({ metadata: null })).toBe(false);
  });
});

describe("featureLabel", () => {
  it("prefers the display name", () => {
    expect(
      featureLabel({ id: "lde-orchestrator-1", displayName: "SSO login", metadata: { feature: "sso" } }),
    ).toBe("SSO login");
  });

  it("falls back to the feature slug, then the id", () => {
    expect(featureLabel({ id: "lde-orchestrator-1", displayName: null, metadata: { feature: "sso" } })).toBe(
      "sso",
    );
    expect(featureLabel({ id: "lde-orchestrator-1", displayName: "  ", metadata: {} })).toBe(
      "lde-orchestrator-1",
    );
  });
});

describe("listFeatureSessions", () => {
  const sessions = [
    session("lde-orchestrator-1", "hub", { feature: "sso" }, "SSO login"),
    session("lde-9", "hub", {}),
    session("lti-orchestrator-2", "other", { feature: "billing" }, "Billing"),
    session("lde-orchestrator", "hub", { role: "orchestrator" }),
  ];

  it("returns only feature-tagged sessions", () => {
    expect(listFeatureSessions(sessions).map((s) => s.id)).toEqual([
      "lde-orchestrator-1",
      "lti-orchestrator-2",
    ]);
  });

  it("scopes to a project when given", () => {
    expect(listFeatureSessions(sessions, "hub").map((s) => s.id)).toEqual(["lde-orchestrator-1"]);
  });

  it("handles null", () => {
    expect(listFeatureSessions(null)).toEqual([]);
  });
});
