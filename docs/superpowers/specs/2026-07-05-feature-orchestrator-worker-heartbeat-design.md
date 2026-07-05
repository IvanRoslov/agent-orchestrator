# Feature Orchestrator — Worker Heartbeat & Workers Panel

**Date:** 2026-07-05
**Status:** Design (approved for planning)
**Slug:** `feature-orchestrator-worker-heartbeat`

## Problem

The feature orchestrator spawns workers, then advances **only when something pushes
a message into its tmux pane** — a peer `ao send` from a worker/human, or a
`send-to-agent` reaction from the 30s lifecycle poll. The orchestrator has **no
timer of its own**. The "delayed commands" it sometimes relies on are the agent
scheduling its *own* wakeup, which is fragile and often fails.

Consequence: when a worker goes **silent** — stuck, crashed, waiting on a prompt,
or simply idle — nobody wakes the orchestrator. It can sit and wait for days
without ever polling its workers.

Two gaps:
1. **No AO-native safety-net that wakes the orchestrator on worker silence.**
2. **No view of "the workers this orchestrator spawned"** with their last activity.

## Goals

- Give the orchestrator a **non-fragile safety-net**: when a worker has had **no
  movement for >15 min**, start pushing it a worker-status summary (every ~20 min)
  so it wakes up and checks the stalled worker.
- Give the human a **"Workers" panel** on the orchestrator's session detail (mirror
  of the worker's PR card) plus a compact health badge in the sidebar "Features"
  group.

## Non-Goals

- No changes to how workers are spawned or how `ao feature status` works.
- No new session metadata / no reverse `parentSessionId` pointer.
- Not a general scheduler — the pulse fires **only on worker silence**, never on a
  fixed clock when everything is moving (workers already wake the orchestrator when
  they `ao send` questions/answers on their own).
- No auto-remediation. The pulse **informs**; the orchestrator decides.

## Hard Constraint — fork mergeability

This repo is a fork; keep upstream merges cheap. **Do NOT edit** `packages/core`
sensitive files: `types.ts`, `lifecycle-manager.ts`, `session-manager.ts`,
`prompt-builder`. The design lives entirely in **new files + `packages/cli`
wiring + `packages/web` components**, using only core's **public API**
(`sm.list()`, `sm.send()`, `getActivityState` / activity-JSONL readers exported
from `@aoagents/ao-core`).

## Worker ↔ Orchestrator linkage (reuse existing contract)

No new metadata. Reuse exactly what `ao feature status` already does:
- Orchestrator session is tagged `metadata.feature = <slug>` (set at spawn).
- Its workers are the sessions whose `branch` starts with `feature/<slug>/`.

So for any orchestrator we can enumerate its workers deterministically from
`sm.list()` — on the server (pulse) and on the client (panel).

## Architecture

Two independent deliverables sharing one linkage rule and one "worker health"
computation:

```
sm.list()  ─┬─►  [CLI] heartbeat module ──(on silence)──► sm.send(orchestrator, summary)
            │
            └─►  [WEB] useSessionEvents ──► Workers panel (detail) + health badge (sidebar)
```

### 1. Heartbeat module (CLI-hosted)

**Why CLI, not web:** the `ao start` process is the always-on owner of the
lifecycle loop; it runs whether or not a browser is open, and already hosts a
janitor timer. The web server (Next.js) is a poor host for background timers and
may not be running. (Alternatives — web-server timer, external cron — rejected as
more fragile / more moving parts.)

- **New file:** `packages/cli/src/lib/feature-heartbeat.ts`
- **Wiring:** started from `packages/cli/src/commands/start.ts` (allowed file),
  given the same `SessionManager` instance the lifecycle uses. Cleared on shutdown
  alongside the existing janitor.
- **Tick:** every 5 min (cheap; not user-facing).
- **Per tick, for each orchestrator** (`session.metadata.feature` set):
  1. Collect its workers by branch prefix `feature/<slug>/`.
  2. For each worker compute **age since last activity** and current activity
     state via core's public activity API, plus PR/CI summary already on the
     session.
  3. `stale` ⟺ **age > 15 min** (uniform rule — a worker at `waiting_input` /
     `blocked` / `exited` simply reaches the threshold like any other silence; its
     state is still shown in the summary so the orchestrator sees *why*).
  4. **Send a summary only if ALL of:**
     - the orchestrator itself is **idle** (not actively working — avoid
       interrupting it mid-turn; `ao send`'s idle-aware delivery is a second guard);
     - **≥1 worker is stale**;
     - **≥20 min since the last summary** sent to this orchestrator
       (tracked in an in-memory `Map<orchestratorId, lastSentMs>`; resets on AO
       restart, which is fine).
  5. Deliver with `sm.send(orchestratorId, summary)`.

**Thresholds** (constants in the module): `STALE_MS = 15*60_000`,
`RENUDGE_MS = 20*60_000`, `TICK_MS = 5*60_000`. (Not YAML-configurable in v1 —
YAGNI; easy to promote later.)

### 2. Summary message format

Plain text injected into the pane. Explicit "no human here / may be expected"
framing so the orchestrator acts autonomously and doesn't over-react:

```
[feature heartbeat] feature <slug> — worker status (no human here, act autonomously):
- <worker-id> (task auth-endpoint): IDLE 47m · PR #123 CI green — no movement; may be done or stuck, check it.
- <worker-id> (task web-form): WAITING_INPUT 22m — blocked on a prompt, needs you.
- <worker-id> (task api-types): ACTIVE 15s — working, ok.
This may be expected. If a worker looks stuck: `ao send <worker-id> "status?"` or open its terminal. If all is fine, ignore this.
```

Include every worker (not just stale ones) so the orchestrator sees full context;
lead the ordering with stale workers.

### 3. Web — Workers panel + sidebar badge

- **New component:** `packages/web/src/components/OrchestratorWorkersCard.tsx`,
  rendered in the orchestrator's session detail view (sibling to the PR card),
  only when the session is a feature coordinator (`isFeatureCoordinator`).
- Per worker row: task (branch suffix), state chip (active / idle / waiting / blocked
  / exited), "last activity N min ago", PR `#num` + CI, **stale highlight** when
  age > 15 min. Row click navigates to that worker's session.
- **Sidebar badge:** in the existing "Features" group
  (`ProjectSidebar.tsx` / `feature-sessions.ts` helpers), a compact health badge
  per orchestrator, e.g. `3 workers · 1 stalled`.
- **Data source:** existing `useSessionEvents` already streams **all** sessions;
  compute an orchestrator's workers **client-side** by branch prefix. No new API
  route, no SSE interval change (C-14 preserved).
- Shared helper for the linkage + "worker health" mapping so client and any future
  reuse agree: extend `packages/web/src/lib/feature-sessions.ts` with
  `workersForFeature(sessions, slug)` and a `workerHealth(session)` view-model.
  (The CLI heartbeat keeps its own small copy of the branch-prefix + staleness
  logic — cli and web don't share a runtime package — but the rule is documented
  once here as the source of truth.)

## Error handling

- Heartbeat tick is best-effort: wrap per-orchestrator work in try/catch, log and
  continue; one bad session never stalls the loop.
- `sm.send` failures (e.g. orchestrator pane gone) are swallowed and logged; the
  orchestrator being unreachable is not our problem to resolve here.
- Panel tolerates missing PR / missing activity data (renders "unknown"/"—").

## Testing

- **CLI unit** (`feature-heartbeat.test.ts`, deterministic, mocked clock + mocked
  `sm.list`/`sm.send`): stale detection at the 15-min boundary; no send when all
  workers fresh; no send when orchestrator busy; 20-min re-nudge throttle; summary
  text ordering/format; multiple orchestrators isolated.
- **Web component** (`OrchestratorWorkersCard.test.tsx`, required by C-12): renders
  worker rows, stale highlight, empty state, non-coordinator renders nothing.
- **Helper unit** for `workersForFeature` / `workerHealth`.
- **Web build gate:** `pnpm --filter @aoagents/ao-web build` (per project rule),
  plus `pnpm typecheck`, `pnpm test`.

## Files touched

New:
- `packages/cli/src/lib/feature-heartbeat.ts` (+ test)
- `packages/web/src/components/OrchestratorWorkersCard.tsx` (+ test)

Edited (all non-forbidden):
- `packages/cli/src/commands/start.ts` — start/stop the heartbeat timer.
- `packages/web/src/lib/feature-sessions.ts` — `workersForFeature`, `workerHealth`.
- `packages/web/src/components/SessionDetail.tsx` — mount the workers card for
  coordinators.
- `packages/web/src/components/ProjectSidebar.tsx` — health badge in Features group.

## Constraints honored

- Fork: no edits to `core/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`,
  `prompt-builder`.
- C-02 no inline styles · C-04 ≤400 lines/component · C-05 dark theme · C-06 App
  Router · C-12 tests for new components · C-14 SSE 5s unchanged.
