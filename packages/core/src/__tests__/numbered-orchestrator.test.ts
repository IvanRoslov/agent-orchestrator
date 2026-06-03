/**
 * Numbered (feature) orchestrators: `spawnOrchestrator(cfg, { numbered: true })`
 * creates an ADDITIONAL orchestrator session `${prefix}-orchestrator-N` with a
 * stable orchestrator identity (kind=orchestrator, isOrchestratorSession=true)
 * that does not depend on the agent's git branch. Used for cross-project
 * feature orchestrators.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createSessionManager } from "../session-manager.js";
import { isOrchestratorSession } from "../types.js";
import { setupTestContext, teardownTestContext, type TestContext } from "./test-utils.js";

let ctx: TestContext;

beforeEach(() => {
  ctx = setupTestContext();
});

afterEach(() => {
  teardownTestContext(ctx);
  vi.restoreAllMocks();
});

describe("numbered (feature) orchestrators", () => {
  it("spawns a numbered orchestrator with stable orchestrator identity and custom displayName", async () => {
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });
    const session = await sm.spawnOrchestrator(
      { projectId: "my-app", systemPrompt: "coordinate the feature" },
      { numbered: true, displayName: "SSO login" },
    );

    expect(session.id).toMatch(/^app-orchestrator-\d+$/);
    expect(session.id).not.toBe("app-orchestrator");
    expect(isOrchestratorSession(session, "app")).toBe(true);
    expect(session.lifecycle.session.kind).toBe("orchestrator");
    expect(session.metadata.displayName).toBe("SSO login");
  });

  it("assigns sequential numbers and coexists with the fixed orchestrator", async () => {
    const sm = createSessionManager({ config: ctx.config, registry: ctx.mockRegistry });

    const fixed = await sm.spawnOrchestrator({ projectId: "my-app", systemPrompt: "main" });
    const f1 = await sm.spawnOrchestrator(
      { projectId: "my-app", systemPrompt: "feat 1" },
      { numbered: true },
    );
    const f2 = await sm.spawnOrchestrator(
      { projectId: "my-app", systemPrompt: "feat 2" },
      { numbered: true },
    );

    expect(fixed.id).toBe("app-orchestrator");
    expect(f1.id).toBe("app-orchestrator-1");
    expect(f2.id).toBe("app-orchestrator-2");
  });
});
