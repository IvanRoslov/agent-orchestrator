import type { ActivityState } from "@aoagents/ao-core";
import type { DashboardPR, DashboardSession } from "./types";

/**
 * A feature orchestrator is a dedicated orchestrator session spawned for a
 * cross-project feature, marked at spawn time with `metadata.feature` (the
 * feature slug). Detection is by that metadata — NOT the git branch or the
 * numbered-orchestrator id (which the existing multi-orchestrator selection
 * already uses) — so the agent doing git work can never reclassify it.
 */
export function isFeatureCoordinator(session: {
  metadata?: Record<string, string> | null;
}): boolean {
  return Boolean(session.metadata?.["feature"]);
}

/** Human label for a feature session: its display name (the feature name), or id. */
export function featureLabel(session: {
  id: string;
  displayName?: string | null;
  metadata?: Record<string, string> | null;
}): string {
  const name = session.displayName?.trim() || session.metadata?.["feature"]?.trim();
  return name && name.length > 0 ? name : session.id;
}

/** All feature-orchestrator sessions, optionally scoped to a project. */
export function listFeatureSessions(
  sessions: DashboardSession[] | null,
  projectId?: string,
): DashboardSession[] {
  return (sessions ?? []).filter(
    (s) => isFeatureCoordinator(s) && (!projectId || s.projectId === projectId),
  );
}

const WORKER_STALE_MS = 15 * 60_000;

/** Workers of a feature: sessions whose branch is `feature/<slug>/*`. */
export function workersForFeature(
  sessions: DashboardSession[] | null,
  slug: string,
): DashboardSession[] {
  if (!slug) return [];
  const prefix = `feature/${slug}/`;
  return (sessions ?? []).filter((s) => s.branch?.startsWith(prefix) ?? false);
}

export interface WorkerHealth {
  id: string;
  projectId: string;
  task: string;
  branch: string | null;
  activity: ActivityState | null;
  ageMs: number;
  stale: boolean;
  pr: DashboardPR | null;
  lastActivityAt: string;
}

/** Compact age label: "15s", "47m", "2h 5m". */
export function formatAgeShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function toWorkerHealth(
  session: DashboardSession,
  slug: string,
  nowMs: number,
  staleMs: number,
): WorkerHealth {
  const prefix = `feature/${slug}/`;
  const task = session.branch?.startsWith(prefix)
    ? session.branch.slice(prefix.length)
    : (session.branch ?? session.id);
  const activityIso = session.realLastActivityAt ?? session.lastActivityAt;
  const ageMs = nowMs - new Date(activityIso).getTime();
  return {
    id: session.id,
    projectId: session.projectId,
    task,
    branch: session.branch,
    activity: session.activity,
    ageMs,
    stale: session.activity !== null && ageMs > staleMs,
    pr: session.pr,
    lastActivityAt: activityIso,
  };
}

/** Worker health for a feature, stale-first then oldest-first. */
export function workerHealthList(
  sessions: DashboardSession[] | null,
  slug: string,
  nowMs: number,
  staleMs: number = WORKER_STALE_MS,
): WorkerHealth[] {
  return workersForFeature(sessions, slug)
    .map((s) => toWorkerHealth(s, slug, nowMs, staleMs))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || b.ageMs - a.ageMs);
}

/** Which right rail (if any) a session detail view should show. */
export function railKind(
  session: { metadata?: Record<string, string> | null },
  opts: {
    isMobile: boolean;
    terminalEnded: boolean;
    isOrchestrator: boolean;
    workersCollapsed: boolean;
  },
): "orchestrator" | "inspector" | "none" {
  if (opts.isMobile || opts.terminalEnded) return "none";
  if (isFeatureCoordinator(session)) return opts.workersCollapsed ? "none" : "orchestrator";
  if (!opts.isOrchestrator) return "inspector";
  return "none";
}
