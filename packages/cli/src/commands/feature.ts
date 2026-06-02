import chalk from "chalk";
import type { Command } from "commander";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildFeatureKickoff,
  getGlobalConfigPath,
  loadConfig,
  slugifyFeature,
  type OrchestratorConfig,
} from "@aoagents/ao-core";
import { DEFAULT_PORT } from "../lib/constants.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";
import { getRunning } from "../lib/running-state.js";
import { projectSessionUrl } from "../lib/routes.js";

// Re-export the shared kickoff helpers (canonical impl lives in ao-core) so
// existing CLI tests importing them from this module keep working.
export { buildFeatureKickoff, slugifyFeature };

/**
 * Load a config that includes ALL registered projects. Feature commands are
 * inherently cross-project: the hub orchestrator spawns workers into linked
 * projects, and `ao feature status` must list sessions across them. A config
 * resolved from the local project dir only contains that one project, so prefer
 * the global config (same pattern as `ao stop`). Falls back to the local config
 * when no global config exists.
 */
function loadAllProjectsConfig(): OrchestratorConfig {
  const localConfig = loadConfig();
  const globalPath = getGlobalConfigPath();
  if (existsSync(globalPath)) {
    return loadConfig(globalPath);
  }
  return localConfig;
}


/**
 * Read the hub project's linkedProjects. The field is validated by the Zod
 * schema and present at runtime, but is not declared on the ProjectConfig
 * interface in types.ts (which we keep untouched for fork-mergeability), so we
 * read it through a cast.
 */
function readLinkedProjects(project: unknown): string[] {
  const value = (project as { linkedProjects?: string[] }).linkedProjects;
  return Array.isArray(value) ? value : [];
}

/** Resolve the hub project: explicit --hub, else AO_PROJECT_ID, else single
 *  project, else cwd match. Throws with an actionable message otherwise. */
function resolveHubProject(config: OrchestratorConfig, hubOverride?: string): string {
  if (hubOverride) {
    if (!config.projects[hubOverride]) {
      throw new Error(
        `Unknown hub project: ${hubOverride}\nAvailable: ${Object.keys(config.projects).join(", ")}`,
      );
    }
    return hubOverride;
  }
  const ids = Object.keys(config.projects);
  if (ids.length === 0) throw new Error("No projects configured. Run 'ao start' first.");
  const envProject = process.env.AO_PROJECT_ID;
  if (envProject && config.projects[envProject]) return envProject;
  if (ids.length === 1) return ids[0];
  const matched = findProjectForDirectory(config.projects, resolve(process.cwd()));
  if (matched) return matched;
  throw new Error(
    `Multiple projects configured. Specify one with --hub <project>: ${ids.join(", ")}`,
  );
}

async function featureStart(
  description: string,
  opts: { hub?: string; agent?: string },
): Promise<void> {
  const config = loadAllProjectsConfig();

  let hubId: string;
  try {
    hubId = resolveHubProject(config, opts.hub);
  } catch (err) {
    console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
    process.exit(1);
  }

  const hub = config.projects[hubId];
  const linkedProjects = readLinkedProjects(hub);
  if (linkedProjects.length === 0) {
    console.error(
      chalk.red(
        `✗ Hub project "${hubId}" has no linkedProjects. Add a linkedProjects: [...] list to its agent-orchestrator.yaml.`,
      ),
    );
    process.exit(1);
  }

  const unknown = linkedProjects.filter((p) => !config.projects[p]);
  if (unknown.length > 0) {
    console.error(
      chalk.red(
        `✗ linkedProjects references unregistered project(s): ${unknown.join(", ")}.\n` +
          `Register them with \`ao start <project>\` first. Known: ${Object.keys(config.projects).join(", ")}`,
      ),
    );
    process.exit(1);
  }

  const running = await getRunning();
  if (!running) {
    console.error(
      chalk.red(
        "✗ AO is not running. Run `ao start` so the orchestrator can be created and polled.",
      ),
    );
    process.exit(1);
  }
  if (!running.projects.includes(hubId)) {
    console.error(
      chalk.red(
        `✗ The running AO instance is not polling hub project "${hubId}". Run \`ao start ${hubId}\`.`,
      ),
    );
    process.exit(1);
  }

  const slug = slugifyFeature(description);
  const sm = await getSessionManager(config);

  // Spawn a DEDICATED feature-orchestrator session — not the project's shared
  // orchestrator. This keeps the standard orchestrator untouched and lets
  // several features run in parallel. The session is identified by the
  // `feature-orchestrator/<slug>` branch convention (the UI lists these).
  const kickoff = buildFeatureKickoff({ slug, description, linkedProjects }).replace(
    /[\r\n]+/g,
    " ",
  );
  const session = await sm.spawn({
    projectId: hubId,
    prompt: kickoff,
    branch: `feature-orchestrator/${slug}`,
    agent: opts.agent,
  });

  const port = config.port ?? DEFAULT_PORT;
  console.log(chalk.green(`✓ Feature "${slug}" started on hub "${hubId}".`));
  console.log(`  Session: ${chalk.green(session.id)}`);
  console.log(`  Linked:  ${linkedProjects.join(", ")}`);
  console.log(`  View:    ${chalk.dim(projectSessionUrl(port, hubId, session.id))}`);
  console.log(`  Track:   ${chalk.dim(`ao feature status ${slug}`)}`);
  console.log(`SLUG=${slug}`);
  console.log(`SESSION=${session.id}`);
}

async function featureStatus(slug: string): Promise<void> {
  const config = loadAllProjectsConfig();
  const sm = await getSessionManager(config);
  const all = await sm.list();

  const coordinatorBranch = `feature-orchestrator/${slug}`;
  const workerPrefix = `feature/${slug}/`;
  const coordinators = all.filter((s) => s.branch === coordinatorBranch);
  const workers = all.filter((s) => s.branch?.startsWith(workerPrefix));

  if (coordinators.length === 0 && workers.length === 0) {
    console.log(chalk.yellow(`No sessions found for feature "${slug}".`));
    console.log(
      chalk.dim(
        `Expected a coordinator on ${coordinatorBranch} and workers on ${workerPrefix}<project>.`,
      ),
    );
    return;
  }

  const line = (s: (typeof all)[number]) => {
    const pr = s.pr?.url ? ` ${chalk.dim(s.pr.url)}` : "";
    return `  ${chalk.green(s.id)}  [${s.projectId}]  ${s.status}  ${chalk.dim(s.branch ?? "")}${pr}`;
  };

  console.log(chalk.bold(`Feature: ${slug}`));
  for (const c of coordinators) console.log(line(c) + chalk.dim("  (orchestrator)"));
  for (const w of workers) console.log(line(w));
}

export function registerFeature(program: Command): void {
  const feature = program
    .command("feature")
    .description("Drive a cross-project feature via an orchestrator");

  feature
    .command("start")
    .description("Start a feature: kick the hub orchestrator into feature mode")
    .argument("<description...>", "What the feature is")
    .option("--hub <project>", "Hub project id (defaults to the current/only project)")
    .option("--agent <name>", "Override the orchestrator agent plugin")
    .action(async (descriptionParts: string[], opts: { hub?: string; agent?: string }) => {
      await featureStart(descriptionParts.join(" "), opts);
    });

  feature
    .command("status")
    .description("Show the workers participating in a feature")
    .argument("<slug>", "Feature slug (printed by `ao feature start`)")
    .action(async (slug: string) => {
      await featureStatus(slug);
    });
}
