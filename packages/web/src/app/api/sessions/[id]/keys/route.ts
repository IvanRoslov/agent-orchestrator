import { type NextRequest } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getServices } from "@/lib/services";
import { validateIdentifier } from "@/lib/validation";
import { getCorrelationId, jsonWithCorrelation } from "@/lib/observability";
import { findTmux } from "../../../../../../server/tmux-utils";

const execFileAsync = promisify(execFile);

const ALLOWED = new Set([
  "Enter", "Escape", "Tab", "Up", "Down", "Left", "Right", "C-c",
  "0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
]);

/** Validate the requested key tokens against the allowlist. Returns null if invalid. */
export function validateKeyTokens(tokens: unknown): string[] | null {
  if (!Array.isArray(tokens) || tokens.length === 0 || tokens.length > 8) return null;
  if (!tokens.every((t) => typeof t === "string" && ALLOWED.has(t))) return null;
  return tokens as string[];
}

/** POST /api/sessions/:id/keys — send allowlisted control keys via tmux send-keys. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const correlationId = getCorrelationId(request);
  const { id } = await params;
  const idErr = validateIdentifier(id, "id");
  if (idErr) return jsonWithCorrelation({ error: idErr }, { status: 400 }, correlationId);

  const body = (await request.json().catch(() => null)) as { keys?: unknown } | null;
  const keys = validateKeyTokens(body?.keys);
  if (!keys) return jsonWithCorrelation({ error: "Invalid keys" }, { status: 400 }, correlationId);

  const { sessionManager } = await getServices();
  const session = await sessionManager.get(id);
  if (!session) return jsonWithCorrelation({ error: "Session not found" }, { status: 404 }, correlationId);

  const tmuxPath = findTmux();
  if (!tmuxPath) return jsonWithCorrelation({ error: "tmux not available" }, { status: 500 }, correlationId);
  const target = session.runtimeHandle?.id ?? session.metadata?.["tmuxName"] ?? session.id;

  try {
    await execFileAsync(tmuxPath, ["send-keys", "-t", target, ...keys]);
    return jsonWithCorrelation({ ok: true }, { status: 200 }, correlationId);
  } catch (err) {
    return jsonWithCorrelation({ error: err instanceof Error ? err.message : "send-keys failed" }, { status: 500 }, correlationId);
  }
}
