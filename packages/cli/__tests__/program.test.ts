import { describe, expect, it } from "vitest";
import packageJson from "../package.json" with { type: "json" };
import { createProgram } from "../src/program.js";

describe("createProgram", () => {
  it("uses the CLI package version", () => {
    expect(createProgram().version()).toBe(packageJson.version);
  });

  it("registers the project command", () => {
    expect(createProgram().commands.some((command) => command.name() === "project")).toBe(true);
  });

  it("registers the notify command", () => {
    const notify = createProgram().commands.find((command) => command.name() === "notify");
    expect(notify?.commands.some((command) => command.name() === "test")).toBe(true);
  });

  it("registers the review command", () => {
    expect(createProgram().commands.some((command) => command.name() === "review")).toBe(true);
  });

  it("registers the feature command with start and status subcommands", () => {
    const feature = createProgram().commands.find((command) => command.name() === "feature");
    expect(feature).toBeDefined();
    const subs = feature?.commands.map((c) => c.name()) ?? [];
    expect(subs).toContain("start");
    expect(subs).toContain("status");
  });
});
