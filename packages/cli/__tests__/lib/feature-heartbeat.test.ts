import { describe, it, expect, vi, afterEach } from "vitest";
import type { Session } from "@aoagents/ao-core";
import {
  workersForOrchestrator,
  isStale,
  buildSummary,
  evaluateOrchestrator,
  startFeatureHeartbeat,
  stopFeatureHeartbeat,
  STALE_MS,
  RENUDGE_MS,
} from "../../src/lib/feature-heartbeat.js";

const NOW = 1_000_000_000_000;

function session(over: Partial<Session>): Session {
  return {
    id: "s",
    projectId: "p",
    status: "working",
    activity: "idle",
    activitySignal: "valid",
    lifecycle: null,
    branch: null,
    issueId: null,
    pr: null,
    prs: [],
    workspacePath: null,
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(NOW),
    lastActivityAt: new Date(NOW),
    metadata: {},
    ...over,
  } as unknown as Session;
}

const orch = (over: Partial<Session> = {}) =>
  session({ id: "hub-1", metadata: { feature: "login" }, activity: "idle", ...over });

const worker = (over: Partial<Session> = {}) =>
  session({ id: "web-1", projectId: "web", branch: "feature/login/web-form", ...over });

describe("workersForOrchestrator", () => {
  it("matches sessions by feature/<slug>/ branch prefix, excludes the orchestrator", () => {
    const all = [
      orch(),
      worker({ id: "web-1", branch: "feature/login/web-form" }),
      worker({ id: "api-1", branch: "feature/login/api-auth" }),
      worker({ id: "other-1", branch: "feature/signup/x" }),
      worker({ id: "hub-1", branch: "feature/login/nope" }), // same id as orch → excluded
    ];
    const ids = workersForOrchestrator(orch(), all).map((s) => s.id);
    expect(ids).toEqual(["web-1", "api-1"]);
  });
  it("returns [] when orchestrator has no feature slug", () => {
    expect(workersForOrchestrator(session({ metadata: {} }), [worker()])).toEqual([]);
  });
});

describe("isStale", () => {
  it("true past threshold, false within, false when activity is null", () => {
    expect(isStale(worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) }), NOW)).toBe(true);
    expect(isStale(worker({ lastActivityAt: new Date(NOW - STALE_MS + 1000) }), NOW)).toBe(false);
    expect(isStale(worker({ activity: null, lastActivityAt: new Date(0) }), NOW)).toBe(false);
  });
});

describe("buildSummary", () => {
  it("lists every worker, stale first, with state/age/PR and header/footer", () => {
    const fresh = worker({ id: "api-1", branch: "feature/login/api-auth", activity: "active", lastActivityAt: new Date(NOW - 15_000) });
    const stale = worker({ id: "web-1", branch: "feature/login/web-form", activity: "idle", lastActivityAt: new Date(NOW - 47 * 60_000), pr: { number: 123 } as Session["pr"] });
    const msg = buildSummary(orch(), [fresh, stale], NOW);
    expect(msg).toContain("[feature heartbeat] feature login");
    // stale sorted before fresh
    expect(msg.indexOf("web-1")).toBeLessThan(msg.indexOf("api-1"));
    expect(msg).toContain("IDLE 47m · PR #123");
    expect(msg).toContain("no movement");
    expect(msg).toContain("ACTIVE 15s");
    expect(msg).toContain("ao send <worker-id>");
  });
});

describe("evaluateOrchestrator", () => {
  const staleWorker = worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) });
  it("nudges when idle orchestrator has a stale worker and no prior send", () => {
    const d = evaluateOrchestrator(orch(), [orch(), staleWorker], NOW, undefined);
    expect(d).not.toBeNull();
  });
  it("stays silent when no feature slug", () => {
    expect(evaluateOrchestrator(session({ metadata: {} }), [staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when orchestrator is active", () => {
    expect(evaluateOrchestrator(orch({ activity: "active" }), [orch({ activity: "active" }), staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when orchestrator has exited", () => {
    expect(evaluateOrchestrator(orch({ activity: "exited" }), [staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when no workers", () => {
    expect(evaluateOrchestrator(orch(), [orch()], NOW, undefined)).toBeNull();
  });
  it("stays silent when all workers fresh", () => {
    const fresh = worker({ lastActivityAt: new Date(NOW - 1000) });
    expect(evaluateOrchestrator(orch(), [orch(), fresh], NOW, undefined)).toBeNull();
  });
  it("throttles within the re-nudge window, then nudges again after it", () => {
    const all = [orch(), staleWorker];
    expect(evaluateOrchestrator(orch(), all, NOW, NOW - RENUDGE_MS + 1000)).toBeNull();
    expect(evaluateOrchestrator(orch(), all, NOW, NOW - RENUDGE_MS - 1000)).not.toBeNull();
  });
});

describe("startFeatureHeartbeat", () => {
  afterEach(async () => {
    await stopFeatureHeartbeat();
    vi.useRealTimers();
  });
  it("sends one nudge per stale orchestrator on the immediate tick", async () => {
    const all = [orch(), worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) })];
    const send = vi.fn().mockResolvedValue(undefined);
    startFeatureHeartbeat({ list: async () => all, send, now: () => NOW });
    await new Promise((r) => setTimeout(r, 0)); // let the immediate tick resolve
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("hub-1");
  });
});
