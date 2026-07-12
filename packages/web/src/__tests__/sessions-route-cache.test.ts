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
