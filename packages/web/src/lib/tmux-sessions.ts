import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWindows } from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

export interface TmuxSession {
  name: string;
  panePids: number[];
  createdEpoch: number;
  activityEpoch: number;
}

/** Exact-match tmux target — prevents prefix-match collisions (e.g. name vs name-83). */
export function exactSession(name: string): string {
  return `=${name}`;
}

/**
 * Merge `list-panes` output (session\tpane_pid) with `list-sessions` output
 * (session\tcreated\tactivity) into one record per session.
 */
export function buildTmuxSessions(panesOut: string, sessOut: string): TmuxSession[] {
  const panes = new Map<string, number[]>();
  for (const raw of panesOut.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [name, pid] = line.split("\t");
    if (!name || !/^\d+$/.test(pid ?? "")) continue;
    const list = panes.get(name) ?? [];
    list.push(Number(pid));
    panes.set(name, list);
  }

  const out: TmuxSession[] = [];
  for (const raw of sessOut.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const [name, created, activity] = line.split("\t");
    if (!name) continue;
    out.push({
      name,
      panePids: panes.get(name) ?? [],
      createdEpoch: Number(created) || 0,
      activityEpoch: Number(activity) || 0,
    });
  }
  return out;
}

/** List live tmux sessions. null on Windows; [] when the tmux server has no sessions. */
export async function listTmuxSessions(): Promise<TmuxSession[] | null> {
  if (isWindows()) return null;
  try {
    const [panes, sess] = await Promise.all([
      execFileAsync("tmux", ["list-panes", "-a", "-F", "#{session_name}\t#{pane_pid}"]),
      execFileAsync("tmux", [
        "list-sessions",
        "-F",
        "#{session_name}\t#{session_created}\t#{session_activity}",
      ]),
    ]);
    return buildTmuxSessions(panes.stdout, sess.stdout);
  } catch {
    // tmux exits non-zero when no server/sessions; ENOENT/permission errors
    // are also folded into "no sessions" here so the page degrades quietly.
    return [];
  }
}

/** Kill a single tmux session by exact name. No-op on Windows. */
export async function killTmuxSession(name: string): Promise<void> {
  if (isWindows()) return;
  await execFileAsync("tmux", ["kill-session", "-t", exactSession(name)]);
}
