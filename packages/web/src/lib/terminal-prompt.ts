import type { TranscriptPrompt, TranscriptPromptOption } from "./transcript-types";

// A real Claude TUI selection prompt highlights the active option with a cursor
// glyph (❯ / ▶ / ›). Plain numbered lists in normal output have no cursor, so
// requiring one here avoids false positives (rendering ordinary text as a
// prompt). Matches e.g. "❯ 1. Yes" / "  2. Yes, and don't ask".
const CURSOR_OPTION_RE = /^[\s|]*([❯▶›])\s*(\d+)[.)]\s+(.*\S)\s*$/;
const PLAIN_OPTION_RE = /^[\s|]*(\d+)[.)]\s+(.*\S)\s*$/;

/**
 * Parse a tmux capture-pane snapshot into a structured prompt. Returns null
 * unless the screen shows a real interactive selection — i.e. at least one
 * numbered option carries a cursor glyph (❯/▶/›). When that anchor is present,
 * sibling numbered lines (without the cursor) are included as the other options.
 */
export function parsePrompt(captured: string): TranscriptPrompt | null {
  const lines = captured.replace(/\r/g, "").split("\n");

  // Require a cursor-marked numbered option somewhere on screen.
  const hasCursor = lines.some((l) => CURSOR_OPTION_RE.test(l));
  if (!hasCursor) return null;

  const options: TranscriptPromptOption[] = [];
  let firstOptionLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const c = lines[i].match(CURSOR_OPTION_RE);
    const p = c ? null : lines[i].match(PLAIN_OPTION_RE);
    if (c) {
      if (firstOptionLine === -1) firstOptionLine = i;
      options.push({ index: Number(c[2]), label: c[3].trim() });
    } else if (p) {
      if (firstOptionLine === -1) firstOptionLine = i;
      options.push({ index: Number(p[1]), label: p[2].trim() });
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
