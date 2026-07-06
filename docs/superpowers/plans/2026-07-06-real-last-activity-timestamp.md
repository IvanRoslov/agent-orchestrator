# Real Last-Activity Timestamp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make "last activity time" reflect the agent's real last message (not the poll-bumped file mtime), fixing the panel's "just now" and reviving the worker heartbeat's stall detection.

**Architecture:** Fix the timestamp at the agent-agnostic seam — the Claude plugin's `getActivityState().timestamp` returns the embedded `timestamp` of the last non-noise JSONL entry instead of the file mtime (state classification unchanged → zero blast radius). Two consumers read this accurate timestamp through the plugin interface: the CLI heartbeat (staleness) and the web sessions serializer (a new `realLastActivityAt` field the panel prefers).

**Tech Stack:** TypeScript (ES2022, Node16), Vitest, Next.js 15 / React 19.

## Global Constraints

- Fork mergeability: **NO edits** to `packages/core/src/types.ts`, `lifecycle-manager.ts`, `session-manager.ts`, `prompt-builder`. (Editing `packages/core/src/utils.ts` — a non-forbidden core file — is allowed and additive.)
- **Zero behavior change to existing paths**: activity *state* classification, `Session.lastActivityAt`, sorting, and lifecycle stay exactly as today. Only the returned `timestamp` becomes accurate, and only two new consumers read it.
- Agent-agnostic: consumers resolve the agent via `registry.get<Agent>("agent", session.metadata["agent"])` and read `getActivityState().timestamp`; no consumer hardcodes Claude. Missing plugin/timestamp → fall back to `lastActivityAt`.
- "Last activity" = embedded `timestamp` of the last JSONL entry whose `type` is NOT in `NOISE_JSONL_TYPES`.
- TS strict, no `any`, `import type` for types. No inline `style=` (web). C-12 tests. C-14 SSE 5s unchanged.
- Conventional commits. gitleaks pre-commit hook runs.

---

### Task 1: `readLastLines` tail reader in core utils

**Files:**
- Modify: `packages/core/src/utils.ts` (add exported `readLastLines`, next to the private `readLastLine` at line 94-136)
- Test: `packages/core/src/__tests__/utils.test.ts` (create or extend — place beside existing core utils tests)

**Interfaces:**
- Produces: `readLastLines(filePath: string, maxLines: number): Promise<string[]>` — up to `maxLines` trailing non-empty lines, in file order.

- [ ] **Step 1: Write the failing test**

Add to `packages/core/src/__tests__/utils.test.ts` (adjust the import path if the file lives elsewhere; use the same tmp-file pattern existing utils tests use, or `os.tmpdir()`):

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLastLines } from "../utils.js";

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "ao-utils-"));
  const p = join(dir, "f.jsonl");
  writeFileSync(p, content, "utf-8");
  return p;
}

describe("readLastLines", () => {
  it("returns the last N non-empty lines in order", async () => {
    const p = tmpFile("a\nb\nc\nd\ne\n");
    expect(await readLastLines(p, 2)).toEqual(["d", "e"]);
    expect(await readLastLines(p, 10)).toEqual(["a", "b", "c", "d", "e"]);
  });
  it("ignores trailing/blank lines and handles no final newline", async () => {
    const p = tmpFile("x\n\ny\nz");
    expect(await readLastLines(p, 2)).toEqual(["y", "z"]);
  });
  it("returns [] for empty file or maxLines<=0", async () => {
    expect(await readLastLines(tmpFile(""), 5)).toEqual([]);
    expect(await readLastLines(tmpFile("a\nb\n"), 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-core test -- utils`
Expected: FAIL — `readLastLines` not exported.

- [ ] **Step 3: Implement `readLastLines`**

Add to `packages/core/src/utils.ts` immediately after `readLastLine` (mirrors its backward-chunk approach; `open` is already imported there):

```ts
/**
 * Read up to `maxLines` trailing non-empty lines from a file, in file order.
 * Backward chunked read — pure Node.js, safe for large files.
 */
export async function readLastLines(filePath: string, maxLines: number): Promise<string[]> {
  if (maxLines <= 0) return [];
  const CHUNK = 4096;
  const fh = await open(filePath, "r");
  try {
    const { size } = await fh.stat();
    if (size === 0) return [];

    const chunks: Buffer[] = [];
    let totalBytes = 0;
    let pos = size;

    while (pos > 0) {
      const readSize = Math.min(CHUNK, pos);
      pos -= readSize;
      const chunk = Buffer.alloc(readSize);
      await fh.read(chunk, 0, readSize, pos);
      chunks.unshift(chunk);
      totalBytes += readSize;

      const tail = Buffer.concat(chunks, totalBytes).toString("utf-8");
      const lines = tail.split("\n");
      // When pos > 0 the first element may be a truncated line — drop it until
      // we've read to the start of the file.
      const complete = pos === 0 ? lines : lines.slice(1);
      const nonEmpty = complete.map((l) => l.trim()).filter((l) => l.length > 0);
      if (nonEmpty.length >= maxLines || pos === 0) {
        return nonEmpty.slice(-maxLines);
      }
    }
    return [];
  } finally {
    await fh.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-core test -- utils`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/utils.ts packages/core/src/__tests__/utils.test.ts
git commit -m "feat(core): add readLastLines tail reader"
```

---

### Task 2: Claude plugin returns the real last-activity timestamp

**Files:**
- Modify: `packages/plugins/agent-claude-code/src/activity-detection.ts`
- Test: `packages/plugins/agent-claude-code/src/__tests__/activity-detection.test.ts` (create or extend)

**Interfaces:**
- Consumes: `readLastLines` from `@aoagents/ao-core` (Task 1); the module-private `NOISE_JSONL_TYPES`.
- Produces: `readLastRealActivityTimestamp(sessionFile: string): Promise<Date | null>` (exported for testing); `getClaudeActivityState` now returns the real timestamp in its `ready`/`idle`/`active`/`blocked` return paths.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/plugins/agent-claude-code/src/__tests__/activity-detection.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { readLastRealActivityTimestamp } from "../activity-detection.js";

function jsonl(...entries: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "ao-claude-"));
  const p = join(dir, "s.jsonl");
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n", "utf-8");
  return p;
}

describe("readLastRealActivityTimestamp", () => {
  it("returns the embedded timestamp of the last NON-noise entry", async () => {
    const real = "2026-07-05T22:43:59.696Z";
    const p = jsonl(
      { type: "assistant", timestamp: real },
      { type: "pr-link", timestamp: "2026-07-06T06:57:00.000Z" },      // noise, newer
      { type: "permission-mode" },                                      // noise, no ts
    );
    expect((await readLastRealActivityTimestamp(p))?.toISOString()).toBe(real);
  });
  it("returns null when only noise / no parseable timestamp exists", async () => {
    const p = jsonl({ type: "pr-link" }, { type: "permission-mode" });
    expect(await readLastRealActivityTimestamp(p)).toBeNull();
  });
  it("returns null for a missing file", async () => {
    expect(await readLastRealActivityTimestamp("/no/such/file.jsonl")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-plugin-agent-claude-code test -- activity-detection`
Expected: FAIL — `readLastRealActivityTimestamp` not exported.

- [ ] **Step 3: Implement the reader and wire it into `getClaudeActivityState`**

In `packages/plugins/agent-claude-code/src/activity-detection.ts`:

Add `readLastLines` to the existing `@aoagents/ao-core` import block, and add this helper (near `NOISE_JSONL_TYPES`):

```ts
/** How many trailing JSONL lines to scan for the last real (non-noise) entry. */
const REAL_ACTIVITY_SCAN_LINES = 200;

/**
 * The embedded `timestamp` of the last non-noise JSONL entry — the agent's real
 * last activity, as opposed to the file mtime (which housekeeping writes bump).
 * Returns null if no non-noise entry with a valid timestamp is in the scan window.
 */
export async function readLastRealActivityTimestamp(sessionFile: string): Promise<Date | null> {
  let lines: string[];
  try {
    lines = await readLastLines(sessionFile, REAL_ACTIVITY_SCAN_LINES);
  } catch {
    return null;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    let obj: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(lines[i]);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) continue;
      obj = parsed as Record<string, unknown>;
    } catch {
      continue;
    }
    const type = typeof obj.type === "string" ? obj.type : null;
    if (type && NOISE_JSONL_TYPES.has(type)) continue;
    if (typeof obj.timestamp === "string") {
      const d = new Date(obj.timestamp);
      if (!Number.isNaN(d.getTime())) return d;
    }
  }
  return null;
}
```

Then, inside `getClaudeActivityState`, in the `else` block that today does `const timestamp = entry.modifiedAt;` (activity-detection.ts:403), replace that single line with:

```ts
        const ageMs = Date.now() - entry.modifiedAt.getTime();
        const timestamp = (await readLastRealActivityTimestamp(sessionFile)) ?? entry.modifiedAt;
```

Leave `ageMs` computed from `entry.modifiedAt` (state classification unchanged). The `staleNativeState` / `createdAt` fallback paths (lines 393-400) are unchanged.

**Perf note:** `getClaudeActivityState` is also called by core's per-poll enrichment. This adds one bounded backward tail read (≤200 lines) of the same session file it already reads, on the non-fallback path only — marginal next to the `readdir` + process-probe that call already does, and only for sessions core enriches. Results are unchanged (behavior stays identical; only the returned `timestamp` becomes accurate).

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-plugin-agent-claude-code test -- activity-detection`
Expected: PASS (new reader tests pass; any existing `getClaudeActivityState` state tests still pass — the fix does not touch `state`).

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @aoagents/ao-plugin-agent-claude-code typecheck`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add packages/plugins/agent-claude-code/src/activity-detection.ts \
        packages/plugins/agent-claude-code/src/__tests__/activity-detection.test.ts
git commit -m "fix(agent-claude-code): report real last-activity timestamp, not file mtime"
```

---

### Task 3: Heartbeat uses the real timestamp for staleness

**Files:**
- Modify: `packages/cli/src/lib/feature-heartbeat.ts`
- Modify: `packages/cli/src/commands/start.ts` (wire the `activityTimestamp` resolver)
- Test: `packages/cli/__tests__/lib/feature-heartbeat.test.ts`

**Interfaces:**
- Consumes: `getActivityState().timestamp` (now accurate, Task 2) via a resolved `Agent` plugin.
- Produces: `isStale(session, now, staleMs?, realTs?)`, `evaluateOrchestrator(..., tsMap?)`, `HeartbeatDeps.activityTimestamp?: (session: Session) => Promise<Date | null>`.

- [ ] **Step 1: Write the failing test**

Add to `packages/cli/__tests__/lib/feature-heartbeat.test.ts` (reuse the existing `session`/`orch`/`worker` factories in that file; `NOW`, `STALE_MS` are already imported there):

```ts
describe("real-timestamp staleness", () => {
  it("isStale uses the injected real timestamp over a fresh lastActivityAt", () => {
    const w = worker({ activity: "idle", lastActivityAt: new Date(NOW - 1000) }); // fresh
    const oldReal = new Date(NOW - STALE_MS - 60_000);                            // 16m ago
    expect(isStale(w, NOW, STALE_MS)).toBe(false);            // by lastActivityAt → fresh
    expect(isStale(w, NOW, STALE_MS, oldReal)).toBe(true);    // by real ts → stale
  });
  it("evaluateOrchestrator nudges when the tsMap makes a worker stale despite fresh lastActivityAt", () => {
    const w = worker({ id: "web-1", branch: "feature/login/web", activity: "idle", lastActivityAt: new Date(NOW - 1000) });
    const tsMap = new Map([["web-1", new Date(NOW - STALE_MS - 1)]]);
    expect(evaluateOrchestrator(orch(), [orch(), w], NOW, undefined)).toBeNull();            // no map → fresh
    expect(evaluateOrchestrator(orch(), [orch(), w], NOW, undefined, STALE_MS, RENUDGE_MS, tsMap)).not.toBeNull();
  });
});
```

(Ensure `RENUDGE_MS` is imported in that test file; add it to the existing import from `../feature-heartbeat.js` if missing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-cli test -- feature-heartbeat`
Expected: FAIL — `isStale`/`evaluateOrchestrator` don't accept the extra args.

- [ ] **Step 3: Thread the real timestamp through the pure logic**

In `packages/cli/src/lib/feature-heartbeat.ts`:

Replace `ageMs` and `isStale` with realTs-aware versions:

```ts
function ageMs(session: Session, now: number, realTs?: Date | null): number {
  return now - (realTs ?? session.lastActivityAt).getTime();
}

/** No movement past the threshold. Null activity = no data → never stale.
 *  `realTs` (the agent's real last-activity time) wins over `lastActivityAt`. */
export function isStale(
  session: Session,
  now: number,
  staleMs: number = STALE_MS,
  realTs?: Date | null,
): boolean {
  return session.activity !== null && ageMs(session, now, realTs) > staleMs;
}
```

Update `buildSummary` to take and use the map:

```ts
export function buildSummary(
  orchestrator: Session,
  workers: Session[],
  now: number,
  staleMs: number = STALE_MS,
  tsMap?: Map<string, Date>,
): string {
  const slug = orchestrator.metadata["feature"] ?? "";
  const ordered = [...workers].sort(
    (a, b) =>
      Number(isStale(b, now, staleMs, tsMap?.get(b.id))) -
      Number(isStale(a, now, staleMs, tsMap?.get(a.id))),
  );
  const lines = ordered.map((w) => {
    const state = (w.activity ?? "unknown").toUpperCase();
    const age = formatAge(ageMs(w, now, tsMap?.get(w.id)));
    const pr = w.pr ? ` · PR #${w.pr.number}` : "";
    const flag = isStale(w, now, staleMs, tsMap?.get(w.id))
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
```

Update `evaluateOrchestrator` to accept and forward `tsMap`:

```ts
export function evaluateOrchestrator(
  orchestrator: Session,
  all: Session[],
  now: number,
  lastSentAt: number | undefined,
  staleMs: number = STALE_MS,
  renudgeMs: number = RENUDGE_MS,
  tsMap?: Map<string, Date>,
): { message: string } | null {
  if (!orchestrator.metadata["feature"]) return null;
  if (orchestrator.activity === "exited") return null;
  if (orchestrator.activity === "active") return null;
  const workers = workersForOrchestrator(orchestrator, all);
  if (workers.length === 0) return null;
  if (!workers.some((w) => isStale(w, now, staleMs, tsMap?.get(w.id)))) return null;
  if (lastSentAt !== undefined && now - lastSentAt < renudgeMs) return null;
  return { message: buildSummary(orchestrator, workers, now, staleMs, tsMap) };
}
```

Add the dep and compute the map in the tick. Extend `HeartbeatDeps`:

```ts
export interface HeartbeatDeps {
  list: () => Promise<Session[]>;
  send: (sessionId: SessionId, message: string) => Promise<void>;
  activityTimestamp?: (session: Session) => Promise<Date | null>;
  now?: () => number;
  intervalMs?: number;
  staleMs?: number;
  renudgeMs?: number;
  onError?: (err: unknown) => void;
}
```

In `startFeatureHeartbeat`'s `tick`, after `const sessions = await deps.list();` build the map for candidate workers (feature-branch, not exited) and pass it into `evaluateOrchestrator`:

```ts
        const sessions = await deps.list();
        const t = now();
        const tsMap = new Map<string, Date>();
        if (deps.activityTimestamp) {
          const candidates = sessions.filter(
            (s) => (s.branch?.startsWith("feature/") ?? false) && s.activity !== "exited",
          );
          await Promise.all(
            candidates.map(async (s) => {
              try {
                const ts = await deps.activityTimestamp!(s);
                if (ts) tsMap.set(s.id, ts);
              } catch {
                /* best-effort */
              }
            }),
          );
        }
        for (const orch of sessions) {
          try {
            const decision = evaluateOrchestrator(
              orch, sessions, t, lastSent.get(orch.id), staleMs, renudgeMs, tsMap,
            );
            if (!decision) continue;
            await deps.send(orch.id, decision.message);
            lastSent.set(orch.id, t);
          } catch (err) {
            deps.onError?.(err);
          }
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-cli test -- feature-heartbeat`
Expected: PASS (new tests + all existing heartbeat tests, which call the functions without the new args).

- [ ] **Step 5: Wire `activityTimestamp` in `start.ts`**

In `packages/cli/src/commands/start.ts`, add imports near the existing ones:

```ts
import { getPluginRegistry } from "../lib/create-session-manager.js";
import type { Agent } from "@aoagents/ao-core";
```

(`getSessionManager` is already imported from the same module — merge the import.)

Replace the heartbeat wiring block (start.ts:1850-1856) with:

```ts
const heartbeatSm = await getSessionManager(config);
const heartbeatRegistry = await getPluginRegistry(config);
startFeatureHeartbeat({
  list: () => heartbeatSm.list(),
  send: (id, msg) => heartbeatSm.send(id, msg),
  activityTimestamp: async (s) => {
    const agentName = s.metadata["agent"];
    if (!agentName) return null;
    const agent = heartbeatRegistry.get<Agent>("agent", agentName);
    if (!agent?.getActivityState) return null;
    try {
      const detected = await agent.getActivityState(s);
      return detected?.timestamp ?? null;
    } catch {
      return null;
    }
  },
  onError: (err) => console.warn("[feature-heartbeat] tick failed:", err),
});
```

- [ ] **Step 6: Typecheck**

Run: `pnpm --filter @aoagents/ao-cli typecheck`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/cli/src/lib/feature-heartbeat.ts \
        packages/cli/src/commands/start.ts \
        packages/cli/__tests__/lib/feature-heartbeat.test.ts
git commit -m "fix(cli): heartbeat staleness uses real agent activity timestamp"
```

---

### Task 4: Web serializer exposes `realLastActivityAt`

**Files:**
- Modify: `packages/web/src/lib/types.ts` (`DashboardSession.realLastActivityAt?`)
- Modify: `packages/web/src/lib/serialize.ts` (`sessionToDashboard` optional param)
- Modify: `packages/web/src/app/api/sessions/route.ts` (compute the real-timestamp map for non-terminal sessions)
- Test: `packages/web/src/lib/__tests__/serialize.test.ts` (create or extend)

**Interfaces:**
- Consumes: `registry.get<Agent>("agent", session.metadata["agent"]).getActivityState(session)` (Task 2 accuracy); core `isTerminalSession` (already imported in serialize/route).
- Produces: `DashboardSession.realLastActivityAt?: string`; `sessionToDashboard(session, realLastActivityAt?: string)`.

- [ ] **Step 1: Write the failing test**

Create/extend `packages/web/src/lib/__tests__/serialize.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { Session } from "@aoagents/ao-core";
import { sessionToDashboard } from "../serialize";

function coreSession(over: Partial<Session>): Session {
  return {
    id: "w", projectId: "p", status: "working", activity: "idle",
    activitySignal: "valid", lifecycle: null, branch: "feature/x/y", issueId: null,
    pr: null, prs: [], workspacePath: null, runtimeHandle: null, agentInfo: null,
    createdAt: new Date(0), lastActivityAt: new Date("2026-07-06T06:57:00Z"),
    metadata: {}, ...over,
  } as unknown as Session;
}

describe("sessionToDashboard realLastActivityAt", () => {
  it("sets realLastActivityAt from the passed value", () => {
    const d = sessionToDashboard(coreSession({}), "2026-07-05T22:43:59.696Z");
    expect(d.realLastActivityAt).toBe("2026-07-05T22:43:59.696Z");
  });
  it("leaves realLastActivityAt undefined when no value is passed", () => {
    expect(sessionToDashboard(coreSession({})).realLastActivityAt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- serialize`
Expected: FAIL — `sessionToDashboard` takes one arg / field missing.

- [ ] **Step 3: Add the field and the optional param**

In `packages/web/src/lib/types.ts`, add to `DashboardSession` next to `lastActivityAt` (line 119):

```ts
  lastActivityAt: string;
  /** Agent's real last-activity time (from native JSONL), when available.
   *  Falls back to lastActivityAt. Set only for non-terminal sessions. */
  realLastActivityAt?: string;
```

In `packages/web/src/lib/serialize.ts`, change `sessionToDashboard` (line 160) to accept the optional value and include it:

```ts
export function sessionToDashboard(
  session: Session,
  realLastActivityAt?: string,
): DashboardSession {
```

and in the returned object (next to the `lastActivityAt` mapping at line 188):

```ts
    lastActivityAt: session.lastActivityAt.toISOString(),
    realLastActivityAt,
```

- [ ] **Step 4: Compute the map in the sessions route**

In `packages/web/src/app/api/sessions/route.ts`, just before the `workerSessions.map(sessionToDashboard)` call (line 145), compute real timestamps for non-terminal sessions and pass them in. Add `import type { Agent } from "@aoagents/ao-core";` (and ensure `isTerminalSession` is imported — it already is, line 149-ish):

```ts
    const realActivity = new Map<string, string>();
    await Promise.all(
      workerSessions
        .filter((s) => !isTerminalSession(s))
        .map(async (s) => {
          try {
            const agent = registry.get<Agent>("agent", s.metadata["agent"] ?? "");
            const detected = await agent?.getActivityState(s);
            if (detected?.timestamp) realActivity.set(s.id, detected.timestamp.toISOString());
          } catch {
            /* best-effort — fall back to lastActivityAt */
          }
        }),
    );
    let dashboardSessions = workerSessions.map((s) => sessionToDashboard(s, realActivity.get(s.id)));
```

(Replace the existing `let dashboardSessions = workerSessions.map(sessionToDashboard);` line. `registry` is already in scope from `getServices()`. Leave any other `sessionToDashboard` call sites unchanged — the second param is optional.)

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm --filter @aoagents/ao-web test -- serialize` then `pnpm --filter @aoagents/ao-web typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/lib/types.ts packages/web/src/lib/serialize.ts \
        packages/web/src/app/api/sessions/route.ts \
        packages/web/src/lib/__tests__/serialize.test.ts
git commit -m "feat(web): expose realLastActivityAt for non-terminal sessions"
```

---

### Task 5: Workers panel prefers the real timestamp

**Files:**
- Modify: `packages/web/src/lib/feature-sessions.ts` (`toWorkerHealth`)
- Test: `packages/web/src/lib/__tests__/feature-sessions.test.ts`

**Interfaces:**
- Consumes: `DashboardSession.realLastActivityAt` (Task 4).
- Produces: `WorkerHealth.lastActivityAt` / `ageMs` / `stale` derived from `realLastActivityAt ?? lastActivityAt`.

- [ ] **Step 1: Write the failing test**

Add to `packages/web/src/lib/__tests__/feature-sessions.test.ts` (reuse the existing `s(...)` factory and `NOW`/`STALE`):

```ts
describe("workerHealthList prefers realLastActivityAt", () => {
  it("uses realLastActivityAt for age/stale/lastActivityAt when present", () => {
    const realOld = new Date(NOW - STALE - 60_000).toISOString();
    const all = [
      s({ id: "w", branch: "feature/login/web", activity: "idle",
          lastActivityAt: new Date(NOW - 1000).toISOString(),  // fresh (polluted)
          realLastActivityAt: realOld }),                       // real: 16m ago
    ];
    const h = workerHealthList(all, "login", NOW)[0];
    expect(h.lastActivityAt).toBe(realOld);
    expect(h.stale).toBe(true);
    expect(h.ageMs).toBeGreaterThan(STALE);
  });
  it("falls back to lastActivityAt when realLastActivityAt is absent", () => {
    const fresh = new Date(NOW - 1000).toISOString();
    const all = [s({ id: "w2", branch: "feature/login/web", activity: "idle", lastActivityAt: fresh })];
    const h = workerHealthList(all, "login", NOW)[0];
    expect(h.lastActivityAt).toBe(fresh);
    expect(h.stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: FAIL — `toWorkerHealth` uses only `lastActivityAt`, so the real-old case is not stale.

- [ ] **Step 3: Prefer the real timestamp in `toWorkerHealth`**

In `packages/web/src/lib/feature-sessions.ts`, change `toWorkerHealth` (lines 72-95) to use the real timestamp when present:

```ts
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
  const activityIso = session.realLastActivityAt ?? session.lastActivityAt;
  const ageMs = nowMs - new Date(activityIso).getTime();
  return {
    id: session.id,
    projectId: session.projectId,
    task,
    branch: session.branch,
    activity: session.activity,
    ageMs,
    stale: session.activity !== null && ageMs > staleMs,
    pr: session.pr,
    lastActivityAt: activityIso,
  };
}
```

(The panel component is unchanged — it renders `w.lastActivityAt`, which now carries the real value.)

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test -- feature-sessions`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/feature-sessions.ts packages/web/src/lib/__tests__/feature-sessions.test.ts
git commit -m "feat(web): workers panel uses real last-activity timestamp"
```

---

## Final verification

- [ ] `pnpm --filter @aoagents/ao-core test && pnpm --filter @aoagents/ao-plugin-agent-claude-code test && pnpm --filter @aoagents/ao-cli test && pnpm --filter @aoagents/ao-web test`
- [ ] `pnpm typecheck` (all packages)
- [ ] `pnpm lint` (repo root)
- [ ] Confirm no forbidden core edits: `git diff --name-only main | grep -E 'core/src/(types|lifecycle-manager|session-manager|prompt-builder)' && echo "FORBIDDEN TOUCHED — STOP" || echo "clean"`
- [ ] **User runs** `pnpm --filter @aoagents/ao-web build` (prebuild guard needs the live dashboard on :3000 stopped).
- [ ] Manual smoke (user): the workers rail shows real ages (e.g. "8h ago", not "just now"); a worker idle >15min triggers a heartbeat summary to its orchestrator.
