import { describe, expect, it } from "vitest";
import { parseTranscriptJsonl } from "../claude-transcript";

describe("parseTranscriptJsonl", () => {
  it("parses string-content user/assistant messages", () => {
    const jsonl = [
      JSON.stringify({ type: "user", message: { role: "user", content: "fix the bug" } }),
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Done!" } }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "user", text: "fix the bug" },
      { kind: "message", role: "assistant", text: "Done!" },
    ]);
  });

  it("parses assistant content blocks (text + tool_use) and tool_result", () => {
    const jsonl = [
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "Running tests" },
            { type: "tool_use", name: "Bash", input: { command: "npm test" } },
          ],
        },
      }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: [{ type: "tool_result", content: "2 passed", is_error: false }],
        },
      }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "assistant", text: "Running tests" },
      { kind: "tool_use", name: "Bash", input: '{"command":"npm test"}' },
      { kind: "tool_result", text: "2 passed", isError: false },
    ]);
  });

  it("joins array tool_result text blocks with newlines", () => {
    const jsonl = JSON.stringify({
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", content: [{ type: "text", text: "line one" }, { type: "text", text: "line two" }], is_error: true }],
      },
    });
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "tool_result", text: "line one\nline two", isError: true },
    ]);
  });

  it("skips thinking blocks, noise types, empty text, and malformed lines", () => {
    const jsonl = [
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "hmm" }] } }),
      JSON.stringify({ type: "summary", summary: "session" }),
      JSON.stringify({ type: "permission-mode", mode: "auto" }),
      JSON.stringify({ type: "user", message: { role: "user", content: "" } }),
      "{ not json",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "ok" } }),
    ].join("\n");
    expect(parseTranscriptJsonl(jsonl)).toEqual([
      { kind: "message", role: "assistant", text: "ok" },
    ]);
  });
});
