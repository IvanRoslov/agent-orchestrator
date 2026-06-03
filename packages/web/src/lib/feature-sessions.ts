import type { DashboardSession } from "./types";

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
