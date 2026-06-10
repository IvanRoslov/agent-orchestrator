/**
 * Shared helpers for kicking off a cross-project feature orchestrator.
 * Used by the `ao feature` CLI command and the web "Start feature" action so
 * both produce an identical orchestrator brief.
 */

/** Derive a stable, filesystem/branch-safe feature slug from a description. */
export function slugifyFeature(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .split("-")
    .filter(Boolean)
    .slice(0, 5)
    .join("-");
  return slug || "feature";
}

/**
 * Build the kickoff message sent to the hub orchestrator to begin a feature.
 *
 * The feature name/slug (when provided) is only a short LABEL — never the spec.
 * The brief always instructs the orchestrator to ASK the human to describe the
 * feature/task first, before inferring scope, planning, or spawning workers.
 * `<slug>` stands in for the slug when none was provided.
 */
export function buildFeatureKickoff(opts: {
  linkedProjects: string[];
  description?: string;
  slug?: string;
}): string {
  const { linkedProjects, description, slug } = opts;
  const branchSlug = slug ?? "<slug>";
  const titleLine =
    description && slug
      ? `Feature title (a short label only — NOT the spec): "${description}" (slug: ${slug})`
      : `No title was given yet.`;
  return [
    `You are the orchestrator for a new cross-project feature. Read and follow skills/feature-orchestrator/SKILL.md as your operating procedure for the entire feature.`,
    ``,
    titleLine,
    ``,
    `FIRST, before anything else: ask the human to describe the feature or task — what are we building, why, and any constraints. Don't act on the title alone (no inferring scope, planning, spawning, or writing before you understand the goal). Ask "What are we building? Describe the feature or task.", wait for their answer, ask follow-ups as needed, and only then begin the research + brainstorm stage.`,
    ``,
    `Linked projects (spawn workers only into these): ${linkedProjects.join(", ")}`,
    ``,
    `Key rules from the skill:`,
    `- You run INSIDE the hub repo. You MAY do hub-repo work yourself — edit/commit files and open PRs in THIS repo (the feature design doc, hub-level docs, etc.) — without spawning a worker. Use workers for the LINKED projects, which you can't edit directly.`,
    `- Default to one worker per task = one PR, and run INDEPENDENT tasks in parallel (spawn their workers concurrently) rather than funneling many PRs through a single worker. Spawn a fresh worker for new, unrelated work; reuse/restore an existing worker only when the new work is a close follow-up and its live context will make the fix faster — your judgment.`,
    `- Spawn each worker with: ao spawn --project <project> --branch feature/${branchSlug}/<task> --prompt "<short brief>" (where <task> is a short unique kebab name, e.g. api-auth).`,
    `- All worker questions come back to you via "ao send <your-session-id>"; you answer from feature context or escalate to the human in this chat.`,
    `- Drive workers in lockstep through gates (brainstorm -> plan -> implement -> verify -> debug). Do not advance a gate until the human approves it here.`,
    `- The feature design doc lives in this hub repo under docs/superpowers/specs/ — commit it (open a hub PR if that's your workflow).`,
  ].join("\n");
}
