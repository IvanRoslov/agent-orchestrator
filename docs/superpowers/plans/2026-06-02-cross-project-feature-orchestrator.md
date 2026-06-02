# Cross-Project Feature Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a feature-level orchestrator that lives in a hub project, spawns workers across linked projects, and drives them through gated superpowers stages — without touching sensitive core files.

**Architecture:** Skill-first. A new `skills/feature-orchestrator/SKILL.md` is the pipeline brain; it composes the existing superpowers skills (`brainstorming` → `writing-plans` → `subagent-driven-development`) and the existing AO primitives (`ao spawn`, `ao send`). A new `ao feature` CLI command kicks the hub's orchestrator into feature mode. Cross-project worker spawning uses new `--project`/`--branch` flags on `ao spawn`. Feature identity is encoded in the worker branch convention `feature/<slug>/<project>` so no session metadata schema changes are needed. The hub project declares its in-scope repos via a new optional `linkedProjects` config field.

**Tech Stack:** TypeScript (strict, ES2022), pnpm workspace, commander (CLI), Zod (config), Vitest. Repo root: `/Users/ivanroslov/projects/agent-orchestrator`.

**Fork-mergeability rule (do not violate):** Do NOT edit `packages/core/src/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`, or `prompt-builder.ts`. Allowed edits: new files, CLI command files (`packages/cli/src/commands/*`, `program.ts`), and exactly one field added to `ProjectConfigSchema` in `config.ts`.

**Note — deviation from spec (intentional, surface at review):** The spec proposed `.passthrough()` on the project schema to carry `linkedProjects`. This plan instead adds an explicit typed field `linkedProjects: z.array(z.string()).optional()`. Same 1-line cost and same edit region, but it is typed (CLI reads `project.linkedProjects` without casts) and does not loosen validation for every other unknown key. Equivalent merge risk.

---

## File Structure

| File | Responsibility | New/Modify |
|------|----------------|------------|
| `packages/core/src/config.ts` | Add `linkedProjects` to `ProjectConfigSchema` (1 line) | Modify |
| `packages/core/__tests__/config.test.ts` | Assert `linkedProjects` parses + is preserved | Modify |
| `packages/cli/src/commands/spawn.ts` | Add `--project` + `--branch` flags; extract `applyProjectOverride` | Modify |
| `packages/cli/__tests__/commands/spawn-project-override.test.ts` | Unit-test `applyProjectOverride` | New |
| `packages/cli/src/commands/feature.ts` | `ao feature start` / `ao feature status`; pure `slugifyFeature` + `buildFeatureKickoff` | New |
| `packages/cli/__tests__/commands/feature.test.ts` | Unit-test `slugifyFeature` + `buildFeatureKickoff` | New |
| `packages/cli/src/program.ts` | Register `feature` command (1 import + 1 call) | Modify |
| `packages/cli/__tests__/program.test.ts` | Assert `feature` command + subcommands registered | Modify |
| `skills/feature-orchestrator/SKILL.md` | Pipeline brain followed by the orchestrator | New |
| `skills/README.md` | Add skill to the table | Modify |
| `CLAUDE.md` | Add skill to the Skills table | Modify |

---

## Task 1: `linkedProjects` config field

**Files:**
- Modify: `packages/core/src/config.ts:247-277` (inside `ProjectConfigSchema`)
- Test: `packages/core/__tests__/config.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block at the end of `packages/core/__tests__/config.test.ts`, inside the top-level `describe("Config Loading", ...)` (before its closing `});`):

```typescript
  describe("linkedProjects", () => {
    it("parses and preserves linkedProjects on a project", () => {
      const configPath = join(testDir, "agent-orchestrator.yaml");
      writeFileSync(
        configPath,
        [
          "projects:",
          "  hub:",
          "    path: .",
          "    linkedProjects:",
          "      - api-repo",
          "      - web-repo",
        ].join("\n"),
      );

      const config = loadConfig();
      expect(config.projects.hub.linkedProjects).toEqual(["api-repo", "web-repo"]);
    });

    it("leaves linkedProjects undefined when absent", () => {
      const configPath = join(testDir, "agent-orchestrator.yaml");
      writeFileSync(configPath, ["projects:", "  hub:", "    path: ."].join("\n"));

      const config = loadConfig();
      expect(config.projects.hub.linkedProjects).toBeUndefined();
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-core test -- config.test.ts`
Expected: FAIL — first test errors because `linkedProjects` is stripped by Zod (`expected ["api-repo","web-repo"], received undefined`). (TypeScript may also error that `linkedProjects` is not a property — that is part of the red state.)

- [ ] **Step 3: Add the field to the schema**

In `packages/core/src/config.ts`, inside `ProjectConfigSchema` (the `z.object({...})` starting at line 247), add this line immediately after `path: z.string(),` (line 250):

```typescript
  /** Hub-project feature scope: ids of already-registered projects a feature
   *  orchestrator may spawn workers into. Read by `ao feature`. */
  linkedProjects: z.array(z.string()).optional(),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-core test -- config.test.ts`
Expected: PASS (both new tests green).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aoagents/ao-core typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/config.ts packages/core/__tests__/config.test.ts
git commit -m "feat(core): add optional linkedProjects field to project config"
```

---

## Task 2: `--project` and `--branch` flags on `ao spawn`

Lets the feature orchestrator spawn a worker into a linked project on a feature-convention branch: `ao spawn --project web-repo --branch feature/<slug>/web-repo --prompt "..."`.

**Files:**
- Modify: `packages/cli/src/commands/spawn.ts`
- Test: `packages/cli/__tests__/commands/spawn-project-override.test.ts` (new)

- [ ] **Step 1: Write the failing test**

Create `packages/cli/__tests__/commands/spawn-project-override.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "@aoagents/ao-core";
import { applyProjectOverride } from "../../src/commands/spawn.js";

function fakeConfig(projectIds: string[]): OrchestratorConfig {
  const projects: Record<string, unknown> = {};
  for (const id of projectIds) projects[id] = { path: "." };
  return { projects } as unknown as OrchestratorConfig;
}

describe("applyProjectOverride", () => {
  it("uses the override project and treats the issue arg as a bare issue id", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(applyProjectOverride(config, "web-repo", "42")).toEqual({
      projectId: "web-repo",
      issueId: "42",
    });
  });

  it("uses the override project with no issue", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(applyProjectOverride(config, "web-repo", undefined)).toEqual({
      projectId: "web-repo",
      issueId: undefined,
    });
  });

  it("throws a listing error for an unknown override project", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(() => applyProjectOverride(config, "nope", undefined)).toThrow(/Unknown project: nope/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-cli test -- spawn-project-override.test.ts`
Expected: FAIL — `applyProjectOverride` is not exported (`SyntaxError`/`undefined is not a function`).

- [ ] **Step 3: Add the exported helper**

In `packages/cli/src/commands/spawn.ts`, immediately after `resolveProjectAndIssue` (after line 96), add:

```typescript
/**
 * Apply an explicit `--project` override. When set, the project must be a
 * registered project and the optional `issue` arg is treated as a bare issue id
 * for that project (no prefix routing). When unset, defer to
 * `resolveProjectAndIssue` (auto-detect / prefix routing).
 */
export function applyProjectOverride(
  config: OrchestratorConfig,
  projectOverride: string | undefined,
  issue: string | undefined,
): { projectId: string; issueId?: string } {
  if (projectOverride) {
    if (!config.projects[projectOverride]) {
      throw new Error(
        `Unknown project: ${projectOverride}. Available: ${Object.keys(config.projects).join(", ")}`,
      );
    }
    return { projectId: projectOverride, issueId: issue };
  }
  return resolveProjectAndIssue(config, issue);
}
```

- [ ] **Step 4: Thread `--branch` into the spawn call**

In `spawnSession` (signature at line 199), add a `branch` parameter at the end of the parameter list:

```typescript
async function spawnSession(
  config: OrchestratorConfig,
  projectId: string,
  issueId?: string,
  openTab?: boolean,
  agent?: string,
  claimOptions?: SpawnClaimOptions,
  prompt?: string,
  branch?: string,
): Promise<void> {
```

Then in the `sm.spawn({...})` call (lines 234-239), add the branch field:

```typescript
    const session = await sm.spawn({
      projectId,
      issueId,
      agent,
      prompt: sanitizedPrompt,
      branch,
    });
```

- [ ] **Step 5: Add the flags and use the override in the action**

In `registerSpawn` add two options after the `--prompt` option (after line 310):

```typescript
    .option("--project <id>", "Target a specific registered project by id (overrides auto-detect)")
    .option("--branch <name>", "Branch name for the new session's workspace")
```

Update the `opts` type in the action (lines 314-320) to include the new fields:

```typescript
        opts: {
          open?: boolean;
          agent?: string;
          claimPr?: string;
          assignOnGithub?: boolean;
          prompt?: string;
          project?: string;
          branch?: string;
        },
```

Replace the resolution call (line 338) from:

```typescript
          ({ projectId, issueId } = resolveProjectAndIssue(config, issue));
```

to:

```typescript
          ({ projectId, issueId } = applyProjectOverride(config, opts.project, issue));
```

Pass `branch` into the `spawnSession(...)` call (lines 376-384) as the final argument:

```typescript
          await spawnSession(
            config,
            projectId,
            issueId,
            opts.open,
            opts.agent,
            claimOptions,
            opts.prompt,
            opts.branch,
          );
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-cli test -- spawn-project-override.test.ts`
Expected: PASS (3 tests green).

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @aoagents/ao-cli typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/commands/spawn.ts packages/cli/__tests__/commands/spawn-project-override.test.ts
git commit -m "feat(cli): add --project and --branch flags to ao spawn"
```

---

## Task 3: `ao feature` command (start + status)

**Files:**
- Create: `packages/cli/src/commands/feature.ts`
- Test: `packages/cli/__tests__/commands/feature.test.ts` (new)
- Modify (Task 4): `packages/cli/src/program.ts`

- [ ] **Step 1: Write the failing test for the pure helpers**

Create `packages/cli/__tests__/commands/feature.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { slugifyFeature, buildFeatureKickoff } from "../../src/commands/feature.js";

describe("slugifyFeature", () => {
  it("kebab-cases and trims to the first words", () => {
    expect(slugifyFeature("Add SSO login across web and API")).toBe("add-sso-login-across-web");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyFeature("Billing: v2 (rework!)")).toBe("billing-v2-rework");
  });

  it("falls back to 'feature' when nothing usable remains", () => {
    expect(slugifyFeature("!!! ???")).toBe("feature");
  });
});

describe("buildFeatureKickoff", () => {
  const msg = buildFeatureKickoff({
    slug: "add-sso",
    description: "Add SSO login",
    linkedProjects: ["api-repo", "web-repo"],
  });

  it("points the orchestrator at the skill file", () => {
    expect(msg).toContain("skills/feature-orchestrator/SKILL.md");
  });

  it("includes the slug, description, and every linked project", () => {
    expect(msg).toContain("add-sso");
    expect(msg).toContain("Add SSO login");
    expect(msg).toContain("api-repo");
    expect(msg).toContain("web-repo");
  });

  it("states the worker branch convention", () => {
    expect(msg).toContain("feature/add-sso/<project>");
  });

  it("states the question-funnel rule", () => {
    expect(msg).toMatch(/ao send/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-cli test -- feature.test.ts`
Expected: FAIL — cannot resolve `../../src/commands/feature.js` (module does not exist).

- [ ] **Step 3: Create the command file with the pure helpers + command registration**

Create `packages/cli/src/commands/feature.ts`:

```typescript
import chalk from "chalk";
import type { Command } from "commander";
import { resolve } from "node:path";
import { loadConfig, type OrchestratorConfig } from "@aoagents/ao-core";
import { DEFAULT_PORT } from "../lib/constants.js";
import { getSessionManager } from "../lib/create-session-manager.js";
import { findProjectForDirectory } from "../lib/project-resolution.js";
import { getRunning } from "../lib/running-state.js";
import { projectSessionUrl } from "../lib/routes.js";

/** Derive a stable, filesystem/branch-safe feature slug from a description. */
export function slugifyFeature(description: string): string {
  const slug = description
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-") // non-alphanumerics → hyphen
    .replace(/^-+|-+$/g, "") // trim leading/trailing hyphens
    .split("-")
    .filter(Boolean)
    .slice(0, 5) // keep it short
    .join("-");
  return slug || "feature";
}

/** Build the kickoff message sent to the hub orchestrator to begin a feature. */
export function buildFeatureKickoff(opts: {
  slug: string;
  description: string;
  linkedProjects: string[];
}): string {
  const { slug, description, linkedProjects } = opts;
  return [
    `Start a new cross-project feature. Read and follow skills/feature-orchestrator/SKILL.md as your operating procedure for the entire feature.`,
    ``,
    `Feature slug: ${slug}`,
    `Feature description: ${description}`,
    `Linked projects (spawn workers only into these): ${linkedProjects.join(", ")}`,
    ``,
    `Key rules from the skill:`,
    `- Spawn each worker with: ao spawn --project <project> --branch feature/${slug}/<project> --prompt "<short brief + slice>"`,
    `- All worker questions come back to you via "ao send ${"<your-session-id>"}"; you answer from feature context or escalate to the human in this chat.`,
    `- Drive workers in lockstep through gates (brainstorm → plan → implement → verify → debug). Do not advance a gate until the human approves it here.`,
    `- The feature design doc lives in this hub repo under docs/superpowers/specs/.`,
    ``,
    `Begin with the research + brainstorm stage now.`,
  ].join("\n");
}

/** Resolve the hub project: explicit --hub, else AO_PROJECT_ID, else single
 *  project, else cwd match. Throws with an actionable message otherwise. */
function resolveHubProject(config: OrchestratorConfig, hubOverride?: string): string {
  if (hubOverride) {
    if (!config.projects[hubOverride]) {
      throw new Error(
        `Unknown hub project: ${hubOverride}. Available: ${Object.keys(config.projects).join(", ")}`,
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
  throw new Error(`Multiple projects configured. Specify one with --hub <project>: ${ids.join(", ")}`);
}

async function featureStart(
  description: string,
  opts: { hub?: string; agent?: string },
): Promise<void> {
  const config = loadConfig();

  let hubId: string;
  try {
    hubId = resolveHubProject(config, opts.hub);
  } catch (err) {
    console.error(chalk.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  const hub = config.projects[hubId];
  const linkedProjects = hub.linkedProjects ?? [];
  if (linkedProjects.length === 0) {
    console.error(
      chalk.red(
        `Hub project "${hubId}" has no linkedProjects. Add a linkedProjects: [...] list to its agent-orchestrator.yaml.`,
      ),
    );
    process.exit(1);
  }

  const unknown = linkedProjects.filter((p) => !config.projects[p]);
  if (unknown.length > 0) {
    console.error(
      chalk.red(
        `linkedProjects references unregistered project(s): ${unknown.join(", ")}.\n` +
          `Register them with \`ao start <project>\` first. Known: ${Object.keys(config.projects).join(", ")}`,
      ),
    );
    process.exit(1);
  }

  const running = await getRunning();
  if (!running) {
    console.error(
      chalk.red("AO is not running. Run `ao start` so the orchestrator can be created and polled."),
    );
    process.exit(1);
  }
  if (!running.projects.includes(hubId)) {
    console.error(chalk.red(`The running AO instance is not polling hub project "${hubId}". Run \`ao start ${hubId}\`.`));
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
  const config = loadConfig();
  const sm = await getSessionManager(config);
  const all = await sm.list();

  const branchPrefix = `feature/${slug}/`;
  const workers = all.filter((s) => s.branch?.startsWith(branchPrefix));

  if (workers.length === 0) {
    console.log(chalk.yellow(`No workers found for feature "${slug}" (branch ${branchPrefix}*).`));
    console.log(chalk.dim("Workers appear once the orchestrator spawns them on feature/<slug>/<project> branches."));
    return;
  }

  console.log(chalk.bold(`Feature: ${slug}`));
  for (const w of workers) {
    const pr = w.pr?.url ? ` ${chalk.dim(w.pr.url)}` : "";
    console.log(`  ${chalk.green(w.id)}  [${w.projectId}]  ${w.status}  ${chalk.dim(w.branch ?? "")}${pr}`);
  }
}

export function registerFeature(program: Command): void {
  const feature = program.command("feature").description("Drive a cross-project feature via an orchestrator");

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-cli test -- feature.test.ts`
Expected: PASS (all `slugifyFeature` + `buildFeatureKickoff` tests green).

> If `slugifyFeature("Add SSO login across web and API")` does not equal
> `"add-sso-login-across-web"`, the `.slice(0, 5)` is keeping the wrong count —
> the words are `add, sso, login, across, web` (5 words). Do not change the test;
> fix the implementation to match.

- [ ] **Step 5: Verify imports resolve (typecheck)**

Run: `pnpm --filter @aoagents/ao-cli typecheck`
Expected: no errors. If `sm.send` or `sm.ensureOrchestrator` types mismatch, confirm signatures against `packages/core/src/session-manager.ts` (`ensureOrchestrator(orchestratorConfig: OrchestratorSpawnConfig)`, `send(sessionName, message)`).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/commands/feature.ts packages/cli/__tests__/commands/feature.test.ts
git commit -m "feat(cli): add ao feature start/status command"
```

---

## Task 4: Register the `feature` command

**Files:**
- Modify: `packages/cli/src/program.ts:1-22` (imports) and `:57` (registration)
- Test: `packages/cli/__tests__/program.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/__tests__/program.test.ts`, inside `describe("createProgram", ...)`:

```typescript
  it("registers the feature command with start and status subcommands", () => {
    const feature = createProgram().commands.find((command) => command.name() === "feature");
    expect(feature).toBeDefined();
    const subs = feature?.commands.map((c) => c.name()) ?? [];
    expect(subs).toContain("start");
    expect(subs).toContain("status");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-cli test -- program.test.ts`
Expected: FAIL — `feature` is undefined.

- [ ] **Step 3: Register the command**

In `packages/cli/src/program.ts`, add the import after line 22 (`import { registerConfig } from "./commands/config.js";`):

```typescript
import { registerFeature } from "./commands/feature.js";
```

And add the registration call after `registerConfig(program);` (line 57):

```typescript
  registerFeature(program);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-cli test -- program.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/program.ts packages/cli/__tests__/program.test.ts
git commit -m "feat(cli): register feature command in program"
```

---

## Task 5: The `feature-orchestrator` skill

This is the pipeline brain. It is a markdown procedure (no automated test — verified by review; the kickoff-message test in Task 3 already asserts the orchestrator is pointed at this file and the branch/funnel conventions match).

**Files:**
- Create: `skills/feature-orchestrator/SKILL.md`
- Modify: `skills/README.md` (table)
- Modify: `CLAUDE.md` (Skills table)

- [ ] **Step 1: Create the skill**

Create `skills/feature-orchestrator/SKILL.md`:

````markdown
---
name: feature-orchestrator
description: Drive a single feature end-to-end across multiple linked projects — own the feature doc, spawn and coordinate workers, funnel their questions, and gate them through brainstorm → plan → implement → verify → debug.
trigger: You are a hub-project orchestrator that received an "ao feature start" kickoff message, or the user asks you to run a cross-project feature.
---

# Feature Orchestrator Skill

You are the **feature orchestrator**. You own one feature end-to-end across
several linked projects. You hold the full context; workers see only their slice.
You talk to the human; workers talk to you.

## Inputs you were given (in the kickoff message)

- **Feature slug** — use it verbatim for branches and tracking.
- **Feature description** — what to build.
- **Linked projects** — the ONLY projects you may spawn workers into.

## The pipeline (lockstep with gates)

```
research → brainstorm → plan → implement → verify → debug ⟲ → done
```

Between every stage is a **gate**. Hold ALL workers at the current stage. Advance
the whole group only after the **human approves the gate in this chat**. Never let
a worker run ahead of a gate.

### Stage 1 — research + brainstorm (you + the human)

1. Research the feature across the hub docs and linked repos.
2. Run `superpowers:brainstorming` WITH the human to produce the feature design
   doc. Save it in THIS hub repo at
   `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` and commit it.
3. Decompose the feature into one **slice per linked project** (what that repo
   must change, and the cross-project contracts between slices).
4. **GATE:** present the doc + the per-project slices to the human. Wait for
   explicit approval before spawning anyone.

### Stage 2 — spawn workers + worker brainstorm

For each in-scope linked project, spawn a worker:

```
ao spawn --project <project> --branch feature/<slug>/<project> --prompt "<concise brief>"
```

The `--prompt` is length-limited and strips newlines, so keep it short (slug +
one-line slice + "you are part of feature <slug>; send all questions to
orchestrator <your-session-id> via ao send; follow skills/feature-worker
instructions below"). Immediately after spawn, deliver the FULL brief:

```
ao send <worker-session-id> --file <path-to-brief.md>
```

The full brief must contain: the worker's slice, the relevant excerpt of the
feature doc, the cross-project contracts it must honor, and these standing rules:

- Run `superpowers:brainstorming` for your slice. Route EVERY clarifying question
  to me with `ao send <orchestrator-session-id> "<question>"`. Do not guess.
- Then `superpowers:writing-plans`, then `superpowers:subagent-driven-development`
  (TDD via subagents). Do NOT cross a stage gate until I tell you to.

**Question funnel:** when a worker sends you a question, answer it from the feature
context if you can. If you cannot, ask the human HERE, then relay the answer.
The human only ever talks to you.

**GATE:** when all workers finish brainstorming, summarize the slice specs to the
human and wait for approval.

### Stage 3 — plan

Tell each worker to run `superpowers:writing-plans`. Collect plans, check the
cross-project contracts still line up, surface conflicts to the human.
**GATE:** human approves the plans.

### Stage 4 — implement (TDD)

Tell each worker to run `superpowers:subagent-driven-development`. They implement,
test, and open PRs in their own repos. Track them with `ao feature status <slug>`.
**GATE:** human approves moving to verify.

### Stage 5 — verify

Each worker confirms its slice works (tests pass, PR green). You aggregate status
and report to the human.

### Stage 6 — debug (loop)

For each bug the human reports, decide which project owns it, then spawn (or
re-message) a fixup worker on the same `feature/<slug>/<project>` branch with a
focused brief. Loop until the human says the feature is done.

## Tracking

- `ao feature status <slug>` lists all workers (it finds them by the
  `feature/<slug>/<project>` branch convention). Keep the worker session IDs and
  their current stage in the feature doc as your durable record.

## Hard rules

- Spawn workers ONLY into the linked projects from the kickoff message.
- Always use the branch `feature/<slug>/<project>` — tracking depends on it.
- Gates are yours to hold. When in doubt, hold and ask the human.
- Keep the feature doc current; it is the single source of truth.
````

- [ ] **Step 2: Add the skill to `skills/README.md`**

In `skills/README.md`, add this row to the "Available Skills" table (after the `social-media/` row):

```markdown
| [`feature-orchestrator/`](feature-orchestrator/SKILL.md) | Drive a feature end-to-end across multiple linked projects — own the doc, spawn/coordinate workers, gate them through brainstorm → plan → implement → verify → debug |
```

- [ ] **Step 3: Add the skill to `CLAUDE.md`**

In `CLAUDE.md`, in the `## Skills` table, add this row (after the `social-media` row):

```markdown
| [`skills/feature-orchestrator/SKILL.md`](skills/feature-orchestrator/SKILL.md) | Orchestrate a cross-project feature: own the doc, spawn workers in linked projects, gate stages, funnel questions |
```

- [ ] **Step 4: Verify the kickoff message and skill agree**

Run: `pnpm --filter @aoagents/ao-cli test -- feature.test.ts`
Expected: PASS — confirms the kickoff message references `skills/feature-orchestrator/SKILL.md` and the `feature/<slug>/<project>` convention the skill relies on.

- [ ] **Step 5: Commit**

```bash
git add skills/feature-orchestrator/SKILL.md skills/README.md CLAUDE.md
git commit -m "docs: add feature-orchestrator skill"
```

---

## Task 6: Full verification

- [ ] **Step 1: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 2: Run the affected package test suites**

Run: `pnpm --filter @aoagents/ao-core test && pnpm --filter @aoagents/ao-cli test`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: no errors. (Fix any unused-import or type-import issues introduced.)

- [ ] **Step 4: Manual smoke (optional, requires a configured hub + `ao start`)**

In a hub project whose `agent-orchestrator.yaml` has `linkedProjects: [<registered ids>]`, with `ao start` running:

```bash
ao feature start --hub <hub> "Add SSO login across web and API"
# → prints SLUG=add-sso-login-across-web and kicks the orchestrator
ao feature status add-sso-login-across-web
# → "No workers found ..." until the orchestrator spawns workers
```

Expected: `ao feature start` reports the orchestrator session and slug; the
orchestrator's chat shows the kickoff message instructing it to follow the skill.

- [ ] **Step 5: Final commit (if lint/typecheck required fixes)**

```bash
git add -A
git commit -m "chore: lint/typecheck fixes for feature orchestrator"
```

---

## Self-Review (completed during planning)

**Spec coverage:**
- Skill-first pipeline → Task 5 (`SKILL.md`). ✅
- `linkedProjects` in hub yaml → Task 1. ✅
- Cross-project worker spawn → Task 2 (`--project`/`--branch`). ✅
- `ao feature start/status` → Tasks 3–4. ✅
- Question funnel via `ao send` → encoded in skill + kickoff (Tasks 3, 5). ✅
- Lockstep gates (soft, prompt-enforced) → skill (Task 5). ✅
- Feature identity via branch convention (no metadata schema change) → Tasks 2, 3, 5. ✅
- Feature doc in hub repo `docs/superpowers/specs/` → skill (Task 5). ✅
- Sensitive core untouched → only `config.ts` (1 typed field) + CLI files. ✅
- Dashboard grouping deferred → not in plan, by design. ✅

**Type consistency:** `slugifyFeature`/`buildFeatureKickoff` exported from `feature.ts` and imported by `feature.test.ts`; `applyProjectOverride` exported from `spawn.ts` and imported by its test; `sm.ensureOrchestrator`/`sm.send`/`sm.list`/`sm.spawn` match `session-manager.ts` signatures; `session.branch`/`session.pr` match the `Session` interface (`types.ts:280-333`).

**Placeholder scan:** no TBD/TODO; every code step shows complete code and exact commands with expected output.
