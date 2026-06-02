import { type NextRequest, NextResponse } from "next/server";
import {
  buildFeatureKickoff,
  generateOrchestratorPrompt,
  recordActivityEvent,
} from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import { validateIdentifier, validateConfiguredProject } from "@/lib/validation";

/**
 * Read a hub project's linkedProjects. The field is validated by the Zod schema
 * and present at runtime, but is not declared on the ProjectConfig interface in
 * types.ts (kept untouched for fork-mergeability), so read it via a cast.
 */
function readLinkedProjects(project: unknown): string[] {
  const value = (project as { linkedProjects?: string[] }).linkedProjects;
  return Array.isArray(value) ? value : [];
}

/**
 * POST /api/feature/start — ensure the hub project's orchestrator exists and
 * send it the cross-project feature kickoff (no description; the human gives it
 * in chat). Returns the orchestrator so the UI can open its terminal.
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

    const systemPrompt = generateOrchestratorPrompt({ config, projectId, project });
    const orchestrator = await sessionManager.ensureOrchestrator({ projectId, systemPrompt });

    const kickoff = buildFeatureKickoff({ linkedProjects });
    await sessionManager.send(orchestrator.id, kickoff);

    recordActivityEvent({
      projectId,
      sessionId: orchestrator.id,
      source: "api",
      kind: "api.feature_start_requested",
      summary: `feature start requested for ${projectId}`,
      data: { linkedProjects },
    });

    return NextResponse.json(
      {
        orchestrator: {
          id: orchestrator.id,
          projectId,
          projectName: project.name,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to start feature";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
