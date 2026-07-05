import { describe, expect, it } from "vitest";
import type { DashboardSession } from "../types";
import {
  featureLabel,
  isFeatureCoordinator,
  listFeatureSessions,
  workersForFeature,
  workerHealthList,
  formatAgeShort,
} from "../feature-sessions";

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

const NOW = 1_000_000_000_000;
const STALE = 15 * 60_000;

function s(over: Partial<DashboardSession>): DashboardSession {
  return {
    id: "x",
    projectId: "p",
    status: "working",
    activity: "idle",
    branch: null,
    displayName: null,
    displayNameUserSet: false,
    lastActivityAt: new Date(NOW).toISOString(),
    pr: null,
    prs: [],
    metadata: {},
    ...over,
  } as unknown as DashboardSession;
}

describe("workersForFeature", () => {
  it("filters by feature/<slug>/ branch prefix; tolerates null", () => {
    const all = [
      s({ id: "a", branch: "feature/login/web" }),
      s({ id: "b", branch: "feature/login/api" }),
      s({ id: "c", branch: "feature/signup/web" }),
      s({ id: "d", branch: null }),
    ];
    expect(workersForFeature(all, "login").map((x) => x.id)).toEqual(["a", "b"]);
    expect(workersForFeature(null, "login")).toEqual([]);
    expect(workersForFeature(all, "")).toEqual([]);
  });
});

describe("workerHealthList", () => {
  it("computes task suffix, age, staleness; sorts stale-first then oldest", () => {
    const all = [
      s({
        id: "fresh",
        branch: "feature/login/api",
        activity: "active",
        lastActivityAt: new Date(NOW - 1000).toISOString(),
      }),
      s({
        id: "old",
        branch: "feature/login/web",
        activity: "idle",
        lastActivityAt: new Date(NOW - STALE - 60_000).toISOString(),
      }),
      s({
        id: "nodata",
        branch: "feature/login/x",
        activity: null,
        lastActivityAt: new Date(0).toISOString(),
      }),
    ];
    const list = workerHealthList(all, "login", NOW);
    expect(list[0].id).toBe("old");
    expect(list[0].stale).toBe(true);
    expect(list[0].task).toBe("web");
    expect(list.find((w) => w.id === "nodata")!.stale).toBe(false); // null activity never stale
    expect(list.find((w) => w.id === "fresh")!.stale).toBe(false);
  });
});

describe("formatAgeShort", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatAgeShort(15_000)).toBe("15s");
    expect(formatAgeShort(47 * 60_000)).toBe("47m");
    expect(formatAgeShort(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });
});
