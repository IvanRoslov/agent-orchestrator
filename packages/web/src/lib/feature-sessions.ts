import type { DashboardSession } from "./types";

/**
 * A feature orchestrator runs as a dedicated session on a branch named
 * `feature-orchestrator/<slug>` (distinct from the project's shared orchestrator
 * and from feature workers, which use `feature/<slug>/<project>`). The UI uses
 * this convention to list features and keep them out of the Kanban board.
 */
export const FEATURE_COORDINATOR_BRANCH_PREFIX = "feature-orchestrator/";

export function isFeatureCoordinator(session: { branch: string | null }): boolean {
  return !!session.branch && session.branch.startsWith(FEATURE_COORDINATOR_BRANCH_PREFIX);
}

/** Extract the feature slug from a coordinator branch, or null if not one. */
export function featureSlugFromBranch(branch: string | null): string | null {
  if (!branch || !branch.startsWith(FEATURE_COORDINATOR_BRANCH_PREFIX)) return null;
  return branch.slice(FEATURE_COORDINATOR_BRANCH_PREFIX.length) || null;
}

/** All feature-coordinator sessions, optionally scoped to a project. */
export function listFeatureSessions(
  sessions: DashboardSession[] | null,
  projectId?: string,
): DashboardSession[] {
  return (sessions ?? []).filter(
    (s) => isFeatureCoordinator(s) && (!projectId || s.projectId === projectId),
  );
}
