import { describe, expect, it } from "vitest";
import type { OrchestratorConfig } from "@aoagents/ao-core";
import { applyProjectOverride } from "../../src/commands/spawn.js";

function fakeConfig(projectIds: string[]): OrchestratorConfig {
  const projects: Record<string, unknown> = {};
  for (const id of projectIds) projects[id] = { path: "." };
  return { projects } as unknown as OrchestratorConfig;
}

describe("applyProjectOverride", () => {
  it("uses the override project and treats the issue arg as a bare issue id", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(applyProjectOverride(config, "web-repo", "42")).toEqual({
      projectId: "web-repo",
      issueId: "42",
    });
  });

  it("uses the override project with no issue", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(applyProjectOverride(config, "web-repo", undefined)).toEqual({
      projectId: "web-repo",
      issueId: undefined,
    });
  });

  it("throws a listing error for an unknown override project", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(() => applyProjectOverride(config, "nope", undefined)).toThrow(/Unknown project: nope/);
  });

  it("passes the issue arg literally even when it looks like a prefixed form", () => {
    const config = fakeConfig(["hub", "web-repo"]);
    expect(applyProjectOverride(config, "web-repo", "xid/42")).toEqual({
      projectId: "web-repo",
      issueId: "xid/42",
    });
  });
});
