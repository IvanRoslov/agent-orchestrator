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

  it("returns 500 with an error body when the snapshot fails", async () => {
    listMock.mockRejectedValue(new Error("boom"));
    const res = await GET(new Request("http://localhost/api/resources") as never);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "boom" });
  });
});
