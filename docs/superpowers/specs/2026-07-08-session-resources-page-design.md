# Session Resources Page — Design

**Date:** 2026-07-08
**Status:** Approved (brainstorming), pending implementation plan
**Package:** `packages/web`

## Problem

The dashboard only shows sessions AO actively tracks. In practice, tmux
accumulates **orphaned sessions** — live tmux sessions that AO no longer tracks
(e.g. plain-named main orchestrators absent from the session store, or tracked
sessions in a terminal state that never got reaped). These are invisible in the
dashboard, unreachable by its "kill" actions, and silently consume CPU/RAM. A
real incident left 12 orphaned orchestrator sessions alive (~6.6 GB RAM) after a
"kill all" that only touched tracked sessions.

There is also no per-session resource visibility: nothing in the dashboard shows
which session consumes how much CPU/RAM.

## Goal

One new dashboard page that:
1. Lists **every live tmux session** with its CPU% and RAM (summed over its whole
   process tree).
2. Flags **orphans** — live in tmux but not shown as active in the dashboard.
3. Lets the user **kill any session** individually, with confirmation — including
   orphans the normal dashboard can't reach.

Both purposes (resource monitoring + orphan cleanup) are equally weighted.

## Non-Goals (YAGNI)

- No bulk "kill all orphans" (single kill + confirmation only — safety).
- No historical charts / time series (snapshot only).
- No background polling on a timer by default (on-demand refresh).
- No Windows resource collection in v1 (graceful degradation instead).

## Approach

**Approach A (chosen):** dedicated `/api/resources` route + dedicated
`/resources` page. Kill is routed by session type on the server. Rejected
alternatives: (B) extend `/api/sessions` — would hang an expensive `ps`
shell-out on the 5s SSE session feed (perf regression, risks C-14); (C)
client-side widget over the terminal WS — hacky, unmotivated.

## Decisions (from brainstorming)

| Question | Decision |
|----------|----------|
| Purpose | Resource table **and** orphan kill, equally |
| Windows | POSIX-first (`ps`); Windows gracefully degraded via a helper, added later |
| Kill mode | Single session + confirmation modal; **no** bulk kill |
| Refresh | On-demand: snapshot on page open + explicit Refresh button |

## Data Contract

`GET /api/resources` → `ResourceSnapshot`:

```ts
interface ResourceSnapshot {
  capturedAt: string;              // ISO timestamp of the snapshot
  platformSupported: boolean;      // false on Windows → cpu/rss are null
  sessions: ResourceRow[];
  totals: {
    cpuPercent: number;
    rssMb: number;
    procCount: number;
    sessionCount: number;
  };
}

interface ResourceRow {
  tmuxSession: string;             // live tmux session name
  sessionId: string | null;        // AO SessionId if known, else null
  projectId: string | null;
  known: boolean;                  // matches a session in the AO store?
  orphan: boolean;                 // live in tmux but not an ACTIVE tracked session
  aoStatus: string | null;         // legacy status for display (if known)
  cpuPercent: number | null;       // null when platformSupported is false
  rssMb: number | null;            // null when platformSupported is false
  procCount: number;
  topCommand: string;              // most common leaf process command in the tree
  ageMinutes: number;              // from tmux session_created
  idleMinutes: number | null;      // from tmux session_activity
}
```

**Orphan definition:** the tmux session is alive AND either (a) no session with
that name exists in the AO store, OR (b) the matching AO session is in a terminal
lifecycle state (e.g. `done`/`terminated`, or a legacy terminal status such as
`killed`/`cleanup`). In short: "alive in tmux, but the dashboard does not show it
as active."

## Components

### Server modules (`packages/web/src/server/`)

- **`resource-stats.ts`** — POSIX process-tree stats. Parses
  `ps -Ao pid=,ppid=,%cpu=,rss=,comm=` into `Map<pid, {cpu, rss, comm, ppid}>`.
  Guarded: `if (isWindows()) return null` (import `isWindows` from
  `@aoagents/ao-core`; no inline `process.platform`). Pure aggregation logic is
  separated from the exec call so it can be unit-tested by feeding raw `ps` text.

- **`tmux-sessions.ts`** — `listTmuxSessions()` via
  `tmux list-panes -a -F '#{session_name}\t#{pane_pid}'` plus
  `tmux list-sessions -F '#{session_name}\t#{session_created}\t#{session_activity}'`.
  Returns `{ name, panePids, createdEpoch, activityEpoch }[]`. POSIX only.

- **`resource-snapshot.ts`** — orchestration. Combines `listTmuxSessions()` ×
  `resource-stats` × `sessionManager.list()` into a `ResourceSnapshot`: walks each
  session's pane PIDs down the process tree (dedup by pid), sums cpu/rss, counts
  procs, picks the most common leaf command, computes age/idle, and sets the
  `known`/`orphan` flags by reconciling tmux names against the AO store. This is
  the ported logic of the standalone `tmux-usage` script. **This module also owns
  the Windows branch:** when `isWindows()`, it skips tmux/`ps` entirely and returns
  a degraded snapshot (`platformSupported=false`, rows from `sessionManager.list()`
  only, cpu/rss null). The route stays a thin caller.

### API routes

- **`GET /api/resources/route.ts`** → returns `ResourceSnapshot` from
  `resource-snapshot.ts` (which owns the Windows fallback internally).

- **`POST /api/resources/kill/route.ts`** — body `{ tmuxSession: string }`.
  1. `validateSessionId(tmuxSession)` — reject malformed names before any shell/pipe use.
  2. Look up the name in the AO store. If it maps to an **active known** session →
     delegate to `sessionManager.kill(sessionId)` (full lifecycle teardown).
  3. Otherwise (orphan) → direct `tmux kill-session -t =<name>` (exact-match, the
     same `exactSession` discipline runtime-tmux uses). Server chooses the path;
     the client does not decide.
  Returns `{ killed: boolean, path: "lifecycle" | "tmux" }`.

### UI

- **`app/resources/page.tsx`** — server-component shell.
- **`components/ResourcesView.tsx`** — `"use client"`, < 400 lines (C-04). Extract
  the row into a subcomponent if the file grows. Tailwind tokens only, no inline
  styles (C-02), dark theme preserved (C-05).
  - Columns: session · project · status/**orphan** badge · CPU% · RAM · procs ·
    top-cmd · age/idle · kill. Default sort by RAM desc. Orphan rows visually
    flagged with a warning token.
  - **Refresh** button + "captured at" label. Data via a `useResourceSnapshot`
    hook using plain `fetch` (NOT SSE — the 5s SSE feed stays untouched, C-14).
  - Kill → confirmation modal showing the session name and what will be killed
    (known vs orphan) → `POST /api/resources/kill` → refetch snapshot.
- **Navigation:** add a top-level `/resources` entry to the app nav (exact
  placement resolved during implementation).

## Cross-Platform

`isWindows()` guards both `resource-stats.ts` and `tmux-sessions.ts`. On Windows:
`platformSupported=false`; the row list falls back to `sessionManager.list()`
(known sessions only), cpu/rss render as "n/a", and the UI shows a note
"Resource stats unavailable on Windows." No inline `process.platform` anywhere —
any new branching goes through core helpers per the repo Golden Rule.

## Testing

- **`resource-stats.test.ts`** — mock `ps` output: correct tree summation, leaf
  command selection, dedup; `isWindows()` → null.
- **`resource-snapshot.test.ts`** — fake tmux list + stats + `sessionManager`:
  orphan flags for (untracked) and (tracked-but-terminal) cases; totals math;
  known/active sessions NOT flagged orphan.
- **kill route test** — known active → `sessionManager.kill` called; orphan →
  exact `tmux kill-session` invoked; `validateSessionId` rejects bad input.
- **`ResourcesView.test.tsx`** — renders rows, shows orphan badge, kill
  confirmation flow (mock fetch), Windows n/a rendering.

## Constraints Honored

- C-02 no inline styles · C-04 ≤400 lines/component · C-05 dark theme ·
  C-06 App Router · C-12 tests for new components · C-14 SSE 5s untouched (this
  page uses on-demand fetch, not the SSE feed).
- Windows Golden Rule: `isWindows()` from core, no inline `process.platform`.
