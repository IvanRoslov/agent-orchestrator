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
 * When `description`/`slug` are provided (CLI path) the brief states them
 * directly. When omitted (UI "Start feature" button, where the human gives the
 * description in chat) the brief instructs the orchestrator to ask for the
 * description first and choose its own slug. `<slug>` then stands in for the
 * slug the orchestrator will pick.
 */
export function buildFeatureKickoff(opts: {
  linkedProjects: string[];
  description?: string;
  slug?: string;
}): string {
  const { linkedProjects, description, slug } = opts;
  const branchSlug = slug ?? "<slug>";
  const intro =
    description && slug
      ? [`Feature slug: ${slug}`, `Feature description: ${description}`]
      : [
          `The human will give you the feature description in this chat — ask for it first.`,
          `Then choose a short kebab-case slug for the feature and use it consistently.`,
        ];
  return [
    `Start a new cross-project feature. Read and follow skills/feature-orchestrator/SKILL.md as your operating procedure for the entire feature.`,
    ``,
    ...intro,
    `Linked projects (spawn workers only into these): ${linkedProjects.join(", ")}`,
    ``,
    `Key rules from the skill:`,
    `- Spawn each worker with: ao spawn --project <project> --branch feature/${branchSlug}/<project> --prompt "<short brief + slice>"`,
    `- All worker questions come back to you via "ao send <your-session-id>"; you answer from feature context or escalate to the human in this chat.`,
    `- Drive workers in lockstep through gates (brainstorm -> plan -> implement -> verify -> debug). Do not advance a gate until the human approves it here.`,
    `- The feature design doc lives in this hub repo under docs/superpowers/specs/.`,
    ``,
    `Begin with the research + brainstorm stage now.`,
  ].join("\n");
}
