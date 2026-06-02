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

  const orchestrator = await sm.ensureOrchestrator({ projectId: hubId, agent: opts.agent });
  const kickoff = buildFeatureKickoff({ slug, description, linkedProjects });
  await sm.send(orchestrator.id, kickoff);

  const port = config.port ?? DEFAULT_PORT;
  console.log(chalk.green(`✓ Feature "${slug}" started on hub "${hubId}".`));
  console.log(`  Orchestrator: ${chalk.green(orchestrator.id)}`);
  console.log(`  Linked:       ${linkedProjects.join(", ")}`);
  console.log(`  View:         ${chalk.dim(projectSessionUrl(port, hubId, orchestrator.id))}`);
  console.log(`  Track:        ${chalk.dim(`ao feature status ${slug}`)}`);
  console.log(`SLUG=${slug}`);
}

async function featureStatus(slug: string): Promise<void> {
  const config = loadAllProjectsConfig();
  const sm = await getSessionManager(config);
  const all = await sm.list();

  const branchPrefix = `feature/${slug}/`;
  const workers = all.filter((s) => s.branch?.startsWith(branchPrefix));

  if (workers.length === 0) {
    console.log(chalk.yellow(`No workers found for feature "${slug}" (branch ${branchPrefix}*).`));
    console.log(
      chalk.dim(
        "Workers appear once the orchestrator spawns them on feature/<slug>/<project> branches.",
      ),
    );
    return;
  }

  console.log(chalk.bold(`Feature: ${slug}`));
  for (const w of workers) {
    const pr = w.pr?.url ? ` ${chalk.dim(w.pr.url)}` : "";
    console.log(
      `  ${chalk.green(w.id)}  [${w.projectId}]  ${w.status}  ${chalk.dim(w.branch ?? "")}${pr}`,
    );
  }
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
