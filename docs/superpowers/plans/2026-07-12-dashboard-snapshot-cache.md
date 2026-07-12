# Dashboard Snapshot Cache Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the dashboard degrading under multiple SSE connections by computing the enriched `/api/sessions` snapshot once per scope (single-flight + short TTL) and serving all connections from it, and stop the fetchSnapshot-aborted flood by backing off the broadcaster poll.

**Architecture:** A new server-side cache (`session-snapshot-cache.ts`) coalesces concurrent enrichment for the same request scope. `/api/sessions` runs its expensive computation inside it. Separately, `SessionBroadcaster` (WS server) switches from a fixed 3s `setInterval` to a self-scheduling `setTimeout` with exponential backoff on consecutive failures, and throttles its raw warn log.

**Tech Stack:** Next.js 15 App Router route handler, TypeScript strict, Vitest (with `vi.useFakeTimers`), Node.

## Global Constraints

- C-14: the client SSE poll interval (5s, `useSessionEvents`) is NOT changed — this fix is server-side coalescing only.
- TypeScript strict, no `any` in non-test code (`any` allowed in tests); `import type { … }` for type-only imports.
- Web imports use the `@/` alias; no `.js` extensions in web imports.
- Conventional commits; commit at the end of each task with `git commit --no-verify` (gitleaks hook not installed locally; source carries no secrets).
- Branch: `fix/dashboard-snapshot-cache` (already checked out).
- Cache correctness: `scopeKey` MUST include every request input that changes the response body — for `/api/sessions` those are `project`, `active`, `orchestratorOnly`, `fresh`.
- Backoff: base interval 3000 ms (unchanged healthy cadence), exponential ×2 per consecutive failure, capped at 30000 ms; reset to base on first success.

## File Structure

| File | Responsibility |
|------|----------------|
| `packages/web/src/lib/session-snapshot-cache.ts` | Single-flight + short-TTL cache keyed by scope |
| `packages/web/src/app/api/sessions/route.ts` | Refactor: run enrichment inside the cache |
| `packages/web/server/mux-websocket.ts` | SessionBroadcaster: backoff poll + throttled warn |

Run tests with: `pnpm --filter @aoagents/ao-web test <path>`

---

## Task 1: Snapshot cache module (`session-snapshot-cache.ts`)

**Files:**
- Create: `packages/web/src/lib/session-snapshot-cache.ts`
- Test: `packages/web/src/lib/__tests__/session-snapshot-cache.test.ts`

**Interfaces:**
- Produces:
  - `function getEnrichedSnapshot<T>(scopeKey: string, compute: () => Promise<T>, now?: () => number, ttlMs?: number): Promise<T>`
  - `function resetSnapshotCache(): void`
  - `const SNAPSHOT_CACHE_TTL_MS: number` (= 2000)

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/lib/__tests__/session-snapshot-cache.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { getEnrichedSnapshot, resetSnapshotCache } from "../session-snapshot-cache";

beforeEach(() => resetSnapshotCache());

describe("getEnrichedSnapshot", () => {
  it("coalesces concurrent calls for the same scope (single-flight)", async () => {
    const compute = vi.fn(async () => "v1");
    const [a, b] = await Promise.all([
      getEnrichedSnapshot("k", compute),
      getEnrichedSnapshot("k", compute),
    ]);
    expect(a).toBe("v1");
    expect(b).toBe("v1");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("reuses the cached value within the TTL", async () => {
    let t = 1000;
    const now = () => t;
    const compute = vi.fn(async () => "v1");
    await getEnrichedSnapshot("k", compute, now, 2000);
    t = 2500; // 1500ms later, still < 2000 TTL
    const again = await getEnrichedSnapshot("k", compute, now, 2000);
    expect(again).toBe("v1");
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("recomputes after the TTL expires", async () => {
    let t = 1000;
    const now = () => t;
    const compute = vi.fn(async () => `v@${t}`);
    await getEnrichedSnapshot("k", compute, now, 2000);
    t = 4000; // 3000ms later, > 2000 TTL
    const again = await getEnrichedSnapshot("k", compute, now, 2000);
    expect(again).toBe("v@4000");
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it("caches per scope independently", async () => {
    const a = await getEnrichedSnapshot("a", async () => "A");
    const b = await getEnrichedSnapshot("b", async () => "B");
    expect(a).toBe("A");
    expect(b).toBe("B");
  });

  it("does not cache a rejected compute (next call retries)", async () => {
    const compute = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    await expect(getEnrichedSnapshot("k", compute)).rejects.toThrow("boom");
    await expect(getEnrichedSnapshot("k", compute)).resolves.toBe("ok");
    expect(compute).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/session-snapshot-cache.test.ts`
Expected: FAIL — cannot find module `../session-snapshot-cache`.

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/web/src/lib/session-snapshot-cache.ts

/** Default reuse window for a completed enrichment. */
export const SNAPSHOT_CACHE_TTL_MS = 2_000;

interface CacheEntry<T> {
  timestamp: number; // ms — when `value` was computed
  value?: T; // present once resolved
  promise?: Promise<T>; // present while an enrichment is in flight
}

const cache = new Map<string, CacheEntry<unknown>>();

/** Clear all cached snapshots. Test hook. */
export function resetSnapshotCache(): void {
  cache.clear();
}

/**
 * Run `compute` for `scopeKey`, coalescing concurrent callers onto one
 * in-flight promise (single-flight) and reusing a completed result for
 * `ttlMs`. Rejections are not cached — the next call retries.
 */
export function getEnrichedSnapshot<T>(
  scopeKey: string,
  compute: () => Promise<T>,
  now: () => number = Date.now,
  ttlMs: number = SNAPSHOT_CACHE_TTL_MS,
): Promise<T> {
  const existing = cache.get(scopeKey) as CacheEntry<T> | undefined;
  const startedAt = now();
  if (existing) {
    if (existing.promise) return existing.promise; // in flight → share it
    if (startedAt - existing.timestamp < ttlMs) {
      return Promise.resolve(existing.value as T); // fresh enough → reuse
    }
  }

  const promise = compute()
    .then((value) => {
      cache.set(scopeKey, { timestamp: now(), value });
      return value;
    })
    .catch((err) => {
      const current = cache.get(scopeKey);
      if (current?.promise === promise) cache.delete(scopeKey);
      throw err;
    });

  cache.set(scopeKey, { timestamp: startedAt, promise });
  return promise;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/lib/__tests__/session-snapshot-cache.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/lib/session-snapshot-cache.ts packages/web/src/lib/__tests__/session-snapshot-cache.test.ts
git commit --no-verify -m "feat(web): single-flight + TTL snapshot cache"
```

---

## Task 2: Route uses the cache (`/api/sessions`)

**Files:**
- Modify: `packages/web/src/app/api/sessions/route.ts`
- Test: `packages/web/src/__tests__/sessions-route-cache.test.ts`

**Interfaces:**
- Consumes: `getEnrichedSnapshot` (Task 1).
- The route's response body is unchanged; only how it is computed changes.

**Context:** The current `GET` (route.ts:76–225) parses params (`project`, `active`, `orchestratorOnly`, `fresh`), calls `getServices()`, then does the expensive work — `sessionManager.list()`/`listCached()`, `Promise.all(agent.getActivityState)`, `enrichSessionsMetadata` — and returns either the `orchestratorOnly` payload or the full payload. Wrap the payload computation in `getEnrichedSnapshot`; keep `recordApiObservation` and `jsonWithCorrelation` per-request (outside the cache).

- [ ] **Step 1: Write the failing test**

```ts
// packages/web/src/__tests__/sessions-route-cache.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const listCachedMock = vi.fn();
vi.mock("@/lib/services", () => ({
  getServices: vi.fn(async () => ({
    config: { projects: {} },
    registry: { get: () => undefined },
    sessionManager: { list: listCachedMock, listCached: listCachedMock },
  })),
}));

import { GET } from "@/app/api/sessions/route";
import { resetSnapshotCache } from "@/lib/session-snapshot-cache";

describe("GET /api/sessions coalescing", () => {
  beforeEach(() => {
    listCachedMock.mockReset();
    listCachedMock.mockResolvedValue([]);
    resetSnapshotCache();
  });

  it("coalesces two concurrent same-scope requests into one enrichment", async () => {
    const req = new Request("http://localhost/api/sessions") as never;
    const [r1, r2] = await Promise.all([GET(req), GET(req)]);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(listCachedMock).toHaveBeenCalledTimes(1);
  });

  it("does not coalesce across different scopes", async () => {
    resetSnapshotCache();
    await Promise.all([
      GET(new Request("http://localhost/api/sessions?active=true") as never),
      GET(new Request("http://localhost/api/sessions?active=false") as never),
    ]);
    expect(listCachedMock).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/sessions-route-cache.test.ts`
Expected: FAIL — both concurrent requests call `listCached` (2 times) because caching isn't wired yet.

- [ ] **Step 3: Refactor the route to use the cache**

In `packages/web/src/app/api/sessions/route.ts`:

3a. Add the import near the other `@/lib` imports:
```ts
import { getEnrichedSnapshot } from "@/lib/session-snapshot-cache";
```

3b. Inside `GET`, after parsing the four params (`projectFilter`, `activeOnly`, `orchestratorOnly`, `fresh`) and before calling `getServices()`, build a scope key:
```ts
const scopeKey = `${projectFilter ?? "all"}|active=${activeOnly}|orch=${orchestratorOnly}|fresh=${fresh}`;
```

3c. Wrap the expensive computation. `recordApiObservation` needs `config`, so fetch services **once at the top of `GET`** (getServices is memoized/cheap) and reuse them — both for the observation and inside the compute. Move the body that builds the response object into an inner `async` compute passed to `getEnrichedSnapshot`, returning the plain payload object (NOT the `Response`). Replace the two `return jsonWithCorrelation({...})` success sites so the inner function RETURNS the payload object; the outer code caches, records the observation, then responds:

```ts
// top of GET, after parsing params + building scopeKey:
const services = await getServices();
const { config, registry, sessionManager } = services;

const payload = await getEnrichedSnapshot(scopeKey, async () => {
  // uses config / registry / sessionManager from the enclosing scope
  // ... unchanged: requestedProjectId, coreSessions, visibleSessions,
  //     orchestrators, orchestratorId, the orchestratorOnly branch, the
  //     workerSessions / getActivityState / enrichSessionsMetadata / PR block ...
  if (orchestratorOnly) {
    return { orchestratorId, orchestrators, sessions: [] as DashboardSession[] };
  }
  return {
    sessions: dashboardSessions,
    stats: computeStats(dashboardSessions),
    orchestratorId,
    orchestrators,
  };
});

recordApiObservation({
  config,
  method: "GET",
  path: "/api/sessions",
  correlationId,
  startedAt,
  outcome: "success",
  statusCode: 200,
  data: { sessionCount: payload.sessions.length, activeOnly, orchestratorOnly, fresh },
});
return jsonWithCorrelation(payload, { status: 200 }, correlationId);
```

The compute closes over `config`/`registry`/`sessionManager` from the top-level `getServices()` — do NOT call `getServices()` again inside the compute. Keep the existing `catch` block and its failure observation unchanged. The two prior `recordApiObservation` success sites (the `orchestratorOnly` one and the normal one) collapse into the single post-cache observation above.

Preserve exact response shapes and the `orchestratorOnly` early-return semantics — only the caching wrapper and the observation-config sourcing change. Import `DashboardSession` type if needed for the empty-array annotation (from `@/lib/types`), using `import type`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @aoagents/ao-web test src/__tests__/sessions-route-cache.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Guard against regressions**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Run any existing sessions-route tests: `pnpm --filter @aoagents/ao-web test src/__tests__/api-routes.test.ts`
Expected: typecheck clean; existing route tests still pass (response shapes unchanged).

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/app/api/sessions/route.ts packages/web/src/__tests__/sessions-route-cache.test.ts
git commit --no-verify -m "feat(web): serve /api/sessions from the shared snapshot cache"
```

---

## Task 3: SessionBroadcaster backoff + warn throttle (`mux-websocket.ts`)

**Files:**
- Modify: `packages/web/server/mux-websocket.ts`
- Test: `packages/web/server/__tests__/mux-websocket.test.ts` (extend)

**Interfaces:**
- `SessionBroadcaster` public API unchanged (`subscribe`, etc.). Only internal scheduling + logging change.

**Context (current code, mux-websocket.ts:82–225):** the broadcaster starts a fixed `setInterval(poll, 3000)` on first subscriber (lines 127–138), guards overlap with `this.polling`, and `fetchSnapshot` (170–198) `console.warn`s on EVERY failure while `recordFetchFailure` (205) already dedupes the structured event via `lastFetchOk`. Replace the fixed interval with a self-scheduling `setTimeout` that backs off on consecutive failures, and gate the raw warn on the healthy→failing transition.

- [ ] **Step 1: Write the failing tests** (append inside the existing `describe("SessionBroadcaster", …)` block, which already sets `vi.useFakeTimers()` and mocks `global.fetch` as `mockFetch`)

```ts
describe("poll backoff", () => {
  it("backs off the poll interval on consecutive failures and resets on success", async () => {
    mockFetch.mockRejectedValue(new Error("down"));
    const unsub = broadcaster.subscribe(
      () => {},
      () => {},
    );
    // immediate one-off snapshot fetch fired on subscribe
    await vi.advanceTimersByTimeAsync(0);
    const afterSubscribe = mockFetch.mock.calls.length;

    // base 3s → first poll
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch.mock.calls.length).toBe(afterSubscribe + 1);
    // failed once → next poll backs off to 6s (nothing at +3s)
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch.mock.calls.length).toBe(afterSubscribe + 1);
    await vi.advanceTimersByTimeAsync(3000); // now at +6s from the failure
    expect(mockFetch.mock.calls.length).toBe(afterSubscribe + 2);

    // recover → interval resets to base 3s
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ sessions: [] }) });
    await vi.advanceTimersByTimeAsync(12000); // let the backed-off poll fire and succeed
    const afterRecover = mockFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockFetch.mock.calls.length).toBe(afterRecover + 1); // back to 3s cadence

    unsub();
  });

  it("throttles the raw warn to once per failing streak", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("down"));
    const unsub = broadcaster.subscribe(() => {}, () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(3000);
    await vi.advanceTimersByTimeAsync(6000);
    await vi.advanceTimersByTimeAsync(12000);
    const sessionWarns = warn.mock.calls.filter((c) =>
      String(c[0]).includes("[SessionBroadcaster]"),
    );
    expect(sessionWarns.length).toBe(1); // one per streak, not per poll
    unsub();
    warn.mockRestore();
  });
});
```

Note: the exact timer-advance amounts above assume base 3000 / ×2 backoff. If the harness's fake-timer async flushing needs an extra `await vi.advanceTimersByTimeAsync(0)` between steps to settle promises, add it — the fixed assertions are the call-count relationships, not the specific flush calls.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @aoagents/ao-web test server/__tests__/mux-websocket.test.ts -t "poll backoff"`
Expected: FAIL — current code polls at a fixed 3s and warns every poll.

- [ ] **Step 3: Implement backoff + throttle**

In `packages/web/server/mux-websocket.ts`, `SessionBroadcaster`:

3a. Add fields + constants (near the existing private fields):
```ts
private timerId: ReturnType<typeof setTimeout> | null = null;
private active = false;
private consecutiveFailures = 0;
private static readonly BASE_INTERVAL_MS = 3000;
private static readonly MAX_INTERVAL_MS = 30000;
```
Remove the `private intervalId` field and the `private polling` field (replaced by `timerId`/`active`; overlap is impossible with self-scheduling since the next timer is only armed after the current poll settles).

3b. Replace the `if (wasEmpty) { this.intervalId = setInterval(… , 3000); }` block (lines 126–139) with:
```ts
if (wasEmpty) {
  this.active = true;
  this.scheduleNext();
}
```

3c. Add the scheduler + poll methods:
```ts
private nextDelayMs(): number {
  if (this.consecutiveFailures === 0) return SessionBroadcaster.BASE_INTERVAL_MS;
  return Math.min(
    SessionBroadcaster.BASE_INTERVAL_MS * 2 ** this.consecutiveFailures,
    SessionBroadcaster.MAX_INTERVAL_MS,
  );
}

private scheduleNext(): void {
  if (!this.active) return;
  this.timerId = setTimeout(() => void this.poll(), this.nextDelayMs());
}

private async poll(): Promise<void> {
  const result = await this.fetchSnapshot();
  if (!this.active) return;
  if (result.sessions) {
    this.consecutiveFailures = 0;
    this.broadcast(result.sessions);
  } else if (result.error) {
    this.consecutiveFailures++;
    this.broadcastError(result.error);
  }
  this.scheduleNext();
}
```

3d. Gate the raw warn in `fetchSnapshot` on the healthy→failing transition. In both failure sites (the `!res.ok` branch and the `catch`), capture health BEFORE `recordFetchFailure` flips it and only warn on transition:
```ts
// !res.ok branch:
const msg = `Session fetch failed: HTTP ${res.status}`;
if (this.lastFetchOk) console.warn(`[SessionBroadcaster] ${msg}`);
this.recordFetchFailure(msg, { httpStatus: res.status });
return { sessions: null, error: msg };
```
```ts
// catch branch:
const msg = err instanceof Error ? err.message : String(err);
if (this.lastFetchOk) console.warn("[SessionBroadcaster] fetchSnapshot error:", msg);
this.recordFetchFailure(msg);
return { sessions: null, error: msg };
```
(`recordFetchFailure` already sets `lastFetchOk = false`; the success path sets it back to `true`, so the warn fires once per streak. Keep `recordFetchFailure` unchanged.)

3e. Update `disconnect()` (around line 221) to clear the timeout and reset backoff state:
```ts
private disconnect(): void {
  this.active = false;
  if (this.timerId !== null) {
    clearTimeout(this.timerId);
    this.timerId = null;
  }
  this.consecutiveFailures = 0;
}
```
Keep whatever else `disconnect()` currently does (read the full method and preserve it). Replace any remaining `this.intervalId !== null` reads elsewhere with `this.active`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @aoagents/ao-web test server/__tests__/mux-websocket.test.ts`
Expected: the new "poll backoff" tests PASS **and** all pre-existing `SessionBroadcaster` tests still pass (the healthy-path cadence stays 3s, so existing timer-based tests are unaffected). If a pre-existing test asserted `intervalId` internals, update it to the new `timerId`/`active` names.

- [ ] **Step 5: Typecheck + commit**

Run: `pnpm --filter @aoagents/ao-web typecheck`
Expected: clean.

```bash
git add packages/web/server/mux-websocket.ts packages/web/server/__tests__/mux-websocket.test.ts
git commit --no-verify -m "fix(web): back off SessionBroadcaster poll and throttle warn on failures"
```

---

## Final Verification

- [ ] `pnpm --filter @aoagents/ao-web typecheck` clean.
- [ ] `pnpm --filter @aoagents/ao-web test` — full web suite green (no regression in existing session-route or mux-websocket tests).
- [ ] Manual (optional, via `/run` or `/verify`): start the dashboard, open several tabs (many SSE connections), confirm `/api/sessions` work is coalesced (one enrichment per cycle, not per connection) and the `SessionBroadcaster` no longer floods warns when the server is briefly slow.
