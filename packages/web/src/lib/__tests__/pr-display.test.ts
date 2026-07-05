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
