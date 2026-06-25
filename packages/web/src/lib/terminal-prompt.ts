import type { TranscriptPrompt, TranscriptPromptOption } from "./transcript-types";

// Matches lines like "❯ 1. Yes" / "  2. Yes, and don't ..." (optional cursor/box glyphs).
const OPTION_RE = /^[\s❯>›▶|]*?(\d+)[.)]\s+(.*\S)\s*$/;

/**
 * Parse a tmux capture-pane snapshot into a structured prompt. Returns null when
 * no numbered options are present (the caller then shows the raw text + a generic
 * Approve/Deny + free answer).
 */
export function parsePrompt(captured: string): TranscriptPrompt | null {
  const lines = captured.replace(/\r/g, "").split("\n");
  const options: TranscriptPromptOption[] = [];
  let firstOptionLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(OPTION_RE);
    if (m) {
      if (firstOptionLine === -1) firstOptionLine = i;
      options.push({ index: Number(m[1]), label: m[2].trim() });
    }
  }
  if (options.length === 0) return null;

  // Question = the nearest non-empty line above the first option.
  let question = "";
  for (let i = firstOptionLine - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (t) {
      question = t;
      break;
    }
  }
  return { question: question || "The agent is waiting for your choice.", options, raw: captured.trim() };
}
