# Feature Orchestrator — Workers Right Rail (visible, detailed, collapsible)

**Date:** 2026-07-05
**Status:** Design (approved for planning)
**Slug:** `feature-orchestrator-workers-rail`
**Follows:** `2026-07-05-feature-orchestrator-worker-heartbeat-design.md`

## Problem

The heartbeat feature added a "Workers" panel, but it was mounted inside
`SessionInspector` (the right rail) — and `SessionDetail.tsx:217` **skips the entire
inspector for orchestrator sessions** (`!isOrchestrator`). A feature coordinator IS
an orchestrator (`metadata.role === "orchestrator"`), so the panel never renders.
The user only sees the compact `Nw · M stalled` badge in the left sidebar, with no
per-worker detail — "I only see the count; their status is unclear."

## Goals

1. **Make the workers panel actually visible** — give a feature orchestrator its own
   right rail (like a worker's PR panel), instead of the count-only left badge.
2. **Show clear per-worker detail** so status is obvious at a glance: colored status
   dot + label, exact last-activity time, PR + CI state, full branch.
3. **Collapsible** — a collapse button on the rail (state remembered in
   `localStorage`); collapsed → terminal reclaims full width; a header button
   re-opens it.

## Non-Goals

- No change to the CLI heartbeat, the linkage rule (branch prefix), or the
  `/api/sessions` poll. Same data source.
- No new API route. No `packages/core` edits (fork mergeability).
- Mobile rail is out of scope (parity with workers: mobile has no inspector rail).
  The left-sidebar badge remains visible on mobile. Follow-up if needed.
- The left-sidebar `Nw · M stalled` badge stays as-is (at-a-glance signal).

## Constraints

- Fork mergeability: NO edits to `packages/core/src/**`. All changes in
  `packages/web/**`. (`SessionDetail.tsx`, `SessionDetailHeader.tsx` are web files.)
- C-02 no inline `style=` (Tailwind + CSS-var tokens). C-04 ≤400 lines/component.
- C-05 dark theme preserved. C-06 App Router. C-12 tests for new/changed components.
- C-14 SSE 5s unchanged (the workers poll is a separate 5s fetch, already shipped).

## Architecture

```
SessionDetail.tsx  ──owns──►  collapsed state (localStorage: ao-workers-rail-collapsed)
   ├─ SessionDetailHeader  ← showWorkersToggle + collapsed + onToggleWorkers (feature coord only)
   └─ right-rail gate:
        isFeatureCoordinator(session) && !collapsed
            ? <OrchestratorInspector session onCollapse/>   ← NEW rail
            : !isOrchestrator ? <SessionInspector/>          ← unchanged (workers)
            : null                                            ← plain orchestrators: full-width terminal
```

### 1. Right-rail gate (`SessionDetail.tsx`)

Replace the current gate (`:215-219`):

```tsx
{!isMobile && !terminalEnded ? (
  isFeatureCoordinator(session) ? (
    !workersCollapsed ? (
      <OrchestratorInspector session={session} onCollapse={() => setWorkersCollapsed(true)} />
    ) : null
  ) : !isOrchestrator ? (
    <SessionInspector session={session} />
  ) : null
) : null}
```

Non-feature orchestrators keep the full-width terminal (unchanged). Workers keep
`SessionInspector` (unchanged). Only feature coordinators get the new rail.

### 2. Collapse state (owned by `SessionDetail.tsx`)

- `const [workersCollapsed, setWorkersCollapsed] = useState<boolean>(() => read localStorage)`.
- A tiny helper `readWorkersCollapsed()/writeWorkersCollapsed(bool)` wraps
  `localStorage["ao-workers-rail-collapsed"]` with try/catch (SSR/unavailable → false).
- An effect persists on change. A single global key (not per-session) → the on/off
  preference is consistent across all feature orchestrators.
- `SessionDetail` passes `collapsed` + `onToggleWorkers` + `showWorkersToggle` (=
  `isFeatureCoordinator(session)`) to `SessionDetailHeader`; the header renders a
  small "Workers" toggle button only when `showWorkersToggle` (mirrors the existing
  header PR button pattern). The rail's own collapse button calls
  `setWorkersCollapsed(true)`.

### 3. `OrchestratorInspector` (NEW right rail component)

- Thin `<aside>` reusing the existing `session-inspector` rail classes for a
  consistent look. No tabs (single purpose).
- Header row: title `Workers (N)` + a collapse button (chevron) → `onCollapse()`.
- Body: the enriched `OrchestratorWorkersCard` (already polls
  `/api/sessions?fresh=true` every 5s and computes `workerHealthList`).

### 4. Enriched worker rows (`OrchestratorWorkersList` in `OrchestratorWorkersCard.tsx`)

Each worker is a clickable row (routes to that worker's session), showing:

| Element | Source | Notes |
|---|---|---|
| Status dot (colored) + label | `activity` (+ `stale`) | active/ready/waiting input/blocked/idle/**stalled**/exited → `--color-status-*` / `--color-accent-amber` for stalled. Small local map; no inline styles. |
| Task (bold) | branch suffix after `feature/<slug>/` | primary line |
| Full branch (mono, muted) | `branch` | secondary line, `--color-text-muted` |
| Last activity | `lastActivityAt` | relative "active 2m ago" + exact ISO in `title=` tooltip |
| PR + CI chip | `pr` (`DashboardPR`) | `#num` colored by PR/CI state (green/red/draft/merged) + short label; reuse the worker card's existing PR helpers (`getPRDotClass` / PR status label) |
| Stalled marker | `stale` | amber highlight when no movement > 15 min |

Empty state: "No workers spawned yet."

### 5. Data (`feature-sessions.ts`)

`WorkerHealth` gains `lastActivityAt: string` (the session's ISO timestamp) so the
row can show the exact time. `pr` is already the full `DashboardPR` (carries state /
CI / mergeability), so PR+CI needs no new field. `workerHealthList` / `toWorkerHealth`
updated to populate `lastActivityAt`. No signature changes to the call sites beyond
the new field.

## Error handling

- Missing PR → no chip. Missing/`null` activity → neutral dot, "unknown" label, never
  "stalled". Missing `lastActivityAt` → omit the relative/exact time gracefully.
- `localStorage` unavailable (SSR, privacy mode) → default `collapsed = false`, writes
  swallowed.
- Rail is best-effort: the poll keeps last-good data on transient fetch errors
  (already implemented).

## Testing

- `OrchestratorWorkersCard.test.tsx` — update for the new fields: status dot/label
  per activity, `stalled` label, relative + exact-time (`title`) rendering, PR+CI
  chip, full branch. Keep the fetch→render container test.
- `OrchestratorInspector.test.tsx` (NEW) — renders header "Workers (N)", collapse
  button fires `onCollapse`, renders the list.
- `SessionDetail` gate coverage: a feature coordinator renders the rail (and not the
  worker `SessionInspector`); a plain orchestrator renders neither rail; `collapsed`
  hides the rail. Add to `SessionDetail`'s tests (or a focused new test) — assert
  via the presence/absence of the rail and the header toggle.
- `feature-sessions.test.ts` — assert `workerHealth` populates `lastActivityAt`.
- Web build gate: `pnpm --filter @aoagents/ao-web build` (run by the user — the
  prebuild guard refuses while the live dashboard runs). Plus `typecheck` + `test`.

## Files touched (all `packages/web/**`)

New:
- `packages/web/src/components/OrchestratorInspector.tsx` (+ test)

Edited:
- `packages/web/src/components/SessionDetail.tsx` — rail gate + collapse state.
- `packages/web/src/components/SessionDetailHeader.tsx` — additive "Workers" toggle
  button for feature coordinators.
- `packages/web/src/components/OrchestratorWorkersCard.tsx` — enriched rows.
- `packages/web/src/lib/feature-sessions.ts` — `WorkerHealth.lastActivityAt`.
- `packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx`,
  `feature-sessions.test.ts` — updated; `OrchestratorInspector.test.tsx` new.
