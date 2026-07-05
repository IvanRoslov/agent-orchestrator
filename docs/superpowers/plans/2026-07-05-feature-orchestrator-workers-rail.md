# Feature Orchestrator Workers Right Rail — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a feature orchestrator its own visible, detailed, collapsible right-rail "Workers" panel (like a worker's PR rail), instead of only a count badge.

**Architecture:** A new `OrchestratorInspector` right rail renders for feature coordinators (previously the whole inspector was skipped for orchestrators). It reuses the existing worker-poll to list workers with a colored status dot, exact last-activity time, PR+CI chip, and full branch. A collapse button on the rail (state persisted in `localStorage`) hides it so the terminal reclaims full width; a "Workers" button in the header re-opens it. All changes are in `packages/web/**`.

**Tech Stack:** Next.js 15 / React 19, Tailwind v4 CSS-var tokens, Vitest + @testing-library/react.

## Global Constraints

- Fork mergeability: NO edits under `packages/core/src/**`. All changes in `packages/web/**`.
- C-02 no inline `style=` (Tailwind utilities + `var(--color-*)` tokens only). C-04 ≤400 lines/component. C-05 dark theme preserved (no hardcoded hex — use tokens). C-06 App Router. C-12 tests for new/changed components. C-14 SSE 5s unchanged (the workers poll is a pre-existing separate 5s fetch — do not change its interval).
- `localStorage` key for collapse: `ao-workers-rail-collapsed` (`"1"` collapsed / `"0"` open). Wrap all `localStorage` access in try/catch; SSR/unavailable → treat as open (`false`).
- Staleness rule unchanged: stale ⟺ `activity !== null && ageMs > 15min`.
- Reuse existing helpers; do NOT duplicate PR-status logic (extract and share it).
- `cn` from `@/lib/cn`. Relative time from `formatRelativeTime(epochMs)` in `@/lib/format`.
- Conventional commits. gitleaks pre-commit hook runs.

---

### Task 1: Add `lastActivityAt` to `WorkerHealth`

**Files:**
- Modify: `packages/web/src/lib/feature-sessions.ts` (`WorkerHealth`, `toWorkerHealth`)
- Test: `packages/web/src/lib/__tests__/feature-sessions.test.ts`

**Interfaces:**
- Produces: `WorkerHealth.lastActivityAt: string` (the session's raw ISO timestamp), populated in `toWorkerHealth`.

- [ ] **Step 1: Write the failing test**

Add to `packages/web/src/lib/__tests__/feature-sessions.test.ts` inside the `describe("workerHealthList", ...)` (reuse the existing `s(...)` factory in that file):

```ts
it("carries the raw lastActivityAt ISO string through to WorkerHealth", () => {
  const iso = new Date(NOW - 60_000).toISOString();
  const all = [s({ id: "w", branch: "feature/login/web", lastActivityAt: iso })];
  expect(workerHealthList(all, "login", NOW)[0].lastActivityAt).toBe(iso);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: FAIL — `lastActivityAt` is `undefined` on the result.

- [ ] **Step 3: Implement**

In `packages/web/src/lib/feature-sessions.ts`, add the field to the interface:

```ts
export interface WorkerHealth {
  id: string;
  projectId: string;
  task: string;
  branch: string | null;
  activity: ActivityState | null;
  ageMs: number;
  stale: boolean;
  pr: DashboardPR | null;
  lastActivityAt: string;
}
```

And populate it in `toWorkerHealth` (add one line to the returned object):

```ts
  return {
    id: session.id,
    projectId: session.projectId,
    task,
    branch: session.branch,
    activity: session.activity,
    ageMs,
    stale: session.activity !== null && ageMs > staleMs,
    pr: session.pr,
    lastActivityAt: session.lastActivityAt,
  };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/feature-sessions.ts packages/web/src/lib/__tests__/feature-sessions.test.ts
git commit -m "feat(web): carry lastActivityAt on WorkerHealth"
```

---

### Task 2: Extract shared PR-display helpers

Three PR-status helpers are module-private in `SessionCard.tsx`. Move them to a shared module so the workers list can reuse them (no duplication).

**Files:**
- Create: `packages/web/src/lib/pr-display.ts`
- Modify: `packages/web/src/components/SessionCard.tsx` (remove local defs, import from the new module)
- Test: `packages/web/src/lib/__tests__/pr-display.test.ts`

**Interfaces:**
- Produces (exported from `pr-display.ts`): `getPRDotClass(p: DashboardPR): string`, `getPRChipColorClass(p: DashboardPR): string`, `getPRStatusLabel(p: DashboardPR): string`.

- [ ] **Step 1: Move the three functions verbatim into the new module**

Create `packages/web/src/lib/pr-display.ts`. CUT the three functions `getPRDotClass`, `getPRChipColorClass`, `getPRStatusLabel` from `SessionCard.tsx` (currently at `SessionCard.tsx:35-77`) and paste them here **unchanged except adding `export`**, with the type import:

```ts
import type { DashboardPR } from "./types";

export function getPRDotClass(p: DashboardPR): string {
  // ... move the EXACT existing body from SessionCard.tsx (do not rewrite logic) ...
}

export function getPRChipColorClass(p: DashboardPR): string {
  // ... move the EXACT existing body ...
}

export function getPRStatusLabel(p: DashboardPR): string {
  // ... move the EXACT existing body ...
}
```

(The bodies reference `p.enriched`, `p.state`, `p.ciStatus`, `p.reviewDecision`, `p.isDraft` and CSS-var bg classes — keep them byte-for-byte.)

- [ ] **Step 2: Update `SessionCard.tsx` to import them**

Remove the three now-moved local function definitions from `SessionCard.tsx` and add an import near the top:

```ts
import { getPRDotClass, getPRChipColorClass, getPRStatusLabel } from "@/lib/pr-display";
```

- [ ] **Step 3: Write the test**

Create `packages/web/src/lib/__tests__/pr-display.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { DashboardPR } from "../types";
import { getPRDotClass, getPRStatusLabel } from "../pr-display";

const pr = (over: Partial<DashboardPR>): DashboardPR =>
  ({
    number: 1, url: "", title: "", owner: "o", repo: "r", branch: "b", baseBranch: "main",
    isDraft: false, state: "open", additions: 0, deletions: 0, ciStatus: "pending",
    ciChecks: [], reviewDecision: "none",
    mergeability: { mergeable: false } as DashboardPR["mergeability"],
    unresolvedThreads: 0, unresolvedComments: [], enriched: true,
    ...over,
  }) as unknown as DashboardPR;

describe("pr-display helpers", () => {
  it("labels a merged PR", () => {
    expect(getPRStatusLabel(pr({ state: "merged" }))).toBe("merged");
  });
  it("labels a CI-failing PR and colors the dot red", () => {
    const p = pr({ ciStatus: "failing" });
    expect(getPRStatusLabel(p)).toBe("CI failing");
    expect(getPRDotClass(p)).toContain("--color-status-error");
  });
  it("returns empty label / faint dot for an unenriched PR", () => {
    const p = pr({ enriched: false });
    expect(getPRStatusLabel(p)).toBe("");
    expect(getPRDotClass(p)).toContain("opacity");
  });
});
```

- [ ] **Step 4: Run tests + verify SessionCard still passes**

Run: `pnpm --filter @aoagents/ao-web test -- pr-display SessionCard`
Expected: PASS (new pr-display tests pass; existing SessionCard tests unaffected).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: no errors (confirms SessionCard's remaining references resolve to the import).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/pr-display.ts packages/web/src/lib/__tests__/pr-display.test.ts packages/web/src/components/SessionCard.tsx
git commit -m "refactor(web): extract shared PR-display helpers to lib/pr-display"
```

---

### Task 3: Enrich worker rows + expose a `useFeatureWorkers` hook

Rework `OrchestratorWorkersCard.tsx`: the presentational `OrchestratorWorkersList` gets richer rows; the polling container is converted to an exported `useFeatureWorkers(session)` hook (the rail in Task 4 owns the shell and needs the worker count). The now-dead SummaryView mount is removed.

**Files:**
- Modify (rewrite): `packages/web/src/components/OrchestratorWorkersCard.tsx`
- Modify: `packages/web/src/components/SessionInspector.tsx` (remove the dead `<Section title="Workers">` mount + its now-unused imports)
- Test: `packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx`

**Interfaces:**
- Consumes: `WorkerHealth` (with `lastActivityAt`) from Task 1; `getPRChipColorClass`, `getPRStatusLabel` from Task 2 (`@/lib/pr-display`); `formatRelativeTime` from `@/lib/format`.
- Produces: `useFeatureWorkers(session: DashboardSession): WorkerHealth[]` and `OrchestratorWorkersList({ workers, onOpen })` — both exported. The old `OrchestratorWorkersCard` container export is removed.

- [ ] **Step 1: Update the test to the enriched contract**

Replace `packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx` with:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrchestratorWorkersList, useFeatureWorkers } from "../OrchestratorWorkersCard";
import type { WorkerHealth } from "../../lib/feature-sessions";
import type { DashboardSession } from "../../lib/types";

const NOW = Date.now();
const w = (over: Partial<WorkerHealth>): WorkerHealth => ({
  id: "web-1", projectId: "web", task: "web-form", branch: "feature/login/web-form",
  activity: "idle", ageMs: 47 * 60_000, stale: true, pr: null,
  lastActivityAt: new Date(NOW - 47 * 60_000).toISOString(), ...over,
});

describe("OrchestratorWorkersList", () => {
  it("empty state", () => {
    render(<OrchestratorWorkersList workers={[]} onOpen={() => {}} />);
    expect(screen.getByText(/no workers/i)).toBeInTheDocument();
  });

  it("shows status label, full branch, relative time, PR chip, and stalled marker", () => {
    render(
      <OrchestratorWorkersList
        workers={[w({ pr: { number: 123, state: "open", ciStatus: "passing", enriched: true } as WorkerHealth["pr"] })]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText("web-form")).toBeInTheDocument();
    expect(screen.getByText("feature/login/web-form")).toBeInTheDocument(); // full branch
    expect(screen.getByText(/ago/i)).toBeInTheDocument();                    // relative time
    expect(screen.getByText("#123")).toBeInTheDocument();
    expect(screen.getByText(/stalled/i)).toBeInTheDocument();
  });

  it("shows an active worker without a stalled marker", () => {
    render(<OrchestratorWorkersList workers={[w({ activity: "active", stale: false, ageMs: 5000 })]} onOpen={() => {}} />);
    expect(screen.getByText("active")).toBeInTheDocument();
    expect(screen.queryByText(/stalled/i)).not.toBeInTheDocument();
  });

  it("calls onOpen with projectId and id on row click", () => {
    const onOpen = vi.fn();
    render(<OrchestratorWorkersList workers={[w({})]} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledWith("web", "web-1");
  });
});

describe("useFeatureWorkers", () => {
  afterEach(() => vi.unstubAllGlobals());
  function Probe({ session }: { session: DashboardSession }) {
    const workers = useFeatureWorkers(session);
    return <div>{workers.map((x) => <span key={x.id}>{x.task}</span>)}</div>;
  }
  it("fetches /api/sessions and returns workers for the feature slug", async () => {
    const worker = { id: "web-1", projectId: "web", status: "working", activity: "idle",
      branch: "feature/login/web-form", displayName: null, displayNameUserSet: false,
      lastActivityAt: new Date().toISOString(), pr: null, prs: [], metadata: {} } as unknown as DashboardSession;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [worker] }) }));
    const session = { id: "hub-1", metadata: { feature: "login" } } as unknown as DashboardSession;
    render(<Probe session={session} />);
    await waitFor(() => expect(screen.getByText("web-form")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorWorkersCard`
Expected: FAIL — `useFeatureWorkers` not exported; full-branch / relative-time text not rendered.

- [ ] **Step 3: Rewrite `OrchestratorWorkersCard.tsx`**

Replace the file contents with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";
import type { DashboardSession } from "../lib/types";
import { getPRChipColorClass, getPRStatusLabel } from "@/lib/pr-display";
import { formatRelativeTime } from "@/lib/format";
import { workerHealthList, type WorkerHealth } from "../lib/feature-sessions";

const POLL_MS = 5000;

/** activity → { colored dot class, human label }. Stale is an ADDITIVE marker
    (amber border + "stalled" pill), so status stays visible even when stale. */
function statusDisplay(activity: WorkerHealth["activity"]): { dot: string; label: string } {
  switch (activity) {
    case "active": return { dot: "bg-[var(--color-status-working)]", label: "active" };
    case "ready": return { dot: "bg-[var(--color-status-ready)]", label: "ready" };
    case "waiting_input": return { dot: "bg-[var(--color-status-respond)]", label: "waiting input" };
    case "blocked": return { dot: "bg-[var(--color-status-error)]", label: "blocked" };
    case "idle": return { dot: "bg-[var(--color-status-idle)]", label: "idle" };
    case "exited": return { dot: "bg-[var(--color-text-muted)]", label: "exited" };
    default: return { dot: "bg-[var(--color-text-tertiary)] opacity-40", label: "unknown" };
  }
}

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
    <ul className="flex flex-col gap-[8px]">
      {workers.map((w) => {
        const s = statusDisplay(w.activity);
        const lastMs = new Date(w.lastActivityAt).getTime();
        const exact = Number.isNaN(lastMs) ? "" : new Date(lastMs).toLocaleString();
        return (
          <li key={w.id}>
            <button
              type="button"
              onClick={() => onOpen(w.projectId, w.id)}
              className={cn(
                "flex w-full flex-col gap-1 rounded-md border px-2.5 py-2 text-left",
                w.stale
                  ? "border-[var(--color-accent-amber)]"
                  : "border-[var(--color-border-default)]",
              )}
            >
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 shrink-0 rounded-full", s.dot)} />
                <span className="truncate text-sm font-medium">{w.task}</span>
                {w.pr ? (
                  <span
                    className={cn(
                      "ml-auto shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold leading-none",
                      getPRChipColorClass(w.pr),
                    )}
                  >
                    #{w.pr.number}
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
                <span>{s.label}</span>
                {w.stale ? (
                  <span className="text-[var(--color-status-attention)]">stalled</span>
                ) : null}
                {Number.isNaN(lastMs) ? null : (
                  <span className="ml-auto" title={exact}>
                    {formatRelativeTime(lastMs)}
                  </span>
                )}
              </div>
              {w.branch ? (
                <span className="truncate font-[var(--font-mono)] text-[10px] text-[var(--color-text-muted)]">
                  {w.branch}
                </span>
              ) : null}
              {w.pr && getPRStatusLabel(w.pr) ? (
                <span className="text-[10px] text-[var(--color-text-muted)]">
                  PR {getPRStatusLabel(w.pr)}
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Cross-project worker feed for a feature orchestrator. Workers live in the
 * LINKED projects, so poll the unscoped `/api/sessions` endpoint directly
 * (not the SSR-seeded useSessionEvents hook).
 */
export function useFeatureWorkers(session: DashboardSession): WorkerHealth[] {
  const slug = session.metadata["feature"] ?? "";
  const [sessions, setSessions] = useState<DashboardSession[]>([]);
  useEffect(() => {
    let cancelled = false;
    let inflight: AbortController | null = null;
    const load = async () => {
      inflight?.abort();
      const controller = new AbortController();
      inflight = controller;
      try {
        const res = await fetch("/api/sessions?fresh=true", { signal: controller.signal });
        if (!res.ok) return;
        const body = (await res.json()) as { sessions?: DashboardSession[] };
        if (!cancelled) setSessions(body.sessions ?? []);
      } catch {
        /* transient fetch/abort — keep last good data */
      }
    };
    void load();
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      cancelled = true;
      inflight?.abort();
      clearInterval(timer);
    };
  }, []);
  return workerHealthList(sessions, slug, Date.now());
}
```

- [ ] **Step 4: Remove the dead SummaryView mount in `SessionInspector.tsx`**

The old container `OrchestratorWorkersCard` was mounted in `SummaryView` gated on `isFeatureCoordinator(session)`, but `SummaryView` only renders for workers (never feature coordinators), so it was dead. Remove the `<Section title="Workers">…</Section>` block that references `OrchestratorWorkersCard`, and remove the now-unused imports (`OrchestratorWorkersCard`, and `isFeatureCoordinator` **only if** it's no longer referenced elsewhere in the file — check first; leave it if still used).

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorWorkersCard` then `pnpm --filter @aoagents/ao-web typecheck`
Expected: PASS; typecheck clean (confirms no dangling `OrchestratorWorkersCard` references).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/components/OrchestratorWorkersCard.tsx \
        packages/web/src/components/SessionInspector.tsx \
        packages/web/src/components/__tests__/OrchestratorWorkersCard.test.tsx
git commit -m "feat(web): richer worker rows + useFeatureWorkers hook; drop dead inspector mount"
```

---

### Task 4: `OrchestratorInspector` right rail

**Files:**
- Create: `packages/web/src/components/OrchestratorInspector.tsx`
- Test: `packages/web/src/components/__tests__/OrchestratorInspector.test.tsx`

**Interfaces:**
- Consumes: `useFeatureWorkers`, `OrchestratorWorkersList` from `./OrchestratorWorkersCard` (Task 3); `projectSessionPath` from `@/lib/routes`; `useResizable` from `@/hooks/useResizable`; `useRouter` from `next/navigation`.
- Produces: `OrchestratorInspector({ session, onCollapse }: { session: DashboardSession; onCollapse: () => void })`.

- [ ] **Step 1: Write the test**

Create `packages/web/src/components/__tests__/OrchestratorInspector.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { OrchestratorInspector } from "../OrchestratorInspector";
import type { DashboardSession } from "../../lib/types";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const session = { id: "hub-1", projectId: "hub", metadata: { feature: "login" } } as unknown as DashboardSession;

describe("OrchestratorInspector", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("renders the Workers header with a live count and lists workers", async () => {
    const worker = { id: "web-1", projectId: "web", status: "working", activity: "idle",
      branch: "feature/login/web-form", displayName: null, displayNameUserSet: false,
      lastActivityAt: new Date().toISOString(), pr: null, prs: [], metadata: {} } as unknown as DashboardSession;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [worker] }) }));
    render(<OrchestratorInspector session={session} onCollapse={() => {}} />);
    await waitFor(() => expect(screen.getByText("web-form")).toBeInTheDocument());
    expect(screen.getByText(/workers \(1\)/i)).toBeInTheDocument();
  });

  it("fires onCollapse when the collapse button is clicked", () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) }));
    const onCollapse = vi.fn();
    render(<OrchestratorInspector session={session} onCollapse={onCollapse} />);
    fireEvent.click(screen.getByRole("button", { name: /collapse workers/i }));
    expect(onCollapse).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorInspector`
Expected: FAIL — component file does not exist.

- [ ] **Step 3: Implement**

Create `packages/web/src/components/OrchestratorInspector.tsx`:

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useResizable } from "@/hooks/useResizable";
import { projectSessionPath } from "@/lib/routes";
import type { DashboardSession } from "../lib/types";
import { OrchestratorWorkersList, useFeatureWorkers } from "./OrchestratorWorkersCard";

export function OrchestratorInspector({
  session,
  onCollapse,
}: {
  session: DashboardSession;
  onCollapse: () => void;
}) {
  const router = useRouter();
  const workers = useFeatureWorkers(session);
  const { onPointerDown, onDoubleClick } = useResizable({
    cssVar: "--ao-inspector-w",
    storageKey: "ao-inspector-w",
    defaultWidth: 344,
    min: 280,
    max: 560,
    edge: "left",
  });

  return (
    <aside className="session-inspector" aria-label="Workers inspector">
      <div
        className="resize-handle resize-handle--left"
        onPointerDown={onPointerDown}
        onDoubleClick={onDoubleClick}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
      />
      <div className="inspector-section__head">
        <span>Workers ({workers.length})</span>
        <button
          type="button"
          className="inspector-section__link"
          onClick={onCollapse}
          aria-label="Collapse workers panel"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 6l6 6-6 6" />
          </svg>
        </button>
      </div>
      <div className="session-inspector__body">
        <OrchestratorWorkersList
          workers={workers}
          onOpen={(projectId, id) => router.push(projectSessionPath(projectId, id))}
        />
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- OrchestratorInspector`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/components/OrchestratorInspector.tsx \
        packages/web/src/components/__tests__/OrchestratorInspector.test.tsx
git commit -m "feat(web): OrchestratorInspector right rail with collapse"
```

---

### Task 5: Wire the rail into the detail view + header toggle

Render the rail for feature coordinators (via a testable gate helper), own the persisted collapse state in `SessionDetail`, and add a "Workers" toggle button to the header.

**Files:**
- Modify: `packages/web/src/lib/feature-sessions.ts` (`railKind` gate helper)
- Modify: `packages/web/src/components/SessionDetail.tsx` (collapse state + rail gate)
- Modify: `packages/web/src/components/SessionDetailHeader.tsx` (Workers toggle button + props)
- Test: `packages/web/src/lib/__tests__/feature-sessions.test.ts`, `packages/web/src/components/__tests__/SessionDetailHeader.test.tsx` (create or extend)

**Interfaces:**
- Consumes: `OrchestratorInspector` (Task 4); `isFeatureCoordinator` (already in feature-sessions).
- Produces: `railKind(session, opts): "orchestrator" | "inspector" | "none"` where `opts: { isMobile: boolean; terminalEnded: boolean; isOrchestrator: boolean; workersCollapsed: boolean }`. Header gains props `workersCollapsed?: boolean` and `onToggleWorkers?: () => void`.

- [ ] **Step 1: Write the gate-helper test**

Add to `packages/web/src/lib/__tests__/feature-sessions.test.ts`:

```ts
import { railKind } from "../feature-sessions";

describe("railKind", () => {
  const coord = { metadata: { feature: "login" } } as unknown as DashboardSession;
  const worker = { metadata: {} } as unknown as DashboardSession;
  const base = { isMobile: false, terminalEnded: false, isOrchestrator: true, workersCollapsed: false };

  it("orchestrator rail for a feature coordinator when open", () => {
    expect(railKind(coord, base)).toBe("orchestrator");
  });
  it("none for a feature coordinator when collapsed", () => {
    expect(railKind(coord, { ...base, workersCollapsed: true })).toBe("none");
  });
  it("worker inspector for a non-orchestrator worker", () => {
    expect(railKind(worker, { ...base, isOrchestrator: false })).toBe("inspector");
  });
  it("none for a plain (non-feature) orchestrator", () => {
    expect(railKind(worker, base)).toBe("none");
  });
  it("none on mobile or when terminal ended", () => {
    expect(railKind(coord, { ...base, isMobile: true })).toBe("none");
    expect(railKind(coord, { ...base, terminalEnded: true })).toBe("none");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: FAIL — `railKind` not exported.

- [ ] **Step 3: Implement `railKind`**

Append to `packages/web/src/lib/feature-sessions.ts`:

```ts
/** Which right rail (if any) a session detail view should show. */
export function railKind(
  session: { metadata?: Record<string, string> | null },
  opts: { isMobile: boolean; terminalEnded: boolean; isOrchestrator: boolean; workersCollapsed: boolean },
): "orchestrator" | "inspector" | "none" {
  if (opts.isMobile || opts.terminalEnded) return "none";
  if (isFeatureCoordinator(session)) return opts.workersCollapsed ? "none" : "orchestrator";
  if (!opts.isOrchestrator) return "inspector";
  return "none";
}
```

- [ ] **Step 4: Run helper test**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: PASS.

- [ ] **Step 5: Wire collapse state + rail into `SessionDetail.tsx`**

Add imports near the top:

```ts
import { isFeatureCoordinator, railKind } from "@/lib/feature-sessions";
import { OrchestratorInspector } from "./OrchestratorInspector";
```

(`isFeatureCoordinator` is already imported — merge, don't duplicate.)

Add persisted collapse state alongside the existing `dockOverride`/transcript state (mirror that pattern, ~`SessionDetail.tsx:58-85`):

```tsx
  const [workersCollapsed, setWorkersCollapsed] = useState<boolean>(false);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem("ao-workers-rail-collapsed");
      if (stored === "1") setWorkersCollapsed(true);
    } catch {
      /* localStorage unavailable */
    }
  }, []);
  const setWorkersCollapsedPersisted = useCallback((next: boolean) => {
    setWorkersCollapsed(next);
    try {
      window.localStorage.setItem("ao-workers-rail-collapsed", next ? "1" : "0");
    } catch {
      /* localStorage unavailable */
    }
  }, []);
```

Replace the right-rail gate (`SessionDetail.tsx:214-220`) with:

```tsx
        {(() => {
          const kind = railKind(session, { isMobile, terminalEnded, isOrchestrator, workersCollapsed });
          if (kind === "orchestrator")
            return <OrchestratorInspector session={session} onCollapse={() => setWorkersCollapsedPersisted(true)} />;
          if (kind === "inspector") return <SessionInspector session={session} />;
          return null;
        })()}
```

Pass the toggle props to the header (add to the existing `<SessionDetailHeader .../>` props at `SessionDetail.tsx:161-181`):

```tsx
        workersCollapsed={workersCollapsed}
        onToggleWorkers={() => setWorkersCollapsedPersisted(!workersCollapsed)}
```

- [ ] **Step 6: Add the Workers toggle button to `SessionDetailHeader.tsx`**

Add the two props to `SessionDetailHeaderProps`:

```ts
  workersCollapsed?: boolean;
  onToggleWorkers?: () => void;
```

Destructure them in the component signature, and render a button inside the actions container (`<div className="dashboard-app-header__actions">`, near the PR button at `SessionDetailHeader.tsx:224-226`), gated on feature orchestrators:

```tsx
        {isFeatureOrchestrator && onToggleWorkers ? (
          <button
            type="button"
            className={cn("dashboard-app-btn", !workersCollapsed && "topbar-pr-btn--open")}
            onClick={onToggleWorkers}
            aria-pressed={!workersCollapsed}
            aria-label="Toggle workers panel"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            </svg>
            <span className="topbar-btn-label">Workers</span>
          </button>
        ) : null}
```

(`cn` is already imported in this file.)

- [ ] **Step 7: Write the header button test**

Create or extend `packages/web/src/components/__tests__/SessionDetailHeader.test.tsx`. If creating, use the minimal required props (read `SessionDetailHeaderProps` for the required fields and pass simple values; `session` a minimal `DashboardSession`, numeric/string/no-op fns for the rest):

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SessionDetailHeader } from "../SessionDetailHeader";
import type { DashboardSession } from "../../lib/types";

const baseSession = { id: "hub-1", projectId: "hub", status: "working", activity: "idle",
  branch: null, displayName: null, displayNameUserSet: false, lastActivityAt: new Date().toISOString(),
  pr: null, prs: [], metadata: { feature: "login" } } as unknown as DashboardSession;

const baseProps = {
  session: baseSession, isOrchestrator: true, isFeatureOrchestrator: true, isMobile: false,
  terminalEnded: false, isRestorable: false, headline: "Login", projects: [],
  orchestratorHref: null, selectedPRIndex: 0, onSelectPR: () => {}, onToggleSidebar: () => {},
  onRestore: () => {}, onKill: () => {},
};

describe("SessionDetailHeader — Workers toggle", () => {
  it("renders the Workers button for a feature orchestrator and toggles", () => {
    const onToggleWorkers = vi.fn();
    render(<SessionDetailHeader {...baseProps} workersCollapsed={false} onToggleWorkers={onToggleWorkers} />);
    const btn = screen.getByRole("button", { name: /toggle workers panel/i });
    fireEvent.click(btn);
    expect(onToggleWorkers).toHaveBeenCalledTimes(1);
  });

  it("does not render the Workers button when not a feature orchestrator", () => {
    render(<SessionDetailHeader {...baseProps} isFeatureOrchestrator={false} onToggleWorkers={() => {}} />);
    expect(screen.queryByRole("button", { name: /toggle workers panel/i })).not.toBeInTheDocument();
  });
});
```

If `SessionDetailHeader` pulls extra required context/providers that make it hard to render in isolation, report BLOCKED with specifics rather than adding heavy scaffolding.

- [ ] **Step 8: Run tests + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions SessionDetailHeader` then `pnpm --filter @aoagents/ao-web typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 9: Commit**

```bash
git add packages/web/src/lib/feature-sessions.ts \
        packages/web/src/components/SessionDetail.tsx \
        packages/web/src/components/SessionDetailHeader.tsx \
        packages/web/src/lib/__tests__/feature-sessions.test.ts \
        packages/web/src/components/__tests__/SessionDetailHeader.test.tsx
git commit -m "feat(web): show collapsible workers rail for feature orchestrators"
```

---

## Final verification

- [ ] `pnpm --filter @aoagents/ao-web test`
- [ ] `pnpm --filter @aoagents/ao-web typecheck`
- [ ] `pnpm lint` (repo root)
- [ ] **User runs** `pnpm --filter @aoagents/ao-web build` (prebuild guard refuses while the live dashboard runs on :3000 — needs `ao stop` first).
- [ ] Confirm no core edits: `git diff --name-only main | grep -E '^packages/core/' && echo "CORE TOUCHED — STOP" || echo "clean"`
- [ ] Manual smoke (user): open a feature-orchestrator session → right rail lists workers with status dot / last-active / PR+CI / branch; collapse button hides it (terminal full width); header "Workers" button re-opens it; reload preserves collapsed state.
