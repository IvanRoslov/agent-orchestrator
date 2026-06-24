import { describe, expect, it } from "vitest";
import { slugifyFeature, buildFeatureKickoff } from "../feature-kickoff.js";

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

describe("buildFeatureKickoff — with description (CLI path)", () => {
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

  it("uses the concrete slug in the per-task branch convention", () => {
    expect(msg).toContain("feature/add-sso/<task>");
  });

  it("defaults to one worker per task + parallel, but allows reuse as a judgment call", () => {
    expect(msg).toMatch(/one worker per task/i);
    expect(msg).toMatch(/parallel/i);
    expect(msg).toMatch(/reuse\/restore an existing worker only when/i);
  });

  it("states the question-funnel rule", () => {
    expect(msg).toMatch(/ao send/);
  });

  it("treats the title as a label only and asks the human to describe first", () => {
    expect(msg).toMatch(/label only/i);
    expect(msg).toMatch(/ask the human to describe the feature or task/i);
    expect(msg).toMatch(/don't act on the title alone/i);
    // Must NOT immediately kick off brainstorming from the title.
    expect(msg).not.toMatch(/begin with the research \+ brainstorm stage now/i);
  });

  it("permits the orchestrator to do work and open PRs in its own hub repo", () => {
    expect(msg).toMatch(/inside the hub repo/i);
    expect(msg).toMatch(/open PRs in THIS repo/i);
  });

  it("tells the orchestrator to brief workers as non-interactive (no human at terminal)", () => {
    expect(msg).toMatch(/no human at its terminal/i);
    expect(msg).toMatch(/non-interactively/i);
  });

  it("sets the language rule (English to workers, mirror the human)", () => {
    expect(msg).toMatch(/in ENGLISH/);
    expect(msg).toMatch(/reply to the human in the language/i);
  });
});

describe("buildFeatureKickoff — without description (UI button path)", () => {
  const msg = buildFeatureKickoff({ linkedProjects: ["api-repo", "web-repo"] });

  it("asks the human to describe the feature in chat first", () => {
    expect(msg).toMatch(/ask the human to describe the feature or task/i);
  });

  it("leaves the slug as a placeholder in the per-task branch convention", () => {
    expect(msg).toContain("feature/<slug>/<task>");
  });

  it("still lists linked projects and references the skill", () => {
    expect(msg).toContain("api-repo");
    expect(msg).toContain("web-repo");
    expect(msg).toContain("skills/feature-orchestrator/SKILL.md");
  });
});
