# Feature Orchestrator Worker Heartbeat — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wake a stalled feature orchestrator by pushing it a worker-status summary when any of its workers has had no movement for >15 min, and give it a "Workers" panel + sidebar health badge.

**Architecture:** A CLI-hosted timer (in the always-on `ao start` process) enumerates orchestrators (`metadata.feature`) and their workers (branch prefix `feature/<slug>/`), and `sm.send`s a summary when a worker is stale, the orchestrator is idle, and ≥20 min passed since the last nudge. The web side computes the same worker set client-side from the existing SSE feed and renders a Workers section in the orchestrator's detail view plus a sidebar badge. No core files edited; linkage reuses the existing branch-prefix convention.

**Tech Stack:** TypeScript (ES2022, Node16), pnpm workspaces, Vitest, Next.js 15 / React 19, Tailwind v4 tokens.

## Global Constraints

- **Fork mergeability — do NOT edit:** `packages/core/src/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`, `prompt-builder`. Use only core's public API.
- Public core API used: `sm.list(): Promise<Session[]>`, `sm.send(sessionId, message): Promise<void>`. Activity is read from the enriched `Session.activity: ActivityState | null` and `Session.lastActivityAt: Date` — do NOT call `getActivityState` (it is not exported; `list()` already enriches these).
- Thresholds (constants): stale = 15 min, re-nudge = 20 min, tick = 5 min.
- Uniform staleness rule: a worker is stale ⟺ `now − lastActivityAt > 15 min` AND its `activity` is non-null (null = no data → never stale). `waiting_input`/`blocked`/`exited` are NOT special-cased; they simply reach the threshold and their state is shown in the summary.
- TypeScript strict, no `any`, `import type` for types, no inline `style=` (C-02), component files ≤400 lines (C-04), dark theme preserved (C-05), App Router only (C-06), test files for new components (C-12), SSE 5s interval unchanged (C-14).
- `cn` helper import path: `@/lib/cn`. Color tokens via Tailwind arbitrary values: `var(--color-text-muted)`, `var(--color-status-attention)`, `var(--color-accent-amber)`, `var(--color-border-default)`.
- Conventional commits. gitleaks pre-commit hook runs.

---

### Task 1: CLI heartbeat module

**Files:**
- Create: `packages/cli/src/lib/feature-heartbeat.ts`
- Test: `packages/cli/src/lib/__tests__/feature-heartbeat.test.ts`
- Modify: `packages/cli/src/commands/start.ts` (start the timer, next to `startBunTmpJanitor`)
- Modify: `packages/cli/src/lib/shutdown.ts` (stop the timer, next to `stopBunTmpJanitor`)

**Interfaces:**
- Consumes (from core): `type Session`, `type ActivityState`, `type SessionId` from `@aoagents/ao-core`. `Session.metadata: Record<string,string>`, `Session.branch: string | null`, `Session.activity: ActivityState | null`, `Session.lastActivityAt: Date`, `Session.pr: { number: number } | null`.
- Produces:
  - `workersForOrchestrator(orchestrator: Session, all: Session[]): Session[]`
  - `isStale(session: Session, now: number, staleMs?: number): boolean`
  - `buildSummary(orchestrator: Session, workers: Session[], now: number, staleMs?: number): string`
  - `evaluateOrchestrator(orchestrator: Session, all: Session[], now: number, lastSentAt: number | undefined, staleMs?: number, renudgeMs?: number): { message: string } | null`
  - `startFeatureHeartbeat(deps: HeartbeatDeps): boolean`
  - `stopFeatureHeartbeat(): Promise<void>`
  - constants `STALE_MS`, `RENUDGE_MS`, `TICK_MS`

- [ ] **Step 1: Write failing tests for the pure decision logic**

Create `packages/cli/src/lib/__tests__/feature-heartbeat.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import type { Session } from "@aoagents/ao-core";
import {
  workersForOrchestrator,
  isStale,
  buildSummary,
  evaluateOrchestrator,
  startFeatureHeartbeat,
  stopFeatureHeartbeat,
  STALE_MS,
  RENUDGE_MS,
} from "../feature-heartbeat.js";

const NOW = 1_000_000_000_000;

function session(over: Partial<Session>): Session {
  return {
    id: "s",
    projectId: "p",
    status: "working",
    activity: "idle",
    activitySignal: "valid",
    lifecycle: null,
    branch: null,
    issueId: null,
    pr: null,
    prs: [],
    workspacePath: null,
    runtimeHandle: null,
    agentInfo: null,
    createdAt: new Date(NOW),
    lastActivityAt: new Date(NOW),
    metadata: {},
    ...over,
  } as unknown as Session;
}

const orch = (over: Partial<Session> = {}) =>
  session({ id: "hub-1", metadata: { feature: "login" }, activity: "idle", ...over });

const worker = (over: Partial<Session> = {}) =>
  session({ id: "web-1", projectId: "web", branch: "feature/login/web-form", ...over });

describe("workersForOrchestrator", () => {
  it("matches sessions by feature/<slug>/ branch prefix, excludes the orchestrator", () => {
    const all = [
      orch(),
      worker({ id: "web-1", branch: "feature/login/web-form" }),
      worker({ id: "api-1", branch: "feature/login/api-auth" }),
      worker({ id: "other-1", branch: "feature/signup/x" }),
      worker({ id: "hub-1", branch: "feature/login/nope" }), // same id as orch → excluded
    ];
    const ids = workersForOrchestrator(orch(), all).map((s) => s.id);
    expect(ids).toEqual(["web-1", "api-1"]);
  });
  it("returns [] when orchestrator has no feature slug", () => {
    expect(workersForOrchestrator(session({ metadata: {} }), [worker()])).toEqual([]);
  });
});

describe("isStale", () => {
  it("true past threshold, false within, false when activity is null", () => {
    expect(isStale(worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) }), NOW)).toBe(true);
    expect(isStale(worker({ lastActivityAt: new Date(NOW - STALE_MS + 1000) }), NOW)).toBe(false);
    expect(isStale(worker({ activity: null, lastActivityAt: new Date(0) }), NOW)).toBe(false);
  });
});

describe("buildSummary", () => {
  it("lists every worker, stale first, with state/age/PR and header/footer", () => {
    const fresh = worker({ id: "api-1", branch: "feature/login/api-auth", activity: "active", lastActivityAt: new Date(NOW - 15_000) });
    const stale = worker({ id: "web-1", branch: "feature/login/web-form", activity: "idle", lastActivityAt: new Date(NOW - 47 * 60_000), pr: { number: 123 } as Session["pr"] });
    const msg = buildSummary(orch(), [fresh, stale], NOW);
    expect(msg).toContain("[feature heartbeat] feature login");
    // stale sorted before fresh
    expect(msg.indexOf("web-1")).toBeLessThan(msg.indexOf("api-1"));
    expect(msg).toContain("IDLE 47m · PR #123");
    expect(msg).toContain("no movement");
    expect(msg).toContain("ACTIVE 15s");
    expect(msg).toContain("ao send <worker-id>");
  });
});

describe("evaluateOrchestrator", () => {
  const staleWorker = worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) });
  it("nudges when idle orchestrator has a stale worker and no prior send", () => {
    const d = evaluateOrchestrator(orch(), [orch(), staleWorker], NOW, undefined);
    expect(d).not.toBeNull();
  });
  it("stays silent when no feature slug", () => {
    expect(evaluateOrchestrator(session({ metadata: {} }), [staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when orchestrator is active", () => {
    expect(evaluateOrchestrator(orch({ activity: "active" }), [orch({ activity: "active" }), staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when orchestrator has exited", () => {
    expect(evaluateOrchestrator(orch({ activity: "exited" }), [staleWorker], NOW, undefined)).toBeNull();
  });
  it("stays silent when no workers", () => {
    expect(evaluateOrchestrator(orch(), [orch()], NOW, undefined)).toBeNull();
  });
  it("stays silent when all workers fresh", () => {
    const fresh = worker({ lastActivityAt: new Date(NOW - 1000) });
    expect(evaluateOrchestrator(orch(), [orch(), fresh], NOW, undefined)).toBeNull();
  });
  it("throttles within the re-nudge window, then nudges again after it", () => {
    const all = [orch(), staleWorker];
    expect(evaluateOrchestrator(orch(), all, NOW, NOW - RENUDGE_MS + 1000)).toBeNull();
    expect(evaluateOrchestrator(orch(), all, NOW, NOW - RENUDGE_MS - 1000)).not.toBeNull();
  });
});

describe("startFeatureHeartbeat", () => {
  afterEach(async () => {
    await stopFeatureHeartbeat();
    vi.useRealTimers();
  });
  it("sends one nudge per stale orchestrator on the immediate tick", async () => {
    const all = [orch(), worker({ lastActivityAt: new Date(NOW - STALE_MS - 1) })];
    const send = vi.fn().mockResolvedValue(undefined);
    startFeatureHeartbeat({ list: async () => all, send, now: () => NOW });
    await new Promise((r) => setTimeout(r, 0)); // let the immediate tick resolve
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBe("hub-1");
  });
});
```

- [ ] **Step 2: Run the tests to confirm they fail**

Run: `pnpm --filter @aoagents/ao-cli test -- feature-heartbeat`
Expected: FAIL — module `../feature-heartbeat.js` not found.

- [ ] **Step 3: Implement the module**

Create `packages/cli/src/lib/feature-heartbeat.ts`:

```ts
import type { Session, ActivityState, SessionId } from "@aoagents/ao-core";

export const STALE_MS = 15 * 60_000;
export const RENUDGE_MS = 20 * 60_000;
export const TICK_MS = 5 * 60_000;

/** Workers of a feature orchestrator: sessions on a `feature/<slug>/*` branch. */
export function workersForOrchestrator(orchestrator: Session, all: Session[]): Session[] {
  const slug = orchestrator.metadata["feature"];
  if (!slug) return [];
  const prefix = `feature/${slug}/`;
  return all.filter(
    (s) => s.id !== orchestrator.id && (s.branch?.startsWith(prefix) ?? false),
  );
}

function ageMs(session: Session, now: number): number {
  return now - session.lastActivityAt.getTime();
}

/** No movement past the threshold. Null activity = no data → never stale. */
export function isStale(session: Session, now: number, staleMs: number = STALE_MS): boolean {
  return session.activity !== null && ageMs(session, now) > staleMs;
}

function taskName(slug: string, worker: Session): string {
  const prefix = `feature/${slug}/`;
  if (worker.branch?.startsWith(prefix)) return worker.branch.slice(prefix.length);
  return worker.branch ?? worker.id;
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

/** Human summary of all workers, stale ones first. */
export function buildSummary(
  orchestrator: Session,
  workers: Session[],
  now: number,
  staleMs: number = STALE_MS,
): string {
  const slug = orchestrator.metadata["feature"] ?? "";
  const ordered = [...workers].sort(
    (a, b) => Number(isStale(b, now, staleMs)) - Number(isStale(a, now, staleMs)),
  );
  const lines = ordered.map((w) => {
    const state = (w.activity ?? "unknown").toUpperCase();
    const age = formatAge(ageMs(w, now));
    const pr = w.pr ? ` · PR #${w.pr.number}` : "";
    const flag = isStale(w, now, staleMs)
      ? " — no movement; may be done or stuck, check it."
      : " — ok.";
    return `- ${w.id} (task ${taskName(slug, w)}): ${state} ${age}${pr}${flag}`;
  });
  return [
    `[feature heartbeat] feature ${slug} — worker status (no human here, act autonomously):`,
    ...lines,
    `This may be expected. If a worker looks stuck: ao send <worker-id> "status?" or open its terminal. If all is fine, ignore this.`,
  ].join("\n");
}

/** Decide whether to nudge one orchestrator this tick. */
export function evaluateOrchestrator(
  orchestrator: Session,
  all: Session[],
  now: number,
  lastSentAt: number | undefined,
  staleMs: number = STALE_MS,
  renudgeMs: number = RENUDGE_MS,
): { message: string } | null {
  if (!orchestrator.metadata["feature"]) return null;
  if (orchestrator.activity === "exited") return null; // dead
  if (orchestrator.activity === "active") return null; // busy — don't interrupt
  const workers = workersForOrchestrator(orchestrator, all);
  if (workers.length === 0) return null;
  if (!workers.some((w) => isStale(w, now, staleMs))) return null;
  if (lastSentAt !== undefined && now - lastSentAt < renudgeMs) return null; // throttle
  return { message: buildSummary(orchestrator, workers, now, staleMs) };
}

export interface HeartbeatDeps {
  list: () => Promise<Session[]>;
  send: (sessionId: SessionId, message: string) => Promise<void>;
  now?: () => number;
  intervalMs?: number;
  staleMs?: number;
  renudgeMs?: number;
  onError?: (err: unknown) => void;
}

let timer: NodeJS.Timeout | null = null;
let inFlight: Promise<void> | null = null;
const lastSent = new Map<string, number>();

/** Start the periodic heartbeat. Idempotent — no-op if already running. */
export function startFeatureHeartbeat(deps: HeartbeatDeps): boolean {
  if (timer) return false;
  const now = deps.now ?? (() => Date.now());
  const intervalMs = deps.intervalMs ?? TICK_MS;
  const staleMs = deps.staleMs ?? STALE_MS;
  const renudgeMs = deps.renudgeMs ?? RENUDGE_MS;

  const tick = async (): Promise<void> => {
    if (inFlight) return;
    inFlight = (async () => {
      try {
        const sessions = await deps.list();
        const t = now();
        for (const orch of sessions) {
          try {
            const decision = evaluateOrchestrator(
              orch, sessions, t, lastSent.get(orch.id), staleMs, renudgeMs,
            );
            if (!decision) continue;
            await deps.send(orch.id, decision.message);
            lastSent.set(orch.id, t);
          } catch (err) {
            deps.onError?.(err);
          }
        }
      } catch (err) {
        deps.onError?.(err);
      } finally {
        inFlight = null;
      }
    })();
    await inFlight;
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);
  timer.unref();
  return true;
}

/** Stop the heartbeat and await any in-flight tick. */
export async function stopFeatureHeartbeat(): Promise<void> {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (inFlight) {
    try {
      await inFlight;
    } catch {
      /* best-effort */
    }
  }
  lastSent.clear();
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `pnpm --filter @aoagents/ao-cli test -- feature-heartbeat`
Expected: PASS (all cases).

- [ ] **Step 5: Wire the timer into `ao start`**

In `packages/cli/src/commands/start.ts`, add an import near the other lib imports (line ~54, next to the `startBunTmpJanitor` import):

```ts
import { startFeatureHeartbeat } from "../lib/feature-heartbeat.js";
```

Immediately after the existing `startBunTmpJanitor({ ... });` call (start.ts:1835), add:

```ts
// Wake stalled feature orchestrators: push a worker-status summary when a
// worker has had no movement for >15 min. Runs for the life of `ao start`.
const heartbeatSm = await getSessionManager(config);
startFeatureHeartbeat({
  list: () => heartbeatSm.list(),
  send: (id, msg) => heartbeatSm.send(id, msg),
  onError: (err) => console.warn("[feature-heartbeat] tick failed:", err),
});
```

(`getSessionManager` is already imported at start.ts:52 and is process-memoized, so calling it here is safe.)

- [ ] **Step 6: Wire shutdown**

In `packages/cli/src/lib/shutdown.ts`, add the import at the top alongside the janitor import:

```ts
import { stopFeatureHeartbeat } from "./feature-heartbeat.js";
```

In the cleanup body, right next to the existing `await stopBunTmpJanitor();` (shutdown.ts:182-188), add:

```ts
try {
  await stopFeatureHeartbeat();
} catch {
  /* best-effort cleanup */
}
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @aoagents/ao-cli typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/lib/feature-heartbeat.ts \
        packages/cli/src/lib/__tests__/feature-heartbeat.test.ts \
        packages/cli/src/commands/start.ts \
        packages/cli/src/lib/shutdown.ts
git commit -m "feat(cli): heartbeat that wakes stalled feature orchestrators"
```

---

### Task 2: Web worker-health helper

**Files:**
- Modify: `packages/web/src/lib/feature-sessions.ts` (append functions)
- Test: `packages/web/src/lib/__tests__/feature-sessions.test.ts` (create or extend)

**Interfaces:**
- Consumes: `type DashboardSession`, `type DashboardPR` from `./types`; `type ActivityState` from `@aoagents/ao-core`. `DashboardSession.branch: string | null`, `.activity: ActivityState | null`, `.lastActivityAt: string` (ISO), `.pr: DashboardPR | null`, `.metadata: Record<string,string>`.
- Produces:
  - `workersForFeature(sessions: DashboardSession[] | null, slug: string): DashboardSession[]`
  - `interface WorkerHealth { id; projectId; task; branch: string | null; activity: ActivityState | null; ageMs: number; stale: boolean; pr: DashboardPR | null }`
  - `workerHealthList(sessions: DashboardSession[] | null, slug: string, nowMs: number, staleMs?: number): WorkerHealth[]`
  - `formatAgeShort(ms: number): string`

- [ ] **Step 1: Write failing tests**

Create/extend `packages/web/src/lib/__tests__/feature-sessions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { DashboardSession } from "../types";
import { workersForFeature, workerHealthList, formatAgeShort } from "../feature-sessions";

const NOW = 1_000_000_000_000;
const STALE = 15 * 60_000;

function s(over: Partial<DashboardSession>): DashboardSession {
  return {
    id: "x", projectId: "p", status: "working", activity: "idle",
    branch: null, displayName: null, displayNameUserSet: false,
    lastActivityAt: new Date(NOW).toISOString(), pr: null, prs: [], metadata: {},
    ...over,
  } as unknown as DashboardSession;
}

describe("workersForFeature", () => {
  it("filters by feature/<slug>/ branch prefix; tolerates null", () => {
    const all = [
      s({ id: "a", branch: "feature/login/web" }),
      s({ id: "b", branch: "feature/login/api" }),
      s({ id: "c", branch: "feature/signup/web" }),
      s({ id: "d", branch: null }),
    ];
    expect(workersForFeature(all, "login").map((x) => x.id)).toEqual(["a", "b"]);
    expect(workersForFeature(null, "login")).toEqual([]);
    expect(workersForFeature(all, "")).toEqual([]);
  });
});

describe("workerHealthList", () => {
  it("computes task suffix, age, staleness; sorts stale-first then oldest", () => {
    const all = [
      s({ id: "fresh", branch: "feature/login/api", activity: "active", lastActivityAt: new Date(NOW - 1000).toISOString() }),
      s({ id: "old", branch: "feature/login/web", activity: "idle", lastActivityAt: new Date(NOW - STALE - 60_000).toISOString() }),
      s({ id: "nodata", branch: "feature/login/x", activity: null, lastActivityAt: new Date(0).toISOString() }),
    ];
    const list = workerHealthList(all, "login", NOW);
    expect(list[0].id).toBe("old");
    expect(list[0].stale).toBe(true);
    expect(list[0].task).toBe("web");
    expect(list.find((w) => w.id === "nodata")!.stale).toBe(false); // null activity never stale
    expect(list.find((w) => w.id === "fresh")!.stale).toBe(false);
  });
});

describe("formatAgeShort", () => {
  it("formats seconds/minutes/hours", () => {
    expect(formatAgeShort(15_000)).toBe("15s");
    expect(formatAgeShort(47 * 60_000)).toBe("47m");
    expect(formatAgeShort(2 * 3_600_000 + 5 * 60_000)).toBe("2h 5m");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: FAIL — `workersForFeature` / `workerHealthList` / `formatAgeShort` are not exported.

- [ ] **Step 3: Append the implementation**

Append to `packages/web/src/lib/feature-sessions.ts` (keep existing exports; add the import for `ActivityState` and `DashboardPR`):

```ts
import type { ActivityState } from "@aoagents/ao-core";
import type { DashboardPR } from "./types";

const WORKER_STALE_MS = 15 * 60_000;

/** Workers of a feature: sessions whose branch is `feature/<slug>/*`. */
export function workersForFeature(
  sessions: DashboardSession[] | null,
  slug: string,
): DashboardSession[] {
  if (!slug) return [];
  const prefix = `feature/${slug}/`;
  return (sessions ?? []).filter((s) => s.branch?.startsWith(prefix) ?? false);
}

export interface WorkerHealth {
  id: string;
  projectId: string;
  task: string;
  branch: string | null;
  activity: ActivityState | null;
  ageMs: number;
  stale: boolean;
  pr: DashboardPR | null;
}

/** Compact age label: "15s", "47m", "2h 5m". */
export function formatAgeShort(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}

function toWorkerHealth(
  session: DashboardSession,
  slug: string,
  nowMs: number,
  staleMs: number,
): WorkerHealth {
  const prefix = `feature/${slug}/`;
  const task = session.branch?.startsWith(prefix)
    ? session.branch.slice(prefix.length)
    : (session.branch ?? session.id);
  const ageMs = nowMs - new Date(session.lastActivityAt).getTime();
  return {
    id: session.id,
    projectId: session.projectId,
    task,
    branch: session.branch,
    activity: session.activity,
    ageMs,
    stale: session.activity !== null && ageMs > staleMs,
    pr: session.pr,
  };
}

/** Worker health for a feature, stale-first then oldest-first. */
export function workerHealthList(
  sessions: DashboardSession[] | null,
  slug: string,
  nowMs: number,
  staleMs: number = WORKER_STALE_MS,
): WorkerHealth[] {
  return workersForFeature(sessions, slug)
    .map((s) => toWorkerHealth(s, slug, nowMs, staleMs))
    .sort((a, b) => Number(b.stale) - Number(a.stale) || b.ageMs - a.ageMs);
}
```

- [ ] **Step 4: Run tests to confirm they pass**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/feature-sessions.ts \
        packages/web/src/lib/__tests__/feature-sessions.test.ts
git commit -m "feat(web): worker-health helpers for feature orchestrators"
```

---

### Task 3: Workers panel in the orchestrator detail view

**Files:**
- Create: `packages/web/src/components/OrchestratorWorkersCard.tsx`
- Test: `packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx`
- Modify: `packages/web/src/components/SessionInspector.tsx` (mount in `SummaryView`)

**Interfaces:**
- Consumes: `workerHealthList`, `formatAgeShort`, `type WorkerHealth` from `../lib/feature-sessions`; `isFeatureCoordinator` (already in that module); `type DashboardSession` from `../lib/types`; `useSessionEvents` from `../hooks/useSessionEvents`; `projectSessionPath` from `../lib/routes`; `cn` from `@/lib/cn`; `useRouter` from `next/navigation`.
- Produces: `OrchestratorWorkersList` (pure, testable) and `OrchestratorWorkersCard` (smart container).

- [ ] **Step 1: Write failing test for the presentational list**

Create `packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { OrchestratorWorkersList } from "../OrchestratorWorkersCard";
import type { WorkerHealth } from "../../lib/feature-sessions";

const w = (over: Partial<WorkerHealth>): WorkerHealth => ({
  id: "web-1", projectId: "web", task: "web-form", branch: "feature/login/web-form",
  activity: "idle", ageMs: 47 * 60_000, stale: true, pr: null, ...over,
});

describe("OrchestratorWorkersList", () => {
  it("renders the empty state when there are no workers", () => {
    render(<OrchestratorWorkersList workers={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no workers/i)).toBeInTheDocument();
  });

  it("renders a row per worker with task, state, age, and PR", () => {
    render(
      <OrchestratorWorkersList
        workers={[w({ pr: { number: 123 } as WorkerHealth["pr"] })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("web-form")).toBeInTheDocument();
    expect(screen.getByText(/idle/i)).toBeInTheDocument();
    expect(screen.getByText("47m")).toBeInTheDocument();
    expect(screen.getByText("#123")).toBeInTheDocument();
    expect(screen.getByText(/stalled/i)).toBeInTheDocument();
  });

  it("calls onOpen with projectId and id when a row is clicked", () => {
    const onOpen = vi.fn();
    render(<OrchestratorWorkersList workers={[w({})]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("web", "web-1");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorWorkersCard`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Implement the component**

Create `packages/web/src/components/OrchestratorWorkersCard.tsx`:

```tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/cn";
import type { DashboardSession } from "../lib/types";
import { useSessionEvents } from "../hooks/useSessionEvents";
import { projectSessionPath } from "../lib/routes";
import {
  workerHealthList,
  formatAgeShort,
  type WorkerHealth,
} from "../lib/feature-sessions";

const STATE_LABEL: Record<string, string> = {
  active: "active",
  ready: "ready",
  idle: "idle",
  waiting_input: "waiting",
  blocked: "blocked",
  exited: "exited",
};

export function OrchestratorWorkersList({
  workers,
  onOpen,
}: {
  workers: WorkerHealth[];
  onOpen: (projectId: string, id: string) => void;
}) {
  if (workers.length === 0) {
    return <p className="inspector-empty">No workers spawned yet.</p>;
  }
  return (
    <ul className="flex flex-col gap-[6px]">
      {workers.map((w) => (
        <li key={w.id}>
          <button
            type="button"
            onClick={() => onOpen(w.projectId, w.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left",
              w.stale
                ? "border-[var(--color-accent-amber)]"
                : "border-[var(--color-border-default)]",
            )}
          >
            <span className="truncate text-sm font-medium">{w.task}</span>
            <span className="text-xs text-[var(--color-text-muted)]">
              {STATE_LABEL[w.activity ?? ""] ?? "unknown"} · {formatAgeShort(w.ageMs)}
            </span>
            {w.pr ? <span className="ml-auto text-xs">#{w.pr.number}</span> : null}
            {w.stale ? (
              <span className="text-xs text-[var(--color-status-attention)]">stalled</span>
            ) : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function OrchestratorWorkersCard({ session }: { session: DashboardSession }) {
  const slug = session.metadata["feature"] ?? "";
  // Unscoped feed: workers live in the linked projects, not this one.
  const { sessions } = useSessionEvents();
  const router = useRouter();
  const workers = useMemo(
    () => workerHealthList(sessions, slug, Date.now()),
    [sessions, slug],
  );
  return (
    <OrchestratorWorkersList
      workers={workers}
      onOpen={(projectId, id) => router.push(projectSessionPath(projectId, id))}
    />
  );
}
```

- [ ] **Step 4: Run test to confirm it passes**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorWorkersCard`
Expected: PASS.

- [ ] **Step 5: Mount the card in the orchestrator's detail view**

In `packages/web/src/components/SessionInspector.tsx`:

Add imports near the top:

```ts
import { isFeatureCoordinator } from "@/lib/feature-sessions";
import { OrchestratorWorkersCard } from "./OrchestratorWorkersCard";
```

In `SummaryView`, add a new `<Section>` immediately after the "Pull request" section (after its closing `</Section>`), gated on the session being a feature coordinator:

```tsx
{isFeatureCoordinator(session) ? (
  <Section title="Workers">
    <OrchestratorWorkersCard session={session} />
  </Section>
) : null}
```

- [ ] **Step 6: Verify the web build (App Router + client component wiring)**

Run: `pnpm --filter @aoagents/ao-web build`
Expected: build succeeds (this catches App Router / "use client" issues that typecheck+vitest miss — required by project rule).

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/components/OrchestratorWorkersCard.tsx \
        packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx \
        packages/web/src/components/SessionInspector.tsx
git commit -m "feat(web): workers panel in feature-orchestrator detail view"
```

---

### Task 4: Sidebar health badge in the Features group

**Files:**
- Modify: `packages/web/src/components/ProjectSidebar.tsx` (Features group row, ~line 1080-1118)

**Interfaces:**
- Consumes: `workerHealthList` from `@/lib/feature-sessions`; the existing `sessions: DashboardSession[] | null` prop (which spans all visible projects, so cross-project workers are present).
- Produces: a compact badge (`3w · 1 stalled`) per feature row.

- [ ] **Step 1: Add the badge to the Features row render**

In `packages/web/src/components/ProjectSidebar.tsx`, extend the existing import at line 14 (do not add a second import from the same module — `import/no-duplicates` forbids it):

```ts
import { featureLabel, isFeatureCoordinator, workerHealthList } from "@/lib/feature-sessions";
```

Inside the `featureSessions.map((session) => { ... })` body (after `const slug = featureLabel(session);`), compute the worker health from the full `sessions` list using the feature slug (`metadata.feature`, not the humanized label):

```ts
const featureSlug = session.metadata["feature"] ?? "";
const workers = workerHealthList(sessions, featureSlug, Date.now());
const stalledCount = workers.filter((w) => w.stale).length;
```

Then render a badge after the label `<span>{slug}</span>` (inside the same `<div className="flex-1 min-w-0">`):

```tsx
{workers.length > 0 ? (
  <span className="text-[10px] text-[var(--color-text-muted)]">
    {workers.length}w
    {stalledCount > 0 ? (
      <span className="text-[var(--color-status-attention)]"> · {stalledCount} stalled</span>
    ) : null}
  </span>
) : null}
```

- [ ] **Step 2: Verify the web build**

Run: `pnpm --filter @aoagents/ao-web build`
Expected: build succeeds.

- [ ] **Step 3: Run the full web test + typecheck gate**

Run: `pnpm --filter @aoagents/ao-web test && pnpm --filter @aoagents/ao-web typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/web/src/components/ProjectSidebar.tsx
git commit -m "feat(web): worker-health badge on feature sidebar rows"
```

---

## Final verification

- [ ] `pnpm --filter @aoagents/ao-cli test && pnpm --filter @aoagents/ao-cli typecheck`
- [ ] `pnpm --filter @aoagents/ao-web test && pnpm --filter @aoagents/ao-web typecheck && pnpm --filter @aoagents/ao-web build`
- [ ] `pnpm lint` (repo root)
- [ ] Confirm no edits to `core/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`, `prompt-builder`: `git diff --name-only main | grep -E 'core/src/(types|lifecycle-manager|session-manager|prompt-builder)' || echo "clean"`
