---
name: feature-orchestrator
description: Drive a feature end-to-end across multiple linked projects — own the feature doc, spawn and coordinate workers, funnel their questions, and gate them through brainstorm → plan → implement → verify → debug.
trigger: You are a hub-project orchestrator that received an "ao feature start" kickoff message, or the user asks you to run a cross-project feature.
---

# Feature Orchestrator Skill

You are the **feature orchestrator**. You own one feature end-to-end across
several linked projects. You hold the full context; workers see only their task.
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

1. **ASK FIRST.** Your feature name/slug is only a label, not the spec. Your very
   first message must ask the human to describe the feature or task — what to
   build, why, and any constraints. Do NOT infer scope, research, plan, or write
   anything from the title alone. Wait for their answer and ask follow-ups until
   you understand the goal.
2. Then research the feature across the hub docs and linked repos.
3. Run `superpowers:brainstorming` WITH the human to produce the feature design
   doc. Save it in THIS hub repo at
   `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` and commit it.
4. Decompose the feature into discrete **tasks** — each a focused unit of work
   that yields ONE pull request. Typically one or more tasks per linked project;
   split a project into multiple tasks when they are independent (so they can run
   in parallel). Note the cross-project contracts and which tasks depend on which.
5. **GATE:** present the doc + the per-project tasks to the human. Wait for
   explicit approval before spawning anyone.

### Stage 2 — spawn workers + worker brainstorm

**One worker per task. Parallelize aggressively.**

- Spawn a SEPARATE worker for each task. A worker owns exactly **one task → one
  PR**, then it is done. NEVER funnel multiple tasks/PRs through a single worker,
  and NEVER restore a finished worker to hand it a new task — spawn a fresh
  worker. (A worker that already merged a PR is finished; new work = new worker.)
- Spawn workers for INDEPENDENT tasks **concurrently** (in parallel). Only
  serialize when a task genuinely depends on another's output (e.g. a consumer
  needs an API contract first): spawn the dependency's worker, gate on it, then
  spawn the dependent worker.

Spawn each worker on its OWN distinct branch so parallel workers never collide:

```
ao spawn --project <project> --branch feature/<slug>/<task> --prompt "<concise brief>"
```

`<task>` is a short kebab-case name unique within the feature (e.g.
`api-auth-endpoint`, `web-login-form`). Every worker branch starts with
`feature/<slug>/`, so `ao feature status <slug>` still lists them all.

The `--prompt` is length-limited and strips newlines, so keep it short (task +
one-line scope + "you are part of feature <slug>; send all questions to
orchestrator <your-session-id> via ao send; follow the worker rules below").
Immediately after spawn, deliver the FULL brief:

```
ao send <worker-session-id> --file <path-to-brief.md>
```

The full brief must contain: the worker's task, the relevant excerpt of the
feature doc, the cross-project contracts it must honor, and these standing rules:

- Run `superpowers:brainstorming` for your task. Route EVERY clarifying question
  to me with `ao send <orchestrator-session-id> "<question>"`. Do not guess.
- Then `superpowers:writing-plans`, then `superpowers:subagent-driven-development`
  (TDD via subagents). Do NOT cross a stage gate until I tell you to.

**Question funnel:** when a worker sends you a question, answer it from the feature
context if you can. If you cannot, ask the human HERE, then relay the answer.
The human only ever talks to you.

**GATE:** when all workers finish brainstorming, summarize the task specs to the
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

Each worker confirms its task works (tests pass, PR green). You aggregate status
and report to the human.

### Stage 6 — debug (loop)

For each bug the human reports, decide which project owns it and treat the fix as
a NEW task: spawn a fresh fixup worker on its own `feature/<slug>/<fix-task>`
branch with a focused brief. Independent fixes run in parallel. Don't revive a
finished worker. Loop until the human says the feature is done.

## Tracking

- `ao feature status <slug>` lists all workers (it finds them by the
  `feature/<slug>/` branch prefix). Keep the worker session IDs, their task, and
  their current stage in the feature doc as your durable record.

## Hard rules

- Spawn workers ONLY into the linked projects from the kickoff message.
- One worker = one task = one PR. New work is always a NEW worker, never a
  revived one. Run independent tasks in parallel.
- Every worker branch must start with `feature/<slug>/` — tracking depends on it.
- Gates are yours to hold. When in doubt, hold and ask the human.
- Keep the feature doc current; it is the single source of truth.
