import type { TranscriptEntry } from "./transcript-types";

interface ContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: unknown;
  is_error?: boolean;
}
interface JsonlMessage {
  role?: string;
  content?: string | ContentBlock[];
}
interface JsonlLine {
  type?: string;
  message?: JsonlMessage;
}

function blockResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && typeof c === "object" && typeof (c as ContentBlock).text === "string" ? (c as ContentBlock).text : ""))
      .join("\n");
  }
  return "";
}

/** Parse Claude Code session JSONL text into ordered, normalized transcript entries. */
export function parseTranscriptJsonl(jsonl: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: JsonlLine;
    try {
      parsed = JSON.parse(trimmed) as JsonlLine;
    } catch {
      continue;
    }
    if (parsed.type !== "user" && parsed.type !== "assistant") continue;
    const role = parsed.type;
    const content = parsed.message?.content;
    if (typeof content === "string") {
      if (content.trim()) entries.push({ kind: "message", role, text: content });
      continue;
    }
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        entries.push({ kind: "message", role, text: block.text });
      } else if (block.type === "tool_use") {
        entries.push({
          kind: "tool_use",
          name: typeof block.name === "string" ? block.name : "tool",
          input: JSON.stringify(block.input ?? {}),
        });
      } else if (block.type === "tool_result") {
        entries.push({
          kind: "tool_result",
          text: blockResultText(block.content),
          isError: block.is_error === true,
        });
      }
      // thinking and any other block types are intentionally skipped.
    }
  }
  return entries;
}
