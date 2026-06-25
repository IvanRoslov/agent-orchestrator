import type { Session } from "@aoagents/ao-core";
import { parseTranscriptJsonl } from "./claude-transcript";
import { parsePrompt } from "./terminal-prompt";
import type { TranscriptResponse, TranscriptStatus } from "./transcript-types";

export interface TranscriptDeps {
  /** Read the Claude JSONL text for this session (empty string if not found). */
  readTranscriptText: (session: Session) => Promise<string>;
  /** Read the actionable activity state (waiting_input/blocked) + trigger, if any. */
  readActivity: (
    session: Session,
  ) => Promise<{ state: TranscriptStatus; trigger?: string }>;
  /** Capture the session's current tmux pane (read-only). */
  capturePane: (session: Session) => Promise<string>;
}

/** Pure-ish composition of the transcript response from injected IO deps. */
export async function buildTranscript(
  session: Session,
  deps: TranscriptDeps,
): Promise<TranscriptResponse> {
  const [jsonl, activity] = await Promise.all([
    deps.readTranscriptText(session),
    deps.readActivity(session),
  ]);
  const entries = parseTranscriptJsonl(jsonl);
  const status = activity.state;
  const response: TranscriptResponse = { entries, status };
  if (activity.trigger) response.trigger = activity.trigger;
  if (status === "waiting_input" || status === "blocked") {
    const captured = await deps.capturePane(session);
    const prompt = parsePrompt(captured);
    if (prompt) response.prompt = prompt;
    else if (captured.trim())
      response.prompt = { question: "The agent is waiting for input.", options: [], raw: captured.trim() };
  }
  return response;
}
