import { type NextRequest } from "next/server";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Session } from "@aoagents/ao-core";
import { readLastActivityEntry, checkActivityLogState } from "@aoagents/ao-core";
import {
  toClaudeProjectPath,
  resolveWorkspaceForClaude,
} from "@aoagents/ao-plugin-agent-claude-code";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { buildTranscript, type TranscriptDeps } from "@/lib/transcript-service";
import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import { findTmux } from "../../../../../../server/tmux-utils";

const execFileAsync = promisify(execFile);
const MAX_BYTES = 262_144;

async function resolveTranscriptFile(session: Session): Promise<string | null> {
  if (!session.workspacePath) return null;
  const slug = toClaudeProjectPath(await resolveWorkspaceForClaude(session.workspacePath));
  const dir = join(homedir(), ".claude", "projects", slug);
  const uuid = session.metadata?.["claudeSessionUuid"];
  if (uuid) {
    try {
      const p = join(dir, `${uuid}.jsonl`);
      await stat(p);
      return p;
    } catch {
      /* fall through */
    }
  }
  try {
    const files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    let newest: { path: string; mtime: number } | null = null;
    for (const f of files) {
      const p = join(dir, f);
      const s = await stat(p);
      if (!newest || s.mtimeMs > newest.mtime) newest = { path: p, mtime: s.mtimeMs };
    }
    return newest?.path ?? null;
  } catch {
    return null;
  }
}

const deps: TranscriptDeps = {
  readTranscriptText: async (session) => {
    const file = await resolveTranscriptFile(session);
    if (!file) return "";
    try {
      const buf = await readFile(file);
      return buf.length > MAX_BYTES
        ? buf.subarray(buf.length - MAX_BYTES).toString("utf8")
        : buf.toString("utf8");
    } catch {
      return "";
    }
  },
  readActivity: async (session) => {
    if (!session.workspacePath) return { state: "idle" };
    const entry = await readLastActivityEntry(session.workspacePath);
    const actionable = checkActivityLogState(entry);
    if (actionable && (actionable.state === "waiting_input" || actionable.state === "blocked")) {
      return { state: actionable.state, trigger: entry?.entry.trigger };
    }
    return { state: "idle" };
  },
  capturePane: async (session) => {
    const tmuxPath = findTmux();
    if (!tmuxPath) return "";
    const target =
      session.runtimeHandle?.id ?? session.metadata?.["tmuxName"] ?? session.id;
    try {
      const { stdout } = await execFileAsync(tmuxPath, ["capture-pane", "-t", target, "-p"]);
      return stdout;
    } catch {
      return "";
    }
  },
};

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);
  const { sessionManager } = await getServices();
  const session = await sessionManager.get(id);
  if (!session) return jsonWithCorrelation({ error: "Session not found" }, { status: 404 }, correlationId);
  const transcript = await buildTranscript(session, deps);
  return jsonWithCorrelation(transcript, { status: 200 }, correlationId);
}
