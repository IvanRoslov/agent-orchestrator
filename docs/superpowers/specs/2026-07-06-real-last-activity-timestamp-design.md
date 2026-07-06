# Real Last-Activity Timestamp (fix "just now" + revive the heartbeat)

**Date:** 2026-07-06
**Status:** Design (approved for planning)
**Slug:** `real-last-activity-timestamp`
**Follows:** `2026-07-05-feature-orchestrator-worker-heartbeat-design.md`, `2026-07-05-feature-orchestrator-workers-rail-design.md`

## Problem

The workers rail shows **"just now"** for every alive worker, even one idle ~9h. Root
cause, confirmed on the live dashboard: `Session.lastActivityAt` is seeded from the
session metadata `.json` **file mtime**, which AO rewrites every poll for an alive
session — so it is always ≈now. The real last-activity time (in the agent's native
JSONL) is never used: the core enrichment only advances `lastActivityAt` forward
(monotonic max, `session-manager.ts:1210`), so the true *older* value can't win.

Evidence (worker `ltca-17`): served `lastActivityAt = 2026-07-06T06:57Z` ("just now"),
but its last real Claude message was `2026-07-05T22:43Z` (~8h earlier). All three alive
workers shared a sub-second-identical timestamp — one AO write, not real agent activity.

**This same bug also silently breaks the worker heartbeat.** `feature-heartbeat.ts`
computes `isStale = (now − session.lastActivityAt) > 15min`. Since `lastActivityAt ≈ now`
for every alive worker, `isStale` is never true → the heartbeat **never nudges the
orchestrator**, defeating its whole purpose. The panel display and the dead heartbeat
are two faces of the same root cause.

## Root cause (precise)

The Claude agent plugin's `getActivityState` returns `timestamp = entry.modifiedAt`
(the JSONL **file mtime**, bumped continuously by housekeeping writes like
`queue-operation` / `permission-mode` / re-emitted `pr-link`), not the embedded
`timestamp` of the last real message. `getActivityState().timestamp` is the
agent-agnostic seam meant to carry "when activity was last observed"; for Claude it
carries the wrong value.

## Goals

1. Panel shows the **real** last-activity time ("8h ago", not "just now").
2. The heartbeat detects genuine 15-min stalls again and nudges the orchestrator.
3. **Agent-agnostic**: consumers read time through the `getActivityState` interface;
   adding another agent later means that plugin returns its own accurate timestamp —
   no consumer change.

## Constraints

- Fork mergeability: **no edits** to `packages/core/src/types.ts`, `lifecycle-manager.ts`,
  `session-manager.ts`, `prompt-builder`.
- **Zero blast radius on existing behavior**: do NOT change activity *state*
  classification, `Session.lastActivityAt`, sorting, or lifecycle. Only make the
  returned `timestamp` accurate and consume it in two new spots.
- No new API route. C-02 no inline styles, C-05 dark theme, C-12 tests, C-14 SSE 5s.

## Why this is zero-risk

The Claude `getActivityState().timestamp` is currently consumed only by the core
enrichment guard `if (detected.timestamp > session.lastActivityAt)`. After the fix the
timestamp becomes the real (older) value, which is **less** than the fresh
metadata-mtime seed, so the guard rejects it exactly as before → `Session.lastActivityAt`
and everything downstream is unchanged. The accurate timestamp only affects the two new
consumers that read it directly.

## Design

### 1. Claude plugin — make `getActivityState().timestamp` real

`packages/plugins/agent-claude-code/src/activity-detection.ts`:

- Keep `state` computed from the file mtime age exactly as today (state behavior
  unchanged).
- Change the returned `timestamp` to the embedded `timestamp` of the **last non-noise
  JSONL entry**. "Noise" = the existing `NOISE_JSONL_TYPES` set (`permission-mode`,
  `ai-title`, `agent-*`, `custom-title`, `pr-link`). Read a **bounded tail** of the
  session JSONL, scan backward, and take the first (from the end) non-noise entry that
  has a parseable `timestamp` field. Fall back to `entry.modifiedAt` (mtime) if none is
  found — so behavior is never worse than today.
- Applies to the `ready`/`idle`/`active` return paths (the ones that today pair
  `state` with `timestamp = entry.modifiedAt`). `blocked`/`waiting_input` and the
  `staleNativeState`/`createdAt` fallbacks are unchanged.

### 2. Heartbeat (CLI) — stale by real time

`packages/cli/src/lib/feature-heartbeat.ts`:

- Add an optional dep `activityTimestamp?: (session: Session) => Promise<Date | null>`.
- Each tick, before evaluating, resolve the real timestamp for the candidate workers
  into a `Map<sessionId, Date>`. Pass the map into the (still pure) staleness logic:
  `isStale` uses `tsMap.get(id) ?? session.lastActivityAt` as the activity time.
- Wiring in `packages/cli/src/commands/start.ts`: build `activityTimestamp` from the
  resolved agent plugin — `(s) => agentPlugin.getActivityState(s).then(d => d?.timestamp ?? null)`.
  Resolve the plugin via the same registry the session manager uses (agent from
  `session.metadata.agent`). If no plugin/timestamp → returns null → fallback to
  `lastActivityAt` (today's behavior).

### 3. Web — expose `realLastActivityAt` and display it

- `packages/web/src/lib/serialize.ts`: for **non-terminal** sessions only (terminal
  sessions already have a correct frozen `lastActivityAt`, and this bounds the extra
  I/O to the few live sessions), resolve the session's agent plugin from the registry
  (already imported in `web/src/lib/services.ts`) and call `getActivityState(session)`;
  set `realLastActivityAt = detected?.timestamp?.toISOString() ?? undefined`.
- `packages/web/src/lib/types.ts`: add `realLastActivityAt?: string` to `DashboardSession`
  (web type — not core).
- `packages/web/src/lib/feature-sessions.ts`: `WorkerHealth` age/last-activity uses
  `realLastActivityAt ?? lastActivityAt`. (`toWorkerHealth` and the existing
  `lastActivityAt` field on `WorkerHealth` pick the real value when present.)
- `packages/web/src/components/OrchestratorWorkersCard.tsx`: unchanged logic — it already
  renders `formatRelativeTime(new Date(w.lastActivityAt))`; it just receives the corrected
  value.

### Data flow

```
Claude JSONL (last non-noise entry.timestamp)
  → agentPlugin.getActivityState(session).timestamp        [agnostic seam, now accurate]
      → heartbeat isStale (fallback lastActivityAt)         → nudges on real 15-min stall
      → web serialize realLastActivityAt (non-terminal)     → WorkerHealth → panel "8h ago"
core Session.lastActivityAt / state / lifecycle             → UNCHANGED
```

## Error handling / fallbacks

- No JSONL, unparseable, non-Claude agent, or plugin resolution fails → timestamp is
  `null`/absent → consumers fall back to `lastActivityAt` (never worse than today).
- Tail read is bounded (fixed number of trailing lines); if the last real entry is
  older than the window, fall back to mtime.
- Web serialize wraps the per-session `getActivityState` call so one failure doesn't
  break the sessions response.

## Testing

- **Claude plugin** (`activity-detection` tests): `timestamp` = embedded ts of the last
  non-noise entry even when the file mtime / last line is noise & fresh; falls back to
  mtime when no non-noise entry with a timestamp exists; **`state` is unchanged** by the
  fix (regression guard on existing state cases).
- **Heartbeat** (`feature-heartbeat.test.ts`): with a fresh `lastActivityAt` but an old
  injected `activityTimestamp`, `isStale` is true and `evaluateOrchestrator` nudges;
  with no `activityTimestamp` (null) it falls back to `lastActivityAt` (existing tests
  still pass); the timestamp map is honored per worker.
- **Web** (`feature-sessions.test.ts`): `WorkerHealth` uses `realLastActivityAt` when
  present, `lastActivityAt` otherwise. Serialize: `realLastActivityAt` is set for a
  non-terminal session and omitted for a terminal one.
- Manual (user): live rail shows real ages; a worker idle >15min gets the orchestrator
  a heartbeat summary.
- Web build gate is the user's (`pnpm --filter @aoagents/ao-web build` needs the live
  dashboard stopped). `typecheck` + `test` in CI-style locally.

## Files touched

- `packages/plugins/agent-claude-code/src/activity-detection.ts` (+ tests) — timestamp source.
- `packages/cli/src/lib/feature-heartbeat.ts` (+ tests) — inject/use real timestamp.
- `packages/cli/src/commands/start.ts` — wire `activityTimestamp` from the agent plugin.
- `packages/web/src/lib/serialize.ts` — compute `realLastActivityAt` (non-terminal).
- `packages/web/src/lib/types.ts` — `DashboardSession.realLastActivityAt?: string`.
- `packages/web/src/lib/feature-sessions.ts` (+ tests) — prefer `realLastActivityAt`.

No edits to any `packages/core/src/**` file.
