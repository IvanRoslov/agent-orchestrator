# Dashboard Snapshot Cache — Design

**Date:** 2026-07-12
**Status:** Approved (brainstorming), pending implementation plan
**Package:** `packages/web`

## Problem

The AO dashboard degrades over time: switching between workers lags, clicks stop
responding, then timeout errors. The WS server log floods with
`[SessionBroadcaster] fetchSnapshot error: This operation was aborted`.
Restarting the dashboard (`ao dashboard`) fixes it temporarily.

**Root cause (confirmed from code):** `next-server` is single-threaded. The SSE
feed hits `/api/sessions`, which on **every call** does heavy per-session
enrichment — `getActivityState(s)` in a `Promise.all` (shells out `ps`/tmux) plus
`enrichSessionsMetadata(...)` (GitHub API calls). Every open dashboard SSE
connection re-runs this independently every 5s (observed **12 connections** = 12×
the work). This saturates the single event loop. The WS server
(`packages/web/server/mux-websocket.ts`, `SessionBroadcaster`) polls the cheap
`/api/sessions/patches` (uses `listCached`) every 3s with a **4s AbortController
timeout** (`mux-websocket.ts:176`) — but the saturated event loop cannot answer
within 4s → the "operation was aborted" flood, and user clicks lag for the same
reason. Restart resets the event loop and drops the 12 connections → fast again.

Degradation worsens over time because zombies accumulate under `next-server`
(Node 25 breaks child reaping — separate environment issue), growing the process
table and slowing each `ps`.

## Goal

Stop the dashboard from degrading under multiple concurrent SSE connections by
computing the enriched session snapshot **once** and sharing it across
connections, and stop the failure flood by backing off the broadcaster poll when
the server is struggling.

## Non-Goals (YAGNI)

- Do **not** change the 5s client SSE interval (constraint C-14). The fix is
  server-side coalescing only; client behavior is unchanged.
- Do **not** fix Node 25 here — that is a separate environment track (run AO on
  Node 20), recommended alongside but out of scope for this code change.
- Do **not** cap or manage the number of SSE connections (user tab behavior).
- Do **not** add explicit cache invalidation on spawn/kill (a ~2s TTL already
  reflects mutations within one poll cycle; revisit only if it feels laggy).

## Approach

**Chosen:** a server-side single-flight + short-TTL cache around the expensive
enrichment, keyed by request scope. Rejected: (a) increasing the 4s broadcaster
timeout — masks the symptom, dashboard still lags; (b) reducing enrichment
richness — loses dashboard functionality; (c) moving enrichment to a worker
thread — larger change, not needed once requests coalesce.

## Design

### Part 1 — Shared snapshot cache (the core fix)

New module `packages/web/src/lib/session-snapshot-cache.ts`:

```ts
// scopeKey uniquely identifies the request scope (all params that affect output,
// e.g. projectId + any filter/mode). compute() runs the real enrichment.
export function getEnrichedSnapshot<T>(
  scopeKey: string,
  compute: () => Promise<T>,
): Promise<T>;

// Test hook to reset cache between tests.
export function resetSnapshotCache(): void;
```

Behavior (mirrors the existing `getCachedProcessList` pattern in
`packages/plugins/agent-claude-code/src/activity-detection.ts`):

- **Single-flight:** if an enrichment for `scopeKey` is already in progress,
  concurrent callers await the same in-flight promise — no duplicate work.
- **Short TTL (~2s):** a completed result is reused for `SNAPSHOT_CACHE_TTL_MS`
  so even polls staggered within a cycle share one enrichment.
- **Per-scope:** distinct `scopeKey`s (e.g. unscoped sidebar vs a project page)
  cache independently; a failed compute is not cached (next call retries).

Net effect: N concurrent SSE polls for the same scope → **1** enrichment.
Event-loop load drops ~N×.

`packages/web/src/app/api/sessions/route.ts` is refactored so the expensive
enrichment (the `sessionManager.list()`/`listCached()` +
`Promise.all(getActivityState)` + `enrichSessionsMetadata` section) runs inside a
`getEnrichedSnapshot(scopeKey, () => …)` call. `scopeKey` is built from the
request's scope-affecting params (at minimum `requestedProjectId`; include any
other query param that changes the response body).

**Correctness:** the `scopeKey` MUST include every input that changes the output,
or one scope could serve another's data. **Freshness:** staleness ≤ TTL (~2s),
well under the 5s poll cadence — imperceptible, and C-14's client interval is
untouched.

### Part 2 — SessionBroadcaster backoff (kills the flood)

In `packages/web/server/mux-websocket.ts` `SessionBroadcaster`:

- Track consecutive `fetchSnapshot` failures. On failure, increase the poll
  interval with exponential backoff (base 3s → 6s → 12s, capped ~30s). Reset to
  the base interval on the first success.
- Throttle the raw `console.warn("[SessionBroadcaster] fetchSnapshot error…")`
  (e.g. log once per failing streak, not every 3s). The structured
  `ui.session_broadcast_failed` event already dedupes on healthy→failing
  transition — keep that behavior.

This both reduces log noise and lightens load on an already-struggling server.

## Testing

**Cache (`session-snapshot-cache.test.ts`):**
1. Two concurrent `getEnrichedSnapshot(sameKey, compute)` calls invoke `compute`
   exactly once (single-flight).
2. A second call within the TTL reuses the cached result (compute not re-invoked).
3. A call after the TTL expires recomputes.
4. Different `scopeKey`s compute independently.
5. A rejected `compute` is not cached — the next call retries.

Time is injected (a `now()` param or fake timer) so tests are deterministic.

**Backoff (extend `mux-websocket.test.ts`):**
6. Consecutive `fetchSnapshot` failures increase the effective poll interval
   (up to the cap).
7. A success resets the interval to the base.
8. Raw warn is throttled during a failing streak (logged once, not per poll).

## Constraints Honored

- C-14: client SSE 5s interval unchanged (server-side coalescing only).
- C-06 App Router; TypeScript strict, no `any` in non-test code; `import type`;
  `@/` alias.
- No inline styles / component changes (this is server/lib only).

## Rollout note

Pairs with the environment fix (run AO on Node 20) which stops the zombie
accumulation that worsens `ps` over time. This code fix removes the N×
enrichment amplification regardless of Node version; the two are complementary.
