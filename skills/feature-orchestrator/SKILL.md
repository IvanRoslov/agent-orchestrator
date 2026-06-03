---
name: feature-orchestrator
description: Drive a feature end-to-end across multiple linked projects — own the feature doc, spawn and coordinate workers, funnel their questions, and gate them through brainstorm → plan → implement → verify → debug.
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

1. **ASK FIRST.** Your feature name/slug is only a label, not the spec. Your very
   first message must ask the human to describe the feature or task — what to
   build, why, and any constraints. Do NOT infer scope, research, plan, or write
   anything from the title alone. Wait for their answer and ask follow-ups until
   you understand the goal.
2. Then research the feature across the hub docs and linked repos.
4. Run `superpowers:brainstorming` WITH the human to produce the feature design
   doc. Save it in THIS hub repo at
   `docs/superpowers/specs/YYYY-MM-DD-<slug>-design.md` and commit it.
5. Decompose the feature into one **slice per linked project** (what that repo
   must change, and the cross-project contracts between slices).
6. **GATE:** present the doc + the per-project slices to the human. Wait for
   explicit approval before spawning anyone.

### Stage 2 — spawn workers + worker brainstorm

For each in-scope linked project, spawn a worker:

```
ao spawn --project <project> --branch feature/<slug>/<project> --prompt "<concise brief>"
```

The `--prompt` is length-limited and strips newlines, so keep it short (slug +
one-line slice + "you are part of feature <slug>; send all questions to
orchestrator <your-session-id> via ao send; follow the worker rules below").
Immediately after spawn, deliver the FULL brief:

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
