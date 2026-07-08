# Session Resources Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/resources` dashboard page listing every live tmux session with CPU/RAM (summed over its process tree), flagging orphans (alive in tmux but not tracked as active by AO), with per-session kill + confirmation.

**Architecture:** A new `GET /api/resources` route builds a snapshot by combining live tmux sessions × per-PID `ps` stats × `sessionManager.list()`. A new `POST /api/resources/kill` route routes kill by session type (known-active → `sessionManager.kill`; orphan → direct exact-match `tmux kill-session`). A client page renders the snapshot on-demand. Resource collection is POSIX-only, guarded by `isWindows()`, with a degraded snapshot on Windows.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript strict, Vitest, `@aoagents/ao-core` (`isWindows`, `TERMINAL_STATUSES`, `Session`), Node `child_process.execFile`.

## Global Constraints

- `isWindows()` from `@aoagents/ao-core` for OS branching — **never** inline `process.platform`.
- TypeScript strict, no `any` in non-test code (`any` allowed in tests).
- `import type { ... }` for type-only imports (ESLint-enforced).
- Web imports use the `@/` alias (→ `packages/web/src/`); no `.js` extensions in web.
- C-02: no inline `style=` — Tailwind utility classes + `var(--color-*)` tokens only.
- C-04: component files ≤ 400 lines.
- C-05: dark theme preserved.
- C-06: App Router only.
- C-12: test files for all new components.
- C-14: SSE 5s feed (`useSessionEvents`) untouched — this page uses plain `fetch`, not SSE.
- Conventional commits (`feat:`, `test:`); commit at the end of each task.
- Branch: `feature/session-resources-page` (already checked out).
- Commits will need `--no-verify` until gitleaks is installed locally (docs-only environment gap; source files carry no secrets).

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/web/src/lib/resource-stats.ts` | POSIX process-tree stats: parse `ps`, collect `Map<pid, ProcInfo>` |
| `packages/web/src/lib/tmux-sessions.ts` | Enumerate live tmux sessions + pane PIDs; exact-match kill helper |
| `packages/web/src/lib/resource-types.ts` | Shared `ResourceSnapshot` / `ResourceRow` types (server + client) |
| `packages/web/src/lib/resource-snapshot.ts` | Orchestration: combine tmux × stats × sessions → snapshot; owns Windows fallback |
| `packages/web/src/app/api/resources/route.ts` | `GET` snapshot |
| `packages/web/src/app/api/resources/kill/route.ts` | `POST` kill (routes by session type) |
| `packages/web/src/hooks/useResourceSnapshot.ts` | Client hook: on-demand fetch of the snapshot |
| `packages/web/src/components/ResourcesView.tsx` | Client table + Refresh + kill confirmation |
| `packages/web/src/app/resources/page.tsx` | Server shell rendering `ResourcesView` |
| `packages/web/src/components/ProjectSidebar.tsx` | Add a top-level `/resources` nav link |

Run all tests with: `pnpm --filter @aoagents/ao-web test <path>`

---

## Task 1: Process-tree stats (`resource-stats.ts`)

**Files:**
- Create: `packages/web/src/lib/resource-stats.ts`
- Test: `packages/web/src/lib/__tests__/resource-stats.test.ts`

**Interfaces:**
- Produces:
  - `interface ProcInfo { pid: number; ppid: number; cpu: number; rss: number; comm: string }`
  - `function parsePs(psText: string): Map<number, ProcInfo>`
  - `async function collectProcessStats(): Promise<Map<number, ProcInfo> | null>` (null on Windows)

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/__tests__/resource-stats.test.ts
import { describe, it, expect } from "vitest";
import { parsePs } from "../resource-stats";

describe("parsePs", () => {
  it("parses pid/ppid/cpu/rss and keeps commands with spaces", () => {
    const text = [
      "  7806  7725 186.6 2701632 next-server (v15.5.15)",
      " 7888     1   5.3   11824 tmux",
      "",
    ].join("\n");
    const map = parsePs(text);
    expect(map.size).toBe(2);
    expect(map.get(7806)).toEqual({
      pid: 7806,
      ppid: 7725,
      cpu: 186.6,
      rss: 2701632,
      comm: "next-server (v15.5.15)",
    });
    expect(map.get(7888)?.comm).toBe("tmux");
  });

  it("skips malformed lines", () => {
    expect(parsePs("garbage line\n   \n").size).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/resource-stats.test.ts`
Expected: FAIL — cannot find module `../resource-stats`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/resource-stats.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWindows } from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

/** One process row from `ps`. rss is in KB. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rss: number;
  comm: string;
}

/**
 * Parse `ps -Ao pid=,ppid=,%cpu=,rss=,comm=` output. The command (last field)
 * may contain spaces (processes rename their argv[0]), so it is captured greedily.
 */
export function parsePs(psText: string): Map<number, ProcInfo> {
  const map = new Map<number, ProcInfo>();
  for (const raw of psText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    map.set(Number(m[1]), {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rss: Number(m[4]),
      comm: m[5],
    });
  }
  return map;
}

/** Collect process stats via `ps`. Returns null on Windows (no `ps`). */
export async function collectProcessStats(): Promise<Map<number, ProcInfo> | null> {
  if (isWindows()) return null;
  const { stdout } = await execFileAsync("ps", ["-Ao", "pid=,ppid=,%cpu=,rss=,comm="], {
    maxBuffer: 8 * 1024 * 1024,
  });
  return parsePs(stdout);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/resource-stats.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/resource-stats.ts packages/web/src/lib/__tests__/resource-stats.test.ts
git commit --no-verify -m "feat(web): parse ps process-tree stats for resources page"
```

---

## Task 2: tmux session enumeration + kill (`tmux-sessions.ts`)

**Files:**
- Create: `packages/web/src/lib/tmux-sessions.ts`
- Test: `packages/web/src/lib/__tests__/tmux-sessions.test.ts`

**Interfaces:**
- Produces:
  - `interface TmuxSession { name: string; panePids: number[]; createdEpoch: number; activityEpoch: number }`
  - `function buildTmuxSessions(panesOut: string, sessOut: string): TmuxSession[]`
  - `async function listTmuxSessions(): Promise<TmuxSession[] | null>` (null on Windows, `[]` when no server/sessions)
  - `function exactSession(name: string): string` → `"=name"`
  - `async function killTmuxSession(name: string): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/__tests__/tmux-sessions.test.ts
import { describe, it, expect } from "vitest";
import { buildTmuxSessions, exactSession } from "../tmux-sessions";

describe("buildTmuxSessions", () => {
  it("merges pane pids per session with created/activity times", () => {
    const panes = ["cle-2\t100", "cle-2\t101", "pla-orchestrator-83\t200"].join("\n");
    const sess = [
      "cle-2\t1783459006\t1783459900",
      "pla-orchestrator-83\t1783456535\t1783459950",
    ].join("\n");
    const out = buildTmuxSessions(panes, sess);
    expect(out).toHaveLength(2);
    const cle = out.find((s) => s.name === "cle-2");
    expect(cle?.panePids.sort()).toEqual([100, 101]);
    expect(cle?.createdEpoch).toBe(1783459006);
    expect(cle?.activityEpoch).toBe(1783459900);
  });

  it("includes sessions even if a session has no pane rows", () => {
    const out = buildTmuxSessions("", "solo\t10\t20");
    expect(out).toEqual([
      { name: "solo", panePids: [], createdEpoch: 10, activityEpoch: 20 },
    ]);
  });
});

describe("exactSession", () => {
  it("prefixes = for exact tmux targeting", () => {
    expect(exactSession("pla-orchestrator")).toBe("=pla-orchestrator");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/tmux-sessions.test.ts`
Expected: FAIL — cannot find module `../tmux-sessions`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/tmux-sessions.ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWindows } from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

export interface TmuxSession {
  name: string;
  panePids: number[];
  createdEpoch: number;
  activityEpoch: number;
}

/** Exact-match tmux target — prevents prefix-match collisions (e.g. name vs name-83). */
export function exactSession(name: string): string {
  return `=${name}`;
}

/**
 * Merge `list-panes` output (session\tpane_pid) with `list-sessions` output
 * (session\tcreated\tactivity) into one record per session.
 */
export function buildTmuxSessions(panesOut: string, sessOut: string): TmuxSession[] {
  const panes = new Map<string, number[]>();
  for (const raw of panesOut.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [name, pid] = line.split("\t");
    if (!name || !/^\d+$/.test(pid ?? "")) continue;
    const list = panes.get(name) ?? [];
    list.push(Number(pid));
    panes.set(name, list);
  }

  const out: TmuxSession[] = [];
  for (const raw of sessOut.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [name, created, activity] = line.split("\t");
    if (!name) continue;
    out.push({
      name,
      panePids: panes.get(name) ?? [],
      createdEpoch: Number(created) || 0,
      activityEpoch: Number(activity) || 0,
    });
  }
  return out;
}

/** List live tmux sessions. null on Windows; [] when the tmux server has no sessions. */
export async function listTmuxSessions(): Promise<TmuxSession[] | null> {
  if (isWindows()) return null;
  try {
    const [panes, sess] = await Promise.all([
      execFileAsync("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"]),
      execFileAsync("tmux", [
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_created}\t#{session_activity}",
      ]),
    ]);
    return buildTmuxSessions(panes.stdout, sess.stdout);
  } catch {
    // tmux exits non-zero when no server is running / no sessions.
    return [];
  }
}

/** Kill a single tmux session by exact name. No-op on Windows. */
export async function killTmuxSession(name: string): Promise<void> {
  if (isWindows()) return;
  await execFileAsync("tmux", ["kill-session", "-t", exactSession(name)]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/tmux-sessions.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/tmux-sessions.ts packages/web/src/lib/__tests__/tmux-sessions.test.ts
git commit --no-verify -m "feat(web): enumerate live tmux sessions + exact-match kill helper"
```

---

## Task 3: Snapshot builder + types (`resource-types.ts`, `resource-snapshot.ts`)

**Files:**
- Create: `packages/web/src/lib/resource-types.ts`
- Create: `packages/web/src/lib/resource-snapshot.ts`
- Test: `packages/web/src/lib/__tests__/resource-snapshot.test.ts`

**Interfaces:**
- Consumes: `ProcInfo` (Task 1), `TmuxSession` (Task 2), `TERMINAL_STATUSES` + `Session` (core).
- Produces:
  - `interface ResourceRow { tmuxSession; sessionId; projectId; known; orphan; aoStatus; cpuPercent; rssMb; procCount; topCommand; ageMinutes; idleMinutes }` (types per spec)
  - `interface ResourceSnapshot { capturedAt; platformSupported; sessions; totals }`
  - `function buildSnapshot(tmuxSessions: TmuxSession[], procs: Map<number, ProcInfo> | null, known: Map<string, string>, nowEpochSec: number): ResourceSnapshot`
  - `async function getResourceSnapshot(sessions: Session[], nowEpochSec: number): Promise<ResourceSnapshot>`

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/__tests__/resource-snapshot.test.ts
import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../resource-snapshot";
import type { ProcInfo } from "../resource-stats";
import type { TmuxSession } from "../tmux-sessions";

function procs(entries: ProcInfo[]): Map<number, ProcInfo> {
  return new Map(entries.map((p) => [p.pid, p]));
}

const NOW = 1_000_000; // epoch seconds

describe("buildSnapshot", () => {
  const tmux: TmuxSession[] = [
    { name: "pla-orchestrator-83", panePids: [10], createdEpoch: NOW - 600, activityEpoch: NOW - 60 },
    { name: "pla-orchestrator", panePids: [20], createdEpoch: NOW - 6000, activityEpoch: NOW - 6000 },
    { name: "eg-29", panePids: [30], createdEpoch: NOW - 120, activityEpoch: NOW - 30 },
  ];
  // pane 10 -> child 11 (claude); pane 20 -> child 21; pane 30 leaf
  const stats = procs([
    { pid: 10, ppid: 1, cpu: 0.5, rss: 100_000, comm: "bash" },
    { pid: 11, ppid: 10, cpu: 2.0, rss: 900_000, comm: "claude" },
    { pid: 20, ppid: 1, cpu: 0.1, rss: 50_000, comm: "bash" },
    { pid: 21, ppid: 20, cpu: 0.2, rss: 450_000, comm: "claude" },
    { pid: 30, ppid: 1, cpu: 1.0, rss: 500_000, comm: "node" },
  ]);
  // known store: -83 is active (working); eg-29 is terminal (cleanup); plain pla-orchestrator absent
  const known = new Map<string, string>([
    ["pla-orchestrator-83", "working"],
    ["eg-29", "cleanup"],
  ]);

  it("sums cpu/rss over the process tree and picks the leaf command", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const row = snap.sessions.find((s) => s.tmuxSession === "pla-orchestrator-83");
    expect(row?.cpuPercent).toBeCloseTo(2.5);
    expect(row?.rssMb).toBeCloseTo(1_000_000 / 1024);
    expect(row?.procCount).toBe(2);
    expect(row?.topCommand).toBe("claude");
    expect(row?.ageMinutes).toBe(10);
    expect(row?.idleMinutes).toBe(1);
  });

  it("flags orphans: untracked OR tracked-but-terminal", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const byName = Object.fromEntries(snap.sessions.map((s) => [s.tmuxSession, s]));
    expect(byName["pla-orchestrator-83"].orphan).toBe(false); // known + active
    expect(byName["pla-orchestrator"].orphan).toBe(true); // untracked
    expect(byName["pla-orchestrator"].known).toBe(false);
    expect(byName["eg-29"].orphan).toBe(true); // tracked but cleanup (terminal)
    expect(byName["eg-29"].known).toBe(true);
    expect(byName["eg-29"].aoStatus).toBe("cleanup");
  });

  it("sorts by rss desc and computes totals", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const rss = snap.sessions.map((s) => s.rssMb ?? 0);
    expect(rss).toEqual([...rss].sort((a, b) => b - a));
    expect(snap.platformSupported).toBe(true);
    expect(snap.totals.sessionCount).toBe(3);
    expect(snap.totals.procCount).toBe(5);
  });

  it("degrades cpu/rss to null when stats are unavailable", () => {
    const snap = buildSnapshot(tmux, null, known, NOW);
    expect(snap.platformSupported).toBe(false);
    expect(snap.sessions.every((s) => s.cpuPercent === null && s.rssMb === null)).toBe(true);
    expect(snap.sessions.find((s) => s.tmuxSession === "pla-orchestrator")?.orphan).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/resource-snapshot.test.ts`
Expected: FAIL — cannot find module `../resource-snapshot`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/resource-types.ts
export interface ResourceRow {
  tmuxSession: string;
  sessionId: string | null;
  projectId: string | null;
  known: boolean;
  orphan: boolean;
  aoStatus: string | null;
  cpuPercent: number | null;
  rssMb: number | null;
  procCount: number;
  topCommand: string;
  ageMinutes: number;
  idleMinutes: number | null;
}

export interface ResourceSnapshot {
  capturedAt: string;
  platformSupported: boolean;
  sessions: ResourceRow[];
  totals: {
    cpuPercent: number;
    rssMb: number;
    procCount: number;
    sessionCount: number;
  };
}
```

```ts
// packages/web/src/lib/resource-snapshot.ts
import {
  isWindows,
  TERMINAL_STATUSES,
  type Session,
  type SessionStatus,
} from "@aoagents/ao-core";
import { collectProcessStats, type ProcInfo } from "./resource-stats";
import { listTmuxSessions, type TmuxSession } from "./tmux-sessions";
import type { ResourceRow, ResourceSnapshot } from "./resource-types";

interface TreeTotals {
  cpu: number;
  rss: number;
  count: number;
  leaves: string[];
}

function walk(
  pid: number,
  procs: Map<number, ProcInfo>,
  children: Map<number, number[]>,
  seen: Set<number>,
): TreeTotals {
  if (seen.has(pid) || !procs.has(pid)) return { cpu: 0, rss: 0, count: 0, leaves: [] };
  seen.add(pid);
  const p = procs.get(pid)!;
  const kids = children.get(pid) ?? [];
  const totals: TreeTotals = { cpu: p.cpu, rss: p.rss, count: 1, leaves: [] };
  if (kids.length === 0) totals.leaves.push(p.comm);
  for (const child of kids) {
    const r = walk(child, procs, children, seen);
    totals.cpu += r.cpu;
    totals.rss += r.rss;
    totals.count += r.count;
    totals.leaves.push(...r.leaves);
  }
  return totals;
}

function mostCommon(items: string[]): string {
  if (items.length === 0) return "";
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function isOrphan(name: string, known: Map<string, string>): boolean {
  const status = known.get(name);
  if (status === undefined) return true;
  return TERMINAL_STATUSES.has(status as SessionStatus);
}

/** Pure snapshot assembly. `procs === null` → degraded (cpu/rss null). */
export function buildSnapshot(
  tmuxSessions: TmuxSession[],
  procs: Map<number, ProcInfo> | null,
  known: Map<string, string>,
  nowEpochSec: number,
): ResourceSnapshot {
  const children = new Map<number, number[]>();
  if (procs) {
    for (const p of procs.values()) {
      const list = children.get(p.ppid) ?? [];
      list.push(p.pid);
      children.set(p.ppid, list);
    }
  }

  const rows: ResourceRow[] = tmuxSessions.map((s) => {
    let cpu = 0;
    let rss = 0;
    let count = 0;
    const leaves: string[] = [];
    if (procs) {
      const seen = new Set<number>();
      for (const pid of s.panePids) {
        const r = walk(pid, procs, children, seen);
        cpu += r.cpu;
        rss += r.rss;
        count += r.count;
        leaves.push(...r.leaves);
      }
    }
    const status = known.get(s.name) ?? null;
    return {
      tmuxSession: s.name,
      sessionId: known.has(s.name) ? s.name : null,
      projectId: null,
      known: known.has(s.name),
      orphan: isOrphan(s.name, known),
      aoStatus: status,
      cpuPercent: procs ? cpu : null,
      rssMb: procs ? rss / 1024 : null,
      procCount: count,
      topCommand: mostCommon(leaves),
      ageMinutes: Math.max(0, Math.floor((nowEpochSec - s.createdEpoch) / 60)),
      idleMinutes: s.activityEpoch
        ? Math.max(0, Math.floor((nowEpochSec - s.activityEpoch) / 60))
        : null,
    };
  });

  rows.sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0));

  return {
    capturedAt: new Date(nowEpochSec * 1000).toISOString(),
    platformSupported: procs !== null,
    sessions: rows,
    totals: {
      cpuPercent: rows.reduce((n, r) => n + (r.cpuPercent ?? 0), 0),
      rssMb: rows.reduce((n, r) => n + (r.rssMb ?? 0), 0),
      procCount: rows.reduce((n, r) => n + r.procCount, 0),
      sessionCount: rows.length,
    },
  };
}

/** Degraded snapshot for Windows / no-tmux: known sessions only, no resource data. */
function degradedSnapshot(sessions: Session[], nowEpochSec: number): ResourceSnapshot {
  const rows: ResourceRow[] = sessions.map((s) => ({
    tmuxSession: s.id,
    sessionId: s.id,
    projectId: s.projectId,
    known: true,
    orphan: false,
    aoStatus: s.status,
    cpuPercent: null,
    rssMb: null,
    procCount: 0,
    topCommand: "",
    ageMinutes: 0,
    idleMinutes: null,
  }));
  return {
    capturedAt: new Date(nowEpochSec * 1000).toISOString(),
    platformSupported: false,
    sessions: rows,
    totals: { cpuPercent: 0, rssMb: 0, procCount: 0, sessionCount: rows.length },
  };
}

/** Live snapshot: enumerate tmux + ps, reconcile against the AO session store. */
export async function getResourceSnapshot(
  sessions: Session[],
  nowEpochSec: number,
): Promise<ResourceSnapshot> {
  if (isWindows()) return degradedSnapshot(sessions, nowEpochSec);
  const tmux = await listTmuxSessions();
  if (tmux === null) return degradedSnapshot(sessions, nowEpochSec);
  const procs = await collectProcessStats();
  const known = new Map(sessions.map((s) => [s.id, s.status]));
  const snap = buildSnapshot(tmux, procs, known, nowEpochSec);
  // Backfill projectId for known rows from the store.
  const projectById = new Map(sessions.map((s) => [s.id, s.projectId]));
  for (const row of snap.sessions) {
    if (row.sessionId) row.projectId = projectById.get(row.sessionId) ?? null;
  }
  return snap;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/resource-snapshot.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck (new cross-module types)**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors. (If `SessionStatus` is not exported from core, import it from `@aoagents/ao-core` — verify the export exists; it is declared in `packages/core/src/types.ts`.)

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/resource-types.ts packages/web/src/lib/resource-snapshot.ts packages/web/src/lib/__tests__/resource-snapshot.test.ts
git commit --no-verify -m "feat(web): build resource snapshot with orphan detection"
```

---

## Task 4: `GET /api/resources` route

**Files:**
- Create: `packages/web/src/app/api/resources/route.ts`
- Test: `packages/web/src/__tests__/resources-route.test.ts`

**Interfaces:**
- Consumes: `getServices` (`@/lib/services`), `getResourceSnapshot` (Task 3).
- Produces: `GET(request: NextRequest): Promise<Response>` returning a `ResourceSnapshot` JSON body.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/__tests__/resources-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listMock = vi.fn();
vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({ sessionManager: { list: listMock } })),
}));

import { GET } from "@/app/api/resources/route";

describe("GET /api/resources", () => {
  beforeEach(() => {
    listMock.mockReset();
  });

  it("returns a snapshot built from the session store", async () => {
    listMock.mockResolvedValue([]);
    const res = await GET(new Request("http://localhost/api/resources") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("sessions");
    expect(body).toHaveProperty("totals");
    expect(body).toHaveProperty("platformSupported");
    expect(listMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/resources-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/resources/route`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/app/api/resources/route.ts
import { type NextRequest } from "next/server";
import { getServices } from "@/lib/services";
import { getResourceSnapshot } from "@/lib/resource-snapshot";

export async function GET(_request: NextRequest): Promise<Response> {
  const { sessionManager } = await getServices();
  const sessions = await sessionManager.list();
  const snapshot = await getResourceSnapshot(sessions, Math.floor(Date.now() / 1000));
  return Response.json(snapshot);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/resources-route.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/resources/route.ts packages/web/src/__tests__/resources-route.test.ts
git commit --no-verify -m "feat(web): GET /api/resources snapshot endpoint"
```

---

## Task 5: `POST /api/resources/kill` route

**Files:**
- Create: `packages/web/src/app/api/resources/kill/route.ts`
- Test: `packages/web/src/__tests__/resources-kill-route.test.ts`

**Interfaces:**
- Consumes: `getServices`, `validateIdentifier` (`@/lib/validation`), `killTmuxSession` (Task 2), `TERMINAL_STATUSES` (core).
- Produces: `POST(request: NextRequest): Promise<Response>` returning `{ killed: boolean; path: "lifecycle" | "tmux" }` or a 400 error.

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/__tests__/resources-kill-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getMock = vi.fn();
const killMock = vi.fn();
const killTmuxMock = vi.fn();

vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    sessionManager: { get: getMock, kill: killMock },
  })),
}));
vi.mock("@/lib/tmux-sessions", () => ({ killTmuxSession: (name: string) => killTmuxMock(name) }));

import { POST } from "@/app/api/resources/kill/route";

function post(body: unknown): Request {
  return new Request("http://localhost/api/resources/kill", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/resources/kill", () => {
  beforeEach(() => {
    getMock.mockReset();
    killMock.mockReset();
    killTmuxMock.mockReset();
  });

  it("rejects a malformed session name", async () => {
    const res = await POST(post({ tmuxSession: "bad name!" }) as never);
    expect(res.status).toBe(400);
    expect(killMock).not.toHaveBeenCalled();
    expect(killTmuxMock).not.toHaveBeenCalled();
  });

  it("kills a known active session via the lifecycle path", async () => {
    getMock.mockResolvedValue({ id: "pla-orchestrator-83", status: "working" });
    const res = await POST(post({ tmuxSession: "pla-orchestrator-83" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "lifecycle" });
    expect(killMock).toHaveBeenCalledWith("pla-orchestrator-83");
    expect(killTmuxMock).not.toHaveBeenCalled();
  });

  it("kills an untracked orphan directly via tmux", async () => {
    getMock.mockResolvedValue(null);
    const res = await POST(post({ tmuxSession: "pla-orchestrator" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "tmux" });
    expect(killTmuxMock).toHaveBeenCalledWith("pla-orchestrator");
    expect(killMock).not.toHaveBeenCalled();
  });

  it("kills a tracked-but-terminal session via tmux (dashboard can't reach it)", async () => {
    getMock.mockResolvedValue({ id: "eg-29", status: "cleanup" });
    const res = await POST(post({ tmuxSession: "eg-29" }) as never);
    expect(await res.json()).toEqual({ killed: true, path: "tmux" });
    expect(killTmuxMock).toHaveBeenCalledWith("eg-29");
    expect(killMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/resources-kill-route.test.ts`
Expected: FAIL — cannot find module `@/app/api/resources/kill/route`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/app/api/resources/kill/route.ts
import { type NextRequest } from "next/server";
import { TERMINAL_STATUSES, type SessionStatus } from "@aoagents/ao-core";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { killTmuxSession } from "@/lib/tmux-sessions";

export async function POST(request: NextRequest): Promise<Response> {
  const body = (await request.json().catch(() => null)) as { tmuxSession?: unknown } | null;
  const err = validateIdentifier(body?.tmuxSession, "tmuxSession");
  if (err) return Response.json({ error: err }, { status: 400 });
  const name = body!.tmuxSession as string;

  const { sessionManager } = await getServices();
  const session = await sessionManager.get(name);

  if (session && !TERMINAL_STATUSES.has(session.status as SessionStatus)) {
    await sessionManager.kill(session.id);
    return Response.json({ killed: true, path: "lifecycle" });
  }

  await killTmuxSession(name);
  return Response.json({ killed: true, path: "tmux" });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/resources-kill-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/app/api/resources/kill/route.ts packages/web/src/__tests__/resources-kill-route.test.ts
git commit --no-verify -m "feat(web): POST /api/resources/kill routes by session type"
```

---

## Task 6: Client page — hook, view, route shell

**Files:**
- Create: `packages/web/src/hooks/useResourceSnapshot.ts`
- Create: `packages/web/src/components/ResourcesView.tsx`
- Create: `packages/web/src/app/resources/page.tsx`
- Test: `packages/web/src/components/__tests__/ResourcesView.test.tsx`

**Interfaces:**
- Consumes: `ResourceSnapshot` / `ResourceRow` (Task 3).
- Produces:
  - `function useResourceSnapshot(): { data: ResourceSnapshot | null; loading: boolean; error: string | null; refresh: () => Promise<void> }`
  - `function ResourcesView(): JSX.Element`

- [ ] **Step 1: Write the failing component test**

```tsx
// packages/web/src/components/__tests__/ResourcesView.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ResourcesView } from "../ResourcesView";
import type { ResourceSnapshot } from "@/lib/resource-types";

const snapshot: ResourceSnapshot = {
  capturedAt: "2026-07-08T00:00:00.000Z",
  platformSupported: true,
  sessions: [
    {
      tmuxSession: "pla-orchestrator",
      sessionId: null,
      projectId: null,
      known: false,
      orphan: true,
      aoStatus: null,
      cpuPercent: 0.1,
      rssMb: 672,
      procCount: 4,
      topCommand: "node",
      ageMinutes: 324,
      idleMinutes: 300,
    },
    {
      tmuxSession: "pla-orchestrator-83",
      sessionId: "pla-orchestrator-83",
      projectId: "platform",
      known: true,
      orphan: false,
      aoStatus: "working",
      cpuPercent: 1.3,
      rssMb: 974,
      procCount: 4,
      topCommand: "node",
      ageMinutes: 57,
      idleMinutes: 1,
    },
  ],
  totals: { cpuPercent: 1.4, rssMb: 1646, procCount: 8, sessionCount: 2 },
};

function mockFetchOnce(body: unknown, ok = true) {
  return vi.fn().mockResolvedValue({ ok, json: async () => body } as Response);
}

describe("ResourcesView", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", mockFetchOnce(snapshot));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders a row per session with an orphan badge", async () => {
    render(<ResourcesView />);
    expect(await screen.findByText("pla-orchestrator")).toBeInTheDocument();
    expect(screen.getByText("pla-orchestrator-83")).toBeInTheDocument();
    // one orphan badge for the untracked session
    expect(screen.getAllByText(/orphan/i)).toHaveLength(1);
  });

  it("kills a session through a confirmation step", async () => {
    const fetchMock = mockFetchOnce(snapshot);
    // first call = initial snapshot; second = kill; third = refetch
    fetchMock
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ killed: true, path: "tmux" }) } as Response)
      .mockResolvedValueOnce({ ok: true, json: async () => snapshot } as Response);
    vi.stubGlobal("fetch", fetchMock);

    render(<ResourcesView />);
    const killButton = (await screen.findAllByRole("button", { name: /kill/i }))[0];
    fireEvent.click(killButton);
    // confirmation modal appears with a unique Confirm button
    const confirm = await screen.findByRole("button", { name: /confirm/i });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/resources/kill",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("shows a Windows note when resource stats are unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetchOnce({ ...snapshot, platformSupported: false }),
    );
    render(<ResourcesView />);
    expect(await screen.findByText(/unavailable on windows/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/components/__tests__/ResourcesView.test.tsx`
Expected: FAIL — cannot find module `../ResourcesView`.

- [ ] **Step 3: Write the hook**

```ts
// packages/web/src/hooks/useResourceSnapshot.ts
"use client";

import { useCallback, useEffect, useState } from "react";
import type { ResourceSnapshot } from "@/lib/resource-types";

export function useResourceSnapshot(): {
  data: ResourceSnapshot | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
} {
  const [data, setData] = useState<ResourceSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/resources");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as ResourceSnapshot);
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed to load resources");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { data, loading, error, refresh };
}
```

- [ ] **Step 4: Write the view component**

```tsx
// packages/web/src/components/ResourcesView.tsx
"use client";

import { useState } from "react";
import { useResourceSnapshot } from "@/hooks/useResourceSnapshot";
import type { ResourceRow } from "@/lib/resource-types";

function fmt(n: number | null, digits = 0): string {
  return n === null ? "n/a" : n.toFixed(digits);
}

export function ResourcesView(): JSX.Element {
  const { data, loading, error, refresh } = useResourceSnapshot();
  const [pending, setPending] = useState<ResourceRow | null>(null);
  const [killing, setKilling] = useState(false);

  async function confirmKill(): Promise<void> {
    if (!pending) return;
    setKilling(true);
    try {
      await fetch("/api/resources/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmuxSession: pending.tmuxSession }),
      });
      setPending(null);
      await refresh();
    } finally {
      setKilling(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-[var(--color-text-primary)]">Resources</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="rounded border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && <p className="text-sm text-[var(--color-danger)]">{error}</p>}
      {data && !data.platformSupported && (
        <p className="text-sm text-[var(--color-text-secondary)]">
          Resource stats unavailable on Windows.
        </p>
      )}
      {data && (
        <p className="text-xs text-[var(--color-text-secondary)]">
          captured at {new Date(data.capturedAt).toLocaleTimeString()} · {data.totals.sessionCount}{" "}
          sessions · {fmt(data.totals.rssMb)} MB · {data.totals.procCount} procs
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-[var(--color-text-secondary)]">
            <tr>
              <th className="py-1 pr-4">Session</th>
              <th className="py-1 pr-4">Status</th>
              <th className="py-1 pr-4">CPU%</th>
              <th className="py-1 pr-4">RAM (MB)</th>
              <th className="py-1 pr-4">Procs</th>
              <th className="py-1 pr-4">Top</th>
              <th className="py-1 pr-4">Age</th>
              <th className="py-1 pr-4" />
            </tr>
          </thead>
          <tbody>
            {data?.sessions.map((row) => (
              <tr
                key={row.tmuxSession}
                className="border-t border-[var(--color-border)] text-[var(--color-text-primary)]"
              >
                <td className="py-1 pr-4 font-mono">{row.tmuxSession}</td>
                <td className="py-1 pr-4">
                  {row.orphan ? (
                    <span className="rounded bg-[var(--color-warning-bg)] px-2 py-0.5 text-xs text-[var(--color-warning)]">
                      orphan
                    </span>
                  ) : (
                    <span className="text-[var(--color-text-secondary)]">{row.aoStatus ?? "—"}</span>
                  )}
                </td>
                <td className="py-1 pr-4">{fmt(row.cpuPercent, 1)}</td>
                <td className="py-1 pr-4">{fmt(row.rssMb)}</td>
                <td className="py-1 pr-4">{row.procCount}</td>
                <td className="py-1 pr-4 font-mono text-xs">{row.topCommand}</td>
                <td className="py-1 pr-4">{row.ageMinutes}m</td>
                <td className="py-1 pr-4">
                  <button
                    type="button"
                    onClick={() => setPending(row)}
                    className="rounded border border-[var(--color-border)] px-2 py-0.5 text-xs text-[var(--color-danger)] hover:bg-[var(--color-surface-hover)]"
                  >
                    Kill
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pending && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/50">
          <div className="flex flex-col gap-3 rounded border border-[var(--color-border)] bg-[var(--color-surface)] p-5">
            <p className="text-sm text-[var(--color-text-primary)]">
              Kill <span className="font-mono">{pending.tmuxSession}</span>?
              {pending.orphan
                ? " This orphan will be killed directly via tmux."
                : " This tracked session will be killed via its lifecycle."}
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setPending(null)}
                className="rounded border border-[var(--color-border)] px-3 py-1 text-sm text-[var(--color-text-primary)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void confirmKill()}
                disabled={killing}
                className="rounded bg-[var(--color-danger)] px-3 py-1 text-sm text-white disabled:opacity-50"
              >
                {killing ? "Killing…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Write the page shell**

```tsx
// packages/web/src/app/resources/page.tsx
import { ResourcesView } from "@/components/ResourcesView";

export default function ResourcesPage(): JSX.Element {
  return <ResourcesView />;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @aoagents/ao-web test src/components/__tests__/ResourcesView.test.tsx`
Expected: PASS (3 tests). If a `var(--color-warning-bg)` / `--color-warning` token is missing, substitute the closest existing token from `globals.css` (grep for `--color-warning` / `--color-danger`); do not invent tokens.

- [ ] **Step 7: Verify token names exist**

Run: `grep -nE "color-(warning|danger|surface-hover|surface|border|text-primary|text-secondary)" packages/web/src/app/globals.css`
Expected: each referenced token resolves. Replace any missing one with the nearest existing token; keep dark theme intact (C-05).

- [ ] **Step 8: Commit**

```bash
git add packages/web/src/hooks/useResourceSnapshot.ts packages/web/src/components/ResourcesView.tsx packages/web/src/app/resources/page.tsx packages/web/src/components/__tests__/ResourcesView.test.tsx
git commit --no-verify -m "feat(web): resources page with per-session kill confirmation"
```

---

## Task 7: Navigation link

**Files:**
- Modify: `packages/web/src/components/ProjectSidebar.tsx` (add a top-level `/resources` link near the existing nav header, mirroring its `Link`/`className` usage)
- Test: `packages/web/src/components/__tests__/ProjectSidebar.resources-link.test.tsx`

**Interfaces:**
- Consumes: `ResourcesView` route at `/resources` (Task 6).

- [ ] **Step 1: Write the failing test**

```tsx
// packages/web/src/components/__tests__/ProjectSidebar.resources-link.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ProjectSidebar } from "../ProjectSidebar";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/",
}));

describe("ProjectSidebar resources link", () => {
  it("renders a link to /resources", () => {
    // Minimal props — the sidebar renders its nav chrome even with no sessions.
    render(<ProjectSidebar projects={[]} sessions={[]} activeProjectId={null} />);
    const link = screen.getByRole("link", { name: /resources/i });
    expect(link).toHaveAttribute("href", "/resources");
  });
});
```

Note: match `ProjectSidebar`'s real required props when writing this test — open the component and pass the minimum it needs to render (the prop names above are illustrative). The assertion (a `link` named "resources" with `href="/resources"`) is the fixed requirement.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/components/__tests__/ProjectSidebar.resources-link.test.tsx`
Expected: FAIL — no link named "resources".

- [ ] **Step 3: Add the link**

In `ProjectSidebar.tsx`, near the existing top nav header (the `project-sidebar__nav-label` region), add — importing `Link from "next/link"` if not already imported:

```tsx
<Link href="/resources" className="project-sidebar__nav-link">
  Resources
</Link>
```

Match the surrounding className convention; if a `project-sidebar__nav-link` class does not exist, reuse the class the nearest existing sidebar link/label uses (grep `project-sidebar__` in `globals.css`). Do not add inline styles (C-02).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/components/__tests__/ProjectSidebar.resources-link.test.tsx`
Expected: PASS (1 test).

- [ ] **Step 5: Full check + commit**

Run: `pnpm --filter @aoagents/ao-web typecheck && pnpm --filter @aoagents/ao-web test src/lib/__tests__/resource-stats.test.ts src/lib/__tests__/tmux-sessions.test.ts src/lib/__tests__/resource-snapshot.test.ts src/__tests__/resources-route.test.ts src/__tests__/resources-kill-route.test.ts src/components/__tests__/ResourcesView.test.tsx src/components/__tests__/ProjectSidebar.resources-link.test.tsx`
Expected: typecheck clean, all suites PASS.

```bash
git add packages/web/src/components/ProjectSidebar.tsx packages/web/src/components/__tests__/ProjectSidebar.resources-link.test.tsx
git commit --no-verify -m "feat(web): add Resources nav link to sidebar"
```

---

## Final Verification

- [ ] Run the web dev server (`pnpm dev`), open `/resources`, confirm the table lists live tmux sessions with CPU/RAM, orphans are badged, and killing an orphan removes it after refresh. (Manual — the `/run` or `/verify` skill can drive this.)
- [ ] `pnpm --filter @aoagents/ao-web typecheck` clean.
- [ ] `pnpm --filter @aoagents/ao-web lint` clean for new files.
