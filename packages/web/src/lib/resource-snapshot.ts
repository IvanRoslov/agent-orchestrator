import {
  isWindows,
  TERMINAL_STATUSES,
  type Session,
  type SessionStatus,
} from "@aoagents/ao-core";
import { collectProcessStats, type ProcInfo } from "./resource-stats";
import { listTmuxSessions, type TmuxSession } from "./tmux-sessions";
import type { ResourceRow, ResourceSnapshot } from "./resource-types";

interface TreeTotals {
  cpu: number;
  rss: number;
  count: number;
  leaves: string[];
}

function walk(
  pid: number,
  procs: Map<number, ProcInfo>,
  children: Map<number, number[]>,
  seen: Set<number>,
): TreeTotals {
  if (seen.has(pid) || !procs.has(pid)) return { cpu: 0, rss: 0, count: 0, leaves: [] };
  seen.add(pid);
  const p = procs.get(pid)!;
  const kids = children.get(pid) ?? [];
  const totals: TreeTotals = { cpu: p.cpu, rss: p.rss, count: 1, leaves: [] };
  if (kids.length === 0) totals.leaves.push(p.comm);
  for (const child of kids) {
    const r = walk(child, procs, children, seen);
    totals.cpu += r.cpu;
    totals.rss += r.rss;
    totals.count += r.count;
    totals.leaves.push(...r.leaves);
  }
  return totals;
}

function mostCommon(items: string[]): string {
  if (items.length === 0) return "";
  const counts = new Map<string, number>();
  for (const it of items) counts.set(it, (counts.get(it) ?? 0) + 1);
  let best = "";
  let bestN = -1;
  for (const [k, n] of counts) {
    if (n > bestN) {
      best = k;
      bestN = n;
    }
  }
  return best;
}

function isOrphan(name: string, known: Map<string, string>): boolean {
  const status = known.get(name);
  if (status === undefined) return true;
  return TERMINAL_STATUSES.has(status as SessionStatus);
}

/** Pure snapshot assembly. `procs === null` → degraded (cpu/rss null). */
export function buildSnapshot(
  tmuxSessions: TmuxSession[],
  procs: Map<number, ProcInfo> | null,
  known: Map<string, string>,
  nowEpochSec: number,
): ResourceSnapshot {
  const children = new Map<number, number[]>();
  if (procs) {
    for (const p of procs.values()) {
      const list = children.get(p.ppid) ?? [];
      list.push(p.pid);
      children.set(p.ppid, list);
    }
  }

  const rows: ResourceRow[] = tmuxSessions.map((s) => {
    let cpu = 0;
    let rss = 0;
    let count = 0;
    const leaves: string[] = [];
    if (procs) {
      const seen = new Set<number>();
      for (const pid of s.panePids) {
        const r = walk(pid, procs, children, seen);
        cpu += r.cpu;
        rss += r.rss;
        count += r.count;
        leaves.push(...r.leaves);
      }
    }
    const status = known.get(s.name) ?? null;
    return {
      tmuxSession: s.name,
      sessionId: known.has(s.name) ? s.name : null,
      projectId: null,
      known: known.has(s.name),
      orphan: isOrphan(s.name, known),
      aoStatus: status,
      cpuPercent: procs ? cpu : null,
      rssMb: procs ? rss / 1024 : null,
      procCount: count,
      topCommand: mostCommon(leaves),
      ageMinutes: Math.max(0, Math.floor((nowEpochSec - s.createdEpoch) / 60)),
      idleMinutes: s.activityEpoch
        ? Math.max(0, Math.floor((nowEpochSec - s.activityEpoch) / 60))
        : null,
    };
  });

  rows.sort((a, b) => (b.rssMb ?? 0) - (a.rssMb ?? 0));

  return {
    capturedAt: new Date(nowEpochSec * 1000).toISOString(),
    platformSupported: procs !== null,
    sessions: rows,
    totals: {
      cpuPercent: rows.reduce((n, r) => n + (r.cpuPercent ?? 0), 0),
      rssMb: rows.reduce((n, r) => n + (r.rssMb ?? 0), 0),
      procCount: rows.reduce((n, r) => n + r.procCount, 0),
      sessionCount: rows.length,
    },
  };
}

/** Degraded snapshot for Windows / no-tmux: known sessions only, no resource data. */
function degradedSnapshot(sessions: Session[], nowEpochSec: number): ResourceSnapshot {
  const rows: ResourceRow[] = sessions.map((s) => ({
    tmuxSession: s.id,
    sessionId: s.id,
    projectId: s.projectId,
    known: true,
    orphan: false,
    aoStatus: s.status,
    cpuPercent: null,
    rssMb: null,
    procCount: 0,
    topCommand: "",
    ageMinutes: 0,
    idleMinutes: null,
  }));
  return {
    capturedAt: new Date(nowEpochSec * 1000).toISOString(),
    platformSupported: false,
    sessions: rows,
    totals: { cpuPercent: 0, rssMb: 0, procCount: 0, sessionCount: rows.length },
  };
}

/** Live snapshot: enumerate tmux + ps, reconcile against the AO session store. */
export async function getResourceSnapshot(
  sessions: Session[],
  nowEpochSec: number,
): Promise<ResourceSnapshot> {
  if (isWindows()) return degradedSnapshot(sessions, nowEpochSec);
  const tmux = await listTmuxSessions();
  if (tmux === null) return degradedSnapshot(sessions, nowEpochSec);
  const procs = await collectProcessStats();
  const known = new Map(sessions.map((s) => [s.id, s.status]));
  const snap = buildSnapshot(tmux, procs, known, nowEpochSec);
  // Backfill projectId for known rows from the store.
  const projectById = new Map(sessions.map((s) => [s.id, s.projectId]));
  for (const row of snap.sessions) {
    if (row.sessionId) row.projectId = projectById.get(row.sessionId) ?? null;
  }
  return snap;
}
