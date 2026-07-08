import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { isWindows } from "@aoagents/ao-core";

const execFileAsync = promisify(execFile);

/** One process row from `ps`. rss is in KB. */
export interface ProcInfo {
  pid: number;
  ppid: number;
  cpu: number;
  rss: number;
  comm: string;
}

/**
 * Parse `ps -Ao pid=,ppid=,%cpu=,rss=,comm=` output. The command (last field)
 * may contain spaces (processes rename their argv[0]), so it is captured greedily.
 */
export function parsePs(psText: string): Map<number, ProcInfo> {
  const map = new Map<number, ProcInfo>();
  for (const raw of psText.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/);
    if (!m) continue;
    map.set(Number(m[1]), {
      pid: Number(m[1]),
      ppid: Number(m[2]),
      cpu: Number(m[3]),
      rss: Number(m[4]),
      comm: m[5],
    });
  }
  return map;
}

/** Collect process stats via ps. Returns null on Windows or if ps is unavailable. */
export async function collectProcessStats(): Promise<Map<number, ProcInfo> | null> {
  if (isWindows()) return null;
  try {
    const { stdout } = await execFileAsync("ps", ["-Ao", "pid=,ppid=,%cpu=,rss=,comm="], {
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePs(stdout);
  } catch {
    // ps unavailable/restricted (sandbox, permissions) → degrade like Windows.
    return null;
  }
}
