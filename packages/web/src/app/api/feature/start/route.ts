import { type NextRequest, NextResponse } from "next/server";
import { buildFeatureKickoff, recordActivityEvent, slugifyFeature } from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import { validateIdentifier, validateConfiguredProject, validateString } from "@/lib/validation";

/**
 * Read a hub project's linkedProjects. The field is validated by the Zod schema
 * and present at runtime, but is not declared on the ProjectConfig interface in
 * types.ts (kept untouched for fork-mergeability), so read it via a cast.
 */
function readLinkedProjects(project: unknown): string[] {
  const value = (project as { linkedProjects?: string[] }).linkedProjects;
  return Array.isArray(value) ? value : [];
}

const MAX_NAME_LENGTH = 200;

/**
 * POST /api/feature/start — spawn a DEDICATED feature-orchestrator session in
 * the hub project (not the shared project orchestrator) on the
 * `feature-orchestrator/<slug>` branch, tasked with the cross-project feature
 * kickoff. Several features can run in parallel; the UI lists them by branch.
 * Returns the new session so the UI can open its terminal.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const projectErr = validateIdentifier(body.projectId, "projectId");
  if (projectErr) {
    return NextResponse.json({ error: projectErr }, { status: 400 });
  }

  const nameErr = validateString(body.name, "name", MAX_NAME_LENGTH);
  if (nameErr) {
    return NextResponse.json({ error: nameErr }, { status: 400 });
  }
  const name = String(body.name).trim();

  try {
    const { config, sessionManager } = await getServices();
    const projectId = body.projectId as string;
    const configProjectErr = validateConfiguredProject(config.projects, projectId);
    if (configProjectErr) {
      return NextResponse.json({ error: configProjectErr }, { status: 404 });
    }
    const project = config.projects[projectId];

    const linkedProjects = readLinkedProjects(project);
    if (linkedProjects.length === 0) {
      return NextResponse.json(
        {
          error: `Project "${projectId}" is not a feature hub. Add a linkedProjects: [...] list to its agent-orchestrator.yaml to start cross-project features from it.`,
          code: "no_linked_projects",
        },
        { status: 400 },
      );
    }

    const unknown = linkedProjects.filter((p) => !config.projects[p]);
    if (unknown.length > 0) {
      return NextResponse.json(
        {
          error: `linkedProjects references unregistered project(s): ${unknown.join(", ")}. Register them first.`,
          code: "unregistered_linked_projects",
        },
        { status: 400 },
      );
    }

    const slug = slugifyFeature(name);
    // Newlines stripped: sm.spawn passes the prompt to the agent launch; the
    // kickoff stays a single line (still a valid instruction for the agent).
    const kickoff = buildFeatureKickoff({ linkedProjects, description: name, slug }).replace(
      /[\r\n]+/g,
      " ",
    );

    const session = await sessionManager.spawn({
      projectId,
      prompt: kickoff,
      branch: `feature-orchestrator/${slug}`,
    });

    recordActivityEvent({
      projectId,
      sessionId: session.id,
      source: "api",
      kind: "api.feature_start_requested",
      summary: `feature "${slug}" started for ${projectId}`,
      data: { slug, name, linkedProjects },
    });

    return NextResponse.json(
      {
        feature: {
          sessionId: session.id,
          projectId,
          projectName: project.name,
          slug,
          name,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start feature";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
