export type TranscriptEntry =
  | { kind: "message"; role: "user" | "assistant"; text: string }
  | { kind: "tool_use"; name: string; input: string }
  | { kind: "tool_result"; text: string; isError: boolean };

export type TranscriptStatus = "working" | "waiting_input" | "blocked" | "idle";

export interface TranscriptPromptOption {
  /** 1-based index as shown in the prompt. */
  index: number;
  label: string;
}

export interface TranscriptPrompt {
  question: string;
  options: TranscriptPromptOption[];
  /** Raw captured text, shown as a fallback when options is empty. */
  raw: string;
}

export interface TranscriptResponse {
  entries: TranscriptEntry[];
  status: TranscriptStatus;
  /** Tool name that triggered a waiting_input, when known. */
  trigger?: string;
  /** Present only when status is waiting_input/blocked and a prompt was captured. */
  prompt?: TranscriptPrompt;
}
