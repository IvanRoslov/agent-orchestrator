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
