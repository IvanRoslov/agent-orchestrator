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
    `FIRST, before anything else: ask the human to describe the feature or task — what are we building, why, and any constraints. Do NOT infer scope, draft a plan, write a doc, or spawn workers from the title alone. Ask "What are we building? Describe the feature or task.", wait for their answer, ask follow-ups as needed, and only then begin the research + brainstorm stage.`,
    ``,
    `Linked projects (spawn workers only into these): ${linkedProjects.join(", ")}`,
    ``,
    `Key rules from the skill:`,
    `- One worker per task = one PR. Spawn a SEPARATE worker for each task; never funnel multiple PRs through one worker and never restore a finished worker to give it a new task — spawn a fresh one. Run INDEPENDENT tasks in parallel (spawn their workers concurrently); only serialize on real dependencies.`,
    `- Spawn each worker with: ao spawn --project <project> --branch feature/${branchSlug}/<task> --prompt "<short brief>" (where <task> is a short unique kebab name, e.g. api-auth).`,
    `- All worker questions come back to you via "ao send <your-session-id>"; you answer from feature context or escalate to the human in this chat.`,
    `- Drive workers in lockstep through gates (brainstorm -> plan -> implement -> verify -> debug). Do not advance a gate until the human approves it here.`,
    `- The feature design doc lives in this hub repo under docs/superpowers/specs/.`,
  ].join("\n");
}
