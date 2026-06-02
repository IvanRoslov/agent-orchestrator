# Cross-Project Feature Orchestrator — Design

**Date:** 2026-06-02
**Status:** Approved (design), pending implementation plan
**Author:** Brainstormed with Claude Code (superpowers:brainstorming)

## Problem

Today AO orchestration is **project-scoped**: you register a project, it gets an
orchestrator that manages workers, and every session — orchestrator and worker —
lives inside a single `projectId`. There is no way to drive a single *feature*
that spans several repositories from one place.

We want a **feature-level orchestrator** that sits *above* projects: one AI
session that owns a feature end-to-end, holds its full context, and spawns and
coordinates workers across several linked projects, walking them through a gated
lifecycle (research → brainstorm → plan → implement → verify → debug).

## Constraints

- **C-FORK — stay mergeable with upstream.** This repo is a fork of
  `github.com/ComposioHQ/agent-orchestrator`. We must keep merging upstream
  cheaply. Therefore the design **must not touch sensitive shared core files**
  (`packages/core/src/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`,
  `prompt-builder.ts`). All new behavior lives in added files; unavoidable edits
  are confined to CLI command files and a single backward-compatible 1-line
  change in `config.ts`.
- **C-SUPERPOWERS — reuse, don't reinvent.** Brainstorm, planning, and
  TDD-via-subagents are the existing `superpowers` plugin skills
  (`brainstorming`, `writing-plans`, `subagent-driven-development`). The feature
  orchestrator *sequences* these skills; it does not reimplement them.
- **C-SIMPLICITY — minimum viable.** No new top-level data store, no new
  lifecycle states, no formal dependency graph, no question-inbox UI.

## Approach: skill-first

The pipeline is a **new skill**, `skills/feature-orchestrator/`, that the
orchestrator session follows. The skill composes the superpowers skills and the
existing AO primitives (`ao spawn`, `ao send`). Stage sequencing, gating,
question routing, and worker decomposition are described in `SKILL.md` — not in
core code.

### Stage → skill mapping

| Feature stage | Driven by | Output |
|---------------|-----------|--------|
| research + brainstorm | `superpowers:brainstorming` | feature design doc in hub repo |
| plan | `superpowers:writing-plans` | per-worker implementation plans |
| implement (TDD) | `superpowers:subagent-driven-development` | code + PRs |
| verify | manual / agent | confirmation each slice works |
| debug ⟲ | orchestrator spawns fixup workers | fixes |

The feature lifecycle is **lockstep with gates**:

```
research → brainstorm → plan → implement → verify → debug ⟲ → done
```

At every stage boundary there is a **gate**: the orchestrator holds all workers
until the human approves advancing — approval happens **in the orchestrator chat
only**. Gates are *soft* (enforced by the orchestrator following the skill), not
hard-coded in the core lifecycle manager. This keeps the sensitive state machine
untouched; a hard gate can be added later if soft gating proves insufficient.

## Architecture

### Where the orchestrator lives

The feature orchestrator is an `kind: "orchestrator"` session pinned to a **hub
project** — a project whose repo holds cross-project documentation and references
to related repositories. The hub declares its in-scope repos:

```yaml
# agent-orchestrator.yaml (hub project)
linkedProjects: [api-repo, web-repo, infra-repo]   # ids of already-registered AO projects
```

`linkedProjects` are **pre-registered** AO projects (no auto-clone/registration).
The orchestrator may, during research, propose touching only a subset.

### Feature identity & grouping (no schema change)

A feature is identified by a **slug**. Workers are spawned onto branches named by
convention:

```
feature/<feature-slug>/<project-id>
```

The feature group is reconstructable from this convention via `sm.list()` +
branch-name filtering — **no `featureId` metadata field is added** to
`SessionSpawnConfig`, so `types.ts` and `session-manager.ts` stay untouched. The
orchestrator additionally tracks its worker session IDs in the feature design
doc, which is its durable source of truth.

### The feature document

Lives in the **hub project repo** at:

```
docs/superpowers/specs/YYYY-MM-DD-<feature-slug>-design.md
```

The orchestrator produces it by running `superpowers:brainstorming` *with the
human*. It is the single source of truth for the feature. Each worker is spawned
with a reference to this doc plus its own slice, and each worker produces its own
per-project sub-spec (also via `brainstorming`), routing all clarifying questions
back to the orchestrator.

### Question funnel (single pane of glass)

All worker questions flow to the orchestrator via the existing `ao send
<orchestrator-session-id> "<question>"`. The orchestrator answers from the
feature context when it can, and escalates to the human **in its own chat** when
it cannot. The human talks **only to the orchestrator**. No new UI.

## Components & edits

### Tier 0 — pure additions, zero core edits

- **`skills/feature-orchestrator/SKILL.md`** — the pipeline brain:
  - how to run research + `brainstorming` and write the feature doc
  - how to decompose the feature into per-project worker slices
  - how to spawn workers (`ao spawn --project <linked> ...`) on
    `feature/<slug>/<project>` branches
  - the gate protocol (hold workers; advance only on human approval)
  - the question-funnel protocol (answer or escalate)
  - the verify/debug loop (spawn fixup workers)
  - worker briefing template: "you are part of feature X; here is the doc; your
    slice is Y; send all questions to orchestrator `<id>` via `ao send`; run
    `brainstorming` → `writing-plans` → `subagent-driven-development`; do not
    cross a stage gate until the orchestrator tells you to."
  - **Briefing delivery mechanism.** The feature doc lives in the *hub* repo, not
    the worker's repo, and `ao spawn --prompt` strips newlines and caps at 4096
    chars — too small for a full brief. So briefing is two-step: (1) a concise
    `--prompt` at spawn containing the feature slug, the worker's slice summary,
    and the orchestrator session id; (2) immediately after spawn, the orchestrator
    delivers the full brief (slice details + relevant excerpt of the feature doc)
    via `ao send <worker> --file <brief.md>`. This keeps the doc as the hub's
    single source of truth while giving each worker a self-contained brief without
    depending on cross-repo file access.
- Reference the skill from `AGENTS.md` / project skill index (additive).

### Tier 1 — minimal, low-merge-risk edits (CLI command files + 1 config line)

- **`packages/cli/src/commands/feature.ts`** (new file) — `ao feature start
  [--hub <project>] "<description>"` and `ao feature status <slug>`.
  - `start`: spawns the feature orchestrator in the hub project, seeding it with
    the feature description, the resolved `linkedProjects`, and the
    feature-orchestrator skill as its operating brief.
  - `status`: reconstructs the feature group from `sm.list()` by branch
    convention and prints orchestrator + workers + current stage.
- **`packages/cli/src/program.ts`** — one import + one `registerFeature(program)`
  call (file is ~68 lines; non-breaking).
- **`packages/cli/src/commands/spawn.ts`** — add `--project <id>` flag so the
  orchestrator can spawn a worker into a linked project without requiring an
  issue reference. (Cross-project routing currently only works via issue-prefix
  syntax.) Small, additive flag in a command file — not sensitive core.
- **`packages/core/src/config.ts`** — change the project Zod schema from
  `z.object({...})` to `z.object({...}).passthrough()` (1 line) so `linkedProjects`
  (and future hub keys) survive parsing. Backward-compatible; we read the key
  ourselves in the CLI command rather than adding it to the typed schema.

### Deferred — the only piece that would touch sensitive core

Native feature grouping in the web dashboard (a "Feature" view grouping
orchestrator + workers across projects with per-stage badges) requires a
`metadata` field on `SessionSpawnConfig` (`types.ts`) plus plumb-through in
`session-manager.ts`. **Deferred to a later, isolated phase.** For the MVP,
`ao feature status` provides visibility via CLI using the branch convention.

## Data flow

```
description
  → ao feature start --hub <hub>
  → feature orchestrator session (hub project, kind=orchestrator)
  → [research + superpowers:brainstorming WITH human → feature doc in hub repo]
  → GATE (human approves)
  → orchestrator spawns workers in linked projects
      (ao spawn --project <p>, branch feature/<slug>/<p>, briefed with doc + slice)
  → workers run brainstorming; questions → ao send → orchestrator
      → (answer from context, or escalate to human in orchestrator chat)
  → GATE → writing-plans
  → GATE → subagent-driven-development (TDD) → PRs / deploy
  → verify
  → debug loop: orchestrator spawns fixup workers as needed
  → done
```

## What we explicitly do NOT build (YAGNI)

- No new first-class `Feature` type or store — identity via branch convention +
  the feature doc.
- No changes to the canonical lifecycle states in `lifecycle-manager.ts`.
- No formal dependency graph between workers — the orchestrator sequences them
  via gates and `ao send`.
- No question-inbox UI — the funnel is the orchestrator chat.
- No auto-clone/registration of linked repos — they are pre-registered.
- No dashboard feature grouping in MVP (deferred; it is the only sensitive-core
  touch).

## Testing

- **`config`**: a project config carrying `linkedProjects` parses without error
  and the key is preserved (`.passthrough()` behavior).
- **`cli` — feature command**: `ao feature start` resolves the hub, reads
  `linkedProjects`, and spawns an orchestrator session with the correct brief;
  `ao feature status <slug>` reconstructs the group from branch-named sessions.
- **`cli` — spawn `--project`**: spawning with `--project <id>` routes the new
  session into the named registered project.
- **Skill smoke**: `skills/feature-orchestrator/SKILL.md` is discoverable and the
  worker-briefing template references the superpowers skills by their exact
  invocable names.

## Open questions / risks

- **Soft gates rely on the orchestrator following the skill.** Acceptable for
  MVP; revisit a hard gate (core enforcement) only if the orchestrator is
  observed jumping gates in practice.
- **Cross-project `sm.list()` enumeration** must include all registered projects
  for `ao feature status` to find workers — verified during exploration; confirm
  again in implementation.
- **`--project` on spawn** must reuse the same project-resolution path the
  issue-prefix routing uses, to avoid divergent behavior.

## Fork-mergeability summary

| File | Edit | Risk |
|------|------|------|
| `skills/feature-orchestrator/SKILL.md` | new file | none |
| `packages/cli/src/commands/feature.ts` | new file | none |
| `packages/cli/src/program.ts` | +1 import, +1 register call | low |
| `packages/cli/src/commands/spawn.ts` | +1 optional `--project` flag | low |
| `packages/core/src/config.ts` | `.passthrough()` (1 line) | low |
| sensitive core (`types.ts`, `lifecycle-manager.ts`, `session-manager.ts`, `prompt-builder.ts`) | **untouched** | none |
