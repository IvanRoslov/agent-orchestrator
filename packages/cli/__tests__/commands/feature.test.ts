import { describe, expect, it } from "vitest";
import { slugifyFeature, buildFeatureKickoff } from "../../src/commands/feature.js";

describe("slugifyFeature", () => {
  it("kebab-cases and trims to the first words", () => {
    expect(slugifyFeature("Add SSO login across web and API")).toBe("add-sso-login-across-web");
  });

  it("strips punctuation and collapses separators", () => {
    expect(slugifyFeature("Billing: v2 (rework!)")).toBe("billing-v2-rework");
  });

  it("falls back to 'feature' when nothing usable remains", () => {
    expect(slugifyFeature("!!! ???")).toBe("feature");
  });
});

describe("buildFeatureKickoff", () => {
  const msg = buildFeatureKickoff({
    slug: "add-sso",
    description: "Add SSO login",
    linkedProjects: ["api-repo", "web-repo"],
  });

  it("points the orchestrator at the skill file", () => {
    expect(msg).toContain("skills/feature-orchestrator/SKILL.md");
  });

  it("includes the slug, description, and every linked project", () => {
    expect(msg).toContain("add-sso");
    expect(msg).toContain("Add SSO login");
    expect(msg).toContain("api-repo");
    expect(msg).toContain("web-repo");
  });

  it("states the worker branch convention", () => {
    expect(msg).toContain("feature/add-sso/<project>");
  });

  it("states the question-funnel rule", () => {
    expect(msg).toMatch(/ao send/);
  });
});
