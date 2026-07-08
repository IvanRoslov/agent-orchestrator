import { describe, it, expect } from "vitest";
import { buildSnapshot } from "../resource-snapshot";
import type { ProcInfo } from "../resource-stats";
import type { TmuxSession } from "../tmux-sessions";

function procs(entries: ProcInfo[]): Map<number, ProcInfo> {
  return new Map(entries.map((p) => [p.pid, p]));
}

const NOW = 1_000_000; // epoch seconds

describe("buildSnapshot", () => {
  const tmux: TmuxSession[] = [
    { name: "pla-orchestrator-83", panePids: [10], createdEpoch: NOW - 600, activityEpoch: NOW - 60 },
    { name: "pla-orchestrator", panePids: [20], createdEpoch: NOW - 6000, activityEpoch: NOW - 6000 },
    { name: "eg-29", panePids: [30], createdEpoch: NOW - 120, activityEpoch: NOW - 30 },
  ];
  // pane 10 -> child 11 (claude); pane 20 -> child 21; pane 30 leaf
  const stats = procs([
    { pid: 10, ppid: 1, cpu: 0.5, rss: 100_000, comm: "bash" },
    { pid: 11, ppid: 10, cpu: 2.0, rss: 900_000, comm: "claude" },
    { pid: 20, ppid: 1, cpu: 0.1, rss: 50_000, comm: "bash" },
    { pid: 21, ppid: 20, cpu: 0.2, rss: 450_000, comm: "claude" },
    { pid: 30, ppid: 1, cpu: 1.0, rss: 500_000, comm: "node" },
  ]);
  // known store: -83 is active (working); eg-29 is terminal (cleanup); plain pla-orchestrator absent
  const known = new Map<string, string>([
    ["pla-orchestrator-83", "working"],
    ["eg-29", "cleanup"],
  ]);

  it("sums cpu/rss over the process tree and picks the leaf command", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const row = snap.sessions.find((s) => s.tmuxSession === "pla-orchestrator-83");
    expect(row?.cpuPercent).toBeCloseTo(2.5);
    expect(row?.rssMb).toBeCloseTo(1_000_000 / 1024);
    expect(row?.procCount).toBe(2);
    expect(row?.topCommand).toBe("claude");
    expect(row?.ageMinutes).toBe(10);
    expect(row?.idleMinutes).toBe(1);
  });

  it("flags orphans: untracked OR tracked-but-terminal", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const byName = Object.fromEntries(snap.sessions.map((s) => [s.tmuxSession, s]));
    expect(byName["pla-orchestrator-83"].orphan).toBe(false); // known + active
    expect(byName["pla-orchestrator"].orphan).toBe(true); // untracked
    expect(byName["pla-orchestrator"].known).toBe(false);
    expect(byName["eg-29"].orphan).toBe(true); // tracked but cleanup (terminal)
    expect(byName["eg-29"].known).toBe(true);
    expect(byName["eg-29"].aoStatus).toBe("cleanup");
  });

  it("sorts by rss desc and computes totals", () => {
    const snap = buildSnapshot(tmux, stats, known, NOW);
    const rss = snap.sessions.map((s) => s.rssMb ?? 0);
    expect(rss).toEqual([...rss].sort((a, b) => b - a));
    expect(snap.platformSupported).toBe(true);
    expect(snap.totals.sessionCount).toBe(3);
    expect(snap.totals.procCount).toBe(5);
  });

  it("degrades cpu/rss to null when stats are unavailable", () => {
    const snap = buildSnapshot(tmux, null, known, NOW);
    expect(snap.platformSupported).toBe(false);
    expect(snap.sessions.every((s) => s.cpuPercent === null && s.rssMb === null)).toBe(true);
    expect(snap.sessions.find((s) => s.tmuxSession === "pla-orchestrator")?.orphan).toBe(true);
  });
});
