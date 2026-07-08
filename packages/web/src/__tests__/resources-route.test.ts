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
